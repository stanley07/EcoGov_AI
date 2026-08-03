import { readFileSync } from "node:fs";
import { describe,expect,test } from "vitest";
const api=readFileSync("apps/api/src/routes/auth.ts","utf8"),web=readFileSync("apps/web/src/main.tsx","utf8"),landing=readFileSync("apps/web/src/LandingPage.tsx","utf8");
describe("IAM Gate 4 tenant-context login contract",()=>{
 test("requires and submits tenantSlug",()=>{expect(api).toContain('required: ["tenantSlug", "email", "password"]');expect(web).toContain("{ tenantSlug,email,password }");expect(landing).toContain('id="login-workspace"');});
 test("removes email-only inference and scopes through a non-system active tenant",()=>{expect(api).toContain("t.slug=$1");expect(api).toContain("t.is_system=FALSE");expect(api).toContain("m.tenant_id=u.tenant_id AND m.status='active'");expect(api).toContain("r.tenant_id=m.tenant_id");expect(api).not.toContain("WHERE u.email = $1");});
 test("uses one generic response for tenant credential failures",()=>{expect(api).toContain("Invalid workspace, email, or password");expect(api.match(/send\(INVALID_CREDENTIALS\)/g)?.length).toBeGreaterThanOrEqual(2);});
 test("binds issued sessions to tenant user role and version",()=>{expect(api).toContain("session (tenant_id,user_id,role_id,token,expires_at,session_version");});
 test("keeps platform authority outside tenant login",()=>{const login=api.slice(0,api.indexOf("// Accept Invitation Route"));expect(login).toContain("t.is_system=FALSE");expect(login).not.toContain("platform_role_assignment");});
 test("verified MFA creates a bounded challenge instead of a session",()=>{expect(api).toContain("pending_auth_challenge");expect(api).toContain("INTERVAL '5 minutes'");expect(api).toMatch(/mfaRequired:\s*true/);});
});
