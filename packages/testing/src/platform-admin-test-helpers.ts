import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createApp } from "@govos/api/app";

const mockConfig: any = {
  appEnv: "local",
  database: { DATABASE_URL: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db" },
  observability: { LOG_LEVEL: "info" },
  ai: { AI_PROVIDER: "deterministic", GEMINI_MODEL_ID: "gemini-1.5-flash" },
  api: { PORT: 8080 },
  worker: { WORKER_PORT: 8081, WORKER_AUTH_MODE: "local" },
};

export async function setupTestEnvironment(pool: Pool) {
  const app = createApp(mockConfig, pool);
  return { app };
}

export async function createTestTenant(pool: Pool, status: string = "active"): Promise<{ id: string; version: number }> {
  const id = randomUUID();
  const name = `Tenant-${id.slice(0, 8)}`;
  const slug = `slug-${id.slice(0, 8)}`;
  const res = await pool.query(
    `INSERT INTO tenant (id, name, slug, type, status, session_version, version)
     VALUES ($1, $2, $3, 'ministry', $4, 1, 1)
     RETURNING id, version`,
    [id, name, slug, status]
  );

  // Seed authoritative LGAs for this tenant
  await pool.query(
    `INSERT INTO local_government_area (tenant_id, name, state_name)
     VALUES 
     ($1, 'Awka South', 'Anambra'),
     ($1, 'Onitsha North', 'Anambra'),
     ($1, 'Nnewi North', 'Anambra')`,
    [id]
  );

  // Seed authoritative clusters for this tenant
  await pool.query(
    `INSERT INTO cluster (tenant_id, name, region_details)
     VALUES 
     ($1, 'Central Industrial Zone', 'Covers industrial zones in Awka and environs'),
     ($1, 'North Waste Management Cluster', 'Covers municipal waste zones in Onitsha')`,
    [id]
  );

  return { id: res.rows[0].id, version: res.rows[0].version };
}

export async function createTestUser(pool: Pool, tenantId: string, status: string = "active"): Promise<string> {
  const id = randomUUID();
  const email = `user-${id.slice(0, 8)}@gov.ng`;
  await pool.query(
    `INSERT INTO user_account (id, tenant_id, email, password_hash, status, first_name, last_name)
     VALUES ($1, $2, $3, 'hash', $4, 'Test', 'User')`,
    [id, tenantId, email, status]
  );
  return id;
}

export async function assignPlatformRole(pool: Pool, userId: string, roleName: string): Promise<void> {
  await pool.query(
    `INSERT INTO platform_role_assignment (user_id, role_name, assignment_status)
     VALUES ($1, $2, 'active')`,
    [userId, roleName]
  );
}

export async function createTestSession(pool: Pool, tenantId: string, userId: string): Promise<string> {
  const token = `test-token-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO session (id, tenant_id, user_id, token, expires_at, session_version)
     VALUES ($1, $2, $3, $4, $5, 1)`,
    [randomUUID(), tenantId, userId, token, expiresAt]
  );
  return token;
}

export async function setupAuthUser(pool: Pool, roleName?: string, tenantStatus: string = "active") {
  const { id: tenantId, version: tenantVersion } = await createTestTenant(pool, tenantStatus);
  const userId = await createTestUser(pool, tenantId);
  if (roleName) {
    await assignPlatformRole(pool, userId, roleName);
  }
  const token = await createTestSession(pool, tenantId, userId);
  return { tenantId, tenantVersion, userId, token };
}
