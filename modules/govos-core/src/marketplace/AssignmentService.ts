import { Pool } from "pg";
import { SubcontractorAssignment } from "@govos/domain";

export class AssignmentService {
  constructor(private pool: Pool) {}

  /**
   * Assigns an LGA or Cluster territory to a licensed subcontractor profile.
   */
  public async assignTerritory(
    tenantId: string,
    subcontractorId: string,
    assignmentType: "lga" | "cluster",
    targetId: string,
    startsAt: Date | string,
    assignedBy: string
  ): Promise<SubcontractorAssignment> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Verify tenant status
      const tenantRes = await client.query("SELECT status FROM tenant WHERE id = $1", [tenantId]);
      if (tenantRes.rows.length === 0) {
        throw new Error("TENANT_NOT_FOUND");
      }
      if (tenantRes.rows[0].status === "suspended") {
        throw new Error("TENANT_SUSPENDED");
      }

      // 2. Verify startsAt is not in the future (Required Correction 1)
      const startsAtDate = new Date(startsAt);
      if (startsAtDate.getTime() > Date.now()) {
        throw new Error("FUTURE_ASSIGNMENT_PROHIBITED");
      }

      // 3. Verify subcontractor profile exists under tenant
      const profileRes = await client.query(
        "SELECT id FROM subcontractor_profile WHERE tenant_id = $1 AND id = $2 AND status = 'active'",
        [tenantId, subcontractorId]
      );
      if (profileRes.rows.length === 0) {
        throw new Error("SUBCONTRACTOR_NOT_FOUND");
      }

      // 4. Verify subcontractor holds valid active licence covering startsAt
      const licenceRes = await client.query(
        `SELECT id FROM subcontractor_licence 
         WHERE tenant_id = $1 AND subcontractor_id = $2 AND status = 'active'
           AND valid_from <= $3 AND expires_at > $3`,
        [tenantId, subcontractorId, startsAtDate]
      );
      if (licenceRes.rows.length === 0) {
        throw new Error("UNLICENSED_SUBCONTRACTOR");
      }

      // 5. Verify geography exists under tenant
      if (assignmentType === "lga") {
        const lgaRes = await client.query(
          "SELECT id FROM local_government_area WHERE tenant_id = $1 AND id = $2",
          [tenantId, targetId]
        );
        if (lgaRes.rows.length === 0) {
          throw new Error("GEOGRAPHY_NOT_FOUND");
        }
      } else if (assignmentType === "cluster") {
        const clusterRes = await client.query(
          "SELECT id FROM cluster WHERE tenant_id = $1 AND id = $2",
          [tenantId, targetId]
        );
        if (clusterRes.rows.length === 0) {
          throw new Error("GEOGRAPHY_NOT_FOUND");
        }
      } else {
        throw new Error("INVALID_ASSIGNMENT_TYPE");
      }

      // 6. Insert new active assignment (database exclusion constraint catches overlaps)
      const lgaId = assignmentType === "lga" ? targetId : null;
      const clusterId = assignmentType === "cluster" ? targetId : null;

      const insertQuery = `
        INSERT INTO subcontractor_assignment (
          tenant_id, subcontractor_id, assignment_type, lga_id, cluster_id, status, starts_at, ends_at, assigned_by, version
        ) VALUES ($1, $2, $3, $4, $5, 'active', $6, null, $7, 1)
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", assignment_type as "assignmentType",
                  lga_id as "lgaId", cluster_id as "clusterId", status, starts_at as "startsAt", ends_at as "endsAt",
                  assigned_by as "assignedBy", version, created_at as "createdAt", updated_at as "updatedAt"
      `;

      let res;
      try {
        res = await client.query(insertQuery, [
          tenantId,
          subcontractorId,
          assignmentType,
          lgaId,
          clusterId,
          startsAtDate,
          assignedBy
        ]);
      } catch (err: any) {
        if (err.message.includes("exclude_overlapping")) {
          throw new Error("TERRITORY_ALREADY_ASSIGNED");
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
   * Terminates an active territory assignment.
   */
  public async terminateAssignment(
    tenantId: string,
    assignmentId: string,
    expectedVersion: number
  ): Promise<SubcontractorAssignment> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Fetch and lock assignment
      const assRes = await client.query(
        "SELECT * FROM subcontractor_assignment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, assignmentId]
      );
      if (assRes.rows.length === 0) {
        throw new Error("ASSIGNMENT_NOT_FOUND");
      }
      const assignment = assRes.rows[0];

      if (assignment.status !== "active") {
        throw new Error("ASSIGNMENT_ALREADY_TERMINATED");
      }

      // Check version conflict
      if (Number(assignment.version) !== expectedVersion) {
        throw new Error("VERSION_MISMATCH_CONFLICT");
      }

      // 2. Perform termination update
      const updateQuery = `
        UPDATE subcontractor_assignment
        SET status = 'terminated', ends_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2 AND version = $3
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", assignment_type as "assignmentType",
                  lga_id as "lgaId", cluster_id as "clusterId", status, starts_at as "startsAt", ends_at as "endsAt",
                  assigned_by as "assignedBy", version, created_at as "createdAt", updated_at as "updatedAt"
      `;
      const res = await client.query(updateQuery, [tenantId, assignmentId, expectedVersion]);

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
   * Retrieves active assignments for a subcontractor profile.
   */
  public async getActiveAssignments(tenantId: string, subcontractorId: string): Promise<SubcontractorAssignment[]> {
    const query = `
      SELECT id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", assignment_type as "assignmentType",
             lga_id as "lgaId", cluster_id as "clusterId", status, starts_at as "startsAt", ends_at as "endsAt",
             assigned_by as "assignedBy", version, created_at as "createdAt", updated_at as "updatedAt"
      FROM subcontractor_assignment
      WHERE tenant_id = $1 AND subcontractor_id = $2 AND status = 'active'
      ORDER BY starts_at DESC
    `;
    const res = await this.pool.query(query, [tenantId, subcontractorId]);
    return res.rows;
  }
}
