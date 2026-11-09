import "server-only";
import { AccessToken, RoomServiceClient, TrackSource, WebhookReceiver } from "livekit-server-sdk";
import { serverEnv } from "./env";
import { keyedHash } from "./crypto";
import { MAX_PARTICIPANTS } from "./meetings";

export const TOKEN_TTL_SECONDS = 10 * 60;

/** LiveKit HTTP API base (wss:// -> https://, ws:// -> http://). */
function apiHost() {
  return serverEnv().LIVEKIT_URL.replace(/^ws(s?):\/\//, "http$1://");
}

export function roomService() {
  const env = serverEnv();
  return new RoomServiceClient(apiHost(), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

export function webhookReceiver() {
  const env = serverEnv();
  return new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

/** Stable, opaque per-meeting identity. Never the wallet address (spec 13.4). */
export function participantIdentity(meetingId: string, wallet: string) {
  return `p_${keyedHash("identity", `${meetingId}:${wallet}`).slice(0, 32)}`;
}

/** Number of participants currently connected to the LiveKit room (0 if the room does not exist). */
export async function connectedCount(roomName: string, excludeIdentity?: string) {
  try {
    const participants = await roomService().listParticipants(roomName);
    return participants.filter((p) => p.identity !== excludeIdentity).length;
  } catch {
    return 0;
  }
}

export async function ensureRoom(roomName: string) {
  try {
    await roomService().createRoom({
      name: roomName,
      maxParticipants: MAX_PARTICIPANTS,
      emptyTimeout: 5 * 60,
    });
  } catch {
    // Already exists.
  }
}

export async function closeRoom(roomName: string) {
  try {
    await roomService().deleteRoom(roomName);
  } catch {
    // Already gone.
  }
}

export async function mintToken(params: {
  roomName: string;
  identity: string;
  displayName: string;
  isHost: boolean;
}) {
  const env = serverEnv();
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: params.identity,
    name: params.displayName,
    ttl: TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    roomJoin: true,
    room: params.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    // V1: camera and microphone only. No screen share (spec 2.2).
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
    canUpdateOwnMetadata: false,
    roomAdmin: params.isHost,
  });
  return at.toJwt();
}
