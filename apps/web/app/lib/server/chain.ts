import "server-only";
import { Connection, PublicKey } from "@solana/web3.js";
import { DELEGATION_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import { decode, PROGRAM_ID, type RoomRegistry, type RoomResults } from "@concord/client";
import { serverEnv } from "./env";
import { ApiError } from "./http";

export { DELEGATION_PROGRAM_ID };

/**
 * Read-only chain access for the server. The server never signs or sends
 * transactions (ADR-011); it only reads public base-layer accounts and,
 * best effort, transaction status from the PER.
 */
export interface RawAccount {
  owner: PublicKey;
  data: Buffer;
}

export interface PerTransaction {
  failed: boolean;
  signers: string[];
  accountKeys: string[];
  logs: string[] | null;
}

export interface ChainReader {
  /** Base-layer account, or null if it does not exist. Throws on RPC failure. */
  baseAccount(key: PublicKey): Promise<RawAccount | null>;
  /** PER transaction, or null when the PER cannot or will not return it. */
  perTransaction(signature: string): Promise<PerTransaction | null>;
}

function rpcReader(): ChainReader {
  const env = serverEnv();
  const base = new Connection(env.MAGICBLOCK_BASE_RPC_URL, "confirmed");
  const per = new Connection(env.MAGICBLOCK_PER_RPC_URL, "confirmed");
  return {
    async baseAccount(key) {
      const info = await base.getAccountInfo(key, "confirmed");
      if (!info || info.data.length === 0) return null;
      return { owner: info.owner, data: Buffer.from(info.data) };
    },
    async perTransaction(signature) {
      try {
        const tx = await per.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx) return null;
        const msg = tx.transaction.message;
        const keys = msg.staticAccountKeys.map((k) => k.toBase58());
        return {
          failed: tx.meta?.err != null,
          signers: keys.slice(0, msg.header.numRequiredSignatures),
          accountKeys: keys,
          logs: tx.meta?.logMessages ?? null,
        };
      } catch {
        return null;
      }
    },
  };
}

let reader: ChainReader | null = null;
let override: ChainReader | null = null;

export function chain(): ChainReader {
  if (override) return override;
  if (!reader) reader = rpcReader();
  return reader;
}

export function setChainReaderForTests(r: ChainReader | null) {
  override = r;
}

async function baseAccount(key: PublicKey) {
  try {
    return await chain().baseAccount(key);
  } catch {
    throw new ApiError("SERVICE_UNAVAILABLE", "Solana RPC is unavailable. Try again.");
  }
}

function tryDecode<T>(data: Buffer, decoder: (d: Buffer) => T): T | null {
  try {
    return decoder(data);
  } catch {
    return null;
  }
}

/** RoomRegistry is never delegated, so it must be owned by the Concord program. */
export async function readRegistry(key: PublicKey): Promise<RoomRegistry | null> {
  const acc = await baseAccount(key);
  if (!acc || !acc.owner.equals(PROGRAM_ID)) return null;
  return tryDecode(acc.data, decode.registry);
}

/** RoomResults on the base layer: the last committed copy (delegated) or the undelegated account. */
export async function readResults(key: PublicKey): Promise<RoomResults | null> {
  const acc = await baseAccount(key);
  if (!acc || !(acc.owner.equals(PROGRAM_ID) || acc.owner.equals(DELEGATION_PROGRAM_ID))) return null;
  return tryDecode(acc.data, decode.results);
}

/** True when the base-layer account is currently owned by the delegation program. */
export async function isDelegated(key: PublicKey) {
  const acc = await baseAccount(key);
  return !!acc && acc.owner.equals(DELEGATION_PROGRAM_ID);
}

export const toHexBytes = (bytes: number[] | Uint8Array) => Buffer.from(bytes).toString("hex");
