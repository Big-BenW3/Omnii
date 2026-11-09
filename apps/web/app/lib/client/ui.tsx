"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AppSidebar } from "../../../components/navigation/AppSidebar";
import { useSession } from "./providers";

/** Authenticated app shell: fixed sidebar + content column. Same props/children
 * contract as before the redesign, so every screen that calls <Page> is unaffected. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-text-primary">
      <AppSidebar />
      <div className="flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-border-low px-6 py-4 md:justify-end">
          <span className="text-sm font-semibold text-text-primary md:hidden">omnii</span>
          <WalletBar />
        </header>
        <main className="mx-auto max-w-4xl space-y-5 px-6 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}

export function WalletBar() {
  const { connected } = useWallet();
  const { wallet, signIn, signOut, signingIn, error } = useSession();
  return (
    <div className="flex flex-wrap items-center gap-2.5 text-sm">
      <WalletMultiButton />
      {connected && !wallet && (
        <Btn onClick={() => void signIn()} disabled={signingIn} data-testid="sign-in">
          {signingIn ? "Waiting for wallet approval" : "Sign in"}
        </Btn>
      )}
      {wallet && (
        <>
          <span data-testid="signed-in-as" className="rounded-full border border-border px-3 py-1.5 font-mono text-xs text-text-secondary">
            {wallet.slice(0, 4)}…{wallet.slice(-4)}
          </span>
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
  if (loading) return <p className="text-text-secondary">Loading…</p>;
  if (!wallet) {
    // The wallet control lives once, in the page header — not duplicated here.
    return (
      <Card>
        <p data-testid="needs-sign-in" className="text-text-secondary">
          {connected
            ? "Sign in with your wallet above to continue. Signing is free and sends no transaction."
            : "Connect a Solana wallet above to continue. Omnii never asks for your recovery phrase. No wallet yet? Install one from a trusted provider (for example Phantom or Solflare), create it there, then come back."}
        </p>
      </Card>
    );
  }
  return <>{children}</>;
}

export function Card({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="rounded-2xl border border-border bg-surface p-5">
      {title && <h2 className="mb-3 text-base font-semibold text-text-primary">{title}</h2>}
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
    primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
    secondary: "border border-border bg-surface-raised text-text-primary hover:border-border-strong",
    danger: "bg-danger text-white hover:brightness-110",
  }[variant];
  return (
    <button
      type="button"
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${styles} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none";

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <p role="alert" data-testid="error" className="text-sm text-danger">{error}</p>;
}
