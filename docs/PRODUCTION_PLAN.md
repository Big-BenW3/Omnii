# Concord: Production Completion Plan (Devnet to Mainnet)

## Context

A full line-by-line review (2026-11-09) found that the status docs overstate progress. The UI and API scaffolding exist, but the core product does not work yet:

- **Nobody can sign in.** `apps/web/app/page.tsx` never calls `signMessage`.
- **Nobody can join.** Invite credentials are never shown to the host, admitted users get 404 on the meeting, and `/join` is a placeholder.
- **API identity is spoofable.** Every route trusts the client-set `x-wallet-address` header.
- **The frontend never calls the program.** No IDL or client was generated. VRF, room registry, votes and receipts are mocked.
- **The voting UI posts the voter's choice to the database.** This breaks the core privacy rule.
- **The program blocks basic use:**
  - one room per wallet, ever;
  - one vote per room, ever;
  - no eligibility check;
  - the tally is trusted from the caller;
  - ballots are public base-layer accounts;
  - the voter pays rent and fees.
- **The LiveKit flow can't connect.** The token request has no auth, `NEXT_PUBLIC_LIVEKIT_URL` is missing, and remote tracks are never rendered.
- **The webhook is unsigned**, and `cargo test -p concord` does not compile.

**User decisions** (also saved in memory under `concord-decisions`):
1. **Only the meeting creator spends SOL.** Voters and participants need zero balance. Keep costs minimal, because the path is Devnet, then testnet, then mainnet.
2. The host can vote if marked eligible.
3. The UI will be redesigned later. For now, every spec screen must exist and the full flow must work end to end.
4. Production quality on Devnet first.

**Outcome:** a working, tested V1. Every spec flow runs for real on Devnet: create, VRF, invite, lobby, live video, private vote, finalize, receipt, public verify. Unit, integration, Devnet and Playwright suites all pass. That includes a two-browser test in which two people join the same call and see and hear each other.

**First execution step:** copy this plan to `docs/PRODUCTION_PLAN.md`.

---

## Key design decisions (new ADRs 011-016 in `docs/architecture/decisions.md`)

### ADR-011: Host-pays, gasless-for-voters model
- **Host pays (base layer):** all account creation and delegation, VRF, and the receipt. These are transactions only the host signs.
- **Free for everyone (PER):**
  - Voters sign `cast_vote` as themselves, so the voter is still authenticated.
  - Fees should be 0. This must be proven in the Phase 1 spike.
- **Commits** use MagicBlock's default sponsorship of 10 commits per delegated account. The design stays within that.
- **Fallback, if PER rejects a zero-balance fee payer:**
  1. Each voter's browser makes a throwaway session keypair for the meeting.
  2. The host tops it up with a tiny amount via `lamportsDelegatedTransferIx` on the base layer, batched for all voters.
  3. The session key is the fee payer, and the voter's wallet signs as authority.
- **The server relayer option is dropped.** A server fee payer would see every vote transaction in plaintext, which leaks ballots to the backend. That violates spec sections 9.4 and 14.3, which say no server wallet signs user-vote instructions.
- **Rent comes back to the host.** Every account gets a `close_*` path that returns rent to the host after the receipt is final, so the net cost is roughly transaction fees.

### ADR-012: Account layout (replaces the current Room/VoteState/PrivateBallot design)
All per-meeting accounts are created once at setup, so a new vote round needs no new rent and no host wallet popups.

| Account | Layer | Seeds | Contents | Visibility |
|---|---|---|---|---|
| `RoomRegistry` | base, never delegated | `["concord_room", creator, room_nonce(16B)]` | `creator`, `room_nonce`, `vrf_output`, `vrf_fulfilled`, `created_at`, `receipt_digest`, `receipt_finalized`, `bump` | public |
| `RoomSession` | PER, permission = host | `["concord_session", registry]` | `host`, `started_at`, `ended_at`, `status`, `next_vote_id`, `active_vote`, `bump` | private |
| `RoomResults` | delegated, no read restriction | `["concord_results", registry]` | up to `MAX_VOTES = 8` `PublicVoteSummary` entries | public aggregates only |
| `VoterSlot` | PER, permission = that voter | `["concord_slot", registry, voter]` | `voter`, `last_vote_id`, `option` (255 = none), `submitted_at`, `bump` | private to the voter |

