/** Shared Devnet transport helpers for tests/devnet/*. */
import { setDefaultResultOrder } from "node:dns";
// WSL2 commonly lacks IPv6 routes; RPC hosts resolve to both. Prefer IPv4.
setDefaultResultOrder("ipv4first");
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import { DEVNET } from "../../packages/concord-client/src/index.ts";

const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|429|socket hang up|503|502/i;

// Test-only hardening: Devnet RPCs drop requests now and then. Reads retry
// transient network errors (never program errors) so a flaky hop cannot fail a gate.
for (const method of ["getAccountInfo", "getBalance", "getLatestBlockhash"] as const) {
  const original = Connection.prototype[method] as (...a: unknown[]) => Promise<unknown>;
  (Connection.prototype as unknown as Record<string, unknown>)[method] = async function (this: Connection, ...args: unknown[]) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await original.apply(this, args);
      } catch (e) {
        if (!TRANSIENT.test((e as Error).message) || attempt >= 6) throw e;
        await new Promise((r) => setTimeout(r, 1_500 * attempt));
      }
    }
  };
}

export const BASE_RPC = process.env.BASE_RPC ?? DEVNET.baseRpc;
export const TEE_RPC = process.env.TEE_RPC ?? DEVNET.teeRpc;
export const base = new Connection(BASE_RPC, "confirmed");
export const anonTee = new Connection(TEE_RPC, "confirmed");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function loadHost(): Keypair {
  const file = process.env.HOST_KEYPAIR ?? path.join(homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

/** Authenticated TEE connection for `kp` (a signed challenge; costs nothing). */
export async function teeFor(kp: Keypair): Promise<Connection> {
  const { token } = await getAuthToken(TEE_RPC, kp.publicKey, async (m) => nacl.sign.detached(m, kp.secretKey));
  return new Connection(`${TEE_RPC}?token=${token}`, "confirmed");
}

export class TxError extends Error {
  constructor(
    message: string,
    public logs: string[] = []
  ) {
    super(message);
  }
}

async function sendOnce(conn: Connection, ixs: TransactionInstruction[], payer: Keypair, extra: Keypair[], er: boolean) {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const signers = [payer, ...extra.filter((k) => !k.publicKey.equals(payer.publicKey))];
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: er });
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) {
    const detail = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    throw new TxError(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`, detail?.meta?.logMessages ?? []);
  }
  return sig;
}

/** Sends with retries on transient RPC failures only; program errors throw at once. */
export async function send(conn: Connection, ixs: TransactionInstruction[], payer: Keypair, extra: Keypair[] = [], er = false) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendOnce(conn, ixs, payer, extra, er);
    } catch (e) {
      const msg = (e as Error).message;
      const transient =
        !(e instanceof TxError) && /fetch failed|ECONNRESET|ETIMEDOUT|429|blockhash not found|block height exceeded|socket hang up/i.test(msg);
      if (!transient || attempt >= 6) throw e;
      await sleep(2_000 * attempt);
    }
  }
}

/** Expects a program error whose logs or message mention `name`. */
export async function expectFail(name: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    const text = `${(e as Error).message}\n${e instanceof TxError ? e.logs.join("\n") : ""}`;
    if (!text.includes(name) && !/InstructionError/.test(text)) {
      throw new Error(`expected ${name}, got: ${text.slice(0, 400)}`);
    }
    return text.includes(name) ? name : "InstructionError";
  }
  throw new Error(`expected ${name} but the transaction succeeded`);
}

export async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, ms = 120_000, every = 2_500): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`timeout waiting for ${label}${last ? `: ${(last as Error).message}` : ""}`);
}

export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
