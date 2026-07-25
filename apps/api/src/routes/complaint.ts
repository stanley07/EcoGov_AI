import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { z } from "zod";
import {
  hasPermission,
  createWorkflowInstance,
  transitionWorkflowInstance,
  checkAndAssertActiveTenant,
} from "@govos/core";
import { getContext, logger } from "@govos/observability";

// Simple IP memory rate-limiter
const ipRateLimit = new Map<string, { count: number; resetAt: number }>();

// Encryption Key Management contract
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = Buffer.from("govos-intake-key-must-be-32bytes", "utf-8"); // v1

function encryptContact(text: string): { ciphertext: string; nonce: string; keyVersion: string } {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, nonce);
  let ciphertext = cipher.update(text, "utf8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return {
    ciphertext: ciphertext + ":" + authTag,
    nonce: nonce.toString("hex"),
    keyVersion: "v1",
  };
}

function decryptContact(ciphertextWithTag: string, nonceHex: string): string {
  const parts = ciphertextWithTag.split(":");
  const ciphertext = parts[0];
  const authTag = parts[1];
  if (!ciphertext || !authTag) {
    throw new Error("Invalid ciphertext or authentication tag");
  }
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    ENCRYPTION_KEY,
    Buffer.from(nonceHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// Discriminated Union schema for Officer triage decisions
const OfficerTriageDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("accept"),
    assignedDepartment: z.string().min(1),
    notes: z.string().max(4000).optional(),
  }),
  z.object({
    decision: z.literal("accept_with_changes"),
    confirmedCategory: z.string().min(1),
    confirmedPriority: z.string().min(1),
    assignedDepartment: z.string().min(1),
    notes: z.string().min(1).max(4000),
  }),
  z.object({
    decision: z.literal("reject_complaint"),
    reasonCode: z.string().min(1),
    notes: z.string().min(1).max(4000),
  }),
  z.object({
    decision: z.literal("mark_duplicate"),
    duplicateOfComplaintId: z.string().uuid(),
    notes: z.string().max(4000).optional(),
  }),
]);

// Deterministic Emergency screening phrase-aware rule sets
const EMERGENCY_RULE_SET_VERSION = "ecogov.emergency-screening@1.0.0";
interface EmergencyScreeningResult {
  ruleSetVersion: string;
  flagged: boolean;
  matchedRuleCodes: string[];
  requiresImmediateHumanAttention: boolean;
}

function runEmergencyScreening(subject: string, description: string): EmergencyScreeningResult {
  const text = `${subject} ${description}`.toLowerCase();
  const matchedRuleCodes: string[] = [];

  if (text.includes("fire") || text.includes("explosion")) {
    matchedRuleCodes.push("ACTIVE_FIRE");
  }
  if (text.includes("chemical spill") || text.includes("toxic gas")) {
    matchedRuleCodes.push("CHEMICAL_SPILL");
  }
  if (text.includes("water contamination") || text.includes("contaminated water")) {
    matchedRuleCodes.push("PUBLIC_WATER_CONTAMINATION");
  }
  if (text.includes("danger to life") || text.includes("life threat")) {
    matchedRuleCodes.push("IMMEDIATE_DANGER_TO_LIFE");
  }

  return {
    ruleSetVersion: EMERGENCY_RULE_SET_VERSION,
    flagged: matchedRuleCodes.length > 0,
    matchedRuleCodes,
    requiresImmediateHumanAttention: matchedRuleCodes.length > 0,
  };
}

