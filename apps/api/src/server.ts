import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { logger } from "@govos/observability";
import { createApp } from "./app.js";

export async function startServer(config: Config, pool: Pool): Promise<void> {
  const app = createApp(config, pool);

  try {
    await app.listen({
      port: config.api.PORT,
      host: "0.0.0.0", // Required for container networks
    });
    logger.info(
      { port: config.api.PORT },
      "GovOS API application successfully started",
    );
  } catch (err) {
    logger.fatal({ err }, "Failed to start GovOS API server");
    throw err;
  }

  // Graceful Shutdown Mechanics
  const shutdown = async (signal: string) => {
    logger.warn({ signal }, "Initiating graceful shutdown sequence");

    // Enforce hard timeout limits
    const timer = setTimeout(() => {
      logger.error(
        "Graceful shutdown exceeded timeout limit. Forcing termination.",
      );
      process.exit(1);
    }, 10000);

    try {
      // 1. Refuse incoming HTTP traffic
      await app.close();
      logger.info("API server HTTP listeners closed");

      // 2. Terminate PostgreSQL database pools
      await pool.end();
      logger.info("Database pools connection client pool ended");

      clearTimeout(timer);
      logger.info("Graceful shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error encountered during server shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