- `active_vote` in `RoomSession` holds: `vote_id`, question hash, three option hashes, `deadline`, `eligible` (up to 20 pubkeys), `eligibility_hash` and `status`.
- **Room nonce:** the 16 bytes of the DB meeting UUID. This fixes the one-room-per-wallet bug.
- **VRF:** requested on the base layer against `RoomRegistry`, before any delegation, using the base queue `Cuj97…` that is already in the env. This removes the ER-queue question.
- **VoterSlot instead of a ballot per (room, vote, voter):**
  - Duplicate votes are blocked by `last_vote_id == vote_id`.
  - This is a deliberate deviation from spec 9.2-D, recorded in ADR-012 and updated in the spec.
  - The reason is cost and UX: one delegation per participant per meeting, not one per round.
- **No ballot or roster ever reaches the public base layer.** When an account is undelegated, its state is committed to the base layer. So:
  - `finalize_vote` tallies, then resets every slot's `option` to 255 in the same instruction.
  - `end_meeting` clears the eligible list and roster fields before `commit_and_undelegate`.
  - Gate E verifies this.

### ADR-013: One client stack
- **Use:** `@solana/wallet-adapter-react` + `@solana/web3.js` + `@coral-xyz/anchor` (TS) + `@magicblock-labs/ephemeral-rollups-sdk` (web3.js).
- **Delete:** the `@solana/kit` wallet stack (`app/lib/wallet/*`, `solana-client*`, `cluster-*`, `components/providers.tsx`, `wallet-button.tsx`, `use-balance`, `use-send-transaction`) and the Codama step.
- Supersedes ADR-002.
- **Risk:** IDL compatibility between anchor-lang 1.1.2 and `@coral-xyz/anchor` 0.32.1. Check this in Phase 1. If they don't match, generate the client with Codama and convert instructions at one adapter boundary.

### ADR-014: Session-derived identity
- Every API route gets the wallet from the HttpOnly session cookie through `requireSession()`.
- The `x-wallet-address` header is removed everywhere.

### ADR-015: Test pyramid
| Layer | Tool | What it covers |
|---|---|---|
| Rust | LiteSVM | program logic |
| Web | Vitest + PGlite | API and lib |
| UI | Vitest + React Testing Library | component rules |
| Devnet | Node scripts | Gates A-E and the cost report |
| Browser | Playwright | E2E, including the two-browser call, against a local `livekit-server --dev` and a Neon test branch |

### ADR-016: Network path
- Devnet first, then testnet, then mainnet.
- MagicBlock ER, PER and VRF have no published testnet endpoints. Testnet will therefore cover only base-layer parts: registry, receipt and closes.
- Mainnet needs:
  - a new ADR;
  - an upgrade-authority multisig;
  - a third-party audit;
  - updates to the guard in `scripts/devnet-guard.mjs` and the env schema.

---

## Phase 0: Housekeeping (½ day)
1. Write this plan to `docs/PRODUCTION_PLAN.md`. Move `FINAL_STATUS.md`, `FINAL_SUMMARY.md`, `PHASE*.md`, `COMPLETION_PLAN.md`, `CHANGES.md` and `docs/PROJECT_STATUS.md` into `docs/archive/`. Replace them with one honest `docs/STATUS.md`.
2. Add ADRs 011-016 and update the spec sections they touch (9.2, 9.3, 12.1, 14.3).
3. Make `cargo test -p concord` compile: delete `programs/concord/tests/per_privacy_tests.rs`, whose tests are empty TODOs. Real gate tests move to `tests/devnet/` in Phase 3.
4. Ask the user before making the first git commit. The repo has no commits yet; `.env*` is already ignored.

## Phase 1: Devnet spike, the go/no-go for the fee model (1 day)
Use a throwaway spike instruction set (`programs/concord` feature `spike`) or the current deployed program.

1. Get current endpoints from `https://status.magicblock.app/api/services`, including the `tee` region for PER. The router stays `https://devnet-router.magicblock.app`. Record results in `docs/architecture/magicblock-proof.md`.
2. **Gate A part 1, PER auth and fees:**
   - Delegate one PDA with a permission whose member is wallet V. V must have 0 lamports.
   - Get a PER auth token for V (a signed challenge, which costs nothing).
   - Send a write transaction to PER with V as fee payer.
   - Record the result: accepted with 0 fee means the primary plan; rejected means the session-key fallback.
3. **Read isolation:** check that wallet W, which is not a member, cannot read V's account through the PER RPC.
4. **Costs:** measure the rent for the delegation record, metadata, buffer and permission accounts, the VRF request fee, and the commit cost.
5. Write `docs/architecture/cost-report.md` with measured lamports.
6. **Exit:** the fee model and account sizes are confirmed, and ADR-011 is updated with the results.

## Phase 2: Program rewrite (`programs/concord/src/`) + LiteSVM tests (4-6 days)
**Files:** split `lib.rs` into:
- `state.rs` for the accounts;
- `instructions/{setup,session,vote,receipt,close}.rs`;
- `logic.rs` for pure functions: tally, eligibility, time checks and digests, reusing `digest.rs` and `vote::compute_outcome`;
- `errors.rs`.

