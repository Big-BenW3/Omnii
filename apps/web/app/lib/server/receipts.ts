import "server-only";
import { eq } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, resultsPda, type RoomResults } from "@concord/client";
import {
  actionItemsHash,
  fromHex,
  labelHash,
  receiptDigest,
  toHex,
  voteSummaryDigest,
  type ActionItem,
  type Outcome,
} from "@concord/receipt-hash";
import { getDb } from "@/lib/db/client";
import { meetings, receiptDrafts, voteRounds } from "@/lib/db/schema";
import { readRegistry, readResults, toHexBytes } from "./chain";
import { ApiError } from "./http";

/** A RoomResults summary in JSON-safe form (hex hashes, numeric times). */
export interface SummaryJson {
  voteId: number;
  questionHash: string;
  optionHashes: string[];
  counts: number[];
  eligibleCount: number;
  submittedCount: number;
  outcome: number;
  closedAt: number;
  eligibilityHash: string;
  summaryDigest: string;
}

const OUTCOME_NAMES = ["OPTION_0", "OPTION_1", "OPTION_2", "TIE", "NO_DECISION"];

function summariesFromChain(results: RoomResults): SummaryJson[] {
  return results.summaries.map((s) => ({
    voteId: s.voteId,
    questionHash: toHexBytes(s.questionHash),
    optionHashes: s.optionHashes.map(toHexBytes),
    counts: [...s.counts],
    eligibleCount: s.eligibleCount,
    submittedCount: s.submittedCount,
    outcome: s.outcome,
    closedAt: s.closedAt.toNumber(),
    eligibilityHash: toHexBytes(s.eligibilityHash),
    summaryDigest: toHexBytes(s.summaryDigest),
  }));
}

/** Recomputes every summary digest and the receipt digest; true only if all match the registry. */
async function verifySummaries(
  registry: PublicKey,
  r: { vrfOutput: number[]; startedAt: number; endedAt: number; actionItemsHash: number[]; receiptDigest: number[] },
  summaries: SummaryJson[]
) {
  try {
    const roomId = registry.toBytes();
    const digests: Uint8Array[] = [];
    for (const [i, s] of summaries.entries()) {
      if (s.voteId !== i || s.optionHashes.length !== 3 || s.counts.length !== 3) return false;
      const d = await voteSummaryDigest({
        roomId,
        voteId: s.voteId,
        questionHash: fromHex(s.questionHash),
        optionHashes: s.optionHashes.map(fromHex) as [Uint8Array, Uint8Array, Uint8Array],
        counts: s.counts as [number, number, number],
        eligibleCount: s.eligibleCount,
        submittedCount: s.submittedCount,
        outcome: s.outcome as Outcome,
        closeTimestamp: s.closedAt,
        eligibilitySnapshotHash: fromHex(s.eligibilityHash),
      });
      if (toHex(d) !== s.summaryDigest) return false;
      digests.push(d);
    }
    const digest = await receiptDigest({
      roomId,
      vrfResultDigest: Uint8Array.from(r.vrfOutput),
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      orderedSummaryDigests: digests,
      actionItemsHash: Uint8Array.from(r.actionItemsHash),
    });
    return toHex(digest) === toHexBytes(r.receiptDigest);
  } catch {
    return false;
  }
}

const hashLabel = async (s: string) => toHex(await labelHash(s));

/**
 * Public receipt (spec 10.6, 17.3). Every field comes from, or is verified
 * against, the finalized on-chain RoomRegistry:
 *  - vote summaries are read from RoomResults; if that account has been closed
 *    for rent, a cached copy is used only if it recomputes to the on-chain
 *    receipt digest;
 *  - labels are shown only if their hashes match the summary;
 *  - action items are shown only if they hash to registry.actionItemsHash.
 * Never includes wallets, display names, meeting name/description or invite data.
 */
