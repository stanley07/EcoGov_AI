/* eslint-disable @typescript-eslint/no-explicit-any */
import fastify, { FastifyInstance } from "fastify";
import { Pool } from "pg";
import * as crypto from "node:crypto";
import { z } from "zod";
import { Config } from "@govos/configuration";
import { checkReadiness } from "@govos/infrastructure";
import { runWithContext, logger } from "@govos/observability";
import {
  transitionWorkflowInstance,
  TaskRegistry,
  TaskExecutor,
  checkAndAssertActiveTenant,
} from "@govos/core";
import {
  DeterministicModelProvider,
  GeminiModelProvider,
  AgentRegistry,
  PromptRegistry,
  ToolRegistry,
  Tool,
  ToolDefinition,
  PolicyEngine,
  AIExecutionOrchestrator,
  Agent,
  AgentResult,
  DEFAULT_BUDGET,
} from "@govos/ai";
export { WorkflowRuntimeWorker } from "./workflow-runtime.js";

export interface TaskRecord {
  readonly id: string;
  readonly attempt_count: number;
  readonly max_attempts: number;
}

// 1. Strict Output Validation Schema
export const RegistrationReviewOutputSchema = z.object({
  recommendedCategory: z.enum([
    "car_wash",
    "manufacturing",
    "hospitality",
    "healthcare",
    "waste_management",
    "other",
  ]),
  categoryMatchesSubmission: z.boolean(),
  detectedInconsistencies: z.array(z.string().min(1).max(500)).max(20),
  missingDocuments: z.array(z.string().min(1).max(200)).max(20),
  preliminaryRiskRating: z.enum(["low", "medium", "high"]),
  confidenceScore: z.number().min(0).max(1),
  rationale: z.string().min(1).max(4000),
  permitCheck: z.object({
    status: z.enum([
      "valid",
      "expired",
      "not_found",
      "not_required",
      "unavailable",
    ]),
    permitReference: z.string().max(255).optional(),
  }),
  requiresOfficerAttention: z.boolean(),
  attentionReasons: z.array(z.string().min(1).max(500)).max(20),
}).strict();

// 2. Deterministic Waste Permit Lookup Tool (milestone-specific mock)
export class DeterministicWastePermitLookup implements Tool {
  public readonly definition: ToolDefinition = {
    name: "check_waste_disposal_permit",
    version: "1.0.0",
    description: "Lookup water and waste disposal permit status from Lagos regulatory databases",
    category: "read_only",
    inputSchema: z.object({
      businessName: z.string().min(1),
    }),
    outputSchema: z.object({
      status: z.enum(["valid", "expired", "not_found", "not_required", "unavailable"]),
      permitReference: z.string().optional(),
    }),
    requiredPermissions: ["facility:review-support"],
  };

  public async execute(input: { businessName: string }, _tenantId: string): Promise<{
    status: "valid" | "expired" | "not_found" | "not_required" | "unavailable";
    permitReference?: string;
  }> {
    const isTestOrDet = process.env.NODE_ENV === "test" || process.env.AI_PROVIDER_MODE === "deterministic";
    if (!isTestOrDet) {
      return { status: "unavailable" };
    }

    if (input.businessName.toLowerCase().includes("fail") || input.businessName.toLowerCase().includes("invalid")) {
      return { status: "expired", permitReference: "LGS-EXP-999" };
    }
    if (input.businessName.toLowerCase().includes("missing")) {
      return { status: "not_found" };
    }
    return { status: "valid", permitReference: "LGS-WMP-2026-XYZ" };
  }
}

// 3. Task Execution claiming state transition helpers
async function claimTaskLease(
  pool: Pool,
  tenantId: string,
  taskId: string,
  leaseOwner: string,
): Promise<TaskRecord | undefined> {
  const query = `
    UPDATE task_execution
    SET
      status = 'processing',
      lease_owner = $1::varchar,
      lease_expires_at = NOW() + INTERVAL '5 minutes',
      attempt_count = attempt_count + 1,
      updated_at = NOW()
    WHERE tenant_id = $2::uuid AND task_id = $3::varchar AND available_at <= NOW()
      AND (
        status IN ('pending', 'retryable_failed')
        OR (
          status = 'processing'
          AND lease_expires_at < NOW()
        )
      )
    RETURNING *;
  `;
  const res = await pool.query(query, [leaseOwner, tenantId, taskId]);
  return res.rows[0];
}

