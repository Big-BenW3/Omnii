#!/usr/bin/env node
/**
 * Regenerates tests/receipt-digest-vectors.json using the TypeScript
 * implementation in packages/receipt-hash. Rust unit tests and
 * tests/receipt-digest.test.mjs both consume the generated file, proving
 * cross-language digest agreement (spec section 9.5).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  OUTCOME,
  receiptDigest,
  toHex,
  voteSummaryDigest,
} from "../packages/receipt-hash/src/index.ts";

const bytes = (fill, length = 32) => new Uint8Array(length).fill(fill);

const summaryInputs = [
  {
    name: "minimal-win",
    roomId: bytes(0x11),
    voteId: 1,
    questionHash: bytes(0x21),
    optionHashes: [bytes(0x31), bytes(0x32), bytes(0x33)],
    counts: [3, 1, 0],
    eligibleCount: 4,
    submittedCount: 4,
    outcome: OUTCOME.OPTION_0,
    closeTimestamp: 1_760_000_000,
    eligibilitySnapshotHash: bytes(0x41),
  },
  {
    name: "tie-negative-close",
    roomId: bytes(0xa1),
    voteId: 2 ** 33,
    questionHash: bytes(0xb1),
    optionHashes: [bytes(0xc1), bytes(0xc2), bytes(0xc3)],
    counts: [2, 2, 1],
    eligibleCount: 5,
    submittedCount: 5,
    outcome: OUTCOME.TIE,
    closeTimestamp: -100,
    eligibilitySnapshotHash: bytes(0xd1),
  },
  {
    name: "no-decision-zero-ballots",
    roomId: bytes(0xe1),
    voteId: 0,
    questionHash: bytes(0xe2),
    optionHashes: [bytes(0xe3), bytes(0xe4), bytes(0xe5)],
    counts: [0, 0, 0],
    eligibleCount: 10,
    submittedCount: 0,
    outcome: OUTCOME.NO_DECISION,
    closeTimestamp: 9_223_372_036_854_775_807n,
    eligibilitySnapshotHash: bytes(0xe6),
  },
];

const voteSummary = [];
for (const input of summaryInputs) {
  const digest = await voteSummaryDigest(input);
  voteSummary.push({
    name: input.name,
    roomId: toHex(input.roomId),
    voteId: input.voteId,
    questionHash: toHex(input.questionHash),
    optionHashes: input.optionHashes.map((h) => toHex(h)),
    counts: input.counts,
    eligibleCount: input.eligibleCount,
    submittedCount: input.submittedCount,
    outcome: input.outcome,
    closeTimestamp:
      typeof input.closeTimestamp === "bigint"
        ? input.closeTimestamp.toString()
        : input.closeTimestamp,
    eligibilitySnapshotHash: toHex(input.eligibilitySnapshotHash),
    expectedSummaryDigest: toHex(digest),
  });
}

const single = await voteSummaryDigest(summaryInputs[0]);
const tie = await voteSummaryDigest(summaryInputs[1]);
const none = await voteSummaryDigest(summaryInputs[2]);

const receiptInputs = [
  {
    name: "single-summary-zero-start",
    roomId: bytes(0x11),
    vrfResultDigest: bytes(0x71),
    startedAt: 0,
    endedAt: 1_760_000_100,
    orderedSummaryDigests: [single],
    actionItemsHash: bytes(0x51),
  },
  {
    name: "multi-summary-negative-start",
    roomId: bytes(0xa1),
    vrfResultDigest: bytes(0x72),
    startedAt: -50,
    endedAt: 100,
    orderedSummaryDigests: [single, tie, none],
    actionItemsHash: bytes(0x00),
  },
  {
    name: "empty-summaries",
    roomId: bytes(0xff),
    vrfResultDigest: bytes(0x73),
    startedAt: 1,
    endedAt: 2,
    orderedSummaryDigests: [],
    actionItemsHash: bytes(0xfe),
  },
];

const receipts = [];
for (const input of receiptInputs) {
  const digest = await receiptDigest(input);
  receipts.push({
    name: input.name,
    roomId: toHex(input.roomId),
    vrfResultDigest: toHex(input.vrfResultDigest),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    orderedSummaryDigests: input.orderedSummaryDigests.map((d) => toHex(d)),
    actionItemsHash: toHex(input.actionItemsHash),
    expectedReceiptDigest: toHex(digest),
  });
}

const out = path.join(process.cwd(), "tests", "receipt-digest-vectors.json");
writeFileSync(out, JSON.stringify({ voteSummary, receipts }, null, 2) + "\n");
console.log(`wrote ${out} (${voteSummary.length} vote summary + ${receipts.length} receipt vectors)`);
