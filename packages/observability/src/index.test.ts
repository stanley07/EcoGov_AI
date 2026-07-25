import { describe, test, expect } from "vitest";
import { runWithContext, getContext } from "./index.js";

describe("Observability Context Checks", () => {
  test("persists context in AsyncLocalStorage flow", () => {
    runWithContext(
      { correlationId: "test-corr-id", requestId: "test-req-id" },
      () => {
        const context = getContext();
        expect(context).toBeDefined();
        expect(context?.correlationId).toBe("test-corr-id");
        expect(context?.requestId).toBe("test-req-id");
      },
    );
  });

  test("sanitizes unsafe correlation id characters", () => {
    runWithContext(
      { correlationId: "test-corr-id-unsafe!@#$", requestId: "test-req-id" },
      () => {
        const context = getContext();
        expect(context?.correlationId).toBe("test-corr-id-unsafe");
      },
    );
  });

  test("generates random correlation ID if missing", () => {
    runWithContext({ correlationId: "" }, () => {
      const context = getContext();
      expect(context?.correlationId).toBeDefined();
      expect(context?.correlationId.startsWith("gen-")).toBe(true);
    });
  });
});