Keep the `#[ephemeral]` program, the `#[delegate]`, `#[commit]`, `#[vrf]` and `#[vrf_callback]` macros, and `MagicIntentBundleBuilder`, as in the existing code.

**Instructions:**
| # | Instruction | Layer | Signer and payer | Checks |
|---|---|---|---|---|
| 1 | `initialize_room(room_nonce)` | base | host | creates `RoomRegistry` |
| 2 | `request_room_randomness` | base | host | `!vrf_fulfilled`; callback is `store_room_randomness`, write-once |
| 3 | `setup_room` | base | host | requires `vrf_fulfilled`; inits `RoomSession` and `RoomResults`, creates `RoomSession`'s permission (member: host), delegates both |
| 4 | `add_voter_slots(voters ≤ 4 per tx)` | base | host | creates `VoterSlot`, a permission (member: voter) and delegation for each; idempotent if the slot exists |
| 5 | `start_meeting` | PER | host | write-once `started_at = Clock` |
| 6 | `open_vote(q_hash, opt_hashes[3], deadline, eligible)` | PER | host | started; not ended; `now < started+3600`; no active vote; `deadline ≤ started+3600` and `> now`; 1 ≤ eligible ≤ 20; dedupe and sort, reject duplicates; every eligible wallet must have a `VoterSlot` (passed as remaining accounts); `next_vote_id < MAX_VOTES`; option hashes non-zero and distinct |
| 7 | `cast_vote(option)` | PER | voter (0 SOL) | vote open; `now ≤ deadline`; `now < started+3600`; voter in `eligible`; `slot.voter == signer`; `slot.last_vote_id != vote_id`; `option < 3`; sets `option`, `last_vote_id`, `submitted_at` |
| 8 | `close_vote` | PER | host any time, anyone after deadline | status Open → Closing |
| 9 | `finalize_vote` | PER | anyone, permissionless once Closing or past deadline | remaining accounts = slots in exact `eligible` order; checks PDA, owner, discriminator and `voter`; counts only slots with `last_vote_id == vote_id`, missing ones count as no ballot; writes the summary into `RoomResults[vote_id]` with `summary_digest`; resets each slot's `option`; clears `active_vote`; commits `RoomResults` (commit only); idempotent |
| 10 | `end_meeting` | PER | host, or anyone after `started+3600` (covers `expire_meeting`) | finalizes an active vote if past its deadline, otherwise rejects; clears the roster and eligible fields; `commit_and_undelegate` for session, results and all slots |
| 11 | `finalize_receipt(action_items_hash)` | base, after undelegation | host | requires `ended_at` set; reads `RoomResults` (owner is the program again); recomputes every summary digest on-chain; `ended_at` comes from session data, not the caller; computes `receipt_digest` write-once via `digest::receipt_digest` |
| 12 | `close_voter_slot`, `close_session`, `close_results` | base | host | rent goes to the host; only after the receipt is finalized |

**LiteSVM tests** (`programs/concord/tests/*.rs`, dev-dependency `litesvm`):
- Load the program `.so` and set PER-side accounts directly to test instruction logic.
- Delegation, permission and VRF CPIs are covered by Devnet tests instead.

**Cases (spec 17.2):**
- creator authority;
- room nonce derivation, so two rooms per host work;
- 60-minute bound on every instruction;
- host-only actions;
- exactly 3 options;
- empty or duplicate option hash rejected;
- eligibility frozen after open;
- ineligible wallet rejected;
- duplicate vote rejected;
- option ≥ 3 rejected;
- vote after the deadline rejected;
- vote after meeting expiry rejected;
- tally correct for every combination, including ties, zero ballots and missing slots;
- slot omission, substitution, duplicate metas and wrong order all rejected;
- slots reset after finalize;
- permissionless finalize after the deadline;
- receipt requires every vote finalized;
- receipt is write-once;
- finalize and receipt retries are idempotent;
- closes refund the host;
- the existing digest vectors still pass (`tests/receipt-digest-vectors.json`).

**Build:**
- Fix `anchor build` (GLIBCXX: install `libstdc++6` ≥ 12, or build with `cargo build-sbf` plus `anchor idl build`).
- Produce `target/idl/concord.json` and `target/types/concord.ts`.
- Deploy with a new program ID, since the account layout changed (ADR-008 process).
- Update `declare_id!`, `Anchor.toml` and `.env*`.

## Phase 3: Devnet integration suite, Gates A-F + cost (2-3 days)
**Folder:** `tests/devnet/`, written in TypeScript and run with `node --test` via tsx.
- Script: `pnpm test:devnet`.
- Needs `DEVNET_HOST_KEYPAIR`, about 1 SOL. Voter keypairs are generated fresh with 0 SOL.

