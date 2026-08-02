import { Pool } from "pg";

export interface DuplicateCheckInput {
  tenantId: string;
  businessName: string;
  address: string;
  lga: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingFacilityId?: string;
  confidence?: "high" | "medium";
}

export class FacilityDuplicateDetectionService {
  constructor(private pool: Pool) {}

  /**
   * Checks if there is an existing facility with matching normalized name, address, and LGA.
   */
  public async checkDuplicate(input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
    const normalizedName = input.businessName.trim().toLowerCase();
    const normalizedAddress = input.address.trim().toLowerCase();
    const normalizedLga = input.lga.trim().toLowerCase();

    // Query for matches by joining facility and facility_registration tables
    const query = `
      SELECT f.id
      FROM facility f
      LEFT JOIN facility_registration r ON r.tenant_id = f.tenant_id AND r.facility_id = f.id
      WHERE f.tenant_id = $1
        AND LOWER(TRIM(f.business_name)) = $2
        AND LOWER(TRIM(f.address)) = $3
        AND LOWER(TRIM(r.lga)) = $4
        AND f.deleted_at IS NULL
      LIMIT 1
    `;

    const res = await this.pool.query(query, [
      input.tenantId,
      normalizedName,
      normalizedAddress,
      normalizedLga,
    ]);

    if (res.rows.length > 0) {
      return {
        isDuplicate: true,
        existingFacilityId: res.rows[0].id,
        confidence: "high",
      };
    }

    return { isDuplicate: false };
  }
}
