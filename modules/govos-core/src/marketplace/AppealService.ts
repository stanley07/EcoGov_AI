import { Pool } from "pg";

export class AppealService {
  constructor(private pool: Pool) {}

  /**
   * Submits a subcontractor appeal for an active or stayed enforcement action.
   */
  public async submitAppeal(
    tenantId: string,
    enforcementActionId: string,
    subcontractorJustification: string
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Fetch enforcement action
      const actionRes = await client.query(
        "SELECT * FROM subcontractor_enforcement_action WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, enforcementActionId]
      );
      if (actionRes.rows.length === 0) {
        throw new Error("ENFORCEMENT_ACTION_NOT_FOUND");
      }
      const action = actionRes.rows[0];

      // 2. Verify eligibility (only active or stayed can be appealed)
      if (!["active", "stayed"].includes(action.status)) {
        throw new Error("INELIGIBLE_FOR_APPEAL");
      }

      // 3. Insert appeal record (status is pending)
      const insertQuery = `
        INSERT INTO subcontractor_appeal (
          tenant_id, enforcement_action_id, subcontractor_justification, status, version
        ) VALUES ($1, $2, $3, 'pending', 1)
        RETURNING id, tenant_id as "tenantId", enforcement_action_id as "enforcementActionId",
                  subcontractor_justification as "subcontractorJustification", status, version, created_at as "createdAt"
      `;

      let res;
      try {
        res = await client.query(insertQuery, [
          tenantId,
          enforcementActionId,
          subcontractorJustification
        ]);
      } catch (err: any) {
        if (err.message.includes("uq_open_enforcement_appeal")) {
          throw new Error("APPEAL_ALREADY_PENDING");
        }
        throw err;
      }

      await client.query("COMMIT");
      return res.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Decides an appeal (approve or reject), applying transactional updates to the enforcement action
   * and profile status where necessary.
   */
  public async decideAppeal(
    tenantId: string,
    appealId: string,
    expectedVersion: number,
    decision: "approved" | "rejected",
    officerDecision: string,
    officerId: string
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Fetch and lock appeal
      const appealRes = await client.query(
        "SELECT * FROM subcontractor_appeal WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, appealId]
      );
      if (appealRes.rows.length === 0) {
        throw new Error("APPEAL_NOT_FOUND");
      }
      const appeal = appealRes.rows[0];

      if (appeal.status !== "pending") {
        throw new Error("APPEAL_ALREADY_DECIDED");
      }

      if (Number(appeal.version) !== expectedVersion) {
        throw new Error("VERSION_MISMATCH_CONFLICT");
      }

      const dbStatus = decision === "approved" ? "approved" : "rejected";

      // 2. Update appeal record
      const updateAppealQuery = `
        UPDATE subcontractor_appeal
        SET status = $1, decided_by = $2, decided_at = NOW(), officer_decision = $3, version = version + 1
        WHERE tenant_id = $4 AND id = $5 AND version = $6
        RETURNING id, tenant_id as "tenantId", enforcement_action_id as "enforcementActionId",
                  status, officer_decision as "officerDecision", decided_by as "decidedBy",
                  decided_at as "decidedAt", version
      `;
      const res = await client.query(updateAppealQuery, [
        dbStatus,
        officerId,
        officerDecision,
        tenantId,
        appealId,
        expectedVersion
      ]);

      // 3. Apply side-effects if appeal is approved (overturn enforcement action and restore profile status)
      if (decision === "approved") {
        const actionRes = await client.query(
          "SELECT * FROM subcontractor_enforcement_action WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
          [tenantId, appeal.enforcement_action_id]
        );
        const action = actionRes.rows[0];

        // Transition enforcement action to overturned
        await client.query(
          `UPDATE subcontractor_enforcement_action
           SET status = 'overturned', version = version + 1
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, action.id]
        );

        // If suspension or revocation, restore profile status to active
        if (["suspension", "revocation"].includes(action.action_type)) {
          await client.query(
            `UPDATE subcontractor_profile
             SET status = 'active', version = version + 1, updated_at = NOW()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, action.subcontractor_id]
          );
        }
      }

      await client.query("COMMIT");
      return res.rows[0];
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
