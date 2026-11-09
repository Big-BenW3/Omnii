import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
      // `server-only` throws outside the React server bundle; it is a no-op in tests.
      "server-only": path.resolve(__dirname, "tests/support/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
    // PGlite instances are per-file; run files in parallel, tests in a file serially.
    pool: "forks",
    testTimeout: 30_000,
    // First beforeEach per file boots PGlite (WASM) and runs migrations; slow when files run in parallel.
    hookTimeout: 180_000,
  },
});
