/**
 * Instruction-level tests for programs/concord on LiteSVM (spec 17.2).
 *
 * Base-layer instructions run end to end. PER-side instructions (vote lifecycle)
 * run against session/results/slot accounts placed directly in their post-
 * delegation state; delegation, VRF and commit CPIs need MagicBlock's live
 * programs and are covered by tests/devnet.
 *
 * Run: pnpm test:program:svm   (after `pnpm anchor-build`)
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Clock, FailedTransactionMetadata, LiteSVM } from "litesvm";

const root = process.cwd();
const idl = JSON.parse(readFileSync(path.join(root, "target/idl/concord.json"), "utf8"));
const PROGRAM_ID = new PublicKey(idl.address);
const SO = path.join(root, "target/deploy/concord.so");
const coder = new anchor.Program(idl, { connection: null } as unknown as anchor.Provider);

const SLOT_MAGIC = Buffer.from("CNCSLOT1");
const NO_VOTE = 255;
const NO_OPTION = 255;
const T0 = 1_800_000_000n;

const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const h = (s: string) => Array.from(createHash("sha256").update(s).digest());

class World {
  svm = new LiteSVM();
  host = Keypair.generate();
  nonce = Uint8Array.from(Array.from({ length: 16 }, (_, i) => i + 1));
  registry = pda([Buffer.from("concord_room"), this.host.publicKey.toBuffer(), Buffer.from(this.nonce)]);
  session = pda([Buffer.from("concord_session"), this.registry.toBuffer()]);
  results = pda([Buffer.from("concord_results"), this.registry.toBuffer()]);
  bumps = {
    session: PublicKey.findProgramAddressSync([Buffer.from("concord_session"), this.registry.toBuffer()], PROGRAM_ID)[1],
    results: PublicKey.findProgramAddressSync([Buffer.from("concord_results"), this.registry.toBuffer()], PROGRAM_ID)[1],
  };

  constructor() {
    this.svm.addProgramFromFile(PROGRAM_ID, SO);
    this.svm.airdrop(this.host.publicKey, 10_000_000_000n);
    this.setTime(T0);
  }

  setTime(unix: bigint) {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, unix));
  }

  send(ix: TransactionInstruction, signers: Keypair[]) {
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = this.svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.sign(...signers);
    const res = this.svm.sendTransaction(tx);
    this.svm.expireBlockhash();
    return res;
  }

  ok(ix: TransactionInstruction, signers: Keypair[]) {
    const res = this.send(ix, signers);
    if (res instanceof FailedTransactionMetadata) {
      assert.fail(`expected success, got ${res.err()} ${res.meta().logs().join("\n")}`);
    }
  }

  fails(ix: TransactionInstruction, signers: Keypair[], errorName: string) {
    const res = this.send(ix, signers);
    assert.ok(res instanceof FailedTransactionMetadata, `expected ${errorName} but transaction succeeded`);
    const logs = res.meta().logs().join("\n");
    assert.match(logs, new RegExp(`Error Code: ${errorName}\\b|${errorName}`), logs);
  }

  account<T = any>(name: string, key: PublicKey): T {
    const acc = this.svm.getAccount(key);
    assert.ok(acc, `missing account ${key.toBase58()}`);
    return coder.coder.accounts.decode(name, Buffer.from(acc.data)) as T;
  }

  async putAccount(name: string, key: PublicKey, value: object, space: number) {
    const encoded = Buffer.alloc(space);
    const bytes: Buffer = await coder.coder.accounts.encode(name, value);
    assert.ok(bytes.length <= space, `${name} encodes to ${bytes.length} > ${space}`);
    bytes.copy(encoded);
    this.svm.setAccount(key, {
      lamports: 1_000_000_000,
      data: encoded,
      owner: PROGRAM_ID,
      executable: false,
    });
  }

  slotKey(voter: PublicKey) {
    return pda([Buffer.from("concord_slot"), this.session.toBuffer(), voter.toBuffer()]);
  }

  putSlot(voter: PublicKey, lastVoteId = NO_VOTE, option = NO_OPTION, owner = PROGRAM_ID) {
    const data = Buffer.alloc(50);
    SLOT_MAGIC.copy(data, 0);
    voter.toBuffer().copy(data, 8);
    data[40] = lastVoteId;
    data[41] = option;
    this.svm.setAccount(this.slotKey(voter), { lamports: 1_000_000, data, owner, executable: false });
  }

  slot(voter: PublicKey) {
    const d = Buffer.from(this.svm.getAccount(this.slotKey(voter))!.data);
    return { lastVoteId: d[40], option: d[41] };
  }

  /** Session as it exists on PER right after init + delegation. */
  async putSession(over: Partial<Record<string, unknown>> = {}) {
    await this.putAccount(
      "roomSession",
      this.session,
      {
        registry: this.registry,
        host: this.host.publicKey,
        startedAt: new anchor.BN(0),
        endedAt: new anchor.BN(0),
        nextVoteId: 0,
        openSlots: 0,
        vote: noVote(),
        bump: this.bumps.session,
        ...over,
      },
      1200
    );
  }

  async putResults(summaries: unknown[] = []) {
    await this.putAccount("roomResults", this.results, { registry: this.registry, summaries, bump: this.bumps.results }, 2200);
  }

  m() {
    return coder.methods;
  }
}

