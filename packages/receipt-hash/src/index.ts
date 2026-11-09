/**
 * Browser-verifiable receipt digest (spec section 9.5, ADR-009).
 *
 * Mirrors programs/concord/src/digest.rs byte for byte. Cross-language
 * vectors live in tests/receipt-digest-vectors.json and are asserted by
 * both the Rust unit tests and tests/receipt-digest.test.mjs.
 */

const encoder = new TextEncoder();

export const RECEIPT_PREFIX = encoder.encode("CONCORD_RECEIPT_V1");
export const VOTE_SUMMARY_PREFIX = encoder.encode("CONCORD_VOTE_SUMMARY_V1");

export const OUTCOME = {
  OPTION_0: 0,
  OPTION_1: 1,
  OPTION_2: 2,
  TIE: 3,
  NO_DECISION: 4,
} as const;

export type Outcome = (typeof OUTCOME)[keyof typeof OUTCOME];

export interface VoteSummaryInput {
  /** 32 raw bytes of the room address */
  roomId: Uint8Array;
  voteId: bigint | number;
  questionHash: Uint8Array;
  optionHashes: readonly [Uint8Array, Uint8Array, Uint8Array];
  /** Finalized per-option counts, in option order */
  counts: readonly [number, number, number];
  eligibleCount: number;
  submittedCount: number;
  outcome: Outcome;
  closeTimestamp: bigint | number;
  eligibilitySnapshotHash: Uint8Array;
}

export interface ReceiptInput {
  /** 32 raw bytes of the room address */
  roomId: Uint8Array;
  vrfResultDigest: Uint8Array;
  startedAt: bigint | number;
  endedAt: bigint | number;
  /** Public vote summary digests, in canonical order */
  orderedSummaryDigests: readonly Uint8Array[];
  actionItemsHash: Uint8Array;
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function i64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(value), true);
  return out;
}

function u64le(value: bigint | number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return new Uint8Array(digest);
}

export async function voteSummaryDigest(input: VoteSummaryInput): Promise<Uint8Array> {
  if (input.roomId.length !== 32) throw new Error("roomId must be 32 bytes");
  if (input.questionHash.length !== 32) throw new Error("questionHash must be 32 bytes");
  if (input.optionHashes.length !== 3) throw new Error("exactly 3 optionHashes required");
  if (input.counts.length !== 3) throw new Error("exactly 3 counts required");
  if (input.eligibilitySnapshotHash.length !== 32) {
    throw new Error("eligibilitySnapshotHash must be 32 bytes");
  }

  const parts: Uint8Array[] = [
    VOTE_SUMMARY_PREFIX,
    input.roomId,
    u64le(input.voteId),
    input.questionHash,
    input.optionHashes[0],
    input.optionHashes[1],
    input.optionHashes[2],
    u32le(input.counts[0]),
    u32le(input.counts[1]),
    u32le(input.counts[2]),
    u32le(input.eligibleCount),
    u32le(input.submittedCount),
    new Uint8Array([input.outcome]),
    i64le(input.closeTimestamp),
    input.eligibilitySnapshotHash,
  ];
  return sha256(concat(parts));
}

export async function receiptDigest(input: ReceiptInput): Promise<Uint8Array> {
  if (input.roomId.length !== 32) throw new Error("roomId must be 32 bytes");
  if (input.vrfResultDigest.length !== 32) {
    throw new Error("vrfResultDigest must be 32 bytes");
  }
  if (input.actionItemsHash.length !== 32) {
    throw new Error("actionItemsHash must be 32 bytes");
  }
  for (const digest of input.orderedSummaryDigests) {
    if (digest.length !== 32) throw new Error("summary digests must be 32 bytes");
  }

  const parts: Uint8Array[] = [
    RECEIPT_PREFIX,
    input.roomId,
    input.vrfResultDigest,
    i64le(input.startedAt),
    i64le(input.endedAt),
    u32le(input.orderedSummaryDigests.length),
    ...input.orderedSummaryDigests,
    input.actionItemsHash,
  ];
  return sha256(concat(parts));
}

export const LABEL_PREFIX = encoder.encode("CONCORD_LABEL_V1");
export const ACTION_ITEMS_PREFIX = encoder.encode("CONCORD_ACTION_ITEMS_V1");

/**
 * Hash of a vote question or option label, bound on-chain at open_vote.
 * Not encryption: short labels can be guessed (spec 9.2-C).
 */
export async function labelHash(label: string): Promise<Uint8Array> {
  return sha256(concat([LABEL_PREFIX, encoder.encode(label.normalize("NFC"))]));
}

export interface ActionItem {
  text: string;
  owner?: string;
}

/**
 * Canonical action-items hash:
 * SHA256("CONCORD_ACTION_ITEMS_V1" || u32 count || for each item:
 *   u32 len(text) || text || u32 len(owner) || owner)   (UTF-8, NFC, LE lengths)
 * An empty list hashes the prefix plus a zero count.
 */
export async function actionItemsHash(items: readonly ActionItem[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [ACTION_ITEMS_PREFIX, u32le(items.length)];
  for (const item of items) {
    const text = encoder.encode(item.text.normalize("NFC"));
    const owner = encoder.encode((item.owner ?? "").normalize("NFC"));
    parts.push(u32le(text.length), text, u32le(owner.length), owner);
  }
  return sha256(concat(parts));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("hex string must have even length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
