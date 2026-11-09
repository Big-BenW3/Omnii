import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { authNonces } from "@/lib/db/schema";
import { keyedHash, randomToken } from "@/lib/server/crypto";
import { ApiError, clientIp, handler, parseJson } from "@/lib/server/http";
import { hit, RULES } from "@/lib/server/rate-limit";
import { buildAuthMessage, isValidWallet, NONCE_TTL_SECONDS } from "@/lib/server/wallet-auth";

const Body = z.object({ walletAddress: z.string().min(32).max(44) });

export const POST = handler(async (req: Request) => {
  const { walletAddress } = await parseJson(req, Body);
  if (!isValidWallet(walletAddress)) throw new ApiError("INVALID_REQUEST", "Invalid wallet address");
  await hit(`nonce:ip:${clientIp(req)}`, RULES.authNonce);

  const nonce = randomToken(24);
  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000);
  const message = buildAuthMessage({ nonce, wallet: walletAddress, expiresAt });

  const db = getDb();
  // Only one outstanding challenge per wallet.
  await db
    .delete(authNonces)
    .where(and(eq(authNonces.walletAddress, walletAddress), isNull(authNonces.consumedAt)));
  await db.insert(authNonces).values({
    walletAddress,
    nonceHash: keyedHash("nonce", nonce),
    messageHash: keyedHash("message", message),
    expiresAt,
  });

  return NextResponse.json({ nonce, message, expiresAt: expiresAt.toISOString() });
});
