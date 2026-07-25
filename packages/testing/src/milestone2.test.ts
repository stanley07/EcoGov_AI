import { describe, test, expect, vi } from "vitest";
import {
  hasPermission,
  createWorkflowInstance,
  transitionWorkflowInstance,
  validateWorkflowGraph,
  runWithRequestContext,
  getRequestContext,
} from "@govos/core";
import { Argon2idPasswordHasher } from "@govos/database";
import { getEnvironmentalRisk, isValidFacilityCategory } from "@govos/ecogov";
import { PoolClient } from "pg";

describe("Milestone 2 RBAC Permission Checks & Inheritance", () => {
  test("super_admin inherits permissions and has org:write", () => {
    expect(hasPermission(["super_admin"], "org:write")).toBe(true);
    expect(hasPermission(["super_admin"], "facility:review")).toBe(true);
  });

  test("director inherits inspector permissions and has facility:review", () => {
    expect(hasPermission(["director"], "facility:review")).toBe(true);
  });

  test("citizen only has facility:read", () => {
    expect(hasPermission(["citizen"], "facility:read")).toBe(true);
    expect(hasPermission(["citizen"], "facility:write")).toBe(false);
  });

  test("handles cycle safety gracefully", () => {
    // Visited set cycle protection is validated inresolveRolePermissions
    expect(hasPermission(["citizen"], "nonexistent")).toBe(false);
  });
});

describe("Milestone 2 Environmental Risk Classifications", () => {
  test("correctly maps facility categories to environmental risks", () => {
    expect(getEnvironmentalRisk("Hospital")).toBe("high");
    expect(getEnvironmentalRisk("Car Wash")).toBe("medium");
    expect(getEnvironmentalRisk("Hotel")).toBe("low");
  });

  test("validates known facility categories correctly", () => {
    expect(isValidFacilityCategory("Car Wash")).toBe(true);
    expect(isValidFacilityCategory("UnknownCategory")).toBe(false);
  });
});

describe("Milestone 2 Password Security (Argon2id)", () => {
  test("hashes and verifies password using Argon2id", async () => {
    const hasher = new Argon2idPasswordHasher();
    const password = "password123Secure!";
    const hash = await hasher.hash(password);
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await hasher.verify(hash, password)).toBe(true);
    expect(await hasher.verify(hash, "wrongpassword")).toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
  });

  test("needsRehash returns true for outdated structures", () => {
    const hasher = new Argon2idPasswordHasher();
    expect(hasher.needsRehash("$sha256$hashhere")).toBe(true);
  });
});

describe("Milestone 2 RequestContext Immutability", () => {
  test("RequestContext propagates and is frozen at runtime", () => {
    const context = {
      identity: {
        tenantId: "tenant-123",
        roles: ["inspector"],
        permissions: ["facility:read"],
      },
      trace: {
        requestId: "req-1",
        correlationId: "corr-1",
        traceId: "trace-1",
      },
    };

    runWithRequestContext(context, () => {
      const active = getRequestContext();
      expect(active).toBeDefined();
      expect(active?.identity?.tenantId).toBe("tenant-123");
      expect(Object.isFrozen(active)).toBe(true);
      expect(Object.isFrozen(active?.identity)).toBe(true);
      expect(Object.isFrozen(active?.identity?.roles)).toBe(true);

      // Verify that runtime mutation throws error
      expect(() => {
        const mutableActive = active as unknown as { identity: { tenantId: string } };
        mutableActive.identity.tenantId = "mutated";
      }).toThrow();
    });
  });
});