**Tests:**
| Gate | Covers |
|---|---|
| A | init, delegate, PER write, commit, read back; ER acceptance distinguished from base commit |
| B | VRF request and callback; a fake callback by a non-oracle is rejected; a retry while pending creates no duplicate request |
| C | voter casts with **0 SOL** and their balance is still 0 afterwards; voter B, an observer and an outsider cannot read voter A's slot through the PER RPC; transaction logs and messages show no option |
| D | 20 eligible voters; missing, extra, reordered and fabricated slots rejected; tally correct |
| E | during the vote, base-layer bytes and PER reads by non-members show no counts; after finalize the base `RoomResults` holds aggregates only; after `end_meeting` the base slot and session bytes have `option = 255` and no eligible list |
| F | receipt committed, rebuilt from public data with `@concord/receipt-hash`, and a tampered field shows a mismatch |

- `cost.test.ts` writes measured host lamports per meeting and per round, plus refunds after closes, into `docs/architecture/cost-report.md`.

## Phase 4: Backend foundation (`apps/web`) + Vitest (3 days)
1. **`lib/server/env.ts`:**
   - `parseServerEnv` from `packages/shared-types/src/env.ts` runs at module load and fails fast.
   - Add to the schema: `DATABASE_URL_POOLED`, `MAGICBLOCK_ROUTER_URL` (rename from `MAGICBLOCK_ER_RPC_URL`), `MAGICBLOCK_PER_RPC_URL` (the TEE URL from Phase 1), `CRON_SECRET`, `NEXT_PUBLIC_PROGRAM_ID`, `NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL`, `NEXT_PUBLIC_PER_RPC_URL`.
   - Remove every `|| "default-…"` fallback.
   - Drop `NONCE_HASH_SECRET` (use `SESSION_SECRET` with domain-separated HMAC), `ACTION_ITEMS_HASH_SECRET` (plain SHA256 per spec) and `WEBHOOK_SECRET` (the LiveKit key and secret verify webhooks).
   - Add `@concord/shared-types` and `@concord/receipt-hash` as `workspace:*` dependencies of the web app.
2. **`lib/server/auth.ts`:** `requireSession(req)` returns `{wallet, sessionId}` or 401. It uses `crypto.timingSafeEqual`, rotates the session on login and updates `lastSeenAt`.
3. **Auth routes:**
   - The nonce route builds the message once and stores `messageHash`.
   - `verify` takes base64 only and verifies against the stored message.
   - The nonce is consumed with an atomic `UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING`, which stops replays.
4. **`apps/web/middleware.ts`** (or `proxy.ts` if Next 16 requires it):
   - origin check against `APP_BASE_URL`;
   - JSON content type and a 32 KB size limit on mutations;
   - delete `app/api/v1/auth/middleware.ts`, `_middleware.ts` and `networkGuard`.
5. **Rate limiting:** a `rate_limits` table plus `lib/server/rate-limit.ts` (fixed window, keyed by session wallet or `x-real-ip` from the platform). Applied to auth, invite checks, join requests, token minting and cost-incurring calls. Invite failures lock out for 15 minutes after 10 tries.
6. **`lib/server/http.ts`:** Zod schema per route, one error shape, and log redaction for secrets, signatures and tokens.
7. **DB migration `0001`:**
   - `meetings` gains `room_nonce` and `registry_address`; drop `vrf_request_reference`.
   - `join_requests` gains `is_voter` (a UI preference only) and `display_name` 3-40 characters.
   - New `vote_rounds` table: `meeting_id`, `vote_id`, `question`, `options[3]`, `deadline`, `status`. It holds labels only, never ballots.
   - New `rate_limits` table.
   - Unique `(meeting_id, wallet)` for active (pending or admitted) requests.
