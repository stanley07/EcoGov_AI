/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import { Pool } from "pg";
import { loadConfig } from "@govos/configuration";
import { Argon2idPasswordHasher } from "./hasher.js";
import {
  DEFAULT_TENANT_ID,
  ROLES,
  PERMISSIONS,
  OFFICER_PERMS,
  OFFICER_ROLES,
} from "./bootstrap_seed.js";

export async function repairBootstrap() {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.database.DATABASE_URL,
  });

  const client = await pool.connect();
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const firstName = process.env.ADMIN_FIRST_NAME;
    const lastName = process.env.ADMIN_LAST_NAME;

    if (!adminEmail || !adminPassword || !firstName || !lastName) {
      throw new Error(
        "Missing required environment variables: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME must be set.",
      );
    }

    if (adminPassword.length < 8) {
      throw new Error("ADMIN_PASSWORD must be at least 8 characters long");
    }

    const hasher = new Argon2idPasswordHasher();
    const passwordHash = await hasher.hash(adminPassword);

    await client.query("BEGIN");

    // 1. Acquire PostgreSQL advisory lock
    await client.query("SELECT pg_advisory_xact_lock(19843)");

    // 2. Verify target tenant
    const tenantRes = await client.query(
      "SELECT id, name FROM tenant WHERE id = $1",
      [DEFAULT_TENANT_ID],
    );
    if (tenantRes.rows.length === 0) {
      throw new Error(`Target tenant ${DEFAULT_TENANT_ID} not found.`);
    }
    const tenantId = tenantRes.rows[0].id;
    const tenantName = tenantRes.rows[0].name;

    // 3. Resolve organization (exact name/active check under tenant)
    const orgs = await client.query(
      `SELECT id, name FROM organization 
       WHERE tenant_id = $1 AND status = 'active' AND (
         name = 'Anambra State Ministry of Environment Headquarters' OR
         name = 'LASEPA HQ' OR 
         name = 'Lagos Environmental Protection Agency (LASEPA) HQ'
       )`,
      [tenantId],
    );
    let orgId: string;
    if (orgs.rows.length === 0) {
      throw new Error(
        `No active organization found matching 'Anambra State Ministry of Environment Headquarters' or legacy names under tenant ${tenantId}`,
      );
    } else if (orgs.rows.length === 1) {
      orgId = orgs.rows[0].id;
    } else {
      // If multiple match, prefer the new canonical name
      const preferred = orgs.rows.find(
        (o) => o.name === 'Anambra State Ministry of Environment Headquarters'
      );
      if (preferred) {
        orgId = preferred.id;
      } else {
        throw new Error(
          `Ambiguous organizations found: multiple active organizations match under tenant ${tenantId}`,
        );
      }
    }

    // 4. Upsert roles
    const rolesExisting: string[] = [];
    const rolesCreated: string[] = [];
    for (const role of ROLES) {
      const check = await client.query(
        "SELECT id, name FROM role WHERE tenant_id = $1 AND (id = $2 OR name = $3)",
        [tenantId, role.id, role.name],
      );
      if (check.rows.length > 0) {
        rolesExisting.push(role.name);
      } else {
        const res = await client.query(
          `INSERT INTO role (id, tenant_id, name, description, is_system)
           VALUES ($1, $2, $3, $4, TRUE)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [role.id, tenantId, role.name, role.desc],
        );
        if (res.rows.length > 0) {
          rolesCreated.push(role.name);
        } else {
          rolesExisting.push(role.name);
        }
      }
    }

    // 5. Upsert permissions
    const permissionsExisting: string[] = [];
    const permissionsCreated: string[] = [];
    for (const perm of PERMISSIONS) {
      const res = await client.query(
        `INSERT INTO permission (tenant_id, name, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, name) DO NOTHING
         RETURNING id`,
        [tenantId, perm, `Permission to ${perm}`],
      );
      if (res.rows.length > 0) {
        permissionsCreated.push(perm);
      } else {
        permissionsExisting.push(perm);
      }
    }

    // 6. Fetch permission mappings
    const permQuery = await client.query(
      "SELECT id, name FROM permission WHERE tenant_id = $1",
      [tenantId],
    );
    const permMap = new Map<string, string>();
    for (const row of permQuery.rows) {
      permMap.set(row.name, row.id);
    }

    // 7. Upsert super_admin permissions
    for (const row of permQuery.rows) {
      await client.query(
        `INSERT INTO role_permission (role_id, permission_id)
         VALUES ('00000000-0000-0000-0000-000000000501', $1)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [row.id],
      );
    }

    // 8. Upsert officer review role permissions
    const reviewPermId = permMap.get("facility:review");
    if (reviewPermId) {
      for (const roleId of OFFICER_ROLES) {
        await client.query(
          `INSERT INTO role_permission (role_id, permission_id)
           VALUES ($1, $2)
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          [roleId, reviewPermId],
        );
      }
    }

    for (const permName of OFFICER_PERMS) {
      const permId = permMap.get(permName);
      if (permId) {
        for (const roleId of OFFICER_ROLES) {
          await client.query(
            `INSERT INTO role_permission (role_id, permission_id)
             VALUES ($1, $2)
             ON CONFLICT (role_id, permission_id) DO NOTHING`,
            [roleId, permId],
          );
        }
      }
    }

    // 9. Resolve admin user
    let adminUserId: string;
    let existingAdmin = false;
    let adminCreated = false;

    const userRes = await client.query(
      "SELECT id FROM user_account WHERE tenant_id = $1 AND email = $2",
      [tenantId, adminEmail],
    );

    if (userRes.rows.length > 0) {
      existingAdmin = true;
      adminUserId = userRes.rows[0].id;
    } else {
      const deterministicAdminId = "00000000-0000-0000-0000-000000001001";
      const conflictCheck = await client.query(
        "SELECT email FROM user_account WHERE id = $1",
        [deterministicAdminId],
      );
      if (conflictCheck.rows.length > 0) {
        throw new Error(
          `Deterministic admin ID ${deterministicAdminId} is already occupied by a different email: ${conflictCheck.rows[0].email}`,
        );
      }

      await client.query(
        `INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
        [
          deterministicAdminId,
          tenantId,
          adminEmail,
          passwordHash,
          firstName,
          lastName,
        ],
      );
      adminUserId = deterministicAdminId;
      adminCreated = true;
    }

    // 10. Create missing membership
    let membershipCreated = false;
    const existingMembership = await client.query(
      `SELECT id FROM membership 
       WHERE user_id = $1 AND organization_id = $2 AND role_id = '00000000-0000-0000-0000-000000000501'`,
      [adminUserId, orgId],
    );
    if (existingMembership.rows.length === 0) {
      await client.query(
        `INSERT INTO membership (tenant_id, user_id, organization_id, role_id)
         VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000501')
         ON CONFLICT (user_id, organization_id, role_id) DO NOTHING`,
        [tenantId, adminUserId, orgId],
      );
      membershipCreated = true;
    }

    // 11. Verify effective permission count > 0
    const verificationRes = await client.query(
      `SELECT COUNT(rp.permission_id) as count
       FROM membership m
       JOIN role r ON m.role_id = r.id
       JOIN role_permission rp ON r.id = rp.role_id
       WHERE m.user_id = $1 AND m.tenant_id = $2`,
      [adminUserId, tenantId],
    );
    const permCount = parseInt(verificationRes.rows[0].count, 10);
    if (isNaN(permCount) || permCount === 0) {
      throw new Error(
        "Post-repair verification failed: Administrator has 0 permissions.",
      );
    }

    // 12. Write append-only authz_audit_log
    const auditContext = {
      repair_version: "1.0.0",
      created_roles: rolesCreated,
      created_permissions: permissionsCreated,
      created_memberships: membershipCreated ? 1 : 0,
      existing_admin: existingAdmin,
      admin_created: adminCreated,
    };
    await client.query(
      `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
       VALUES ($1, $2, 'bootstrap_repair', 'system', 'allow', $3)`,
      [tenantId, adminUserId, JSON.stringify(auditContext)],
    );

    await client.query("COMMIT");

    // 13. Print final summary containing only required fields
    console.log(`tenant: ${tenantName}`);
    console.log(`admin email: ${adminEmail}`);
    console.log(`roles existing: ${rolesExisting.join(", ")}`);
    console.log(`permissions existing: ${permissionsExisting.join(", ")}`);
    console.log(`roles created: ${rolesCreated.join(", ") || "none"}`);
    console.log(
      `permissions created: ${permissionsCreated.join(", ") || "none"}`,
    );
    console.log(`admin created: ${adminCreated}`);
    console.log(`membership created: ${membershipCreated}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
