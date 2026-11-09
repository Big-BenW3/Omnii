import { NextResponse } from "next/server";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { meetings } from "@/lib/db/schema";
import { safeEqualHex, sha256Hex } from "@/lib/server/crypto";
import { serverEnv } from "@/lib/server/env";
import { ApiError, handler } from "@/lib/server/http";
import { closeRoom } from "@/lib/server/livekit";
import { MAX_DURATION_SECONDS } from "@/lib/server/meetings";

/**
 * Media-side expiry (spec 10.8.4, 13.6). Marks LIVE meetings past their 60
 * minutes as EXPIRED, closes the LiveKit room, and invalidates invitations.
 * On-chain vote acceptance stops at the deadline independently of this job.
 * Called by Vercel cron (Authorization: Bearer CRON_SECRET) or scripts/expire.mjs.
 */
export const POST = handler(async (req: Request) => {
  const secret = serverEnv().CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || !auth || !safeEqualHex(sha256Hex(auth), sha256Hex(secret))) {
    throw new ApiError("UNAUTHORIZED", "Invalid cron credentials");
  }
  const cutoff = new Date(Date.now() - MAX_DURATION_SECONDS * 1000);
  const expired = await getDb()
    .update(meetings)
    .set({
      lifecycleStatus: "EXPIRED",
      endedAt: sql`coalesce(${meetings.endedAt}, now())`,
      inviteSecretHash: null,
      inviteCodeHash: null,
      updatedAt: new Date(),
    })
    .where(and(eq(meetings.lifecycleStatus, "LIVE"), lt(meetings.startedAt, cutoff)))
    .returning({ id: meetings.id, room: meetings.livekitRoomName });
  await Promise.all(expired.map((m) => (m.room ? closeRoom(m.room) : null)));
  return NextResponse.json({ expired: expired.map((m) => m.id) });
});

export const GET = POST;
