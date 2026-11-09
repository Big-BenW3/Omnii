import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { authNonces } from "@/lib/db/schema";
import { POST as nonce } from "@/api/v1/auth/nonce/route";
import { POST as verify } from "@/api/v1/auth/verify/route";
import { POST as logout } from "@/api/v1/auth/logout/route";
import { GET as check } from "@/api/v1/auth/check/route";
import { GET as listMeetings } from "@/api/v1/meetings/route";
import { cookieFrom, freshDb, req, signIn, TestWallet } from "../support/harness";

let db: Awaited<ReturnType<typeof freshDb>>;
beforeEach(async () => {
  db = await freshDb();
});

async function challenge(wallet: TestWallet) {
  const res = await nonce(req("POST", "/api/v1/auth/nonce", { body: { walletAddress: wallet.address } }));
  expect(res.status).toBe(200);
  return (await res.json()) as { nonce: string; message: string };
}

describe("wallet sign-in", () => {
  it("issues a domain-bound, fee-free message", async () => {
    const { message } = await challenge(new TestWallet());
    expect(message).toContain("Domain: localhost:3100");
    expect(message).toContain("will not trigger a blockchain transaction");
  });

  it("accepts a valid signature and sets a hardened session cookie", async () => {
    const w = new TestWallet();
    const { nonce: n, message } = await challenge(w);
    const res = await verify(
      req("POST", "/api/v1/auth/verify", {
        body: { walletAddress: w.address, nonce: n, message, signature: w.sign(message) },
      })
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const status = await (await check(req("GET", "/api/v1/auth/check", { cookie: cookieFrom(res) }))).json();
    expect(status).toEqual({ isAuthenticated: true, user: { walletAddress: w.address } });
  });

  it("rejects a replayed signature (nonce is single-use)", async () => {
    const w = new TestWallet();
    const { nonce: n, message } = await challenge(w);
    const body = { walletAddress: w.address, nonce: n, message, signature: w.sign(message) };
    expect((await verify(req("POST", "/api/v1/auth/verify", { body }))).status).toBe(200);
    expect((await verify(req("POST", "/api/v1/auth/verify", { body }))).status).toBe(401);
  });

  it("rejects a signature from a different wallet", async () => {
    const w = new TestWallet();
    const attacker = new TestWallet();
    const { nonce: n, message } = await challenge(w);
    const res = await verify(
      req("POST", "/api/v1/auth/verify", {
        body: { walletAddress: w.address, nonce: n, message, signature: attacker.sign(message) },
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects a message that differs from the issued challenge", async () => {
    const w = new TestWallet();
    const { nonce: n, message } = await challenge(w);
    const tampered = message.replace("localhost:3100", "evil.example");
    const res = await verify(
      req("POST", "/api/v1/auth/verify", {
        body: { walletAddress: w.address, nonce: n, message: tampered, signature: w.sign(tampered) },
      })
    );
    expect(res.status).toBe(401);
  });

  it("rejects an expired nonce", async () => {
    const w = new TestWallet();
    const { nonce: n, message } = await challenge(w);
    await db.update(authNonces).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authNonces.walletAddress, w.address));
    const res = await verify(
      req("POST", "/api/v1/auth/verify", {
        body: { walletAddress: w.address, nonce: n, message, signature: w.sign(message) },
      })
    );
    expect(res.status).toBe(401);
  });

  it("logout revokes the session", async () => {
    const cookie = await signIn(new TestWallet());
    await logout(req("POST", "/api/v1/auth/logout", { cookie }));
    const status = await (await check(req("GET", "/api/v1/auth/check", { cookie }))).json();
    expect(status.isAuthenticated).toBe(false);
  });

  it("ignores a forged x-wallet-address header (identity comes only from the session)", async () => {
    const victim = new TestWallet();
    const res = await listMeetings(
      req("GET", "/api/v1/meetings", { headers: { "x-wallet-address": victim.address } })
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-JSON and malformed bodies", async () => {
    const res = await nonce(
      new Request("http://localhost:3100/api/v1/auth/nonce", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "x",
      })
    );
    expect(res.status).toBe(400);
    const bad = await nonce(req("POST", "/api/v1/auth/nonce", { body: { walletAddress: "not-a-wallet-address-at-all-xxxxxx" } }));
    expect(bad.status).toBe(400);
  });
});