8. **Use the pooled Neon URL** (`DATABASE_URL_POOLED`, `sslmode=require`). This fixes the `ETIMEDOUT` in `err.log`.
9. **API routes (spec section 10).** Replace the current routes; old duplicates are deleted.
   - **Meetings:**
     - `POST /api/v1/meetings/drafts`
     - `GET /api/v1/meetings` (dashboard: hosted + joined)
     - `GET /api/v1/meetings/:id`: safe fields and an access level (`host | admitted | pending | none`); no invite hashes
     - `POST /api/v1/meetings/:id/chain-sync`: the server reads `RoomRegistry` and `RoomSession` from chain and derives the lifecycle status. This replaces the client-driven `lifecycle`, `vrf` and `room-registry` routes.
   - **Invitations:**
     - `POST /api/v1/meetings/:id/invitation`: host only; returns the link secret and the 8-character code **once**. Use `crypto.randomBytes` and `crypto.randomInt`.
     - `POST /api/v1/meetings/:id/invitation/rotate`
   - **Join requests:**
     - `GET` and `POST /api/v1/meetings/:id/join-requests`: accepts the link secret or the code with constant-time compare; checks the join window and capacity (admitted < 19 plus host); a rejected wallet cannot re-request.
     - `POST /api/v1/meetings/:id/join-requests/:rid/decision` (`APPROVE | REJECT`): pending requests only, re-checks capacity
     - `PATCH /api/v1/meetings/:id/participants/:rid` (`is_voter`)
     - `GET /api/v1/meetings/:id/participants`
   - **LiveKit:**
     - `POST /api/v1/meetings/:id/livekit-token`: requires host or admitted user, status LIVE, before `started+3600`, and live room count < 20 via `RoomServiceClient.listParticipants`. Returns an opaque identity (HMAC of meeting id and wallet), a 10-minute TTL, publish and subscribe for audio and video only, and `roomAdmin` for the host only. Response is `{serverUrl, participantToken, expiresAt}`. The client no longer needs `NEXT_PUBLIC_LIVEKIT_URL`.
     - `POST /api/v1/webhooks/livekit`: verified with `WebhookReceiver`, uses the real `event.id`, is idempotent, and updates `live_media_sessions` only.
   - **Votes:** `POST /api/v1/meetings/:id/vote-rounds` (host stores labels for display) and `GET`
   - **Receipts:**
     - `POST /api/v1/meetings/:id/receipt-draft`: action items; the digest is computed client-side
     - `GET /api/v1/receipts/:registryAddress`: public JSON built from chain data plus labels; `NOT_YET_COMMITTED` when not committed
   - **Expiry:** `POST /api/v1/cron/expire` (needs `CRON_SECRET`): closes LiveKit rooms past 60 minutes, refuses new tokens and invalidates invites. Run by Vercel cron, with `scripts/expire.mjs` locally.
10. **Vitest** (`apps/web/vitest.config.ts`): PGlite runs Drizzle migrations in memory, and route handlers are called directly with `Request` objects. One test file per route covers spec 17.3:
    - valid, invalid, reused and expired nonce;
    - cookie flags;
    - wrong invite rejected; rotation kills old credentials;
    - lockout after repeated failures;
    - no token without admission;
    - capacity enforced; the 21st participant rejected, including concurrent requests via `Promise.all`;
    - the API secret never appears in responses;
    - unsigned or tampered webhooks rejected; duplicates are no-ops;
    - receipt route returns public data only, and never reports success from a database-only record;
    - a forged `x-wallet-address` header is ignored.

## Phase 5: All screens and flows working (5-7 days)
Plain Tailwind styling (the user will redesign later). Lucide icons only, no emoji.

**Delete:**
- `app/meetings/**`
- `components/voting/*`
- `components/livekit/*`
- `hooks/use-livekit.ts`
- the kit wallet stack
- the old `app/page.tsx` content

**Keep and reuse:** `app/components/landing/*` (`Hero`, `ContentSections`, `SiteHeader`, `SiteFooter`, `PillButton`) and `WalletGateModal`, rewired to wallet-adapter. The spec wording stays: ADR-007 says "Experimental ballot privacy".

**Shared client libraries:**
- `lib/chain/connections.ts`: base, router and PER connections; the PER auth token via the MagicBlock SDK; `getDelegationStatus`.
- `lib/chain/concord.ts`: an Anchor `Program` and typed builders for every instruction; PDA helpers.
- `lib/chain/tx.ts`: `sendWithStatus()` emits the spec section 6 states: Ready for wallet approval, Awaiting wallet signature, Submitted, PER accepted, Confirming on Solana, Committed, Failed with retry. Retries first check chain state, so they are idempotent. Uses `skipPreflight` for ER transactions.
- `components/tx-status.tsx`
- `lib/auth/use-session.ts`: connect, then sign the nonce message with `signMessage`, then verify. It remembers the intended route and resumes it after sign-in.
- Devnet network banner.