function noVote() {
  return {
    voteId: NO_VOTE,
    status: 0,
    questionHash: new Array(32).fill(0),
    optionHashes: [new Array(32).fill(0), new Array(32).fill(0), new Array(32).fill(0)],
    openedAt: new anchor.BN(0),
    deadline: new anchor.BN(0),
    closedAt: new anchor.BN(0),
    eligible: [],
    eligibilityHash: new Array(32).fill(0),
  };
}

const OPTS = [h("Fund the garden"), h("Fund the library"), h("Abstain")];
const Q = h("Which project should we fund?");
const sorted = (keys: PublicKey[]) => [...keys].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));

async function openVote(w: World, voters: PublicKey[], deadline = T0 + 600n, signer = w.host) {
  const eligible = sorted(voters);
  return w
    .m()
    .openVote(Q, OPTS, new anchor.BN(deadline.toString()))
    .accountsPartial({ host: signer.publicKey, session: w.session })
    .remainingAccounts(eligible.map((v) => ({ pubkey: w.slotKey(v), isSigner: false, isWritable: false })))
    .instruction();
}

const castIx = (w: World, voter: PublicKey, option: number, slot = w.slotKey(voter)) =>
  w.m().castVote(option).accountsPartial({ voter, session: w.session, slot }).instruction();

const finalizeIx = (w: World, signer: PublicKey, slots: PublicKey[]) =>
  w
    .m()
    .finalizeVote()
    .accountsPartial({ signer, session: w.session, results: w.results })
    .remainingAccounts(slots.map((s) => ({ pubkey: s, isSigner: false, isWritable: true })))
    .instruction();

/** A started meeting with voter slots for `n` voters. */
async function liveMeeting(n = 3) {
  const w = new World();
  const voters = Array.from({ length: n }, () => Keypair.generate());
  for (const v of voters) {
    w.svm.airdrop(v.publicKey, 1_000_000_000n);
    w.putSlot(v.publicKey);
  }
  await w.putSession({ startedAt: new anchor.BN(T0.toString()), openSlots: n });
  await w.putResults();
  return { w, voters };
}

// ============================================================================

