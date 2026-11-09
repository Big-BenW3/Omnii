import "server-only";
import { parseServerEnv, type ServerEnv } from "@concord/shared-types/env";

let cached: ServerEnv | null = null;

/**
 * Validated server environment. Parsed lazily on first use (so `next build`
 * does not require secrets) and cached. Throws with a clear message if any
 * required value is missing, a placeholder, or points at mainnet.
 * There are deliberately no fallback secrets anywhere in the app.
 */
export function serverEnv(): ServerEnv {
  if (!cached) cached = parseServerEnv(process.env);
  return cached;
}

/** Test hook: clear the cache after mutating process.env. */
export function resetServerEnvForTests() {
  cached = null;
}
