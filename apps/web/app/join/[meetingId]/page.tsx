"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../../lib/client/api";
import { useMeeting } from "../../lib/client/meeting";
import { Btn, Card, ErrorText, Field, Page, RequireSession, inputClass } from "../../lib/client/ui";

export default function JoinPage() {
  const { meetingId } = useParams<{ meetingId: string }>();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { meeting, mutate } = useMeeting(meetingId, 3_000);

  // The link secret lives in the URL fragment (never sent to servers or logs).
  // Read it once, then remove it from the address bar and history.
  useEffect(() => {
    const m = window.location.hash.match(/s=([A-Za-z0-9_-]+)/);
    if (m) {
      setSecret(m[1]);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      await api(`/meetings/${meetingId}/join-requests`, {
        body: { displayName, ...(secret ? { inviteSecret: secret } : { joinCode: code }) },
      });
      await mutate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const status = meeting?.joinRequest?.status;
  return (
    <Page title="Join a meeting">
      <RequireSession>
        {meeting?.role === "host" && (
          <Card><p>You host this meeting. <Link className="underline" href={`/meeting/${meetingId}/lobby`}>Go to the lobby</Link>.</p></Card>
        )}
        {(meeting?.role === "none" || !meeting) && meeting?.role !== "host" && (
          <Card title="Request entry">
            <div className="space-y-3">
              <Field label="Display name (3-40 characters, shown to the host and participants)">
                <input data-testid="display-name" className={inputClass} value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
              </Field>
              {secret ? (
                <p className="text-sm text-text-secondary" data-testid="has-invite-link">Using the invitation from your link.</p>
              ) : (
                <Field label="Join code">
                  <input data-testid="join-code-input" className={inputClass} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                </Field>
              )}
              <ErrorText error={error} />
              <Btn data-testid="request-entry" disabled={busy || displayName.trim().length < 3 || (!secret && code.length < 4)} onClick={() => void request()}>
                Request entry
              </Btn>
            </div>
          </Card>
        )}
        {meeting?.role === "pending" && (
          <Card><p data-testid="join-pending">Waiting for the host to admit you to “{meeting.name}”. This page updates automatically.</p></Card>
        )}
        {meeting?.role === "rejected" && <Card><p data-testid="join-rejected">The host declined your request.</p></Card>}
        {meeting?.role === "admitted" && (
          <Card>
            <p data-testid="join-admitted">You were admitted to “{meeting.name}”.</p>
            <Link href={`/meeting/${meetingId}/lobby`}><Btn className="mt-2" data-testid="to-lobby">Go to the lobby</Btn></Link>
          </Card>
        )}
        {status && <p className="text-xs text-text-secondary">Request status: {status}</p>}
      </RequireSession>
    </Page>
  );
}
