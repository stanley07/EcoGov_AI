import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("DROP INDEX IF EXISTS uq_marketplace_payment_idempotency");
  await client.query("ALTER TABLE marketplace_payment DROP COLUMN IF EXISTS idempotency_key");
  await client.query("ROLLBACK");
  const check = await client.query("SELECT COUNT(1) AS count FROM information_schema.columns WHERE table_name='marketplace_payment' AND column_name='idempotency_key'");
  if (Number(check.rows[0].count) !== 1) throw new Error("Rollback rehearsal did not restore schema");
  console.log(JSON.stringify({ rollbackRehearsal: "passed", schemaRestored: true }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
