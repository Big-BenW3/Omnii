"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { decode, fetchDecoded } from "@concord/client";
import { actionItemsHash, labelHash, receiptDigest, toHex, voteSummaryDigest, type Outcome } from "@concord/receipt-hash";
import { ApiFailure, api } from "../../lib/client/api";
import { useChain } from "../../lib/client/chain";
import { explorerUrl } from "../../lib/explorer";
import { hexToBytes } from "../../lib/client/meeting";
import { Btn, Card, ErrorText, Page } from "../../lib/client/ui";

interface Vote {
  voteId: number;
  question: string | null;
  options: string[] | null;
  labelsVerified: boolean;
  counts: [number, number, number];
  outcome: string;
  eligibleCount: number;
  submittedCount: number;
  closedAt: string;
  questionHash: string;
  optionHashes: [string, string, string];
  eligibilityHash: string;
  summaryDigest: string;
}
interface Receipt {
  cluster: string;
  registryAddress: string;
  receiptDigest: string;
  vrfOutput: string;
  actionItemsHash: string;
  startedAt: string;
  endedAt: string;
  voteCount: number;
  votesVerified: boolean;
  votes: Vote[] | null;
  actionItems: { text: string; owner?: string }[] | null;
}

const OUTCOME_CODES = ["OPTION_0", "OPTION_1", "OPTION_2", "TIE", "NO_DECISION"];
type Verdict = "Not checked" | "Verifying" | "Verified" | "Mismatch" | "Not yet committed" | "RPC unavailable";

export default function PublicReceiptPage() {
  const { registryAddress } = useParams<{ registryAddress: string }>();
  const { base } = useChain();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [verdict, setVerdict] = useState<Verdict>("Not checked");
  const [detail, setDetail] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Receipt>(`/receipts/${registryAddress}`)
      .then(setReceipt)
      .catch((e) => {
        if (e instanceof ApiFailure && e.code === "NOT_YET_COMMITTED") setVerdict("Not yet committed");
        else setError((e as Error).message);
      });
  }, [registryAddress]);

  /** Recomputes everything in this browser and compares with the account read straight from Solana. */
  async function verify() {
    if (!receipt) return;
    setVerdict("Verifying");
    const notes: string[] = [];
    try {
      const reg = await fetchDecoded(base, new PublicKey(registryAddress), decode.registry);
      if (!reg) return setVerdict("RPC unavailable");
      if (!reg.receiptFinalized) return setVerdict("Not yet committed");
      if (!receipt.votes) {
        notes.push("Vote summaries are not available to recompute.");
        setDetail(notes);
        return setVerdict("Mismatch");
      }
      const digests: Uint8Array[] = [];
      let ok = true;
      for (const v of receipt.votes) {
        const sd = await voteSummaryDigest({
          roomId: new PublicKey(registryAddress).toBytes(),
          voteId: v.voteId,
          questionHash: hexToBytes(v.questionHash),
          optionHashes: v.optionHashes.map(hexToBytes) as [Uint8Array, Uint8Array, Uint8Array],
          counts: v.counts,
          eligibleCount: v.eligibleCount,
          submittedCount: v.submittedCount,
          outcome: OUTCOME_CODES.indexOf(v.outcome) as Outcome,
          closeTimestamp: BigInt(Math.floor(new Date(v.closedAt).getTime() / 1000)),
          eligibilitySnapshotHash: hexToBytes(v.eligibilityHash),
        });
        if (toHex(sd) !== v.summaryDigest) {
          ok = false;
          notes.push(`Vote ${v.voteId + 1}: summary digest mismatch`);
        }
        if (v.question && v.options) {
          const labelsOk =
            toHex(await labelHash(v.question)) === v.questionHash &&
            (await Promise.all(v.options.map(async (o, i) => toHex(await labelHash(o)) === v.optionHashes[i]))).every(Boolean);
          if (!labelsOk) {
            ok = false;
            notes.push(`Vote ${v.voteId + 1}: question/option text does not match the committed hashes`);
          }
        }
        digests.push(sd);
      }
      const items = receipt.actionItems ?? [];
      const itemsHash = receipt.actionItems ? await actionItemsHash(items) : hexToBytes(receipt.actionItemsHash);
      if (receipt.actionItems && toHex(itemsHash) !== toHex(Uint8Array.from(reg.actionItemsHash))) {
        ok = false;
        notes.push("Action items do not match the committed hash");
      }
      const rd = await receiptDigest({
        roomId: new PublicKey(registryAddress).toBytes(),
        vrfResultDigest: Uint8Array.from(reg.vrfOutput),
        startedAt: BigInt(reg.startedAt.toString()),
        endedAt: BigInt(reg.endedAt.toString()),
        orderedSummaryDigests: digests,
        actionItemsHash: itemsHash,
      });
      if (toHex(rd) !== toHex(Uint8Array.from(reg.receiptDigest))) {
        ok = false;
        notes.push("Receipt digest does not match the on-chain account");
      }
      setDetail(notes);
      setVerdict(ok ? "Verified" : "Mismatch");
    } catch (e) {
      setDetail([(e as Error).message]);
      setVerdict("RPC unavailable");
    }
  }

  return (
    <Page title="Public meeting receipt">
      <p className="text-sm">
        Verification: <span data-testid="verdict" className="font-semibold">{verdict}</span>
      </p>
      {detail.map((d) => <p key={d} className="text-sm text-danger">{d}</p>)}
      <ErrorText error={error} />
      {receipt && (
        <>
          <Btn data-testid="verify" onClick={() => void verify()}>Verify receipt</Btn>
          <Card title="Record">
            <dl className="space-y-1 break-all text-sm">
              <div>Cluster: {receipt.cluster}</div>
              <div>Account: <a className="underline" href={explorerUrl("address", receipt.registryAddress)} target="_blank" rel="noreferrer">{receipt.registryAddress}</a> (View on Solana Explorer)</div>
              <div>Receipt digest: <code data-testid="receipt-digest">{receipt.receiptDigest}</code></div>
              <div>Started: {receipt.startedAt} · Ended: {receipt.endedAt}</div>
              <div>VRF output: <code>{receipt.vrfOutput}</code></div>
            </dl>
          </Card>
          <Card title={`Decisions (${receipt.voteCount})`}>
            {receipt.votes?.map((v) => (
              <div key={v.voteId} className="mb-3 text-sm" data-testid={`receipt-vote-${v.voteId}`}>
                <p className="font-semibold">{v.question ?? `Vote ${v.voteId + 1} (labels not published)`}</p>
                <ul>
                  {v.counts.map((c, i) => <li key={i}>{v.options?.[i] ?? `Option ${i + 1}`}: {c}</li>)}
                </ul>
                <p>Outcome: {v.outcome} · {v.submittedCount} of {v.eligibleCount} eligible voted · closed {v.closedAt}</p>
              </div>
            ))}
          </Card>
          {receipt.actionItems && receipt.actionItems.length > 0 && (
            <Card title="Action items">
              <ul className="text-sm">{receipt.actionItems.map((i, n) => <li key={n}>{i.text}{i.owner ? ` (${i.owner})` : ""}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
