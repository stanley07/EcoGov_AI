import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const migrations = (
    await pool.query(
      "SELECT version,name,checksum FROM schema_migrations ORDER BY version",
    )
  ).rows;
  const disk = new Map(
    fs
      .readdirSync("packages/database/migrations")
      .filter((x) => x.endsWith(".sql"))
      .map((x) => [
        parseInt(x),
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(path.join("packages/database/migrations", x)))
          .digest("hex"),
      ]),
  );
  const schema = (
    await pool.query(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN('organization','membership','user_invitation') ORDER BY table_name,ordinal_position`,
    )
  ).rows;
  const constraints = (
    await pool.query(
      `SELECT conname,convalidated FROM pg_constraint WHERE conname IN('chk_organization_status','chk_organization_version_positive','fk_invitation_tenant_organization') ORDER BY conname`,
    )
  ).rows;
  const indexes = (
    await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN('idx_invitation_tenant_organization_status','idx_organization_tenant_status') ORDER BY indexname`,
    )
  ).rows;
  const roleCatalog = (
    await pool.query(
      `SELECT r.name,COUNT(*)::int permission_count,COUNT(*) FILTER(WHERE p.name LIKE 'platform.%' OR p.name LIKE 'PLATFORM_%')::int platform_permissions FROM role r LEFT JOIN role_permission rp ON rp.role_id=r.id LEFT JOIN permission p ON p.id=rp.permission_id AND p.tenant_id=r.tenant_id WHERE r.tenant_id='00000000-0000-0000-0000-000000000001' AND r.name IN('super_admin','organization_admin') GROUP BY r.name ORDER BY r.name`,
    )
  ).rows;
  const counts = (
    await pool.query(`SELECT
(SELECT COUNT(*) FROM membership m JOIN user_account u ON u.id=m.user_id WHERE m.tenant_id<>u.tenant_id)+(SELECT COUNT(*) FROM membership m JOIN role r ON r.id=m.role_id WHERE m.tenant_id<>r.tenant_id)+(SELECT COUNT(*) FROM membership m JOIN organization o ON o.id=m.organization_id WHERE m.tenant_id<>o.tenant_id) cross_tenant,
(SELECT COUNT(*) FROM membership m JOIN organization o ON o.id=m.organization_id WHERE m.organization_id IS NOT NULL AND (m.tenant_id<>o.tenant_id OR o.deleted_at IS NOT NULL)) cross_organization,
(SELECT COUNT(*) FROM(SELECT tenant_id,user_id,COALESCE(organization_id,'00000000-0000-0000-0000-000000000000'),role_id FROM membership WHERE status IN('active','invited') GROUP BY 1,2,3,4 HAVING COUNT(*)>1)x) duplicates,
(SELECT COUNT(*) FROM user_invitation WHERE status='pending' GROUP BY tenant_id,email_normalized,invitation_type HAVING COUNT(*)>1 LIMIT 1) duplicate_invitations,
(SELECT COUNT(*) FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id WHERE r.tenant_id<>p.tenant_id OR p.name LIKE 'platform.%' OR p.name LIKE 'PLATFORM_%') forbidden_mappings`)
  ).rows[0];
  console.log(
    JSON.stringify(
      {
        highest: Number(migrations.at(-1)?.version || 0),
        checksumMismatches: migrations
          .filter((x) => disk.get(Number(x.version)) !== x.checksum)
          .map((x) => Number(x.version)),
        schema,
        constraints,
        indexes,
        roleCatalog,
        counts,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
