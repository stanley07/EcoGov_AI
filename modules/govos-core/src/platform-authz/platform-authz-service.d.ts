import { Pool, PoolClient } from "pg";
import { PlatformPermission } from "./platform-permissions.js";
export declare function getActivePlatformRoles(db: Pool | PoolClient, userId: string): Promise<string[]>;
export declare function hasPlatformPermission(db: Pool | PoolClient, userId: string, permission: PlatformPermission): Promise<boolean>;
//# sourceMappingURL=platform-authz-service.d.ts.map