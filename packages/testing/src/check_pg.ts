/* eslint-disable no-console */
import { Pool } from "pg";
const pool = new Pool({
  connectionString: "postgres://postgres:postgres@localhost:5432/govos_db",
});
pool
  .connect()
  .then(() => {
    console.log("POSTGRES_ACCESS_OK");
    process.exit(0);
  })
  .catch((err) => {
    console.log("POSTGRES_ACCESS_FAILED:", err.message);
    process.exit(0);
  });
