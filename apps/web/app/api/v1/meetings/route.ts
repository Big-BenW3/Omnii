import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { joinRequests, meetings } from "@/lib/db/schema";
import { requireSession } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";

/** Dashboard: meetings the caller hosts, and meetings they requested or were admitted to. */
export const GET = handler(async (req: Request) => {
  const { wallet } = await requireSession(req);
  const db = getDb();

  const hosted = await db
    .select({
      id: meetings.id,
      name: meetings.name,
      status: meetings.lifecycleStatus,
      scheduledStartAt: meetings.scheduledStartAt,
    })
    .from(meetings)
    .where(eq(meetings.creatorWallet, wallet))
    .orderBy(desc(meetings.scheduledStartAt))
    .limit(100);

  const joined = await db
    .select({
      id: meetings.id,
      name: meetings.name,
      status: meetings.lifecycleStatus,
      scheduledStartAt: meetings.scheduledStartAt,
      requestStatus: joinRequests.status,
      displayName: joinRequests.displayName,
    })
    .from(joinRequests)
    .innerJoin(meetings, eq(joinRequests.meetingId, meetings.id))
    .where(
      and(
        eq(joinRequests.walletAddress, wallet),
        inArray(joinRequests.status, ["PENDING_HOST_APPROVAL", "ADMITTED", "LEFT"])
      )
    )
    .orderBy(desc(joinRequests.requestedAt))
    .limit(100);

  const iso = <T extends { scheduledStartAt: Date }>(r: T) => ({
    ...r,
    scheduledStartAt: r.scheduledStartAt.toISOString(),
  });
  return NextResponse.json({
    hosted: hosted.map(iso),
    // Pending requests do not reveal the meeting name until admitted.
    joined: joined.map((r) => ({
      ...iso(r),
      name: r.requestStatus === "ADMITTED" || r.requestStatus === "LEFT" ? r.name : null,
    })),
  });
});
