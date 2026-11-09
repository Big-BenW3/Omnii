import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { actionItemsHash, toHex } from "@concord/receipt-hash";
import { getDb } from "@/lib/db/client";
import { receiptDrafts } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { handler, parseJson } from "@/lib/server/http";
import { requireHost } from "@/lib/server/meetings";

type Ctx = { params: Promise<{ meetingId: string }> };

const Body = z.object({
  actionItems: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(200),
        owner: z.string().trim().max(40).optional(),
      })
    )
    .max(20),
});

/**
 * Host-only convenience draft of action items (spec 10.6). It never publishes
 * anything and is not a source of truth: the on-chain receipt is.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const { actionItems } = await parseJson(req, Body);
  const hash = toHex(await actionItemsHash(actionItems));

  const db = getDb();
  const [existing] = await db
    .select({ id: receiptDrafts.id })
    .from(receiptDrafts)
    .where(eq(receiptDrafts.meetingId, meeting.id))
    .limit(1);
  if (existing) {
    await db
      .update(receiptDrafts)
      .set({ actionItemsJson: actionItems, actionItemsHash: hash, updatedAt: new Date() })
      .where(eq(receiptDrafts.id, existing.id));
  } else {
    await db.insert(receiptDrafts).values({
      meetingId: meeting.id,
      actionItemsJson: actionItems,
      actionItemsHash: hash,
      createdByWallet: wallet,
    });
  }
  return NextResponse.json({ actionItems, actionItemsHash: hash });
});

export const GET = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const [draft] = await getDb()
    .select()
    .from(receiptDrafts)
    .where(eq(receiptDrafts.meetingId, meeting.id))
    .limit(1);
  return NextResponse.json({
    actionItems: draft?.actionItemsJson ?? [],
    actionItemsHash: draft?.actionItemsHash ?? toHex(await actionItemsHash([])),
  });
});
