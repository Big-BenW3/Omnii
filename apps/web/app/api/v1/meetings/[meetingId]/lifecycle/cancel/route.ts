import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler } from "@/lib/server/http";
import { INVALIDATE_INVITES, transition } from "@/lib/server/lifecycle";
import { publicMeetingView, requireHost, type MeetingStatus } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

const CANCELLABLE: MeetingStatus[] = ["DRAFT", "SETUP_PENDING", "WAITING_ROOM"];

/** Host cancels a meeting that has not started. Invites stop working. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`mutation:${wallet}`, RULES.mutation);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  if (meeting.lifecycleStatus === "CANCELLED") return NextResponse.json(publicMeetingView(meeting, "host"));
  if (!CANCELLABLE.includes(meeting.lifecycleStatus as MeetingStatus)) {
    throw new ApiError("CONFLICT", "A meeting can only be cancelled before it starts");
  }
  const updated = await transition(meeting, CANCELLABLE, "CANCELLED", INVALIDATE_INVITES);
  if (updated.lifecycleStatus !== "CANCELLED") {
    throw new ApiError("CONFLICT", "A meeting can only be cancelled before it starts");
  }
  return NextResponse.json(publicMeetingView(updated, "host"));
});
