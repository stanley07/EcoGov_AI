import { Pool } from "pg";
import * as crypto from "node:crypto";
import { 
  SubcontractorLicence, 
  SubcontractorProfile
} from "@govos/domain";

export class LicenceIssuanceService {
  constructor(private pool: Pool) {}

  public async issueLicence(
    tenantId: string,
    applicationId: string,
    invoiceId: string,
    paymentId: string,
    correlationId: string,
    applicationVersion?: number
  ): Promise<{ subcontractorProfile: SubcontractorProfile; subcontractorLicence: SubcontractorLicence }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Idempotency: Check if a licence is already generated for this invoice/payment
      const existingLicenceRes = await client.query(
        "SELECT * FROM subcontractor_licence WHERE tenant_id = $1 AND invoice_id = $2",
        [tenantId, invoiceId]
      );
      if (existingLicenceRes.rows.length > 0) {
        const licence = existingLicenceRes.rows[0];
        const profileRes = await client.query(
          "SELECT * FROM subcontractor_profile WHERE tenant_id = $1 AND id = $2",
          [tenantId, licence.subcontractor_id]
        );
        await client.query("COMMIT");
        
        // Map database row keys to camelCase domain model keys
        const mappedProfile: SubcontractorProfile = {
          id: profileRes.rows[0].id,
          tenantId: profileRes.rows[0].tenant_id,
          applicationId: profileRes.rows[0].application_id,
          businessName: profileRes.rows[0].business_name,
          status: profileRes.rows[0].status,
          performanceScore: profileRes.rows[0].performance_score,
          version: profileRes.rows[0].version,
          createdAt: profileRes.rows[0].created_at,
          updatedAt: profileRes.rows[0].updated_at
        };
        const mappedLicence: SubcontractorLicence = {
          id: licence.id,
          tenantId: licence.tenant_id,
          subcontractorId: licence.subcontractor_id,
          invoiceId: licence.invoice_id,
          licenceNumber: licence.licence_number,
          verificationCode: licence.verification_code,
          licenceType: licence.licence_type,
          status: licence.status,
          issuedAt: licence.issued_at,
          validFrom: licence.valid_from,
          expiresAt: licence.expires_at,
          version: licence.version,
          createdAt: licence.created_at,
          updatedAt: licence.updated_at,
          workerIssueDuration: licence.worker_issue_duration_ms
        };

        return { subcontractorProfile: mappedProfile, subcontractorLicence: mappedLicence };
      }

      const startWorker = Date.now();

      // Check 1: Verify tenant status
      const tenantRes = await client.query(
        "SELECT status FROM tenant WHERE id = $1",
        [tenantId]
      );
      if (tenantRes.rows.length === 0) {
        throw new Error("PREREQUISITE_FAILED: Tenant not found");
      }
      if (tenantRes.rows[0].status === "suspended") {
        throw new Error("PREREQUISITE_FAILED: Tenant is suspended");
      }

      // Check 2: Fetch and lock application, and verify eligible status
      const appRes = await client.query(
        "SELECT * FROM subcontractor_application WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, applicationId]
      );
      if (appRes.rows.length === 0) {
        throw new Error("PREREQUISITE_FAILED: Subcontractor application not found");
      }
      const app = appRes.rows[0];

      // Eligible statuses include approved, payment_confirmed, or licence_issued (for outbox replay)
      if (!["approved", "payment_confirmed", "licence_issued"].includes(app.status)) {
        throw new Error(`PREREQUISITE_FAILED: Application status '${app.status}' is not eligible for licensing`);
      }

      // Check 3: Verify application version matches the outbox payload version
      if (applicationVersion !== undefined && Number(app.version) !== Number(applicationVersion)) {
        throw new Error(`PREREQUISITE_FAILED: Application version mismatch (expected: ${applicationVersion}, actual: ${app.version})`);
      }

      // Check 4: Verify immutable snapshot exists
      const snapshotRes = await client.query(
        "SELECT id FROM subcontractor_application_snapshot WHERE tenant_id = $1 AND application_id = $2",
        [tenantId, applicationId]
      );
      if (snapshotRes.rows.length === 0) {
        throw new Error("PREREQUISITE_FAILED: Application snapshot not found");
      }

      // Check 5: Verify latest screening is completed
      const screeningRes = await client.query(
        `SELECT * FROM subcontractor_screening_result 
         WHERE tenant_id = $1 AND application_id = $2 
         ORDER BY screened_at DESC LIMIT 1`,
        [tenantId, applicationId]
      );
      if (screeningRes.rows.length === 0) {
        throw new Error("PREREQUISITE_FAILED: Screening result not found");
      }
      const screening = screeningRes.rows[0];
      if (screening.screening_status !== "completed") {
        throw new Error("PREREQUISITE_FAILED: Asynchronous AI screening did not complete successfully");
      }

      // Check 6: Verify invoice exists & Check 7: Verify invoice paid
      const invoiceRes = await client.query(
        "SELECT * FROM marketplace_invoice WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, invoiceId]
      );
      if (invoiceRes.rows.length === 0) {
        throw new Error("PREREQUISITE_FAILED: Marketplace invoice not found");
      }
      const invoice = invoiceRes.rows[0];
      if (invoice.application_id !== applicationId) {
        throw new Error("PREREQUISITE_FAILED: Invoice does not belong to this application");
      }
      if (invoice.status !== "paid") {
        throw new Error(`PREREQUISITE_FAILED: Invoice status is not paid (current: '${invoice.status}')`);
      }