describe("room setup (base layer)", () => {
  it("one host can create several rooms (nonce-seeded registry)", async () => {
    const w = new World();
    w.ok(await w.m().initializeRoom(Array.from(w.nonce)).accountsPartial({ creator: w.host.publicKey }).instruction(), [w.host]);
    const other = Array.from({ length: 16 }, () => 9);
    w.ok(await w.m().initializeRoom(other).accountsPartial({ creator: w.host.publicKey }).instruction(), [w.host]);
    const reg = w.account("roomRegistry", w.registry);
    assert.equal(reg.creator.toBase58(), w.host.publicKey.toBase58());
    assert.equal(reg.vrfFulfilled, false);
  });

  it("room state cannot be created before VRF is fulfilled, and only by the creator", async () => {
    const w = new World();
    w.ok(await w.m().initializeRoom(Array.from(w.nonce)).accountsPartial({ creator: w.host.publicKey }).instruction(), [w.host]);
    const init = (who: Keypair) =>
      w.m().initRoomState(new anchor.BN(1_000_000)).accountsPartial({ host: who.publicKey, registry: w.registry }).instruction();
    w.fails(await init(w.host), [w.host], "RandomnessPending");

    const reg = w.account("roomRegistry", w.registry);
    await w.putAccount("roomRegistry", w.registry, { ...reg, vrfFulfilled: true, vrfOutput: h("vrf") }, w.svm.getAccount(w.registry)!.data.length);
    const mallory = Keypair.generate();
    w.svm.airdrop(mallory.publicKey, 1_000_000_000n);
    w.fails(await init(mallory), [mallory], "Unauthorized");
    w.ok(await init(w.host), [w.host]);
    const s = w.account("roomSession", w.session);
    assert.equal(s.host.toBase58(), w.host.publicKey.toBase58());
    assert.equal(s.vote.status, 0);
  });

  it("forged VRF callback (no VRF identity signature) is rejected", async () => {
    const w = new World();
    w.ok(await w.m().initializeRoom(Array.from(w.nonce)).accountsPartial({ creator: w.host.publicKey }).instruction(), [w.host]);
    const ix = await w
      .m()
      .storeRoomRandomness(h("attacker"))
      .accountsPartial({ registry: w.registry, vrfProgramIdentity: w.host.publicKey })
      .instruction();
    const res = w.send(ix, [w.host]);
    assert.ok(res instanceof FailedTransactionMetadata, "forged callback must fail");
    assert.equal(w.account("roomRegistry", w.registry).vrfFulfilled, false);
  });
});

describe("meeting lifecycle (PER)", () => {
  it("only the host starts the meeting, once", async () => {
    const w = new World();
    await w.putSession();
    const start = (k: Keypair) => w.m().startMeeting().accountsPartial({ host: k.publicKey, session: w.session }).instruction();
    const mallory = Keypair.generate();
    w.svm.airdrop(mallory.publicKey, 1_000_000_000n);
    w.fails(await start(mallory), [mallory], "Unauthorized");
    w.ok(await start(w.host), [w.host]);
    assert.equal(w.account("roomSession", w.session).startedAt.toString(), T0.toString());
    w.fails(await start(w.host), [w.host], "AlreadyStarted");
  });

  it("ending: host any time; others only after 60 minutes; not with an active vote", async () => {
    const { w, voters } = await liveMeeting(2);
    const end = (k: Keypair) => w.m().endMeeting().accountsPartial({ signer: k.publicKey, session: w.session }).instruction();
    w.fails(await end(voters[0]), [voters[0]], "Unauthorized");
    w.ok(await openVote(w, voters.map((v) => v.publicKey)), [w.host]);
    w.fails(await end(w.host), [w.host], "VoteAlreadyActive");
    w.setTime(T0 + 3600n);
    // Expired: anyone can finalize the timed-out vote, then end the meeting.
    w.ok(await finalizeIx(w, voters[0].publicKey, sorted(voters.map((v) => v.publicKey)).map((v) => w.slotKey(v))), [voters[0]]);
    w.ok(await end(voters[0]), [voters[0]]);
    assert.equal(w.account("roomSession", w.session).endedAt.toString(), (T0 + 3600n).toString());
  });
});

