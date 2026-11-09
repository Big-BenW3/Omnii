import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";
import { keyedHash, randomToken } from "./crypto";
import { ApiError } from "./http";

export const SESSION_COOKIE = "concord_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface Session {
  sessionId: string;
  wallet: string;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The only source of caller identity for every API route (ADR-014). */
export async function getSession(req: Request): Promise<Session | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ id: sessions.id, wallet: sessions.walletAddress })
    .from(sessions)
    .where(
      and(
        eq(sessions.sessionTokenHash, keyedHash("session", token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!row) return null;
  // Best-effort activity stamp; never blocks the request.
  db.update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.id))
    .catch(() => {});
  return { sessionId: row.id, wallet: row.wallet };
}

export async function requireSession(req: Request): Promise<Session> {
  const session = await getSession(req);
  if (!session) throw new ApiError("UNAUTHORIZED", "Sign in with your wallet first");
  return session;
}

export async function createSession(wallet: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await getDb().insert(sessions).values({
    sessionTokenHash: keyedHash("session", token),
    walletAddress: wallet,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function revokeSession(req: Request) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return;
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.sessionTokenHash, keyedHash("session", token)));
}

export function sessionCookie(token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
