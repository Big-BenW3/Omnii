import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { ApiError } from "./http";

export interface LimitRule {
  /** Max events per window. */
  max: number;
  windowSeconds: number;
  /** If set, exceeding `max` locks the key for this long. */
  lockoutSeconds?: number;
}

export const RULES = {
  authNonce: { max: 10, windowSeconds: 60 },
  authVerify: { max: 10, windowSeconds: 60 },
  inviteFailure: { max: 10, windowSeconds: 15 * 60, lockoutSeconds: 15 * 60 },
  joinRequest: { max: 20, windowSeconds: 60 },
  livekitToken: { max: 30, windowSeconds: 60 },
  mutation: { max: 60, windowSeconds: 60 },
  // Routes that make RPC calls on the caller's behalf.
  chainRead: { max: 30, windowSeconds: 60 },
  publicReceipt: { max: 60, windowSeconds: 60 },
} satisfies Record<string, LimitRule>;

/**
 * Atomically counts one event for `key` (fixed window, Postgres upsert) and
 * throws RATE_LIMITED when the rule is exceeded or the key is locked out.
 * Shared across server instances, unlike an in-memory map.
 */
export async function hit(key: string, rule: LimitRule) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - rule.windowSeconds * 1000);
  const [row] = await getDb()
    .insert(rateLimits)
    .values({ key, count: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStartedAt} < ${windowStart} then 1 else ${rateLimits.count} + 1 end`,
        windowStartedAt: sql`case when ${rateLimits.windowStartedAt} < ${windowStart} then ${now} else ${rateLimits.windowStartedAt} end`,
        lockedUntil: rule.lockoutSeconds
          ? sql`case when ${rateLimits.count} + 1 > ${rule.max} and ${rateLimits.windowStartedAt} >= ${windowStart} then ${new Date(now.getTime() + rule.lockoutSeconds * 1000)} else ${rateLimits.lockedUntil} end`
          : rateLimits.lockedUntil,
      },
    })
    .returning();
  if (row.lockedUntil && row.lockedUntil > now) {
    throw new ApiError("RATE_LIMITED", "Too many attempts. Try again later.");
  }
  if (row.count > rule.max) throw new ApiError("RATE_LIMITED", "Too many requests. Slow down.");
}

/** Throws if the key is currently locked out, without counting an event. */
export async function assertNotLocked(key: string) {
  const [row] = await getDb()
    .select({ lockedUntil: rateLimits.lockedUntil })
    .from(rateLimits)
    .where(sql`${rateLimits.key} = ${key}`)
    .limit(1);
  if (row?.lockedUntil && row.lockedUntil > new Date()) {
    throw new ApiError("RATE_LIMITED", "Too many attempts. Try again later.");
  }
}