**Screens (spec 6.1):**
| Route | What it does |
|---|---|
| `/` | Landing page with hero, about, features, how it works, FAQ and CTA |
| `/create` | 1. Form: name, description, start time; duration fixed at 60 min and cap at 20, shown read-only. 2. Draft. 3. `initialize_room` + `request_room_randomness` (one host transaction). 4. Wait for the VRF callback (poll `chain-sync`, safe across a page refresh). 5. `setup_room`. 6. The invite link and code are shown once, with copy buttons. |
| `/join/[meetingId]` | Reads the secret from the URL fragment, or the user types the code. Then wallet gate and sign-in, display name, request. Shows Pending, Admitted (go to the lobby) or Rejected. Invalid and rotated invites are rejected with no private details. |
| `/meeting/[meetingId]/lobby` | **Host:** pending list with Admit and Reject, participant list with voter/observer toggles, "Prepare voters" (`add_voter_slots` batch), Start meeting (`start_meeting` plus a LIVE sync), Rotate invite. **Invitee:** waiting state. Refreshes every 3 s using SWR, which is already a dependency. |
| `/meeting/[meetingId]` | **Live room:** `@livekit/components-react` (`LiveKitRoom`, `GridLayout` with `ParticipantTile`, `RoomAudioRenderer`, `ControlBar` with camera and mic only and no screen share, device selection, `ConnectionStateToast`); camera and mic preflight, with an explanation if permission is denied. **Header:** 60-minute countdown from `started_at`. **Participants panel. Vote panel:** described below. **End:** host ends the meeting (`end_meeting`); everyone else leaves. |
| `/meeting/[meetingId]/receipt` | Host only. Reads the finalized summaries from chain, lets the host add action items, shows a disclosure preview of what becomes public, computes the digest client-side, sends `finalize_receipt`, then the closes. |
| `/receipt/[registryAddress]` | Public. Shows questions, options, counts, outcome, action items, digest, cluster and Explorer link. "Verify receipt" recomputes the digest with `@concord/receipt-hash` against chain bytes. States: Verified, Mismatch, Not yet committed, RPC unavailable. |
| `/dashboard` | Hosted and joined meetings with status and links. |
| `/privacy` | Existing page, mounted correctly. |
| Error states | Capacity full, meeting expired or ended, not admitted, wrong network, no wallet ("Create a wallet" guidance). |

**Vote panel inside the live room:**
- **Host "New vote":** question, exactly 3 non-empty distinct options, and a deadline within the remaining meeting time. It stores the labels through the API, then sends `open_vote` on PER with an eligibility snapshot from the voter toggles.
- **Eligible voter:** three choices, then a free `cast_vote` on PER. Shows Vote submitted and then locks.
- **Observer:** sees "Not eligible".
- **Before finalize:** no counts and no "who voted". Only "Voting open, closes at …".
- **Closing:** host Close, or anyone's Finalize after the deadline (permissionless, free). After that, aggregate results are shown.

## Phase 6: Testing (Vitest components + Playwright E2E + CI) (4-5 days)

### 6.1 Component tests (Vitest + React Testing Library + jsdom)
- **Vote panel:**
  - never renders counts while the vote is open;
  - observer cannot vote;
  - inputs validated (exactly 3 options, deadline bounds);
  - locks after submit.
- **Tx status:** every state transition renders.
- **Receipt verify:** all four statuses, using fixture data.
- **Wallet gate:** resumes the intended route.
- **Join page:** reads the secret from the fragment and never puts it in the query string.

### 6.2 Playwright setup (`tests/e2e/`, `playwright.config.ts` at the repo root)
- **Test wallet** (`tests/e2e/fixtures/test-wallet.ts`):
  - A Wallet Standard wallet named "Concord Test Wallet", injected with `page.addInitScript` before each page loads. It is built with esbuild from `@wallet-standard/wallet` + tweetnacl.
  - Supports `standard:connect`, `solana:signMessage`, `solana:signTransaction` and `solana:signAndSendTransaction`, signing with a keypair the test passes in.
  - wallet-adapter discovers Wallet Standard wallets automatically, so no app code changes. It is never part of the production bundle.
- **Fake media:**
  - Chromium launch args `--use-fake-ui-for-media-stream` and `--use-fake-device-for-media-stream`.
  - `--use-file-for-fake-video-capture=tests/e2e/fixtures/{host,guest}.y4m`, a distinct test pattern per person.
  - `permissions: ['camera','microphone']`.
- **LiveKit:**
  - `globalSetup` starts `livekit-server --dev` (API key `devkey` / secret `secret`, `ws://localhost:7880`).
  - The binary is installed by `scripts/install-livekit-server.sh`; there is no Docker on this machine.
  - Optional `E2E_LIVEKIT=cloud` uses the real LiveKit Cloud project.
- **Database:**
  - A Neon `test` branch via `apps/web/.env.test` (`DATABASE_URL_POOLED`).
  - `globalSetup` runs the migrations and truncates the tables.
  - Fixtures in `tests/e2e/fixtures/seed.ts` create users, sessions and meetings in a given lifecycle state, so suites that don't touch chain stay fast.
