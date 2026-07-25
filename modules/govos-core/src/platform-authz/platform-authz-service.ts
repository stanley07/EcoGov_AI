import { Pool, PoolClient } from "pg";
import { PlatformPermission, PLATFORM_ROLE_PERMISSIONS } from "./platform-permissions.js";

export async function getActivePlatformRoles(
  db: Pool | PoolClient,
  userId: string
): Promise<string[]> {
  const query = `
    SELECT role_name
    FROM platform_role_assignment
    WHERE user_id = $1 AND assignment_status = 'active' AND revoked_at IS NULL
  `;
  const res = await db.query(query, [userId]);
  return res.rows.map((r) => r.role_name);
}

export async function hasPlatformPermission(
  db: Pool | PoolClient,
  userId: string,
  permission: PlatformPermission
): Promise<boolean> {
  const roles = await getActivePlatformRoles(db, userId);
  for (const role of roles) {
    const permissions = PLATFORM_ROLE_PERMISSIONS[role] || [];
    if (permissions.includes(permission)) {
      return true;
    }
  }
  return false;
}
