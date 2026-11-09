/**
 * Phase 1 spike runner (Devnet, TEE PER). Throwaway: answers the fee and privacy
 * questions in docs/PRODUCTION_PLAN.md Phase 1, prints a JSON report, and cleans up
 * every account so the host gets rent back.
 *
 * Run: pnpm exec tsx tests/devnet/spike.ts
 * Env: HOST_KEYPAIR (default ~/.config/solana/id.json), BASE_RPC, TEE_RPC, TEE_VALIDATOR
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  DELEGATION_PROGRAM_ID,
  PERMISSION_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  getAuthToken,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const BASE_RPC = process.env.BASE_RPC ?? "https://api.devnet.solana.com";
const TEE_RPC = process.env.TEE_RPC ?? "https://devnet-tee-as.magicblock.app";
const TEE_VALIDATOR = new PublicKey(
  process.env.TEE_VALIDATOR ?? "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
);
const FUND_LAMPORTS = 10_000_000; // 0.01 SOL sponsor budget for ephemeral rent

// Run from the repo root (pnpm test:spike).
const root = process.cwd();
const idl = JSON.parse(readFileSync(path.join(root, "target/idl/spike.json"), "utf8"));
const host = Keypair.fromSecretKey(
  Uint8Array.from(
    JSON.parse(
      readFileSync(
        process.env.HOST_KEYPAIR ?? path.join(homedir(), ".config/solana/id.json"),
        "utf8"
      )
    )
  )
);

const base = new Connection(BASE_RPC, "confirmed");
const report: Record<string, unknown> = { baseRpc: BASE_RPC, teeRpc: TEE_RPC };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const coder = new anchor.Program(idl, new anchor.AnchorProvider(base, new anchor.Wallet(host), {}));
const programId = coder.programId;
const [sponsor] = PublicKey.findProgramAddressSync(
  [Buffer.from("spike_sponsor"), host.publicKey.toBuffer()],
  programId
);
const slotPda = (voter: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("spike_slot"), sponsor.toBuffer(), voter.toBuffer()],
    programId
  )[0];

async function teeConnection(kp: Keypair): Promise<Connection> {
  const { token } = await getAuthToken(TEE_RPC, kp.publicKey, async (msg) =>
    nacl.sign.detached(msg, kp.secretKey)
  );
  return new Connection(`${TEE_RPC}?token=${token}`, "confirmed");
}

/** Retries transient RPC/network failures only; program errors fail immediately. */
async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  feePayer: Keypair,
  signers: Keypair[],
  er: boolean
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await sendOnce(conn, ixs, feePayer, signers, er);
    } catch (e) {
      const msg = (e as Error).message;
      const transient = /fetch failed|ECONNRESET|ETIMEDOUT|429|blockhash not found|block height exceeded/i.test(msg);
      if (!transient || attempt >= 5) throw e;
      await sleep(2_000 * attempt);
    }
  }
}

async function sendOnce(
  conn: Connection,
  ixs: TransactionInstruction[],
  feePayer: Keypair,
  signers: Keypair[],
  er: boolean
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const uniq = [feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey))];
  tx.sign(...uniq);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: er });
  const res = await conn.confirmTransaction(sig, "confirmed");
  if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
  return sig;
}

async function attempt<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    report[label] = { ok: true, result: out instanceof Connection ? "connection" : out };
    console.log(`ok   ${label}`);
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    report[label] = { ok: false, error: msg.slice(0, 600) };
    console.log(`FAIL ${label}: ${msg.slice(0, 300)}`);
    return undefined;
  }
}

async function waitOwner(conn: Connection, key: PublicKey, owner: PublicKey, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const info = await conn.getAccountInfo(key);
    if (info && info.owner.equals(owner)) return true;
    await sleep(2_000);
  }
  throw new Error(`timeout waiting for ${key.toBase58()} owner ${owner.toBase58()}`);
}

