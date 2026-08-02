import { Pool } from "pg";
import { z } from "zod";
import * as crypto from "node:crypto";
import { 
  AIExecutionOrchestrator, 
  AgentRegistry, 
  PromptRegistry, 
  DEFAULT_BUDGET
} from "@govos/ai";
import { validateScreeningOutput } from "./screening-contracts.js";
import { MarketplacePricingPolicy } from "./marketplace-policies.js";

export const ScreeningOutputSchema = z.object({
  schemaVersion: z.literal("1"),
  recommendation: z.enum(["recommended", "needs_review", "high_risk"]),
  score: z.number().min(0).max(100),
  criteria: z.array(z.object({
    code: z.string(),
    score: z.number().min(0).max(100),
    weight: z.number().min(0).max(1),
    explanation: z.string()
  })),
  riskFlags: z.array(z.object({
    code: z.string(),
    severity: z.enum(["low", "medium", "high"]),
    explanation: z.string()
  })),
  summary: z.string()
}).strict();

export class ScreenSubcontractorApplicationHandler {
  constructor(
    private pool: Pool,
    private orchestrator: AIExecutionOrchestrator,
    private agentRegistry: AgentRegistry,
    private promptRegistry: PromptRegistry
  ) {}

  public async handleScreening(eventPayload: any, eventId: string): Promise<void> {
    let payloadObj = eventPayload;
    if (typeof payloadObj === "string") {
      try {
        payloadObj = JSON.parse(payloadObj);
      } catch (err) {
        throw new Error("Non-retryable: Invalid JSON event payload");
      }
    }

    const { tenantId, applicationId, applicationVersion } = payloadObj as {
      tenantId?: string;
      applicationId?: string;
      applicationVersion?: number;
    };

    if (!tenantId || !applicationId || applicationVersion === undefined) {
      throw new Error(`Non-retryable: Missing outbox event parameters (got: ${JSON.stringify(payloadObj)})`);
    }

    // 1. Verify tenant status
    const tenantRes = await this.pool.query("SELECT status FROM tenant WHERE id = $1", [tenantId]);
    if (tenantRes.rows.length === 0) {
      throw new Error("Non-retryable: Tenant not found");
    }
    if (tenantRes.rows[0].status === "suspended") {
      throw new Error("Non-retryable: Tenant suspended");
    }

    // 2. Load snapshot
    const snapshotRes = await this.pool.query(
      `SELECT * FROM subcontractor_application_snapshot 
       WHERE tenant_id = $1 AND application_id = $2 AND application_version = $3`,
      [tenantId, applicationId, applicationVersion]
    );
    if (snapshotRes.rows.length === 0) {
      throw new Error("Non-retryable: Application snapshot not found");
    }
    const snapshot = snapshotRes.rows[0];

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 3. Transition status to screening_in_progress
      await client.query(
        `UPDATE subcontractor_application 
         SET status = 'screening_in_progress', updated_at = NOW() 
         WHERE tenant_id = $1 AND id = $2 AND status = 'screening_queued'`,
        [tenantId, applicationId]
      );

      await client.query(
        `INSERT INTO subcontractor_application_event (
          tenant_id, application_id, actor_type, actor_id, previous_state, new_state, reason, correlation_id, event_type, event_key
        ) VALUES ($1, $2, 'system', null, 'screening_queued', 'screening_in_progress', 'AI screening run started', $3, 'screening.started', $4)`,
        [tenantId, applicationId, eventId, 'screening.started:' + eventId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // 4. Run the orchestrator
    const agent = this.agentRegistry.get("ecogov.subcontractor-screening", "1.0.0");
    const prompt = this.promptRegistry.get("ecogov.subcontractor-screening-template", "1.0.0");

    const payload = snapshot.canonical_payload;

    let outcome: any;
    try {
      outcome = await this.orchestrator.orchestrate(
        tenantId,
        null,
        null,
        agent,
        prompt,
        {
          businessName: payload.business.name,
          licenseType: payload.business.licenceType,
          experienceYears: payload.business.experienceYears,
          documents: payload.documents
        },
        [], // No extra tools needed for static screening
        ScreeningOutputSchema,
        {
          ...DEFAULT_BUDGET,
          maxWallClockMs: 15000 // 15s limit
        }
      );
    } catch (err: any) {
      // Record failure state
      const execId = outcome?.executionId || crypto.randomUUID();
      await this.recordScreeningFailure(tenantId, applicationId, applicationVersion, snapshot.input_snapshot_hash, eventId, err.message, execId);
      throw err;
    }

    if (outcome.status === "completed") {
      const value = outcome.value;
      validateScreeningOutput(value);

      // Save successful result and transition application
      const clientWrite = await this.pool.connect();
      try {
        await clientWrite.query("BEGIN");

        let agentVersionId = null;
        let promptVersionId = null;
        const execId = outcome.executionId;
        if (execId) {
          const execQuery = await clientWrite.query(
            `SELECT e.agent_version_id, v.prompt_version_id 
             FROM ai_execution e
             LEFT JOIN agent_version v ON v.id = e.agent_version_id
             WHERE e.id = $1`,
            [execId]
          );
          if (execQuery.rows.length > 0) {
            agentVersionId = execQuery.rows[0].agent_version_id;
            promptVersionId = execQuery.rows[0].prompt_version_id;
          }
        }

        const criteriaJson = JSON.stringify(value.criteria);
        const riskFlagsArray = value.riskFlags.map((f: any) => f.code);

        const insertQuery = `
          INSERT INTO subcontractor_screening_result (
            tenant_id, application_id, ai_execution_id, screening_policy_version,
            input_snapshot_hash, screening_status, application_version,
            recommendation, score, criteria, risk_flags, model_version,
            provider_name, provider_model, provider_model_version,
            agent_version_id, prompt_version_id
          ) VALUES ($1, $2, $3, '1.0.0', $4, 'completed', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING id
        `;
        await clientWrite.query(insertQuery, [
          tenantId,
          applicationId,
          execId || crypto.randomUUID(), // Fallback to random if executionId absent
          snapshot.input_snapshot_hash,
          applicationVersion,
          value.recommendation,
          value.score,
          criteriaJson,
          riskFlagsArray,
          agent.definition.model, // model_version
          agent.definition.provider, // provider_name
          agent.definition.model, // provider_model
          agent.definition.version, // provider_model_version
          agentVersionId,
          promptVersionId
        ]);

        // Transition application to awaiting officer review
        await clientWrite.query(
          `UPDATE subcontractor_application 
           SET status = 'awaiting_officer_review', updated_at = NOW() 
           WHERE tenant_id = $1 AND id = $2 AND status = 'screening_in_progress'`,
          [tenantId, applicationId]
        );

        await clientWrite.query(
          `INSERT INTO subcontractor_application_event (
            tenant_id, application_id, actor_type, actor_id, previous_state, new_state, reason, correlation_id, event_type, event_key
          ) VALUES ($1, $2, 'ai', null, 'screening_in_progress', 'awaiting_officer_review', $3, $4, 'screening.completed', $5)`,
          [
            tenantId,
            applicationId,
            `AI screening completed: recommendation=${value.recommendation}, score=${value.score}`,
            eventId,
            'screening.completed:' + eventId
          ]
        );

        await clientWrite.query("COMMIT");
      } catch (err) {
        await clientWrite.query("ROLLBACK");
        throw err;
      } finally {
        clientWrite.release();
      }
    } else {
      // Record failure state
      const failureReason = `AI Orchestration status: ${outcome.status}`;
      const execId = outcome.executionId || crypto.randomUUID();
      await this.recordScreeningFailure(tenantId, applicationId, applicationVersion, snapshot.input_snapshot_hash, eventId, failureReason, execId);
      throw new Error(failureReason);
    }
  }

  private async recordScreeningFailure(
    tenantId: string,
    applicationId: string,
    applicationVersion: number,
    snapshotHash: string,
    eventId: string,
    reason: string,
    executionId: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Ensure the ai_execution record exists to prevent foreign key violation on early failure
      const execCheck = await client.query("SELECT id FROM ai_execution WHERE id = $1", [executionId]);
      if (execCheck.rows.length === 0) {
        await client.query(`
          INSERT INTO ai_execution (
            id, tenant_id, agent_name, model_provider, model_name,
            prompt_template_version, input_hash, execution_status, current_state, validation_status, started_at, actor_type
          ) VALUES ($1, $2, 'ecogov.subcontractor-screening', 'google', 'gemini-1.5-flash', '1.0.0', 'failed-fallback', 'failed', 'failed', 'invalid', NOW(), 'system')
        `, [executionId, tenantId]);
      }

      // Resolve metadata from ai_execution
      let agentVersionId = null;
      let promptVersionId = null;
      let providerName = "google";
      let providerModel = "gemini-1.5-flash";
      let providerModelVersion = "1.0.0";

      const execQuery = await client.query(
        `SELECT e.agent_version_id, e.model_provider, e.model_name, v.prompt_version_id, v.version as agent_version_str
         FROM ai_execution e
         LEFT JOIN agent_version v ON v.id = e.agent_version_id
         WHERE e.id = $1`,
        [executionId]
      );
      if (execQuery.rows.length > 0) {
        const row = execQuery.rows[0];
        agentVersionId = row.agent_version_id;
        promptVersionId = row.prompt_version_id;
        if (row.model_provider) providerName = row.model_provider;
        if (row.model_name) providerModel = row.model_name;
        if (row.agent_version_str) providerModelVersion = row.agent_version_str;
      }

      // Record failed screening result
      await client.query(`
        INSERT INTO subcontractor_screening_result (
          tenant_id, application_id, ai_execution_id, screening_policy_version,
          input_snapshot_hash, screening_status, application_version, model_version,
          provider_name, provider_model, provider_model_version,
          agent_version_id, prompt_version_id
        ) VALUES ($1, $2, $3, '1.0.0', $4, 'failed', $5, $6, $7, $8, $9, $10, $11)
      `, [
        tenantId,
        applicationId,
        executionId,
        snapshotHash,
        applicationVersion,
        providerModel, // model_version
        providerName,
        providerModel,
        providerModelVersion,
        agentVersionId,
        promptVersionId
      ]);

      // Transition application to screening_failed
      await client.query(
        `UPDATE subcontractor_application 
         SET status = 'screening_failed', updated_at = NOW() 
         WHERE tenant_id = $1 AND id = $2 AND status = 'screening_in_progress'`,
        [tenantId, applicationId]
      );

      await client.query(
        `INSERT INTO subcontractor_application_event (
          tenant_id, application_id, actor_type, actor_id, previous_state, new_state, reason, correlation_id, event_type, event_key
        ) VALUES ($1, $2, 'system', null, 'screening_in_progress', 'screening_failed', $3, $4, 'screening.failed', $5)`,
        [
          tenantId,
          applicationId,
          `AI screening failed: ${reason.substring(0, 200)}`,
          eventId,
          'screening.failed:' + eventId
        ]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

export class OfficerReviewService {
  constructor(private pool: Pool) {}

  public async approveApplication(
    tenantId: string,
    applicationId: string,
    expectedVersion: number,
    decisionReason: string,
    screeningResultId: string,
    actorUserId: string,
    overrideReason?: string
  ): Promise<void> {
    await this.processReviewDecision(
      tenantId,
      applicationId,
      expectedVersion,
      decisionReason,
      screeningResultId,
      actorUserId,
      "approved",
      "invoice_pending",
      overrideReason
    );
  }

  public async rejectApplication(
    tenantId: string,
    applicationId: string,
    expectedVersion: number,
    decisionReason: string,
    screeningResultId: string,
    actorUserId: string,
    overrideReason?: string
  ): Promise<void> {
    await this.processReviewDecision(
      tenantId,
      applicationId,
      expectedVersion,
      decisionReason,
      screeningResultId,
      actorUserId,
      "rejected",
      "rejected",
      overrideReason
    );
  }

  public async requestInformation(
    tenantId: string,
    applicationId: string,
    expectedVersion: number,
    decisionReason: string,
    screeningResultId: string,
    actorUserId: string
  ): Promise<void> {
    await this.processReviewDecision(
      tenantId,
      applicationId,
      expectedVersion,
      decisionReason,
      screeningResultId,
      actorUserId,
      "more_information_required",
      "more_information_required"
    );
  }

  private async processReviewDecision(
    tenantId: string,
    applicationId: string,
    expectedVersion: number,
    decisionReason: string,
    screeningResultId: string,
    actorUserId: string,
    decision: "approved" | "rejected" | "more_information_required",
    targetStatus: string,
    overrideReason?: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verify active tenant
      const tenantRes = await client.query("SELECT status FROM tenant WHERE id = $1", [tenantId]);
      if (tenantRes.rows.length === 0 || tenantRes.rows[0].status === "suspended") {
        throw new Error("Tenant is inactive or suspended");
      }

      // Lock application
      const appRes = await client.query(
        "SELECT * FROM subcontractor_application WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, applicationId]
      );
      if (appRes.rows.length === 0) {
        throw new Error("Application not found");
      }
      const app = appRes.rows[0];

      if (Number(app.version) !== expectedVersion) {
        throw new Error("Version mismatch conflict");
      }

      if (app.status !== "awaiting_officer_review") {
        throw new Error(`Application in state '${app.status}' cannot be reviewed`);
      }

      // Fetch and verify screening result
      const screeningRes = await client.query(
        "SELECT * FROM subcontractor_screening_result WHERE tenant_id = $1 AND id = $2",
        [tenantId, screeningResultId]
      );
      if (screeningRes.rows.length === 0) {
        throw new Error("Screening result not found");
      }
      const result = screeningRes.rows[0];

      if (Number(result.application_version) !== Number(app.version) && Number(result.application_version) !== Number(app.version) - 1) {
        throw new Error("Screening result is stale");
      }

      // Load active snapshot hash to compare
      const snapshotRes = await client.query(
        `SELECT input_snapshot_hash FROM subcontractor_application_snapshot 
         WHERE tenant_id = $1 AND application_id = $2 AND (application_version = $3 OR application_version = $4)`,
        [tenantId, applicationId, app.version, Number(app.version) - 1]
      );
      if (snapshotRes.rows.length === 0 || snapshotRes.rows.every(r => r.input_snapshot_hash !== result.input_snapshot_hash)) {
        throw new Error("Screening snapshot hash mismatch");
      }

      // Require overrideReason if decision conflicts with AI recommendation
      if (result.screening_status === "completed") {
        const rec = result.recommendation;
        if (rec === "high_risk" && decision === "approved" && !overrideReason) {
          throw new Error("Override reason is required to approve high risk application");
        }
        if (rec === "recommended" && decision === "rejected" && !overrideReason) {
          throw new Error("Override reason is required to reject recommended application");
        }
      }

      // Update application status
      await client.query(
        `UPDATE subcontractor_application 
         SET status = $1, version = version + 1, updated_at = NOW() 
         WHERE tenant_id = $2 AND id = $3`,
        [targetStatus, tenantId, applicationId]
      );
 
      // Create invoice if approved (targetStatus === 'invoice_pending')
      if (targetStatus === "invoice_pending") {
        const invoiceId = crypto.randomUUID();
        
        // Query tenant-scoped count for sequential component
        const countQuery = await client.query("SELECT COUNT(*) FROM marketplace_invoice WHERE tenant_id = $1", [tenantId]);
        const count = Number(countQuery.rows[0].count);
        const seq = String(count + 1).padStart(6, '0');
        const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();
        const invoiceNumber = `MKT-${new Date().getFullYear()}-${randomPart}-${seq}`;
        
        const pricing = MarketplacePricingPolicy.calculateFee(app.license_type);
        
        await client.query(
          `INSERT INTO marketplace_invoice (
            id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status
          ) VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 year', $5, $6, 'unpaid')`,
          [invoiceId, tenantId, applicationId, invoiceNumber, pricing.amountMicroUnits, pricing.currency]
        );
      }

      // Log decision event
      const finalReason = decisionReason + (overrideReason ? ` | Override: ${overrideReason}` : "");
      const decisionCorrelationId = crypto.randomUUID();
      await client.query(
        `INSERT INTO subcontractor_application_event (
          tenant_id, application_id, actor_type, actor_id, previous_state, new_state, reason, correlation_id, event_type, event_key
        ) VALUES ($1, $2, 'user', $3, 'awaiting_officer_review', $4, $5, $6, 'officer.decision', $7)`,
        [tenantId, applicationId, actorUserId, targetStatus, finalReason, decisionCorrelationId, 'officer.decision:' + decisionCorrelationId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
