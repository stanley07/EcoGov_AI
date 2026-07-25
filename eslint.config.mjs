import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-unused-private-class-members": "error"
    }
  },
  {
    ignores: ["**/dist/", "**/node_modules/", "coverage/", "**/*.js", "**/*.d.ts", "**/*.map"]
  }
);
