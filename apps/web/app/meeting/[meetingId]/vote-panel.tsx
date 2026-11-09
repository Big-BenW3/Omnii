"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  VOTE_CLOSING,
  VOTE_OPEN,
  decode,
  fetchDecoded,
  ix,
  slotPda,
  type PublicVoteSummary,
  type RoomKeys,
  type RoomSession,
} from "@concord/client";
import { api } from "../../lib/client/api";
import { TxStatus, useChain } from "../../lib/client/chain";
import { hexToBytes, useVoteRounds, type MeetingView, type Participant } from "../../lib/client/meeting";
import { Btn, Card, ErrorText, Field, inputClass } from "../../lib/client/ui";

const OUTCOME = ["Option 1 wins", "Option 2 wins", "Option 3 wins", "Tie", "No decision"];

export function VotePanel({ meeting, keys, participants }: { meeting: MeetingView; keys: RoomKeys; participants: Participant[] }) {
  const isHost = meeting.role === "host";
  const { publicKey } = useWallet();
  const { base, per, send, tx } = useChain();
  const { data: roundsData, mutate: refreshRounds } = useVoteRounds(meeting.id, true);
  const rounds = roundsData?.rounds ?? [];
  const [summaries, setSummaries] = useState<PublicVoteSummary[]>([]);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [myLastVote, setMyLastVote] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Public aggregates from the base layer; private state from the PER (host: session, everyone: own slot).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetchDecoded(base, keys.results, decode.results);
        if (!stop && res) setSummaries(res.summaries);
        const conn = await per();
        if (isHost) {
          const s = await fetchDecoded(conn, keys.session, decode.session);
          if (!stop) setSession(s);
        }
        if (publicKey) {
          const slot = await fetchDecoded(conn, slotPda(keys.session, publicKey), decode.slot);
          if (!stop) setMyLastVote(slot ? slot.lastVoteId : null);
        }
      } catch {
        // transient network error; next tick retries
      }
    };
    void tick();
    const t = setInterval(tick, 4_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [base, per, keys, isHost, publicKey]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      void refreshRounds();
    }
  }

  const finalizedIds = new Set(summaries.map((s) => s.voteId));
  const active = [...rounds].reverse().find((r) => !finalizedIds.has(r.voteId));
  const deadlinePassed = active ? new Date(active.deadline).getTime() < Date.now() : false;
  const alreadyVoted = active ? myLastVote === active.voteId : false;

  return (
    <Card title="Votes" testId="vote-panel">
      {isHost && (
        <HostControls
          meeting={meeting}
          keys={keys}
          participants={participants}
          session={session}
          busy={busy}
          deadlinePassed={deadlinePassed}
          run={run}
          send={send}
          per={per}
        />
      )}

      {active ? (
        <div className="mt-3 space-y-2" data-testid="active-vote">
          <p className="font-semibold">{active.question}</p>
          <p className="text-xs text-text-secondary">
            Closes {new Date(active.deadline).toLocaleTimeString()}. Individual choices and totals stay hidden until the vote is finalized.
          </p>
          {alreadyVoted ? (
            <p data-testid="vote-submitted">Vote submitted. You cannot vote again in this round.</p>
          ) : deadlinePassed ? (
            <p>Voting time is over.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {active.options.map((o, i) => (
                <Btn
                  key={o}
                  data-testid={`vote-option-${i}`}
                  disabled={busy || !publicKey}
                  onClick={() => void run(async () => {
                    await send("Submit private ballot", "per", async () => [await ix.castVote(keys, publicKey!, i as 0 | 1 | 2)]);
                    setMyLastVote(active.voteId);
                  })}
                >
                  {o}
                </Btn>
              ))}
            </div>
          )}
          {!isHost && meeting.joinRequest && !meeting.joinRequest.isVoter && (
            <p className="text-xs text-text-secondary">The host marked you as an observer; the program will reject a ballot from you.</p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-text-secondary" data-testid="no-active-vote">No vote is open.</p>
      )}

      {summaries.length > 0 && (
        <div className="mt-4 space-y-3" data-testid="results">
          <h3 className="font-semibold">Results (tallied on-chain, committed to Solana)</h3>
          {summaries.map((s) => {
            const r = rounds.find((x) => x.voteId === s.voteId);
            return (
              <div key={s.voteId} className="rounded border border-border p-2 text-sm" data-testid={`result-${s.voteId}`}>
                <p className="font-semibold">{r?.question ?? `Vote ${s.voteId + 1}`}</p>
                <ul>
                  {s.counts.map((c, i) => (
                    <li key={i} data-testid={`result-${s.voteId}-option-${i}`}>{r?.options[i] ?? `Option ${i + 1}`}: {c}</li>
                  ))}
                </ul>
                <p>{OUTCOME[s.outcome]} · {s.submittedCount} of {s.eligibleCount} eligible voted</p>
              </div>
            );
          })}
        </div>
      )}
      <TxStatus tx={tx} />
      <ErrorText error={error} />
    </Card>
  );
}

interface HostProps {
  meeting: MeetingView;
  keys: RoomKeys;
  participants: Participant[];
  session: RoomSession | null;
  busy: boolean;
  deadlinePassed: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  send: ReturnType<typeof useChain>["send"];
  per: ReturnType<typeof useChain>["per"];
}

/** Top-level so its form state survives the panel's polling re-renders. */
function HostControls({ meeting, keys, participants, session, busy, deadlinePassed, run, send, per }: HostProps) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", ""]);
  const [minutes, setMinutes] = useState(5);
  const [hostVotes, setHostVotes] = useState(true);
  const status = session?.vote.status;

  const voters = participants
    .filter((p) => p.role === "participant" && p.isVoter && p.walletAddress)
    .map((p) => new PublicKey(p.walletAddress!));
  const eligible = hostVotes ? [keys.creator, ...voters] : voters;

  const open = () =>
    run(async () => {
      if (!session) throw new Error("Private room state not loaded yet");
      const voteId = session.nextVoteId;
      const deadline = new Date(Date.now() + minutes * 60_000);
      const round = await api<{ questionHash: string; optionHashes: string[] }>(`/meetings/${meeting.id}/vote-rounds`, {
        body: { voteId, question, options, deadline: deadline.toISOString() },
      });
      await send("Open vote (eligibility frozen)", "per", async () => [
        await ix.openVote(keys, hexToBytes(round.questionHash), round.optionHashes.map(hexToBytes), Math.floor(deadline.getTime() / 1000), eligible),
      ]);
    });

  const finalize = () =>
    run(async () => {
      if (!session) throw new Error("Private room state not loaded yet");
      if (session.vote.status === VOTE_OPEN && !deadlinePassed) {
        await send("Close vote", "per", async () => [await ix.closeVote(keys, keys.creator)]);
      }
      const fresh = await fetchDecoded(await per(), keys.session, decode.session);
      await send("Tally privately and finalize", "per", async () => [await ix.finalizeVote(keys, keys.creator, fresh!.vote.eligible)]);
      await send("Publish aggregate result to Solana", "per", async () => [await ix.commitResults(keys, keys.creator)]);
    });

  if (status === VOTE_OPEN || status === VOTE_CLOSING) {
    return (
      <div className="space-y-2">
        <p className="text-sm">Vote {session!.vote.voteId + 1} is {status === VOTE_OPEN ? "open" : "closed, waiting to be finalized"} · {session!.vote.eligible.length} eligible</p>
        <Btn data-testid="finalize-vote" disabled={busy} onClick={() => void finalize()}>Close and finalize</Btn>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="new-vote-form">
      <Field label="Question">
        <input data-testid="vote-question" className={inputClass} value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} />
      </Field>
      {options.map((o, i) => (
        <Field key={i} label={`Option ${i + 1}`}>
          <input
            data-testid={`vote-option-input-${i}`}
            className={inputClass}
            value={o}
            maxLength={100}
            onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))}
          />
        </Field>
      ))}
      <Field label="Minutes until it closes">
        <input type="number" min={1} max={55} className={inputClass} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={hostVotes} onChange={(e) => setHostVotes(e.target.checked)} /> I (host) also vote
      </label>
      <p className="text-xs text-text-secondary">{eligible.length} eligible: everyone marked as a voter in the lobby{hostVotes ? ", plus you" : ""}. Each needs a voter slot (Prepare voter slots in the lobby).</p>
      <Btn
        data-testid="open-vote"
        disabled={busy || !session || !question.trim() || options.some((o) => !o.trim()) || eligible.length === 0}
        onClick={() => void open()}
      >
        Open vote
      </Btn>
    </div>
  );
}
