import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { ToolAuthorizationService, OutputValidationService } from "@govos/ai";
import { z } from "zod";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5433/govos_db";

describe("Platform Agent Runtime Tools Integration Tests (Phase 4/7 Gate)", () => {
  let pool: Pool;
  let authzService: ToolAuthorizationService;
  let validationService: OutputValidationService;

  beforeAll(() => {
    pool = new Pool({ connectionString });
    authzService = new ToolAuthorizationService();
    validationService = new OutputValidationService();
  });

  afterAll(async () => {
    await pool.end();
  });

  test("1. Static authorization evaluates actor capabilities", async () => {
    // Required permission is not present in actor roles
    const verdict = await authzService.authorizeToolCall(
      ["facility:review-support"],
      ["citizen"]
    );
    expect(verdict.authorized).toBe(false);
    expect(verdict.reasonCode).toBe("INSUFFICIENT_PERMISSIONS");

    const verdictOk = await authzService.authorizeToolCall(
      ["facility:review-support"],
      ["facility:review-support"]
    );
    expect(verdictOk.authorized).toBe(true);
    expect(verdictOk.reasonCode).toBeUndefined();
  });

  test("2. Input validation validates arguments", () => {
    const schema = z.object({
      businessName: z.string().min(1),
    });

    const valid = validationService.validateZodSchema({ businessName: "Test Co" }, schema);
    expect(valid.valid).toBe(true);

    const invalid = validationService.validateZodSchema({ businessName: "" }, schema);
    expect(invalid.valid).toBe(false);
  });
});
