import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import * as schema from "@/lib/db/schema";
import { setDbForTests, type Db } from "@/lib/db/client";

let shared: { client: PGlite; db: ReturnType<typeof drizzle<typeof schema>> } | null = null;

/**
 * In-memory Postgres with all real migrations applied. Created once per test
 * file (PGlite boot is slow); every call truncates all tables for isolation.
 */
export async function freshDb() {
  if (!shared) {
    const client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../app/lib/db/migrations") });
    shared = { client, db };
  } else {
    const { rows } = await shared.client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'"
    );
    if (rows.length) {
      await shared.client.exec(
        `truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`
      );
    }
  }
  // The pglite and node-postgres drizzle drivers share the query-builder API.
  setDbForTests(shared.db as unknown as Db);
  return shared.db;
}

const BASE = "http://localhost:3100";

export function req(
  method: string,
  url: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { origin: BASE, ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  return new Request(BASE + url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

export const ctx = <P extends Record<string, string>>(params: P) => ({ params: Promise.resolve(params) });

/** A wallet that can sign the Concord challenge like a real Wallet Standard wallet. */
export class TestWallet {
  kp = Keypair.generate();
  get address() {
    return this.kp.publicKey.toBase58();
  }
  sign(message: string) {
    return Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), this.kp.secretKey)).toString("base64");
  }
}

/** Runs the real nonce -> sign -> verify flow and returns the session cookie. */
export async function signIn(wallet: TestWallet): Promise<string> {
  const nonceRoute = await import("@/api/v1/auth/nonce/route");
  const verifyRoute = await import("@/api/v1/auth/verify/route");
  // Distinct users come from distinct IPs; per-IP auth rate limits stay realistic.
  const headers = { "x-real-ip": `10.0.${wallet.kp.publicKey.toBytes()[0]}.${wallet.kp.publicKey.toBytes()[1]}` };
  const n = await nonceRoute.POST(
    req("POST", "/api/v1/auth/nonce", { body: { walletAddress: wallet.address }, headers })
  );
  const { nonce, message } = await n.json();
  const v = await verifyRoute.POST(
    req("POST", "/api/v1/auth/verify", {
      body: { walletAddress: wallet.address, nonce, message, signature: wallet.sign(message) },
      headers,
    })
  );
  if (v.status !== 200) throw new Error(`sign-in failed: ${v.status} ${await v.text()}`);
  return cookieFrom(v);
}

export function cookieFrom(res: Response) {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0];
}
