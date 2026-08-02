import { Pool } from "pg";
import { Config } from "@govos/configuration";
import { logger } from "@govos/observability";
import { createApp } from "./app.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function logStartupMetadata(app: any, pool: Pool) {
  try {
    const srcFile = path.resolve(__dirname, "../src/server.ts");
    const distFile = path.resolve(__dirname, "./server.js");
    let isStale = false;
    let distModified = "";
    if (fs.existsSync(srcFile) && fs.existsSync(distFile)) {
      const srcStat = fs.statSync(srcFile);
      const distStat = fs.statSync(distFile);
      distModified = new Date(distStat.mtimeMs).toISOString();
      if (srcStat.mtimeMs > distStat.mtimeMs) {
        isStale = true;
      }
    }

    const packageJsonPath = path.resolve(__dirname, "../package.json");
    let apiVersion = "0.1.0";
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      apiVersion = packageJson.version || "0.1.0";
    }

    const routeTree = app.printRoutes();
    const routeCount = (routeTree.match(/──/g) || []).length;

    const migrationRes = await pool.query("SELECT MAX(version) as max_version FROM schema_migrations");
    const maxVersion = migrationRes.rows[0]?.max_version || 0;

    logger.info({
      apiVersion,
      buildTimestamp: distModified,
      routeCount,
      databaseMigrationVersion: maxVersion,
      staleBinaryWarning: isStale ? "⚠️ SOURCE CODE MODIFIED SINCE LAST BUILD" : "OK"
    }, "GovOS API startup diagnostic metadata");

    if (isStale) {
      logger.error(
        "⚠️ CRITICAL: Running stale API binary. Please run tsc compiler before starting the service."
      );
    }
  } catch (err) {
    logger.warn({ err }, "Failed to generate startup diagnostic metadata");
  }
}

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
    await logStartupMetadata(app, pool);
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
