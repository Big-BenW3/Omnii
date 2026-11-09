import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { joinRequests, meetings } from "@/lib/db/schema";
import { ApiError } from "./http";

export const MAX_PARTICIPANTS = 20; // including the host (spec 2.3)
export const MAX_DURATION_SECONDS = 3600;

/**
 * Off-chain lifecycle. Chain-backed transitions (SETUP_PENDING -> WAITING_ROOM,
 * WAITING_ROOM -> LIVE, LIVE -> ENDED) are only made by the chain-sync route
 * after reading verified program state.
 */
export type MeetingStatus =
  | "DRAFT"
  | "SETUP_PENDING"
  | "WAITING_ROOM"
  | "LIVE"
  | "ENDED"
  | "FINALIZED"
  | "CANCELLED"
  | "EXPIRED";

export const JOINABLE: MeetingStatus[] = ["WAITING_ROOM", "LIVE"];

export type Role = "host" | "admitted" | "pending" | "rejected" | "none";

export type MeetingRow = typeof meetings.$inferSelect;
export type JoinRequestRow = typeof joinRequests.$inferSelect;

export async function loadMeeting(meetingId: string): Promise<MeetingRow> {
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) throw new ApiError("NOT_FOUND", "Meeting not found");
  const [m] = await getDb().select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!m) throw new ApiError("NOT_FOUND", "Meeting not found");
  return m;
}

export async function accessFor(meeting: MeetingRow, wallet: string) {
  if (meeting.creatorWallet === wallet) return { role: "host" as Role, request: null };
  const [request] = await getDb()
    .select()
    .from(joinRequests)
    .where(and(eq(joinRequests.meetingId, meeting.id), eq(joinRequests.walletAddress, wallet)))
    .orderBy(desc(joinRequests.requestedAt))
    .limit(1);
  if (!request) return { role: "none" as Role, request: null };
  const role: Role =
    request.status === "ADMITTED"
      ? "admitted"
      : request.status === "PENDING_HOST_APPROVAL"
        ? "pending"
        : request.status === "REJECTED"
          ? "rejected"
          : "none";
  return { role, request };
}

export async function requireHost(meetingId: string, wallet: string) {
  const meeting = await loadMeeting(meetingId);
  if (meeting.creatorWallet !== wallet) throw new ApiError("FORBIDDEN", "Host only");
  return meeting;
}

export async function admittedCount(meetingId: string) {
  const [row] = await getDb()
    .select({ n: count() })
    .from(joinRequests)
    .where(and(eq(joinRequests.meetingId, meetingId), eq(joinRequests.status, "ADMITTED")));
  return Number(row?.n ?? 0);
}

/** True once the 60-minute window from the authoritative start has elapsed. */
export function isExpired(meeting: MeetingRow, now = new Date()) {
  return (
    !!meeting.startedAt &&
    now.getTime() >= meeting.startedAt.getTime() + MAX_DURATION_SECONDS * 1000
  );
}

export function assertJoinable(meeting: MeetingRow) {
  if (!JOINABLE.includes(meeting.lifecycleStatus as MeetingStatus) || isExpired(meeting)) {
    throw new ApiError("MEETING_NOT_JOINABLE", "This meeting is not accepting participants");
  }
}

/** Safe, role-filtered view. Never includes invite hashes or private ballot data. */
export function publicMeetingView(meeting: MeetingRow, role: Role) {
  const base = {
    id: meeting.id,
    status: meeting.lifecycleStatus,
    role,
    maximumDurationSeconds: MAX_DURATION_SECONDS,
    maximumParticipants: MAX_PARTICIPANTS,
  };
  if (role === "none" || role === "rejected" || role === "pending") {
    // Unadmitted wallets learn only that the meeting exists and their status.
    return { ...base, name: role === "pending" ? meeting.name : null };
  }
  return {
    ...base,
    name: meeting.name,
    description: meeting.description,
    scheduledStartAt: meeting.scheduledStartAt.toISOString(),
    startedAt: meeting.startedAt?.toISOString() ?? null,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    hostWallet: meeting.creatorWallet,
    registryAddress: meeting.roomRegistryAddress,
    receiptDigest: meeting.receiptDigest,
    inviteCredentialVersion: role === "host" ? meeting.inviteCredentialVersion : undefined,
  };
}

export const ACTIVE_REQUEST_STATUSES = ["PENDING_HOST_APPROVAL", "ADMITTED"];

export async function activeRequestFor(meetingId: string, wallet: string) {
  const [row] = await getDb()
    .select()
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.meetingId, meetingId),
        eq(joinRequests.walletAddress, wallet),
        inArray(joinRequests.status, ACTIVE_REQUEST_STATUSES)
      )
    )
    .limit(1);
  return row ?? null;
}
