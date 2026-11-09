"use client";

import useSWR from "swr";
import { PublicKey } from "@solana/web3.js";
import { roomKeys, type RoomKeys } from "@concord/client";
import { api } from "./api";

export interface MeetingView {
  id: string;
  status: string;
  role: "host" | "admitted" | "pending" | "rejected" | "none";
  name: string | null;
  description?: string | null;
  scheduledStartAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  hostWallet?: string;
  registryAddress?: string | null;
  receiptDigest?: string | null;
  maximumDurationSeconds: number;
  maximumParticipants: number;
  joinRequest: { id: string; status: string; displayName: string; isVoter: boolean } | null;
}

export function useMeeting(meetingId: string, refreshMs = 4_000) {
  const { data, error, mutate } = useSWR<MeetingView>(meetingId ? `/meetings/${meetingId}` : null, (p: string) => api(p), {
    refreshInterval: refreshMs,
  });
  const keys: RoomKeys | null = data?.hostWallet ? roomKeys(new PublicKey(data.hostWallet), data.id) : null;
  return { meeting: data, error, mutate, keys };
}

export interface Participant {
  role: "host" | "participant";
  displayName: string;
  identity: string;
  isVoter?: boolean;
  walletAddress?: string;
  joinRequestId?: string;
}

export function useParticipants(meetingId: string, enabled: boolean) {
  return useSWR<{ participants: Participant[] }>(enabled ? `/meetings/${meetingId}/participants` : null, (p: string) => api(p), {
    refreshInterval: 4_000,
  });
}

export interface VoteRound {
  voteId: number;
  question: string;
  options: [string, string, string];
  deadline: string;
  questionHash: string;
  optionHashes: [string, string, string];
}

export function useVoteRounds(meetingId: string, enabled: boolean) {
  return useSWR<{ rounds: VoteRound[] }>(enabled ? `/meetings/${meetingId}/vote-rounds` : null, (p: string) => api(p), {
    refreshInterval: 3_000,
  });
}

export const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
export const bytesToHex = (b: Iterable<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
