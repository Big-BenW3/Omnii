import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { liveMediaSessions, meetings, webhookEvents } from "@/lib/db/schema";
import { sha256Hex } from "@/lib/server/crypto";
import { ApiError, handler } from "@/lib/server/http";
import { webhookReceiver } from "@/lib/server/livekit";

const HANDLED = new Set(["participant_joined", "participant_left", "room_finished"]);

/**
 * LiveKit webhook. Signature verified with the official SDK; idempotent by
 * event id. Updates media-session state only, never meeting or vote state
 * (spec 10.5, 13.6).
 */
export const POST = handler(async (req: Request) => {
  const body = await req.text();
  let event;
  try {
    event = await webhookReceiver().receive(body, req.headers.get("authorization") ?? undefined);
  } catch {
    throw new ApiError("UNAUTHORIZED", "Invalid webhook signature");
  }
  if (!event.id) throw new ApiError("INVALID_REQUEST", "Missing event id");

  const db = getDb();
  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: "livekit",
      externalEventId: event.id,
      eventType: event.event,
      payloadHash: sha256Hex(body),
      status: "PROCESSING",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return NextResponse.json({ status: "duplicate" });

  if (HANDLED.has(event.event) && event.room?.name) {
    const [meeting] = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(eq(meetings.livekitRoomName, event.room.name))
      .limit(1);
    const identity = event.participant?.identity;
    if (meeting && identity && event.event === "participant_joined") {
      await db
        .insert(liveMediaSessions)
        .values({
          meetingId: meeting.id,
          // Opaque identity only; the wallet is never sent to LiveKit.
          walletAddress: identity,
          livekitParticipantIdentity: `${meeting.id}:${identity}`,
          connectedAt: new Date(),
          lastEventAt: new Date(),
        })
        .onConflictDoUpdate({
          target: liveMediaSessions.livekitParticipantIdentity,
          set: { connectedAt: new Date(), disconnectedAt: null, lastEventAt: new Date() },
        });
    } else if (meeting && identity && event.event === "participant_left") {
      await db
        .update(liveMediaSessions)
        .set({ disconnectedAt: new Date(), lastEventAt: new Date() })
        .where(eq(liveMediaSessions.livekitParticipantIdentity, `${meeting.id}:${identity}`));
    } else if (meeting && event.event === "room_finished") {
      await db
        .update(liveMediaSessions)
        .set({ disconnectedAt: new Date(), lastEventAt: new Date() })
        .where(and(eq(liveMediaSessions.meetingId, meeting.id), isNull(liveMediaSessions.disconnectedAt)));
    }
  }

  await db
    .update(webhookEvents)
    .set({ status: "PROCESSED", processedAt: new Date() })
    .where(and(eq(webhookEvents.provider, "livekit"), eq(webhookEvents.externalEventId, event.id)));
  return NextResponse.json({ status: "ok" });
});
