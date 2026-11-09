import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";
import { accessFor, loadMeeting, publicMeetingView } from "@/lib/server/meetings";

type Ctx = { params: Promise<{ meetingId: string }> };

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const meeting = await loadMeeting(meetingId);
  const { role, request } = await accessFor(meeting, wallet);
  return NextResponse.json({
    ...publicMeetingView(meeting, role),
    joinRequest: request
      ? { id: request.id, status: request.status, displayName: request.displayName, isVoter: request.isVoter }
      : null,
  });
});
