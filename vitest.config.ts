import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@govos/core/invitation-routes": fileURLToPath(
        new URL("./modules/govos-core/src/invitation-routes.ts", import.meta.url),
      ),
      "@govos/infrastructure": fileURLToPath(
        new URL("./packages/infrastructure/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/tests/integration/**"],
    passWithNoTests: true,
    testTimeout: 30000,
  },
});
