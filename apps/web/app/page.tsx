"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, Card, Field, Page, inputClass } from "./lib/client/ui";

export default function Home() {
  const router = useRouter();
  const [meetingId, setMeetingId] = useState("");
  return (
    <Page title="Meet together. Decide privately. Verify the outcome.">
      <p className="text-sm text-text-secondary">
        Invite-only video rooms (up to 20 people, 60 minutes), private ballots on the MagicBlock private rollup, and a
        receipt anyone can verify on Solana. Experimental ballot privacy. Devnet only.
      </p>
      <div className="flex gap-3">
        <Link href="/create"><Btn data-testid="cta-create">Create a meeting</Btn></Link>
        <Link href="/dashboard"><Btn variant="secondary">My meetings</Btn></Link>
      </div>
      <Card title="Join a meeting">
        <p className="mb-2 text-sm text-text-secondary">
          Open the invite link you were sent, or enter the meeting id and use your join code on the next screen.
        </p>
        <Field label="Meeting id">
          <input className={inputClass} value={meetingId} onChange={(e) => setMeetingId(e.target.value.trim())} placeholder="xxxxxxxx-xxxx-…" />
        </Field>
        <Btn className="mt-2" disabled={!meetingId} onClick={() => router.push(`/join/${meetingId}`)}>Continue</Btn>
      </Card>
      <Card title="How it works">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-text-secondary">
          <li>Host connects a wallet, schedules a room, and gets a private link and join code.</li>
          <li>Participants connect wallets, request entry, and the host admits them.</li>
          <li>Everyone meets on video. The host opens votes with exactly three options; ballots are private.</li>
          <li>Results are tallied on-chain, the host publishes a receipt, and anyone can verify it.</li>
        </ol>
        <p className="mt-2 text-sm text-text-secondary">Only the host pays (a few hundredths of a Devnet SOL per meeting). Participants need a wallet but no SOL.</p>
      </Card>
    </Page>
  );
}
