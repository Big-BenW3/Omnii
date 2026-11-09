"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Connection, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { DEVNET } from "@concord/client";

export const BASE_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || DEVNET.baseRpc;
export const TEE_RPC = process.env.NEXT_PUBLIC_PER_RPC_URL || DEVNET.teeRpc;

export type Layer = "base" | "per";
export type TxPhase =
  | "idle"
  | "Ready for wallet approval"
  | "Awaiting wallet signature"
  | "Submitted"
  | "Confirming on Solana"
  | "Accepted by private rollup"
  | "Confirmed on Solana"
  | "Failed";

export interface TxState {
  label: string;
  phase: TxPhase;
  signature?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tokenCache = new Map<string, { conn: Connection; expiresAt: number }>();

/**
 * Wallet-signed transactions on the base layer (host pays) or the TEE PER
 * (fee-free for everyone; voters need 0 SOL). The server never signs.
 */
export function useChain() {
  const { publicKey, signTransaction, signMessage } = useWallet();
  const [tx, setTx] = useState<TxState>({ label: "", phase: "idle" });
  const base = useMemo(() => new Connection(BASE_RPC, "confirmed"), []);
  const busy = useRef(false);

  /** Authenticated PER connection (one free signed challenge per wallet per session). */
  const per = useCallback(async () => {
    if (!publicKey || !signMessage) throw new Error("Connect a wallet that can sign messages");
    const key = publicKey.toBase58();
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.conn;
    const { token, expiresAt } = await getAuthToken(TEE_RPC, publicKey, (m) => signMessage(m));
    const conn = new Connection(`${TEE_RPC}?token=${token}`, "confirmed");
    tokenCache.set(key, { conn, expiresAt: expiresAt || Date.now() + 3_600_000 });
    return conn;
  }, [publicKey, signMessage]);

  const send = useCallback(
    async (label: string, layer: Layer, build: () => Promise<TransactionInstruction[]>) => {
      if (!publicKey || !signTransaction) throw new Error("Connect your wallet first");
      if (busy.current) throw new Error("Another transaction is in progress");
      busy.current = true;
      try {
        setTx({ label, phase: "Ready for wallet approval" });
        const conn = layer === "per" ? await per() : base;
        const ixs = await build();
        const t = new Transaction().add(...ixs);
        t.feePayer = publicKey;
        t.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
        setTx({ label, phase: "Awaiting wallet signature" });
        const signed = await signTransaction(t);
        const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: layer === "per" });
        setTx({ label, phase: layer === "per" ? "Submitted" : "Confirming on Solana", signature });
        const res = await conn.confirmTransaction(signature, "confirmed");
        if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
        setTx({ label, phase: layer === "per" ? "Accepted by private rollup" : "Confirmed on Solana", signature });
        return signature;
      } catch (e) {
        const error = friendlyError(e);
        setTx((prev) => ({ label, phase: "Failed", signature: prev.signature, error }));
        throw new Error(error);
      } finally {
        busy.current = false;
      }
    },
    [publicKey, signTransaction, per, base]
  );

  return { base, per, send, tx, wallet: publicKey };
}

/** Maps Anchor/program errors in logs to the error name for the UI. */
function friendlyError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const logs = (e as { logs?: string[] })?.logs?.join("\n") ?? "";
  const m = `${msg}\n${logs}`.match(/Error Code: (\w+)/);
  if (m) return m[1];
  if (/User rejected/i.test(msg)) return "You rejected the request in your wallet";
  return msg.slice(0, 300);
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 120_000, everyMs = 2_500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch {
      // keep polling
    }
    await sleep(everyMs);
  }
  throw new Error("Timed out waiting for the network");
}

export function TxStatus({ tx }: { tx: TxState }) {
  if (tx.phase === "idle") return null;
  return (
    <div data-testid="tx-status" className={`mt-3 rounded border p-2 text-sm ${tx.phase === "Failed" ? "border-danger text-danger" : "border-border"}`}>
      <span className="font-semibold">{tx.label}:</span> <span data-testid="tx-phase">{tx.phase}</span>
      {tx.error && <div>Error: {tx.error}</div>}
      {tx.signature && <div className="break-all font-mono text-xs text-text-secondary">{tx.signature}</div>}
    </div>
  );
}