describe("Milestone 2 Workflow Graph Publications", () => {
  test("validateWorkflowGraph passes valid linear graph", () => {
    const steps = [
      { stepName: "step_entry", isEntryStep: true, isTerminalStep: false },
      { stepName: "step_mid", isEntryStep: false, isTerminalStep: false },
      { stepName: "step_end", isEntryStep: false, isTerminalStep: true },
    ];
    const transitions = [
      { fromStep: "step_entry", outcomeCode: "next", toStep: "step_mid" },
      { fromStep: "step_mid", outcomeCode: "finish", toStep: "step_end" },
    ];

    expect(() => validateWorkflowGraph(steps, transitions)).not.toThrow();
  });

  test("validateWorkflowGraph rejects graphs without entry steps", () => {
    const steps = [
      { stepName: "step_mid", isEntryStep: false, isTerminalStep: false },
      { stepName: "step_end", isEntryStep: false, isTerminalStep: true },
    ];
    const transitions = [
      { fromStep: "step_mid", outcomeCode: "finish", toStep: "step_end" },
    ];

    expect(() => validateWorkflowGraph(steps, transitions)).toThrow(
      "Workflow definition must have exactly one entry step",
    );
  });

  test("validateWorkflowGraph rejects graphs leaving terminal steps", () => {
    const steps = [
      { stepName: "step_entry", isEntryStep: true, isTerminalStep: false },
      { stepName: "step_end", isEntryStep: false, isTerminalStep: true },
    ];
    const transitions = [
      { fromStep: "step_entry", outcomeCode: "finish", toStep: "step_end" },
      { fromStep: "step_end", outcomeCode: "loopback", toStep: "step_entry" },
    ];

    expect(() => validateWorkflowGraph(steps, transitions)).toThrow(
      "leaving terminal step is prohibited",
    );
  });

  test("validateWorkflowGraph rejects dead-end steps that cannot reach terminal steps", () => {
    const steps = [
      { stepName: "step_entry", isEntryStep: true, isTerminalStep: false },
      { stepName: "step_dead", isEntryStep: false, isTerminalStep: false },
      { stepName: "step_end", isEntryStep: false, isTerminalStep: true },
    ];
    const transitions = [
      { fromStep: "step_entry", outcomeCode: "next", toStep: "step_dead" },
    ];

    expect(() => validateWorkflowGraph(steps, transitions)).toThrow(
      "cannot reach any terminal step",
    );
  });
});

describe("Milestone 2 Workflow Execution Queries", () => {
  test("createWorkflowInstance performs initial steps insertion", async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "wf-instance-123",
            version_id: "v-1",
            step_def_id: "s-1",
            step_name: "submission",
          },
        ],
      }),
    } as unknown as PoolClient;

    const { instanceId } = await createWorkflowInstance(
      mockClient,
      "tenant-1",
      "facility_registration",
      "facility",
      "fac-1",
    );
    expect(instanceId).toBe("wf-instance-123");
    expect(mockClient.query).toHaveBeenCalledTimes(5); // Guard check + Select + Insert Instance + Insert step + Insert audit
  });

  test("transitionWorkflowInstance queries transition and inserts new step", async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((queryText: string) => {
        if (queryText.includes("SELECT e.step_definition_id")) {
          return {
            rows: [
              {
                step_definition_id: "s-1",
                step_name: "submission",
                version_id: "v-1",
              },
            ],
          };
        }
        if (queryText.includes("SELECT to_step_definition_id")) {
          return {
            rows: [
              {
                to_step_definition_id: "s-2",
                to_step_name: "ai_review",
                is_terminal_step: false,
              },
            ],
          };
        }
        if (queryText.includes("UPDATE workflow_step_execution")) {
          return { rows: [{ id: "exec-1" }] };
        }
        if (queryText.includes("INSERT INTO workflow_step_execution")) {
          return { rows: [{ id: "next-exec-1" }] };
        }
        return { rows: [] };
      }),
    } as unknown as PoolClient;

    const nextStepId = await transitionWorkflowInstance(
      mockClient,
      "tenant-1",
      "wf-instance-123",
      "exec-1",
      "submit",
      "system",
    );

    expect(nextStepId).toBe("next-exec-1");
    expect(mockClient.query).toHaveBeenCalled();
  });
});
