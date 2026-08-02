#!/usr/bin/env node
import { Pool } from "pg";
import { buildDemoScenario, cleanDemoTenantData } from "../packages/testing/src/fixtures/marketplace-demo-scenario.js";

async function main() {
  // 1. Guard against running without ALLOW_DEMO_SEED flag
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    console.error("Error: Demo seeding is disabled. Set ALLOW_DEMO_SEED=true environment variable to execute.");
    process.exit(1);
  }

  // Parse arguments
  const args = process.argv.slice(2);
  const tenantIdx = args.indexOf("--tenant");
  const targetTenantSlug = tenantIdx !== -1 ? args[tenantIdx + 1] : "anambra-demo";
  const isReset = args.includes("--reset") || args.includes("-r");

  if (!targetTenantSlug) {
    console.error("Error: Target tenant slug must be specified (e.g. --tenant anambra-demo)");
    process.exit(1);
  }

  // 2. Production safety guard
  const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";
  const isProdDb = connectionString.includes("aws") || connectionString.includes("rds") || connectionString.includes("prod") || connectionString.includes("production");
  if (isProdDb && process.env.ALLOW_PRODUCTION_DEMO_SEED !== "true") {
    console.error("Error: Production database detected. Seeding aborted. Set ALLOW_PRODUCTION_DEMO_SEED=true to override.");
    process.exit(1);
  }

  console.log(`Starting demonstration seed command for tenant: "${targetTenantSlug}"...`);
  
  const pool = new Pool({ connectionString });
  
  try {
    if (isReset) {
      console.log(`Resetting previous demo scenario records for tenant: "${targetTenantSlug}"...`);
      const client = await pool.connect();
      try {
        const tenantRes = await client.query("SELECT id FROM tenant WHERE slug = $1", [targetTenantSlug]);
        if (tenantRes.rows.length > 0) {
          await client.query("BEGIN");
          await cleanDemoTenantData(client, tenantRes.rows[0].id);
          await client.query("COMMIT");
          console.log(`Successfully reset demo data for tenant: "${targetTenantSlug}"`);
        } else {
          console.log(`Tenant: "${targetTenantSlug}" not found. No data reset needed.`);
        }
      } catch (err: any) {
        console.error("Error during reset execution:", err.message);
        process.exit(1);
      } finally {
        client.release();
      }
    } else {
      console.log(`Seeding demo scenario records for tenant: "${targetTenantSlug}"...`);
      const result = await buildDemoScenario(pool, targetTenantSlug);
      console.log("Demo seed successfully applied.");
      console.log(`Tenant ID: ${result.tenantId}`);
      console.log(`LGAs Seeded: ${result.lgas.map(l => l.name).join(", ")}`);
      console.log(`Clusters Seeded: ${result.clusters.map(c => c.name).join(", ")}`);
      console.log(`Subcontractor Profiles Seeded: ${result.subcontractors.length}`);
    }
  } catch (err: any) {
    console.error("Seed execution failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal error during seeding main:", err);
  process.exit(1);
});