export async function publicReceipt(registryAddress: string) {
  let registryKey: PublicKey;
  try {
    registryKey = new PublicKey(registryAddress);
  } catch {
    throw new ApiError("NOT_FOUND", "Receipt not found");
  }
  const registry = await readRegistry(registryKey);
  if (!registry) throw new ApiError("NOT_FOUND", "Receipt not found");
  if (!registry.receiptFinalized) {
    throw new ApiError("NOT_YET_COMMITTED", "The receipt has not been committed on chain yet");
  }

  const resultsKey = resultsPda(registryKey);
  const results = await readResults(resultsKey);
  const db = getDb();
  const [meeting] = await db
    .select({ id: meetings.id, creatorWallet: meetings.creatorWallet })
    .from(meetings)
    .where(eq(meetings.roomRegistryAddress, registryKey.toBase58()))
    .limit(1);
  const [draft] = meeting
    ? await db.select().from(receiptDrafts).where(eq(receiptDrafts.meetingId, meeting.id)).limit(1)
    : [];

  const r = {
    vrfOutput: registry.vrfOutput,
    startedAt: registry.startedAt.toNumber(),
    endedAt: registry.endedAt.toNumber(),
    actionItemsHash: registry.actionItemsHash,
    receiptDigest: registry.receiptDigest,
  };

  const cached = (draft?.publicPayloadJson as { summaries?: SummaryJson[] } | null)?.summaries;
  const summaries = results ? summariesFromChain(results) : (cached ?? null);
  const verified = !!summaries && (await verifySummaries(registryKey, r, summaries));

  // Cache verified chain summaries so the receipt survives closing RoomResults.
  if (verified && results && meeting) {
    const payload = { publicPayloadJson: { summaries }, receiptDigest: toHexBytes(registry.receiptDigest) };
    if (draft) {
      await db.update(receiptDrafts).set({ ...payload, updatedAt: new Date() }).where(eq(receiptDrafts.id, draft.id));
    } else {
      await db
        .insert(receiptDrafts)
        .values({ meetingId: meeting.id, createdByWallet: meeting.creatorWallet, ...payload })
        .onConflictDoNothing();
    }
  }

  const rounds = meeting
    ? await db.select().from(voteRounds).where(eq(voteRounds.meetingId, meeting.id))
    : [];
  const votes = verified
    ? await Promise.all(
        summaries!.map(async (s) => {
          const round = rounds.find((v) => v.voteId === s.voteId);
          let labels: { question: string; options: string[] } | null = null;
          if (round) {
            const [q, ...opts] = await Promise.all([round.question, ...round.options].map(hashLabel));
            if (q === s.questionHash && opts.every((h, i) => h === s.optionHashes[i])) {
              labels = { question: round.question, options: [...round.options] };
            }
          }
          return {
            voteId: s.voteId,
            question: labels?.question ?? null,
            options: labels?.options ?? null,
            labelsVerified: !!labels,
            counts: s.counts,
            outcome: OUTCOME_NAMES[s.outcome] ?? "UNKNOWN",
            eligibleCount: s.eligibleCount,
            submittedCount: s.submittedCount,
            closedAt: new Date(s.closedAt * 1000).toISOString(),
            questionHash: s.questionHash,
            optionHashes: s.optionHashes,
            eligibilityHash: s.eligibilityHash,
            summaryDigest: s.summaryDigest,
          };
        })
      )
    : null;

  let actionItems: ActionItem[] | null = null;
  const items = draft?.actionItemsJson as ActionItem[] | null | undefined;
  if (items && toHex(await actionItemsHash(items)) === toHexBytes(registry.actionItemsHash)) {
    actionItems = items.map((i) => ({ text: i.text, ...(i.owner ? { owner: i.owner } : {}) }));
  }

  return {
    cluster: "devnet",
    programId: PROGRAM_ID.toBase58(),
    registryAddress: registryKey.toBase58(),
    resultsAddress: resultsKey.toBase58(),
    receiptDigest: toHexBytes(registry.receiptDigest),
    vrfOutput: toHexBytes(registry.vrfOutput),
    actionItemsHash: toHexBytes(registry.actionItemsHash),
    startedAt: new Date(r.startedAt * 1000).toISOString(),
    endedAt: new Date(r.endedAt * 1000).toISOString(),
    voteCount: registry.voteCount,
    votesVerified: verified,
    votes,
    actionItems,
  };
}
