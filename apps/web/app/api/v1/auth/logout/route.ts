import { NextResponse } from "next/server";
import { clearedSessionCookie, revokeSession } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";

export const POST = handler(async (req: Request) => {
  await revokeSession(req);
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearedSessionCookie());
  return res;
});
