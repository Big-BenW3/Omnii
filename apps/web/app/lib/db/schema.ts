import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  primaryKey,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Backend metadata only. The database is NOT the voting ledger:
 * there is intentionally no votes or ballots table. Ballots and private
 * tally state live in the permissioned private program state (PER).
 * The backend may cache validated public finalized summaries, but the
 * verified program account remains authoritative.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastAuthenticatedAt: timestamp("last_authenticated_at", {
    withTimezone: true,
  }),
});

export const authNonces = pgTable("auth_nonces", {
  id: uuid("id").primaryKey().defaultRandom(),
  walletAddress: text("wallet_address").notNull(),
  nonceHash: text("nonce_hash").notNull(),
  messageHash: text("message_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Session metadata only. The raw session token lives solely in the
 * HttpOnly cookie; the database stores its keyed hash (spec 10.x:
 * rotate session IDs after authentication, invalidate on logout).
 */
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionTokenHash: text("session_token_hash").unique().notNull(),
  walletAddress: text("wallet_address").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

export type MeetingLifecycleStatus =
  | "DRAFT"
  | "VRF_PENDING"
  | "PRIVATE_STATE_SETUP"
  | "SCHEDULED"
  | "WAITING_ROOM"
  | "LIVE"
  | "FINALIZING"
  | "RECEIPT_PENDING"
  | "FINALIZED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: text("room_id").unique(),
    creatorWallet: text("creator_wallet").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    scheduledStartAt: timestamp("scheduled_start_at", {
      withTimezone: true,
    }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    maximumDurationSeconds: integer("maximum_duration_seconds")
      .default(3600)
      .notNull(),
    maximumParticipants: integer("maximum_participants").default(20).notNull(),
    lifecycleStatus: text("lifecycle_status").default("DRAFT").notNull(),
    // Keyed hashes only. Raw invite secrets are never stored.
    inviteSecretHash: text("invite_secret_hash"),
    inviteCodeHash: text("invite_code_hash"),
    // Bumped on every host rotation; only the current version is valid.
    inviteCredentialVersion: integer("invite_credential_version")
      .default(1)
      .notNull(),
    livekitRoomName: text("livekit_room_name"),
    vrfRequestReference: text("vrf_request_reference"),
    roomRegistryAddress: text("room_registry_address"),
    receiptAddress: text("receipt_address"),
    receiptDigest: text("receipt_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // One meeting per on-chain room; the public receipt route looks meetings up by it.
    uniqueIndex("meetings_room_registry_address_unique").on(
      t.roomRegistryAddress
    ),
  ]
);

export type JoinRequestStatus =
  "PENDING_HOST_APPROVAL" | "ADMITTED" | "REJECTED" | "LEFT" | "EXPIRED";

export const joinRequests = pgTable(
  "join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .references(() => meetings.id)
      .notNull(),
    walletAddress: text("wallet_address").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").default("PENDING_HOST_APPROVAL").notNull(),
    // Host's voter/observer preference. UI convenience only: the frozen on-chain
    // eligibility snapshot taken at open_vote is authoritative.
    isVoter: boolean("is_voter").default(false).notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByWallet: text("decided_by_wallet"),
  },
  (t) => [
    // Spec 11.4: one active (pending or admitted) request per (meeting_id, wallet_address).
    uniqueIndex("join_requests_active_wallet_unique")
      .on(t.meetingId, t.walletAddress)
      .where(sql`${t.status} in ('PENDING_HOST_APPROVAL', 'ADMITTED')`),
  ]
);

/**
 * Display labels for each vote round. Labels are bound on-chain by hash; the
 * DB only stores the text so the UI and public receipt can show it.
 * This table never holds ballots, choices, or tallies (spec 11.7).
 */
export const voteRounds = pgTable(
  "vote_rounds",
  {
    meetingId: uuid("meeting_id")
      .references(() => meetings.id)
      .notNull(),
    voteId: integer("vote_id").notNull(),
    question: text("question").notNull(),
    options: jsonb("options").$type<[string, string, string]>().notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.voteId] })]
);

/** Fixed-window rate limiting / lockout counters (keyed, no PII beyond the key). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStartedAt: timestamp("window_started_at", {
    withTimezone: true,
  }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

/**
 * Audit trail for host invitation rotations (spec: POST
 * /meetings/:meetingId/invitation/rotate). Only versions and keyed
 * metadata are stored, never the secret itself.
 */
export const inviteCredentialRotations = pgTable(
  "invite_credential_rotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .references(() => meetings.id)
      .notNull(),
    previousVersion: integer("previous_version").notNull(),
    newVersion: integer("new_version").notNull(),
    rotatedByWallet: text("rotated_by_wallet").notNull(),
    rotatedAt: timestamp("rotated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("invite_credential_rotations_version_unique").on(
      t.meetingId,
      t.newVersion
    ),
  ]
);

/**
 * Webhook idempotency ledger (spec: treat webhook delivery as retryable
 * and idempotent). External event IDs are deduplicated before side
 * effects such as LiveKit room teardown run.
 */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    status: text("status").default("RECEIVED").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    unique("webhook_events_provider_event_unique").on(
      t.provider,
      t.externalEventId
    ),
  ]
);

export const liveMediaSessions = pgTable("live_media_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id")
    .references(() => meetings.id)
    .notNull(),
  walletAddress: text("wallet_address").notNull(),
  livekitParticipantIdentity: text("livekit_participant_identity")
    .unique()
    .notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
});

export const receiptDrafts = pgTable(
  "receipt_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id")
      .references(() => meetings.id)
      .notNull(),
    actionItemsJson: jsonb("action_items_json"),
    actionItemsHash: text("action_items_hash"),
    publicPayloadJson: jsonb("public_payload_json"),
    receiptDigest: text("receipt_digest"),
    createdByWallet: text("created_by_wallet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [uniqueIndex("receipt_drafts_meeting_unique").on(t.meetingId)]
);