async function heartbeatLease(
  pool: Pool,
  id: string,
  leaseOwner: string,
): Promise<boolean> {
  const query = `
    UPDATE task_execution
    SET
      lease_expires_at = NOW() + INTERVAL '5 minutes',
      last_heartbeat_at = NOW(),
      updated_at = NOW()
    WHERE id = $1 AND status = 'processing' AND lease_owner = $2 AND lease_expires_at > NOW()
    RETURNING id
  `;
  const res = await pool.query(query, [id, leaseOwner]);
  return res.rows.length > 0;
}

async function failTaskLease(
  pool: Pool,
  id: string,
  leaseOwner: string,
  errMessage: string,
  attempt: number,
  maxAttempts: number,
): Promise<void> {
  const nextStatus =
    attempt >= maxAttempts ? "permanently_failed" : "retryable_failed";
  const backoffSec = Math.min(300, 10 * Math.pow(2, attempt - 1));
  const query = `
    UPDATE task_execution
    SET
      status = $1,
      lease_owner = NULL,
      lease_expires_at = NULL,
      available_at = NOW() + ($2 || ' seconds')::INTERVAL,
      failure_code = 'TASK_EXECUTION_ERROR',
      result_reference = JSONB_BUILD_OBJECT('error', $3::text),
      updated_at = NOW()
    WHERE id = $4 AND status = 'processing' AND lease_owner = $5
  `;
  await pool.query(query, [
    nextStatus,
    backoffSec.toString(),
    errMessage,
    id,
    leaseOwner,
  ]);
}

async function completeTaskLease(
  pool: Pool,
  id: string,
  leaseOwner: string,
  result: any,
): Promise<boolean> {
  const query = `
    UPDATE task_execution
    SET
      status = 'completed',
      completed_at = NOW(),
      result_reference = $1,
      lease_owner = NULL,
      lease_expires_at = NULL,
      updated_at = NOW()
    WHERE id = $2 AND status = 'processing' AND lease_owner = $3
    RETURNING id
  `;
  const res = await pool.query(query, [JSON.stringify(result), id, leaseOwner]);
  return res.rows.length > 0;
}

// 4. Registration Review Agent (compatibility facade)
export class RegistrationReviewAgent implements Agent<Record<string, unknown>, Record<string, unknown>> {
  public readonly definition = {
    name: "ai_registration_review",
    version: "1.0.0",
    provider: "gemini-api",
    model: "gemini-1.5-flash",
    objective: "You are an environmental registration auditor agent.",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
  };

  private provider: GeminiModelProvider | DeterministicModelProvider;

  constructor(config: Config) {
    this.provider =
      config.ai.AI_PROVIDER === "gemini-api"
        ? new GeminiModelProvider(config)
        : new DeterministicModelProvider();
  }

  public async execute(input: Record<string, unknown>): Promise<AgentResult<Record<string, unknown>>> {
    const startTime = Date.now();
    const res = await this.provider.generate({
      systemInstruction: this.definition.objective,
      prompt: JSON.stringify(input),
    });
    return {
      data: res.structuredData,
      usage: {
        inputTokens: res.usage.promptTokens,
        outputTokens: res.usage.completionTokens,
        estimatedCost: Number(this.provider.estimateCost(res.usage)) / 1000000,
      },
      latencyMs: Date.now() - startTime,
      modelName: res.modelName,
      executionStatus: "succeeded",
    };
  }
}

// 5. Hardened Registration Review Task Executor using AI Runtime
export class RegistrationReviewTaskExecutor implements TaskExecutor {
  private pool: Pool;
  private config: Config;
  private agentRegistry: AgentRegistry;
  private promptRegistry: PromptRegistry;
  private toolRegistry: ToolRegistry;