- **Web server:** Playwright `webServer` runs `pnpm build && pnpm start` with `.env.test` on port 3100.
- **Projects:**
  - `chromium-desktop`
  - `mobile` (Pixel 7 viewport, smoke checks only)
  - `devnet`: tag `@devnet`, run manually or nightly, `workers: 1`, 10-minute timeout

### 6.3 Playwright specs
1. **`landing.spec.ts`:** all landing sections render. Create a meeting with no wallet opens the wallet gate. Connecting the test wallet and signing in resumes `/create`.
2. **`auth.spec.ts`:**
   - Sign-in sets an HttpOnly, Secure, SameSite cookie.
   - Logout revokes the session.
   - A replayed signature is rejected (through the request API).
   - A forged `x-wallet-address` header gets nothing.
3. **`invite-join.spec.ts`** (seeded meeting):
   - The guest opens the invite link, enters a display name and requests entry; the host sees the request in the lobby and admits; the guest moves to the lobby.
   - A wrong code is rejected; 11 bad tries lock out.
   - After a rotation, the old link fails.
   - A rejected guest cannot re-request.
4. **`two-browser-call.spec.ts`, the key test you asked for:**
   - **Setup:** two separate browser contexts, so cookies and storage are isolated, each with a distinct fake camera and its own test wallet. Run `pnpm e2e:call --headed` to watch both windows side by side; it is headless in CI.
   - **Host:** the seeded meeting is set to LIVE, then the host joins the room.
   - **Guest:** joins the same meeting through the real invite, request and admit flow, then enters the room.
   - **Both see each other:** each window shows two tiles, and the remote tile's `<video>` has `videoWidth > 0` and is playing (`readyState ≥ 2`, `currentTime` advancing).
   - **Audio:** the remote audio track is subscribed; `RoomAudioRenderer`'s audio element is not paused.
   - **Mute check:** the guest turns off their camera, and the host sees the muted indicator within 5 s; turning it back on restores it. Same for the mic.
   - **Leave and rejoin:** the guest leaves and the host's count drops to 1. The guest reconnects and both see each other again.
   - **Token gate:** a third, unadmitted context calls the token API and gets 403.
   - **Expiry:** if `started_at` is seeded to 59:55 ago, the room closes at 60:00, both clients see "Meeting ended", and a new token request gets 403.
5. **`capacity.spec.ts`:**
   - Through the API, 19 guests are admitted concurrently plus the host; the 21st admission is rejected.
   - A token request is refused when LiveKit reports 20 connected. The full 20-person media test lives in 6.5.
6. **`screens.spec.ts`** (desktop and mobile): every route renders its main state and error states with no console errors. Uses the axe-core accessibility check on key screens.
7. **`full-flow.devnet.spec.ts` (`@devnet`), spec section 17.4 end to end:**
   - **Setup:** three contexts (host, voter, observer). Only the host wallet is funded; the voter and observer wallets start at 0 SOL.
   - **Meeting:** the host creates a meeting, which runs real VRF, then `setup_room`. Two guests join through the invite flow and the host admits both. Both video calls are verified as in spec 4.
   - **Voting:**
     - The host marks the voter eligible and the observer not, prepares voters, starts the meeting, and opens a 3-option vote.
     - The voter votes, sees "Vote submitted", and **still has 0 SOL**.
     - The observer is rejected, and the voter's second vote is rejected.
     - No counts are visible anywhere in either guest's page or network responses, and none on the host's.
   - **Results:** the host closes the vote and finalizes it; correct aggregates appear and the summary is committed (read back from the base layer).
   - **Receipt:** the host ends the meeting, adds action items, reviews the disclosure preview and finalizes the receipt. `/receipt/[addr]` shows **Verified**. A tampered local fixture shows **Mismatch**.
   - **Idempotency:** a repeated finalize call after a simulated timeout creates no duplicate.
   - **Cost:** the host's SOL spend is logged, and the closes refund the rent.

### 6.4 Other checks
- **`scripts/check-bundle-secrets.mjs`:** after the build, scans `.next/static` for the values of `LIVEKIT_API_SECRET`, `SESSION_SECRET`, `INVITE_HASH_SECRET` and `DATABASE_URL`. Any match fails the build.
- **Privacy grep test:** runs over DB rows, server logs captured during E2E, and API responses. Fails if a ballot option field ever appears.

### 6.5 Manual and nightly checks
- **20-participant load test:** `scripts/load-test.sh` runs `lk load-test --room <name> --video-publishers 20 --duration 10m`. Record bandwidth and participant minutes in `docs/architecture/load-test.md`.
- **Seeker or Android wallet smoke test:** Phantom or Solflare mobile with Mobile Wallet Adapter on `/join` and in the room.

