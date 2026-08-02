export const MARKETPLACE_ANALYTICS_POLICY_VERSION = "1.0.0";

export interface DateRange {
  from: string; // ISO date string (UTC)
  to: string;   // ISO date string (UTC)
}

export interface MetricEnvelope<T> {
  policyVersion: typeof MARKETPLACE_ANALYTICS_POLICY_VERSION;
  tenantId: string;
  reportingRange: {
    from: string;
    to: string;
    timezone: "UTC";
    intervalSemantics: "half-open";
  };
  filters: {
    lgaId?: string;
    clusterId?: string;
    licenceType?: string;
    currency?: string;
  };
  generatedAt: string;
  data: T;
}

export class MarketplaceAnalyticsPolicy {
  /**
   * Calculates a conversion rate cleanly.
   * If denominator is 0, returns null rather than 0 or NaN, indicating lack of cohort data.
   */
  public static calculateConversionRate(numerator: number, denominator: number): number | null {
    if (denominator <= 0) return null;
    const rate = numerator / denominator;
    return Number(rate.toFixed(4));
  }

  /**
   * Fixed performance score buckets defined by the scoring policy.
   */
  public static readonly SCORE_BUCKETS = [
    { label: "0.00–0.99", min: 0.00, max: 0.99 },
    { label: "1.00–1.99", min: 1.00, max: 1.99 },
    { label: "2.00–2.49", min: 2.00, max: 2.49 },
    { label: "2.50–3.49", min: 2.50, max: 3.49 },
    { label: "3.50–4.49", min: 3.50, max: 4.49 },
    { label: "4.50–5.00", min: 4.50, max: 5.00 }
  ];

  /**
   * Defines AI recommendation and Officer decision agreement.
   * - Recommended + Approved = Agreement
   * - High Risk + Rejected = Agreement
   * Needs Review/Request Info are excluded from agreement/override rate calculations.
   */
  public static calculateAgreementRate(
    agreementCount: number,
    totalDefinitiveScreenings: number
  ): number | null {
    return this.calculateConversionRate(agreementCount, totalDefinitiveScreenings);
  }

  /**
   * Reconciles Net Revenue from ledger aggregates.
   * net_revenue = gross_revenue - refunds - chargebacks + adjustments
   */
  public static calculateNetRevenue(
    grossMinorUnits: bigint,
    refundsMinorUnits: bigint,
    chargebacksMinorUnits: bigint,
    adjustmentsMinorUnits: bigint
  ): bigint {
    return grossMinorUnits - refundsMinorUnits - chargebacksMinorUnits + adjustmentsMinorUnits;
  }
}
