"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "./wallet-adapter.css";
import { api } from "./api";

const BASE_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://rpc.magicblock.app/devnet";

export function Providers({ children }: { children: ReactNode }) {
  // Empty list: wallet-adapter auto-detects every Wallet Standard wallet
  // (Phantom, Solflare, Backpack, ... and the Playwright test wallet).
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={BASE_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SessionProvider>{children}</SessionProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

interface SessionState {
  wallet: string | null;
  loading: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

function SessionProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, disconnect } = useWallet();
  const [wallet, setWallet] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ isAuthenticated: boolean; user: { walletAddress: string } | null }>("/auth/check");
      setWallet(r.user?.walletAddress ?? null);
    } catch {
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) {
      setError("Connect a wallet that supports message signing first.");
      return false;
    }
    setSigningIn(true);
    setError(null);
    try {
      const walletAddress = publicKey.toBase58();
      const { nonce, message } = await api<{ nonce: string; message: string }>("/auth/nonce", { body: { walletAddress } });
      const sig = await signMessage(new TextEncoder().encode(message));
      const signature = btoa(String.fromCharCode(...sig));
      await api("/auth/verify", { body: { walletAddress, nonce, message, signature } });
      setWallet(walletAddress);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      return false;
    } finally {
      setSigningIn(false);
    }
  }, [publicKey, signMessage]);

  const signOut = useCallback(async () => {
    await api("/auth/logout", { body: {} }).catch(() => {});
    setWallet(null);
    await disconnect().catch(() => {});
  }, [disconnect]);

  // A session for a different wallet than the connected one is not usable.
  const effective = wallet && publicKey && publicKey.toBase58() !== wallet ? null : wallet;

  return (
    <SessionContext.Provider value={{ wallet: effective, loading, signingIn, error, signIn, signOut, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <Providers>");
  return ctx;
}
