import { Pool } from "pg";
import { loadConfig } from "@govos/configuration";
import { logger } from "@govos/observability";
import { MigrationRunner } from "./index.js";

async function run() {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.database.DATABASE_URL,
  });

  const runner = new MigrationRunner();
  try {
    const count = await runner.migrate(pool);
    logger.info({ count }, "Migrations verification run complete.");
    process.exit(0);
  } catch (error) {
    logger.fatal({ err: error }, "Migrations run encountered fatal error.");
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
