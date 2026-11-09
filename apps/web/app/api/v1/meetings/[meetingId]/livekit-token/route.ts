import { NextResponse } from "next/server";
import { requireSession } from "@/lib/server/auth";
import { serverEnv } from "@/lib/server/env";
import { ApiError, handler } from "@/lib/server/http";
import {
  connectedCount,
  ensureRoom,
  mintToken,
  participantIdentity,
  TOKEN_TTL_SECONDS,
} from "@/lib/server/livekit";
import { accessFor, isExpired, loadMeeting, MAX_PARTICIPANTS } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

/**
 * Short-lived media token. Only the host or an admitted participant, only while
 * the meeting is LIVE and inside its 60 minutes, and only if the live room has
 * space (spec 10.5, 13.4). The client cannot choose room, identity or grants.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`livekit:${wallet}`, RULES.livekitToken);
  const { meetingId } = await ctx.params;
  const meeting = await loadMeeting(meetingId);
  const { role, request } = await accessFor(meeting, wallet);
  if (role !== "host" && role !== "admitted") {
    throw new ApiError("FORBIDDEN", "You have not been admitted to this meeting");
  }
  if (meeting.lifecycleStatus !== "LIVE" || isExpired(meeting)) {
    throw new ApiError("MEETING_NOT_JOINABLE", "The meeting is not live");
  }
  if (!meeting.livekitRoomName) throw new ApiError("SERVICE_UNAVAILABLE", "Media room not configured");

  const identity = participantIdentity(meeting.id, wallet);
  if ((await connectedCount(meeting.livekitRoomName, identity)) >= MAX_PARTICIPANTS) {
    throw new ApiError("CAPACITY_FULL", "The room is full");
  }
  await ensureRoom(meeting.livekitRoomName);

  const token = await mintToken({
    roomName: meeting.livekitRoomName,
    identity,
    displayName: role === "host" ? "Host" : (request?.displayName ?? "Participant"),
    isHost: role === "host",
  });
  return NextResponse.json(
    {
      serverUrl: serverEnv().LIVEKIT_URL,
      participantToken: token,
      identity,
      expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
});
