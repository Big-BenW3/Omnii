"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { KIND_RESULTS, KIND_SESSION, PROGRAM_ID, chunk, decode, fetchDecoded, ix, type PublicVoteSummary, type RoomRegistry } from "@concord/client";
import { api } from "../../../lib/client/api";
import { TxStatus, useChain, waitFor } from "../../../lib/client/chain";
import { hexToBytes, useMeeting, useParticipants, useVoteRounds } from "../../../lib/client/meeting";
import { Btn, Card, ErrorText, Page, RequireSession, inputClass } from "../../../lib/client/ui";

interface Item {
  text: string;
  owner?: string;
}

export default function ReceiptReviewPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { meeting, keys, mutate } = useMeeting(meetingId, 5_000);
  const isHost = meeting?.role === "host";
  const { data: roster } = useParticipants(meetingId, isHost);
  const { data: rounds } = useVoteRounds(meetingId, isHost);
  const { base, per, send, tx } = useChain();
  const [items, setItems] = useState<Item[]>([]);
  const [summaries, setSummaries] = useState<PublicVoteSummary[]>([]);
  const [registry, setRegistry] = useState<RoomRegistry | null>(null);
  const [onBase, setOnBase] = useState<boolean | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!keys) return;
    const [sess, res, reg] = await Promise.all([
      base.getAccountInfo(keys.session),
      fetchDecoded(base, keys.results, decode.results),
      fetchDecoded(base, keys.registry, decode.registry),
    ]);
    setOnBase(sess ? sess.owner.equals(PROGRAM_ID) : null);
    if (res) setSummaries(res.summaries);
    setRegistry(reg);
  }, [base, keys]);

  useEffect(() => {
    void refresh();
    api<{ actionItems: Item[] }>(`/meetings/${meetingId}/receipt-draft`).then((d) => setItems(d.actionItems)).catch(() => {});
  }, [refresh, meetingId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await refresh().catch(() => {});
      await mutate();
    }
  }

  const returnToSolana = () =>
    run(async () => {
      const conn = await per();
      const s = await fetchDecoded(conn, keys!.session, decode.session);
      if (s && s.endedAt.isZero()) {
        await send("End meeting", "per", async () => [await ix.endMeeting(keys!, keys!.creator)]);
      }
      if (s && s.openSlots > 0 && roster) {
        const wallets = roster.participants.filter((p) => p.walletAddress).map((p) => new PublicKey(p.walletAddress!));
        for (const batch of chunk(wallets)) {
          await send("Close private voter slots", "per", async () => [await ix.closeVoterSlots(keys!, keys!.creator, batch)]);
        }
      }
      await send("Return room to Solana (undelegate)", "per", async () => [await ix.undelegateRoom(keys!, keys!.creator)]);
      await waitFor(async () => (await base.getAccountInfo(keys!.session))?.owner.equals(PROGRAM_ID), 180_000);
    });

  const publish = () =>
    run(async () => {
      const draft = await api<{ actionItemsHash: string }>(`/meetings/${meetingId}/receipt-draft`, {
        body: { actionItems: items.filter((i) => i.text.trim()) },
      });
      if (!registry?.receiptFinalized) {
        await send("Publish receipt on Solana", "base", async () => [await ix.finalizeReceipt(keys!, hexToBytes(draft.actionItemsHash))]);
      }
      // Let the public receipt endpoint verify and cache the summaries before results are closed.
      await waitFor(async () => api(`/receipts/${keys!.registry.toBase58()}`).then(() => true), 60_000);
      await send("Reclaim rent (close private room accounts)", "base", async () => [
        await ix.closeRoomPda(keys!, KIND_SESSION),
        await ix.closeRoomPda(keys!, KIND_RESULTS),
      ]);
      await api(`/meetings/${meetingId}/chain-sync`, { body: {} });
    });

  if (meeting && !isHost) return <Page title="Receipt"><p>Only the host can publish the receipt.</p></Page>;
  const label = (voteId: number) => rounds?.rounds.find((r) => r.voteId === voteId);

  return (
    <Page title={`Receipt: ${meeting?.name ?? "…"}`}>
      <RequireSession>
        <p className="text-sm">Status: <span data-testid="meeting-status">{meeting?.status}</span></p>

        <Card title="1. Return the room to Solana">
          {onBase ? <p data-testid="room-on-base">Done: private room state is back on Solana with no ballots or roster.</p> : (
            <Btn data-testid="undelegate" disabled={busy || !keys || onBase === null} onClick={() => void returnToSolana()}>Return room to Solana</Btn>
          )}
        </Card>

        <Card title="2. Action items (optional)">
          {items.map((it, i) => (
            <div key={i} className="mb-2 flex gap-2">
              <input className={inputClass} placeholder="Action item" value={it.text} maxLength={200} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <input className={inputClass} placeholder="Owner (optional, becomes public)" value={it.owner ?? ""} maxLength={40} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, owner: e.target.value || undefined } : x)))} />
              <Btn variant="secondary" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</Btn>
            </div>
          ))}
          <Btn variant="secondary" data-testid="add-item" onClick={() => setItems([...items, { text: "" }])}>Add action item</Btn>
        </Card>

        <Card title="3. Review what becomes public" testId="disclosure-preview">
          <p className="mb-2 text-sm text-warning">
            Everything below will be public and permanent on Solana. Individual ballots, participant names and wallets, the meeting name and the discussion are not published. Owner names you type above will be public.
          </p>
          {summaries.length === 0 && <p className="text-sm">No votes were finalized.</p>}
          {summaries.map((s) => (
            <div key={s.voteId} className="text-sm">
              <p className="font-semibold">{label(s.voteId)?.question ?? `Vote ${s.voteId + 1}`}</p>
              <p>{s.counts.map((c, i) => `${label(s.voteId)?.options[i] ?? `Option ${i + 1}`}: ${c}`).join(" · ")}</p>
            </div>
          ))}
          {items.filter((i) => i.text.trim()).map((i, n) => <p key={n} className="text-sm">• {i.text}{i.owner ? ` (${i.owner})` : ""}</p>)}
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid="confirm-disclosure" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm this information may be published.
          </label>
        </Card>

        <Card title="4. Publish">
          {meeting?.status === "FINALIZED" || registry?.receiptFinalized ? (
            <p data-testid="receipt-published">
              Published. <Link className="underline" data-testid="public-receipt-link" href={`/receipt/${keys?.registry.toBase58()}`}>Open the public receipt</Link>
            </p>
          ) : null}
          {!(meeting?.status === "FINALIZED") && (
            <Btn data-testid="publish-receipt" disabled={busy || !onBase || !confirmed} onClick={() => void publish()}>
              {registry?.receiptFinalized ? "Finish cleanup" : "Publish receipt"}
            </Btn>
          )}
        </Card>
        <TxStatus tx={tx} />
        <ErrorText error={error} />
      </RequireSession>
    </Page>
  );
}
