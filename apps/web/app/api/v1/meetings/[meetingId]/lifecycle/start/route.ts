import { NextResponse } from "next/server";
import { z } from "zod";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, roomKeys } from "@concord/client";
import { requireSession } from "@/lib/server/auth";
import { chain } from "@/lib/server/chain";
import { ApiError, handler, parseJson } from "@/lib/server/http";
import { transition } from "@/lib/server/lifecycle";
import { publicMeetingView, requireHost } from "@/lib/server/meetings";
import { hit, RULES } from "@/lib/server/rate-limit";

type Ctx = { params: Promise<{ meetingId: string }> };

const Body = z.object({
  signature: z.string().refine((s) => {
    try {
      return bs58.decode(s).length === 64;
    } catch {
      return false;
    }
  }, "must be a base58 transaction signature"),
});

/**
 * WAITING_ROOM -> LIVE, host only. The host submits the signature of their
 * confirmed PER `start_meeting` transaction.
 *
 * Trust assumption: RoomSession lives on the PER while delegated and the
 * server holds no PER auth token, so it cannot read the session's started_at.
 * It fetches the transaction from the PER RPC; if the PER returns it, the tx
 * must have succeeded, be signed by the host, touch this room's session and
 * call the Concord program, or the start is refused. If the PER does not
 * return it (access-controlled or not indexed), the host's report is accepted.
 * This only gates media (LiveKit tokens); vote acceptance and the 60-minute
 * window are enforced by the program clock independently. DB startedAt = now,
 * which can only be later than the on-chain start, so the media window never
 * outlasts the on-chain one.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const { wallet } = await requireSession(req);
  await hit(`chain:${wallet}`, RULES.chainRead);
  const { meetingId } = await ctx.params;
  const meeting = await requireHost(meetingId, wallet);
  const { signature } = await parseJson(req, Body);

  if (meeting.lifecycleStatus === "LIVE") return NextResponse.json(publicMeetingView(meeting, "host"));
  if (meeting.lifecycleStatus !== "WAITING_ROOM") {
    throw new ApiError("CONFLICT", "The meeting can only start from the waiting room");
  }

  const keys = roomKeys(new PublicKey(meeting.creatorWallet), meeting.id);
  const tx = await chain().perTransaction(signature);
  if (tx) {
    const ok =
      !tx.failed &&
      tx.signers.includes(wallet) &&
      tx.accountKeys.includes(keys.session.toBase58()) &&
      tx.accountKeys.includes(PROGRAM_ID.toBase58()) &&
      (tx.logs === null || tx.logs.some((l) => l.includes("Instruction: StartMeeting")));
    if (!ok) throw new ApiError("CONFLICT", "That transaction did not start this meeting");
  }

  const updated = await transition(meeting, ["WAITING_ROOM"], "LIVE", { startedAt: new Date() });
  return NextResponse.json(publicMeetingView(updated, "host"));
});
