import { NextResponse } from "next/server";
import { getSession } from "@/lib/server/auth";
import { handler } from "@/lib/server/http";

export const GET = handler(async (req: Request) => {
  const session = await getSession(req);
  return NextResponse.json(
    session
      ? { isAuthenticated: true, user: { walletAddress: session.wallet } }
      : { isAuthenticated: false, user: null }
  );
});
