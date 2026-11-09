import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { labelHash, toHex } from "@concord/receipt-hash";
import { getDb } from "@/lib/db/client";
import { voteRounds } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler, parseJson } from "@/lib/server/http";
import { accessFor, loadMeeting, MAX_DURATION_SECONDS, requireHost } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

const MAX_VOTES = 8; // RoomResults holds up to 8 summaries (ADR-012)
const label = (max: number) =>
  z
    .string()
    .transform((s) => s.normalize("NFC").trim())
    .pipe(z.string().min(1).max(max));

const Body = z.object({
  voteId: z.number().int().min(0).max(MAX_VOTES - 1),
  question: label(200),
  options: z
    .array(label(100))
    .length(3)
    .refine((o) => new Set(o.map((s) => s.toLowerCase())).size === 3, "options must be distinct"),
  deadline: z.iso.datetime({ offset: true }),
});

type Round = typeof voteRounds.$inferSelect;

/** Label hashes the client binds on chain at open_vote (spec 9.2-C). */
async function view(r: Round) {
  const [questionHash, ...optionHashes] = await Promise.all(
    [r.question, ...r.options].map(async (s) => toHex(await labelHash(s)))
  );
  return {
    voteId: r.voteId,
    question: r.question,
    options: r.options,
    deadline: r.deadline.toISOString(),
    questionHash,
    optionHashes,
  };
}

const OPEN_STATUSES = ["DRAFT", "SETUP_PENDING", "WAITING_ROOM", "LIVE"];

/**
 * Host stores display labels for a vote round. Labels only: no ballots,
 * choices or tallies ever reach this table (spec 11.7). Once stored, a round's
 * labels are immutable, since their hashes may already be bound on chain.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`mutation:${wallet}`, RULES.mutation);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const body = await parseJson(req, Body);
  if (!OPEN_STATUSES.includes(meeting.lifecycleStatus)) {
    throw new ApiError("CONFLICT", "Votes can only be prepared before the meeting ends");
  }
  const deadline = new Date(body.deadline);
  if (deadline.getTime() <= Date.now()) throw new ApiError("INVALID_REQUEST", "Deadline must be in the future");
  if (meeting.startedAt && deadline.getTime() > meeting.startedAt.getTime() + MAX_DURATION_SECONDS * 1000) {
    throw new ApiError("INVALID_REQUEST", "Deadline must fall within the 60-minute meeting");
  }

  const db = getDb();
  const values = {
    meetingId: meeting.id,
    voteId: body.voteId,
    question: body.question,
    options: body.options as [string, string, string],
    deadline,
  };
  const [inserted] = await db.insert(voteRounds).values(values).onConflictDoNothing().returning();
  if (inserted) return NextResponse.json(await view(inserted), { status: 201 });

  const [existing] = await db
    .select()
    .from(voteRounds)
    .where(and(eq(voteRounds.meetingId, meeting.id), eq(voteRounds.voteId, body.voteId)))
    .limit(1);
  const same =
    existing &&
    existing.question === values.question &&
    JSON.stringify(existing.options) === JSON.stringify(values.options) &&
    existing.deadline.getTime() === deadline.getTime();
  if (!same) throw new ApiError("CONFLICT", "Labels for this vote are already set");
  return NextResponse.json(await view(existing));
});

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const meeting = await loadMeeting(meetingId);
  const { role } = await accessFor(meeting, wallet);
  if (role !== "host" && role !== "admitted") throw new ApiError("FORBIDDEN", "Not a participant");
  const rounds = await getDb()
    .select()
    .from(voteRounds)
    .where(eq(voteRounds.meetingId, meeting.id))
    .orderBy(asc(voteRounds.voteId));
  return NextResponse.json({ rounds: await Promise.all(rounds.map(view)) });
});
