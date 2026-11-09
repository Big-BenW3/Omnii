import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
/** Enables the test-only seed route on the E2E server (never set in deployments). */
export const E2E_SEED_SECRET = "e2e-seed-secret-0123456789abcdef0123456789";

/**
 * E2E against the production build on a fresh embedded database, the deployed
 * Devnet program + MagicBlock TEE PER, and LiveKit (LIVEKIT_* from apps/web/.env.local).
 * Fake camera/mic devices stand in for real hardware.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/out/report" }]],
  outputDir: "tests/e2e/out/artifacts",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Full Chromium in new-headless mode (no separate headless-shell download).
    channel: "chromium",
    trace: "retain-on-failure",
    // Traces capture failures; video would need the separate ffmpeg download.
    video: "off",
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
        // Use the OS resolver; Chromium's built-in async DNS fails under WSL2.
        "--disable-features=AsyncDns",
      ],
    },
  },
  projects: [
    // Fast suite: no Devnet transactions (meetings are seeded); real LiveKit media.
    { name: "fast", testIgnore: /\.devnet\.spec\.ts$/, use: { ...devices["Desktop Chrome"], permissions: ["camera", "microphone"] } },
    // Full product loop on Devnet + TEE PER (slow; run on demand / nightly).
    { name: "devnet", testMatch: /\.devnet\.spec\.ts$/, use: { ...devices["Desktop Chrome"], permissions: ["camera", "microphone"] } },
  ],
  webServer: {
    cwd: "apps/web",
    command: `rm -rf .data/e2e && node scripts/migrate-local.mjs .data/e2e && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/auth/check`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL: "pglite:.data/e2e",
      DATABASE_URL_POOLED: "",
      APP_BASE_URL: `http://localhost:${PORT}`,
      NODE_OPTIONS: "--dns-result-order=ipv4first",
      CONCORD_E2E_SEED_SECRET: E2E_SEED_SECRET,
    },
  },
});
