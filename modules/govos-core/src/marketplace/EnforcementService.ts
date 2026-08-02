import { Pool, PoolClient } from "pg";

export class EnforcementService {
  constructor(private pool: Pool) {}

  /**
   * System-automated warning creation (deduplicated via trigger reference).
   * Only warnings can be created automatically by the system.
   */
  public async createWarningInternal(
    client: PoolClient,
    tenantId: string,
    subcontractorId: string,
    reason: string,
    policyVersion: string
  ): Promise<void> {
    const triggerRef = `performance-score:${policyVersion}:below-2.50`;

    // 1. Check for existing open/active warning under the same trigger reference
    const existing = await client.query(
      `SELECT id FROM subcontractor_enforcement_action
       WHERE tenant_id = $1 AND subcontractor_id = $2 
         AND trigger_reference = $3 AND status IN ('proposed', 'active', 'stayed')`,
      [tenantId, subcontractorId, triggerRef]
    );

    if (existing.rows.length > 0) {
      return; // Deduplicated
    }

    // 2. Insert system warning (initiated_by = dummy system UUID)
    const systemId = "00000000-0000-0000-0000-000000000000";
    await client.query(
      `INSERT INTO subcontractor_enforcement_action (
         tenant_id, subcontractor_id, action_type, reason, initiated_by, status,
         trigger_type, trigger_reference, policy_version, version
       ) VALUES ($1, $2, 'warning', $3, $4, 'active', 'performance_score_threshold', $5, $6, 1)`,
      [tenantId, subcontractorId, reason, systemId, triggerRef, policyVersion]
    );
  }

  /**
   * Officer-initiated enforcement action (restrictions, warnings, suspensions, revocations).
   * Verifies necessary permission scopes and profile concurrency locks.
   */
  public async createOfficerEnforcement(
    tenantId: string,
    subcontractorId: string,
    actionType: "warning" | "restriction" | "suspension" | "revocation",
    reason: string,
    officerId: string,
    expectedProfileVersion: number,
    officerPermissions: string[]
  ): Promise<any> {
    // Check permission safeguards
    if (actionType === "suspension") {
      if (!officerPermissions.includes("marketplace.enforcement.suspend")) {
        throw new Error("FORBIDDEN_INSUFFICIENT_PERMISSIONS");
      }
    }
    if (actionType === "revocation") {
      if (!officerPermissions.includes("marketplace.enforcement.revoke")) {
        throw new Error("FORBIDDEN_INSUFFICIENT_PERMISSIONS");
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock subcontractor profile and verify expected version
      const profileRes = await client.query(
        "SELECT * FROM subcontractor_profile WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, subcontractorId]
      );
      if (profileRes.rows.length === 0) {
        throw new Error("SUBCONTRACTOR_NOT_FOUND");
      }
      const profile = profileRes.rows[0];
      if (Number(profile.version) !== expectedProfileVersion) {
        throw new Error("VERSION_MISMATCH_CONFLICT");
      }

      // Update profile status based on enforcement action type
      let newProfileStatus = profile.status;
      if (actionType === "suspension") {
        newProfileStatus = "suspended";
      } else if (actionType === "revocation") {
        newProfileStatus = "revoked";
      }

      if (newProfileStatus !== profile.status) {
        await client.query(
          `UPDATE subcontractor_profile
           SET status = $1, version = version + 1, updated_at = NOW()
           WHERE tenant_id = $2 AND id = $3`,
          [newProfileStatus, tenantId, subcontractorId]
        );
      }

      // Insert enforcement action record
      const insertQuery = `
        INSERT INTO subcontractor_enforcement_action (
          tenant_id, subcontractor_id, action_type, reason, initiated_by, status, version
        ) VALUES ($1, $2, $3, $4, $5, 'active', 1)
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", action_type as "actionType",
                  reason, initiated_by as "initiatedBy", status, version, created_at as "createdAt"
      `;
      const res = await client.query(insertQuery, [
        tenantId,
        subcontractorId,
        actionType,
        reason,
        officerId
      ]);

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
