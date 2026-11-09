import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { serverEnv } from "./env";

/**
 * Domain-separated keyed hash. Every use passes its own `domain` so one secret
 * never produces interchangeable hashes across purposes (sessions, nonces, invites).
 */
export function keyedHash(domain: "session" | "nonce" | "message" | "invite" | "identity", value: string) {
  const env = serverEnv();
  const secret = domain === "invite" ? env.INVITE_HASH_SECRET : env.SESSION_SECRET;
  return createHmac("sha256", secret).update(`concord:${domain}:`).update(value).digest("hex");
}

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison of two hex strings. */
export function safeEqualHex(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 8-character join code from a CSPRNG (~40 bits; brute force is rate-limited). */
export function randomJoinCode(length = 8) {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export function normalizeJoinCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
