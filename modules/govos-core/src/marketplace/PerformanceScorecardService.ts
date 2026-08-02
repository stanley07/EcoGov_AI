import { PoolClient } from "pg";
import { PerformanceScoringPolicy } from "./PerformanceScoringPolicy.js";

export class PerformanceScorecardService {
  constructor(private enforcementService: any) {}

  /**
   * Recalculates subcontractor performance score in a concurrency-safe manner (FOR UPDATE lock),
   * updates the profile, logs a scorecard event, and handles warning enforcement checks.
   */
  public async recalculateScorecard(
    client: PoolClient,
    tenantId: string,
    subcontractorId: string,
    correlationId: string,
    triggerAuditId: string | null
  ): Promise<number> {
    // 1. Lock subcontractor profile FOR UPDATE
    const profileRes = await client.query(
      "SELECT * FROM subcontractor_profile WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
      [tenantId, subcontractorId]
    );
    if (profileRes.rows.length === 0) {
      throw new Error("SUBCONTRACTOR_NOT_FOUND");
    }
    const profile = profileRes.rows[0];
    const previousScore = profile.performance_score !== null ? Number(profile.performance_score) : null;

    // 2. Load all currently eligible audits (status completed or confirmed)
    const auditsRes = await client.query(
      `SELECT score FROM subcontractor_quality_audit 
       WHERE tenant_id = $1 AND subcontractor_id = $2 AND status IN ('completed', 'confirmed')`,
      [tenantId, subcontractorId]
    );
    const audits = auditsRes.rows;

    // 3. Calculate score using scoring policy
    const newScore = PerformanceScoringPolicy.calculatePerformanceScore(audits);

    // 4. Update subcontractor profile scorecard metadata
    await client.query(
      `UPDATE subcontractor_profile
       SET performance_score = $1,
           performance_score_policy_version = $2,
           performance_score_calculated_at = NOW(),
           performance_score_audit_count = $3,
           version = version + 1,
           updated_at = NOW()
       WHERE tenant_id = $4 AND id = $5`,
      [newScore, PerformanceScoringPolicy.VERSION, audits.length, tenantId, subcontractorId]
    );

    // 5. Log score event history
    await client.query(
      `INSERT INTO subcontractor_performance_score_event (
         tenant_id, subcontractor_id, previous_score, new_score, eligible_audit_count,
         scoring_policy_version, trigger_audit_id, correlation_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        tenantId,
        subcontractorId,
        previousScore,
        newScore,
        audits.length,
        PerformanceScoringPolicy.VERSION,
        triggerAuditId,
        correlationId
      ]
    );

    // 6. Evaluate warning threshold
    const findingsRes = await client.query(
      `SELECT COUNT(f.id) as count FROM subcontractor_quality_finding f
       JOIN subcontractor_quality_audit a ON a.id = f.audit_id AND a.tenant_id = f.tenant_id
       WHERE a.tenant_id = $1 AND a.subcontractor_id = $2
         AND a.status IN ('completed', 'confirmed') AND f.severity = 'critical'`,
      [tenantId, subcontractorId]
    );
    const criticalFindingsCount = Number(findingsRes.rows[0].count);

    const isEligible = PerformanceScoringPolicy.isWarningEligible(audits.length, criticalFindingsCount);
    if (isEligible && newScore < 2.50) {
      await this.enforcementService.createWarningInternal(
        client,
        tenantId,
        subcontractorId,
        `Performance score fell to ${newScore} below threshold of 2.50 (Audits: ${audits.length}, Critical Findings: ${criticalFindingsCount})`,
        PerformanceScoringPolicy.VERSION
      );
    }

    return newScore;
  }
}
