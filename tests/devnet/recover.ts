/**
 * Finishes teardown of an ended test meeting so the host gets rent back:
 * undelegate (if delegated) -> finalize receipt (if needed) -> close session/results.
 * Usage: pnpm exec tsx tests/devnet/recover.ts <meetingId>
 */
import { createHash } from "node:crypto";
import {
  KIND_RESULTS,
  KIND_SESSION,
  PROGRAM_ID,
  decode,
  fetchDecoded,
  ix,
  roomKeys,
} from "../../packages/concord-client/src/index.ts";
import { DELEGATION_PROGRAM, base, loadHost, send, teeFor, waitFor } from "./lib.ts";

async function main() {
  const host = loadHost();
  const k = roomKeys(host.publicKey, process.argv[2]);
  const before = await base.getBalance(host.publicKey);
  const sess = await base.getAccountInfo(k.session);
  if (sess?.owner.equals(DELEGATION_PROGRAM)) {
    const tee = await teeFor(host);
    const s = await fetchDecoded(tee, k.session, decode.session);
    if (s && s.endedAt.isZero()) throw new Error("meeting not ended; end it and close slots first");
    await send(tee, [await ix.undelegateRoom(k, host.publicKey)], host, [], true);
    await waitFor("undelegation", async () => (await base.getAccountInfo(k.session))?.owner.equals(PROGRAM_ID), 180_000);
    console.log("undelegated");
  }
  const reg = await fetchDecoded(base, k.registry, decode.registry);
  if (reg && !reg.receiptFinalized) {
    await send(base, [await ix.finalizeReceipt(k, createHash("sha256").update("recovered").digest())], host);
    console.log("receipt finalized");
  }
  if (await base.getAccountInfo(k.session)) {
    await send(base, [await ix.closeRoomPda(k, KIND_SESSION), await ix.closeRoomPda(k, KIND_RESULTS)], host);
    console.log("closed session + results");
  }
  console.log(`reclaimed ${(await base.getBalance(host.publicKey)) - before} lamports`);
}
main().catch((e) => {
  console.error(e.message, e.logs ?? "");
  process.exit(1);
});
