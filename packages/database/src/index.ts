import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, PoolClient } from "pg";
import { logger } from "@govos/observability";

// Workaround for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationRecord {
  version: number;
  name: string;
  checksum: string;
  applied_at: Date;
  execution_duration_ms: number;
}

export async function withTransaction<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class MigrationRunner {
  private migrationsDir: string;

  constructor(customMigrationsDir?: string) {
    this.migrationsDir =
      customMigrationsDir || path.resolve(__dirname, "../migrations");
  }

  public calculateChecksum(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  public async getAppliedMigrations(
    client: PoolClient,
  ): Promise<Map<number, MigrationRecord>> {
    const query = `
      SELECT version, name, checksum, applied_at, execution_duration_ms
      FROM schema_migrations
      ORDER BY version ASC
    `;
    const res = await client.query(query);
    const map = new Map<number, MigrationRecord>();
    for (const row of res.rows) {
      map.set(Number(row.version), {
        version: Number(row.version),
        name: row.name,
        checksum: row.checksum,
        applied_at: new Date(row.applied_at),
        execution_duration_ms: Number(row.execution_duration_ms),
      });
    }
    return map;
  }

  public async initializeMigrationsTable(client: PoolClient): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version BIGINT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL,
        execution_duration_ms INTEGER NOT NULL
      );
    `;
    await client.query(query);
  }

  public getMigrationFiles(): {
    version: number;
    name: string;
    filePath: string;
  }[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }
    const files = fs.readdirSync(this.migrationsDir);
    const parsed = files
      .filter((f) => f.endsWith(".sql"))
      .map((f) => {
        const match = f.match(/^(\d+)_(.+)\.sql$/);
        if (!match) {
          throw new Error(`Invalid migration filename format: ${f}`);
        }
        return {
          version: parseInt(match[1] || "0", 10),
          name: match[2] || "",
          filePath: path.join(this.migrationsDir, f),
        };
      });

    return parsed.sort((a, b) => a.version - b.version);
  }

  public async migrate(pool: Pool): Promise<number> {
    logger.info("Database migration run started");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Step 1: Enforce advisory lock at transaction level to prevent concurrent runs
      await client.query("SELECT pg_advisory_xact_lock(19842)");

      // Step 2: Initialize migrations metadata table
      await this.initializeMigrationsTable(client);

      // Step 3: Fetch applied migrations
      const applied = await this.getAppliedMigrations(client);

      // Step 4: Scan disk migrations
      const files = this.getMigrationFiles();
      let appliedCount = 0;

      for (const file of files) {
        const content = fs.readFileSync(file.filePath, "utf-8");
        const checksum = this.calculateChecksum(content);

        const appliedRecord = applied.get(file.version);
        if (appliedRecord) {
          if (appliedRecord.checksum !== checksum) {
            throw new Error(
              `Migration checksum mismatch for version ${file.version} (${file.name}). Disk: ${checksum}, DB: ${appliedRecord.checksum}`,
            );
          }
          continue;
        }

        // Apply new migration
        logger.info(
          { version: file.version, name: file.name },
          "Applying database migration",
        );
        const startTime = Date.now();

        await client.query(content);
        const duration = Date.now() - startTime;
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_duration_ms)
           VALUES ($1, $2, $3, NOW(), $4)`,
          [file.version, file.name, checksum, duration],
        );
        appliedCount++;
        logger.info(
          { version: file.version, name: file.name },
          "Migration successfully applied",
        );
      }

      await client.query("COMMIT");
      logger.info({ appliedCount }, "Database migration run completed");
      return appliedCount;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.error(
          { rollbackErr },
          "Failed to rollback migration transaction",
        );
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

export * from "./hasher.js";
export * from "./repair-bootstrap.js";

