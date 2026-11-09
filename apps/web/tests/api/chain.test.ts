import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import bs58 from "bs58";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, roomKeys } from "@concord/client";
import { actionItemsHash } from "@concord/receipt-hash";
import { meetings, receiptDrafts, voteRounds } from "@/lib/db/schema";
import { setChainReaderForTests } from "@/lib/server/chain";
import { POST as chainSync } from "@/api/v1/meetings/[meetingId]/chain-sync/route";
import { POST as start } from "@/api/v1/meetings/[meetingId]/lifecycle/start/route";
import { POST as end } from "@/api/v1/meetings/[meetingId]/lifecycle/end/route";
import { POST as cancel } from "@/api/v1/meetings/[meetingId]/lifecycle/cancel/route";
import { POST as receiptDraft } from "@/api/v1/meetings/[meetingId]/receipt-draft/route";
import { POST as postRound } from "@/api/v1/meetings/[meetingId]/vote-rounds/route";
import { GET as getReceipt } from "@/api/v1/receipts/[registryAddress]/route";
import { ctx, freshDb, req, signIn, TestWallet } from "../support/harness";
import { FakeChain, finalizedRoom, registryValue } from "../support/chain";
import { admitGuest, newMeeting, pendingGuest } from "../support/flows";

let db: Awaited<ReturnType<typeof freshDb>>;
let host: TestWallet;
let hostCookie: string;
let fake: FakeChain;

beforeEach(async () => {
  db = await freshDb();
  host = new TestWallet();
  hostCookie = await signIn(host);
  fake = new FakeChain().install();
});
afterEach(() => setChainReaderForTests(null));

const keysFor = (meetingId: string) => roomKeys(host.kp.publicKey, meetingId);
const sync = (meetingId: string, cookie = hostCookie, body?: unknown) =>
  chainSync(req("POST", "/x", { cookie, body }), ctx({ meetingId }));
const statusOf = async (meetingId: string) =>
  (await db.select().from(meetings).where(eq(meetings.id, meetingId)))[0];
const sig = () => bs58.encode(Keypair.generate().secretKey);

describe("chain-sync", () => {
  it("advances DRAFT -> SETUP_PENDING -> WAITING_ROOM only on verified chain state", async () => {
    const meetingId = await newMeeting(db, hostCookie);
    const k = keysFor(meetingId);

    // Nothing on chain: stays DRAFT.
    let res = await sync(meetingId);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("DRAFT");

    await fake.put(k.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId));
    res = await sync(meetingId);
    const view = await res.json();
    expect(view.status).toBe("SETUP_PENDING");
    expect(view.registryAddress).toBe(k.registry.toBase58());

    // VRF fulfilled but not delegated yet: no change.
    await fake.put(k.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId, { vrfFulfilled: true }));
    expect((await (await sync(meetingId)).json()).status).toBe("SETUP_PENDING");
    // Delegated but VRF not fulfilled: no change.
    await fake.put(k.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId));
    fake.delegate(k.session);
    fake.delegate(k.results);
    expect((await (await sync(meetingId)).json()).status).toBe("SETUP_PENDING");

    await fake.put(k.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId, { vrfFulfilled: true }));
    expect((await (await sync(meetingId)).json()).status).toBe("WAITING_ROOM");
    // Idempotent.
    expect((await (await sync(meetingId)).json()).status).toBe("WAITING_ROOM");
  });

  it("ignores client-supplied status and addresses", async () => {
    const meetingId = await newMeeting(db, hostCookie);
    const res = await sync(meetingId, hostCookie, {
      status: "FINALIZED",
      lifecycleStatus: "LIVE",
      registryAddress: Keypair.generate().publicKey.toBase58(),
    });
    expect((await res.json()).status).toBe("DRAFT");
    expect((await statusOf(meetingId)).roomRegistryAddress).toBeNull();
  });

  it("rejects registries not owned by the program or for another creator", async () => {
    const meetingId = await newMeeting(db, hostCookie);
    const k = keysFor(meetingId);
    await fake.put(k.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId), Keypair.generate().publicKey);
    expect((await (await sync(meetingId)).json()).status).toBe("DRAFT");
    await fake.put(k.registry, "RoomRegistry", registryValue(Keypair.generate().publicKey, meetingId));
    expect((await (await sync(meetingId)).json()).status).toBe("DRAFT");
  });

  it("only the host or admitted participants may sync", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const anon = await chainSync(req("POST", "/x"), ctx({ meetingId }));
    expect(anon.status).toBe(401);
    const stranger = await signIn(new TestWallet());
    expect((await sync(meetingId, stranger)).status).toBe(403);
    const pending = await pendingGuest(meetingId, hostCookie);
    expect((await sync(meetingId, pending.cookie)).status).toBe(403);
    const guest = await admitGuest(meetingId, hostCookie);
    expect((await sync(meetingId, guest.cookie)).status).toBe(200);
  });

  it("returns SERVICE_UNAVAILABLE when the RPC fails, without changing status", async () => {
    const meetingId = await newMeeting(db, hostCookie);
    fake.baseDown = true;
    const res = await sync(meetingId);
    expect(res.status).toBe(503);
    expect((await statusOf(meetingId)).lifecycleStatus).toBe("DRAFT");
  });

  it("ENDED -> FINALIZED only once the receipt is final on chain", async () => {
    const meetingId = await newMeeting(db, hostCookie, "ENDED");
    const k = keysFor(meetingId);
    await fake.put(k.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId, { vrfFulfilled: true }));
    expect((await (await sync(meetingId)).json()).status).toBe("ENDED");

    const room = await finalizedRoom(host.kp.publicKey, meetingId, [], await actionItemsHash([]));
    await fake.put(k.registry, "RoomRegistry", room.registry);
    const view = await (await sync(meetingId)).json();
    expect(view.status).toBe("FINALIZED");
    expect(view.receiptDigest).toBe(room.digestHex);
    const row = await statusOf(meetingId);
    expect(row.inviteSecretHash).toBeNull();
    expect(row.endedAt?.getTime()).toBe(room.registry.endedAt.toNumber() * 1000);
  });

  it("expires a LIVE meeting past 60 minutes", async () => {
    const meetingId = await newMeeting(db, hostCookie, "LIVE");
    await db
      .update(meetings)
      .set({ startedAt: new Date(Date.now() - 61 * 60_000) })
      .where(eq(meetings.id, meetingId));
    expect((await (await sync(meetingId)).json()).status).toBe("EXPIRED");
  });
});

