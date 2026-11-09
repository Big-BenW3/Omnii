/**
 * Playwright-only Wallet Standard wallet ("Concord Test Wallet"). Injected with
 * page.addInitScript before the app loads; wallet-adapter discovers it like any
 * installed wallet. Signs messages and transactions (legacy + v0) with ed25519
 * via tweetnacl. Never part of the production bundle.
 */
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import type { Keypair } from "@solana/web3.js";

// Playwright compiles specs as CommonJS, so `require` is available.
const NACL_SRC = readFileSync(require.resolve("tweetnacl/nacl-fast.min.js"), "utf8");
export const TEST_WALLET_NAME = "Concord Test Wallet";

function walletScript(secretKey: number[], name: string) {
  return `
(() => {
  ${NACL_SRC}
  const nacl = window.nacl;
  const secret = Uint8Array.from(${JSON.stringify(secretKey)});
  const kp = nacl.sign.keyPair.fromSecretKey(secret);
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58(bytes) {
    let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
    let s = ""; while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
    return s;
  }
  function readCompact(buf, off) {
    let len = 0, size = 0;
    for (;;) { const b = buf[off + size]; len |= (b & 0x7f) << (7 * size); size++; if ((b & 0x80) === 0) break; }
    return [len, size];
  }
  // Signs a serialized (legacy or v0) transaction in place for this keypair.
  function signTx(bytes) {
    const tx = Uint8Array.from(bytes);
    const [numSigs, sz] = readCompact(tx, 0);
    const msgStart = sz + numSigs * 64;
    const msg = tx.slice(msgStart);
    let p = (msg[0] & 0x80) ? 1 : 0;           // versioned prefix
    const numRequired = msg[p];
    p += 3;
    const [numKeys, ksz] = readCompact(msg, p);
    p += ksz;
    for (let i = 0; i < Math.min(numKeys, numRequired); i++) {
      const key = msg.slice(p + i * 32, p + (i + 1) * 32);
      if (key.every((b, j) => b === kp.publicKey[j])) {
        tx.set(nacl.sign.detached(msg, kp.secretKey), sz + i * 64);
        return tx;
      }
    }
    throw new Error("test wallet is not a required signer of this transaction");
  }
  const address = b58(kp.publicKey);
  const chains = ["solana:devnet", "solana:mainnet", "solana:testnet", "solana:localnet"];
  const features = ["solana:signTransaction", "solana:signMessage"];
  const account = { address, publicKey: kp.publicKey, chains, features, label: ${JSON.stringify(name)} };
  const listeners = {};
  const wallet = {
    version: "1.0.0",
    name: ${JSON.stringify(name)},
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAxIDEnLz4=",
    chains,
    accounts: [],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; (listeners.change || []).forEach((l) => l({ accounts: wallet.accounts })); return { accounts: wallet.accounts }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
      "standard:events": { version: "1.0.0", on: (ev, l) => { (listeners[ev] ||= []).push(l); return () => { listeners[ev] = listeners[ev].filter((x) => x !== l); }; } },
      "solana:signMessage": { version: "1.1.0", signMessage: async (...inputs) => inputs.map((i) => ({ signedMessage: i.message, signature: nacl.sign.detached(i.message, kp.secretKey) })) },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async (...inputs) => inputs.map((i) => ({ signedTransaction: signTx(i.transaction) })) },
    },
  };
  const register = ({ register }) => register(wallet);
  try { window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register })); } catch {}
  window.addEventListener("wallet-standard:app-ready", (e) => register(e.detail));
  // Make wallet-adapter auto-connect to this wallet (as if the user picked it before).
  try { localStorage.setItem("walletName", JSON.stringify(${JSON.stringify(name)})); } catch {}
  window.__concordTestWallet = address;
})();`;
}

export async function installTestWallet(page: Page, kp: Keypair) {
  await page.addInitScript({ content: walletScript(Array.from(kp.secretKey), TEST_WALLET_NAME) });
}
