import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { joinRequests } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler } from "@/lib/server/http";
import { participantIdentity } from "@/lib/server/livekit";
import { accessFor, loadMeeting } from "@/lib/server/meetings";

type Ctx = { params: Promise<{ meetingId: string }> };

/**
 * Roster for the room UI: display names and opaque LiveKit identities so tiles
 * can be labelled. Wallets and request ids are returned to the host only.
 */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const meeting = await loadMeeting(meetingId);
  const { role } = await accessFor(meeting, wallet);
  if (role !== "host" && role !== "admitted") throw new ApiError("FORBIDDEN", "Not a participant");
  const isHost = role === "host";

  const admitted = await getDb()
    .select()
    .from(joinRequests)
    .where(and(eq(joinRequests.meetingId, meeting.id), eq(joinRequests.status, "ADMITTED")))
    .orderBy(asc(joinRequests.decidedAt));

  return NextResponse.json({
    participants: [
      {
        role: "host",
        displayName: "Host",
        identity: participantIdentity(meeting.id, meeting.creatorWallet),
        ...(isHost ? { walletAddress: meeting.creatorWallet } : {}),
      },
      ...admitted.map((r) => ({
        role: "participant",
        displayName: r.displayName,
        identity: participantIdentity(meeting.id, r.walletAddress),
        isVoter: r.isVoter,
        ...(isHost ? { walletAddress: r.walletAddress, joinRequestId: r.id } : {}),
      })),
    ],
  });
});
