import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { joinRequests, meetings, webhookEvents } from "@/lib/db/schema";
import { POST as createDraft } from "@/api/v1/meetings/drafts/route";
import { GET as getMeeting } from "@/api/v1/meetings/[meetingId]/route";
import { GET as dashboard } from "@/api/v1/meetings/route";
import { POST as issueInvite } from "@/api/v1/meetings/[meetingId]/invitation/route";
import { POST as joinPost, GET as joinList } from "@/api/v1/meetings/[meetingId]/join-requests/route";
import { POST as decide } from "@/api/v1/meetings/[meetingId]/join-requests/[requestId]/decision/route";
import { PATCH as setVoter } from "@/api/v1/meetings/[meetingId]/participants/[requestId]/route";
import { POST as livekitToken } from "@/api/v1/meetings/[meetingId]/livekit-token/route";
import { POST as webhook } from "@/api/v1/webhooks/livekit/route";
import { POST as receiptDraft } from "@/api/v1/meetings/[meetingId]/receipt-draft/route";
import { ctx, freshDb, req, signIn, TestWallet } from "../support/harness";

let db: Awaited<ReturnType<typeof freshDb>>;
let host: TestWallet;
let hostCookie: string;

beforeEach(async () => {
  db = await freshDb();
  host = new TestWallet();
  hostCookie = await signIn(host);
});

async function newMeeting(status = "WAITING_ROOM") {
  const res = await createDraft(
    req("POST", "/api/v1/meetings/drafts", {
      cookie: hostCookie,
      body: { name: "Roadmap sync", scheduledStartAt: new Date(Date.now() + 60_000).toISOString() },
    })
  );
  expect(res.status).toBe(201);
  const { meetingId } = await res.json();
  await db.update(meetings).set({ lifecycleStatus: status }).where(eq(meetings.id, meetingId));
  return meetingId as string;
}

async function invite(meetingId: string) {
  const res = await issueInvite(req("POST", `/x`, { cookie: hostCookie, body: {} }), ctx({ meetingId }));
  expect(res.status).toBe(200);
  return (await res.json()) as { inviteUrl: string; joinCode: string; inviteCredentialVersion: number };
}

async function requestJoin(meetingId: string, cookie: string, body: Record<string, string>) {
  return joinPost(req("POST", "/x", { cookie, body: { displayName: "Taylor", ...body } }), ctx({ meetingId }));
}

async function guestAdmitted(meetingId: string, code: string) {
  const g = new TestWallet();
  const cookie = await signIn(g);
  const r = await requestJoin(meetingId, cookie, { joinCode: code });
  const { joinRequestId } = await r.json();
  const d = await decide(
    req("POST", "/x", { cookie: hostCookie, body: { decision: "APPROVE" } }),
    ctx({ meetingId, requestId: joinRequestId })
  );
  return { wallet: g, cookie, joinRequestId, decision: d };
}

describe("meeting drafts and visibility", () => {
  it("requires a session and enforces the fixed 60 min / 20 person limits", async () => {
    const anon = await createDraft(
      req("POST", "/x", { body: { name: "abc", scheduledStartAt: new Date().toISOString() } })
    );
    expect(anon.status).toBe(401);
    const meetingId = await newMeeting("DRAFT");
    const view = await (await getMeeting(req("GET", "/x", { cookie: hostCookie }), ctx({ meetingId }))).json();
    expect(view).toMatchObject({ role: "host", maximumDurationSeconds: 3600, maximumParticipants: 20 });
    expect(JSON.stringify(view)).not.toMatch(/inviteSecretHash|inviteCodeHash/);
  });

  it("hides meeting details from wallets that are not admitted", async () => {
    const meetingId = await newMeeting();
    const stranger = await signIn(new TestWallet());
    const view = await (await getMeeting(req("GET", "/x", { cookie: stranger }), ctx({ meetingId }))).json();
    expect(view.role).toBe("none");
    expect(view.name).toBeNull();
    expect(view.description).toBeUndefined();
  });
});

