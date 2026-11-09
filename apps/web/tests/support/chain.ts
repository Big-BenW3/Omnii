import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { IDL, PROGRAM_ID, roomKeys } from "@concord/client";
import { labelHash, receiptDigest, voteSummaryDigest } from "@concord/receipt-hash";
import { DELEGATION_PROGRAM_ID, setChainReaderForTests, type ChainReader, type PerTransaction, type RawAccount } from "@/lib/server/chain";

// Same coder construction as @concord/client (camelCase field names).
const coder = new anchor.Program(IDL, { connection: null } as unknown as anchor.Provider).coder.accounts;
const bn = (n: number) => new anchor.BN(n);
const zeros = (n = 32) => Array(n).fill(0);
const bytes = (u: Uint8Array) => Array.from(u);

/** In-memory stand-in for the base layer and PER RPCs, holding real Borsh-encoded accounts. */
export class FakeChain implements ChainReader {
  accounts = new Map<string, RawAccount>();
  perTxs = new Map<string, PerTransaction>();
  baseDown = false;
  baseReads = 0;

  install() {
    setChainReaderForTests(this);
    return this;
  }

  async baseAccount(key: PublicKey) {
    this.baseReads++;
    if (this.baseDown) throw new Error("rpc down");
    return this.accounts.get(key.toBase58()) ?? null;
  }

  async perTransaction(signature: string) {
    return this.perTxs.get(signature) ?? null;
  }

  async put(key: PublicKey, name: "RoomRegistry" | "RoomResults", value: object, owner = PROGRAM_ID) {
    const data = await coder.encode(name[0].toLowerCase() + name.slice(1), value);
    this.accounts.set(key.toBase58(), { owner, data });
  }

  delegate(key: PublicKey) {
    this.accounts.set(key.toBase58(), { owner: DELEGATION_PROGRAM_ID, data: Buffer.alloc(8) });
  }
}

export interface RegistryFields {
  vrfFulfilled?: boolean;
  receiptFinalized?: boolean;
  startedAt?: number;
  endedAt?: number;
  vrfOutput?: number[];
  actionItemsHash?: number[];
  receiptDigest?: number[];
  voteCount?: number;
}

export function registryValue(creator: PublicKey, meetingId: string, f: RegistryFields = {}) {
  const k = roomKeys(creator, meetingId);
  return {
    creator,
    roomNonce: k.nonce,
    createdAt: bn(1_700_000_000),
    vrfOutput: f.vrfOutput ?? zeros(),
    vrfFulfilled: f.vrfFulfilled ?? false,
    startedAt: bn(f.startedAt ?? 0),
    endedAt: bn(f.endedAt ?? 0),
    voteCount: f.voteCount ?? 0,
    actionItemsHash: f.actionItemsHash ?? zeros(),
    receiptDigest: f.receiptDigest ?? zeros(),
    receiptFinalized: f.receiptFinalized ?? false,
    bump: 255,
  };
}

/** Builds a finalized registry + results pair with digests computed exactly like the program. */
export async function finalizedRoom(
  creator: PublicKey,
  meetingId: string,
  votes: { question: string; options: [string, string, string]; counts: [number, number, number]; outcome: number }[],
  actionItemsHashBytes: Uint8Array
) {
  const k = roomKeys(creator, meetingId);
  const roomId = k.registry.toBytes();
  const startedAt = 1_800_000_000;
  const endedAt = startedAt + 1800;
  const vrfOutput = new Uint8Array(32).fill(7);
  const summaries = [];
  const digests: Uint8Array[] = [];
  for (const [i, v] of votes.entries()) {
    const questionHash = await labelHash(v.question);
    const optionHashes = (await Promise.all(v.options.map(labelHash))) as [Uint8Array, Uint8Array, Uint8Array];
    const eligibilityHash = new Uint8Array(32).fill(9);
    const closedAt = startedAt + 600 * (i + 1);
    const submitted = v.counts.reduce((a, b) => a + b, 0);
    const d = await voteSummaryDigest({
      roomId,
      voteId: i,
      questionHash,
      optionHashes,
      counts: v.counts,
      eligibleCount: submitted + 1,
      submittedCount: submitted,
      outcome: v.outcome as 0,
      closeTimestamp: closedAt,
      eligibilitySnapshotHash: eligibilityHash,
    });
    digests.push(d);
    summaries.push({
      voteId: i,
      questionHash: bytes(questionHash),
      optionHashes: optionHashes.map(bytes),
      counts: v.counts,
      eligibleCount: submitted + 1,
      submittedCount: submitted,
      outcome: v.outcome,
      closedAt: bn(closedAt),
      eligibilityHash: bytes(eligibilityHash),
      summaryDigest: bytes(d),
    });
  }
  const digest = await receiptDigest({
    roomId,
    vrfResultDigest: vrfOutput,
    startedAt,
    endedAt,
    orderedSummaryDigests: digests,
    actionItemsHash: actionItemsHashBytes,
  });
  return {
    keys: k,
    registry: registryValue(creator, meetingId, {
      vrfFulfilled: true,
      receiptFinalized: true,
      startedAt,
      endedAt,
      vrfOutput: bytes(vrfOutput),
      actionItemsHash: bytes(actionItemsHashBytes),
      receiptDigest: bytes(digest),
      voteCount: votes.length,
    }),
    results: { registry: k.registry, summaries, bump: 254 },
    digestHex: Buffer.from(digest).toString("hex"),
  };
}
