/**
 * Concord program client. One module owns account derivation, instruction
 * building and decoding for both layers (ADR-013), so the web app and the
 * Devnet test suites exercise exactly the same code.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  PERMISSION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import idlJson from "./idl/concord.json";

export const IDL = idlJson as anchor.Idl;
export const PROGRAM_ID = new PublicKey(idlJson.address);

/** Devnet endpoints and identities (verified 2026-11-09, docs/architecture/magicblock-proof.md). */
export const DEVNET = {
  baseRpc: "https://rpc.magicblock.app/devnet",
  routerRpc: "https://devnet-router.magicblock.app",
  teeRpc: "https://devnet-tee-as.magicblock.app",
  teeValidator: new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"),
  /** Base-layer VRF oracle queue (randomness is requested before delegation). */
  vrfQueue: new PublicKey("Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh"),
} as const;

export const KIND_SESSION = 0;
export const KIND_RESULTS = 1;
export const VOTE_NONE = 0;
export const VOTE_OPEN = 1;
export const VOTE_CLOSING = 2;
export const NO_OPTION = 255;
export const NO_VOTE = 255;
export const MAX_DURATION_SECONDS = 3600;
/** Lamports the host puts in the session to sponsor ephemeral voter slots (~8.4k each). */
export const DEFAULT_SPONSOR_BUDGET = 1_000_000;
const SLOT_MAGIC = "CNCSLOT1";

// Anchor needs a provider only for its typing; we never use it to send.
const coderProgram = new anchor.Program(IDL, { connection: null } as unknown as anchor.Provider);
const methods = coderProgram.methods;

// ---------------------------------------------------------------- PDAs

const seed = (s: string) => Buffer.from(s);

export function uuidToNonce(uuid: string): number[] {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error("meeting id must be a UUID");
  return Array.from(Buffer.from(hex, "hex"));
}

export function registryPda(creator: PublicKey, nonce: number[]) {
  return PublicKey.findProgramAddressSync([seed("concord_room"), creator.toBuffer(), Buffer.from(nonce)], PROGRAM_ID)[0];
}
export function sessionPda(registry: PublicKey) {
  return PublicKey.findProgramAddressSync([seed("concord_session"), registry.toBuffer()], PROGRAM_ID)[0];
}
export function resultsPda(registry: PublicKey) {
  return PublicKey.findProgramAddressSync([seed("concord_results"), registry.toBuffer()], PROGRAM_ID)[0];
}
export function slotPda(session: PublicKey, voter: PublicKey) {
  return PublicKey.findProgramAddressSync([seed("concord_slot"), session.toBuffer(), voter.toBuffer()], PROGRAM_ID)[0];
}
export { permissionPdaFromAccount as permissionPda };

export interface RoomKeys {
  creator: PublicKey;
  nonce: number[];
  registry: PublicKey;
  session: PublicKey;
  results: PublicKey;
}

export function roomKeys(creator: PublicKey, meetingId: string): RoomKeys {
  const nonce = uuidToNonce(meetingId);
  const registry = registryPda(creator, nonce);
  return { creator, nonce, registry, session: sessionPda(registry), results: resultsPda(registry) };
}

// ---------------------------------------------------------------- decoding

export interface RoomRegistry {
  creator: PublicKey;
  roomNonce: number[];
  createdAt: anchor.BN;
  vrfOutput: number[];
  vrfFulfilled: boolean;
  startedAt: anchor.BN;
  endedAt: anchor.BN;
  voteCount: number;
  actionItemsHash: number[];
  receiptDigest: number[];
  receiptFinalized: boolean;
  bump: number;
}
export interface ActiveVote {
  voteId: number;
  status: number;
  questionHash: number[];
  optionHashes: number[][];
  openedAt: anchor.BN;
  deadline: anchor.BN;
  closedAt: anchor.BN;
  eligible: PublicKey[];
  eligibilityHash: number[];
}
export interface RoomSession {
  registry: PublicKey;
  host: PublicKey;
  startedAt: anchor.BN;
  endedAt: anchor.BN;
  nextVoteId: number;
  openSlots: number;
  vote: ActiveVote;
  bump: number;
}
export interface PublicVoteSummary {
  voteId: number;
  questionHash: number[];
  optionHashes: number[][];
  counts: number[];
  eligibleCount: number;
  submittedCount: number;
  outcome: number;
  closedAt: anchor.BN;
  eligibilityHash: number[];
  summaryDigest: number[];
}
export interface RoomResults {
  registry: PublicKey;
  summaries: PublicVoteSummary[];
  bump: number;
}

export const decode = {
  registry: (data: Buffer | Uint8Array) => coderProgram.coder.accounts.decode<RoomRegistry>("roomRegistry", Buffer.from(data)),
  session: (data: Buffer | Uint8Array) => coderProgram.coder.accounts.decode<RoomSession>("roomSession", Buffer.from(data)),
  results: (data: Buffer | Uint8Array) => coderProgram.coder.accounts.decode<RoomResults>("roomResults", Buffer.from(data)),
  slot(data: Buffer | Uint8Array) {
    const d = Buffer.from(data);
    if (d.length < 50 || d.subarray(0, 8).toString() !== SLOT_MAGIC) return null;
    return {
      voter: new PublicKey(d.subarray(8, 40)),
      lastVoteId: d[40],
      option: d[41],
      submittedAt: Number(d.readBigInt64LE(42)),
    };
  },
};

