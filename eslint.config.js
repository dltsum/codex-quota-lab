import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/release/**",
      "**/*.tsbuildinfo",
    ],
  },
  eslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "apps/*/e2e/**/*.mjs"],
    languageOptions: {
      globals: {
        fetch: "readonly",
        process: "readonly",
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
