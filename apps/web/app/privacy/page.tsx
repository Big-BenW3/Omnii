import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, EyeOff, ReceiptText } from "lucide-react";
import { Page } from "../lib/client/ui";

export const metadata: Metadata = {
  title: "Privacy model: Omnii",
  description:
    "How Omnii designs for meeting and ballot privacy while keeping outcomes verifiable.",
};

const CARDS = [
  {
    icon: ShieldCheck,
    title: "Invite-controlled rooms",
    body: "Meetings are private by invitation. The host admits every participant from the waiting room, and invitation credentials can be rotated or revoked. The meeting name, description, invite secret, and discussion never go on-chain.",
  },
  {
    icon: EyeOff,
    title: "Private ballots (experimental)",
    body: "Each eligible wallet casts exactly one ballot per vote round. Individual choices are kept only in the permissioned private execution environment and are never written to the app database, server logs, analytics, receipt JSON, or normal API responses, and never committed to the public base layer. This behavior is experimental until the deployed isolation and tally tests pass. During voting the room shows only how many ballots were submitted, not who voted or for what.",
  },
  {
    icon: ReceiptText,
    title: "Public aggregate outcomes",
    body: "When a vote closes, only the aggregate totals are published in a separate public account. The on-chain program, not the backend, decides ballot validity and the tally. There is an explicit tradeoff: the outcome is verifiable, while the discussion and individual choices stay private.",
  },
];

export default function PrivacyPage() {
  return (
    <Page title="Privacy model">
      <main>
        <p className="text-sm text-text-secondary">
          Omnii never promises what it cannot prove. The existence of an on-chain transaction and the creator wallet can be publicly observable. Video and audio use encrypted transport but are not end-to-end encrypted. What stays private: the discussion, the invite secret, and every individual ballot.
        </p>

        <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-warning/40 bg-warning/10 p-4 md:p-5">
          <p className="text-sm font-semibold text-text-primary">
            Status: private voting is experimental
          </p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            The ballot isolation, tally and no-premature-result tests pass on
            the MagicBlock Devnet private rollup (see
            docs/architecture/magicblock-proof.md). Omnii runs on Devnet only
            and has not been audited, so treat ballot privacy as experimental.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {CARDS.map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-accent/60"
            >
              <c.icon className="mb-4 h-6 w-6 text-accent" aria-hidden="true" />
              <h2 className="mb-2 text-base font-semibold text-text-primary">
                {c.title}
              </h2>
              <p className="text-sm leading-relaxed text-text-secondary">
                {c.body}
              </p>
            </div>
          ))}
        </div>

        <div
          id="verification"
          className="mx-auto mt-12 max-w-3xl scroll-mt-20 rounded-2xl border border-border bg-surface p-6 md:p-8"
        >
          <h2 className="mb-3 text-xl font-bold text-text-primary">
            How verification works
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-text-secondary">
            <li>
              The host reviews the exact receipt before publishing it and
              confirms what becomes public.
            </li>
            <li>
              A deterministic receipt digest is computed from the public fields
              and committed to Solana.
            </li>
            <li>
              The public receipt page recomputes the digest from the published
              data and compares it with the on-chain record.
            </li>
            <li>
              A match shows Verified. Anything else shows Mismatch or Not yet
              committed. A database record alone never counts as verified.
            </li>
          </ol>
          <p className="mt-4 text-sm leading-relaxed text-text-secondary">
            The receipt proves that the committed digest and public result
            fields match the finalized program record. It does not publish the
            private discussion or prove facts that were not included in the
            committed receipt.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised px-5 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-accent"
          >
            Back to home
          </Link>
        </div>
      </main>
    </Page>
  );
}