export function complaintRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // POST /complaints: Anonymous intake endpoint
  app.post(
    "/complaints",
    {
      schema: {
        body: {
          type: "object",
          required: ["clientSubmissionId", "subject", "description", "location"],
          properties: {
            clientSubmissionId: { type: "string" },
            citizenName: { type: "string" },
            citizenContact: { type: "string" },
            subject: { type: "string" },
            description: { type: "string", maxLength: 8000 },
            location: { type: "string" },
            category: { type: "string" },
          },
        },
      },
    },
    async (req, reply) => {
      // 1. Abuse Rate-Limiter
      const ip = req.ip || "127.0.0.1";
      const now = Date.now();
      const limit = ipRateLimit.get(ip);
      if (limit && limit.resetAt > now) {
        if (limit.count >= 10) {
          return reply.status(429).send({ error: "Too many requests. Please try again later." });
        }
        limit.count++;
      } else {
        ipRateLimit.set(ip, { count: 1, resetAt: now + 60000 });
      }

      const body = req.body as {
        clientSubmissionId: string;
        citizenName?: string;
        citizenContact?: string;
        subject: string;
        description: string;
        location: string;
        category?: string;
      };

      // 2. Resolve Tenant server-side (do not trust user body inputs)
      let tenantId = "00000000-0000-0000-0000-000000000001";
      const tenantCodeHeader = req.headers["x-tenant-code"];
      if (typeof tenantCodeHeader === "string") {
        const orgRes = await pool.query(
          "SELECT tenant_id FROM organization WHERE id::text = $1 OR name = $2",
          [tenantCodeHeader, tenantCodeHeader]
        );
        if (orgRes.rows.length > 0) {
          tenantId = orgRes.rows[0].tenant_id;
        }
      }

      // Assert operational tenant bounds
      await checkAndAssertActiveTenant(pool, tenantId);

      // 3. Idempotency Check
      const existing = await pool.query(
        "SELECT id, reference_number, status FROM complaint WHERE tenant_id = $1 AND client_submission_id = $2",
        [tenantId, body.clientSubmissionId]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        return reply.send({
          complaintId: row.id,
          referenceNumber: row.reference_number,
          status: row.status,
        });
      }

      // 4. Deterministic Emergency Screening
      const emergency = runEmergencyScreening(body.subject, body.description);
      const isEmergency = emergency.flagged;
      const initialStatus = isEmergency ? "officer_review" : "triage_pending";

      // 5. Generate Collision-safe Reference Number
      const year = new Date().getFullYear();
      const randSuffix = crypto.randomInt(100000, 999999).toString();
      const referenceNumber = `ECO-COMP-${year}-${randSuffix}`;

      // Unicode Normalization (preserve original description)
      const normalizedDescription = body.description.normalize("NFC");

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Create Complaint record
        const compRes = await client.query(
          `INSERT INTO complaint (
             tenant_id, reference_number, client_submission_id, citizen_name,
             subject, description, normalized_description, location, category, status, is_emergency, emergency_rule_codes
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            tenantId,
            referenceNumber,
            body.clientSubmissionId,
            body.citizenName || null,
            body.subject,
            body.description,
            normalizedDescription,
            body.location,
            body.category || null,
            initialStatus,
            isEmergency,
            JSON.stringify(emergency.matchedRuleCodes),
          ]
        );
        const complaintId = compRes.rows[0].id;

        // Encrypt Contact if present
        if (body.citizenContact) {
          const enc = encryptContact(body.citizenContact);
          await client.query(
            `INSERT INTO complaint_contact (tenant_id, complaint_id, ciphertext, key_version, nonce)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, complaintId, enc.ciphertext, enc.keyVersion, enc.nonce]
          );
        }

        // Spawn workflow instance
        const { instanceId, initialStepExecutionId } = await createWorkflowInstance(
          client,
          tenantId,
          "complaint_triage",
          "complaint",
          complaintId,
        );

        // Transition: intake completed -> ai_triage pending
        const nextStepId = await transitionWorkflowInstance(
          client,
          tenantId,
          instanceId,
          initialStepExecutionId,
          "submit",
          "system",
        );

        if (!nextStepId) {
          throw new Error("Transition failed to return next step execution ID");
        }

        // If emergency matched, immediately transition to officer review step
        let finalStepId = nextStepId;
        if (isEmergency) {
          finalStepId = await transitionWorkflowInstance(
            client,
            tenantId,
            instanceId,
            nextStepId,
            "ai_complete",
            "system",
            undefined,
            "Escalated immediately due to emergency keyword rules."
          ) || nextStepId;
        }

        // Create durable task record
        const taskId = `task-${crypto.randomUUID()}`;
        await client.query(
          `INSERT INTO task_execution (
             tenant_id, task_id, task_type, status, available_at, attempt_count, max_attempts
           ) VALUES ($1, $2, 'complaint_triage_job', 'pending', NOW(), 0, 5)`,
          [tenantId, taskId]
        );

        await client.query("COMMIT");

        // Dispatch background worker webhook
        const workerUrl = "http://localhost:8081/internal/tasks/complaint_triage_job";
        const taskEnvelope = {
          taskId,
          taskType: "complaint_triage_job",
          schemaVersion: 1,
          tenantId,
          correlationId: getContext()?.correlationId || crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          payload: {
            complaintId,
            workflowId: instanceId,
            workflowStepExecutionId: finalStepId,
          },
        };

        fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer local-development-bypass-token",
          },
          body: JSON.stringify(taskEnvelope),
        }).catch((err) => {
          logger.error({ err }, "Failed to dispatch complaint triage job task");
        });

        return reply.send({
          complaintId,
          referenceNumber,
          status: initialStatus,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );

  // POST /complaints/:id/triage: Officer review decision handler
  app.post(
    "/complaints/:id/triage",
    async (req, reply) => {
      const user = req.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      await checkAndAssertActiveTenant(pool, user.tenantId);

      if (!hasPermission(user.roles, "facility:review")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };

      const parseResult = OfficerTriageDecisionSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({ error: "Invalid officer triage input payload parameters" });
      }

      const decision = parseResult.data;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // CAS Check: Verify complaint status is officer_review or triage_pending
        const compRes = await client.query(
          "SELECT status, tenant_id FROM complaint WHERE id = $1 AND tenant_id = $2 FOR UPDATE",
          [id, user.tenantId]
        );
        if (compRes.rows.length === 0) {
          await client.query("ROLLBACK");
          return reply.status(404).send({ error: "Complaint not found" });
        }
        const complaint = compRes.rows[0];
        if (complaint.status !== "officer_review" && complaint.status !== "triage_pending") {
          await client.query("ROLLBACK");
          return reply.status(409).send({ error: "Complaint is not in officer review status" });
        }

        // Get latest unreviewed AI Triage review
        const reviewRes = await client.query(
          "SELECT id, workflow_instance_id, workflow_step_execution_id FROM complaint_triage_review WHERE tenant_id = $1 AND complaint_id = $2 AND triage_status = 'unreviewed' LIMIT 1",
          [user.tenantId, id]
        );

        let workflowInstanceId = "";
        let workflowStepExecutionId = "";
        let triageReviewId: string | null = null;

        if (reviewRes.rows.length > 0) {
          triageReviewId = reviewRes.rows[0].id;
          workflowInstanceId = reviewRes.rows[0].workflow_instance_id;
          workflowStepExecutionId = reviewRes.rows[0].workflow_step_execution_id;
        } else {
          // If emergency or AI failed, lookup active workflow step execution
          const wfStepRes = await client.query(
            `SELECT workflow_instance_id, id FROM workflow_step_execution
             WHERE tenant_id = $1 AND status = 'pending' AND workflow_instance_id = (
               SELECT id FROM workflow_instance WHERE tenant_id = $1 AND object_id = $2 LIMIT 1
             ) LIMIT 1`,
            [user.tenantId, id]
          );
          if (wfStepRes.rows.length > 0) {
            workflowInstanceId = wfStepRes.rows[0].workflow_instance_id;
            workflowStepExecutionId = wfStepRes.rows[0].id;
          }
        }

        let nextStatus = "assigned";
        let outcome = "assign";

        if (decision.decision === "reject_complaint") {
          nextStatus = "rejected";
          outcome = "reject";
        } else if (decision.decision === "mark_duplicate") {
          nextStatus = "merged";
          outcome = "reject";
          
          // Verify duplicate target belongs to same tenant
          const duplicateCheck = await client.query(
            "SELECT id FROM complaint WHERE tenant_id = $1 AND id = $2",
            [user.tenantId, decision.duplicateOfComplaintId]
          );
          if (duplicateCheck.rows.length === 0) {
            await client.query("ROLLBACK");
            return reply.status(400).send({ error: "Duplicate target complaint must belong to the same tenant" });
          }
        }

        // Update Complaint status
        await client.query(
          "UPDATE complaint SET status = $1, updated_at = NOW() WHERE id = $2",
          [nextStatus, id]
        );

        // Update Triage Review status if present
        if (triageReviewId) {
          await client.query(
            `UPDATE complaint_triage_review
             SET triage_status = $1, officer_user_id = $2, officer_notes = $3
             WHERE id = $4`,
            [
              decision.decision === "accept" ? "accepted" : decision.decision === "accept_with_changes" ? "accepted_with_changes" : "rejected",
              user.userId,
              decision.notes || null,
              triageReviewId,
            ]
          );
        }

        // Transition Workflow Step
        if (workflowStepExecutionId) {
          await transitionWorkflowInstance(
            client,
            user.tenantId,
            workflowInstanceId,
            workflowStepExecutionId,
            outcome,
            "user",
            user.userId,
            decision.notes || "Decision recorded by officer."
          );
        }

        // Create Assignment record if assigned
        if (decision.decision === "accept" || decision.decision === "accept_with_changes") {
          await client.query(
            `INSERT INTO complaint_assignment (
               tenant_id, complaint_id, assigned_department, assigning_officer_id, assignment_reason, triage_review_id
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              user.tenantId,
              id,
              decision.assignedDepartment,
              user.userId,
              decision.notes || null,
              triageReviewId,
            ]
          );
        }

        await client.query("COMMIT");
        return reply.send({ status: "success", nextStatus });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );

  // GET /complaints: List all complaints for the active tenant
  app.get(
    "/complaints",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:review")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const statusFilter = (req.query as any).status;

      let query = `
        SELECT id, reference_number as "referenceNumber", subject, location, category, status,
               is_emergency as "isEmergency", emergency_rule_codes as "emergencyRuleCodes", created_at as "createdAt"
        FROM complaint
        WHERE tenant_id = $1
      `;
      const params: any[] = [user.tenantId];

      if (statusFilter) {
        query += " AND status = $2";
        params.push(statusFilter);
      }

      query += " ORDER BY is_emergency DESC, created_at DESC";

      const res = await pool.query(query, params);
      return reply.send(res.rows);
    }
  );

  // GET /complaints/:id: Fetch a single complaint details (and decrypt contact data)
  app.get(
    "/complaints/:id",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:review")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };

      const compRes = await pool.query(
        `SELECT id, reference_number as "referenceNumber", citizen_name as "citizenName",
                subject, description, normalized_description as "normalizedDescription", location, category, status,
                is_emergency as "isEmergency", emergency_rule_codes as "emergencyRuleCodes", created_at as "createdAt"
         FROM complaint
         WHERE tenant_id = $1 AND id = $2`,
        [user.tenantId, id]
      );

      if (compRes.rows.length === 0) {
        return reply.status(404).send({ error: "Complaint not found" });
      }

      const complaint = compRes.rows[0];

      // Fetch contact details if available
      const contactRes = await pool.query(
        "SELECT ciphertext, nonce FROM complaint_contact WHERE tenant_id = $1 AND complaint_id = $2",
        [user.tenantId, id]
      );

      let citizenContact = null;
      if (contactRes.rows.length > 0) {
        try {
          const { ciphertext, nonce } = contactRes.rows[0];
          citizenContact = decryptContact(ciphertext, nonce);
        } catch (err) {
          logger.error({ err }, "Failed to decrypt contact details");
          citizenContact = "[Decryption Failed]";
        }
      }

      return reply.send({
        ...complaint,
        citizenContact,
      });
    }
  );

  // GET /complaints/:id/triage: Get latest AI triage review recommendation details
  app.get(
    "/complaints/:id/triage",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:review")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };

      const triageRes = await pool.query(
        `SELECT id, classified_category as "classifiedCategory", recommended_priority as "recommendedPriority",
                summary, extracted_location as "extractedLocation", alleged_incident_type as "allegedIncidentType",
                potential_hazards as "potentialHazards", recommended_department as "recommendedDepartment",
                duplicate_assessment as "duplicateAssessment", confidence_score as "confidenceScore",
                requires_immediate_human_attention as "requiresImmediateHumanAttention",
                attention_reasons as "attentionReasons", recommended_next_action as "recommendedNextAction",
                triage_status as "triageStatus", officer_notes as "officerNotes", created_at as "createdAt"
         FROM complaint_triage_review
         WHERE tenant_id = $1 AND complaint_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.tenantId, id]
      );

      if (triageRes.rows.length === 0) {
        return reply.status(404).send({ error: "AI triage review not found for this complaint" });
      }

      return reply.send(triageRes.rows[0]);
    }
  );

  done();
}
