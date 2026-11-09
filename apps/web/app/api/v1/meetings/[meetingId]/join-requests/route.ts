import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { joinRequests } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { keyedHash, normalizeJoinCode, safeEqualHex } from "@/lib/server/crypto";
import { ApiError, clientIp, handler, parseJson } from "@/lib/server/http";
import {
  activeRequestFor,
  admittedCount,
  assertJoinable,
  loadMeeting,
  MAX_PARTICIPANTS,
  requireHost,
} from "@/lib/server/meetings";
import { assertNotLocked, hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

const Body = z
  .object({
    inviteSecret: z.string().min(16).max(128).optional(),
    joinCode: z.string().min(4).max(16).optional(),
    displayName: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^[^<>]*$/, "Display name cannot contain < or >"),
  })
  .refine((b) => !!b.inviteSecret !== !!b.joinCode, {
    message: "Provide exactly one of inviteSecret or joinCode",
  });

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const lockKeys = [`invite:wallet:${wallet}`, `invite:ip:${clientIp(req)}`];
  for (const k of lockKeys) await assertNotLocked(k);
  await hit(`join:${wallet}`, RULES.joinRequest);

  const body = await parseJson(req, Body);
  const meeting = await loadMeeting(meetingId);

  const valid = body.inviteSecret
    ? safeEqualHex(meeting.inviteSecretHash, keyedHash("invite", `secret:${body.inviteSecret}`))
    : safeEqualHex(meeting.inviteCodeHash, keyedHash("invite", `code:${normalizeJoinCode(body.joinCode!)}`));
  if (!valid) {
    // Count failures toward lockout (spec 10.4: temporary lockout after repeated failures).
    for (const k of lockKeys) await hit(k, RULES.inviteFailure).catch(() => {});
    throw new ApiError("FORBIDDEN", "This invitation is invalid or has been replaced");
  }
  if (meeting.creatorWallet === wallet) {
    throw new ApiError("INVALID_REQUEST", "You are the host of this meeting");
  }
  assertJoinable(meeting);

  const db = getDb();
  const previous = await db
    .select({ status: joinRequests.status })
    .from(joinRequests)
    .where(and(eq(joinRequests.meetingId, meeting.id), eq(joinRequests.walletAddress, wallet)));
  if (previous.some((p) => p.status === "REJECTED")) {
    throw new ApiError("FORBIDDEN", "The host declined your request for this meeting");
  }
  const active = await activeRequestFor(meeting.id, wallet);
  if (active) {
    return NextResponse.json({ joinRequestId: active.id, status: active.status });
  }
  if ((await admittedCount(meeting.id)) >= MAX_PARTICIPANTS - 1) {
    throw new ApiError("CAPACITY_FULL", "This meeting is full");
  }

  try {
    const [created] = await db
      .insert(joinRequests)
      .values({ meetingId: meeting.id, walletAddress: wallet, displayName: body.displayName })
      .returning();
    return NextResponse.json({ joinRequestId: created.id, status: created.status }, { status: 201 });
  } catch {
    // Unique active-request index: a concurrent duplicate lost the race.
    const existing = await activeRequestFor(meeting.id, wallet);
    if (existing) return NextResponse.json({ joinRequestId: existing.id, status: existing.status });
    throw new ApiError("CONFLICT", "Could not create join request");
  }
});

/** Host only: pending requests and admitted participants. */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const rows = await getDb()
    .select()
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.meetingId, meeting.id),
        inArray(joinRequests.status, ["PENDING_HOST_APPROVAL", "ADMITTED"])
      )
    )
    .orderBy(asc(joinRequests.requestedAt));
  return NextResponse.json({
    requests: rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      walletShort: `${r.walletAddress.slice(0, 4)}…${r.walletAddress.slice(-4)}`,
      wallet: r.walletAddress,
      status: r.status,
      isVoter: r.isVoter,
      requestedAt: r.requestedAt.toISOString(),
    })),
  });
});
