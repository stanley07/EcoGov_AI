import { Pool } from "pg";
import { PerformanceScorecardService } from "./PerformanceScorecardService.js";

export interface CreateFindingParams {
  findingCode: string;
  severity: "low" | "medium" | "high" | "critical";
  evidenceReferences: string[];
  description: string;
}

export class AuditService {
  constructor(
    private pool: Pool,
    private scorecardService: PerformanceScorecardService
  ) {}

  /**
   * Creates a quality audit with findings.
   * AI audits start as 'draft' (non-punitive), whereas officer audits default to 'completed'.
   */
  public async createAudit(
    tenantId: string,
    subcontractorId: string,
    auditorType: "officer" | "ai" | "system",
    auditorId: string | null,
    aiExecutionId: string | null,
    auditType: string,
    associatedResourceType: string | null,
    associatedResourceId: string | null,
    score: number,
    statusOverride: string | null,
    findings: CreateFindingParams[],
    correlationId: string
  ): Promise<any> {
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

      // 2. Verify subcontractor profile exists
      const profileRes = await client.query(
        "SELECT id FROM subcontractor_profile WHERE tenant_id = $1 AND id = $2 AND status = 'active'",
        [tenantId, subcontractorId]
      );
      if (profileRes.rows.length === 0) {
        throw new Error("SUBCONTRACTOR_NOT_FOUND");
      }

      // 3. Validate findings evidence requirements
      for (const finding of findings) {
        if (["high", "critical"].includes(finding.severity)) {
          if (!finding.evidenceReferences || finding.evidenceReferences.length === 0) {
            throw new Error("EVIDENCE_REQUIRED");
          }
        }
      }

      // Determine initial status: AI findings start as draft
      let status = "completed";
      if (auditorType === "ai") {
        status = "draft";
      }
      if (statusOverride) {
        status = statusOverride;
      }

      // 4. Insert Audit
      const insertAuditQuery = `
        INSERT INTO subcontractor_quality_audit (
          tenant_id, subcontractor_id, auditor_type, auditor_id, ai_execution_id,
          audit_type, associated_resource_type, associated_resource_id, score, status, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", auditor_type as "auditorType",
                  auditor_id as "auditorId", ai_execution_id as "aiExecutionId", audit_type as "auditType",
                  associated_resource_type as "associatedResourceType", associated_resource_id as "associatedResourceId",
                  score, status, version, created_at as "createdAt"
      `;
      const auditRes = await client.query(insertAuditQuery, [
        tenantId,
        subcontractorId,
        auditorType,
        auditorId,
        aiExecutionId,
        auditType,
        associatedResourceType,
        associatedResourceId,
        score,
        status
      ]);
      const audit = auditRes.rows[0];

      // 5. Insert Findings (immutable and linked to same tenant/audit)
      for (const finding of findings) {
        await client.query(
          `INSERT INTO subcontractor_quality_finding (
             tenant_id, audit_id, finding_code, severity, evidence_references, description
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            audit.id,
            finding.findingCode,
            finding.severity,
            JSON.stringify(finding.evidenceReferences),
            finding.description
          ]
        );
      }

      // 6. If status is completed/confirmed, trigger scorecard recalculation
      if (["completed", "confirmed"].includes(status)) {
        await this.scorecardService.recalculateScorecard(
          client,
          tenantId,
          subcontractorId,
          correlationId,
          audit.id
        );
      }

      await client.query("COMMIT");
      return audit;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Confirms a draft AI-generated audit. Only confirmed AI audits affect the performance scorecard.
   */
  public async confirmAiAudit(
    tenantId: string,
    auditId: string,
    expectedVersion: number,
    officerId: string,
    correlationId: string
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock audit FOR UPDATE
      const auditRes = await client.query(
        "SELECT * FROM subcontractor_quality_audit WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, auditId]
      );
      if (auditRes.rows.length === 0) {
        throw new Error("AUDIT_NOT_FOUND");
      }
      const audit = auditRes.rows[0];

      if (Number(audit.version) !== expectedVersion) {
        throw new Error("VERSION_MISMATCH_CONFLICT");
      }

      if (audit.status !== "draft") {
        throw new Error("AUDIT_ALREADY_CONFIRMED");
      }

      // Update status to confirmed
      const updateQuery = `
        UPDATE subcontractor_quality_audit
        SET status = 'confirmed', auditor_id = $1, version = version + 1
        WHERE tenant_id = $2 AND id = $3 AND version = $4
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", auditor_type as "auditorType",
                  auditor_id as "auditorId", ai_execution_id as "aiExecutionId", audit_type as "auditType",
                  associated_resource_type as "associatedResourceType", associated_resource_id as "associatedResourceId",
                  score, status, version, created_at as "createdAt"
      `;
      const res = await client.query(updateQuery, [officerId, tenantId, auditId, expectedVersion]);

      // Recalculate scorecard
      await this.scorecardService.recalculateScorecard(
        client,
        tenantId,
        audit.subcontractor_id,
        correlationId,
        auditId
      );

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
   * Disputes a completed/confirmed audit. Temporarily removes it from scorecard.
   */
  public async disputeAudit(
    tenantId: string,
    auditId: string,
    expectedVersion: number
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock audit FOR UPDATE
      const auditRes = await client.query(
        "SELECT * FROM subcontractor_quality_audit WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, auditId]
      );
      if (auditRes.rows.length === 0) {
        throw new Error("AUDIT_NOT_FOUND");
      }
      const audit = auditRes.rows[0];

      if (Number(audit.version) !== expectedVersion) {
        throw new Error("VERSION_MISMATCH_CONFLICT");
      }

      if (!["completed", "confirmed"].includes(audit.status)) {
        throw new Error("AUDIT_NOT_ELIGIBLE_FOR_DISPUTE");
      }

      // Update status to disputed
      const updateQuery = `
        UPDATE subcontractor_quality_audit
        SET status = 'disputed', version = version + 1
        WHERE tenant_id = $1 AND id = $2 AND version = $3
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", auditor_type as "auditorType",
                  score, status, version
      `;
      const res = await client.query(updateQuery, [tenantId, auditId, expectedVersion]);

      // Recalculate scorecard (disputed is excluded)
      await this.scorecardService.recalculateScorecard(
        client,
        tenantId,
        audit.subcontractor_id,
        "dispute-correlation",
        auditId
      );

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
   * Resolves a disputed audit, converting it to confirmed or overturned.
   */
  public async resolveAuditDispute(
    tenantId: string,
    auditId: string,
    expectedVersion: number,
    decision: "confirmed" | "overturned",
    _officerId: string,
    correlationId: string
  ): Promise<any> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock audit FOR UPDATE
      const auditRes = await client.query(
        "SELECT * FROM subcontractor_quality_audit WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, auditId]
      );
      if (auditRes.rows.length === 0) {
        throw new Error("AUDIT_NOT_FOUND");
      }
      const audit = auditRes.rows[0];

      if (Number(audit.version) !== expectedVersion) {
        throw new Error("VERSION_MISMATCH_CONFLICT");
      }

      if (audit.status !== "disputed") {
        throw new Error("AUDIT_NOT_DISPUTED");
      }

      // Update status
      const updateQuery = `
        UPDATE subcontractor_quality_audit
        SET status = $1, version = version + 1
        WHERE tenant_id = $2 AND id = $3 AND version = $4
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", auditor_type as "auditorType",
                  score, status, version
      `;
      const res = await client.query(updateQuery, [decision, tenantId, auditId, expectedVersion]);

      // Recalculate scorecard
      await this.scorecardService.recalculateScorecard(
        client,
        tenantId,
        audit.subcontractor_id,
        correlationId,
        auditId
      );

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
