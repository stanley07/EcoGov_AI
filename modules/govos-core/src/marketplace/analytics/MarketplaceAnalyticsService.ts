import { Pool } from "pg";
import { MarketplaceAnalyticsPolicy, DateRange } from "./MarketplaceAnalyticsPolicy.js";

export class MarketplaceAnalyticsService {
  constructor(private pool: Pool) {}

  /**
   * Helper to ensure valid query parameters.
   */
  private validateRange(range: DateRange) {
    const fromTime = new Date(range.from).getTime();
    const toTime = new Date(range.to).getTime();
    if (isNaN(fromTime) || isNaN(toTime)) {
      throw new Error("INVALID_DATE_FORMAT");
    }
    if (fromTime >= toTime) {
      throw new Error("FROM_DATE_MUST_BE_BEFORE_TO_DATE");
    }
    // Limit to 1 year max
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (toTime - fromTime > oneYearMs) {
      throw new Error("RANGE_EXCEEDS_MAX_LIMIT");
    }
  }

  /**
   * Builds the analytics query response wrapper.
   */
  private wrapResponse<T>(
    tenantId: string,
    range: DateRange,
    filters: any,
    data: T
  ): any {
    return {
      policyVersion: "1.0.0",
      tenantId,
      reportingRange: {
        from: range.from,
        to: range.to,
        timezone: "UTC",
        intervalSemantics: "half-open"
      },
      filters,
      generatedAt: new Date().toISOString(),
      data
    };
  }

  /**
   * 1. GET SUMMARY METRICS
   */
  public async getSummary(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    
    // Get summary by calling the sub-functions and combining them
    const [funnel, screening, revenue, licences, assignments, acquisition, quality] = await Promise.all([
      this.getFunnelData(tenantId, range, filters),
      this.getScreeningData(tenantId, range, filters),
      this.getRevenueData(tenantId, range, filters),
      this.getLicenceData(tenantId, range, filters),
      this.getAssignmentData(tenantId, range, filters),
      this.getAcquisitionData(tenantId, range, filters),
      this.getQualityData(tenantId, range, filters)
    ]);

    return this.wrapResponse(tenantId, range, filters, {
      funnelSummary: funnel,
      screeningSummary: screening,
      revenueSummary: revenue,
      licenceSummary: licences,
      assignmentSummary: assignments,
      acquisitionSummary: acquisition,
      qualitySummary: quality
    });
  }

