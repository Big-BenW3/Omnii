# Architecture Decision Records

Chronological decision log for Concord. Statuses: `accepted`, `superseded`.
The product source of truth remains `CONCORD_PRODUCT_SPEC.md`.

## ADR-001: Spec is the single source of truth

- **Status:** accepted (2026-10-30)
- **Context:** The repo contained an ambiguously named PRD file and no git history.
- **Decision:** The spec is renamed `CONCORD_PRODUCT_SPEC.md` and versioned in git.
  No feature may ship that contradicts it. Where implementation reality differs from
  the spec (e.g. MagicBlock API drift), update the spec in the same change.
- **Consequences:** README, ADRs, and proof docs all reference the spec sections.

## ADR-002: Solana client boundary (kit vs MagicBlock web3.js SDK)

- **Status:** accepted (2026-10-30), revisit after the Phase 1 spike
- **Context:** The app standardizes on `@solana/kit` v6. `@magicblock-labs/ephemeral-rollups-kit`
  0.17.3 depends on `@solana/kit ^4`, which conflicts with v6. The web3.js-based
  `@magicblock-labs/ephemeral-rollups-sdk` works with `@solana/web3.js ^1.98`.
- **Decision:** Keep `@solana/kit` for all general Solana work. During Phase 1, use the
  web3.js-based MagicBlock SDK inside one isolated module (adapter boundary). Do not
  mix signing types across the boundary. Re-evaluate `ephemeral-rollups-kit` once a
  kit-v6-compatible release exists.
- **Consequences:** One adapter module owns MagicBlock serialization; everything else
  stays on kit types.

## ADR-003: Pinned toolchain matrix

- **Status:** accepted (2026-10-30)
- **Context:** README pins were verified live against npm/crates.io: Node 24.18.0,
  pnpm 10.33.0, rustc/cargo 1.95.0, Solana CLI 3.1.15, Anchor CLI 1.1.2,
  anchor-lang 1.1.2, `ephemeral-rollups-sdk` 0.17.3 (features `anchor`, `access-control`, `vrf`),
  `ephemeral-vrf-sdk` 0.17.3 (feature `anchor`), `@coral-xyz/anchor` 0.32.1 for TS.
- **Decision:** These versions are the floor for every build and CI run. The Anchor
  program builds with anchor-lang 1.1.2; the TS client uses `@coral-xyz/anchor` 0.32.1.
- **Consequences:** Bumping any pin requires re-running the Phase 1 gates and updating
  `docs/architecture/magicblock-proof.md`.

## ADR-004: Devnet-only through Phase 6

- **Status:** accepted (2026-10-30)
- **Context:** Spec sections 2.2 and 17.4 forbid mainnet until gates pass; testnet is
  unsupported by the MagicBlock endpoints in use.
- **Decision:** All RPC/queue configuration targets Devnet (`localnet` allowed for
  automated tests only). `scripts/devnet-guard.mjs` validates `.env.example` and
  `.env.local` and fails CI on mainnet/testnet values, placeholders, or short secrets.
  `NEXT_PUBLIC_SOLANA_CLUSTER` is an enum of `devnet | localnet`.
- **Consequences:** A mainnet launch requires a new ADR and an update to the guard.

## ADR-005: Repository layout (spec section 12.5)

- **Status:** accepted (2026-10-30)
- **Context:** The repo was flat (`app/`, `anchor/`) with relative imports only.
- **Decision:** Migrated to the spec layout: `apps/web` (own `package.json`, Next.js),
  `programs/concord` (Rust), `packages/shared-types`, `packages/receipt-hash`,
  `tests/`, root `Anchor.toml` + `Cargo.toml` workspace, `pnpm-workspace.yaml`
  (`apps/*`, `packages/*`). Components and `lib/` stay colocated inside
  `apps/web/app/` (spec allows colocated structure inside the web app). Env files
  live at `apps/web/.env.local`; the example is `apps/web/.env.example`.
  `codama.json` reads `./target/idl/concord.json` and writes
  `./apps/web/app/generated/concord`. Drizzle config points at
  `./apps/web/app/lib/db/schema.ts`.
- **Consequences:** `pnpm dev/build/start` delegate via `--filter @concord/web`.
  Anchor builds from the repo root.

## ADR-006: Database is metadata only (spec section 11)

- **Status:** accepted (2026-10-30)
- **Context:** Spec forbids a shadow ballot ledger and requires session metadata,
  invitation rotation, webhook idempotency, and one active join request per wallet.
