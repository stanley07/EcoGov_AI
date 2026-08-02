import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { hasPermission, createWorkflowInstance, transitionWorkflowInstance, checkAndAssertActiveTenant, FacilityDuplicateDetectionService } from "@govos/core";
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
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            offset: { type: "integer", minimum: 0, default: 0 },
            sortBy: { type: "string", enum: ["businessName", "category", "riskRating", "status", "createdAt"], default: "createdAt" },
            sortOrder: { type: "string", enum: ["asc", "desc"], default: "desc" },
            status: { type: "string", enum: ["draft", "submitted", "in_review", "action_required", "approved", "rejected"] },
            riskRating: { type: "string", enum: ["low", "medium", "high", "unknown"] },
            search: { type: "string", maxLength: 100 }
          }
        },
        response: {
          200: {
            type: "object",
            properties: {
              items: {
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
                    registrationSource: { type: "string" },
                    createdAt: { type: "string" },
                    registrationId: { type: "string", nullable: true },
                    primaryImageUrl: { type: "string", nullable: true },
                  },
                },
              },
              pagination: {
                type: "object",
                properties: {
                  total: { type: "integer" },
                  limit: { type: "integer" },
                  offset: { type: "integer" },
                  hasNext: { type: "boolean" },
                  hasPrevious: { type: "boolean" },
                },
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

      await checkAndAssertActiveTenant(pool, user.tenantId);

      const q = req.query as {
        limit?: number;
        offset?: number;
        sortBy?: string;
        sortOrder?: string;
        status?: string;
        riskRating?: string;
        search?: string;
      };

      const limit = q.limit !== undefined ? Number(q.limit) : 25;
      const offset = q.offset !== undefined ? Number(q.offset) : 0;
      const sortBy = q.sortBy || "createdAt";
      const sortOrderRaw = q.sortOrder || "desc";

      if (isNaN(limit) || limit < 1 || limit > 100) {
        return reply.status(400).send({ error: "Invalid limit. Must be between 1 and 100." });
      }
      if (isNaN(offset) || offset < 0) {
        return reply.status(400).send({ error: "Invalid offset. Must be >= 0." });
      }
      if (!["asc", "desc"].includes(sortOrderRaw.toLowerCase())) {
        return reply.status(400).send({ error: "Invalid sortOrder. Must be asc or desc." });
      }
      const allowedSortFields = ["businessName", "category", "riskRating", "status", "createdAt"];
      if (!allowedSortFields.includes(sortBy)) {
        return reply.status(400).send({ error: `Invalid sortBy field: ${sortBy}` });
      }

      const sortOrder = sortOrderRaw.toLowerCase() === "asc" ? "ASC" : "DESC";
      const status = q.status;
      const riskRating = q.riskRating;
      const search = q.search;

      const values: any[] = [user.tenantId];
      let query = `
        SELECT f.id, f.tenant_id as "tenantId", f.organization_id as "organizationId", f.owner_user_id as "ownerUserId",
               f.business_name as "businessName", f.category, f.address,
               f.latitude::float, f.longitude::float, f.registration_status as "registrationStatus",
               f.risk_rating as "riskRating", f.registration_source as "registrationSource", f.created_at as "createdAt",
               r.id as "registrationId",
               (
                 SELECT fd.storage_path
                 FROM facility_document fd
                 WHERE fd.tenant_id = f.tenant_id
                   AND fd.facility_id = f.id
                   AND fd.deleted_at IS NULL
                   AND fd.mime_type LIKE 'image/%'
                 ORDER BY fd.created_at DESC
                 LIMIT 1
               ) as "primaryImageUrl"
        FROM facility f
        LEFT JOIN facility_registration r ON r.tenant_id = f.tenant_id AND r.facility_id = f.id
        WHERE f.tenant_id = $1 AND f.deleted_at IS NULL
      `;

      if (status) {
        values.push(status);
        query += ` AND f.registration_status = $${values.length}`;
      }

      if (riskRating) {
        values.push(riskRating);
        query += ` AND f.risk_rating = $${values.length}`;
      }

      if (search) {
        // Escape wildcards: %, _, \
        const escapedSearch = search.trim().replace(/[\\%_]/g, "\\$&");
        values.push(`%${escapedSearch}%`);
        query += ` AND (f.business_name ILIKE $${values.length} OR f.address ILIKE $${values.length} OR r.town ILIKE $${values.length} OR r.lga ILIKE $${values.length})`;
      }

      // Whitelisted Sort mapping
      const sortColumns = {
        businessName: "f.business_name",
        category: "f.category",
        riskRating: "f.risk_rating",
        status: "f.registration_status",
        createdAt: "f.created_at",
      } as const;
      const orderCol = sortColumns[sortBy as keyof typeof sortColumns] || "f.created_at";
      query += ` ORDER BY ${orderCol} ${sortOrder}`;

      // Build count query dynamically to match parameters exactly
      let countQuery = `
        SELECT COUNT(DISTINCT f.id)::int as total
        FROM facility f
        LEFT JOIN facility_registration r ON r.tenant_id = f.tenant_id AND r.facility_id = f.id
        WHERE f.tenant_id = $1 AND f.deleted_at IS NULL
      `;
      const countValues: any[] = [user.tenantId];
      if (status) {
        countValues.push(status);
        countQuery += ` AND f.registration_status = $${countValues.length}`;
      }
      if (riskRating) {
        countValues.push(riskRating);
        countQuery += ` AND f.risk_rating = $${countValues.length}`;
      }
      if (search) {
        const escapedSearch = search.trim().replace(/[\\%_]/g, "\\$&");
        countValues.push(`%${escapedSearch}%`);
        countQuery += ` AND (f.business_name ILIKE $${countValues.length} OR f.address ILIKE $${countValues.length} OR r.town ILIKE $${countValues.length} OR r.lga ILIKE $${countValues.length})`;
      }

      const countResult = await pool.query(countQuery, countValues);
      const total = countResult.rows[0]?.total || 0;

      // Add pagination params
      values.push(limit);
      query += ` LIMIT $${values.length}`;
      values.push(offset);
      query += ` OFFSET $${values.length}`;

      const result = await pool.query(query, values);
      const hasNext = offset + limit < total;
      const hasPrevious = offset > 0;

      reply.header("X-Total-Count", total.toString());
      reply.header("X-Limit", limit.toString());
      reply.header("X-Offset", offset.toString());

      return reply.send({
        items: result.rows,
        pagination: {
          total,
          limit,
          offset,
          hasNext,
          hasPrevious,
        },
      });
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
              registrationId: { type: "string", nullable: true },
              registrationSource: { type: "string", nullable: true },
              registeredByUserId: { type: "string", nullable: true },
              registeredBySubcontractorId: { type: "string", nullable: true },
              contactPerson: { type: "string", nullable: true },
              contactEmail: { type: "string", nullable: true },
              contactPhone: { type: "string", nullable: true },
              town: { type: "string", nullable: true },
              lga: { type: "string", nullable: true },
              primaryImageUrl: { type: "string", nullable: true },
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
      SELECT f.id, f.tenant_id as "tenantId", f.organization_id as "organizationId", f.owner_user_id as "ownerUserId",
             f.business_name as "businessName", f.category, f.address,
             f.latitude::float, f.longitude::float, f.registration_status as "registrationStatus",
             f.risk_rating as "riskRating", f.created_at as "createdAt",
             f.registration_source as "registrationSource",
             f.registered_by_user_id as "registeredByUserId",
             f.registered_by_subcontractor_id as "registeredBySubcontractorId",
             r.id as "registrationId",
             r.contact_person as "contactPerson", r.contact_email as "contactEmail", r.contact_phone as "contactPhone",
             r.town, r.lga,
             (
               SELECT fd.storage_path
               FROM facility_document fd
               WHERE fd.tenant_id = f.tenant_id
                 AND fd.facility_id = f.id
                 AND fd.deleted_at IS NULL
                 AND fd.mime_type LIKE 'image/%'
               ORDER BY fd.created_at DESC
               LIMIT 1
             ) as "primaryImageUrl"
      FROM facility f
      LEFT JOIN facility_registration r ON r.tenant_id = f.tenant_id AND r.facility_id = f.id
      WHERE f.tenant_id = $1 AND f.id = $2 AND f.deleted_at IS NULL
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
      INSERT INTO facility (
        tenant_id, organization_id, owner_user_id, business_name, category, address, latitude, longitude, risk_rating, created_by,
        registration_source, registered_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'officer', $10)
      RETURNING id, business_name as "businessName", category, registration_status as "registrationStatus", risk_rating as "riskRating", registration_source as "registrationSource"
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
            overrideReason: { type: "string", maxLength: 1000 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      await checkAndAssertActiveTenant(pool, user.tenantId);

      logger.info({ roles: user.roles, hasRegister: hasPermission(user.roles, "facility:register"), hasWrite: hasPermission(user.roles, "facility:write") }, "Registration permission check details");

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

      // Business duplicate detection
      const dupService = new FacilityDuplicateDetectionService(pool);
      const dupCheck = await dupService.checkDuplicate({
        tenantId: user.tenantId,
        businessName: body.businessName,
        address: body.address,
        lga: body.lga,
      });

      if (dupCheck.isDuplicate) {
        const overrideReason = (body as any).overrideReason;
        if (!overrideReason || typeof overrideReason !== "string" || overrideReason.trim() === "") {
          return reply.status(409).send({
            error: "Potential duplicate facility detected.",
            existingFacilityId: dupCheck.existingFacilityId,
            confidence: "high"
          });
        }
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
              id, tenant_id, organization_id, owner_user_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, created_by,
              registration_source, registered_by_user_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'submitted', $10, $11, 'officer', $11)
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
              preliminary_risk_rating, record_version,
              submitted_by_actor_type, submitted_by_actor_id, submission_channel
            ) VALUES ($1, $2, $3, $4, $5, 'submitted', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1, 'officer', $6, 'web_portal')
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
                clientSubmissionId: crypto.createHash('sha256').update(body.clientSubmissionId).digest('hex'),
                overrideReason: (body as any).overrideReason || null,
                existingFacilityId: dupCheck.isDuplicate ? dupCheck.existingFacilityId : null
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
