# MagicBlock Proof Log

Measured results from Devnet. Every claim here comes from a recorded run, not from documentation.

## Phase 1 spike (2026-11-09): fee model, ephemeral voter slots, read isolation

**Environment**
- **Base RPC:** `https://rpc.magicblock.app/devnet`. The public `api.devnet.solana.com` was unreliable for deploys and transactions in this session.
- **TEE PER:** `https://devnet-tee-as.magicblock.app`. Validator identity `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, `magicblock-core 1.1.1`. Live per `status.magicblock.app/api/services` (`tee` region).
- **Router:** `https://devnet-router.magicblock.app`.
- **SDKs:** `ephemeral-rollups-sdk` 0.17.3 (Rust, features `anchor`, `access-control`), `@magicblock-labs/ephemeral-rollups-sdk` 0.17.3 (TS), anchor-lang 1.1.2, `@coral-xyz/anchor` 0.32.1. The TS client loaded the anchor-lang 1.1.2 IDL without changes, which resolves the ADR-013 risk.
- **Program:** throwaway `programs/spike` (`4tAykumoiLGeUHcMyXRPt8ihWYYTDwioBy5fNr1mXnLj`), closed after the run.
- **Runner:** `pnpm test:spike` (`tests/devnet/spike.ts`), with `BASE_RPC=https://rpc.magicblock.app/devnet`.

**Flow tested**
1. Base layer: the host creates a sponsor PDA funded with 0.01 SOL. It creates a permission (member: host), delegates the permission, and delegates the sponsor to the TEE validator.
2. PER: the host creates two **ephemeral** voter slots (`EphemeralAccount::create`), sponsored by the delegated PDA. Each has an **ephemeral permission** whose only member is its voter.
3. PER: voter A, a fresh keypair with **0 lamports**, is fee payer and signer for `cast(1)`.
4. Reads of slot A by A, B, the host, an unauthenticated caller and the base layer.
5. Voter B tries to write into A's slot.
6. Cleanup: close the slots and permissions (refunded to the sponsor), commit and undelegate the sponsor, close the sponsor on the base layer.

**Results (run 3, all steps passed)**

| Check | Result |
|---|---|
| Zero-SOL voter signs and pays a PER transaction | **Pass.** Voter A's balance is 0 on base and TEE after casting. |
| Slot A readable by voter A | Visible, `option = 1` |
| Slot A readable by voter B / host / no token | **Not visible** |
| Slot A on the base layer | **Does not exist**; ephemeral accounts are never committed |
| B writes into A's slot | Rejected by the program (custom error 6002, `NotSlotOwner`) |
| Ephemeral rent for 2 slots + 2 permissions | 16,768 lamports (about 8,384 per voter) |
| Rent refunded on close | Yes; the sponsor returned to 10,899,160 lamports |
| Host cost for setup (incl. 0.01 SOL sponsor budget) | 17,270,600 lamports |
| **Host net cost after full cleanup** | **6,015,000 lamports (0.006 SOL)** |

The net cost is mostly base-layer rent for the sponsor's permission account plus signature fees; the spike never closes that permission. The production program closes it with `ClosePermission`.

**Run 2 note:** a dropped RPC request (`fetch failed`) during `delegate_sponsor` left the sponsor undelegated, and every PER step then failed with `InvalidWritableAccount` or `ReadonlyDataModified`. Production clients must confirm delegation (router `getDelegationStatus`) before sending PER transactions, and must retry transient RPC errors.

**Consequences for the design (ADR-011, ADR-012)**
- **Primary fee model confirmed.** Voters need no SOL; the session-key fallback is not needed.
- **Voter slots become ephemeral accounts** in PER, sponsored by a host-funded delegated PDA, instead of base-layer PDAs delegated per voter. They cost about 109× less rent, need no host base-layer transaction per voter, and cannot leak to the base layer, so the reset-before-commit rule now only applies to the room session.
- **Host-only by design.** The host cannot read ballots through the RPC. The program reads them inside the transaction at finalize; Gate D must confirm this in Phase 3.

## Phase 3 gate run (2026-11-09): real program, 20 voters, Devnet TEE PER

Command: `pnpm test:devnet` (`tests/devnet/gates.ts`), report in
`tests/devnet/out/gates-report.json`. **Result: 64/64 steps passed.** Costs are in
`cost-report.md`.

| Gate | Evidence |
|---|---|
| A: routing and delegation | Base: init, VRF and setup; session and results owned by the delegation program on base and visible on the TEE. PER: slots, start, vote. Commit plus undelegate returned both accounts to the program on base. |
| B: VRF | The real oracle fulfilled the callback. A forged `store_room_randomness` signed by the host was rejected (`vrf_program_identity` constraint). A second request was rejected (`RandomnessAlreadyFulfilled`). |
| C: ballot isolation | 17 voters cast with **0 SOL** and stayed at 0. Duplicates were rejected (`AlreadyVoted`) and the observer was rejected (`NotEligible`). A voter reads only their own slot. Another voter, the observer, the host, an anonymous caller and the base layer all **cannot read** it. |
| D: tally | Omitted and reordered slot sets were rejected (`SlotSetMismatch`). A 0-SOL voter finalized 19 slots in one transaction and committed. The base-layer aggregate is exactly `[4, 7, 6]`, 17 of 19 submitted. Ballots reset to 255 after the tally, and the session roster was cleared. |
| E: no premature result | While the vote was open, the observer, the voter and anonymous callers could not read the session; base results held 0 summaries. The committed results and the committed session contain **no wallet bytes**. |
| F: receipt | The digest computed on-chain matches `@concord/receipt-hash` recomputed from public base-layer data. A tampered field changes the digest. The receipt is write-once (`ReceiptAlreadyFinalized`). |

**Bugs the Devnet gates caught and fixed**
1. `undelegate_room` with the PDA as permission authority failed (`MissingAccount`):
   the Magic program needs a signing member as the commit authority. It is now
   host-only. Ending and finalizing stay permissionless.
2. **Roster leak (Gate E):** after `finalize_vote` shortened the eligible list,
   Anchor left stale wallet bytes in the session's tail, and they were committed to
   the base layer on undelegation. `undelegate_room` now zeroes everything past the
   live struct before committing. Gate E asserts no wallet bytes in either
   committed account.

**Operational notes**
- Prefer IPv4 in Node on WSL2 (`dns.setDefaultResultOrder("ipv4first")`). Without
  it, intermittent `fetch failed` errors broke RPC calls.
- Confirm delegation before sending PER transactions.
- `tests/devnet/recover.ts <meetingId>` finishes the teardown of an aborted run so
  the host's rent is reclaimed.
