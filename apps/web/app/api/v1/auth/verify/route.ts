import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { authNonces, users } from "@/lib/db/schema";
import { createSession, sessionCookie } from "@/lib/server/auth";
import { keyedHash, safeEqualHex } from "@/lib/server/crypto";
import { ApiError, clientIp, handler, parseJson } from "@/lib/server/http";
import { hit, RULES } from "@/lib/server/rate-limit";
import { verifyWalletSignature } from "@/lib/server/wallet-auth";

const Body = z.object({
  walletAddress: z.string().min(32).max(44),
  nonce: z.string().min(16).max(128),
  message: z.string().min(1).max(1024),
  /** base64-encoded 64-byte ed25519 signature over `message` */
  signature: z.string().min(80).max(100),
});

export const POST = handler(async (req: Request) => {
  const body = await parseJson(req, Body);
  await hit(`verify:ip:${clientIp(req)}`, RULES.authVerify);
  const db = getDb();

  // Atomically consume the nonce: a signed message can be used at most once.
  const [consumed] = await db
    .update(authNonces)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authNonces.walletAddress, body.walletAddress),
        eq(authNonces.nonceHash, keyedHash("nonce", body.nonce)),
        isNull(authNonces.consumedAt),
        gt(authNonces.expiresAt, new Date())
      )
    )
    .returning();
  if (!consumed) throw new ApiError("UNAUTHORIZED", "Sign-in challenge expired or already used");

  if (!safeEqualHex(consumed.messageHash, keyedHash("message", body.message))) {
    throw new ApiError("UNAUTHORIZED", "Signed message does not match the challenge");
  }
  if (!(await verifyWalletSignature(body.walletAddress, body.message, body.signature))) {
    throw new ApiError("UNAUTHORIZED", "Signature verification failed");
  }

  const [user] = await db
    .insert(users)
    .values({ walletAddress: body.walletAddress, lastAuthenticatedAt: new Date() })
    .onConflictDoUpdate({ target: users.walletAddress, set: { lastAuthenticatedAt: new Date() } })
    .returning();

  // Fresh session id on every sign-in (no fixation).
  const { token, expiresAt } = await createSession(body.walletAddress);
  const res = NextResponse.json({
    user: { id: user.id, walletAddress: user.walletAddress },
    session: { expiresAt: expiresAt.toISOString() },
  });
  res.headers.append("Set-Cookie", sessionCookie(token, expiresAt));
  return res;
});
