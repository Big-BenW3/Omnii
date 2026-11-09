import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { joinRequests } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { ApiError, handler, parseJson } from "@/lib/server/http";
import { requireHost } from "@/lib/server/meetings";

type Ctx = { params: Promise<{ meetingId: string; requestId: string }> };

const Body = z.object({ isVoter: z.boolean() });

/**
 * Host toggles voter/observer for an admitted participant. This is a UI
 * preference; the program freezes the real eligibility snapshot at open_vote.
 */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId, requestId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const { isVoter } = await parseJson(req, Body);
  const [updated] = await getDb()
    .update(joinRequests)
    .set({ isVoter })
    .where(
      and(
        eq(joinRequests.id, requestId),
        eq(joinRequests.meetingId, meeting.id),
        eq(joinRequests.status, "ADMITTED")
      )
    )
    .returning();
  if (!updated) throw new ApiError("NOT_FOUND", "Admitted participant not found");
  return NextResponse.json({ id: updated.id, isVoter: updated.isVoter });
});