async function main() {
  const startBalance = await base.getBalance(host.publicKey);
  report.hostStartLamports = startBalance;
  const voterA = Keypair.generate();
  const voterB = Keypair.generate();
  report.voters = { A: voterA.publicKey.toBase58(), B: voterB.publicKey.toBase58() };

  // ---- Base layer: init + delegate sponsor ----
  if (!(await base.getAccountInfo(sponsor))) {
    await attempt("base.init_sponsor", async () =>
      send(
        base,
        [
          await coder.methods
            .initSponsor(new anchor.BN(FUND_LAMPORTS))
            .accountsPartial({ authority: host.publicKey })
            .instruction(),
        ],
        host,
        [],
        false
      )
    );
  }
  const permission = permissionPdaFromAccount(sponsor);
  await attempt("base.delegate_sponsor", async () =>
    send(
      base,
      [
        await coder.methods
          .delegateSponsor()
          .accountsPartial({
            authority: host.publicKey,
            sponsor,
            permission,
            bufferPermission: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
              permission,
              PERMISSION_PROGRAM_ID
            ),
            delegationRecordPermission: delegationRecordPdaFromDelegatedAccount(permission),
            delegationMetadataPermission: delegationMetadataPdaFromDelegatedAccount(permission),
            validator: TEE_VALIDATOR,
          })
          .instruction(),
      ],
      host,
      [],
      false
    )
  );
  await attempt("base.sponsor_owned_by_delegation", () =>
    waitOwner(base, sponsor, DELEGATION_PROGRAM_ID)
  );
  report.hostAfterSetupLamports = await base.getBalance(host.publicKey);

  // ---- PER: host creates two ephemeral slots ----
  const teeHost = await attempt("tee.auth_host", () => teeConnection(host));
  if (!teeHost) return;
  await attempt("tee.sponsor_visible", async () => {
    for (let i = 0; i < 30; i++) {
      const info = await teeHost.getAccountInfo(sponsor);
      if (info) return { owner: info.owner.toBase58(), lamports: info.lamports };
      await sleep(2_000);
    }
    throw new Error("sponsor not visible on TEE");
  });
  for (const [label, voter] of [
    ["A", voterA],
    ["B", voterB],
  ] as const) {
    await attempt(`tee.create_slot_${label}`, async () =>
      send(
        teeHost,
        [
          await coder.methods
            .createSlot(voter.publicKey)
            .accountsPartial({ authority: host.publicKey, sponsor, slot: slotPda(voter.publicKey) })
            .instruction(),
        ],
        host,
        [],
        true
      )
    );
  }

  // ---- PER: voter A casts with ZERO SOL as fee payer ----
  const teeA = await attempt("tee.auth_voterA_zero_sol", () => teeConnection(voterA));
  const teeB = await attempt("tee.auth_voterB_zero_sol", () => teeConnection(voterB));
  const castIx = async (voter: Keypair, option: number) =>
    coder.methods
      .cast(option)
      .accountsPartial({ voter: voter.publicKey, slot: slotPda(voter.publicKey) })
      .instruction();
  if (teeA) {
    const ok = await attempt("tee.cast_A_voter_pays_zero_sol", async () =>
      send(teeA, [await castIx(voterA, 1)], voterA, [], true)
    );
    if (!ok) {
      await attempt("tee.cast_A_host_pays_fallback", async () =>
        send(teeHost, [await castIx(voterA, 1)], host, [voterA], true)
      );
    }
  }

  // ---- Read isolation ----
  const readSlot = async (conn: Connection | undefined, who: string) => {
    if (!conn) return `${who}: no connection`;
    const info = await conn.getAccountInfo(slotPda(voterA.publicKey));
    return info ? { visible: true, option: info.data[40], len: info.data.length } : { visible: false };
  };
  await attempt("read.slotA_by_voterA", () => readSlot(teeA, "A"));
  await attempt("read.slotA_by_voterB", () => readSlot(teeB, "B"));
  await attempt("read.slotA_by_host", () => readSlot(teeHost, "host"));
  await attempt("read.slotA_no_token", () => readSlot(new Connection(TEE_RPC, "confirmed"), "anon"));
  await attempt("read.slotA_on_base", async () => {
    const info = await base.getAccountInfo(slotPda(voterA.publicKey));
    return info ? { visible: true, len: info.data.length } : { visible: false };
  });
  if (teeB) {
    await attempt("tee.cast_B_into_A_slot_rejected", async () => {
      try {
        await send(
          teeB,
          [
            await coder.methods
              .cast(2)
              .accountsPartial({ voter: voterB.publicKey, slot: slotPda(voterA.publicKey) })
              .instruction(),
          ],
          voterB,
          [],
          true
        );
        return "NOT REJECTED (bad)";
      } catch (e) {
        return `rejected: ${(e as Error).message.slice(0, 160)}`;
      }
    });
  }
  report.voterBalances = {
    A_base: await base.getBalance(voterA.publicKey),
    B_base: await base.getBalance(voterB.publicKey),
    A_tee: teeA ? await teeA.getBalance(voterA.publicKey) : null,
  };
  report.sponsorTeeLamportsAfterSlots = (await teeHost.getAccountInfo(sponsor))?.lamports;

  // ---- Cleanup: close slots, undelegate sponsor, close sponsor ----
  for (const voter of [voterA, voterB]) {
    await attempt(`tee.close_slot_${voter.publicKey.toBase58().slice(0, 4)}`, async () =>
      send(
        teeHost,
        [
          await coder.methods
            .closeSlot(voter.publicKey)
            .accountsPartial({ authority: host.publicKey, sponsor, slot: slotPda(voter.publicKey) })
            .instruction(),
        ],
        host,
        [],
        true
      )
    );
  }
  report.sponsorTeeLamportsAfterClose = (await teeHost.getAccountInfo(sponsor))?.lamports;
  await attempt("tee.undelegate_sponsor", async () =>
    send(
      teeHost,
      [
        await coder.methods
          .undelegateSponsor()
          .accountsPartial({ authority: host.publicKey, sponsor, permission })
          .instruction(),
      ],
      host,
      [],
      true
    )
  );
  await attempt("base.sponsor_returned_to_program", () => waitOwner(base, sponsor, programId, 90_000));
  await attempt("base.close_sponsor", async () =>
    send(
      base,
      [await coder.methods.closeSponsor().accountsPartial({ authority: host.publicKey, sponsor }).instruction()],
      host,
      [],
      false
    )
  );
  const endBalance = await base.getBalance(host.publicKey);
  report.hostEndLamports = endBalance;
  report.hostNetCostLamports = startBalance - endBalance;
  report.hostNetCostSol = (startBalance - endBalance) / LAMPORTS_PER_SOL;
}

main()
  .catch((e) => {
    report.fatal = e instanceof Error ? e.message : String(e);
  })
  .finally(() => {
    console.log("\n===== SPIKE REPORT =====");
    console.log(JSON.stringify(report, null, 2));
  });
