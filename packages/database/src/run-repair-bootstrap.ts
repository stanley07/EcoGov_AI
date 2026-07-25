/* eslint-disable no-console */
import * as readline from "node:readline";
import { Pool } from "pg";
import { loadConfig } from "@govos/configuration";
import { DEFAULT_TENANT_ID } from "./bootstrap_seed.js";
import { repairBootstrap } from "./repair-bootstrap.js";

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  const config = loadConfig();

  // Guard: Protect production
  if (config.appEnv !== "local" && process.env.ALLOW_PRODUCTION_REPAIR !== "true") {
    console.error(
      "Error: repair-bootstrap is restricted to local environment. Set ALLOW_PRODUCTION_REPAIR=true to override.",
    );
    process.exit(1);
  }

  // Check if we should bypass the CLI safety prompt
  const skipPrompt =
    process.env.CI === "true" ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y");

  if (!skipPrompt) {
    let tenantName = "Anambra State Ministry of Environment";
    try {
      const pool = new Pool({
        connectionString: config.database.DATABASE_URL,
      });
      const client = await pool.connect();
      const tenantRes = await client.query(
        "SELECT name FROM tenant WHERE id = $1",
        [DEFAULT_TENANT_ID],
      );
      if (tenantRes.rows.length > 0) {
        tenantName = tenantRes.rows[0].name;
      }
      client.release();
      await pool.end();
    } catch {
      // Ignore database connection failures here; the main repair tool will report them
    }

    // Mask credentials in DATABASE_URL
    let maskedDbUrl = config.database.DATABASE_URL;
    try {
      const dbUrlObj = new URL(config.database.DATABASE_URL);
      if (dbUrlObj.password) {
        dbUrlObj.password = "*****";
      }
      maskedDbUrl = dbUrlObj.toString();
    } catch {
      // Fallback if URL parsing fails
    }

    console.log("GovOS Bootstrap Repair");
    console.log("");
    console.log(`Database:\n  ${maskedDbUrl}`);
    console.log(`Tenant:\n  ${DEFAULT_TENANT_ID} (${tenantName})`);
    console.log("");
    console.log("Mode:\n  LOCAL ONLY");
    console.log("");

    const answer = await askQuestion("Continue? (y/N): ");
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  try {
    await repairBootstrap();
    process.exit(0);
  } catch (err) {
    console.error("Bootstrap repair failed:", err);
    process.exit(1);
  }
}

run();
