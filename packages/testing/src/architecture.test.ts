import { execSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { logger } from "@govos/observability";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test("Monorepo imports conform to dependency-cruiser boundary rules", () => {
  const rootDir = path.resolve(__dirname, "../../..");

  try {
    execSync(
      "npx dependency-cruiser --config dependency-cruiser.json apps packages",
      {
        cwd: rootDir,
        stdio: "pipe",
      },
    );
  } catch (error: unknown) {
    const err = error as { stdout?: Buffer; message: string };
    const output = err.stdout?.toString() || err.message;
    logger.error({ output }, "Dependency Cruiser violations detected");
    expect(error).toBeUndefined(); // Force failure with nice trace
  }
});
