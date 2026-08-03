import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@govos/core/invitation-routes": fileURLToPath(
        new URL("../../modules/govos-core/src/invitation-routes.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 3000,
  },
});
