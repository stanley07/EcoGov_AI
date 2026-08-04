import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  evaluateTransitionCondition,
  validateTransitionCondition,
  validateEnterpriseWorkflowModel,
} from "@govos/core";

const root = path.resolve(__dirname, "../../..");
const migration = fs.readFileSync(
  path.join(root, "packages/database/migrations/000033_wf1_remediation.sql"),
  "utf8",
);
const engine = fs.readFileSync(
  path.join(root, "modules/govos-core/src/workflow-engine.ts"),
  "utf8",
);
const routes = fs.readFileSync(
  path.join(root, "apps/api/src/routes/workflows.ts"),
  "utf8",
);
const worker = fs.readFileSync(
  path.join(root, "apps/worker/src/workflow-runtime.ts"),
  "utf8",
);

describe("WF-1 remediation", () => {
  test("migration installs the canonical ten-state lifecycle", () => {
    for (const state of [
      "created",
      "ready",
      "claimed",
      "running",
      "waiting",
      "completed",
      "failed",
      "cancelled",
      "skipped",
      "dead_lettered",
    ])
      expect(migration).toContain(`'${state}'`);
    expect(migration).toContain("enforce_workflow_step_execution_lifecycle");
  });
  test("migration removes legacy runtime values", () => {
    expect(migration).toContain(
      "SET status = 'ready' WHERE status = 'pending'",
    );
    expect(migration).toContain(
      "SET status = 'running' WHERE status = 'processing'",
    );
  });
  test("version lifecycle is restricted and defaults require published versions", () => {
    expect(migration).toContain("WF_INVALID_VERSION_TRANSITION");
    expect(migration).toContain("WF_DEFAULT_REQUIRES_PUBLISHED_VERSION");
    expect(routes).toContain("WF_DEFAULT_REPLACEMENT_REQUIRED");
  });
  test("approved comparisons use strict deterministic typing", () => {
    const score = { operator: "var", path: "variables.score" };
    const three = { operator: "literal", value: 3 };
    expect(
      evaluateTransitionCondition(
        { operator: "eq", left: score, right: three },
        { variables: { score: 3 } },
      ),
    ).toBe(true);
    expect(
      evaluateTransitionCondition(
        {
          operator: "neq",
          left: score,
          right: { operator: "literal", value: "3" },
        },
        { variables: { score: 3 } },
      ),
    ).toBe(true);
    for (const operator of ["lt", "lte", "gt", "gte"])
      expect(() =>
        validateTransitionCondition({ operator, left: score, right: three }),
      ).not.toThrow();
    expect(
      evaluateTransitionCondition(
        { operator: "gte", left: score, right: three },
        { variables: { score: 3 } },
      ),
    ).toBe(true);
  });
  test("all, any, not, exists and in are deterministic", () => {
    const yes = {
      operator: "eq",
      left: { operator: "var", path: "variables.a" },
      right: { operator: "literal", value: true },
    };
    const no = {
      operator: "eq",
      left: { operator: "var", path: "variables.b" },
      right: { operator: "literal", value: true },
    };
    const context = { variables: { a: true, b: false, role: "reviewer" } };
    expect(
      evaluateTransitionCondition(
        {
          operator: "all",
          conditions: [yes, { operator: "not", condition: no }],
        },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateTransitionCondition(
        { operator: "any", conditions: [no, yes] },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateTransitionCondition(
        { operator: "exists", path: "variables.a" },
        context,
      ),
    ).toBe(true);
    expect(
      evaluateTransitionCondition(
        {
          operator: "in",
          left: { operator: "var", path: "variables.role" },
          right: { operator: "literal", value: ["reviewer", "approver"] },
        },
        context,
      ),
    ).toBe(true);
  });
  test("missing variables fail closed except exists", () => {
    expect(
      evaluateTransitionCondition(
        {
          operator: "eq",
          left: { operator: "var", path: "variables.missing" },
          right: { operator: "literal", value: null },
        },
        { variables: {} },
      ),
    ).toBe(false);
    expect(
      evaluateTransitionCondition(
        { operator: "exists", path: "variables.missing" },
        { variables: {} },
      ),
    ).toBe(false);
  });
  test("forbidden paths, aliases and operators are rejected", () => {
    for (const segment of ["__proto__", "prototype", "constructor"])
      expect(() =>
        validateTransitionCondition({
          operator: "var",
          path: `variables.${segment}.x`,
        }),
      ).toThrow();
    expect(() =>
      validateTransitionCondition({
        operator: "equals",
        left: true,
        right: true,
      }),
    ).toThrow();
    expect(() =>
      validateTransitionCondition({ op: "eq", left: true, right: true }),
    ).toThrow();
    expect(() => validateTransitionCondition({ operator: "eval" })).toThrow();
  });
  test("depth, node count and size are bounded", () => {
    let condition: any = { operator: "literal", value: true };
    for (let i = 0; i < 9; i++) condition = { operator: "not", condition };
    expect(() => validateTransitionCondition(condition)).toThrow();
    expect(() =>
      validateTransitionCondition({
        operator: "literal",
        value: "x".repeat(17000),
      }),
    ).toThrow();
  });
  test("publication validation invokes condition validation", () => {
    expect(() =>
      validateEnterpriseWorkflowModel({
        steps: [
          { key: "start", type: "human_review", entry: true },
          { key: "done", type: "domain_command", terminal: true },
        ],
        transitions: [
          {
            key: "finish",
            from: "start",
            to: "done",
            outcome: "ok",
            condition: { operator: "eval" },
          },
        ],
      }),
    ).toThrow();
  });
  test("all work-item surfaces enforce organization scope", () => {
    for (const op of [
      "/v1/work-items",
      "/:id/claim",
      "/:id/history",
      '"accept"',
      '"release"',
      '"assign"',
      '"reassign"',
      '"cancel"',
    ])
      expect(routes).toContain(op);
    expect(
      (routes.match(/m\.organization_id=w\.organization_id/g) || []).length,
    ).toBeGreaterThanOrEqual(4);
    expect(engine).toContain("m.organization_id=w.organization_id");
  });
  test("timer and SLA worker uses bounded leased fencing", () => {
    expect(worker).toMatch(/WF_RUNTIME_BATCH_SIZE\s*=\s*100/);
    expect(worker).toMatch(/WF_RUNTIME_LEASE_SECONDS\s*=\s*60/);
    expect(worker).toContain("fencing_token=fencing_token+1");
    expect(worker).toContain("FOR UPDATE SKIP LOCKED");
  });
  test("escalation is bounded and empty queues fail closed", () => {
    expect(worker).toMatch(/\.slice\(0,\s*10\)/);
    expect(worker).toContain("WF_QUEUE_MISCONFIGURED");
    expect(engine).toContain("WF_ESCALATION_TOO_DEEP");
  });
  test("recommendations use expected versions and terminal decisions", () => {
    expect(engine).toContain("decideRecommendation");
    expect(engine).toMatch(/["']accepted["']\s*\|\s*["']rejected["']/);
    expect(engine).toContain("instance_version");
    expect(engine).toContain("FOR UPDATE OF r,i");
    expect(routes).toContain("/v1/workflows/recommendations/:id/accept");
    expect(routes).toContain("/v1/workflows/recommendations/:id/reject");
  });
  test("dynamic execution primitives are absent", () => {
    for (const source of [engine, worker])
      expect(source).not.toMatch(
        /\beval\s*\(|new Function|child_process|dynamic import/,
      );
  });
});