describe("invitations and join requests", () => {
  it("returns the invite link and code once, as a URL fragment, host only", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    expect(inv.inviteUrl).toMatch(new RegExp(`/join/${meetingId}#s=`));
    expect(inv.joinCode).toMatch(/^[A-Z2-9]{8}$/);
    const stranger = await signIn(new TestWallet());
    const res = await issueInvite(req("POST", "/x", { cookie: stranger, body: {} }), ctx({ meetingId }));
    expect(res.status).toBe(403);
  });

  it("accepts the link secret or the code, and rejects wrong credentials", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const secret = inv.inviteUrl.split("#s=")[1];
    const a = await signIn(new TestWallet());
    expect((await requestJoin(meetingId, a, { inviteSecret: secret })).status).toBe(201);
    const b = await signIn(new TestWallet());
    expect((await requestJoin(meetingId, b, { joinCode: inv.joinCode.toLowerCase() })).status).toBe(201);
    const c = await signIn(new TestWallet());
    expect((await requestJoin(meetingId, c, { joinCode: "WRONGCOD" })).status).toBe(403);
  });

  it("locks out after repeated invalid attempts", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const w = await signIn(new TestWallet());
    for (let i = 0; i < 11; i++) await requestJoin(meetingId, w, { joinCode: "WRONGCOD" });
    const res = await requestJoin(meetingId, w, { joinCode: inv.joinCode });
    expect(res.status).toBe(429);
  });

  it("rotation invalidates the previous credentials", async () => {
    const meetingId = await newMeeting();
    const old = await invite(meetingId);
    const fresh = await invite(meetingId);
    expect(fresh.inviteCredentialVersion).toBe(old.inviteCredentialVersion + 1);
    const w = await signIn(new TestWallet());
    expect((await requestJoin(meetingId, w, { joinCode: old.joinCode })).status).toBe(403);
    expect((await requestJoin(meetingId, w, { joinCode: fresh.joinCode })).status).toBe(201);
  });

  it("refuses joins before the meeting is set up", async () => {
    const meetingId = await newMeeting("DRAFT");
    const inv = await invite(meetingId);
    const w = await signIn(new TestWallet());
    expect((await requestJoin(meetingId, w, { joinCode: inv.joinCode })).status).toBe(409);
  });

  it("host decides; a rejected wallet cannot re-request; decisions are pending-only", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const w = await signIn(new TestWallet());
    const { joinRequestId } = await (await requestJoin(meetingId, w, { joinCode: inv.joinCode })).json();

    const notHost = await decide(
      req("POST", "/x", { cookie: w, body: { decision: "APPROVE" } }),
      ctx({ meetingId, requestId: joinRequestId })
    );
    expect(notHost.status).toBe(403);

    const reject = await decide(
      req("POST", "/x", { cookie: hostCookie, body: { decision: "REJECT" } }),
      ctx({ meetingId, requestId: joinRequestId })
    );
    expect(reject.status).toBe(200);
    const again = await decide(
      req("POST", "/x", { cookie: hostCookie, body: { decision: "APPROVE" } }),
      ctx({ meetingId, requestId: joinRequestId })
    );
    expect(again.status).toBe(409);
    expect((await requestJoin(meetingId, w, { joinCode: inv.joinCode })).status).toBe(403);
  });

  it("caps the meeting at 20 including the host, even under concurrent approvals", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const pending: string[] = [];
    for (let i = 0; i < 21; i++) {
      const cookie = await signIn(new TestWallet());
      const r = await requestJoin(meetingId, cookie, { joinCode: inv.joinCode });
      pending.push((await r.json()).joinRequestId);
    }
    const results = await Promise.all(
      pending.map((requestId) =>
        decide(req("POST", "/x", { cookie: hostCookie, body: { decision: "APPROVE" } }), ctx({ meetingId, requestId }))
      )
    );
    const admitted = await db.select().from(joinRequests).where(eq(joinRequests.status, "ADMITTED"));
    expect(admitted.length).toBe(19);
    expect(results.filter((r) => r.status === 200).length).toBe(19);
  });

  it("host can toggle voter/observer for admitted participants only", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const g = await guestAdmitted(meetingId, inv.joinCode);
    const res = await setVoter(
      req("PATCH", "/x", { cookie: hostCookie, body: { isVoter: true } }),
      ctx({ meetingId, requestId: g.joinRequestId })
    );
    expect((await res.json()).isVoter).toBe(true);
    const list = await (await joinList(req("GET", "/x", { cookie: hostCookie }), ctx({ meetingId }))).json();
    expect(list.requests[0]).toMatchObject({ displayName: "Taylor", status: "ADMITTED", isVoter: true });
    const dash = await (await dashboard(req("GET", "/x", { cookie: g.cookie }))).json();
    expect(dash.joined[0].name).toBe("Roadmap sync");
  });
});

