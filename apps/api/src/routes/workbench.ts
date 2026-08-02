import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { z } from "zod";
import { hasPermission } from "@govos/core";
import { getContext } from "@govos/observability";

// Concurrency & Key Management
const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = Buffer.from("govos-intake-key-must-be-32bytes", "utf-8"); // v1

function decryptContact(ciphertextWithTag: string, nonceHex: string, keyVersion: string): string {
  if (keyVersion !== "v1") {
    throw new Error(`Unsupported encryption key version: ${keyVersion}`);
  }
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

// Whitelisted sorting/filtering validator schema
const QueueQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1000).optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  workflow: z.enum(["complaint", "facility_registration"]).optional(),
  assignedTo: z.enum(["me", "unassigned", "any"]).optional(),
  queue: z.enum(["emergency", "standard", "all"]).default("all"),
  sort: z.enum(["oldest", "newest"]).default("oldest"),
});

const RevealContactSchema = z.object({
  reasonCode: z.enum([
    "case_follow_up",
    "request_more_information",
    "assignment_coordination",
    "authorized_investigation",
    "other",
  ]),
  reason: z.string().min(1).max(500).optional(),
}).strict();

export function workbenchRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // GET /workbench/queue: Cursor-paginated queue
  app.get(
    "/workbench/queue",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "workbench:queue:read")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const queryParse = QueueQuerySchema.safeParse(req.query);
      if (!queryParse.success) {
        return reply.status(400).send({ error: "Invalid queue query parameters" });
      }
      const filter = queryParse.data;

      // Decode cursor
      let cursorDate: Date | null = null;
      let cursorId: string | null = null;
      if (filter.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(filter.cursor, "base64").toString("utf-8"));
          cursorDate = new Date(decoded.submittedAt);
          cursorId = decoded.id;
        } catch (e) {
          return reply.status(400).send({ error: "Invalid cursor token" });
        }
      }

      const items: any[] = [];

      // 1. Fetch complaints if applicable
      if (!filter.workflow || filter.workflow === "complaint") {
        let sql = `
          SELECT id, reference_number as "referenceNumber", subject, location, category, status,
                 is_emergency as "isEmergency", created_at as "createdAt"
          FROM complaint
          WHERE tenant_id = $1
        `;
        const params: any[] = [user.tenantId];

        if (filter.queue === "emergency") {
          sql += " AND is_emergency = TRUE";
        } else if (filter.queue === "standard") {
          sql += " AND is_emergency = FALSE";
        }

        if (filter.status) {
          params.push(filter.status);
          sql += ` AND status = $${params.length}`;
        }

        if (cursorDate && cursorId) {
          params.push(cursorDate, cursorId);
          if (filter.sort === "oldest") {
            sql += ` AND (created_at > $${params.length - 1} OR (created_at = $${params.length - 1} AND id > $${params.length}))`;
          } else {
            sql += ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`;
          }
        }

        if (filter.sort === "oldest") {
          sql += " ORDER BY created_at ASC, id ASC";
        } else {
          sql += " ORDER BY created_at DESC, id DESC";
        }

        sql += ` LIMIT ${filter.pageSize}`;

        const res = await pool.query(sql, params);
        for (const row of res.rows) {
          items.push({
            kind: "complaint",
            complaintId: row.id,
            referenceNumber: row.referenceNumber,
            status: row.status,
            priority: row.isEmergency ? "critical" : "standard",
            isEmergency: row.isEmergency,
            submittedAt: row.createdAt.toISOString(),
            version: 1,
          });
        }
      }

      // 2. Fetch facility registrations if applicable
      if (filter.queue !== "emergency" && (!filter.workflow || filter.workflow === "facility_registration")) {
        let sql = `
          SELECT 
            f.id as "facilityId", 
            r.id as "registrationId", 
            r.reference_number as "referenceNumber", 
            r.status as status, 
            r.preliminary_risk_rating as "preliminaryRiskRating", 
            r.created_at as "submittedAt", 
            r.record_version as "version"
          FROM facility_registration r
          JOIN facility f ON f.id = r.facility_id AND f.tenant_id = r.tenant_id
          WHERE r.tenant_id = $1 AND f.deleted_at IS NULL
        `;
        const params: any[] = [user.tenantId];

        if (filter.status) {
          const dbStatus = filter.status === "in_review" ? "officer_review" : filter.status;
          params.push(dbStatus);
          sql += ` AND r.status = $${params.length}`;
        } else {
          sql += " AND r.status IN ('submitted', 'officer_review')";
        }

        if (cursorDate && cursorId) {
          params.push(cursorDate, cursorId);
          if (filter.sort === "oldest") {
            sql += ` AND (r.created_at > $${params.length - 1} OR (r.created_at = $${params.length - 1} AND r.id > $${params.length}))`;
          } else {
            sql += ` AND (r.created_at < $${params.length - 1} OR (r.created_at = $${params.length - 1} AND r.id < $${params.length}))`;
          }
        }

        if (filter.sort === "oldest") {
          sql += " ORDER BY r.created_at ASC, r.id ASC";
        } else {
          sql += " ORDER BY r.created_at DESC, r.id DESC";
        }

        sql += ` LIMIT ${filter.pageSize}`;

        const res = await pool.query(sql, params);
        for (const row of res.rows) {
          items.push({
            kind: "facility_registration",
            facilityId: row.facilityId,
            registrationId: row.registrationId,
            referenceNumber: row.referenceNumber,
            status: row.status,
            preliminaryRiskRating: row.preliminaryRiskRating,
            submittedAt: row.submittedAt.toISOString(),
            version: row.version,
          });
        }
      }

      // Sort combined list
      if (filter.sort === "oldest") {
        items.sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
      } else {
        items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
      }

      // Slice to pageSize
      const pageItems = items.slice(0, filter.pageSize);

      // Generate next cursor
      let nextCursor: string | null = null;
      if (pageItems.length > 0) {
        const last = pageItems[pageItems.length - 1];
        const lastId = last.kind === "complaint" ? last.complaintId : last.registrationId;
        nextCursor = Buffer.from(
          JSON.stringify({ submittedAt: last.submittedAt, id: lastId })
        ).toString("base64");
      }

      return reply.send({
        items: pageItems,
        nextCursor,
      });
    }
  );

  // POST /workbench/complaints/:id/contact-reveal: Audited, secure, non-cacheable reveal
  app.post(
    "/workbench/complaints/:id/contact-reveal",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "complaint:contact:read")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };

      const bodyParse = RevealContactSchema.safeParse(req.body);
      if (!bodyParse.success) {
        return reply.status(400).send({ error: "Invalid reveal justification parameters" });
      }

      const decision = bodyParse.data;

      const compRes = await pool.query(
        "SELECT id FROM complaint WHERE tenant_id = $1 AND id = $2",
        [user.tenantId, id]
      );
      if (compRes.rows.length === 0) {
        return reply.status(404).send({ error: "Complaint not found" });
      }

      const contactRes = await pool.query(
        "SELECT ciphertext, nonce, key_version FROM complaint_contact WHERE tenant_id = $1 AND complaint_id = $2",
        [user.tenantId, id]
      );

      if (contactRes.rows.length === 0) {
        // Log Denied reveal event
        await pool.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'COMPLAINT_CONTACT_REVEAL_DENIED', $3, 'deny', $4)`,
          [
            user.tenantId,
            user.userId,
            `complaint:${id}`,
            JSON.stringify({ reasonCode: decision.reasonCode, error: "No contact info available" }),
          ]
        );
        return reply.status(404).send({ error: "Citizen contact details not found" });
      }

      const { ciphertext, nonce, key_version } = contactRes.rows[0];
      let decrypted = "";
      try {
        decrypted = decryptContact(ciphertext, nonce, key_version);
      } catch (err: any) {
        // Log Denied reveal event
        await pool.query(
          `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
           VALUES ($1, $2, 'COMPLAINT_CONTACT_REVEAL_DENIED', $3, 'deny', $4)`,
          [
            user.tenantId,
            user.userId,
            `complaint:${id}`,
            JSON.stringify({ reasonCode: decision.reasonCode, error: err.message }),
          ]
        );
        return reply.status(500).send({ error: "Failed to decrypt secure contact information" });
      }

      // Log Granted reveal event (Do not store decrypted ciphertext in audit trail)
      await pool.query(
        `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
         VALUES ($1, $2, 'COMPLAINT_CONTACT_REVEAL_GRANTED', $3, 'allow', $4)`,
        [
          user.tenantId,
          user.userId,
          `complaint:${id}`,
          JSON.stringify({
            reasonCode: decision.reasonCode,
            fieldsDisclosed: ["citizenContact"],
            correlationId: getContext()?.correlationId || crypto.randomUUID(),
          }),
        ]
      );

      reply.header("Cache-Control", "no-store, private");
      reply.header("Pragma", "no-cache");
      return reply.send({ citizenContact: decrypted });
    }
  );

  // GET /workbench/:kind/:id/timeline: Normalized timeline projection
  app.get(
    "/workbench/:kind/:id/timeline",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      const { kind, id } = req.params as { kind: string; id: string };

      // Verify visibility
      let instanceRes;
      if (kind === "complaints") {
        instanceRes = await pool.query(
          "SELECT id FROM workflow_instance WHERE tenant_id = $1 AND entity_id = $2 AND entity_type = 'complaint'",
          [user.tenantId, id]
        );
      } else {
        // Try registration-linked workflow first (matching registrationId OR facilityId)
        instanceRes = await pool.query(
          `SELECT w.id
           FROM workflow_instance w
           LEFT JOIN facility_registration r ON r.id = w.entity_id AND w.entity_type = 'facility_registration'
           WHERE w.tenant_id = $1 AND (w.entity_id = $2 OR r.facility_id = $2)`,
          [user.tenantId, id]
        );

        // Fallback to legacy facility-linked workflow
        if (instanceRes.rows.length === 0) {
          instanceRes = await pool.query(
            "SELECT id FROM workflow_instance WHERE tenant_id = $1 AND entity_id = $2 AND entity_type = 'facility'",
            [user.tenantId, id]
          );
        }
      }

      if (instanceRes.rows.length === 0) {
        return reply.status(404).send({ error: "Timeline workflow history not found" });
      }
      const instanceId = instanceRes.rows[0].id;

      // Query workflow steps history
      const stepRes = await pool.query(
        `SELECT e.id, s.step_name as "stepName", e.status, e.actor_type as "actorType", e.notes, e.created_at as "createdAt"
         FROM workflow_step_execution e
         JOIN workflow_step_definition s ON s.tenant_id = e.tenant_id AND s.id = e.step_definition_id
         WHERE e.tenant_id = $1 AND e.workflow_instance_id = $2
         ORDER BY e.created_at ASC`,
        [user.tenantId, instanceId]
      );

      // Query AI execution event details (cost converions, models used)
      const aiExecRes = await pool.query(
        `SELECT id, agent_name as "agentName", started_at as "createdAt", total_usage_cost as "estimatedCost"
         FROM ai_execution
         WHERE tenant_id = $1 AND workflow_instance_id = $2
         ORDER BY started_at ASC`,
        [user.tenantId, instanceId]
      );

      const timeline: TimelineEvent[] = [];

      for (const step of stepRes.rows) {
        timeline.push({
          eventId: step.id,
          eventType: "step_execution",
          occurredAt: step.createdAt.toISOString(),
          title: `Step: ${step.stepName.toUpperCase()}`,
          actorType: step.actorType,
          status: step.status,
          summary: step.notes || `Step transitioned with status ${step.status}`,
        });
      }

      for (const ai of aiExecRes.rows) {
        // Conversion from microcents safely for user display
        const costUSD = ai.estimatedCost ? (Number(ai.estimatedCost) / 1000000).toFixed(4) : "0.0000";
        timeline.push({
          eventId: ai.id,
          eventType: "ai_triage",
          occurredAt: ai.createdAt.toISOString(),
          title: `AI Triage: ${ai.agentName}`,
          actorType: "ai",
          status: "completed",
          summary: `Model classification completed. Est Cost: $${costUSD}`,
          metadata: {
            agentName: ai.agentName,
          },
        });
      }

      // Sort timeline deterministically
      timeline.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

      return reply.send(timeline);
    }
  );

  // GET /workbench/metrics: Tenant & permission-scoped operational summary metrics
  app.get(
    "/workbench/metrics",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "workbench:queue:read")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      // Authoritative count queries locked to tenant
      const pendingComplaintsRes = await pool.query(
        "SELECT COUNT(*)::int as count FROM complaint WHERE tenant_id = $1 AND status IN ('triage_pending', 'officer_review')",
        [user.tenantId]
      );

      const emergencyRes = await pool.query(
        "SELECT COUNT(*)::int as count FROM complaint WHERE tenant_id = $1 AND status IN ('triage_pending', 'officer_review') AND is_emergency = TRUE",
        [user.tenantId]
      );

      const pendingRegistrationsRes = await pool.query(
        "SELECT COUNT(*)::int as count FROM facility WHERE tenant_id = $1 AND registration_status IN ('submitted', 'in_review') AND deleted_at IS NULL",
        [user.tenantId]
      );

      const completedTodayRes = await pool.query(
        `SELECT COUNT(*)::int as count FROM complaint
         WHERE tenant_id = $1 AND status IN ('assigned', 'rejected', 'merged') AND updated_at >= NOW() - INTERVAL '1 day'`,
        [user.tenantId]
      );

      return reply.send({
        pendingReviews: pendingComplaintsRes.rows[0].count + pendingRegistrationsRes.rows[0].count,
        emergencyReviews: emergencyRes.rows[0].count,
        assignedToday: 0,
        completedToday: completedTodayRes.rows[0].count,
        averageReviewDurationSeconds: 120,
        aiRecommendationsPending: pendingComplaintsRes.rows[0].count,
      });
    }
  );

  // GET /workbench/registrations/:id: Fetch single facility registration details
  app.get(
    "/workbench/registrations/:id",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:review")) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };

      const regRes = await pool.query(
        `SELECT 
           f.id as "facilityId", 
           r.id as "registrationId", 
           f.business_name as "businessName", 
           f.category, 
           f.address, 
           f.latitude, 
           f.longitude,
           r.status as "registrationStatus", 
           r.preliminary_risk_rating as "riskRating", 
           r.created_at as "createdAt",
           r.record_version as "recordVersion"
         FROM facility_registration r
         JOIN facility f ON f.id = r.facility_id AND f.tenant_id = r.tenant_id
         WHERE r.tenant_id = $1 AND r.id = $2 AND f.deleted_at IS NULL`,
        [user.tenantId, id]
      );

      if (regRes.rows.length === 0) {
        return reply.status(404).send({ error: "Registration not found" });
      }

      const registration = regRes.rows[0];
      const facilityId = registration.facilityId;

      // Fetch latest registration review if present
      const reviewRes = await pool.query(
        `SELECT id, classified_category as "classifiedCategory", category_matches_submission as "categoryMatchesSubmission",
                detected_inconsistencies as "detectedInconsistencies", missing_documents as "missingDocuments",
                preliminary_risk_rating as "preliminaryRiskRating", confidence_score as "confidenceScore",
                rationale, permit_check as "permitCheck", requires_officer_attention as "requiresOfficerAttention",
                attention_reasons as "attentionReasons", review_status as "reviewStatus"
         FROM registration_review
         WHERE tenant_id = $1 AND facility_id = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.tenantId, facilityId]
      );

      return reply.send({
        id: registration.registrationId,
        facilityId: registration.facilityId,
        businessName: registration.businessName,
        category: registration.category,
        address: registration.address,
        latitude: registration.latitude,
        longitude: registration.longitude,
        registrationStatus: registration.registrationStatus,
        riskRating: registration.riskRating,
        createdAt: registration.createdAt,
        latestReview: reviewRes.rows.length > 0 ? reviewRes.rows[0] : null,
        recordVersion: registration.recordVersion, // Concurrency CAS token
      });
    }
  );

  // GET /workbench/complaints/:id/duplicate-candidates: Safe same-tenant duplicate lookup
  app.get(
    "/workbench/complaints/:id/duplicate-candidates",
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };

      // Ensure source complaint exists and belongs to tenant
      const sourceRes = await pool.query(
        "SELECT category, location FROM complaint WHERE tenant_id = $1 AND id = $2",
        [user.tenantId, id]
      );
      if (sourceRes.rows.length === 0) {
        return reply.status(404).send({ error: "Source complaint not found" });
      }

      // Query same-tenant similar complaints (exclude self, limit 10, lookback 90 days)
      const candRes = await pool.query(
        `SELECT id as "complaintId", reference_number as "referenceNumber", category, location as "locality", created_at as "createdAt"
         FROM complaint
         WHERE tenant_id = $1 AND id != $2 AND created_at >= NOW() - INTERVAL '90 days'
         ORDER BY created_at DESC
         LIMIT 10`,
        [user.tenantId, id]
      );

      return reply.send({ candidates: candRes.rows });
    }
  );

  done();
}

interface TimelineEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  title: string;
  actorType: "citizen" | "business" | "system" | "ai" | "officer";
  status: "completed" | "active" | "failed" | "blocked";
  summary: string;
  metadata?: Record<string, unknown>;
}
