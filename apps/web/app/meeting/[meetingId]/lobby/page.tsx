"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { PublicKey } from "@solana/web3.js";
import { chunk, decode, fetchDecoded, ix, slotPda } from "@concord/client";
import { api } from "../../../lib/client/api";
import { TxStatus, useChain } from "../../../lib/client/chain";
import { useMeeting } from "../../../lib/client/meeting";
import { Btn, Card, ErrorText, Page, RequireSession } from "../../../lib/client/ui";

interface Req {
  id: string;
  displayName: string;
  walletShort: string;
  wallet: string;
  status: string;
  isVoter: boolean;
}

export default function LobbyPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { meeting, keys, mutate } = useMeeting(meetingId, 3_000);
  const isHost = meeting?.role === "host";
  const { data: reqs, mutate: refreshReqs } = useSWR<{ requests: Req[] }>(
    isHost ? `/meetings/${meetingId}/join-requests` : null,
    (p: string) => api(p),
    { refreshInterval: 3_000 }
  );
  const { per, send, tx } = useChain();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ inviteUrl: string; joinCode: string } | null>(null);
  const [slotsReady, setSlotsReady] = useState<number | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      await Promise.all([mutate(), refreshReqs()]).catch(() => {});
    }
  }

  const pending = reqs?.requests.filter((r) => r.status === "PENDING_HOST_APPROVAL") ?? [];
  const admitted = reqs?.requests.filter((r) => r.status === "ADMITTED") ?? [];

  /** Creates a private voter slot (PER, free) for the host and every admitted participant. */
  const prepareSlots = () =>
    run(async () => {
      const conn = await per();
      const wallets = [meeting!.hostWallet!, ...admitted.map((a) => a.wallet)].map((w) => new PublicKey(w));
      const missing: PublicKey[] = [];
      for (const w of wallets) {
        // The host cannot read voters' slots (privacy), so try creation idempotently instead.
        if (!(await conn.getAccountInfo(slotPda(keys!.session, w)))) missing.push(w);
      }
      for (const [i, batch] of chunk(missing).entries()) {
        await send(`Create voter slots (${i + 1}/${Math.ceil(missing.length / 4)})`, "per", async () => [await ix.addVoterSlots(keys!, batch)]);
      }
      const s = await fetchDecoded(conn, keys!.session, decode.session);
      setSlotsReady(s?.openSlots ?? null);
    });

  const start = () =>
    run(async () => {
      const signature = await send("Start meeting (60-minute clock starts)", "per", async () => [await ix.startMeeting(keys!)]);
      await api(`/meetings/${meetingId}/lifecycle/start`, { body: { signature } });
    });

  return (
    <Page title={`Lobby: ${meeting?.name ?? "…"}`}>
      <RequireSession>
        <p className="text-sm">Status: <span data-testid="meeting-status">{meeting?.status ?? "…"}</span> · Your role: {meeting?.role}</p>

        {meeting?.status === "LIVE" && (meeting.role === "host" || meeting.role === "admitted") && (
          <Link href={`/meeting/${meetingId}`}><Btn data-testid="enter-room">Enter the meeting room</Btn></Link>
        )}

        {!isHost && meeting?.role === "admitted" && meeting.status !== "LIVE" && (
          <Card><p data-testid="waiting-for-host">Admitted. Waiting for the host to start the meeting.</p></Card>
        )}
        {meeting && !isHost && meeting.role !== "admitted" && (
          <Card><p>You are not admitted to this meeting. <Link className="underline" href={`/join/${meetingId}`}>Request entry</Link>.</p></Card>
        )}

        {isHost && (
          <>
            <Card title={`Waiting room (${pending.length})`} testId="pending-list">
              {pending.length === 0 && <p className="text-sm text-text-secondary">No pending requests.</p>}
              {pending.map((r) => (
                <div key={r.id} className="flex items-center justify-between border-b border-border py-2" data-testid="pending-request">
                  <span>{r.displayName} <span className="font-mono text-xs text-text-secondary">{r.walletShort}</span></span>
                  <span className="flex gap-2">
                    <Btn data-testid="admit" disabled={busy} onClick={() => void run(async () => { await api(`/meetings/${meetingId}/join-requests/${r.id}/decision`, { body: { decision: "APPROVE" } }); })}>Admit</Btn>
                    <Btn variant="danger" data-testid="reject" disabled={busy} onClick={() => void run(async () => { await api(`/meetings/${meetingId}/join-requests/${r.id}/decision`, { body: { decision: "REJECT" } }); })}>Reject</Btn>
                  </span>
                </div>
              ))}
            </Card>

            <Card title={`Participants (${admitted.length + 1} / 20)`} testId="admitted-list">
              <p className="text-sm">Host (you)</p>
              {admitted.map((r) => (
                <label key={r.id} className="flex items-center justify-between border-b border-border py-2 text-sm" data-testid="admitted-participant">
                  <span>{r.displayName} <span className="font-mono text-xs text-text-secondary">{r.walletShort}</span></span>
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      data-testid="voter-toggle"
                      checked={r.isVoter}
                      onChange={(e) => void run(async () => { await api(`/meetings/${meetingId}/participants/${r.id}`, { method: "PATCH", body: { isVoter: e.target.checked } }); })}
                    />
                    {r.isVoter ? "Voter" : "Observer"}
                  </span>
                </label>
              ))}
              <p className="mt-2 text-xs text-text-secondary">Voter or observer is locked into each vote when it opens.</p>
            </Card>

            <Card title="Private voter slots">
              <p className="mb-2 text-sm text-text-secondary">
                Creates a private ballot slot on the MagicBlock private rollup for you and each admitted participant. Free; only that person can read their slot. Run again after admitting more people.
              </p>
              <Btn data-testid="prepare-slots" disabled={busy || !keys} onClick={() => void prepareSlots()}>Prepare voter slots</Btn>
              {slotsReady !== null && <p className="mt-1 text-sm" data-testid="slots-ready">{slotsReady} slots ready</p>}
            </Card>

            <Card title="Meeting controls">
              <div className="flex flex-wrap gap-2">
                {meeting?.status === "WAITING_ROOM" && (
                  <Btn data-testid="start-meeting" disabled={busy || !keys} onClick={() => void start()}>Start meeting</Btn>
                )}
                <Btn variant="secondary" disabled={busy} onClick={() => void run(async () => setInvite(await api(`/meetings/${meetingId}/invitation/rotate`, { body: {} })))}>
                  Rotate invitation
                </Btn>
                {["DRAFT", "SETUP_PENDING", "WAITING_ROOM"].includes(meeting?.status ?? "") && (
                  <Btn variant="danger" disabled={busy} onClick={() => void run(async () => { await api(`/meetings/${meetingId}/lifecycle/cancel`, { body: {} }); })}>Cancel meeting</Btn>
                )}
              </div>
              {invite && (
                <div className="mt-2 text-sm">
                  <p>New link (old one no longer works): <code data-testid="invite-url" className="break-all">{invite.inviteUrl}</code></p>
                  <p>Join code: <code data-testid="join-code">{invite.joinCode}</code></p>
                </div>
              )}
            </Card>
          </>
        )}
        <TxStatus tx={tx} />
        <ErrorText error={error} />
      </RequireSession>
    </Page>
  );
}
