import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { hasPermission, createWorkflowInstance, transitionWorkflowInstance, checkAndAssertActiveTenant } from "@govos/core";
import { isValidFacilityCategory, getEnvironmentalRisk, normalizeCategory } from "@govos/ecogov";
import { getContext, logger } from "@govos/observability";

export function facilityRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // Query Facilities
  app.get(
    "/facilities",
    {
      schema: {
        response: {
          200: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tenantId: { type: "string" },
                organizationId: { type: "string" },
                ownerUserId: { type: "string", nullable: true },
                businessName: { type: "string" },
                category: { type: "string" },
                address: { type: "string" },
                latitude: { type: "number" },
                longitude: { type: "number" },
                registrationStatus: { type: "string" },
                riskRating: { type: "string" },
                createdAt: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:read")) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const query = `
      SELECT id, tenant_id as "tenantId", organization_id as "organizationId", owner_user_id as "ownerUserId",
             business_name as "businessName", category, address,
             latitude::float, longitude::float, registration_status as "registrationStatus",
             risk_rating as "riskRating", created_at as "createdAt"
      FROM facility
      WHERE tenant_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
      const result = await pool.query(query, [user.tenantId]);
      return reply.send(result.rows);
    },
  );

  // Get Facility by ID
  app.get(
    "/facilities/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            properties: {
              id: { type: "string" },
              tenantId: { type: "string" },
              organizationId: { type: "string" },
              ownerUserId: { type: "string", nullable: true },
              businessName: { type: "string" },
              category: { type: "string" },
              address: { type: "string" },
              latitude: { type: "number" },
              longitude: { type: "number" },
              registrationStatus: { type: "string" },
              riskRating: { type: "string" },
              createdAt: { type: "string" },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:read")) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const { id } = req.params as { id: string };
      const query = `
      SELECT id, tenant_id as "tenantId", organization_id as "organizationId", owner_user_id as "ownerUserId",
             business_name as "businessName", category, address,
             latitude::float, longitude::float, registration_status as "registrationStatus",
             risk_rating as "riskRating", created_at as "createdAt"
      FROM facility
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
    `;
      const result = await pool.query(query, [user.tenantId, id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: "Facility not found" });
      }
      return reply.send(result.rows[0]);
    },
  );

  // Create Facility
  app.post(
    "/facilities",
    {
      schema: {
        body: {
          type: "object",
          required: [
            "organizationId",
            "businessName",
            "category",
            "address",
            "latitude",
            "longitude",
          ],
          properties: {
            organizationId: { type: "string", format: "uuid" },
            businessName: { type: "string", minLength: 2 },
            category: { type: "string" },
            address: { type: "string" },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              id: { type: "string" },
              businessName: { type: "string" },
              category: { type: "string" },
              registrationStatus: { type: "string" },
              riskRating: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      await checkAndAssertActiveTenant(pool, user.tenantId);

      if (!hasPermission(user.roles, "facility:write")) {
        return reply
          .status(403)
          .send({ error: "Forbidden: Insufficient permissions" });
      }

      const {
        organizationId,
        businessName,
        category,
        address,
        latitude,
        longitude,
      } = req.body as {
        organizationId: string;
        businessName: string;
        category: string;
        address: string;
        latitude: number;
        longitude: number;
      };

      if (!isValidFacilityCategory(category)) {
        return reply.status(400).send({
          error: `Invalid category: ${category}. Permitted values: Car Wash, Hotel, Guest House, Restaurant, Hospital, Clinic, Pharmacy.`,
        });
      }

      // Determine environmental risk automatically
      const riskRating = getEnvironmentalRisk(category);

      const query = `
      INSERT INTO facility (tenant_id, organization_id, owner_user_id, business_name, category, address, latitude, longitude, risk_rating, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, business_name as "businessName", category, registration_status as "registrationStatus", risk_rating as "riskRating"
    `;

      const result = await pool.query(query, [
        user.tenantId,
        organizationId,
        user.userId, // owner is the creator initially
        businessName,
        category,
        address,
        latitude,
        longitude,
        riskRating,
        user.userId,
      ]);

      return reply.status(201).send(result.rows[0]);
    },
  );

  // Register Facility and spawn workflow & task
  app.post(
    "/facilities/register",
    {
      schema: {
        body: {
          type: "object",
          required: [
            "organizationId",
            "businessName",
            "category",
            "address",
            "latitude",
            "longitude",
            "town",
            "lga",
            "contactPerson",
            "clientSubmissionId",
          ],
          properties: {
            organizationId: { type: "string", format: "uuid" },
            businessName: { type: "string", minLength: 2, maxLength: 255 },
            category: { type: "string" },
            address: { type: "string", minLength: 5, maxLength: 1000 },
            latitude: { type: "number", minimum: -90, maximum: 90 },
            longitude: { type: "number", minimum: -180, maximum: 180 },
            description: { type: "string", maxLength: 2000 },
            town: { type: "string", minLength: 2, maxLength: 100 },
            lga: { type: "string", minLength: 2, maxLength: 100 },
            contactPerson: { type: "string", minLength: 2, maxLength: 255 },
            contactEmail: { type: "string", maxLength: 255 },
            contactPhone: { type: "string", maxLength: 100 },
            permitNumber: { type: "string", maxLength: 100 },
            registrationNotes: { type: "string", maxLength: 2000 },
            clientSubmissionId: { type: "string", minLength: 5, maxLength: 255 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      await checkAndAssertActiveTenant(pool, user.tenantId);

      if (
        !hasPermission(user.roles, "facility:register") &&
        !hasPermission(user.roles, "facility:write") &&
        !user.roles.includes("super_admin")
      ) {
        return reply.status(403).send({ error: "Forbidden: Insufficient permissions" });
      }

      const body = req.body as {
        organizationId: string;
        businessName: string;
        category: string;
        address: string;
        latitude: number;
        longitude: number;
        description?: string;
        town: string;
        lga: string;
        contactPerson: string;
        contactEmail?: string;
        contactPhone?: string;
        permitNumber?: string;
        registrationNotes?: string;
        clientSubmissionId: string;
      };

      const normalizedEmail = body.contactEmail?.trim().toLowerCase() || null;
      const normalizedPhone = body.contactPhone?.trim() || null;

      if (!normalizedEmail && !normalizedPhone) {
        return reply.status(400).send({ error: "Either contact email or contact phone must be provided." });
      }

      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return reply.status(400).send({ error: "Invalid contact email format" });
      }

      if (normalizedPhone && !/^\+?[0-9\s\-()]{7,20}$/.test(normalizedPhone)) {
        return reply.status(400).send({ error: "Invalid contact phone format" });
      }

      if (!isValidFacilityCategory(body.category)) {
        return reply.status(400).send({ error: `Invalid category: ${body.category}` });
      }

      const canonicalCategory = normalizeCategory(body.category);
      const riskRating = getEnvironmentalRisk(canonicalCategory);

      // Check request idempotency first
      const checkDup = await pool.query(
        `SELECT r.facility_id as "facilityId", r.id as "registrationId", r.reference_number as "referenceNumber", r.status,
                w.id as "workflowInstanceId"
         FROM facility_registration r
         LEFT JOIN workflow_instance w ON w.tenant_id = r.tenant_id AND w.entity_id = r.facility_id AND w.entity_type = 'facility'
         WHERE r.tenant_id = $1 AND r.client_submission_id = $2
         LIMIT 1`,
        [user.tenantId, body.clientSubmissionId]
      );

      if (checkDup.rows.length > 0) {
        const row = checkDup.rows[0];
        return reply.status(200).send({
          facilityId: row.facilityId,
          registrationId: row.registrationId,
          workflowInstanceId: row.workflowInstanceId,
          referenceNumber: row.referenceNumber,
          status: row.status,
          preliminaryRiskRating: null
        });
      }

      let facilityId = "";
      let registrationId = "";
      let referenceNumber = "";
      let workflowInstanceId = "";

      const maxRetries = 5;
      let attempt = 0;
      let success = false;

      while (attempt < maxRetries && !success) {
        attempt++;
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          // Generate reference number: ASMOE-FAC-YYYY-XXXXXXXX
          const year = new Date().getUTCFullYear();
          const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
          referenceNumber = `ASMOE-FAC-${year}-${rand}`;

          // Create facility
          const facId = crypto.randomUUID();
          const facQuery = `
            INSERT INTO facility (
              id, tenant_id, organization_id, owner_user_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted', $10, $11)
          `;
          await client.query(facQuery, [
            facId,
            user.tenantId,
            body.organizationId,
            user.userId,
            body.businessName.trim(),
            canonicalCategory,
            body.address.trim(),
            body.latitude,
            body.longitude,
            riskRating,
            user.userId,
          ]);

          facilityId = facId;

          // Create facility_registration
          const regId = crypto.randomUUID();
          const regQuery = `
            INSERT INTO facility_registration (
              id, tenant_id, facility_id, reference_number, client_submission_id, status, submitted_by,
              description, town, lga, contact_person, contact_email, contact_phone, permit_number, registration_notes,
              preliminary_risk_rating, record_version
            ) VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1)
          `;
          await client.query(regQuery, [
            regId,
            user.tenantId,
            facId,
            referenceNumber,
            body.clientSubmissionId,
            user.userId,
            body.description?.trim() || null,
            body.town.trim(),
            body.lga.trim(),
            body.contactPerson.trim(),
            normalizedEmail,
            normalizedPhone,
            body.permitNumber?.trim() || null,
            body.registrationNotes?.trim() || null,
            riskRating,
          ]);

          registrationId = regId;

          // Spawn workflow instance
          const { instanceId, initialStepExecutionId } = await createWorkflowInstance(
            client,
            user.tenantId,
            "facility_registration",
            "facility_registration",
            regId,
          );

          workflowInstanceId = instanceId;

          // Transition workflow
          const nextStepId = await transitionWorkflowInstance(
            client,
            user.tenantId,
            instanceId,
            initialStepExecutionId,
            "submit",
            "system",
          );

          // Create durable task record
          const taskId = `task-${crypto.randomUUID()}`;
          const idempotencyKey = `ai-registration-review:${user.tenantId}:${regId}`;
          const payloadHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex");
          await client.query(
            `INSERT INTO task_execution (
               tenant_id, task_id, task_type, payload_hash, status, available_at, attempt_count, max_attempts
             ) VALUES ($1, $2, 'ai_registration_review', $3, 'pending', NOW(), 0, 5)`,
            [user.tenantId, taskId, payloadHash]
          );

          // Write audit log
          await client.query(
            `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
             VALUES ($1, $2, 'FACILITY_REGISTRATION_SUBMITTED', $3, 'allow', $4)`,
            [
              user.tenantId,
              user.userId,
              `facility:${facId}`,
              JSON.stringify({
                registrationId: regId,
                facilityId: facId,
                referenceNumber,
                category: canonicalCategory,
                actorId: user.userId,
                workflowInstanceId: instanceId,
                clientSubmissionId: crypto.createHash('sha256').update(body.clientSubmissionId).digest('hex')
              }),
            ]
          );

          await client.query("COMMIT");
          success = true;

          // Dispatch worker task outside transaction
          const workerUrl = `http://localhost:8081/internal/tasks/ai_registration_review`;
          const taskEnvelope = {
            taskId,
            taskType: "ai_registration_review",
            schemaVersion: 1,
            tenantId: user.tenantId,
            correlationId: getContext()?.correlationId || crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            payload: {
              facilityId: facId,
              workflowId: instanceId,
              workflowStepExecutionId: nextStepId,
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
            logger.warn({ err }, "Failed to dispatch worker webhook acceleration, task will be run by standard consumer flow");
          });

        } catch (err: any) {
          await client.query("ROLLBACK");
          const isUniqueViolation = err.code === "23505";
          const isRefViolation = err.detail && err.detail.includes("reference_number");
          const isSubIdViolation = err.detail && err.detail.includes("client_submission_id");

          if (isUniqueViolation && isSubIdViolation) {
            const existingRes = await pool.query(
              `SELECT r.facility_id as "facilityId", r.id as "registrationId", r.reference_number as "referenceNumber", r.status,
                      w.id as "workflowInstanceId"
               FROM facility_registration r
               LEFT JOIN workflow_instance w ON w.tenant_id = r.tenant_id AND w.entity_id = r.facility_id AND w.entity_type = 'facility'
               WHERE r.tenant_id = $1 AND r.client_submission_id = $2
               LIMIT 1`,
              [user.tenantId, body.clientSubmissionId]
            );
            if (existingRes.rows.length > 0) {
              const row = existingRes.rows[0];
              return reply.status(200).send({
                facilityId: row.facilityId,
                registrationId: row.registrationId,
                workflowInstanceId: row.workflowInstanceId,
                referenceNumber: row.referenceNumber,
                status: row.status,
                preliminaryRiskRating: null
              });
            }
            throw err;
          }

          if (isUniqueViolation && isRefViolation) {
            logger.warn({ referenceNumber }, "Reference number collision detected, retrying...");
          } else {
            throw err;
          }
        } finally {
          client.release();
        }
      }

      if (!success) {
        return reply.status(500).send({ error: "Failed to generate a unique reference number" });
      }

      return reply.status(201).send({
        facilityId,
        registrationId,
        workflowInstanceId,
        referenceNumber,
        status: "submitted",
        preliminaryRiskRating: null
      });
    }
  );

  done();
}
