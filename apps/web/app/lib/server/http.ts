import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";

export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "CAPACITY_FULL"
  | "MEETING_NOT_JOINABLE"
  | "NOT_YET_COMMITTED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CAPACITY_FULL: 409,
  MEETING_NOT_JOINABLE: 409,
  NOT_YET_COMMITTED: 404,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: STATUS[err.code] }
    );
  }
  // Never echo internals; log a redacted message only.
  console.error("api error:", redact(err instanceof Error ? err.message : String(err)));
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong" } },
    { status: 500 }
  );
}

const MAX_BODY_BYTES = 32 * 1024;

/** Parse + validate a JSON body. Rejects non-JSON, oversized, or invalid payloads. */
export async function parseJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new ApiError("INVALID_REQUEST", "Content-Type must be application/json");
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new ApiError("INVALID_REQUEST", "Payload too large");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError("INVALID_REQUEST", "Malformed JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      "INVALID_REQUEST",
      "Invalid request body",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    );
  }
  return result.data;
}

/** Wrap a route handler so thrown ApiErrors become JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs (LiveKit tokens)
  /postgres(ql)?:\/\/\S+/g,
  /[A-Za-z0-9_-]{43,}/g, // long base64url secrets / signatures
];

export function redact(message: string) {
  return SECRET_PATTERNS.reduce((m, p) => m.replace(p, "[redacted]"), message);
}

export function clientIp(req: Request) {
  // Platform-set headers only (Vercel sets x-real-ip; x-forwarded-for's first hop as fallback).
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
