import { loadConfig } from "@govos/configuration";
import { createDatabasePool } from "@govos/infrastructure";
import { logger } from "@govos/observability";
import { startServer } from "./server.js";

async function main() {
  logger.info("Initializing GovOS Worker process");
  try {
    const config = loadConfig();
    const pool = createDatabasePool(config);
    await startServer(config, pool);
  } catch (error) {
    logger.fatal({ err: error }, "Failed to bootstrap GovOS Worker service");
    process.exit(1);
  }
}

main();
