import { NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { joinRequests, meetings } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler, parseJson } from "@/lib/server/http";
import { MAX_PARTICIPANTS, requireHost } from "@/lib/server/meetings";

type Ctx = { params: Promise<{ meetingId: string; requestId: string }> };

const Body = z.object({ decision: z.enum(["APPROVE", "REJECT"]) });

/** Host-only. Approval grants media access, not vote eligibility (spec 10.4). */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId, requestId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const { decision } = await parseJson(req, Body);

  const updated = await getDb().transaction(async (tx) => {
    // Row lock on the meeting serializes concurrent decisions, so the
    // capacity check and the admit are atomic (no over- or under-admission).
    await tx.execute(sql`select ${meetings.id} from ${meetings} where ${meetings.id} = ${meeting.id} for update`);

    if (decision === "APPROVE") {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(joinRequests)
        .where(and(eq(joinRequests.meetingId, meeting.id), eq(joinRequests.status, "ADMITTED")));
      if (Number(n) >= MAX_PARTICIPANTS - 1) {
        throw new ApiError("CAPACITY_FULL", "Meeting is full (20 including the host)");
      }
    }

    const [row] = await tx
      .update(joinRequests)
      .set({
        status: decision === "APPROVE" ? "ADMITTED" : "REJECTED",
        decidedAt: new Date(),
        decidedByWallet: wallet,
      })
      .where(
        and(
          eq(joinRequests.id, requestId),
          eq(joinRequests.meetingId, meeting.id),
          eq(joinRequests.status, "PENDING_HOST_APPROVAL")
        )
      )
      .returning();
    if (!row) throw new ApiError("CONFLICT", "Request is not pending");
    return row;
  });

  return NextResponse.json({ joinRequestId: updated.id, status: updated.status });
});
