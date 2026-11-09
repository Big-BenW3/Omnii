import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  receiptDigest,
  toHex,
  voteSummaryDigest,
} from "../packages/receipt-hash/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(path.join(here, "receipt-digest-vectors.json"), "utf8")
);

test("TypeScript vote summary digests match the committed vectors", async () => {
  assert.ok(vectors.voteSummary.length >= 3);
  for (const vector of vectors.voteSummary) {
    const digest = await voteSummaryDigest({
      roomId: hexToBytes(vector.roomId),
      voteId: vector.voteId,
      questionHash: hexToBytes(vector.questionHash),
      optionHashes: vector.optionHashes.map(hexToBytes),
      counts: vector.counts,
      eligibleCount: vector.eligibleCount,
      submittedCount: vector.submittedCount,
      outcome: vector.outcome,
      closeTimestamp: BigInt(vector.closeTimestamp),
      eligibilitySnapshotHash: hexToBytes(vector.eligibilitySnapshotHash),
    });
    assert.equal(
      toHex(digest),
      vector.expectedSummaryDigest,
      `vote summary vector mismatch: ${vector.name}`
    );
  }
});

test("TypeScript receipt digests match the committed vectors", async () => {
  assert.ok(vectors.receipts.length >= 3);
  for (const vector of vectors.receipts) {
    const digest = await receiptDigest({
      roomId: hexToBytes(vector.roomId),
      vrfResultDigest: hexToBytes(vector.vrfResultDigest),
      startedAt: BigInt(vector.startedAt),
      endedAt: BigInt(vector.endedAt),
      orderedSummaryDigests: vector.orderedSummaryDigests.map(hexToBytes),
      actionItemsHash: hexToBytes(vector.actionItemsHash),
    });
    assert.equal(
      toHex(digest),
      vector.expectedReceiptDigest,
      `receipt vector mismatch: ${vector.name}`
    );
  }
});

test("receipt digest changes when any bound field changes", async () => {
  const base = {
    roomId: new Uint8Array(32).fill(1),
    vrfResultDigest: new Uint8Array(32).fill(2),
    startedAt: 10,
    endedAt: 20,
    orderedSummaryDigests: [new Uint8Array(32).fill(4)],
    actionItemsHash: new Uint8Array(32).fill(3),
  };
  const original = toHex(await receiptDigest(base));
  const mutations = [
    { ...base, roomId: new Uint8Array(32).fill(9) },
    { ...base, vrfResultDigest: new Uint8Array(32).fill(9) },
    { ...base, startedAt: 11 },
    { ...base, endedAt: 21 },
    { ...base, orderedSummaryDigests: [new Uint8Array(32).fill(9)] },
    { ...base, actionItemsHash: new Uint8Array(32).fill(9) },
  ];
  for (const mutated of mutations) {
    assert.notEqual(toHex(await receiptDigest(mutated)), original);
  }
});

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
