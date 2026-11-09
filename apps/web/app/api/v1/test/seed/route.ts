import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { meetings } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { safeEqualHex, sha256Hex } from "@/lib/server/crypto";
import { ApiError, handler, parseJson } from "@/lib/server/http";

/**
 * E2E-only: moves a meeting the caller hosts into a given lifecycle state so
 * media/join suites can run without Devnet setup. Disabled (404) unless
 * CONCORD_E2E_SEED_SECRET is set, and never on a Vercel production deploy.
 */
const Body = z.object({
  meetingId: z.uuid(),
  status: z.enum(["WAITING_ROOM", "LIVE", "ENDED"]),
  startedSecondsAgo: z.number().int().min(0).max(7200).optional(),
});

export const POST = handler(async (req: Request) => {
  const secret = process.env.CONCORD_E2E_SEED_SECRET;
  if (!secret || secret.length < 32 || process.env.VERCEL_ENV === "production") {
    throw new ApiError("NOT_FOUND", "Not found");
  }
  const given = req.headers.get("x-e2e-seed") ?? "";
  if (!safeEqualHex(sha256Hex(given), sha256Hex(secret))) throw new ApiError("NOT_FOUND", "Not found");

  const { wallet } = await requireSession(req);
  const body = await parseJson(req, Body);
  const [m] = await getDb().select().from(meetings).where(eq(meetings.id, body.meetingId)).limit(1);
  if (!m || m.creatorWallet !== wallet) throw new ApiError("FORBIDDEN", "Host only");
  const startedAt =
    body.status === "WAITING_ROOM" ? null : new Date(Date.now() - (body.startedSecondsAgo ?? 0) * 1000);
  await getDb()
    .update(meetings)
    .set({ lifecycleStatus: body.status, startedAt, updatedAt: new Date() })
    .where(eq(meetings.id, m.id));
  return NextResponse.json({ ok: true });
});