  /**
   * 2. GET FUNNEL METRICS
   */
  public async getFunnel(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getFunnelData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getFunnelData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    // Funnel events list
    const stages = [
      "application.created",
      "application.submitted",
      "screening.started",
      "screening.completed",
      "officer.approved",
      "invoice.created",
      "checkout.created",
      "payment.confirmed",
      "licence.issued",
      "assignment.activated",
      "facility.first_completed"
    ];

    // Query all event occurrences for the tenant
    const res = await this.pool.query(
      `SELECT application_id as "applicationId", event_type as "eventType", MIN(created_at) as "earliestTime"
       FROM subcontractor_application_event
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY application_id, event_type`,
      [tenantId, range.from, range.to]
    );

    const rows = res.rows;
    // Map of applicationId -> { eventType -> timestamp }
    const appMap: { [key: string]: { [key: string]: number } } = {};
    for (const row of rows) {
      if (!appMap[row.applicationId]) {
        appMap[row.applicationId] = {};
      }
      const appObj = appMap[row.applicationId];
      if (appObj) {
        appObj[row.eventType] = new Date(row.earliestTime).getTime();
      }
    }

    const appIds = Object.keys(appMap);

    // Calculate counts for each stage
    const stageCounts: { [key: string]: number } = {};
    for (const s of stages) {
      stageCounts[s] = 0;
    }

    for (const appId of appIds) {
      const appObj = appMap[appId];
      if (appObj) {
        for (const s of stages) {
          if (appObj[s] !== undefined) {
            stageCounts[s] = (stageCounts[s] || 0) + 1;
          }
        }
      }
    }

    // Calculate stage latencies
    const stageLatencies: { [key: string]: number[] } = {};
    for (let i = 0; i < stages.length - 1; i++) {
      const stageA = stages[i] as string;
      const stageB = stages[i + 1] as string;
      const key = `${stageA}->${stageB}`;
      stageLatencies[key] = [];

      for (const appId of appIds) {
        const appObj = appMap[appId];
        if (appObj) {
          const timeA = appObj[stageA];
          const timeB = appObj[stageB];
          if (timeA !== undefined && timeB !== undefined && timeB >= timeA) {
            const list = stageLatencies[key];
            if (list) {
              list.push(timeB - timeA);
            }
          }
        }
      }
    }

    const submittedCount = stageCounts["application.submitted"] || 0;

    const funnelStages = stages.map((s, index) => {
      const count = stageCounts[s] || 0;
      const prevStage = index > 0 ? stages[index - 1] : undefined;
      let prevCount = prevStage ? stageCounts[prevStage] || 0 : count;
      let prevConversion = MarketplaceAnalyticsPolicy.calculateConversionRate(count, prevCount);
      let submittedConversion = MarketplaceAnalyticsPolicy.calculateConversionRate(count, submittedCount);

      // Stage latency percentiles
      let medianLatencyMs: number | null = null;
      let p75LatencyMs: number | null = null;
      let p95LatencyMs: number | null = null;

      if (index > 0) {
        const transitionKey = `${stages[index - 1]}->${s}`;
        const latencies = stageLatencies[transitionKey] || [];
        if (latencies.length > 0) {
          latencies.sort((a, b) => a - b);
          medianLatencyMs = latencies[Math.floor(latencies.length * 0.5)] ?? null;
          p75LatencyMs = latencies[Math.floor(latencies.length * 0.75)] ?? null;
          p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] ?? null;
        }
      }

      return {
        stage: s,
        count,
        prevConversion,
        submittedConversion,
        latencyPercentiles: {
          median: medianLatencyMs,
          p75: p75LatencyMs,
          p95: p95LatencyMs
        }
      };
    });

