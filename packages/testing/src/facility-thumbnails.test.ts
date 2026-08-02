import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import crypto from "node:crypto";
import { setupTestEnvironment, setupAuthUser, createTestTenant, createTestUser, createTestSession } from "./platform-admin-test-helpers.js";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

async function assignTenantRole(pool: Pool, userId: string, roleName: string, tenantId: string) {
  const roleRes = await pool.query("SELECT id FROM role WHERE name = $1 AND tenant_id = $2", [roleName, tenantId]);
  let roleId: string;
  if (roleRes.rows.length > 0) {
    roleId = roleRes.rows[0].id;
  } else {
    roleId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO role (id, tenant_id, name, description, is_system) VALUES ($1, $2, $3, $4, TRUE)",
      [roleId, tenantId, roleName, `Canonical ${roleName} test role`]
    );
  }
  await pool.query(
    "INSERT INTO membership (id, user_id, role_id, tenant_id) VALUES ($1, $2, $3, $4)",
    [crypto.randomUUID(), userId, roleId, tenantId]
  );
  const tenantMatch = await pool.query(
    `SELECT 1 FROM membership m
     JOIN user_account u ON u.id = m.user_id
     JOIN role r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.tenant_id = $2
       AND u.tenant_id = m.tenant_id AND r.tenant_id = m.tenant_id`,
    [userId, tenantId]
  );
  if (tenantMatch.rowCount !== 1) throw new Error("Test membership must use a role from the same tenant");
}