      // Check 8: Verify payment exists and status is succeeded
      const paymentRes = await client.query(
        "SELECT * FROM marketplace_payment WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, paymentId]
      );
      if (paymentRes.rows.length === 0) {
        throw new Error("PREREQUISITE_FAILED: Marketplace payment record not found");
      }
      const payment = paymentRes.rows[0];
      if (payment.invoice_id !== invoiceId) {
        throw new Error("PREREQUISITE_FAILED: Payment is not mapped to this invoice");
      }
      if (payment.status !== "succeeded") {
        throw new Error(`PREREQUISITE_FAILED: Payment is in invalid state: '${payment.status}'`);
      }

      // Check 9: Verify provider is supported (e.g. stripe)
      if (!["stripe"].includes(payment.provider)) {
        throw new Error(`PREREQUISITE_FAILED: Invalid payment provider '${payment.provider}'`);
      }

      // Verify amount and currency
      if (Number(payment.amount_paid_microunits) !== Number(invoice.amount_due_microunits)) {
        throw new Error("PREREQUISITE_FAILED: Payment amount mismatch");
      }
      if (payment.currency !== invoice.currency) {
        throw new Error("PREREQUISITE_FAILED: Payment currency mismatch");
      }

      // Resolve profile
      let profile: SubcontractorProfile;
      const profileRes = await client.query(
        "SELECT * FROM subcontractor_profile WHERE tenant_id = $1 AND application_id = $2 FOR UPDATE",
        [tenantId, applicationId]
      );
      if (profileRes.rows.length === 0) {
        const insertProfileQuery = `
          INSERT INTO subcontractor_profile (tenant_id, application_id, business_name, status, version)
          VALUES ($1, $2, $3, 'active', 1)
          RETURNING id, tenant_id as "tenantId", application_id as "applicationId", business_name as "businessName", status, performance_score as "performanceScore", version, created_at as "createdAt", updated_at as "updatedAt"
        `;
        const profileInsert = await client.query(insertProfileQuery, [
          tenantId,
          applicationId,
          app.business_name
        ]);
        profile = profileInsert.rows[0];
      } else {
        profile = {
          id: profileRes.rows[0].id,
          tenantId: profileRes.rows[0].tenant_id,
          applicationId: profileRes.rows[0].application_id,
          businessName: profileRes.rows[0].business_name,
          status: profileRes.rows[0].status,
          performanceScore: profileRes.rows[0].performance_score,
          version: profileRes.rows[0].version,
          createdAt: profileRes.rows[0].created_at,
          updatedAt: profileRes.rows[0].updated_at
        };
      }

      // Check 10: Verify licence for billing period does not already exist
      const activeLicenceCheck = await client.query(
        `SELECT id FROM subcontractor_licence 
         WHERE tenant_id = $1 AND subcontractor_id = $2 AND status = 'active' 
         AND expires_at > NOW()`,
        [tenantId, profile.id]
      );
      if (activeLicenceCheck.rows.length > 0) {
        throw new Error("PREREQUISITE_FAILED: An active licence already exists for this subcontractor");
      }

      // Generate Licence Number and Verification Code
      const currentYear = new Date().getFullYear();
      const randomSegment = crypto.randomBytes(3).toString("hex").toUpperCase();
      const licenceNumber = `LIC-ENV-${currentYear}-${randomSegment}`;
      const verificationCode = crypto.randomBytes(16).toString("hex");

      const workerIssueDuration = Date.now() - startWorker;

      const insertLicenceQuery = `
        INSERT INTO subcontractor_licence (
          tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at, version, worker_issue_duration_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW(), NOW(), NOW() + interval '1 year', 1, $7)
        RETURNING id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", invoice_id as "invoiceId", licence_number as "licenceNumber", verification_code as "verificationCode", licence_type as "licenceType", status, issued_at as "issuedAt", valid_from as "validFrom", expires_at as "expiresAt", version, created_at as "createdAt", updated_at as "updatedAt", worker_issue_duration_ms as "workerIssueDuration"
      `;
      const licenceRes = await client.query(insertLicenceQuery, [
        tenantId,
        profile.id,
        invoice.id,
        licenceNumber,
        verificationCode,
        app.license_type,
        workerIssueDuration
      ]);
      const licence = licenceRes.rows[0];

      // Update application state
      const oldStatus = app.status;
      await client.query(
        "UPDATE subcontractor_application SET status = 'licence_issued', version = version + 1, updated_at = NOW() WHERE tenant_id = $1 AND id = $2",
        [tenantId, applicationId]
      );

      // Log application lifecycle event
      const insertEventQuery = `
        INSERT INTO subcontractor_application_event (
          tenant_id, application_id, actor_type, actor_id, previous_state, new_state, reason, correlation_id, event_type, event_key
        ) VALUES ($1, $2, 'payment_provider', null, $3, 'licence_issued', $4, $5, 'licence.issued', $6)
      `;
      await client.query(insertEventQuery, [
        tenantId,
        applicationId,
        oldStatus,
        `Licence successfully generated: ${licenceNumber}`,
        correlationId,
        'licence.issued:' + correlationId
      ]);

      await client.query("COMMIT");
      return { subcontractorProfile: profile, subcontractorLicence: licence };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