describe("open_vote", () => {
  it("validates host, meeting window, labels, deadline and eligibility", async () => {
    const { w, voters } = await liveMeeting(3);
    const keys = voters.map((v) => v.publicKey);
    w.fails(await openVote(w, keys, T0 + 600n, voters[0]), [voters[0]], "Unauthorized");
    w.fails(await openVote(w, keys, T0 + 3601n), [w.host], "InvalidDeadline");
    w.fails(await openVote(w, keys, T0), [w.host], "InvalidDeadline");
    w.fails(await openVote(w, []), [w.host], "NoEligibleVoters");
    w.fails(await openVote(w, [keys[0], keys[0]]), [w.host], "DuplicateEligibleVoter");

    const dupOptions = await w
      .m()
      .openVote(Q, [OPTS[0], OPTS[0], OPTS[2]], new anchor.BN((T0 + 600n).toString()))
      .accountsPartial({ host: w.host.publicKey, session: w.session })
      .remainingAccounts(sorted(keys).map((v) => ({ pubkey: w.slotKey(v), isSigner: false, isWritable: false })))
      .instruction();
    w.fails(dupOptions, [w.host], "DuplicateOption");

    const stranger = Keypair.generate().publicKey; // no slot created
    w.fails(await openVote(w, [...keys, stranger]), [w.host], "BadSlot");

    w.ok(await openVote(w, keys), [w.host]);
    const s = w.account("roomSession", w.session);
    assert.equal(s.vote.status, 1);
    assert.deepEqual(s.vote.eligible.map((k: PublicKey) => k.toBase58()), sorted(keys).map((k) => k.toBase58()));
    assert.equal(s.nextVoteId, 1);
    w.fails(await openVote(w, keys), [w.host], "VoteAlreadyActive");
  });

  it("is rejected before start and after the meeting expires", async () => {
    const w = new World();
    const v = Keypair.generate().publicKey;
    w.putSlot(v);
    await w.putSession();
    await w.putResults();
    w.fails(await openVote(w, [v]), [w.host], "NotStarted");
    await w.putSession({ startedAt: new anchor.BN(T0.toString()) });
    w.setTime(T0 + 3600n);
    w.fails(await openVote(w, [v], T0 + 3600n), [w.host], "MeetingNotActive");
  });
});

describe("cast_vote", () => {
  it("eligible voter votes once; duplicate, ineligible, bad option and late votes are rejected", async () => {
    const { w, voters } = await liveMeeting(3);
    const [a, b, observer] = voters;
    w.ok(await openVote(w, [a.publicKey, b.publicKey]), [w.host]);

    w.ok(await castIx(w, a.publicKey, 1), [a]);
    assert.deepEqual(w.slot(a.publicKey), { lastVoteId: 0, option: 1 });
    w.fails(await castIx(w, a.publicKey, 2), [a], "AlreadyVoted");
    w.fails(await castIx(w, observer.publicKey, 0), [observer], "NotEligible");
    w.fails(await castIx(w, b.publicKey, 3), [b], "InvalidOption");
    // B cannot write into A's slot.
    w.fails(await castIx(w, b.publicKey, 0, w.slotKey(a.publicKey)), [b], "SlotSetMismatch");

    w.setTime(T0 + 601n);
    w.fails(await castIx(w, b.publicKey, 0), [b], "VoteDeadlinePassed");
  });

  it("the voter only signs: another wallet can pay the fee", async () => {
    const { w, voters } = await liveMeeting(1);
    const [a] = voters;
    w.ok(await openVote(w, [a.publicKey]), [w.host]);
    const payer = Keypair.generate();
    w.svm.airdrop(payer.publicKey, 1_000_000_000n);
    w.ok(await castIx(w, a.publicKey, 2), [payer, a]);
    assert.equal(w.slot(a.publicKey).option, 2);
  });
});

