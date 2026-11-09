import "server-only";
import { PublicKey } from "@solana/web3.js";
import { verify as ed25519Verify } from "@noble/ed25519";
import { serverEnv } from "./env";

export const NONCE_TTL_SECONDS = 300;

/** The exact text the wallet signs. Built once at nonce time and stored by hash. */
export function buildAuthMessage(params: { nonce: string; wallet: string; expiresAt: Date }) {
  return [
    "Concord wants you to sign in with your Solana wallet.",
    "This request will not trigger a blockchain transaction or cost any fees.",
    "",
    `Domain: ${new URL(serverEnv().APP_BASE_URL).host}`,
    `Wallet: ${params.wallet}`,
    `Nonce: ${params.nonce}`,
    `Expires: ${params.expiresAt.toISOString()}`,
  ].join("\n");
}

export function isValidWallet(address: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

export async function verifyWalletSignature(
  wallet: string,
  message: string,
  signatureBase64: string
): Promise<boolean> {
  try {
    const signature = Uint8Array.from(Buffer.from(signatureBase64, "base64"));
    if (signature.length !== 64) return false;
    const pubkey = new PublicKey(wallet).toBytes();
    return await ed25519Verify(signature, new TextEncoder().encode(message), pubkey);
  } catch {
    return false;
  }
}
