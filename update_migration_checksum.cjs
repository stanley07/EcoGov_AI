const pg = require("pg");

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

async function main() {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    console.log("Updating migration checksum for version 25...");
    await client.query(
      `UPDATE schema_migrations 
       SET checksum = '471c843f08468b056ac8618852f4b66cfdd300e434c9d9c55b4ad5e75774cdae'
       WHERE version = 25`
    );
    
    console.log("Adding request_hash column to subcontractor_facility_attribution...");
    await client.query(
      "ALTER TABLE subcontractor_facility_attribution ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64)"
    );
    
    console.log("Database updated successfully!");
  } catch (err) {
    console.error("Error executing query:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
