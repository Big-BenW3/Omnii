import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { labelHash, toHex } from "@concord/receipt-hash";
import { meetings, voteRounds } from "@/lib/db/schema";
import { participantIdentity } from "@/lib/server/livekit";
import { GET as listRounds, POST as postRound } from "@/api/v1/meetings/[meetingId]/vote-rounds/route";
import { GET as listParticipants } from "@/api/v1/meetings/[meetingId]/participants/route";
import { ctx, freshDb, req, signIn, TestWallet } from "../support/harness";
import { admitGuest, newMeeting, pendingGuest } from "../support/flows";

let db: Awaited<ReturnType<typeof freshDb>>;
let host: TestWallet;
let hostCookie: string;

beforeEach(async () => {
  db = await freshDb();
  host = new TestWallet();
  hostCookie = await signIn(host);
});

const deadline = () => new Date(Date.now() + 10 * 60_000).toISOString();
const round = (overrides: Record<string, unknown> = {}) => ({
  voteId: 0,
  question: "Ship v1?",
  options: ["Yes", "No", "Later"],
  deadline: deadline(),
  ...overrides,
});
const post = (meetingId: string, body: unknown, cookie = hostCookie) =>
  postRound(req("POST", "/x", { cookie, body }), ctx({ meetingId }));

describe("vote-rounds", () => {
  it("stores labels and returns hashes that match @concord/receipt-hash", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const res = await post(meetingId, round({ question: "  Ship v1?  " }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.question).toBe("Ship v1?");
    expect(body.questionHash).toBe(toHex(await labelHash("Ship v1?")));
    expect(body.optionHashes).toEqual(
      await Promise.all(["Yes", "No", "Later"].map(async (o) => toHex(await labelHash(o))))
    );
    const [row] = await db.select().from(voteRounds).where(eq(voteRounds.meetingId, meetingId));
    // Labels only: the table has no ballot, choice or tally columns.
    expect(Object.keys(row).sort()).toEqual(["createdAt", "deadline", "meetingId", "options", "question", "voteId"]);
  });

  it("requires exactly 3 distinct non-empty options and valid bounds", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const bad = [
      round({ options: ["Yes", "No"] }),
      round({ options: ["Yes", "No", "Later", "Never"] }),
      round({ options: ["Yes", "yes", "No"] }),
      round({ options: ["Yes", "  ", "No"] }),
      round({ options: ["Yes", "No", "x".repeat(101)] }),
      round({ question: "" }),
      round({ question: "q".repeat(201) }),
      round({ voteId: 8 }),
      round({ voteId: -1 }),
      round({ deadline: "tomorrow" }),
      round({ deadline: new Date(Date.now() - 1000).toISOString() }),
    ];
    for (const body of bad) expect((await post(meetingId, body)).status).toBe(400);

    await db
      .update(meetings)
      .set({ lifecycleStatus: "LIVE", startedAt: new Date(Date.now() - 45 * 60_000) })
      .where(eq(meetings.id, meetingId));
    // Beyond started + 60 min.
    expect((await post(meetingId, round({ deadline: new Date(Date.now() + 16 * 60_000).toISOString() }))).status).toBe(400);
    expect((await post(meetingId, round())).status).toBe(201);
  });

  it("labels are immutable once stored; identical retries are idempotent", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const body = round();
    expect((await post(meetingId, body)).status).toBe(201);
    expect((await post(meetingId, body)).status).toBe(200);
    expect((await post(meetingId, { ...body, question: "Ship v2?" })).status).toBe(409);
  });

  it("only the host may create; host and admitted may read; others 403", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const guest = await admitGuest(meetingId, hostCookie);
    const pending = await pendingGuest(meetingId, hostCookie);
    const stranger = await signIn(new TestWallet());
    expect((await post(meetingId, round(), guest.cookie)).status).toBe(403);
    expect((await post(meetingId, round())).status).toBe(201);

    const get = (cookie?: string) => listRounds(req("GET", "/x", { cookie }), ctx({ meetingId }));
    expect((await get()).status).toBe(401);
    expect((await get(stranger)).status).toBe(403);
    expect((await get(pending.cookie)).status).toBe(403);
    const asGuest = await (await get(guest.cookie)).json();
    expect(asGuest.rounds).toHaveLength(1);
    expect(asGuest.rounds[0].options).toEqual(["Yes", "No", "Later"]);
    expect((await get(hostCookie)).status).toBe(200);
  });

  it("refuses new rounds after the meeting is over", async () => {
    for (const status of ["ENDED", "FINALIZED", "CANCELLED", "EXPIRED"]) {
      const meetingId = await newMeeting(db, hostCookie, status);
      expect((await post(meetingId, round())).status).toBe(409);
    }
  });
});

describe("participants", () => {
  it("maps opaque LiveKit identities to names; wallets only for the host", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const a = await admitGuest(meetingId, hostCookie, "Alex Admitted");
    const b = await admitGuest(meetingId, hostCookie, "Blake Admitted");
    const pending = await pendingGuest(meetingId, hostCookie, "Pending Pat");
    const get = (cookie?: string) => listParticipants(req("GET", "/x", { cookie }), ctx({ meetingId }));

    const asGuest = await (await get(a.cookie)).json();
    expect(asGuest.participants.map((p: { displayName: string }) => p.displayName)).toEqual([
      "Host",
      "Alex Admitted",
      "Blake Admitted",
    ]);
    expect(asGuest.participants[1].identity).toBe(participantIdentity(meetingId, a.wallet.address));
    const guestJson = JSON.stringify(asGuest);
    for (const w of [host.address, a.wallet.address, b.wallet.address, pending.wallet.address]) {
      expect(guestJson).not.toContain(w);
    }
    expect(guestJson).not.toContain("Pending Pat");
    expect(guestJson).not.toMatch(/joinRequestId|walletAddress/);

    const asHost = await (await get(hostCookie)).json();
    expect(asHost.participants[1]).toMatchObject({ walletAddress: a.wallet.address, joinRequestId: a.joinRequestId });
    expect(asHost.participants[0].walletAddress).toBe(host.address);
  });

  it("is denied to anonymous, strangers and pending wallets", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const pending = await pendingGuest(meetingId, hostCookie);
    const stranger = await signIn(new TestWallet());
    const get = (cookie?: string) => listParticipants(req("GET", "/x", { cookie }), ctx({ meetingId }));
    expect((await get()).status).toBe(401);
    expect((await get(stranger)).status).toBe(403);
    expect((await get(pending.cookie)).status).toBe(403);
  });
});
