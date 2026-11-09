/**
 * Ensures a dedicated, funded Devnet host wallet for E2E (never the deployer key
 * inside a browser). Tops it up from the local Solana CLI wallet when low.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setDefaultResultOrder } from "node:dns";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

setDefaultResultOrder("ipv4first");
export const HOST_KEY_FILE = path.resolve("tests/e2e/.keys/host.json");
const MIN_LAMPORTS = 0.15 * LAMPORTS_PER_SOL;
const TOP_UP = 0.4 * LAMPORTS_PER_SOL;

export function loadE2EHost(): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(HOST_KEY_FILE, "utf8"))));
}

export default async function globalSetup() {
  mkdirSync(path.dirname(HOST_KEY_FILE), { recursive: true });
  if (!existsSync(HOST_KEY_FILE)) writeFileSync(HOST_KEY_FILE, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  const host = loadE2EHost();
  const conn = new Connection(process.env.BASE_RPC ?? "https://rpc.magicblock.app/devnet", "confirmed");
  const balance = await conn.getBalance(host.publicKey);
  if (balance < MIN_LAMPORTS) {
    const funder = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(process.env.FUNDER_KEYPAIR ?? path.join(homedir(), ".config/solana/id.json"), "utf8")))
    );
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: host.publicKey, lamports: TOP_UP }));
    await sendAndConfirmTransaction(conn, tx, [funder]);
  }
  console.log(`E2E host ${host.publicKey.toBase58()} balance ${(await conn.getBalance(host.publicKey)) / LAMPORTS_PER_SOL} SOL`);
}