### 6.6 CI (`.github/workflows/ci.yml`)
- **On every PR:**
  - `pnpm lint`
  - `pnpm format:check`
  - `pnpm guard:devnet`
  - `pnpm typecheck`
  - `pnpm test` (Vitest)
  - `cargo test -p concord`
  - `anchor build`
  - `pnpm test:digest`
  - Playwright `chromium-desktop` and `mobile`, with a cached livekit-server binary and the Neon test branch from secrets
  - `check-bundle-secrets`
- **`devnet.yml`** (manual or nightly): `pnpm test:devnet` and the Playwright `devnet` project, using a funded host keypair from secrets.

**Root scripts:**
- `test`
- `test:program`
- `test:devnet`
- `e2e`
- `e2e:call`
- `e2e:devnet`
- `test:all`

## Phase 7: Ops and release hardening (2 days)
- Structured logging with redaction, Sentry or an equivalent for errors, and a `/api/health` endpoint.
- Vercel deploy with cron for `/api/v1/cron/expire` and env set from the schema.
- Rotate the Devnet secrets before any public deploy.
- **Testnet:** run the base-layer parts per ADR-016.
- **Mainnet:** audit, multisig, new ADR. Turn on the canonical trust line only after Gates C-E pass (ADR-007).

---

## Files: critical changes, summarized
**Program:**
- `programs/concord/src/{lib,state,logic,errors}.rs`
- `programs/concord/src/instructions/*.rs`
- `programs/concord/tests/*.rs` (LiteSVM)
- `programs/concord/Cargo.toml` (add `litesvm`)

**Web lib:**
- `apps/web/app/lib/server/{env,auth,http,rate-limit,livekit}.ts`
- `apps/web/app/lib/chain/{connections,concord,tx}.ts`
- `apps/web/middleware.ts`

**Web API:** `apps/web/app/api/v1/**`, rewritten per Phase 4.9 using the same handler pattern everywhere.

**Web pages:** `apps/web/app/{create,join/[meetingId],meeting/[meetingId]/{lobby,receipt},meeting/[meetingId],receipt/[registryAddress],dashboard}/page.tsx`

**Database:**
- `apps/web/app/lib/db/schema.ts`
- migration `0001_*`
- `apps/web/app/lib/db/client.ts` (pooled URL)

**Tests:**
- `tests/devnet/*.test.ts`
- `tests/e2e/**`
- `playwright.config.ts`
- `apps/web/vitest.config.ts`
- `.github/workflows/*.yml`

**Docs:**
- `docs/PRODUCTION_PLAN.md`
- `docs/STATUS.md`
- `docs/architecture/{decisions,magicblock-proof,cost-report,load-test}.md`
- the matching sections of `CONCORD_PRODUCT_SPEC.md`

**Reuse, don't rewrite:**
- `programs/concord/src/digest.rs` and `packages/receipt-hash/src/index.ts` (verified byte-identical, tests pass)
- `vote::compute_outcome`
- `packages/shared-types/src/env.ts` (the schema exists, it just needs wiring)
- `scripts/devnet-guard.mjs`
- `app/components/landing/*`
- `app/components/wallet/wallet-gate-modal.tsx`
- `app/privacy/page.tsx`
- the DB tables in `schema.ts` (extend them; webhook idempotency and session hashing are already designed)
- SWR, Zod, `livekit-server-sdk` and `@livekit/components-react`, which are already dependencies

## Verification: definition of done
All of these must pass locally and in CI:
1. `cargo test -p concord`: LiteSVM program suite plus digest vectors.
2. `pnpm test`: Vitest API and component suites.
3. `pnpm test:digest`: cross-language vectors.
4. `pnpm e2e`: every Playwright spec. **`pnpm e2e:call --headed` visibly opens two browsers that join the same call and see and hear each other.**
5. `pnpm test:devnet` and `pnpm e2e:devnet`:
   - Gates A-F pass on Devnet PER.
   - Voter wallets stay at 0 SOL.
   - `docs/architecture/cost-report.md` is filled with measured host cost per meeting and per round, plus refunds.
6. `pnpm build` and `node scripts/check-bundle-secrets.mjs` are clean. `pnpm guard:devnet` and `pnpm lint` pass.
7. Manual: the 20-participant load test is recorded, and the mobile wallet smoke test passes.
8. **If Gates C, D or E fail on Devnet:** stop. Private voting stays "experimental"; no fallback to database or public storage (spec 9.6). Redesign through an ADR before continuing.

**Estimated effort:** about 4-5 weeks for one developer. The biggest risks are:
- PER fee and permission behavior (Phase 1);
- IDL compatibility between anchor-lang 1.1.2 and the TS client;
- MagicBlock sponsored-commit limits beyond 8 rounds.
