"use client";

import "@livekit/components-styles";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ConnectionStateToast,
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { DisconnectReason, Track } from "livekit-client";
import { PublicKey } from "@solana/web3.js";
import { MAX_DURATION_SECONDS, chunk, ix } from "@concord/client";
import { api } from "../../lib/client/api";
import { TxStatus, useChain } from "../../lib/client/chain";
import { useMeeting, useParticipants } from "../../lib/client/meeting";
import { Btn, Card, ErrorText, Page, RequireSession } from "../../lib/client/ui";
import { VotePanel } from "./vote-panel";

interface Token {
  serverUrl: string;
  participantToken: string;
}

export default function RoomPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const router = useRouter();
  const { meeting, keys } = useMeeting(meetingId, 5_000);
  const isHost = meeting?.role === "host";
  const { data: roster } = useParticipants(meetingId, meeting?.role === "host" || meeting?.role === "admitted");
  const [token, setToken] = useState<Token | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { send, tx } = useChain();

  // Token only after admission is confirmed and just before joining (spec 13.5).
  const join = useCallback(async () => {
    setError(null);
    try {
      setToken(await api<Token>(`/meetings/${meetingId}/livekit-token`, { body: {} }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [meetingId]);

  // Auto-join when live; after a failed or dropped connection retry with backoff
  // (unstable networks). A user who clicked Leave stays out until they rejoin.
  const [left, setLeft] = useState(false);
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (left || token || attempts > 6) return;
    if (meeting?.status !== "LIVE" || !(meeting.role === "host" || meeting.role === "admitted")) return;
    const t = setTimeout(() => void join(), attempts === 0 ? 0 : Math.min(2_000 * attempts, 10_000));
    return () => clearTimeout(t);
  }, [meeting?.status, meeting?.role, token, join, left, attempts]);
  const dropConnection = (userLeft: boolean) => {
    setToken(null);
    if (userLeft) setLeft(true);
    else setAttempts((a) => a + 1);
  };

  const endMeeting = async () => {
    if (!keys || !roster) return;
    setBusy(true);
    setError(null);
    try {
      await send("End meeting", "per", async () => [await ix.endMeeting(keys, keys.creator)]);
      const wallets = roster.participants.filter((p) => p.walletAddress).map((p) => new PublicKey(p.walletAddress!));
      for (const [i, batch] of chunk(wallets).entries()) {
        await send(`Close private voter slots (${i + 1})`, "per", async () => [await ix.closeVoterSlots(keys, keys.creator, batch)]);
      }
      await api(`/meetings/${meetingId}/lifecycle/end`, { body: {} });
      router.push(`/meeting/${meetingId}/receipt`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ended = meeting && ["ENDED", "EXPIRED", "FINALIZED", "CANCELLED"].includes(meeting.status);

  return (
    <Page title={meeting?.name ?? "Meeting"}>
      <RequireSession>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>Status: <span data-testid="meeting-status">{meeting?.status ?? "…"}</span></span>
          {meeting?.startedAt && <Countdown startedAt={meeting.startedAt} />}
          {isHost && meeting?.status === "LIVE" && (
            <Btn variant="danger" data-testid="end-meeting" disabled={busy} onClick={() => void endMeeting()}>End meeting for everyone</Btn>
          )}
        </div>
        {ended && (
          <Card>
            <p data-testid="meeting-ended">This meeting has ended.</p>
            {isHost && <Btn className="mt-2" onClick={() => router.push(`/meeting/${meetingId}/receipt`)}>Review and publish the receipt</Btn>}
          </Card>
        )}
        {meeting && meeting.status !== "LIVE" && !ended && <Card><p>The meeting is not live yet. Return to the lobby.</p></Card>}
        <ErrorText error={error} />
        {token && meeting?.status === "LIVE" && (
          <LiveKitRoom
            serverUrl={token.serverUrl}
            token={token.participantToken}
            connect
            video
            audio
            data-lk-theme="default"
            onConnected={() => {
              setAttempts(0);
              setError(null);
            }}
            onDisconnected={(reason) => dropConnection(reason === DisconnectReason.CLIENT_INITIATED)}
            onError={(e) => {
              setError(`Media connection problem: ${e.message}. Retrying…`);
              dropConnection(false);
            }}
            className="rounded border border-border"
            style={{ height: "60vh" }}
          >
            <VideoGrid />
            <RoomAudioRenderer />
            <ControlBar controls={{ microphone: true, camera: true, screenShare: false, chat: false, leave: true }} />
            <ConnectionStateToast />
          </LiveKitRoom>
        )}
        {!token && meeting?.status === "LIVE" && (left || attempts > 6) && (
          <Btn data-testid="rejoin" onClick={() => { setLeft(false); setAttempts(0); }}>Join video</Btn>
        )}
        {meeting && keys && roster && (meeting.role === "host" || meeting.role === "admitted") && (
          <VotePanel meeting={meeting} keys={keys} participants={roster.participants} />
        )}
        <Card title="Participants">
          <ul className="text-sm" data-testid="roster">
            {roster?.participants.map((p) => (
              <li key={p.identity}>{p.displayName}{p.role === "participant" ? (p.isVoter ? " (voter)" : " (observer)") : ""}</li>
            ))}
          </ul>
        </Card>
        <TxStatus tx={tx} />
      </RequireSession>
    </Page>
  );
}

function VideoGrid() {
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  return (
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 64px)" }}>
      <ParticipantTile />
    </GridLayout>
  );
}

function Countdown({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, new Date(startedAt).getTime() + MAX_DURATION_SECONDS * 1000 - now);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return <span data-testid="time-left">Time left: {m}:{String(s).padStart(2, "0")}</span>;
}
