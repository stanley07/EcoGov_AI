/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { Pool } from "pg";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@govos/configuration";
import { MigrationRunner } from "./index.js";

const __filename = fileURLToPath(import.meta.url);

async function runChild() {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.database.DATABASE_URL });
  const runner = new MigrationRunner();
  console.log(`[Child ${process.pid}] Acquiring lock and migrating...`);
  try {
    const count = await runner.migrate(pool);
    console.log(
      `[Child ${process.pid}] Completed migration. Applied: ${count}`,
    );
    process.exit(0);
  } catch (err: any) {
    console.error(`[Child ${process.pid}] Migration aborted: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function runParent() {
  console.log("=== Starting Advisory Lock Concurrency Verification ===");
  const child1 = fork(__filename, ["child"]);
  const child2 = fork(__filename, ["child"]);

  let c1Status: number | null = null;
  let c2Status: number | null = null;

  child1.on("exit", (code) => {
    c1Status = code;
  });
  child2.on("exit", (code) => {
    c2Status = code;
  });

  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (c1Status !== null && c2Status !== null) {
        clearInterval(interval);
        console.log(
          `[Parent] Concurrent execution ended. Child 1 status: ${c1Status}, Child 2 status: ${c2Status}`,
        );
        resolve();
      }
    }, 200);
  });
}

const args = process.argv.slice(2);
if (args[0] === "child") {
  runChild();
} else {
  runParent();
}
