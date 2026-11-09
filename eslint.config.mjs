import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      next: { rootDir: "apps/web" },
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    "apps/web/.next/**",
    "out/**",
    "build/**",
    "apps/web/next-env.d.ts",
    // Generated Codama files:
    "apps/web/app/generated/**",
    // Rust build artifacts:
    "target/**",
  ]),
]);

export default eslintConfig;
