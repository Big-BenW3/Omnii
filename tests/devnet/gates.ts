/**
 * Devnet gate suite (spec 9.6 Gates A-F) + cost report, against the deployed
 * concord program and the MagicBlock TEE PER. Uses @concord/client, the same
 * builders the web app uses.
 *
 * Wallets: only the host is funded. 20 fresh voter wallets stay at 0 SOL for the
 * entire run (asserted). Every account is closed at the end; rent returns to the host.
 *
 * Run: pnpm test:devnet          (HOST_KEYPAIR defaults to ~/.config/solana/id.json)
 * Output: tests/devnet/out/gates-report.json
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  IDL,
  KIND_RESULTS,
  KIND_SESSION,
  PROGRAM_ID,
  VOTE_NONE,
  chunk,
  decode,
  fetchDecoded,
  ix,
  roomKeys,
  slotPda,
  sortKeys,
} from "../../packages/concord-client/src/index.ts";
import { receiptDigest, voteSummaryDigest } from "../../packages/receipt-hash/src/index.ts";
import { DELEGATION_PROGRAM, anonTee, base, expectFail, loadHost, send, sleep, teeFor, waitFor } from "./lib.ts";

const N_VOTERS = Number(process.env.N_VOTERS ?? 20);
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), program: PROGRAM_ID.toBase58(), voters: N_VOTERS };
const results: { step: string; ok: boolean; detail?: unknown; ms: number }[] = [];
let failures = 0;

async function step<T>(name: string, fn: () => Promise<T>, critical = true): Promise<T | undefined> {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, detail: detail instanceof Connection ? undefined : detail, ms: Date.now() - t });
    console.log(`ok   ${name}`);
    return detail;
  } catch (e) {
    failures++;
    const msg = (e as Error).message.slice(0, 500);
    results.push({ step: name, ok: false, detail: msg, ms: Date.now() - t });
    console.log(`FAIL ${name}: ${msg}`);
    if (critical) throw e;
    return undefined;
  }
}

const sha = (s: string) => Uint8Array.from(createHash("sha256").update(s).digest());

async function main() {
  const host = loadHost();
  const meetingId = randomUUID();
  const k = roomKeys(host.publicKey, meetingId);
  const voters = Array.from({ length: N_VOTERS }, () => Keypair.generate());
  const observer = voters[N_VOTERS - 1]; // has a slot (admitted) but is not eligible
  const eligible = sortKeys(voters.slice(0, N_VOTERS - 1).map((v) => v.publicKey));
  const balance0 = await base.getBalance(host.publicKey);
  Object.assign(report, { meetingId, registry: k.registry.toBase58(), hostStartLamports: balance0 });

  // ---------------------------------------------------------------- Gate B: VRF
  await step("B.initialize_room+request_randomness (base, host pays)", () =>
    (async () => send(base, [await ix.initializeRoom(k), await ix.requestRandomness(k)], host))()
  );
  await step("B.forged_callback_rejected", async () =>
    expectFail("vrf_program_identity", async () => {
      // A host-signed store_room_randomness without the VRF program identity must fail.
      const p = new anchor.Program(IDL, { connection: base } as unknown as anchor.Provider);
      const bad = await p.methods
        .storeRoomRandomness(Array.from(sha("attacker")))
        .accountsPartial({ vrfProgramIdentity: host.publicKey, registry: k.registry })
        .instruction();
      await send(base, [bad], host);
    })
  );
  const reg = await step("B.vrf_fulfilled_by_oracle", () =>
    waitFor("VRF callback", async () => {
      const r = await fetchDecoded(base, k.registry, decode.registry);
      return r?.vrfFulfilled ? r : null;
    }, 180_000)
  );
  report.vrfOutput = Buffer.from(reg!.vrfOutput).toString("hex");
  await step("B.duplicate_request_rejected", () =>
    expectFail("RandomnessAlreadyFulfilled", async () => send(base, [await ix.requestRandomness(k)], host))
  );

  // ---------------------------------------------------------------- Gate A: setup + delegation
  await step("A.init_room_state (host funds slot sponsor)", async () =>
    send(base, [await ix.initRoomState(k)], host)
  );
  await step("A.delegate_session", async () => send(base, [await ix.delegate(k, KIND_SESSION)], host));
  await step("A.delegate_results", async () => send(base, [await ix.delegate(k, KIND_RESULTS)], host));
  await step("A.base_owner_is_delegation_program", () =>
    waitFor("delegation", async () => {
      const [s, r] = await Promise.all([base.getAccountInfo(k.session), base.getAccountInfo(k.results)]);
      return s?.owner.equals(DELEGATION_PROGRAM) && r?.owner.equals(DELEGATION_PROGRAM);
    })
  );
  report.hostAfterSetupLamports = await base.getBalance(host.publicKey);

  const teeHost = (await step("A.tee_auth_host", () => teeFor(host)))!;
  await step("A.session_visible_on_tee", () =>
    waitFor("session on TEE", async () => {
      const s = await fetchDecoded(teeHost, k.session, decode.session);
      return s && s.host.equals(host.publicKey) ? true : null;
    })
  );

  // ---------------------------------------------------------------- PER: slots + start
  for (const [i, batch] of chunk(voters.map((v) => v.publicKey)).entries()) {
    await step(`A.add_voter_slots[${i}]`, async () => send(teeHost, [await ix.addVoterSlots(k, batch)], host, [], true));
  }
  await step("A.slots_counted", async () => {
    const s = await fetchDecoded(teeHost, k.session, decode.session);
    assert.equal(s?.openSlots, N_VOTERS);
    return s?.openSlots;
  });
  await step("A.start_meeting", async () => send(teeHost, [await ix.startMeeting(k)], host, [], true));

  // ---------------------------------------------------------------- open vote
  const q = sha("Q:Which project should we fund?");
  const opts = [sha("O:garden"), sha("O:library"), sha("O:abstain")];
  const deadline = Math.floor(Date.now() / 1000) + 600;
  await step("A.open_vote (eligible snapshot frozen)", async () =>
    send(teeHost, [await ix.openVote(k, q, opts, deadline, eligible)], host, [], true)
  );

  // ---------------------------------------------------------------- Gate C: ballots with 0-SOL voters
  const tee = new Map<string, Connection>();
  for (const v of voters) tee.set(v.publicKey.toBase58(), (await teeFor(v)) as Connection);
  const choiceFor = (i: number) => (i % 5 === 0 ? 0 : i % 5 < 3 ? 1 : 2) as 0 | 1 | 2;
  const expected = [0, 0, 0];
  const byKey = new Map(voters.map((v) => [v.publicKey.toBase58(), v]));
  const castCount = eligible.length - 2; // two eligible voters do not vote
  for (let i = 0; i < castCount; i++) {
    const v = byKey.get(eligible[i].toBase58())!;
    const c = choiceFor(i);
    expected[c]++;
    await step(`C.cast_vote[${i}] voter pays with 0 SOL`, async () =>
      send(tee.get(v.publicKey.toBase58())!, [await ix.castVote(k, v.publicKey, c)], v, [], true)
    );
  }
  const first = byKey.get(eligible[0].toBase58())!;
  await step("C.duplicate_ballot_rejected", () =>
    expectFail("AlreadyVoted", async () =>
      send(tee.get(first.publicKey.toBase58())!, [await ix.castVote(k, first.publicKey, 2)], first, [], true)
    )
  );
  await step("C.observer_rejected", () =>
    expectFail("NotEligible", async () =>
      send(tee.get(observer.publicKey.toBase58())!, [await ix.castVote(k, observer.publicKey, 0)], observer, [], true)
    )
  );

  const slotA = slotPda(k.session, first.publicKey);
  const second = byKey.get(eligible[1].toBase58())!;
  await step("C.voter_reads_own_slot", async () => {
    const s = await fetchDecoded(tee.get(first.publicKey.toBase58())!, slotA, decode.slot);
    assert.equal(s?.option, choiceFor(0));
    return s?.option;
  });
  const isolation = await step("C.others_cannot_read_ballot", async () => {
    const reads = {
      otherVoter: !!(await tee.get(second.publicKey.toBase58())!.getAccountInfo(slotA)),
      observer: !!(await tee.get(observer.publicKey.toBase58())!.getAccountInfo(slotA)),
      host: !!(await teeHost.getAccountInfo(slotA)),
      anonymous: !!(await anonTee.getAccountInfo(slotA)),
      baseLayer: !!(await base.getAccountInfo(slotA)),
    };
    assert.deepEqual(reads, { otherVoter: false, observer: false, host: false, anonymous: false, baseLayer: false });
    return reads;
  });
  report.readIsolation = isolation;

  // ---------------------------------------------------------------- Gate E: no premature result
  await step("E.no_counts_readable_while_open", async () => {
    const observerSession = await tee.get(observer.publicKey.toBase58())!.getAccountInfo(k.session);
    const anonSession = await anonTee.getAccountInfo(k.session);
    const baseResults = await fetchDecoded(base, k.results, decode.results);
    assert.equal(observerSession, null, "observer must not read the private session");
    assert.equal(anonSession, null, "anonymous must not read the private session");
    assert.equal(baseResults?.summaries.length ?? 0, 0, "no summary may exist on base while open");
    return { observerSession: false, anonSession: false, baseSummaries: baseResults?.summaries.length ?? 0 };
  });
  await step("E.voter_cannot_read_session_counts", async () => {
    assert.equal(await tee.get(first.publicKey.toBase58())!.getAccountInfo(k.session), null);
    return true;
  });

  // ---------------------------------------------------------------- Gate D: tally
  await step("D.close_vote by host", async () => send(teeHost, [await ix.closeVote(k, host.publicKey)], host, [], true));
  await step("D.finalize_rejects_omitted_slot", () =>
    expectFail("SlotSetMismatch", async () =>
      send(teeHost, [await ix.finalizeVote(k, host.publicKey, eligible.slice(1))], host, [], true)
    )
  );
  await step("D.finalize_rejects_reordered_slots", () =>
    expectFail("SlotSetMismatch", async () =>
      send(teeHost, [await ix.finalizeVote(k, host.publicKey, [eligible[1], eligible[0], ...eligible.slice(2)])], host, [], true)
    )
  );
  await step(`D.finalize_vote by a 0-SOL voter (${eligible.length} slots)`, async () =>
    send(tee.get(first.publicKey.toBase58())!, [await ix.finalizeVote(k, first.publicKey, eligible)], first, [], true)
  );
  await step("D.commit_results by a 0-SOL voter", async () =>
    send(tee.get(first.publicKey.toBase58())!, [await ix.commitResults(k, first.publicKey)], first, [], true)
  );
  const summary = await step("D.committed_aggregate_correct_on_base", () =>
    waitFor("results commit", async () => {
      const r = await fetchDecoded(base, k.results, decode.results);
      if (!r || r.summaries.length !== 1) return null;
      const s = r.summaries[0];
      assert.deepEqual(s.counts, expected);
      assert.equal(s.submittedCount, castCount);
      assert.equal(s.eligibleCount, eligible.length);
      return s;
    }, 120_000)
  );
  await step("E.committed_results_contain_no_wallets", async () => {
    const raw = (await base.getAccountInfo(k.results))!.data;
    for (const v of voters) assert.equal(raw.indexOf(v.publicKey.toBuffer()), -1, "wallet found in committed results");
    return true;
  });
  await step("D.ballots_reset_after_tally", async () => {
    const s = await fetchDecoded(tee.get(first.publicKey.toBase58())!, slotA, decode.slot);
    assert.equal(s?.option, 255);
    return true;
  });
  await step("D.session_roster_cleared", async () => {
    const s = await fetchDecoded(teeHost, k.session, decode.session);
    assert.equal(s?.vote.status, VOTE_NONE);
    assert.equal(s?.vote.eligible.length, 0);
    return true;
  });

  // ---------------------------------------------------------------- end + teardown
  await step("A.end_meeting", async () => send(teeHost, [await ix.endMeeting(k, host.publicKey)], host, [], true));
  for (const [i, batch] of chunk(voters.map((v) => v.publicKey)).entries()) {
    await step(`A.close_voter_slots[${i}] (rent back to sponsor)`, async () =>
      send(teeHost, [await ix.closeVoterSlots(k, host.publicKey, batch)], host, [], true)
    );
  }
  await step("A.undelegate_room", async () => send(teeHost, [await ix.undelegateRoom(k, host.publicKey)], host, [], true));
  await step("A.session_back_on_base", () =>
    waitFor("undelegation", async () => {
      const [s, r] = await Promise.all([base.getAccountInfo(k.session), base.getAccountInfo(k.results)]);
      return s?.owner.equals(PROGRAM_ID) && r?.owner.equals(PROGRAM_ID);
    }, 180_000)
  );
  await step("E.committed_session_has_no_roster_or_ballots", async () => {
    const raw = (await base.getAccountInfo(k.session))!.data;
    for (const v of voters) assert.equal(raw.indexOf(v.publicKey.toBuffer()), -1, "wallet found in committed session");
    const s = decode.session(raw);
    assert.equal(s.vote.eligible.length, 0);
    assert.equal(s.openSlots, 0);
    return true;
  });

  // ---------------------------------------------------------------- Gate F: receipt
  const itemsHash = sha("action-items");
  await step("F.finalize_receipt", async () => send(base, [await ix.finalizeReceipt(k, itemsHash)], host));
  await step("F.receipt_verifies_from_public_data", async () => {
    const r = (await fetchDecoded(base, k.registry, decode.registry))!;
    const res = (await fetchDecoded(base, k.results, decode.results))!;
    const s = res.summaries[0];
    const sd = await voteSummaryDigest({
      roomId: k.registry.toBytes(),
      voteId: s.voteId,
      questionHash: Uint8Array.from(s.questionHash),
      optionHashes: s.optionHashes.map((o) => Uint8Array.from(o)) as [Uint8Array, Uint8Array, Uint8Array],
      counts: s.counts as [number, number, number],
      eligibleCount: s.eligibleCount,
      submittedCount: s.submittedCount,
      outcome: s.outcome as 0 | 1 | 2 | 3 | 4,
      closeTimestamp: BigInt(s.closedAt.toString()),
      eligibilitySnapshotHash: Uint8Array.from(s.eligibilityHash),
    });
    const digest = await receiptDigest({
      roomId: k.registry.toBytes(),
      vrfResultDigest: Uint8Array.from(r.vrfOutput),
      startedAt: BigInt(r.startedAt.toString()),
      endedAt: BigInt(r.endedAt.toString()),
      orderedSummaryDigests: [sd],
      actionItemsHash: itemsHash,
    });
    assert.ok(r.receiptFinalized);
    assert.deepEqual(Array.from(digest), r.receiptDigest);
    const tampered = await receiptDigest({
      roomId: k.registry.toBytes(),
      vrfResultDigest: Uint8Array.from(r.vrfOutput),
      startedAt: BigInt(r.startedAt.toString()),
      endedAt: BigInt(r.endedAt.toString()) + 1n,
      orderedSummaryDigests: [sd],
      actionItemsHash: itemsHash,
    });
    assert.notDeepEqual(Array.from(tampered), r.receiptDigest);
    return Buffer.from(r.receiptDigest).toString("hex");
  });
  await step("F.receipt_write_once", () =>
    expectFail("ReceiptAlreadyFinalized", async () => send(base, [await ix.finalizeReceipt(k, itemsHash)], host))
  );

  // ---------------------------------------------------------------- cleanup + cost
  await step("cost.close_session_and_results (rent back to host)", async () =>
    send(base, [await ix.closeRoomPda(k, KIND_SESSION), await ix.closeRoomPda(k, KIND_RESULTS)], host)
  );
  const voterLamports = await Promise.all(voters.map((v) => base.getBalance(v.publicKey)));
  await step("cost.all_voters_still_0_SOL", async () => {
    assert.ok(voterLamports.every((l) => l === 0), `voter balances: ${voterLamports}`);
    return true;
  });
  await sleep(2_000);
  const balance1 = await base.getBalance(host.publicKey);
  Object.assign(report, {
    hostEndLamports: balance1,
    hostNetCostLamports: balance0 - balance1,
    hostNetCostSol: (balance0 - balance1) / LAMPORTS_PER_SOL,
    hostPeakLockedSol: (balance0 - (report.hostAfterSetupLamports as number)) / LAMPORTS_PER_SOL,
    registryKeptLamports: (await base.getAccountInfo(k.registry))?.lamports,
    summary: summary ? { counts: summary.counts, submitted: summary.submittedCount, eligible: summary.eligibleCount } : null,
  });
}

main()
  .catch((e) => {
    report.fatal = (e as Error).message;
  })
  .finally(() => {
    report.results = results;
    report.failures = failures;
    report.finishedAt = new Date().toISOString();
    mkdirSync("tests/devnet/out", { recursive: true });
    writeFileSync("tests/devnet/out/gates-report.json", JSON.stringify(report, null, 2));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed; report: tests/devnet/out/gates-report.json`);
    if (report.fatal) console.log(`fatal: ${report.fatal}`);
    console.log(JSON.stringify({ hostNetCostSol: report.hostNetCostSol, hostPeakLockedSol: report.hostPeakLockedSol, readIsolation: report.readIsolation }, null, 1));
    process.exit(failures || report.fatal ? 1 : 0);
  });
