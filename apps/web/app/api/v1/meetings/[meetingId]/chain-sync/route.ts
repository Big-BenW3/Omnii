import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler } from "@/lib/server/http";
import { syncFromChain } from "@/lib/server/lifecycle";
import { accessFor, loadMeeting, publicMeetingView } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

/**
 * Re-derives the lifecycle status from on-chain state (spec 10.4). Takes no
 * body: the server computes the room PDAs itself and never trusts a
 * client-reported status or address. Idempotent.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`chain:${wallet}`, RULES.chainRead);
  const { meetingId } = await ctx.params;
  const meeting = await loadMeeting(meetingId);
  const { role } = await accessFor(meeting, wallet);
  if (role !== "host" && role !== "admitted") throw new ApiError("FORBIDDEN", "Not a participant");
  const synced = await syncFromChain(meeting);
  return NextResponse.json(publicMeetingView(synced, role));
});
