import { Pool } from "pg";
import * as crypto from "node:crypto";
import { AccessTokenService } from "./security-service.js";
import { MarketplaceScreeningInputV1 } from "./screening-contracts.js";

function toCanonicalJson(val: any): any {
  if (val === null || typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(toCanonicalJson);
  }
  const keys = Object.keys(val).sort();
  const res: any = {};
  for (const key of keys) {
    res[key] = toCanonicalJson(val[key]);
  }
  return res;
}

export class SubmissionService {
  constructor(private pool: Pool) {}

  public async submitApplication(
    tenantId: string,
    applicationId: string,
    plaintextToken: string,
    expectedVersion: number,
    correlationId: string
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Verify tenant status
      const tenantRes = await client.query(
        "SELECT status FROM tenant WHERE id = $1",
        [tenantId]
      );
      if (tenantRes.rows.length === 0) {
        throw new Error("Tenant not found");
      }
      if (tenantRes.rows[0].status === "suspended") {
        throw new Error("Tenant is suspended");
      }

      // 2. Fetch application with lock
      const appRes = await client.query(
        "SELECT * FROM subcontractor_application WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, applicationId]
      );
      if (appRes.rows.length === 0) {
        throw new Error("Subcontractor application not found");
      }
      const app = appRes.rows[0];

      // 3. Verify access token hash
      const clientHash = AccessTokenService.hashToken(plaintextToken);
      if (!AccessTokenService.timingSafeCompare(app.access_token_hash, clientHash)) {
        throw new Error("Invalid access token");
      }

      // 4. Verify version concurrency
      if (Number(app.version) !== expectedVersion) {
        throw new Error("Version mismatch conflict");
      }

      // 5. Verify status is draft or more_information_required
      if (!["draft", "more_information_required"].includes(app.status)) {
        throw new Error(`Application in state '${app.status}' cannot be submitted`);
      }

      // 6. Verify required fields are filled
      const requiredFields = [
        "business_name",
        "registration_number",
        "tax_identifier",
        "contact_email",
        "contact_phone",
        "operating_address",
        "experience_years",
        "license_type"
      ];
      for (const field of requiredFields) {
        if (!app[field] && app[field] !== 0) {
          throw new Error(`Missing mandatory field: '${field}'`);
        }
      }

      // 7. Verify documents scan status
      const docsRes = await client.query(
        "SELECT * FROM subcontractor_application_document WHERE tenant_id = $1 AND application_id = $2 AND superseded_at IS NULL",
        [tenantId, applicationId]
      );
      if (docsRes.rows.length === 0) {
        throw new Error("At least one supporting compliance document is required for submission");
      }
      for (const doc of docsRes.rows) {
        if (doc.scan_status === "failed") {
          throw new Error("Cannot submit application containing documents that failed safety scans");
        }
      }

      // 8. Construct versioned screening snapshot contract V1
      const snapshotInput: MarketplaceScreeningInputV1 = {
        schemaVersion: "1",
        tenantId: app.tenant_id,
        applicationId: app.id,
        applicationVersion: app.version,
        business: {
          name: app.business_name,
          registrationNumber: app.registration_number,
          taxIdentifier: app.tax_identifier,
          operatingAddress: app.operating_address,
          experienceYears: app.experience_years,
          licenceType: app.license_type
        },
        documents: docsRes.rows.map(doc => ({
          documentType: doc.document_type,
          contentHash: doc.content_hash,
          verificationStatus: doc.verification_status,
          scanStatus: doc.scan_status
        })),
        declarations: {
          accepted: true
        }
      };

      const canonicalPayloadStr = JSON.stringify(toCanonicalJson(snapshotInput));
      const snapshotHash = crypto.createHash("sha256").update(canonicalPayloadStr).digest("hex");

      // 9. Store immutable snapshot
      const insertSnapshotQuery = `
        INSERT INTO subcontractor_application_snapshot (
          tenant_id, application_id, application_version, input_schema_version, canonical_payload, input_snapshot_hash
        ) VALUES ($1, $2, $3, '1', $4, $5)
      `;
      await client.query(insertSnapshotQuery, [
        tenantId,
        applicationId,
        app.version,
        JSON.stringify(snapshotInput),
        snapshotHash
      ]);

      // 10. Commit outbox event with deterministic deduplication key
      const deKey = `marketplace-screening:${tenantId}:${applicationId}:${app.version}`;
      const insertOutboxQuery = `
        INSERT INTO outbox_event (
          tenant_id, aggregate_type, aggregate_id, event_type, payload, deduplication_key, status
        ) VALUES ($1, 'subcontractor_application', $2, 'subcontractor_application.submitted', $3, $4, 'pending')
      `;
      await client.query(insertOutboxQuery, [
        tenantId,
        applicationId,
        JSON.stringify(snapshotInput),
        deKey
      ]);

      // 11. Perform update to screening_queued
      const oldStatus = app.status;
      await client.query(
        `UPDATE subcontractor_application 
         SET status = 'screening_queued', version = version + 1, updated_at = NOW() 
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, applicationId]
      );

      // 12. Append event history
      await client.query(
        `INSERT INTO subcontractor_application_event (
          tenant_id, application_id, actor_type, actor_id, previous_state, new_state, reason, correlation_id, event_type, event_key
        ) VALUES ($1, $2, 'system', null, $3, 'screening_queued', 'Applicant submitted application form; queued for AI screening', $4, 'application.submitted', $5)`,
        [tenantId, applicationId, oldStatus, correlationId, 'application.submitted:' + correlationId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
