import * as crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import {
  hasPermission,
  createWorkflowInstance,
  transitionWorkflowInstance,
} from "@govos/core";
import { getContext, logger } from "@govos/observability";

export function registrationRoutes(
  app: FastifyInstance,
  { pool }: { pool: Pool },
  done: () => void,
) {
  // Submit Facility Registration (starts workflow)
  app.post(
    "/facilities/:id/register",
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
              status: { type: "string" },
              workflowId: { type: "string" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:register")) {
        return reply
          .status(403)
          .send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };

      // Check facility existence and draft status
      const facQuery = `
      SELECT id, registration_status as "registrationStatus", business_name as "businessName"
      FROM facility
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
    `;
      const facRes = await pool.query(facQuery, [user.tenantId, id]);
      if (facRes.rows.length === 0) {
        return reply.status(404).send({ error: "Facility not found" });
      }

      const facility = facRes.rows[0];
      if (
        facility.registrationStatus !== "draft" &&
        facility.registrationStatus !== "action_required"
      ) {
        return reply.status(400).send({
          error: `Facility cannot be registered. Current status: ${facility.registrationStatus}`,
        });
      }

      // Execute within SQL transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1. Update facility status
        await client.query(
          `UPDATE facility SET registration_status = 'submitted', updated_at = NOW() WHERE id = $1`,
          [id],
        );

        // 2. Spawn workflow instance
        const { instanceId, initialStepExecutionId } =
          await createWorkflowInstance(
            client,
            user.tenantId,
            "facility_registration",
            "facility",
            id,
          );

        // 3. Move workflow immediately to AI Review step via transition
        const nextStepId = await transitionWorkflowInstance(
          client,
          user.tenantId,
          instanceId,
          initialStepExecutionId,
          "submit",
          "system",
        );

        await client.query("COMMIT");

        // Dispatch task asynchronously to background worker
        const workerUrl = `http://localhost:8081/internal/tasks/ai_registration_review`;
        const taskEnvelope = {
          taskId: `task-${crypto.randomUUID()}`,
          taskType: "complaint_triage_job", // Keep generic worker consumer hook name
          schemaVersion: 1,
          tenantId: user.tenantId,
          correlationId: getContext()?.correlationId || crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          payload: {
            facilityId: id,
            workflowId: instanceId,
            workflowStepExecutionId: nextStepId,
          },
        };

        // Execute webhook POST non-blocking (fire and forget in local development)
        fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer local-development-bypass-token",
          },
          body: JSON.stringify(taskEnvelope),
        }).catch((err) => {
          logger.error({ err }, "Failed to trigger background worker webhook");
        });

        return reply.send({
          status: "success",
          workflowId: instanceId,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // Get Workflow Status and history steps
  app.get(
    "/workflows/:id/status",
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
              currentStepName: { type: "string", nullable: true },
              status: { type: "string" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    stepName: { type: "string" },
                    status: { type: "string" },
                    actorType: { type: "string" },
                    notes: { type: "string", nullable: true },
                    completedAt: { type: "string", nullable: true },
                    createdAt: { type: "string" },
                  },
                },
              },
              aiReviews: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    agentName: { type: "string" },
                    responsePayload: {
                      type: "object",
                      additionalProperties: true,
                    },
                    createdAt: { type: "string" },
                  },
                },
              },
            },
          },
          404: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      const { id } = req.params as { id: string };

      // Fetch workflow instance (support lookup by instance id OR facility id)
      const wfQuery = `
      SELECT id, status
      FROM workflow_instance
      WHERE tenant_id = $1 AND (id = $2 OR entity_id = $2)
      LIMIT 1
    `;
      const wfRes = await pool.query(wfQuery, [user.tenantId, id]);
      if (wfRes.rows.length === 0) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      const workflow = wfRes.rows[0];

      // Fetch steps using resolved workflow_instance id
      const stepsQuery = `
      SELECT s.step_name as "stepName", e.status, e.actor_type as "actorType", e.notes,
             e.completed_at as "completedAt", e.created_at as "createdAt"
      FROM workflow_step_execution e
      JOIN workflow_step_definition s ON s.tenant_id = e.tenant_id AND s.id = e.step_definition_id
      WHERE e.tenant_id = $1 AND e.workflow_instance_id = $2
      ORDER BY e.created_at ASC
    `;
      const stepsRes = await pool.query(stepsQuery, [
        user.tenantId,
        workflow.id,
      ]);

      // Fetch AI reviews using resolved workflow_instance id
      const aiQuery = `
      SELECT id, agent_name as "agentName", response_payload as "responsePayload", started_at as "createdAt"
      FROM ai_execution
      WHERE tenant_id = $1 AND workflow_instance_id = $2
      ORDER BY started_at DESC
    `;
      const aiRes = await pool.query(aiQuery, [user.tenantId, workflow.id]);

      // Find current active step name
      const activeStep = stepsRes.rows.find((s) => s.status === "pending");

      return reply.send({
        id: workflow.id,
        currentStepName: activeStep ? activeStep.stepName : "completed",
        status: workflow.status,
        steps: stepsRes.rows,
        aiReviews: aiRes.rows,
      });
    },
  );

  // Submit Officer Review Decision
  app.post(
    "/facilities/:id/review",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["decision", "version"],
          properties: {
            decision: {
              type: "string",
              enum: ["approve", "reject", "request_correction"],
            },
            notes: { type: "string" },
            version: { type: "integer" },
            officialRiskRating: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              registrationId: { type: "string" },
              status: { type: "string" },
              version: { type: "integer" },
            },
          },
          400: { type: "object", properties: { error: { type: "string" } } },
          404: { type: "object", properties: { error: { type: "string" } } },
          409: {
            type: "object",
            properties: {
              error: { type: "string" },
              currentVersion: { type: "integer" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      if (!hasPermission(user.roles, "facility:review")) {
        return reply
          .status(403)
          .send({ error: "Forbidden: Insufficient permissions" });
      }

      const { id } = req.params as { id: string };
      const { decision, notes, version, officialRiskRating } = req.body as {
        decision: "approve" | "reject" | "request_correction";
        notes?: string;
        version: number;
        officialRiskRating?: "low" | "medium" | "high";
      };

      // 1. Resolve facility_registration record by registration ID
      const regRes = await pool.query(
        `SELECT id, facility_id, record_version, preliminary_risk_rating
         FROM facility_registration
         WHERE tenant_id = $1 AND id = $2`,
        [user.tenantId, id]
      );

      if (regRes.rows.length === 0) {
        // If not found, check if they passed a valid facility ID instead
        const facCheck = await pool.query(
          `SELECT id FROM facility WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [user.tenantId, id]
        );
        if (facCheck.rows.length > 0) {
          return reply.status(400).send({
            error: "Cannot review using facility ID; must use registration ID",
          });
        }
        return reply.status(404).send({ error: "Registration not found" });
      }

      const registration = regRes.rows[0];
      const facilityId = registration.facility_id;

      // 2. Perform CAS version validation
      if (registration.record_version !== version) {
        return reply.status(409).send({
          error: "record_version_conflict",
          currentVersion: registration.record_version,
        });
      }

      // Resolve workflow instance: registration-first workflow identity with legacy fallback
      let wfRes = await pool.query(
        `SELECT id
         FROM workflow_instance
         WHERE tenant_id = $1 AND entity_type = 'facility_registration' AND entity_id = $2 AND status = 'active'`,
        [user.tenantId, id]
      );

      if (wfRes.rows.length === 0) {
        wfRes = await pool.query(
          `SELECT id
           FROM workflow_instance
           WHERE tenant_id = $1 AND entity_type = 'facility' AND entity_id = $2 AND status = 'active'`,
          [user.tenantId, facilityId]
        );
      }

      if (wfRes.rows.length === 0) {
        return reply.status(400).send({
          error: "No active registration workflow found for this facility",
        });
      }

      const instanceId = wfRes.rows[0].id;

      // Fetch active step execution ID
      const stepExecQuery = `
      SELECT id
      FROM workflow_step_execution
      WHERE tenant_id = $1 AND workflow_instance_id = $2 AND status = 'pending'
      LIMIT 1
    `;
      const stepRes = await pool.query(stepExecQuery, [
        user.tenantId,
        instanceId,
      ]);
      if (stepRes.rows.length === 0) {
        return reply.status(400).send({
          error:
            "No active pending step execution found for this workflow instance",
        });
      }

      const stepExecutionId = stepRes.rows[0].id;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Determine next statuses
        let nextRegStatus = "approved";
        let nextFacStatus = "approved";
        if (decision === "reject") {
          nextRegStatus = "rejected";
          nextFacStatus = "rejected";
        }
        if (decision === "request_correction") {
          nextRegStatus = "more_information_required";
          nextFacStatus = "action_required";
        }

        const riskRating = officialRiskRating || registration.preliminary_risk_rating;

        // 1. Update facility_registration
        const nextVersion = version + 1;
        const updateRegRes = await client.query(
          `UPDATE facility_registration
           SET status = $1,
               official_risk_rating = $2,
               record_version = $3,
               registration_notes = $4,
               updated_at = NOW()
           WHERE tenant_id = $5 AND id = $6 AND record_version = $7`,
          [nextRegStatus, riskRating, nextVersion, notes || null, user.tenantId, id, version]
        );

        if (updateRegRes.rowCount === 0) {
          throw new Error("CAS update failed: concurrency conflict");
        }

        // 2. Update facility
        await client.query(
          `UPDATE facility
           SET registration_status = $1,
               risk_rating = $2,
               updated_at = NOW()
           WHERE tenant_id = $3 AND id = $4`,
          [nextFacStatus, riskRating, user.tenantId, facilityId]
        );

        // 3. Update or Insert registration_review record
        const nextReviewStatus = decision === "approve" ? "accepted" : "rejected";
        const updateReviewRes = await client.query(
          `UPDATE registration_review
           SET review_status = $1,
               officer_user_id = $2,
               officer_notes = $3,
               updated_at = NOW()
           WHERE tenant_id = $4 AND facility_id = $5 AND review_status = 'unreviewed'`,
          [nextReviewStatus, user.userId, notes || null, user.tenantId, facilityId]
        );

        if (updateReviewRes.rowCount === 0) {
          await client.query(
            `INSERT INTO registration_review (
               tenant_id, facility_id, workflow_instance_id, workflow_step_execution_id,
               agent_name, agent_version, prompt_version, recommended_category,
               category_matches_submission, detected_inconsistencies, missing_documents,
               preliminary_risk_rating, confidence_score, rationale, permit_status,
               requires_officer_attention, attention_reasons, review_status, officer_user_id, officer_notes
             ) VALUES ($1, $2, $3, $4, 'manual-review', '1.0.0', '1.0.0', 'other', true, '[]'::jsonb, '[]'::jsonb, $5, 1.000, 'Manual Review Decision', 'valid', false, '[]'::jsonb, $6, $7, $8)`,
            [
              user.tenantId,
              facilityId,
              instanceId,
              stepExecutionId,
              riskRating || "low",
              nextReviewStatus,
              user.userId,
              notes || null,
            ]
          );
        }

        // 4. Transition Workflow
        await transitionWorkflowInstance(
          client,
          user.tenantId,
          instanceId,
          stepExecutionId,
          decision,
          "user",
          user.userId,
          notes,
        );

        await client.query("COMMIT");
        return reply.send({
          registrationId: id,
          status: nextRegStatus,
          version: nextVersion,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  );

  done();
}
