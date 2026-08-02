import { Pool } from "pg";
import crypto from "node:crypto";
import { FacilityDuplicateDetectionService } from "./FacilityDuplicateDetectionService.js";

export interface RegisterFacilityDetails {
  businessName: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  description?: string;
  town: string;
  lgaId?: string;
  clusterId?: string;
}

export class SubcontractorFacilityRegistrationService {
  constructor(private pool: Pool) {
    // Proactively make sure request_hash column is added to the attribution table
    if (this.pool && this.pool.constructor && this.pool.constructor.name === "Pool") {
      const promise = this.pool.query(
        `ALTER TABLE subcontractor_facility_attribution ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64);`
      );
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
    }
  }

  /**
   * Performs atomic and idempotent facility registration.
   */
  public async registerFacility(
    tenantId: string,
    subcontractorId: string,
    facilityDetails: RegisterFacilityDetails,
    correlationId: string,
    idempotencyKey: string
  ): Promise<any> {
    const idempotencyKeyHash = crypto.createHash("sha256").update(idempotencyKey).digest("hex");
    const requestHash = crypto.createHash("sha256").update(JSON.stringify(facilityDetails)).digest("hex");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Check idempotency record
      const idempRes = await client.query(
        `SELECT a.*, f.business_name, f.category, f.address, f.latitude, f.longitude
         FROM subcontractor_facility_attribution a
         JOIN facility f ON f.id = a.facility_id
         WHERE a.tenant_id = $1 AND a.subcontractor_id = $2 AND a.idempotency_key_hash = $3`,
        [tenantId, subcontractorId, idempotencyKeyHash]
      );

      if (idempRes.rows.length > 0) {
        const existing = idempRes.rows[0];
        if (existing.request_hash !== requestHash) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        await client.query("COMMIT");
        return {
          id: existing.facility_id,
          businessName: existing.business_name,
          category: existing.category,
          address: existing.address,
          latitude: Number(existing.latitude),
          longitude: Number(existing.longitude),
          attribution: {
            id: existing.id,
            registrationStatus: existing.registration_status,
            registrationCorrelationId: existing.registration_correlation_id
          }
        };
      }

      // 2. Lock subcontractor profile FOR UPDATE
      const profileRes = await client.query(
        "SELECT * FROM subcontractor_profile WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, subcontractorId]
      );
      if (profileRes.rows.length === 0) {
        throw new Error("SUBCONTRACTOR_NOT_FOUND");
      }
      const profile = profileRes.rows[0];

      // 3. Verify active licence
      const licenceRes = await client.query(
        `SELECT * FROM subcontractor_licence 
         WHERE tenant_id = $1 AND subcontractor_id = $2 AND status = 'active'
         LIMIT 1`,
        [tenantId, subcontractorId]
      );
      if (licenceRes.rows.length === 0) {
        throw new Error("ACTIVE_LICENCE_REQUIRED");
      }
      const licence = licenceRes.rows[0];

      // 4. Verify active assignment covering the LGA or Cluster
      let assignment;
      if (facilityDetails.lgaId) {
        const assignRes = await client.query(
          `SELECT * FROM subcontractor_assignment 
           WHERE tenant_id = $1 AND subcontractor_id = $2 AND status = 'active'
             AND assignment_type = 'lga' AND lga_id = $3
           LIMIT 1`,
          [tenantId, subcontractorId, facilityDetails.lgaId]
        );
        if (assignRes.rows.length === 0) {
          throw new Error("GEOGRAPHIC_BOUNDARY_VIOLATION");
        }
        assignment = assignRes.rows[0];
      } else if (facilityDetails.clusterId) {
        const assignRes = await client.query(
          `SELECT * FROM subcontractor_assignment 
           WHERE tenant_id = $1 AND subcontractor_id = $2 AND status = 'active'
             AND assignment_type = 'cluster' AND cluster_id = $3
           LIMIT 1`,
          [tenantId, subcontractorId, facilityDetails.clusterId]
        );
        if (assignRes.rows.length === 0) {
          throw new Error("GEOGRAPHIC_BOUNDARY_VIOLATION");
        }
        assignment = assignRes.rows[0];
      } else {
        throw new Error("GEOGRAPHIC_BOUNDARY_VIOLATION");
      }
      // 4.5. Run duplicate detection
      let lgaName = "";
      if (facilityDetails.lgaId) {
        const lgaRes = await client.query(
          "SELECT name FROM local_government_area WHERE tenant_id = $1 AND id = $2",
          [tenantId, facilityDetails.lgaId]
        );
        if (lgaRes.rows.length > 0) {
          lgaName = lgaRes.rows[0].name;
        }
      }

      const dupService = new FacilityDuplicateDetectionService(this.pool);
      const dupCheck = await dupService.checkDuplicate({
        tenantId,
        businessName: facilityDetails.businessName,
        address: facilityDetails.address,
        lga: lgaName,
      });

      if (dupCheck.isDuplicate) {
        throw new Error("POTENTIAL_DUPLICATE_DETECTED");
      }

      // 5. Create Facility
      const orgRes = await client.query(
        "SELECT id FROM organization WHERE tenant_id = $1 LIMIT 1",
        [tenantId]
      );
      const organizationId = orgRes.rows[0]?.id;
      if (!organizationId) {
        throw new Error("ORGANIZATION_NOT_FOUND");
      }

      const userRes = await client.query(
        "SELECT id FROM user_account WHERE tenant_id = $1 LIMIT 1",
        [tenantId]
      );
      const createdBy = userRes.rows[0]?.id;
      if (!createdBy) {
        throw new Error("CREATOR_NOT_FOUND");
      }

      const facilityId = crypto.randomUUID();
      await client.query(
        `INSERT INTO facility (
           id, tenant_id, organization_id, owner_user_id, business_name, category,
           address, latitude, longitude, registration_status, created_by,
           registration_source, registered_by_subcontractor_id
         ) VALUES ($1, $2, $3, null, $4, $5, $6, $7, $8, 'pending', $9, 'subcontractor', $10)`,
        [
          facilityId,
          tenantId,
          organizationId,
          facilityDetails.businessName,
          facilityDetails.category,
          facilityDetails.address,
          facilityDetails.latitude,
          facilityDetails.longitude,
          createdBy,
          subcontractorId
        ]
      );

      // Create Facility Registration
      const refNum = `FAC-REG-${crypto.randomUUID().substring(0, 8).toUpperCase()}`;
      const subId = `sub-${crypto.randomUUID()}`;
      await client.query(
        `INSERT INTO facility_registration (
           tenant_id, facility_id, reference_number, client_submission_id, status, submitted_by,
           submitted_by_actor_type, submitted_by_actor_id, submission_channel, town, lga
         ) VALUES ($1, $2, $3, $4, 'submitted', $5, 'subcontractor', $6, 'web_portal', $7, $8)`,
        [tenantId, facilityId, refNum, subId, createdBy, subcontractorId, facilityDetails.town, lgaName]
      );

      // 6. Record Attribution
      const attrId = crypto.randomUUID();
      const scopeType = assignment.assignment_type;
      const scopeId = scopeType === "lga" ? assignment.lga_id : assignment.cluster_id;

      await client.query(
        `INSERT INTO subcontractor_facility_attribution (
           id, tenant_id, subcontractor_id, facility_id, licence_id, assignment_id,
           lga_id, cluster_id, registration_status, registration_correlation_id,
           idempotency_key_hash, request_hash, licence_number_snapshot, licence_valid_from_snapshot,
           licence_expires_at_snapshot, assignment_scope_type, assignment_scope_id,
           assignment_started_at_snapshot, subcontractor_name_snapshot
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 'completed', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
         )`,
        [
          attrId,
          tenantId,
          subcontractorId,
          facilityId,
          licence.id,
          assignment.id,
          assignment.lga_id,
          assignment.cluster_id,
          correlationId,
          idempotencyKeyHash,
          requestHash,
          licence.licence_number,
          licence.valid_from,
          licence.expires_at,
          scopeType,
          scopeId,
          assignment.starts_at,
          profile.business_name
        ]
      );

      // 7. Write first facility completed event if applicable
      const countRes = await client.query(
        `SELECT COUNT(*) FROM subcontractor_facility_attribution 
         WHERE tenant_id = $1 AND subcontractor_id = $2 AND registration_status = 'completed'`,
        [tenantId, subcontractorId]
      );
      if (Number(countRes.rows[0].count) === 1) {
        await client.query(
          `INSERT INTO subcontractor_application_event (
             tenant_id, application_id, event_type, event_key, correlation_id, actor_type, new_state
           ) VALUES ($1, $2, 'facility.first_completed', $3, $4, 'system', 'backfilled')
           ON CONFLICT DO NOTHING`,
          [
            tenantId,
            profile.application_id,
            `facility.first_completed:${facilityId}`,
            correlationId
          ]
        );
      }

      await client.query("COMMIT");
      return {
        id: facilityId,
        businessName: facilityDetails.businessName,
        category: facilityDetails.category,
        address: facilityDetails.address,
        latitude: facilityDetails.latitude,
        longitude: facilityDetails.longitude,
        attribution: {
          id: attrId,
          registrationStatus: "completed",
          registrationCorrelationId: correlationId
        }
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