- **Decision:** Schema baseline includes `users`, `auth_nonces`, `sessions`
  (hashed session tokens only), `meetings` (with `invite_credential_version`),
  `join_requests` (partial unique index on active requests), `live_media_sessions`,
  `receipt_drafts`, `invite_credential_rotations`, `webhook_events` (unique
  provider + external event id). There is intentionally no `votes`/`ballots` table.
  Initial Drizzle migration is committed under
  `apps/web/app/lib/db/migrations/`.
- **Consequences:** Ballots and tally state exist only in program state (PER);
  the DB can never claim a private ballot is stored.

## ADR-007: Honest claims before proof (spec sections 2.2, 5.2, 16)

- **Status:** accepted (2026-10-30); revisit after Gates A-F pass
- **Context:** Landing copy asserted private ballots and working features before any
  MagicBlock proof existed.
- **Decision:** Pre-gate wording everywhere: hero trust line is
  `Invite-only rooms. Experimental ballot privacy. Verifiable outcomes.`; the features
  section is labeled `Roadmap` with per-card `In proof` / `Planned` chips; the privacy
  page carries an experimental-status banner; FAQ states private voting is
  experimental. Restore the canonical trust line and unqualified feature copy only
  after the deployed PER isolation and tally tests pass.
- **Consequences:** Marketing never outpaces the proof doc.

## ADR-008: Program identity and deploy authority

- **Status:** accepted (2026-10-30)
- **Context:** The placeholder vault program used ID
  `F4jZpgbtTb6RWNWq6v35fUeiAsRJMrDczVPv9U23yXjB`.
- **Decision:** Phase 1 generates a fresh devnet keypair; `declare_id!` and
  `Anchor.toml` `[programs.devnet]` are updated together. The deploy authority is
  that new keypair (funded from wallet `DztJxBybR7fKa9UyR8fBZMohaZYcLydyxrJr5CuJBa34`).
  The old vault ID is retired with the vault code.
- **Consequences:** Never guess program IDs; the IDL/client are regenerated after
  each deploy (`pnpm anchor-build && pnpm codama:js`).

## ADR-009: Receipt digest format (spec section 9.5)

- **Status:** accepted (2026-10-30)
- **Context:** Verification must reconstruct the committed digest from public fields
  in both the program (Rust) and the browser (TypeScript).
- **Decision:** One deterministic fixed-field encoding:
  `SHA256("CONCORD_RECEIPT_V1" || room_id || vrf_result_digest || started_at_i64_le ||
  ended_at_i64_le || vote_count_u32_le || ordered_vote_summary_digests || action_items_hash)`
  with little-endian fixed-width integers. Each vote summary digest binds room id,
  vote id, question hash, three option hashes, three counts, eligible/submitted
  counts, outcome code, close timestamp, and eligibility snapshot hash.
  `packages/receipt-hash` implements the TS side; the Rust program implements the
  same bytes; `tests/` holds cross-language vectors proving identical digests.
- **Consequences:** Any change to the encoding requires a version bump of the
  `CONCORD_RECEIPT_V1` prefix and a new vector set.

## ADR-010: UI constraints and restrained motion (spec sections 5.1, 20)

- **Status:** accepted (2026-10-30)
- **Context:** Spec forbids gradients, glassmorphism, animated backgrounds, emojis,
  and em dashes in product copy, and requires a single dark theme with restrained
  motion.
- **Decision:** Dark-only theme from the existing token palette. The sticky header
  uses a solid `bg-background` (no `backdrop-blur`). Entrance animation is limited
  to a small fade/translate on the hero via `motion` v14, wrapped in
  `<MotionConfig reducedMotion="user">` so OS reduced-motion preferences are honored.
  Cards use border-color hover transitions only. Em dashes are banned from user-facing
  copy (balance placeholder uses an ellipsis).
- **Consequences:** New motion must stay within these rules; no animation libraries
  beyond `motion`.

## ADR-011: Host-pays, gasless-for-voters fee model

- **Status:** accepted (2026-11-09); fee behavior to be confirmed by the Phase 1 Devnet spike
- **Context:** Only the meeting creator should spend SOL. Voters and observers must
  be able to participate with a zero-balance wallet. Costs must stay minimal on the
  path Devnet, testnet, mainnet.
- **Decision:** The host pays every base-layer transaction: room creation, VRF,
  account setup, delegation, the receipt and account closes. Voter actions
  (`cast_vote`, permissionless `finalize_vote`) run on the MagicBlock PER, where
  the voter signs as authority and is expected to pay no fee. Commits stay within
  MagicBlock's default sponsorship (10 commits per delegated account). Every
  account has a `close_*` path that returns rent to the host after the receipt
  is final.
  Fallback if PER rejects a zero-balance fee payer: a per-meeting throwaway
  session keypair in each voter's browser, topped up by the host via
  `lamportsDelegatedTransferIx`. The session key pays the fee and the voter's
  wallet signs as authority.
  Rejected: a server-held fee-payer relayer. It would see every vote transaction
  in plaintext, which leaks ballots to the backend (spec 9.4, 14.3).
