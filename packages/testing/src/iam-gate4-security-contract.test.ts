import { readFileSync } from "node:fs";
import { describe,expect,test } from "vitest";
const route=readFileSync("apps/api/src/routes/account-security.ts","utf8"),migration=readFileSync("packages/database/migrations/000029_iam_account_security.sql","utf8"),self=readFileSync("apps/web/src/iam/AccountSecurityPage.tsx","utf8"),admin=readFileSync("apps/web/src/iam/UserSecurityPage.tsx","utf8");
describe("IAM Gate 4 account security contract",()=>{
 test("migration stores reset state, history, challenges and safe session metadata",()=>{for(const value of ["password_reset_required","password_history","pending_auth_challenge","last_seen_at","role_id"])expect(migration).toContain(value);});
 test("password change enforces policy, history and other-session revocation",()=>{expect(route).toContain("assertPasswordPolicy");expect(route).toContain("password_history");expect(route).toContain("token<>$3");});
 test("MFA stores encrypted secret and hashed recovery codes only",()=>{expect(route).toContain("encryptMfa");expect(route).toContain("mfa_recovery_code_hashes");expect(route).not.toContain("mfa_secret=");});
 test("admin mutations use granular permissions and tenant predicates",()=>{for(const p of ["user:status:write","user:mfa:reset","user:session:revoke","user:read"])expect(route).toContain(p);expect(route).not.toContain('allowed(pool,r,reply,"user:write")');expect(route).toContain("u.tenant_id=$1");});
 test("platform principals and self-targeting fail closed",()=>{expect(route).toContain("platform_authority");expect(route).toMatch(/userId\s*===\s*a\.userId/);});
 test("responses never select session tokens or credential hashes",()=>{expect(route).not.toMatch(/SELECT token[, ]/);expect(route).not.toMatch(/SELECT password_hash.*\/users/);});
 test("self and admin security interfaces exist without persistent secret storage",()=>{expect(self).toContain("Account Security");expect(admin).toContain("User Security");expect(self+admin).not.toContain("localStorage");expect(self+admin).not.toContain("sessionStorage");});
});