describe("LiveKit token", () => {
  it("is denied to unadmitted wallets and before the meeting is live", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const stranger = await signIn(new TestWallet());
    expect((await livekitToken(req("POST", "/x", { cookie: stranger, body: {} }), ctx({ meetingId }))).status).toBe(403);
    const g = await guestAdmitted(meetingId, inv.joinCode);
    expect((await livekitToken(req("POST", "/x", { cookie: g.cookie, body: {} }), ctx({ meetingId }))).status).toBe(409);
  });

  it("issues short-lived, opaque, least-privilege tokens; host-only admin", async () => {
    const meetingId = await newMeeting();
    const inv = await invite(meetingId);
    const g = await guestAdmitted(meetingId, inv.joinCode);
    await db.update(meetings).set({ lifecycleStatus: "LIVE", startedAt: new Date() }).where(eq(meetings.id, meetingId));

    const guestRes = await livekitToken(req("POST", "/x", { cookie: g.cookie, body: {} }), ctx({ meetingId }));
    expect(guestRes.status).toBe(200);
    const body = await guestRes.json();
    expect(JSON.stringify(body)).not.toContain(process.env.LIVEKIT_API_SECRET!);
    const claims = decodeJwt(body.participantToken) as Record<string, any>;
    expect(claims.sub).not.toBe(g.wallet.address);
    expect(claims.sub).toMatch(/^p_[0-9a-f]{32}$/);
    expect(claims.exp! - claims.nbf!).toBeLessThanOrEqual(600);
    expect(claims.video.roomAdmin ?? false).toBe(false);
    expect(claims.video.canPublishSources).toEqual(["camera", "microphone"]);

    const hostClaims = decodeJwt(
      (await (await livekitToken(req("POST", "/x", { cookie: hostCookie, body: {} }), ctx({ meetingId }))).json())
        .participantToken
    ) as Record<string, any>;
    expect(hostClaims.video.roomAdmin).toBe(true);
  });

  it("refuses tokens after the 60-minute limit", async () => {
    const meetingId = await newMeeting();
    await db
      .update(meetings)
      .set({ lifecycleStatus: "LIVE", startedAt: new Date(Date.now() - 3601_000) })
      .where(eq(meetings.id, meetingId));
    expect((await livekitToken(req("POST", "/x", { cookie: hostCookie, body: {} }), ctx({ meetingId }))).status).toBe(409);
  });
});

describe("LiveKit webhook", () => {
  async function signed(body: string) {
    const sha = createHash("sha256").update(body).digest("base64");
    return new SignJWT({ sha256: sha })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(process.env.LIVEKIT_API_KEY!)
      .setNotBefore(Math.floor(Date.now() / 1000) - 5)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.LIVEKIT_API_SECRET!));
  }
  const body = JSON.stringify({ event: "room_started", id: "EV_1", room: { name: "r1" }, createdAt: "1" });

  it("rejects unsigned or tampered deliveries", async () => {
    const unsigned = await webhook(
      new Request("http://localhost:3100/api/v1/webhooks/livekit", { method: "POST", body })
    );
    expect(unsigned.status).toBe(401);
    const auth = await signed(body);
    const tampered = await webhook(
      new Request("http://localhost:3100/api/v1/webhooks/livekit", {
        method: "POST",
        body: body.replace("EV_1", "EV_2"),
        headers: { authorization: auth },
      })
    );
    expect(tampered.status).toBe(401);
  });

  it("is idempotent for duplicate deliveries", async () => {
    const auth = await signed(body);
    const send = () =>
      webhook(
        new Request("http://localhost:3100/api/v1/webhooks/livekit", {
          method: "POST",
          body,
          headers: { authorization: auth },
        })
      );
    expect((await (await send()).json()).status).toBe("ok");
    expect((await (await send()).json()).status).toBe("duplicate");
    expect((await db.select().from(webhookEvents)).length).toBe(1);
  });
});

describe("receipt draft", () => {
  it("is host-only and hashes action items canonically", async () => {
    const meetingId = await newMeeting();
    const res = await receiptDraft(
      req("POST", "/x", { cookie: hostCookie, body: { actionItems: [{ text: "Ship v1", owner: "Ana" }] } }),
      ctx({ meetingId })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).actionItemsHash).toMatch(/^[0-9a-f]{64}$/);
    const other = await signIn(new TestWallet());
    const denied = await receiptDraft(
      req("POST", "/x", { cookie: other, body: { actionItems: [] } }),
      ctx({ meetingId })
    );
    expect(denied.status).toBe(403);
  });
});
