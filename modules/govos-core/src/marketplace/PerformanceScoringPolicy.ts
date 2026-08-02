export class PerformanceScoringPolicy {
  public static readonly VERSION = "1.0.0";

  /**
   * Normalizes an audit score from [0-100] scale to [0-5] scale.
   */
  public static normalizeScore(score: number): number {
    return Math.min(5.0, Math.max(0.0, score / 20.0));
  }

  /**
   * Calculates the overall performance score from a list of eligible audits.
   * If there are no audits, defaults to 5.00.
   */
  public static calculatePerformanceScore(audits: { score: number | string }[]): number {
    if (audits.length === 0) {
      return 5.00;
    }
    const sum = audits.reduce((acc, audit) => acc + this.normalizeScore(Number(audit.score)), 0);
    const avg = sum / audits.length;
    // Format to 2 decimal places to match database NUMERIC(3,2) precision
    return Math.min(5.0, Math.max(0.0, Math.round(avg * 100) / 100));
  }

  /**
   * Determines if the subcontractor is eligible for an automated warning threshold check.
   * Required condition: at least 2 eligible audits OR at least 1 confirmed critical finding.
   */
  public static isWarningEligible(
    eligibleAuditCount: number,
    confirmedCriticalFindingCount: number
  ): boolean {
    return eligibleAuditCount >= 2 || confirmedCriticalFindingCount >= 1;
  }
}
