import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { matchRoute, resolveRoute } from "../layout/routes.js";

const landingSource = readFileSync(resolve(process.cwd(), "apps/web/src/LandingPage.tsx"), "utf8");
const mainSource = readFileSync(resolve(process.cwd(), "apps/web/src/main.tsx"), "utf8");

describe("CL-0.1 public subcontractor acquisition entry point", () => {
  test("shows the commercial subcontractor CTA and acquisition benefits", () => {
    expect(landingSource).toContain("Become a Licensed Subcontractor");
    expect(landingSource).toContain("Become an Environmental Operations Partner");
    expect(landingSource).toContain("Digital subcontractor licence");
    expect(landingSource).toContain("Public QR licence verification");
  });

  test("subcontractor actions use the authoritative public application route", () => {
    expect(landingSource).toContain('href="#/subcontractor-apply"');
    expect(matchRoute("#/subcontractor-apply")?.route.id).toBe("subcontractor-apply");
  });

  test("subcontractor application remains public without a login redirect", () => {
    const resolution = resolveRoute({ hash: "#/subcontractor-apply", authenticated: false, permissions: [], canAccessPlatformAdmin: false });
    expect(resolution).toMatchObject({ tab: "subcontractor-apply", requiresLogin: false, denied: false });
  });

  test("Verify Licence actions use the registered public verification route", () => {
    expect(landingSource).toContain('href="#/verify-licence"');
    expect(matchRoute("#/verify-licence")?.route.accessBoundary).toBe("public");
  });

  test("Register Your Facility continues to invoke the existing registration entry", () => {
    expect(landingSource).toContain("Register Your Facility");
    expect(landingSource).toContain("onClick={handleRegisterClick}");
    expect(landingSource).toContain("setIsLoginModalOpen(true)");
  });

  test("mobile header and hero actions remain available without horizontal overflow", () => {
    expect(landingSource).toContain("@media (max-width: 640px)");
    expect(landingSource).toContain("flex: 1 1 145px");
    expect(landingSource).toContain("min-width: 0 !important");
    expect(landingSource).toContain('boxSizing: "border-box"');
    expect(landingSource).toContain('minHeight: "44px"');
  });

  test("all new actions share a visible keyboard focus treatment", () => {
    expect(landingSource).toContain(".landing-action:focus-visible");
    expect(landingSource).toContain("outline: 3px solid #facc15");
    expect(landingSource.match(/className="landing-action"/g)?.length).toBeGreaterThanOrEqual(10);
  });

  test("public Login shortcut and login modal remain wired", () => {
    expect(landingSource).toContain(">Login</button>");
    expect(landingSource).toContain("onSubmit={onLogin}");
    expect(landingSource).toContain('aria-labelledby="login-modal-title"');
  });

  test("Ministry logo and State seal placement rules remain unchanged", () => {
    expect(landingSource.match(/src="\/minEnv\.jpg"/g)).toHaveLength(2);
    expect(landingSource.match(/src="\/anambra-state-government\.png"/g)).toHaveLength(1);
    expect(landingSource.indexOf('src="/anambra-state-government.png"')).toBeGreaterThan(landingSource.indexOf("{/* Hero Section */}"));
    expect(landingSource.indexOf('src="/minEnv.jpg"')).toBeLessThan(landingSource.indexOf("{/* Hero Section */}"));
  });

  test("reuses the single authoritative subcontractor application component", () => {
    expect(mainSource.match(/import \{ ApplicationWizard \}/g)).toHaveLength(1);
    expect(mainSource.match(/<ApplicationWizard \/>/g)).toHaveLength(2); // public and authenticated shells, one component implementation
    expect(landingSource).not.toContain("function ApplicationWizard");
  });
});
