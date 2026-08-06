import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { ReadinessCheckResult } from "@govos/domain";
import { MigrationRunner } from "@govos/database";
import { logger } from "@govos/observability";

export * from "./development-mailbox.js";
export * from "./notifications/index.js";
export function createDatabasePool(config: Config): Pool {
  logger.info("Initializing database connection pool");
  return new Pool({
    connectionString: config.database.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export async function checkReadiness(
  pool: Pool,
): Promise<ReadinessCheckResult> {
  const result: ReadinessCheckResult = {
    status: "not_ready",
    postgres: "disconnected",
    migrations: "unknown",
    timestamp: new Date().toISOString(),
  };

  try {
    // 1. Check PostgreSQL connectivity (Read-Only probe)
    await pool.query("SELECT 1");
    result.postgres = "connected";

    // 2. Query applied migrations
    const client = await pool.connect();
    try {
      const runner = new MigrationRunner();
      // Ensure migrations metadata table exists
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'schema_migrations'
        )
      `);

      if (!tableCheck.rows[0]?.exists) {
        result.migrations = "pending";
      } else {
        const applied = await runner.getAppliedMigrations(client);
        const files = runner.getMigrationFiles();

        let pending = false;
        for (const file of files) {
          if (!applied.has(file.version)) {
            pending = true;
            break;
          }
        }

        result.migrations = pending ? "pending" : "current";
      }
    } finally {
      client.release();
    }

    if (result.postgres === "connected" && result.migrations === "current") {
      result.status = "ready";
    }
  } catch (error) {
    logger.warn(
      { err: error },
      "Readiness check failed database connection diagnostics",
    );
    result.postgres = "disconnected";
    result.status = "not_ready";
  }

  return result;
}
