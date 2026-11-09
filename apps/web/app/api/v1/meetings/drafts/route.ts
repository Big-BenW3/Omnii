import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { meetings } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { randomToken } from "@/lib/server/crypto";
import { ApiError, handler, parseJson } from "@/lib/server/http";
import { MAX_DURATION_SECONDS, MAX_PARTICIPANTS } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

const Body = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().max(280).optional(),
  scheduledStartAt: z.iso.datetime(),
});

/** Creates off-chain draft metadata only. Chain setup follows from the client (spec 10.4). */
export const POST = handler(async (req: Request) => {
  const { wallet } = await requireSession(req);
  await hit(`mutation:${wallet}`, RULES.mutation);
  const body = await parseJson(req, Body);
  const scheduled = new Date(body.scheduledStartAt);
  if (scheduled.getTime() < Date.now() - 5 * 60 * 1000) {
    throw new ApiError("INVALID_REQUEST", "Scheduled start must not be in the past");
  }

  const [meeting] = await getDb()
    .insert(meetings)
    .values({
      creatorWallet: wallet,
      name: body.name,
      description: body.description || null,
      scheduledStartAt: scheduled,
      lifecycleStatus: "DRAFT",
      // Opaque LiveKit room name: never the title or any public id (spec 13.4).
      livekitRoomName: randomToken(16),
      maximumDurationSeconds: MAX_DURATION_SECONDS,
      maximumParticipants: MAX_PARTICIPANTS,
    })
    .returning();

  return NextResponse.json(
    {
      meetingId: meeting.id,
      status: meeting.lifecycleStatus,
      maximumDurationSeconds: MAX_DURATION_SECONDS,
      maximumParticipants: MAX_PARTICIPANTS,
    },
    { status: 201 }
  );
});