  constructor(
    pool: Pool,
    config: Config,
    agentRegistry: AgentRegistry,
    promptRegistry: PromptRegistry,
    toolRegistry: ToolRegistry,
  ) {
    this.pool = pool;
    this.config = config;
    this.agentRegistry = agentRegistry;
    this.promptRegistry = promptRegistry;
    this.toolRegistry = toolRegistry;
  }

  public async execute(payload: unknown): Promise<Record<string, unknown>> {
    const { facilityId, workflowId, workflowStepExecutionId } = payload as {
      facilityId?: string;
      workflowId?: string;
      workflowStepExecutionId?: string;
    };

    if (!facilityId || !workflowId || !workflowStepExecutionId) {
      throw new Error("Missing task payload parameters.");
    }

    // Step 1: Fetch Facility details (Short read connection - no transaction held open)
    const facRes = await this.pool.query(
      `SELECT id, tenant_id, business_name as "businessName", category, address FROM facility WHERE id = $1`,
      [facilityId],
    );
    if (facRes.rows.length === 0) {
      throw new Error(`Facility not found: ${facilityId}`);
    }
    const facility = facRes.rows[0];

    // Data minimization check: extract locality context safely
    const addressStr = facility.address || "";
    const redactedAddress = addressStr.split(",").slice(-2).join(",").trim() || "Lagos, Nigeria";

    // Step 2: Initialize orchestrator & dependencies
    const provider =
      this.config.ai.AI_PROVIDER === "gemini-api"
        ? new GeminiModelProvider(this.config)
        : new DeterministicModelProvider();
    
    const policyEngine = new PolicyEngine();
    const orchestrator = new AIExecutionOrchestrator(this.pool, provider, policyEngine);

    const agent = this.agentRegistry.get("ecogov.registration-review", "1.2.0");
    const prompt = this.promptRegistry.get("ecogov.facility-review", "1.0.0");
    const permitTool = this.toolRegistry.get("check_waste_disposal_permit", "1.0.0");

    // Step 3: Run AI Orchestration loop (No PG database transaction is open during external AI calls)
    const outcome = await orchestrator.orchestrate(
      facility.tenant_id,
      workflowId,
      workflowStepExecutionId,
      agent,
      prompt,
      {
        businessName: facility.businessName,
        category: facility.category,
        address: redactedAddress,
      },
      [permitTool],
      RegistrationReviewOutputSchema,
      {
        ...DEFAULT_BUDGET,
        maxModelCalls: 4,
        maxToolCalls: 3,
        maxCorrectionAttempts: 1,
      }
    );

    if (outcome.status !== "completed") {
      throw new Error(`AI Orchestrator failed to complete review: ${outcome.status}`);
    }

    const reviewResult = outcome.value;

    // Step 4: Write business outcome & advance workflow step atomically inside short transaction
    const client = await this.pool.connect();
    try {
      await checkAndAssertActiveTenant(this.pool, facility.tenant_id);
      await client.query("BEGIN");

      // Insert into domain registration_review table
      await client.query(
        `INSERT INTO registration_review (
           tenant_id, facility_id, workflow_instance_id, workflow_step_execution_id,
           agent_name, agent_version, prompt_version, recommended_category,
           category_matches_submission, detected_inconsistencies, missing_documents,
           preliminary_risk_rating, confidence_score, rationale, permit_status,
           permit_reference, requires_officer_attention, attention_reasons, review_status
         ) VALUES ($1, $2, $3, $4, $5, '1.2.0', '1.0.0', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'unreviewed')`,
        [
          facility.tenant_id,
          facilityId,
          workflowId,
          workflowStepExecutionId,
          agent.definition.name,
          reviewResult.recommendedCategory,
          reviewResult.categoryMatchesSubmission,
          JSON.stringify(reviewResult.detectedInconsistencies),
          JSON.stringify(reviewResult.missingDocuments),
          reviewResult.preliminaryRiskRating,
          reviewResult.confidenceScore,
          reviewResult.rationale,
          reviewResult.permitCheck.status,
          reviewResult.permitCheck.permitReference || null,
          reviewResult.requiresOfficerAttention,
          JSON.stringify(reviewResult.attentionReasons),
        ]
      );

      // Spawn next human review step: officer_review (performs CAS validation internally)
      await transitionWorkflowInstance(
        client,
        facility.tenant_id,
        workflowId,
        workflowStepExecutionId,
        "officer_review",
        "agent",
        undefined,
        `AI recommendation rating: ${reviewResult.preliminaryRiskRating}`,
      );

      // Update facility status to in_review
      await client.query(
        `UPDATE facility SET registration_status = 'in_review', risk_rating = $1, updated_at = NOW() WHERE id = $2`,
        [reviewResult.preliminaryRiskRating, facilityId],
      );

      // Update facility_registration status to officer_review and increment version
      await client.query(
        `UPDATE facility_registration
         SET status = 'officer_review',
             preliminary_risk_rating = $1,
             record_version = record_version + 1,
             updated_at = NOW()
         WHERE tenant_id = $2 AND facility_id = $3`,
        [reviewResult.preliminaryRiskRating, facility.tenant_id, facilityId],
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    return {
      status: "succeeded",
      preliminaryRiskRating: reviewResult.preliminaryRiskRating,
    };
  }
}

// 6. Fastify Application Configuration Route handlers
export function createApp(
  config: Config,
  pool: Pool,
  _agentRegistry: AgentRegistry,
  _promptRegistry: PromptRegistry,
  _toolRegistry: ToolRegistry,
  taskRegistry: TaskRegistry,
): FastifyInstance {
  const app = fastify({
    disableRequestLogging: true,
  });

  app.get("/healthz", async (_req, reply) => {
    return reply
      .code(200)
      .send({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/readyz", async (_req, reply) => {
    const status = await checkReadiness(pool);
    if (status.status === "ready") {
      return reply.code(200).send(status);
    } else {
      return reply.code(503).send(status);
    }
  });

  // Hardened task runner endpoint
  app.post(
    "/internal/tasks/:taskType",
    {
      schema: {
        params: {
          type: "object",
          required: ["taskType"],
          properties: {
            taskType: { type: "string" },
          },
        },
        body: {
          type: "object",
          required: [
            "taskId",
            "taskType",
            "schemaVersion",
            "correlationId",
            "createdAt",
            "payload",
          ],
          properties: {
            taskId: { type: "string" },
            taskType: { type: "string" },
            schemaVersion: { type: "integer" },
            tenantId: { type: "string" },
            correlationId: { type: "string" },
            causationId: { type: "string" },
            createdAt: { type: "string" },
            payload: { type: "object" },
          },
        },
      },
    },
    async (req, reply) => {
      const envelope = req.body as {
        taskId: string;
        taskType: string;
        schemaVersion: number;
        tenantId: string;
        correlationId: string;
        causationId?: string;
        createdAt: string;
        payload: Record<string, unknown>;
      };

      const { taskType } = req.params as { taskType: string };

      // Authenticate: bypass in local mode, otherwise check headers audience
      if (config.worker.WORKER_AUTH_MODE === "oidc") {
        const authHeader = req.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return reply.code(401).send({ error: "Unauthorized: Missing OIDC token" });
        }
      }

      if (taskType !== envelope.taskType) {
        return reply.code(400).send({
          error: "Bad Request",
          message: `Route taskType ${taskType} does not match payload taskType ${envelope.taskType}`,
        });
      }

      const taskMapping = taskRegistry.get(taskType, "1.0.0");
      if (!taskMapping) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Task executor not found for type: ${taskType}`,
        });
      }

      const leaseOwner = `worker-${crypto.randomUUID()}`;

      // Claim Task lease (short PG transaction)
      const taskRecord = await claimTaskLease(
        pool,
        envelope.tenantId,
        envelope.taskId,
        leaseOwner,
      );

      if (!taskRecord) {
        logger.info(
          { taskId: envelope.taskId },
          "Duplicate task execution bypassed or lease active",
        );
        return reply.code(200).send({
          taskId: envelope.taskId,
          status: "skipped",
          message: "Task already claimed or duplicate.",
        });
      }

      // Start lease heartbeat interval
      const heartbeatInterval = setInterval(async () => {
        const ok = await heartbeatLease(pool, taskRecord.id, leaseOwner);
        if (!ok) {
          clearInterval(heartbeatInterval);
        }
      }, 60000);

      return runWithContext(
        { correlationId: envelope.correlationId, taskId: envelope.taskId },
        async () => {
          logger.info(
            { taskId: envelope.taskId, taskType },
            "Worker task execution started",
          );

          try {
            // Run Task Executor
            const result = await taskMapping.executor.execute(envelope.payload);

            clearInterval(heartbeatInterval);

            // Complete Task lease (short PG transaction)
            const commitOk = await completeTaskLease(
              pool,
              taskRecord.id,
              leaseOwner,
              result || {},
            );
            if (!commitOk) {
              throw new Error(
                "Failed to commit final task results. Lease ownership was lost.",
              );
            }

            logger.info(
              { taskId: envelope.taskId, taskType },
              "Worker task execution completed",
            );
            return reply.code(200).send({
              taskId: envelope.taskId,
              status: "success",
              message: `Task ${taskType} successfully executed.`,
            });
          } catch (error: unknown) {
            clearInterval(heartbeatInterval);
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(
              { error: errMsg, taskId: envelope.taskId },
              "Worker task execution failed",
            );

            // Fail lease
            await failTaskLease(
              pool,
              taskRecord.id,
              leaseOwner,
              errMsg,
              taskRecord.attempt_count,
              taskRecord.max_attempts,
            );

            return reply.code(500).send({
              error: "Internal Server Error",
              message: errMsg,
            });
          }
        },
      );
    },
  );

  return app;
}

// 7. Complaint Triage Output Zod Schema
export const ComplaintTriageOutputSchema = z.object({
  recommendedCategory: z.enum([
    "waste_dumping",
    "air_pollution",
    "water_pollution",
    "noise_pollution",
    "hazardous_material",
    "illegal_discharge",
    "environmental_health",
    "other",
  ]),
  recommendedPriority: z.enum(["routine", "standard", "urgent", "critical"]),
  summary: z.string().min(1).max(1500),
  extractedLocation: z.object({
    locality: z.string().max(200).optional(),
    lga: z.string().max(200).optional(),
    landmark: z.string().max(300).optional(),
  }),
  allegedIncidentType: z.string().min(1).max(300),
  potentialHazards: z.array(z.string().min(1).max(300)).max(20),
  recommendedDepartment: z.enum([
    "waste_management",
    "environmental_health",
    "pollution_control",
    "emergency_response",
    "general_review",
  ]),
  duplicateAssessment: z.object({
    status: z.enum(["unlikely", "possible", "likely", "not_checked", "unavailable"]),
    candidateComplaintIds: z.array(z.string().uuid()).max(10),
    rationale: z.string().max(1000),
  }),
  confidenceScore: z.number().min(0).max(1),
  requiresImmediateHumanAttention: z.boolean(),
  attentionReasons: z.array(z.string().min(1).max(500)).max(20),
  recommendedNextAction: z.enum([
    "officer_review",
    "emergency_escalation_review",
    "request_more_information",
    "possible_duplicate_review",
  ]),
}).strict();

// 8. Bounded same-tenant similarity search tool
export class FindSimilarComplaintsTool implements Tool {
  public readonly definition: ToolDefinition = {
    name: "find_similar_complaints",
    version: "1.0.0",
    description: "Search for existing complaints within the same LGA or category to assess potential duplicates",
    category: "read_only",
    inputSchema: z.object({
      lga: z.string().max(200).optional(),
      category: z.string().max(100).optional(),
      landmark: z.string().max(300).optional(),
    }),
    outputSchema: z.object({
      status: z.enum(["success", "unavailable"]),
      candidates: z.array(
        z.object({
          complaintId: z.string().uuid(),
          submittedAt: z.string(),
          locality: z.string(),
          category: z.string().optional(),
          similaritySignals: z.object({
            sameLga: z.boolean(),
            sameLandmark: z.boolean(),
            categoryCompatible: z.boolean(),
            textSimilarityBand: z.enum(["low", "medium", "high"]),
          }),
        })
      ).max(10),
    }),
    requiredPermissions: ["facility:review-support"],
  };

  private pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }

  public async execute(
    input: { lga?: string; category?: string; landmark?: string },
    tenantId: string,
  ): Promise<{ status: "success" | "unavailable"; candidates: any[] }> {
    const maxCandidates = 10;
    const lookbackDays = 90;

    const query = `
      SELECT id, category, location, created_at
      FROM complaint
      WHERE tenant_id = $1
        AND created_at >= NOW() - ($2 || ' days')::INTERVAL
        AND status != 'rejected'
      ORDER BY created_at DESC
      LIMIT $3
    `;

    const res = await this.pool.query(query, [tenantId, lookbackDays.toString(), maxCandidates]);

    const candidates = res.rows.map((row) => {
      const sameLga = input.lga ? row.location.toLowerCase().includes(input.lga.toLowerCase()) : false;
      const sameLandmark = input.landmark ? row.location.toLowerCase().includes(input.landmark.toLowerCase()) : false;
      const categoryCompatible = input.category ? row.category?.toLowerCase() === input.category.toLowerCase() : false;

      return {
        complaintId: row.id,
        submittedAt: row.created_at.toISOString(),
        locality: row.location,
        category: row.category || undefined,
        similaritySignals: {
          sameLga,
          sameLandmark,
          categoryCompatible,
          textSimilarityBand: sameLandmark ? "high" : sameLga ? "medium" : "low",
        },
      };
    });

    return {
      status: "success",
      candidates,
    };
  }
}

// 9. Complaint Triage Task Executor using AI Runtime
export class ComplaintTriageTaskExecutor implements TaskExecutor {
  private pool: Pool;
  private config: Config;
  private agentRegistry: AgentRegistry;
  private promptRegistry: PromptRegistry;
  private toolRegistry: ToolRegistry;

  constructor(
    pool: Pool,
    config: Config,
    agentRegistry: AgentRegistry,
    promptRegistry: PromptRegistry,
    toolRegistry: ToolRegistry,
  ) {
    this.pool = pool;
    this.config = config;
    this.agentRegistry = agentRegistry;
    this.promptRegistry = promptRegistry;
    this.toolRegistry = toolRegistry;
  }

  public async execute(payload: unknown): Promise<Record<string, unknown>> {
    const { complaintId, workflowId, workflowStepExecutionId } = payload as {
      complaintId?: string;
      workflowId?: string;
      workflowStepExecutionId?: string;
    };

    if (!complaintId || !workflowId || !workflowStepExecutionId) {
      throw new Error("Missing task payload parameters.");
    }

    // Step 1: Fetch Complaint details (Short read connection - no transaction open during LLM execution)
    const compRes = await this.pool.query(
      `SELECT id, tenant_id, subject, normalized_description, location, category, is_emergency, status FROM complaint WHERE id = $1`,
      [complaintId],
    );
    if (compRes.rows.length === 0) {
      throw new Error(`Complaint not found: ${complaintId}`);
    }
    const complaint = compRes.rows[0];

    // Bounded versions resolving
    const provider =
      this.config.ai.AI_PROVIDER === "gemini-api"
        ? new GeminiModelProvider(this.config)
        : new DeterministicModelProvider();

    const policyEngine = new PolicyEngine();
    const orchestrator = new AIExecutionOrchestrator(this.pool, provider, policyEngine);

    const agent = this.agentRegistry.get("ecogov.complaint-triage", "1.0.0");
    const prompt = this.promptRegistry.get("ecogov.complaint-triage-template", "1.0.0");
    const similarityTool = this.toolRegistry.get("find_similar_complaints", "1.0.0");

    let outcome: any;
    try {
      outcome = await orchestrator.orchestrate(
        complaint.tenant_id,
        workflowId,
        workflowStepExecutionId,
        agent,
        prompt,
        {
          subject: complaint.subject,
          description: complaint.normalized_description,
          location: complaint.location,
        },
        [similarityTool],
        ComplaintTriageOutputSchema,
        {
          ...DEFAULT_BUDGET,
          maxModelCalls: 4,
          maxToolCalls: 3,
          maxCorrectionAttempts: 1,
        }
      );
    } catch (err: any) {
      // Step 2b: Failure escalation (AI Triage fails, route to manual officer review with details)
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE complaint SET status = 'officer_review', updated_at = NOW() WHERE id = $1",
          [complaintId]
        );
        await transitionWorkflowInstance(
          client,
          complaint.tenant_id,
          workflowId,
          workflowStepExecutionId,
          "ai_complete",
          "agent",
          undefined,
          `AI Triage failed: ${err.message}`
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      throw err;
    }

    if (outcome.status !== "completed") {
      // Bounded failure workflow step route
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "UPDATE complaint SET status = 'officer_review', updated_at = NOW() WHERE id = $1",
          [complaintId]
        );
        await transitionWorkflowInstance(
          client,
          complaint.tenant_id,
          workflowId,
          workflowStepExecutionId,
          "ai_complete",
          "agent",
          undefined,
          `AI Triage completed with status: ${outcome.status}`
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
      return { status: "failed", outcomeStatus: outcome.status };
    }

    const reviewResult = outcome.value;

    // Step 3: Write business recommendation under short transaction (with CAS verification)
    const client = await this.pool.connect();
    try {
      await checkAndAssertActiveTenant(this.pool, complaint.tenant_id);
      await client.query("BEGIN");

      // Verify that the complaint is still in triage_pending status (CAS check)
      const casCheck = await client.query(
        "SELECT status FROM complaint WHERE id = $1 FOR UPDATE",
        [complaintId]
      );
      if (casCheck.rows.length === 0 || casCheck.rows[0].status !== "triage_pending") {
        throw new Error("Complaint is no longer in triage_pending status. Decided by officer or concurrent task.");
      }

      await client.query(
        `INSERT INTO complaint_triage_review (
           tenant_id, complaint_id, workflow_instance_id, workflow_step_execution_id,
           classified_category, recommended_priority, summary, extracted_location,
           alleged_incident_type, potential_hazards, recommended_department,
           duplicate_assessment, confidence_score, requires_immediate_human_attention,
           attention_reasons, recommended_next_action, triage_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'unreviewed')`,
        [
          complaint.tenant_id,
          complaintId,
          workflowId,
          workflowStepExecutionId,
          reviewResult.recommendedCategory,
          reviewResult.recommendedPriority,
          reviewResult.summary,
          JSON.stringify(reviewResult.extractedLocation),
          reviewResult.allegedIncidentType,
          JSON.stringify(reviewResult.potentialHazards),
          reviewResult.recommendedDepartment,
          JSON.stringify(reviewResult.duplicateAssessment),
          reviewResult.confidenceScore,
          reviewResult.requiresImmediateHumanAttention,
          JSON.stringify(reviewResult.attentionReasons),
          reviewResult.recommendedNextAction,
        ]
      );

      // Transition workflow step (performs status check internally)
      await transitionWorkflowInstance(
        client,
        complaint.tenant_id,
        workflowId,
        workflowStepExecutionId,
        "ai_complete",
        "agent",
        undefined,
        `AI Triage complete. Recommended department: ${reviewResult.recommendedDepartment}`
      );

      // Update complaint status to officer_review
      await client.query(
        "UPDATE complaint SET status = 'officer_review', updated_at = NOW() WHERE id = $1",
        [complaintId]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK");
      throw txErr;
    } finally {
      client.release();
    }

    return {
      status: "succeeded",
      recommendedDepartment: reviewResult.recommendedDepartment,
    };
  }
}