describe("close and finalize", () => {
  it("host closes early; others only after the deadline", async () => {
    const { w, voters } = await liveMeeting(2);
    w.ok(await openVote(w, voters.map((v) => v.publicKey)), [w.host]);
    const close = (k: Keypair) => w.m().closeVote().accountsPartial({ signer: k.publicKey, session: w.session }).instruction();
    w.fails(await close(voters[0]), [voters[0]], "VoteNotClosable");
    w.ok(await close(w.host), [w.host]);
    assert.equal(w.account("roomSession", w.session).vote.status, 2);
  });

  it("tallies correctly, writes aggregates only, resets ballots, and allows the next vote", async () => {
    const { w, voters } = await liveMeeting(5);
    const keys = voters.map((v) => v.publicKey);
    w.ok(await openVote(w, keys), [w.host]);
    const choices = [0, 2, 2, 1]; // fifth voter abstains from submitting
    for (let i = 0; i < 4; i++) w.ok(await castIx(w, voters[i].publicKey, choices[i]), [voters[i]]);

    const slots = sorted(keys).map((k) => w.slotKey(k));
    w.fails(await finalizeIx(w, voters[0].publicKey, slots), [voters[0]], "VoteNotClosable");
    w.setTime(T0 + 601n);
    w.ok(await finalizeIx(w, voters[0].publicKey, slots), [voters[0]]); // permissionless after deadline

    const r = w.account("roomResults", w.results);
    assert.equal(r.summaries.length, 1);
    const s0 = r.summaries[0];
    assert.deepEqual(s0.counts, [1, 1, 2]);
    assert.equal(s0.submittedCount, 4);
    assert.equal(s0.eligibleCount, 5);
    assert.equal(s0.outcome, 2);
    assert.equal(s0.closedAt.toString(), (T0 + 600n).toString());
    // Results hold no wallet data at all.
    const raw = Buffer.from(w.svm.getAccount(w.results)!.data);
    for (const k of keys) assert.equal(raw.indexOf(k.toBuffer()), -1, "voter key leaked into results");
    for (const k of keys) assert.equal(w.slot(k).option, NO_OPTION, "ballot not reset");

    const s = w.account("roomSession", w.session);
    assert.equal(s.vote.status, 0);
    assert.equal(s.vote.eligible.length, 0, "roster must be cleared after finalize");

    // Next round: same slots, fresh vote id; previous round's votes do not count.
    w.ok(await openVote(w, keys, T0 + 1200n), [w.host]);
    w.ok(await castIx(w, voters[0].publicKey, 1), [voters[0]]);
    w.ok(await w.m().closeVote().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    w.ok(await finalizeIx(w, w.host.publicKey, slots), [w.host]);
    const r2 = w.account("roomResults", w.results);
    assert.deepEqual(r2.summaries[1].counts, [0, 1, 0]);
    assert.equal(r2.summaries[1].voteId, 1);
  });

  it("rejects omitted, reordered, duplicated or substituted slot sets", async () => {
    const { w, voters } = await liveMeeting(3);
    const keys = sorted(voters.map((v) => v.publicKey));
    w.ok(await openVote(w, keys), [w.host]);
    w.ok(await w.m().closeVote().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    const slots = keys.map((k) => w.slotKey(k));
    w.fails(await finalizeIx(w, w.host.publicKey, slots.slice(0, 2)), [w.host], "SlotSetMismatch");
    w.fails(await finalizeIx(w, w.host.publicKey, [slots[1], slots[0], slots[2]]), [w.host], "SlotSetMismatch");
    w.fails(await finalizeIx(w, w.host.publicKey, [slots[0], slots[0], slots[2]]), [w.host], "SlotSetMismatch");
    // Fabricated slot: right address but owned by another program.
    w.putSlot(keys[2], 0, 0, SystemProgram.programId);
    w.fails(await finalizeIx(w, w.host.publicKey, slots), [w.host], "BadSlot");
  });

  it("ties and zero-ballot rounds are handled", async () => {
    const { w, voters } = await liveMeeting(2);
    const keys = voters.map((v) => v.publicKey);
    w.ok(await openVote(w, keys), [w.host]);
    w.ok(await castIx(w, voters[0].publicKey, 0), [voters[0]]);
    w.ok(await castIx(w, voters[1].publicKey, 1), [voters[1]]);
    w.ok(await w.m().closeVote().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    const slots = sorted(keys).map((k) => w.slotKey(k));
    w.ok(await finalizeIx(w, w.host.publicKey, slots), [w.host]);
    assert.equal(w.account("roomResults", w.results).summaries[0].outcome, 3); // TIE

    w.ok(await openVote(w, keys, T0 + 1200n), [w.host]);
    w.ok(await w.m().closeVote().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    w.ok(await finalizeIx(w, w.host.publicKey, slots), [w.host]);
    const z = w.account("roomResults", w.results).summaries[1];
    assert.equal(z.outcome, 4); // NO_DECISION
    assert.equal(z.submittedCount, 0);
  });

  it("20 eligible voters fit in one finalize transaction", async () => {
    const { w, voters } = await liveMeeting(20);
    const keys = voters.map((v) => v.publicKey);
    w.ok(await openVote(w, keys), [w.host]);
    for (const v of voters) w.ok(await castIx(w, v.publicKey, 0), [v]);
    w.ok(await w.m().closeVote().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    w.ok(await finalizeIx(w, w.host.publicKey, sorted(keys).map((k) => w.slotKey(k))), [w.host]);
    assert.deepEqual(w.account("roomResults", w.results).summaries[0].counts, [20, 0, 0]);
  });
});

describe("receipt (base layer, after undelegation)", () => {
  async function endedMeetingWithOneVote() {
    const { w, voters } = await liveMeeting(2);
    const keys = voters.map((v) => v.publicKey);
    w.ok(await openVote(w, keys), [w.host]);
    w.ok(await castIx(w, voters[0].publicKey, 1), [voters[0]]);
    w.ok(await w.m().closeVote().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    w.ok(await finalizeIx(w, w.host.publicKey, sorted(keys).map((k) => w.slotKey(k))), [w.host]);
    w.setTime(T0 + 900n);
    w.ok(await w.m().endMeeting().accountsPartial({ signer: w.host.publicKey, session: w.session }).instruction(), [w.host]);
    w.ok(await w.m().initializeRoom(Array.from(w.nonce)).accountsPartial({ creator: w.host.publicKey }).instruction(), [w.host]);
    const reg = w.account("roomRegistry", w.registry);
    await w.putAccount("roomRegistry", w.registry, { ...reg, vrfFulfilled: true, vrfOutput: h("vrf-output") }, w.svm.getAccount(w.registry)!.data.length);
    return { w };
  }
  const receiptIx = (w: World, signer: Keypair, items = h("items")) =>
    w.m().finalizeReceipt(items).accountsPartial({ host: signer.publicKey, registry: w.registry, session: w.session, results: w.results }).instruction();

  it("computes the digest on-chain from program state, write-once, host only", async () => {
    const { w } = await endedMeetingWithOneVote();
    const mallory = Keypair.generate();
    w.svm.airdrop(mallory.publicKey, 1_000_000_000n);
    w.fails(await receiptIx(w, mallory), [mallory], "Unauthorized");
    w.ok(await receiptIx(w, w.host), [w.host]);
    const reg = w.account("roomRegistry", w.registry);
    assert.equal(reg.receiptFinalized, true);
    assert.equal(reg.voteCount, 1);
    assert.equal(reg.startedAt.toString(), T0.toString());
    assert.equal(reg.endedAt.toString(), (T0 + 900n).toString());

    // Recompute with the browser verifier: it must match byte for byte.
    const rh = await import("../../packages/receipt-hash/src/index.ts");
    const s = w.account("roomResults", w.results).summaries[0];
    const sd = await rh.voteSummaryDigest({
      roomId: w.registry.toBytes(),
      voteId: s.voteId,
      questionHash: Uint8Array.from(s.questionHash),
      optionHashes: s.optionHashes.map((o: number[]) => Uint8Array.from(o)) as [Uint8Array, Uint8Array, Uint8Array],
      counts: s.counts,
      eligibleCount: s.eligibleCount,
      submittedCount: s.submittedCount,
      outcome: s.outcome,
      closeTimestamp: BigInt(s.closedAt.toString()),
      eligibilitySnapshotHash: Uint8Array.from(s.eligibilityHash),
    });
    assert.deepEqual(Array.from(sd), s.summaryDigest);
    const rd = await rh.receiptDigest({
      roomId: w.registry.toBytes(),
      vrfResultDigest: Uint8Array.from(h("vrf-output")),
      startedAt: T0,
      endedAt: T0 + 900n,
      orderedSummaryDigests: [sd],
      actionItemsHash: Uint8Array.from(h("items")),
    });
    assert.deepEqual(Array.from(rd), reg.receiptDigest);

    w.fails(await receiptIx(w, w.host), [w.host], "ReceiptAlreadyFinalized");
  });

  it("rejects a tampered summary", async () => {
    const { w } = await endedMeetingWithOneVote();
    const r = w.account("roomResults", w.results);
    r.summaries[0].counts = [0, 5, 0];
    await w.putResults(r.summaries);
    w.fails(await receiptIx(w, w.host), [w.host], "SlotSetMismatch");
  });

  it("requires the meeting to have ended", async () => {
    const { w } = await liveMeeting(1);
    w.ok(await w.m().initializeRoom(Array.from(w.nonce)).accountsPartial({ creator: w.host.publicKey }).instruction(), [w.host]);
    w.fails(await receiptIx(w, w.host), [w.host], "MeetingNotEnded");
  });
});