- **Consequences:** Voter balances are asserted to stay at 0 in the Devnet and E2E
  tests. Measured costs are recorded in `docs/architecture/cost-report.md`.

## ADR-012: Account layout (supersedes the Phase 1 Room/VoteState/PrivateBallot model)

- **Status:** accepted (2026-11-09)
- **Context:** The Phase 1 layout allowed only one room per wallet and one vote per
  room. It did not check eligibility, trusted a caller-supplied tally, and stored
  ballots in public base-layer accounts. It also delegated the room before
  base-layer instructions that mutate it.
- **Decision:** Every per-meeting account is created once at setup:
  - `RoomRegistry` (base, never delegated), seeds `["concord_room", creator, room_nonce]`;
  - `RoomSession` (PER, permission = host): lifecycle plus the active vote, including
    the frozen eligible list;
  - `RoomResults` (delegated, public): up to 8 aggregate-only vote summaries;
  - one `VoterSlot` per participant (PER, permission = that voter), reused across
    rounds. Duplicate votes are blocked by `last_vote_id == vote_id`.
  VRF is requested on the base layer against `RoomRegistry` before any delegation.
  `finalize_vote` tallies from every slot passed in eligible order, then resets
  each slot's option in the same instruction. `end_meeting` clears roster fields
  before `commit_and_undelegate`, so no ballot or roster ever reaches the base
  layer. This deviates from spec 9.2-D (a ballot per room, vote and voter) to save
  rent and avoid host wallet popups every round.
- **Consequences:** A new program ID is deployed (ADR-008 process). Spec sections
  9.2 and 9.3 must be updated to match. Gate E verifies the reset-before-commit
  rule.

## ADR-013: One client stack (supersedes ADR-002)

- **Status:** accepted (2026-11-09)
- **Decision:** `@solana/wallet-adapter-react` + `@solana/web3.js` +
  `@coral-xyz/anchor` + `@magicblock-labs/ephemeral-rollups-sdk`. The
  `@solana/kit` wallet stack and the Codama step are removed. If the anchor-lang
  1.1.2 IDL is incompatible with the TS client, generate with Codama and convert
  at a single adapter boundary.

## ADR-014: Session-derived identity

- **Status:** accepted (2026-11-09)
- **Decision:** API routes take the wallet only from the HttpOnly session cookie,
  through `requireSession()`. The client-set `x-wallet-address` header is removed.

## ADR-015: Test pyramid

- **Status:** accepted (2026-11-09)
- **Decision:**
  - LiteSVM for program logic.
  - Vitest + PGlite for API and lib code.
  - Vitest + React Testing Library for UI rules.
  - Node Devnet suites for Gates A-F and the cost report.
  - Playwright for E2E, including a two-browser live call, against a local
    `livekit-server --dev` and a Neon test branch. A Wallet Standard test wallet is
    injected only by Playwright.

## ADR-016: Network path

- **Status:** accepted (2026-11-09); supersedes ADR-004 for scope after Devnet
- **Decision:** Devnet, then testnet, then mainnet. MagicBlock ER, PER and VRF
  have no published testnet endpoints, so testnet covers base-layer parts only.
  Mainnet requires a new ADR, an upgrade-authority multisig, an audit, and updates
  to `scripts/devnet-guard.mjs` and the env schema.

## ADR-017: Spike results applied (amends ADR-011, ADR-012)

- **Status:** accepted (2026-11-09); evidence in `docs/architecture/magicblock-proof.md`
- **Decision:**
  - **Fee model:** a zero-balance wallet can sign and pay PER transactions on the
    Devnet TEE. The primary fee model of ADR-011 is confirmed, and the session-key
    fallback is dropped.
  - **Voter slots:** `VoterSlot`s are ephemeral accounts created inside PER
    (`EphemeralAccount::create`, about 8.4k lamports each including the permission,
    refunded on close). The delegated `RoomSession` PDA sponsors them. Each has an
    ephemeral permission whose only member is its voter. They are never committed
    to the base layer.
  - **Program ID:** the concord program is upgraded in place at
    `85DsSom7cr5hHVZeTB7k3WKKKpFMB2DLUN3c6FbR9861`; there is no new ID, since no
    production data exists.
  - **Commits:** they are a separate instruction (`commit_results`) so tally logic
    stays testable and commit retries are idempotent.
  - **RPC:** the base RPC default is `https://rpc.magicblock.app/devnet`.
