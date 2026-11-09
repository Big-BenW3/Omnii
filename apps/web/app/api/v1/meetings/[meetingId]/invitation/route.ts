import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { inviteCredentialRotations, meetings } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { keyedHash, randomJoinCode, randomToken } from "@/lib/server/crypto";
import { ApiError, handler } from "@/lib/server/http";
import { requireHost } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

/**
 * Issues (or rotates) the invite link secret and join code. The raw values are
 * returned exactly once to the host; only keyed hashes are stored. Any previous
 * credentials stop working immediately (version bump).
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`mutation:${wallet}`, RULES.mutation);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  if (["ENDED", "FINALIZED", "CANCELLED", "EXPIRED"].includes(meeting.lifecycleStatus)) {
    throw new ApiError("MEETING_NOT_JOINABLE", "Meeting is over; invitations are closed");
  }

  const secret = randomToken(32);
  const code = randomJoinCode(8);
  const hadCredentials = !!meeting.inviteSecretHash;
  const newVersion = hadCredentials ? meeting.inviteCredentialVersion + 1 : meeting.inviteCredentialVersion;

  const db = getDb();
  const [updated] = await db
    .update(meetings)
    .set({
      inviteSecretHash: keyedHash("invite", `secret:${secret}`),
      inviteCodeHash: keyedHash("invite", `code:${code}`),
      inviteCredentialVersion: newVersion,
      updatedAt: new Date(),
    })
    // Optimistic concurrency: two simultaneous rotations cannot both win.
    .where(and(eq(meetings.id, meeting.id), eq(meetings.inviteCredentialVersion, meeting.inviteCredentialVersion)))
    .returning();
  if (!updated) throw new ApiError("CONFLICT", "Invitation was rotated concurrently; retry");

  if (hadCredentials) {
    await db.insert(inviteCredentialRotations).values({
      meetingId: meeting.id,
      previousVersion: meeting.inviteCredentialVersion,
      newVersion,
      rotatedByWallet: wallet,
    });
  }

  const origin = new URL(req.url).origin;
  return NextResponse.json(
    {
      // Secret lives in the URL fragment so it never reaches server logs (spec 10.8.3).
      inviteUrl: `${origin}/join/${meeting.id}#s=${secret}`,
      joinCode: code,
      inviteCredentialVersion: newVersion,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});
