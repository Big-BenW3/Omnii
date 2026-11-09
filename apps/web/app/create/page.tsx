"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../lib/client/api";
import { Btn, Card, ErrorText, Field, Page, RequireSession, inputClass } from "../lib/client/ui";

export default function CreatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(() => new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 16));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { meetingId } = await api<{ meetingId: string }>("/meetings/drafts", {
        body: { name, description: description || undefined, scheduledStartAt: new Date(start).toISOString() },
      });
      router.push(`/meeting/${meetingId}/setup`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Page title="Create a meeting">
      <RequireSession>
        <Card>
          <div className="space-y-3">
            <Field label="Meeting name (3-80 characters, private, never on-chain)">
              <input data-testid="meeting-name" className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description (optional, private, up to 280 characters)">
              <textarea className={inputClass} value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Scheduled start">
              <input data-testid="meeting-start" type="datetime-local" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <p className="text-sm text-text-secondary">Duration is fixed at 60 minutes from when you start the meeting. Up to 20 people including you.</p>
            <ErrorText error={error} />
            <Btn data-testid="create-submit" disabled={busy || name.trim().length < 3} onClick={() => void submit()}>
              {busy ? "Creating…" : "Continue to on-chain setup"}
            </Btn>
          </div>
        </Card>
      </RequireSession>
    </Page>
  );
}