describe("Facility Thumbnails API Integration Tests", () => {
  let pool: Pool;
  let app: any;

  // Tenant A references
  let tenantAId: string;
  let tokenA: string;
  let userAId: string;
  let orgAId: string;
  let facilityA1Id: string;
  let facilityA2Id: string;

  // Tenant B references
  let tenantBId: string;
  let tokenB: string;
  let userBId: string;
  let orgBId: string;
  let facilityBId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    const env = await setupTestEnvironment(pool);
    app = env.app;

    // Set up Tenant A
    const authA = await setupAuthUser(pool);
    tenantAId = authA.tenantId;
    tokenA = authA.token;
    userAId = authA.userId;
    await assignTenantRole(pool, userAId, "super_admin", tenantAId);

    orgAId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO organization (id, tenant_id, name, status) VALUES ($1, $2, 'Org A', 'active')`,
      [orgAId, tenantAId]
    );

    // Create Tenant A Facilities
    facilityA1Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO facility (id, tenant_id, organization_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, registration_source, created_by, registered_by_user_id)
       VALUES ($1, $2, $3, 'Facility A1 with Image', 'hospitality', '123 A1 St', 6.2, 7.0, 'approved', 'low', 'officer', $4, $4)`,
      [facilityA1Id, tenantAId, orgAId, userAId]
    );

    facilityA2Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO facility (id, tenant_id, organization_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, registration_source, created_by, registered_by_user_id)
       VALUES ($1, $2, $3, 'Facility A2 without Image', 'waste_management', '456 A2 St', 6.2, 7.0, 'approved', 'medium', 'officer', $4, $4)`,
      [facilityA2Id, tenantAId, orgAId, userAId]
    );

    // Set up Tenant B
    tenantBId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO tenant (id, name, slug, type, status) VALUES ($1, 'Tenant B', 'tenant-b', 'ministry', 'active')`,
      [tenantBId]
    );
    userBId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name)
       VALUES ($1, $2, 'userb@tenantb.com', 'dummyhash', 'User', 'B')`,
      [userBId, tenantBId]
    );
    await assignTenantRole(pool, userBId, "super_admin", tenantBId);
    tokenB = crypto.randomUUID();
    await pool.query(
      `INSERT INTO session (id, tenant_id, user_id, token, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 day')`,
      [crypto.randomUUID(), tenantBId, userBId, tokenB]
    );

    orgBId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO organization (id, tenant_id, name, status) VALUES ($1, $2, 'Org B', 'active')`,
      [orgBId, tenantBId]
    );

    facilityBId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO facility (id, tenant_id, organization_id, business_name, category, address, latitude, longitude, registration_status, risk_rating, registration_source, created_by, registered_by_user_id)
       VALUES ($1, $2, $3, 'Facility B with Image', 'hospitality', '789 B St', 6.2, 7.0, 'approved', 'low', 'officer', $4, $4)`,
      [facilityBId, tenantBId, orgBId, userBId]
    );
  });

  afterAll(async () => {
    try {
      // Delete both tenant fixtures in the same deterministic dependency order.
      const tenantIds = [tenantAId, tenantBId];
      await pool.query("DELETE FROM facility_document WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM facility WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM organization WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM session WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM membership WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM user_account WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM role WHERE tenant_id = ANY($1::uuid[]) AND name = 'super_admin'", [tenantIds]);
      await pool.query("DELETE FROM local_government_area WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM cluster WHERE tenant_id = ANY($1::uuid[])", [tenantIds]);
      await pool.query("DELETE FROM tenant WHERE id = ANY($1::uuid[])", [tenantIds]);
    } finally {
      await pool.end();
    }
  });

  test("1. Facility with primary image returns image metadata", async () => {
    const docId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO facility_document (id, tenant_id, facility_id, document_name, storage_path, file_size_bytes, mime_type, created_by)
       VALUES ($1, $2, $3, 'image.jpg', '/zebos_hotel_demo.jpg', 10240, 'image/jpeg', $4)`,
      [docId, tenantAId, facilityA1Id, userAId]
    );

    // Query list
    const listRes = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(listRes.statusCode).toBe(200);
    const listData = JSON.parse(listRes.payload);
    
    const facA1 = listData.items.find((f: any) => f.id === facilityA1Id);
    expect(facA1).toBeDefined();
    expect(facA1.primaryImageUrl).toBe("/zebos_hotel_demo.jpg");

    // Query single
    const singleRes = await app.inject({
      method: "GET",
      url: `/facilities/${facilityA1Id}`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(singleRes.statusCode).toBe(200);
    const singleData = JSON.parse(singleRes.payload);
    expect(singleData.primaryImageUrl).toBe("/zebos_hotel_demo.jpg");
  });

  test("2. Facility without image returns null safely", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(listRes.statusCode).toBe(200);
    const listData = JSON.parse(listRes.payload);

    const facA2 = listData.items.find((f: any) => f.id === facilityA2Id);
    expect(facA2).toBeDefined();
    expect(facA2.primaryImageUrl).toBeNull();
  });

  test("3. Tenant A cannot receive Tenant B image (cross-tenant isolation)", async () => {
    // Add document for Tenant B's facility
    const docBId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO facility_document (id, tenant_id, facility_id, document_name, storage_path, file_size_bytes, mime_type, created_by)
       VALUES ($1, $2, $3, 'image_b.jpg', '/tenant_b_image.jpg', 10240, 'image/jpeg', $4)`,
      [docBId, tenantBId, facilityBId, userBId]
    );

    // Tenant A queries facilities, should not see Tenant B's facility or images
    const listResA = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const listDataA = JSON.parse(listResA.payload);
    const facBForA = listDataA.items.find((f: any) => f.id === facilityBId);
    expect(facBForA).toBeUndefined();

    // Tenant B queries facilities, should see their own facility image
    const listResB = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${tokenB}` }
    });
    const listDataB = JSON.parse(listResB.payload);
    const facBForB = listDataB.items.find((f: any) => f.id === facilityBId);
    expect(facBForB).toBeDefined();
    expect(facBForB.primaryImageUrl).toBe("/tenant_b_image.jpg");
  });

  test("4. Deleted or non-image document does not return as thumbnail", async () => {
    // Add a non-image document to Facility A1
    await pool.query(
      `INSERT INTO facility_document (id, tenant_id, facility_id, document_name, storage_path, file_size_bytes, mime_type, created_by)
       VALUES ($1, $2, $3, 'report.pdf', '/report.pdf', 50000, 'application/pdf', $4)`,
      [crypto.randomUUID(), tenantAId, facilityA1Id, userAId]
    );

    // Query list: Facility A1 should still return /zebos_hotel_demo.jpg because the PDF is ignored
    const listRes1 = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const listData1 = JSON.parse(listRes1.payload);
    const facA1_1 = listData1.items.find((f: any) => f.id === facilityA1Id);
    expect(facA1_1.primaryImageUrl).toBe("/zebos_hotel_demo.jpg");

    // Soft delete the image document
    await pool.query(
      `UPDATE facility_document SET deleted_at = NOW() WHERE facility_id = $1 AND mime_type = 'image/jpeg'`,
      [facilityA1Id]
    );

    // Query list: Facility A1 primaryImageUrl should now be null since the image is deleted
    const listRes2 = await app.inject({
      method: "GET",
      url: "/facilities",
      headers: { authorization: `Bearer ${tokenA}` }
    });
    const listData2 = JSON.parse(listRes2.payload);
    const facA1_2 = listData2.items.find((f: any) => f.id === facilityA1Id);
    expect(facA1_2.primaryImageUrl).toBeNull();
  });
});