export async function fetchDecoded<T>(
  conn: Connection,
  key: PublicKey,
  decoder: (d: Buffer) => T
): Promise<T | null> {
  const info = await conn.getAccountInfo(key, "confirmed");
  if (!info || info.data.length === 0) return null;
  try {
    return decoder(info.data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- instructions

const bn = (n: number | bigint) => new anchor.BN(n.toString());
const meta = (pubkey: PublicKey, isWritable: boolean) => ({ pubkey, isSigner: false, isWritable });

function delegationAccounts(pda: PublicKey) {
  const permission = permissionPdaFromAccount(pda);
  return {
    pda,
    permission,
    bufferPermission: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(permission, PERMISSION_PROGRAM_ID),
    delegationRecordPermission: delegationRecordPdaFromDelegatedAccount(permission),
    delegationMetadataPermission: delegationMetadataPdaFromDelegatedAccount(permission),
  };
}

export const ix = {
  // ----- base layer (host pays) -----
  initializeRoom: (k: RoomKeys): Promise<TransactionInstruction> =>
    methods.initializeRoom(k.nonce).accountsPartial({ creator: k.creator }).instruction(),

  requestRandomness: (k: RoomKeys, queue = DEVNET.vrfQueue) =>
    methods
      .requestRoomRandomness()
      .accountsPartial({ creator: k.creator, registry: k.registry, oracleQueue: queue, slotHashes: SYSVAR_SLOT_HASHES_PUBKEY })
      .instruction(),

  initRoomState: (k: RoomKeys, sponsorBudget = DEFAULT_SPONSOR_BUDGET) =>
    methods.initRoomState(bn(sponsorBudget)).accountsPartial({ host: k.creator, registry: k.registry }).instruction(),

  delegate: (k: RoomKeys, kind: typeof KIND_SESSION | typeof KIND_RESULTS, validator = DEVNET.teeValidator) =>
    methods
      .delegateRoomPda(kind)
      .accountsPartial({
        host: k.creator,
        registry: k.registry,
        validator,
        ...delegationAccounts(kind === KIND_SESSION ? k.session : k.results),
      })
      .instruction(),

  finalizeReceipt: (k: RoomKeys, actionItemsHash: Uint8Array) =>
    methods
      .finalizeReceipt(Array.from(actionItemsHash))
      .accountsPartial({ host: k.creator, registry: k.registry, session: k.session, results: k.results })
      .instruction(),

  closeRoomPda: (k: RoomKeys, kind: typeof KIND_SESSION | typeof KIND_RESULTS) => {
    const pda = kind === KIND_SESSION ? k.session : k.results;
    return methods
      .closeRoomPda(kind)
      .accountsPartial({ host: k.creator, registry: k.registry, pda, permission: permissionPdaFromAccount(pda) })
      .instruction();
  },

  // ----- PER (fee-free; any signer) -----
  addVoterSlots: (k: RoomKeys, voters: PublicKey[]) =>
    methods
      .addVoterSlots(voters)
      .accountsPartial({ host: k.creator, session: k.session })
      .remainingAccounts(
        voters.flatMap((v) => {
          const slot = slotPda(k.session, v);
          return [meta(slot, true), meta(permissionPdaFromAccount(slot), true)];
        })
      )
      .instruction(),

  startMeeting: (k: RoomKeys) => methods.startMeeting().accountsPartial({ host: k.creator, session: k.session }).instruction(),

  openVote: (k: RoomKeys, questionHash: Uint8Array, optionHashes: Uint8Array[], deadlineUnix: number, eligible: PublicKey[]) =>
    methods
      .openVote(Array.from(questionHash), optionHashes.map((o) => Array.from(o)), bn(deadlineUnix))
      .accountsPartial({ host: k.creator, session: k.session })
      .remainingAccounts(eligible.map((v) => meta(slotPda(k.session, v), false)))
      .instruction(),

  castVote: (k: RoomKeys, voter: PublicKey, option: 0 | 1 | 2) =>
    methods.castVote(option).accountsPartial({ voter, session: k.session, slot: slotPda(k.session, voter) }).instruction(),

  closeVote: (k: RoomKeys, signer: PublicKey) =>
    methods.closeVote().accountsPartial({ signer, session: k.session }).instruction(),

  /** `eligibleSorted` must be the frozen snapshot from the session (already sorted). */
  finalizeVote: (k: RoomKeys, signer: PublicKey, eligibleSorted: PublicKey[]) =>
    methods
      .finalizeVote()
      .accountsPartial({ signer, session: k.session, results: k.results })
      .remainingAccounts(eligibleSorted.map((v) => meta(slotPda(k.session, v), true)))
      .instruction(),

  commitResults: (k: RoomKeys, payer: PublicKey) =>
    methods.commitResults().accountsPartial({ payer, results: k.results }).instruction(),

  endMeeting: (k: RoomKeys, signer: PublicKey) =>
    methods.endMeeting().accountsPartial({ signer, session: k.session }).instruction(),

  closeVoterSlots: (k: RoomKeys, signer: PublicKey, voters: PublicKey[]) =>
    methods
      .closeVoterSlots(voters)
      .accountsPartial({ signer, session: k.session })
      .remainingAccounts(
        voters.flatMap((v) => {
          const slot = slotPda(k.session, v);
          return [meta(slot, true), meta(permissionPdaFromAccount(slot), true)];
        })
      )
      .instruction(),

  undelegateRoom: (k: RoomKeys, payer: PublicKey) =>
    methods
      .undelegateRoom()
      .accountsPartial({
        payer,
        session: k.session,
        results: k.results,
        sessionPermission: permissionPdaFromAccount(k.session),
        resultsPermission: permissionPdaFromAccount(k.results),
      })
      .instruction(),
};

/** Voter slots are created/closed in batches small enough for one transaction. */
export const SLOT_BATCH = 4;

export function chunk<T>(items: T[], size = SLOT_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function sortKeys(keys: PublicKey[]) {
  return [...keys].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));
}
