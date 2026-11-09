"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SPONSOR_BUDGET, KIND_RESULTS, KIND_SESSION, decode, fetchDecoded, ix } from "@concord/client";
import { api } from "../../../lib/client/api";
import { TxStatus, useChain, waitFor } from "../../../lib/client/chain";
import { useMeeting } from "../../../lib/client/meeting";
import { Btn, Card, ErrorText, Page, RequireSession } from "../../../lib/client/ui";

const DELEGATION = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

type ChainState = { registry: boolean; vrf: boolean; session: boolean; sessionDelegated: boolean; resultsDelegated: boolean };

/** Host-only, resumable on-chain setup: each step is derived from chain state. */
export default function SetupPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const { meeting, keys, mutate } = useMeeting(meetingId);
  const { base, send, tx } = useChain();
  const [chain, setChain] = useState<ChainState | null>(null);
  const [invite, setInvite] = useState<{ inviteUrl: string; joinCode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const readChain = useCallback(async () => {
    if (!keys) return null;
    const [reg, sess, res] = await Promise.all([
      fetchDecoded(base, keys.registry, decode.registry),
      base.getAccountInfo(keys.session),
      base.getAccountInfo(keys.results),
    ]);
    const s: ChainState = {
      registry: !!reg,
      vrf: !!reg?.vrfFulfilled,
      session: !!sess,
      sessionDelegated: sess?.owner.toBase58() === DELEGATION,
      resultsDelegated: res?.owner.toBase58() === DELEGATION,
    };
    setChain(s);
    return s;
  }, [base, keys]);

  useEffect(() => {
    void readChain();
  }, [readChain]);

  const sync = useCallback(async () => {
    await api(`/meetings/${meetingId}/chain-sync`, { body: {} });
    await mutate();
  }, [meetingId, mutate]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await readChain().catch(() => {});
      setBusy(false);
    }
  }

  const step1 = () =>
    run(async () => {
      await send("Create room + request randomness", "base", async () => [await ix.initializeRoom(keys!), await ix.requestRandomness(keys!)]);
      await sync();
    });

  const step2 = () =>
    run(async () => {
      await waitFor(async () => (await readChain())?.vrf, 180_000);
      const s = (await readChain())!;
      if (!s.session) await send("Create private room state", "base", async () => [await ix.initRoomState(keys!, DEFAULT_SPONSOR_BUDGET)]);
      if (!(await readChain())?.sessionDelegated) await send("Move room to private rollup", "base", async () => [await ix.delegate(keys!, KIND_SESSION)]);
      if (!(await readChain())?.resultsDelegated) await send("Move results to private rollup", "base", async () => [await ix.delegate(keys!, KIND_RESULTS)]);
      await waitFor(async () => {
        const c = await readChain();
        return c?.sessionDelegated && c.resultsDelegated;
      });
      await sync();
    });

  const step3 = () =>
    run(async () => {
      setInvite(await api(`/meetings/${meetingId}/invitation`, { body: {} }));
    });

  if (meeting && meeting.role !== "host") return <Page title="Setup"><p>Only the host can set up this meeting.</p></Page>;

  return (
    <Page title={`Set up: ${meeting?.name ?? "…"}`}>
      <RequireSession>
        <p className="text-sm">Status: <span data-testid="meeting-status">{meeting?.status ?? "…"}</span></p>
        <Card title="1. Register the room on Solana and request verifiable randomness">
          <p className="mb-2 text-sm text-text-secondary">One wallet transaction. You pay a small Devnet fee and rent (refunded at the end, except the public receipt).</p>
          {chain?.registry ? <p data-testid="step1-done">Done{chain.vrf ? " (randomness fulfilled)" : " (waiting for the VRF oracle)"}.</p> : (
            <Btn data-testid="step1" disabled={busy || !keys} onClick={() => void step1()}>Create room</Btn>
          )}
        </Card>
        <Card title="2. Set up the private room on the MagicBlock private rollup">
          {chain?.sessionDelegated && chain.resultsDelegated ? <p data-testid="step2-done">Done.</p> : (
            <Btn data-testid="step2" disabled={busy || !chain?.registry} onClick={() => void step2()}>
              {chain?.registry && !chain.vrf ? "Wait for randomness, then set up" : "Set up private room"}
            </Btn>
          )}
          <p className="mt-2 text-sm text-text-secondary">Up to three wallet approvals. Safe to refresh: completed steps are skipped.</p>
        </Card>
        <Card title="3. Invitation">
          {meeting?.status === "SETUP_PENDING" && chain?.sessionDelegated && (
            <Btn variant="secondary" onClick={() => void run(sync)}>Refresh status</Btn>
          )}
          {invite ? (
            <div className="space-y-1 text-sm">
              <p>Share privately. Shown only once; rotating creates new ones.</p>
              <p>Link: <code data-testid="invite-url" className="break-all">{invite.inviteUrl}</code></p>
              <p>Join code: <code data-testid="join-code">{invite.joinCode}</code></p>
            </div>
          ) : (
            <Btn data-testid="step3" disabled={busy || meeting?.status !== "WAITING_ROOM"} onClick={() => void step3()}>Create invitation</Btn>
          )}
        </Card>
        {meeting?.status === "WAITING_ROOM" && (
          <Link href={`/meeting/${meetingId}/lobby`}><Btn data-testid="to-lobby">Go to lobby</Btn></Link>
        )}
        <TxStatus tx={tx} />
        <ErrorText error={error} />
      </RequireSession>
    </Page>
  );
}