    return {
      stages: funnelStages
    };
  }

  /**
   * 3. GET AI SCREENING METRICS
   */
  public async getScreening(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getScreeningData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getScreeningData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    // 1. Totals
    const resultsRes = await this.pool.query(
      `SELECT screening_status as "status", recommendation, provider_name as "providerName", 
              provider_model as "providerModel", provider_model_version as "providerModelVersion", 
              agent_version_id as "agentVersionId", prompt_version_id as "promptVersionId", 
              screening_policy_version as "screeningPolicyVersion"
       FROM subcontractor_screening_result
       WHERE tenant_id = $1 AND screened_at >= $2 AND screened_at < $3`,
      [tenantId, range.from, range.to]
    );

    const results = resultsRes.rows;
    let screeningsCompleted = 0;
    let screeningsFailed = 0;
    let recommendedCount = 0;
    let needsReviewCount = 0;
    let highRiskCount = 0;

    for (const r of results) {
      if (r.status === "completed") screeningsCompleted++;
      else screeningsFailed++;

      if (r.recommendation === "recommended") recommendedCount++;
      if (r.recommendation === "needs_review") needsReviewCount++;
      if (r.recommendation === "high_risk") highRiskCount++;
    }

    // 2. Override rates
    const overrideRes = await this.pool.query(
      `SELECT a.status as "appStatus", r.recommendation
       FROM subcontractor_application a
       JOIN subcontractor_screening_result r ON r.application_id = a.id
       WHERE a.tenant_id = $1 AND r.screened_at >= $2 AND r.screened_at < $3`,
      [tenantId, range.from, range.to]
    );

    let agreementCount = 0;
    let disagreementCount = 0;
    let overrideCount = 0;
    let totalDefinitiveScreenings = 0;

    for (const row of overrideRes.rows) {
      const rec = row.recommendation;
      const status = row.appStatus;

      // Agreement cohort
      if (["recommended", "high_risk"].includes(rec) && ["approved", "rejected"].includes(status)) {
        totalDefinitiveScreenings++;
        const isAgreement = (rec === "recommended" && status === "approved") || 
                            (rec === "high_risk" && status === "rejected");
        if (isAgreement) {
          agreementCount++;
        } else {
          disagreementCount++;
          overrideCount++;
        }
      }
    }

    const agreementRate = MarketplaceAnalyticsPolicy.calculateAgreementRate(agreementCount, totalDefinitiveScreenings);
    const overrideRate = MarketplaceAnalyticsPolicy.calculateConversionRate(overrideCount, totalDefinitiveScreenings);

    // Segmentations
    const segments: { [key: string]: any } = {};
    for (const r of results) {
      const key = `${r.providerName || "unknown"}:${r.providerModel || "unknown"}`;
      if (!segments[key]) {
        segments[key] = {
          providerName: r.providerName,
          providerModel: r.providerModel,
          providerModelVersion: r.providerModelVersion,
          agentVersionId: r.agentVersionId,
          promptVersionId: r.promptVersionId,
          screeningPolicyVersion: r.screeningPolicyVersion,
          completed: 0,
          failed: 0
        };
      }
      if (r.status === "completed") segments[key].completed++;
      else segments[key].failed++;
    }

    return {
      screeningsCompleted,
      screeningsFailed,
      recommendedCount,
      needsReviewCount,
      highRiskCount,
      agreementCount,
      disagreementCount,
      overrideCount,
      agreementRate,
      overrideRate,
      segmentations: Object.values(segments)
    };
  }

  /**
   * 4. GET REVENUE METRICS
   */
  public async getRevenue(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getRevenueData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getRevenueData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    // 1. Group ledger records by currency
    const ledgerRes = await this.pool.query(
      `SELECT entry_type as "entryType", amount_microunits as "amount", currency
       FROM marketplace_revenue_ledger
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, range.from, range.to]
    );

    const currencyMap: { [key: string]: any } = {};
    for (const row of ledgerRes.rows) {
      const cur = row.currency;
      if (!currencyMap[cur]) {
        currencyMap[cur] = {
          currency: cur,
          grossRevenueMinorUnits: 0n,
          refundsMinorUnits: 0n,
          chargebacksMinorUnits: 0n,
          adjustmentsMinorUnits: 0n
        };
      }

      const amt = BigInt(row.amount);
      if (row.entryType === "credit") {
        currencyMap[cur].grossRevenueMinorUnits += amt;
      } else if (row.entryType === "refund") {
        currencyMap[cur].refundsMinorUnits += amt;
      } else if (row.entryType === "chargeback") {
        currencyMap[cur].chargebacksMinorUnits += amt;
      } else if (row.entryType === "adjustment") {
        currencyMap[cur].adjustmentsMinorUnits += amt; // Assuming signed amounts
      }
    }

    const currencyTotals = Object.values(currencyMap).map((c: any) => {
      const net = MarketplaceAnalyticsPolicy.calculateNetRevenue(
        c.grossRevenueMinorUnits,
        c.refundsMinorUnits,
        c.chargebacksMinorUnits,
        c.adjustmentsMinorUnits
      );
      return {
        currency: c.currency,
        grossRevenue: Number(c.grossRevenueMinorUnits) / 1_000_000,
        refunds: Number(c.refundsMinorUnits) / 1_000_000,
        chargebacks: Number(c.chargebacksMinorUnits) / 1_000_000,
        adjustments: Number(c.adjustmentsMinorUnits) / 1_000_000,
        netRevenue: Number(net) / 1_000_000
      };
    });

    // 2. Invoices metrics
    const invoiceRes = await this.pool.query(
      `SELECT status, amount_due_microunits as "amount"
       FROM marketplace_invoice
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, range.from, range.to]
    );

    let invoicesIssued = invoiceRes.rows.length;
    let invoicesPaid = 0;
    let totalPaidAmt = 0n;

    for (const inv of invoiceRes.rows) {
      if (inv.status === "paid") {
        invoicesPaid++;
        totalPaidAmt += BigInt(inv.amount);
      }
    }

    const paymentConversionRate = MarketplaceAnalyticsPolicy.calculateConversionRate(invoicesPaid, invoicesIssued);
    const averageLicenceFee = invoicesPaid > 0 ? Number(totalPaidAmt / BigInt(invoicesPaid)) / 1_000_000 : null;

    // 3. Payment Processing Telemetry
    const telemetryRes = await this.pool.query(
      `SELECT processing_latency_ms as "latency"
       FROM marketplace_payment_event
       WHERE tenant_id = $1 AND received_at >= $2 AND received_at < $3 AND processing_latency_ms IS NOT NULL`,
      [tenantId, range.from, range.to]
    );

    const latencies = telemetryRes.rows.map(r => Number(r.latency)).sort((a, b) => a - b);
    let p50LatencyMs: number | null = null;
    let p95LatencyMs: number | null = null;

    if (latencies.length > 0) {
      p50LatencyMs = latencies[Math.floor(latencies.length * 0.5)] ?? null;
      p95LatencyMs = latencies[Math.floor(latencies.length * 0.95)] ?? null;
    }

    return {
      currencies: currencyTotals,
      invoicesIssued,
      invoicesPaid,
      paymentConversionRate,
      averageLicenceFee,
      p50LatencyMs,
      p95LatencyMs
    };
  }

  /**
   * 5. GET LICENCE METRICS
   */
  public async getLicences(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getLicenceData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getLicenceData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    const licencesRes = await this.pool.query(
      `SELECT status, issued_at as "issuedAt", expires_at as "expiresAt", subcontractor_id as "subcontractorId"
       FROM subcontractor_licence
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, range.from, range.to]
    );

    let activeLicences = 0;
    let licencesIssued = 0;
    let licencesExpired = 0;
    let licencesSuspended = 0;
    let licencesRevoked = 0;

    for (const l of licencesRes.rows) {
      if (l.status === "active") activeLicences++;
      if (l.status === "expired") licencesExpired++;
      if (l.status === "suspended") licencesSuspended++;
      if (l.status === "revoked") licencesRevoked++;
      licencesIssued++;
    }

    // Renewal Cohort calculation
    const expiredRes = await this.pool.query(
      `SELECT id, subcontractor_id as "subId", expires_at
       FROM subcontractor_licence
       WHERE tenant_id = $1 AND expires_at >= $2 AND expires_at < $3`,
      [tenantId, range.from, range.to]
    );

    let expiredCohortCount = expiredRes.rows.length;
    let renewedCount = 0;

    for (const expired of expiredRes.rows) {
      const renewCheck = await this.pool.query(
        `SELECT id FROM subcontractor_licence
         WHERE tenant_id = $1 AND subcontractor_id = $2 AND valid_from >= $3 AND status = 'active'
         LIMIT 1`,
        [tenantId, expired.subId, expired.expires_at]
      );
      if (renewCheck.rows.length > 0) {
        renewedCount++;
      }
    }

    const renewalRate = MarketplaceAnalyticsPolicy.calculateConversionRate(renewedCount, expiredCohortCount);

    return {
      activeLicences,
      licencesIssued,
      licencesExpired,
      licencesSuspended,
      licencesRevoked,
      renewalRate
    };
  }

  /**
   * 6. GET TERRITORY ASSIGNMENT METRICS
   */
  public async getAssignment(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getAssignmentData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getAssignmentData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    const assignRes = await this.pool.query(
      `SELECT assignment_type as "type", status, lga_id as "lgaId", cluster_id as "clusterId"
       FROM subcontractor_assignment
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, range.from, range.to]
    );

    let activeAssignments = 0;
    let terminatedAssignments = 0;
    const activeLgas = new Set<string>();
    const activeClusters = new Set<string>();

    for (const a of assignRes.rows) {
      if (a.status === "active") {
        activeAssignments++;
        if (a.type === "lga" && a.lgaId) activeLgas.add(a.lgaId);
        if (a.type === "cluster" && a.clusterId) activeClusters.add(a.clusterId);
      } else {
        terminatedAssignments++;
      }
    }

    // Get denominators
    const lgaDenom = await this.pool.query("SELECT COUNT(*) FROM local_government_area WHERE tenant_id = $1", [tenantId]);
    const clusterDenom = await this.pool.query("SELECT COUNT(*) FROM cluster WHERE tenant_id = $1", [tenantId]);

    const totalLgas = Number(lgaDenom.rows[0].count);
    const totalClusters = Number(clusterDenom.rows[0].count);

    const lgaUtilizationRate = MarketplaceAnalyticsPolicy.calculateConversionRate(activeLgas.size, totalLgas);
    const clusterUtilizationRate = MarketplaceAnalyticsPolicy.calculateConversionRate(activeClusters.size, totalClusters);

    return {
      activeAssignments,
      assignedLgas: activeLgas.size,
      assignedClusters: activeClusters.size,
      terminatedAssignments,
      lgaUtilizationRate,
      clusterUtilizationRate
    };
  }

  /**
   * 7. GET FACILITY ACQUISITION METRICS
   */
  public async getAcquisition(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getAcquisitionData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getAcquisitionData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    const attrRes = await this.pool.query(
      `SELECT registration_status as "status", subcontractor_id as "subId", lga_id as "lgaId", cluster_id as "clusterId"
       FROM subcontractor_facility_attribution
       WHERE tenant_id = $1 AND attributed_at >= $2 AND attributed_at < $3`,
      [tenantId, range.from, range.to]
    );

    let totalRegistered = attrRes.rows.length;
    let completedAttributions = 0;
    let duplicateRegistrations = 0;
    let rejectedRegistrations = 0;
    const subsSet = new Set<string>();

    for (const a of attrRes.rows) {
      if (a.status === "completed") {
        completedAttributions++;
        subsSet.add(a.subId);
      }
      if (a.status === "duplicate") duplicateRegistrations++;
      if (a.status === "rejected") rejectedRegistrations++;
    }

    const uniqueAcquired = subsSet.size;

    return {
      totalRegistered,
      uniqueAcquired,
      completedAttributions,
      duplicateRegistrations,
      rejectedRegistrations,
      subcontractorCount: uniqueAcquired
    };
  }

  /**
   * 8. GET QUALITY & ENFORCEMENT METRICS
   */
  public async getQuality(tenantId: string, range: DateRange, filters: any): Promise<any> {
    this.validateRange(range);
    const data = await this.getQualityData(tenantId, range, filters);
    return this.wrapResponse(tenantId, range, filters, data);
  }

  private async getQualityData(tenantId: string, range: DateRange, _filters: any): Promise<any> {
    // 1. Performance scores average
    const scoreRes = await this.pool.query(
      `SELECT performance_score as "score" FROM subcontractor_profile
       WHERE tenant_id = $1 AND status = 'active' AND performance_score IS NOT NULL`,
      [tenantId]
    );

    const scores = scoreRes.rows.map(r => Number(r.score));
    let averagePerformanceScore = 0;
    if (scores.length > 0) {
      const sum = scores.reduce((a, b) => a + b, 0);
      averagePerformanceScore = Number((sum / scores.length).toFixed(2));
    }

    // Score distribution buckets
    const distribution = MarketplaceAnalyticsPolicy.SCORE_BUCKETS.map(bucket => {
      const count = scores.filter(s => s >= bucket.min && s <= bucket.max).length;
      return {
        bucket: bucket.label,
        count
      };
    });

    // 2. Quality Audits counts
    const auditRes = await this.pool.query(
      `SELECT status, auditor_type as "auditor"
       FROM subcontractor_quality_audit
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, range.from, range.to]
    );

    let auditsCompleted = 0;
    let aiAuditsConfirmed = 0;
    let aiAuditsOverturned = 0;

    for (const a of auditRes.rows) {
      if (a.status === "completed" || a.status === "confirmed") auditsCompleted++;
      if (a.status === "confirmed" && a.auditor === "ai") aiAuditsConfirmed++;
      if (a.status === "overturned" && a.auditor === "ai") aiAuditsOverturned++;
    }

    // 3. Enforcement actions
    const enfRes = await this.pool.query(
      `SELECT action_type as "type", status
       FROM subcontractor_enforcement_action
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, range.from, range.to]
    );

    let activeWarnings = 0;
    let restrictions = 0;
    let suspensions = 0;
    let revocations = 0;

    for (const e of enfRes.rows) {
      if (e.status === "active") {
        if (e.type === "warning") activeWarnings++;
        if (e.type === "restriction") restrictions++;
        if (e.type === "suspension") suspensions++;
        if (e.type === "revocation") revocations++;
      }
    }

    return {
      averagePerformanceScore,
      scoreDistribution: distribution,
      auditsCompleted,
      aiAuditsConfirmed,
      aiAuditsOverturned,
      activeWarnings,
      restrictions,
      suspensions,
      revocations
    };
  }
}