describe("lifecycle routes", () => {
  it("start: host only, from WAITING_ROOM, sets startedAt", async () => {
    const meetingId = await newMeeting(db, hostCookie, "SETUP_PENDING");
    const s = sig();
    expect((await start(req("POST", "/x", { cookie: hostCookie, body: { signature: s } }), ctx({ meetingId }))).status).toBe(409);

    await db.update(meetings).set({ lifecycleStatus: "WAITING_ROOM" }).where(eq(meetings.id, meetingId));
    const guest = await admitGuest(meetingId, hostCookie);
    expect((await start(req("POST", "/x", { cookie: guest.cookie, body: { signature: s } }), ctx({ meetingId }))).status).toBe(403);
    expect((await start(req("POST", "/x", { cookie: hostCookie, body: { signature: "nope" } }), ctx({ meetingId }))).status).toBe(400);

    // PER does not return the tx: host report accepted (documented trust assumption).
    const res = await start(req("POST", "/x", { cookie: hostCookie, body: { signature: s } }), ctx({ meetingId }));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.status).toBe("LIVE");
    expect(Date.now() - new Date(view.startedAt).getTime()).toBeLessThan(5000);
  });

  it("start: refuses a PER transaction that failed or did not start this room", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const k = keysFor(meetingId);
    const good = {
      failed: false,
      signers: [host.address],
      accountKeys: [host.address, k.session.toBase58(), PROGRAM_ID.toBase58()],
      logs: ["Program log: Instruction: StartMeeting"],
    };
    const cases = [
      { ...good, failed: true },
      { ...good, signers: [Keypair.generate().publicKey.toBase58()] },
      { ...good, accountKeys: [host.address, PROGRAM_ID.toBase58()] },
      { ...good, logs: ["Program log: Instruction: CastVote"] },
    ];
    for (const tx of cases) {
      const s = sig();
      fake.perTxs.set(s, tx);
      const res = await start(req("POST", "/x", { cookie: hostCookie, body: { signature: s } }), ctx({ meetingId }));
      expect(res.status).toBe(409);
    }
    expect((await statusOf(meetingId)).lifecycleStatus).toBe("WAITING_ROOM");

    const s = sig();
    fake.perTxs.set(s, good);
    const res = await start(req("POST", "/x", { cookie: hostCookie, body: { signature: s } }), ctx({ meetingId }));
    expect((await res.json()).status).toBe("LIVE");
  });

  it("end: host only, LIVE -> ENDED, idempotent; never FINALIZED", async () => {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const guest = await admitGuest(meetingId, hostCookie);
    expect((await end(req("POST", "/x", { cookie: hostCookie }), ctx({ meetingId }))).status).toBe(409);
    await db.update(meetings).set({ lifecycleStatus: "LIVE", startedAt: new Date() }).where(eq(meetings.id, meetingId));
    expect((await end(req("POST", "/x", { cookie: guest.cookie }), ctx({ meetingId }))).status).toBe(403);
    const res = await end(req("POST", "/x", { cookie: hostCookie }), ctx({ meetingId }));
    expect((await res.json()).status).toBe("ENDED");
    const again = await end(req("POST", "/x", { cookie: hostCookie }), ctx({ meetingId }));
    expect((await again.json()).status).toBe("ENDED");
    expect((await statusOf(meetingId)).inviteCodeHash).toBeNull();
  });

  it("cancel: only before start", async () => {
    for (const status of ["DRAFT", "SETUP_PENDING", "WAITING_ROOM"]) {
      const meetingId = await newMeeting(db, hostCookie, status);
      const res = await cancel(req("POST", "/x", { cookie: hostCookie }), ctx({ meetingId }));
      expect((await res.json()).status).toBe("CANCELLED");
    }
    for (const status of ["LIVE", "ENDED", "FINALIZED", "EXPIRED"]) {
      const meetingId = await newMeeting(db, hostCookie, status);
      expect((await cancel(req("POST", "/x", { cookie: hostCookie }), ctx({ meetingId }))).status).toBe(409);
    }
    const meetingId = await newMeeting(db, hostCookie);
    const other = await signIn(new TestWallet());
    expect((await cancel(req("POST", "/x", { cookie: other }), ctx({ meetingId }))).status).toBe(403);
  });

  it("a cancelled meeting is not revived by chain-sync", async () => {
    const meetingId = await newMeeting(db, hostCookie, "CANCELLED");
    await fake.put(keysFor(meetingId).registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId));
    expect((await (await sync(meetingId)).json()).status).toBe("CANCELLED");
  });
});

