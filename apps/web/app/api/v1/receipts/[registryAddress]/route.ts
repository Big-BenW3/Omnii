import { NextResponse } from "next/server";
import { clientIp, handler } from "@/lib/server/http";
import { hit, RULES } from "@/lib/server/rate-limit";
import { publicReceipt } from "@/lib/server/receipts";

type Ctx = { params: Promise<{ registryAddress: string }> };

/** Public, unauthenticated receipt built from finalized on-chain state (spec 10.6). */
export const GET = handler(async (req: Request, ctx: Ctx) => {
  await hit(`receipt:${clientIp(req)}`, RULES.publicReceipt);
  const { registryAddress } = await ctx.params;
  const receipt = await publicReceipt(registryAddress);
  return NextResponse.json(receipt, { headers: { "Cache-Control": "public, max-age=60" } });
});
