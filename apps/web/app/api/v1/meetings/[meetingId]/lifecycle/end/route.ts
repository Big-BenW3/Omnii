import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler } from "@/lib/server/http";
import { INVALIDATE_INVITES, transition } from "@/lib/server/lifecycle";
import { closeRoom } from "@/lib/server/livekit";
import { publicMeetingView, requireHost } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

/**
 * LIVE -> ENDED, host only. Closes the media room and invalidates invites.
 * The on-chain `end_meeting` (PER) is signed by the host separately; FINALIZED
 * is only reached through chain-sync once the receipt is final on chain.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`mutation:${wallet}`, RULES.mutation);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  if (["ENDED", "EXPIRED", "FINALIZED"].includes(meeting.lifecycleStatus)) {
    return NextResponse.json(publicMeetingView(meeting, "host"));
  }
  if (meeting.lifecycleStatus !== "LIVE") throw new ApiError("CONFLICT", "Only a live meeting can be ended");
  const updated = await transition(meeting, ["LIVE"], "ENDED", { endedAt: new Date(), ...INVALIDATE_INVITES });
  if (updated.livekitRoomName) await closeRoom(updated.livekitRoomName);
  return NextResponse.json(publicMeetingView(updated, "host"));
});