describe("public receipts", () => {
  const getR = (address: string) => getReceipt(req("GET", `/api/v1/receipts/${address}`), ctx({ registryAddress: address }));

  async function setupFinalized() {
    const meetingId = await newMeeting(db, hostCookie, "WAITING_ROOM");
    const guest = await admitGuest(meetingId, hostCookie, "Guest Gabriela");
    const deadline = new Date(Date.now() + 10 * 60_000).toISOString();
    const vote = { question: "Ship v1?", options: ["Yes", "No", "Later"] as [string, string, string] };
    expect(
      (await postRound(req("POST", "/x", { cookie: hostCookie, body: { voteId: 0, ...vote, deadline } }), ctx({ meetingId }))).status
    ).toBe(201);
    const items = [{ text: "Write the launch post" }];
    await receiptDraft(req("POST", "/x", { cookie: hostCookie, body: { actionItems: items } }), ctx({ meetingId }));
    const room = await finalizedRoom(
      host.kp.publicKey,
      meetingId,
      [{ ...vote, counts: [2, 1, 0], outcome: 0 }],
      await actionItemsHash(items)
    );
    return { meetingId, guest, room, vote };
  }

  it("returns NOT_YET_COMMITTED until the receipt is finalized on chain", async () => {
    const { meetingId, room } = await setupFinalized();
    const address = room.keys.registry.toBase58();
    // Not on chain at all.
    expect((await getR(address)).status).toBe(404);
    // Registry exists but not finalized, even though the DB claims FINALIZED with a digest.
    await fake.put(room.keys.registry, "RoomRegistry", registryValue(host.kp.publicKey, meetingId, { vrfFulfilled: true }));
    await db
      .update(meetings)
      .set({ lifecycleStatus: "FINALIZED", receiptDigest: room.digestHex, roomRegistryAddress: address })
      .where(eq(meetings.id, meetingId));
    const res = await getR(address);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_YET_COMMITTED");
    expect((await getR("not-an-address")).status).toBe(404);
  });

  it("returns verified public data only, with no wallets, names or meeting metadata", async () => {
    const { meetingId, guest, room } = await setupFinalized();
    await fake.put(room.keys.registry, "RoomRegistry", room.registry);
    await fake.put(room.keys.results, "RoomResults", room.results);
    // chain-sync records the registry address and finalizes.
    await db.update(meetings).set({ lifecycleStatus: "ENDED" }).where(eq(meetings.id, meetingId));
    expect((await (await sync(meetingId)).json()).status).toBe("FINALIZED");

    const res = await getR(room.keys.registry.toBase58());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      cluster: "devnet",
      registryAddress: room.keys.registry.toBase58(),
      receiptDigest: room.digestHex,
      votesVerified: true,
      actionItems: [{ text: "Write the launch post" }],
    });
    expect(body.votes).toHaveLength(1);
    expect(body.votes[0]).toMatchObject({
      question: "Ship v1?",
      options: ["Yes", "No", "Later"],
      labelsVerified: true,
      counts: [2, 1, 0],
      outcome: "OPTION_0",
      submittedCount: 3,
      eligibleCount: 4,
    });

    const json = JSON.stringify(body);
    for (const secret of [host.address, guest.wallet.address, "Guest Gabriela", "Secret roadmap sync", "Confidential agenda", meetingId]) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toMatch(/invite|walletAddress|displayName|creator/i);
  });

  it("drops labels and action items that do not match on-chain hashes", async () => {
    const { meetingId, room } = await setupFinalized();
    await fake.put(room.keys.registry, "RoomRegistry", room.registry);
    await fake.put(room.keys.results, "RoomResults", room.results);
    await db.update(meetings).set({ roomRegistryAddress: room.keys.registry.toBase58() }).where(eq(meetings.id, meetingId));
    await db.update(voteRounds).set({ question: "Tampered?" }).where(eq(voteRounds.meetingId, meetingId));
    await db
      .update(receiptDrafts)
      .set({ actionItemsJson: [{ text: "Tampered item" }] })
      .where(eq(receiptDrafts.meetingId, meetingId));
    const body = await (await getR(room.keys.registry.toBase58())).json();
    expect(body.votes[0]).toMatchObject({ question: null, options: null, labelsVerified: false, counts: [2, 1, 0] });
    expect(body.actionItems).toBeNull();
  });

  it("after RoomResults is closed, serves cached summaries only if they verify against the chain digest", async () => {
    const { meetingId, room } = await setupFinalized();
    const address = room.keys.registry.toBase58();
    await fake.put(room.keys.registry, "RoomRegistry", room.registry);
    await fake.put(room.keys.results, "RoomResults", room.results);
    await db.update(meetings).set({ roomRegistryAddress: address }).where(eq(meetings.id, meetingId));
    await getR(address); // caches verified summaries

    fake.accounts.delete(room.keys.results.toBase58());
    let body = await (await getR(address)).json();
    expect(body.votesVerified).toBe(true);
    expect(body.votes[0].counts).toEqual([2, 1, 0]);

    // A tampered cache (forged tally) is not reported.
    const [draft] = await db.select().from(receiptDrafts).where(eq(receiptDrafts.meetingId, meetingId));
    const payload = draft.publicPayloadJson as { summaries: { counts: number[] }[] };
    payload.summaries[0].counts = [0, 3, 0];
    await db.update(receiptDrafts).set({ publicPayloadJson: payload }).where(eq(receiptDrafts.id, draft.id));
    body = await (await getR(address)).json();
    expect(body.votesVerified).toBe(false);
    expect(body.votes).toBeNull();
  });

  it("is public and works without any DB meeting row", async () => {
    const creator = Keypair.generate().publicKey;
    const meetingId = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const room = await finalizedRoom(creator, meetingId, [{ question: "Q", options: ["a", "b", "c"], counts: [0, 0, 1], outcome: 2 }], await actionItemsHash([]));
    await fake.put(room.keys.registry, "RoomRegistry", room.registry);
    await fake.put(room.keys.results, "RoomResults", room.results);
    const body = await (await getR(room.keys.registry.toBase58())).json();
    expect(body.votesVerified).toBe(true);
    expect(body.votes[0]).toMatchObject({ question: null, outcome: "OPTION_2" });
    expect(JSON.stringify(body)).not.toContain(new PublicKey(creator).toBase58());
  });
});
