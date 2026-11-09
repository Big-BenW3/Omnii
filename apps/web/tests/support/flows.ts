import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { meetings } from "@/lib/db/schema";
import { POST as createDraft } from "@/api/v1/meetings/drafts/route";
import { POST as issueInvite } from "@/api/v1/meetings/[meetingId]/invitation/route";
import { POST as joinPost } from "@/api/v1/meetings/[meetingId]/join-requests/route";
import { POST as decide } from "@/api/v1/meetings/[meetingId]/join-requests/[requestId]/decision/route";
import { ctx, freshDb, req, signIn, TestWallet } from "./harness";

type Db = Awaited<ReturnType<typeof freshDb>>;

export async function newMeeting(db: Db, hostCookie: string, status = "DRAFT") {
  const res = await createDraft(
    req("POST", "/x", {
      cookie: hostCookie,
      body: { name: "Secret roadmap sync", description: "Confidential agenda", scheduledStartAt: new Date(Date.now() + 60_000).toISOString() },
    })
  );
  expect(res.status).toBe(201);
  const { meetingId } = await res.json();
  if (status !== "DRAFT") await db.update(meetings).set({ lifecycleStatus: status }).where(eq(meetings.id, meetingId));
  return meetingId as string;
}

/** Admits a fresh wallet with the given display name (meeting must be joinable). */
export async function admitGuest(meetingId: string, hostCookie: string, displayName = "Taylor") {
  const inv = await issueInvite(req("POST", "/x", { cookie: hostCookie, body: {} }), ctx({ meetingId }));
  const { joinCode } = await inv.json();
  const wallet = new TestWallet();
  const cookie = await signIn(wallet);
  const r = await joinPost(req("POST", "/x", { cookie, body: { displayName, joinCode } }), ctx({ meetingId }));
  expect(r.status).toBe(201);
  const { joinRequestId } = await r.json();
  const d = await decide(
    req("POST", "/x", { cookie: hostCookie, body: { decision: "APPROVE" } }),
    ctx({ meetingId, requestId: joinRequestId })
  );
  expect(d.status).toBe(200);
  return { wallet, cookie, joinRequestId: joinRequestId as string };
}

export async function pendingGuest(meetingId: string, hostCookie: string, displayName = "Pending Pat") {
  const inv = await issueInvite(req("POST", "/x", { cookie: hostCookie, body: {} }), ctx({ meetingId }));
  const { joinCode } = await inv.json();
  const wallet = new TestWallet();
  const cookie = await signIn(wallet);
  const r = await joinPost(req("POST", "/x", { cookie, body: { displayName, joinCode } }), ctx({ meetingId }));
  expect(r.status).toBe(201);
  return { wallet, cookie };
}
