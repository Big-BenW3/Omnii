"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useSession } from "./providers";

/** Functional-only primitives. Styling is intentionally minimal (redesign later). */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-text-primary">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="font-bold">Concord</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/create">Create</Link>
          <Link href="/privacy">Privacy</Link>
          <span className="rounded bg-warning/20 px-2 text-warning">Devnet</span>
        </nav>
        <WalletBar />
      </header>
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="text-2xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

export function WalletBar() {
  const { connected } = useWallet();
  const { wallet, signIn, signOut, signingIn, error } = useSession();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <WalletMultiButton />
      {connected && !wallet && (
        <Btn onClick={() => void signIn()} disabled={signingIn} data-testid="sign-in">
          {signingIn ? "Waiting for wallet approval" : "Sign in"}
        </Btn>
      )}
      {wallet && (
        <>
          <span data-testid="signed-in-as" className="font-mono">{wallet.slice(0, 4)}…{wallet.slice(-4)}</span>
          <Btn variant="secondary" onClick={() => void signOut()}>Sign out</Btn>
        </>
      )}
      {error && <span className="text-danger">{error}</span>}
    </div>
  );
}

/** Renders children only for a signed-in wallet; otherwise prompts for wallet + sign-in. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { wallet, loading } = useSession();
  const { connected } = useWallet();
  if (loading) return <p>Loading…</p>;
  if (!wallet) {
    return (
      <Card>
        <p data-testid="needs-sign-in">
          {connected
            ? "Sign in with your wallet to continue. Signing is free and sends no transaction."
            : "Connect a Solana wallet to continue. Concord never asks for your recovery phrase. No wallet yet? Install one from a trusted provider (for example Phantom or Solflare), create it there, then come back."}
        </p>
        <div className="mt-3"><WalletBar /></div>
      </Card>
    );
  }
  return <>{children}</>;
}

export function Card({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rounded border border-border bg-surface p-4">
      {title && <h2 className="mb-2 text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Btn({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-accent text-white",
    secondary: "border border-border bg-surface-raised",
    danger: "bg-danger text-white",
  }[variant];
  return (
    <button type="button" className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${styles} ${className}`} {...rest} />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export const inputClass = "w-full rounded border border-border bg-surface-raised px-2 py-1.5 text-sm";

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <p role="alert" data-testid="error" className="text-sm text-danger">{error}</p>;
}
