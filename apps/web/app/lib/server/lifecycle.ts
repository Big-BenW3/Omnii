import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { PublicKey } from "@solana/web3.js";
import { roomKeys } from "@concord/client";
import { getDb } from "@/lib/db/client";
import { meetings } from "@/lib/db/schema";
import { isDelegated, readRegistry, toHexBytes } from "./chain";
import { closeRoom } from "./livekit";
import { isExpired, loadMeeting, type MeetingRow, type MeetingStatus } from "./meetings";

type MeetingPatch = PgUpdateSetSource<typeof meetings>;

/** Invitations stop working once a meeting can no longer be joined. */
export const INVALIDATE_INVITES = { inviteSecretHash: null, inviteCodeHash: null } satisfies MeetingPatch;

/**
 * Compare-and-set status change. Only applies if the row is still in one of
 * `from`, so concurrent callers cannot double-apply or regress a transition.
 * Returns the current row either way.
 */
export async function transition(
  meeting: MeetingRow,
  from: MeetingStatus[],
  to: MeetingStatus,
  patch: MeetingPatch = {}
): Promise<MeetingRow> {
  const [updated] = await getDb()
    .update(meetings)
    .set({ ...patch, lifecycleStatus: to, updatedAt: new Date() })
    .where(and(eq(meetings.id, meeting.id), inArray(meetings.lifecycleStatus, from)))
    .returning();
  return updated ?? (await loadMeeting(meeting.id));
}

const unixToDate = (n: { toNumber(): number }) => {
  const s = n.toNumber();
  return s > 0 ? new Date(s * 1000) : null;
};

const RECEIPT_FROM: MeetingStatus[] = ["SETUP_PENDING", "WAITING_ROOM", "LIVE", "ENDED", "EXPIRED"];

/**
 * Derives chain-backed transitions from verified base-layer state only:
 *  DRAFT -> SETUP_PENDING      RoomRegistry exists for (creator, meeting id)
 *  SETUP_PENDING -> WAITING_ROOM  VRF fulfilled and session + results delegated
 *  * -> FINALIZED              registry.receiptFinalized (program checked end + digests)
 *  LIVE -> EXPIRED             60 minutes since start (same rule as the cron job)
 * Client input is never consulted.
 */
export async function syncFromChain(meeting: MeetingRow): Promise<MeetingRow> {
  let m = meeting;
  const status = () => m.lifecycleStatus as MeetingStatus;

  if (status() === "LIVE" && isExpired(m)) {
    m = await transition(m, ["LIVE"], "EXPIRED", {
      endedAt: sql`coalesce(${meetings.endedAt}, now())`,
      ...INVALIDATE_INVITES,
    });
    if (m.livekitRoomName) await closeRoom(m.livekitRoomName);
  }
  if (!["DRAFT", ...RECEIPT_FROM].includes(status())) return m;

  const keys = roomKeys(new PublicKey(m.creatorWallet), m.id);
  const registry = await readRegistry(keys.registry);
  if (!registry || !registry.creator.equals(keys.creator)) return m;
  if (toHexBytes(registry.roomNonce) !== m.id.replace(/-/g, "").toLowerCase()) return m;

  if (status() === "DRAFT") {
    m = await transition(m, ["DRAFT"], "SETUP_PENDING", { roomRegistryAddress: keys.registry.toBase58() });
  }

  if (registry.receiptFinalized && RECEIPT_FROM.includes(status())) {
    return transition(m, RECEIPT_FROM, "FINALIZED", {
      roomRegistryAddress: keys.registry.toBase58(),
      receiptDigest: toHexBytes(registry.receiptDigest),
      startedAt: m.startedAt ?? unixToDate(registry.startedAt),
      endedAt: unixToDate(registry.endedAt) ?? m.endedAt ?? new Date(),
      ...INVALIDATE_INVITES,
    });
  }

  if (status() === "SETUP_PENDING" && registry.vrfFulfilled) {
    const [session, results] = await Promise.all([isDelegated(keys.session), isDelegated(keys.results)]);
    if (session && results) m = await transition(m, ["SETUP_PENDING"], "WAITING_ROOM");
  }
  return m;
}
