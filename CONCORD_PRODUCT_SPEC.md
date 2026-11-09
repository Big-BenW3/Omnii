# CONCORD
## Product Requirements Document and Technical Build Plan

**Document status:** Source of truth for the Concord side project, Devnet-first V1  
**Version:** 2.0  
**Date:** 30 October 2026  
**Product name:** Concord (working name)  
**Target network:** Solana Devnet  
**Target room size:** 20 participants maximum, including the host  
**Maximum meeting duration:** 60 minutes from the host starting the meeting

> This file is the source of truth for product scope, UX, frontend, APIs, Solana programs, MagicBlock integration, LiveKit integration, privacy boundaries, transaction lifecycle, setup, acceptance tests, and phased implementation. Concord is a side project intended to demonstrate real-world coordination with MagicBlock, not a hackathon submission. Build to these requirements, and document any implementation detail that changes after checking current SDKs or deployment behavior.

---

# 1. Executive Summary

Concord is a private, real-time video and audio meeting platform for communities that need to discuss an issue, vote on it privately, and leave behind a verifiable decision record.

A host connects a Solana wallet, creates a meeting with a title and scheduled time, and shares a private invitation link or join code. MagicBlock VRF is a required part of room creation. Participants connect wallets, request entry, and are admitted by the host. The meeting uses LiveKit for real-time video and audio. The host can open one voting round at a time, define a question and exactly three options, and control which admitted participants are eligible to vote. Eligibility is frozen for each round when voting begins. Votes are private, individual ballots are not written to the application's database, and the live interface does not show option-by-option counts before voting closes. After a vote closes, the final aggregate result can be published.

Meeting coordination is the candidate use for MagicBlock Ephemeral Rollups (ER); private ballot processing is the candidate use for Private Ephemeral Rollups (PER). The precise account layout and transaction path are subject to the technical feasibility gates in this document. Only explicitly public result and receipt data may be committed to Solana. Individual ballot accounts must never be committed. Until the deployed PER implementation proves the required isolation, the app must describe private voting as experimental and must not represent the privacy requirement as complete.

When the meeting ends, the host reviews the meeting receipt, may add concise action items, and confirms what will be disclosed publicly. Concord commits a deterministic receipt digest and public result fields to Solana. A verification page reconstructs the digest from the public receipt and checks it against the on-chain record.

Concord is not a general-purpose video-conferencing suite, chat platform, or full DAO governance system. It focuses on one complete experience: **create a private meeting, meet face-to-face, vote privately, finalize the result, and verify the receipt**.

## 1.1 Non-technical overview

A community can use Concord when a decision is important enough that its outcome should be recorded, but individual voting choices and the discussion should remain private. The room is invite-only. People can see and hear one another. The host opens a vote at the appropriate point in the conversation. Every eligible voter selects one of three options. Other participants cannot inspect individual ballots. Once voting closes, the system publishes the aggregate result and commits a verifiable record to Solana.

The meeting discussion is not recorded. Concord does not create a transcript. The blockchain stores a minimal public registry and the finalized receipt commitment, not the video, audio, room invitation secret, participant names, or individual vote choices.

## 1.2 Product principles

1. **Meeting first.** Video and audio are core capabilities, not future additions.
2. **Privacy by design.** Entry is invite-controlled and public-chain disclosure is minimized. Claim private ballots only after the deployed PER isolation and tally tests pass.
3. **Wallet-owned identity.** Concord never creates or stores a user's wallet seed phrase or private key.
4. **One clear source of truth.** The Solana program is authoritative for on-chain room lifecycle, voting eligibility snapshots, vote acceptance, finalized vote summaries, and receipt commitments. Backend database records support scheduling, invitation verification, host admission, and media orchestration.
5. **Explicit public disclosure.** The host previews the exact receipt before publishing it. Aggregate voting results and approved action items are public once finalized, while discussion and individual ballots remain private.
6. **No fake privacy claims.** A standard ER is not automatically private. Private voting must use the documented PER permission model and pass tests against the selected PER deployment.
7. **No unnecessary scope.** Do not add chat, AI summaries, recording, screen sharing, calendar integrations, treasury actions, or organization-wide governance features.

---

# 2. Product Scope

## 2.1 Required V1 features

- Minimalist public landing page with hero, about, features, how it works, FAQ, and final call to action.
- Wallet connection and wallet creation guidance before creating a meeting.
- Wallet-signature authentication for meeting creation, joining, and voting eligibility.
- Create a meeting with a name, optional description, scheduled start time, fixed maximum duration of 60 minutes, and private invitation access.
- Required MagicBlock VRF flow as part of meeting creation.
- A secure invite link and a join code.
- A waiting room where the host admits or rejects participants.
- A hard cap of 20 connected meeting participants, including the host.
- Real-time video and audio using LiveKit.
- Microphone and camera controls, participant grid, participant list, waiting-room admissions, and leave/end controls.
- Host-controlled voter/observer eligibility for each approved participant.
- Multiple sequential vote rounds in a meeting, one active vote at a time.
- Every vote has one question and exactly three options.
- One vote per eligible wallet per vote round.
- Private individual ballots and no live option-by-option tally before the vote is finalized.
- Live participation progress that reveals only the number of ballots submitted, not the voters or their choices.
- Vote close/finalize mechanics, with a final aggregate tally.
- Meeting closure and a host-reviewed receipt containing finalized decisions and optional manually entered action items.
- A deterministic cryptographic receipt digest committed to Solana.
- A public receipt verification page.
- Devnet-first deployment and test instructions.

## 2.2 Not in V1

The following are expressly excluded. Do not implement them as hidden, stubbed, or partially working features.

- AI meeting summaries or AI agents.
- Audio or video recording, transcripts, or playback.
- Calendar integration or automated calendar invitations.
- In-meeting text chat or a standalone messaging system.
- Screen sharing.
- Treasury management, token-gated funds, grant distribution, payments, or other financial execution.
- Multiple meeting product types or organization administration.
- Public meeting discovery or a public community feed.
- Reactions, stickers, emoji controls, or decorative emoji.
- Complex DAO proposal management, delegated governance, token-weighted voting, or custom voting formula builders.
- Arbitrary meeting duration selection. V1 is capped at 60 minutes.
- Production mainnet deployment. V1 targets Devnet.

## 2.3 V1 constraints

| Constraint | Required behavior |
|---|---|
| Maximum duration | 60 minutes from the host starting the meeting |
| Maximum participants | 20 total connected participants, including the host |
| Voting options | Exactly 3 options per vote |
| Active votes | At most 1 active vote per meeting |
| Voting identity | Wallet public key |
| Duplicate vote | Rejected by the on-chain program |
| Eligibility changes | Allowed before a vote opens; frozen for that vote after it opens |
| Ballot visibility | Hidden during and after voting at individual ballot level |
| Live results | Show progress count before closure; reveal aggregate option totals only after finalization |
| Meeting record | No media recording or transcript |
| Receipt | Public fields shown to host before final commitment |
| Chain | Solana Devnet for side-project V1 and integration testing |

The program and frontend must enforce these limits. Frontend-only validation is insufficient.

---

## 2.4 Product success measures

V1 succeeds when a small community can complete the full coordination loop without an operator manipulating application data by hand. Track these measures in test reports rather than adding invasive analytics:

- **Meeting completion:** a host creates a room, admits participants, starts media, opens and closes a vote, and finalizes a receipt in one continuous run.
- **Capacity correctness:** 20 total participants, including the host, can join; a 21st is rejected even if join requests race.
- **Media reliability:** a 20-person, 60-minute test maintains usable audio/video and recovers from a temporary participant disconnect.
- **Vote correctness:** program tests show eligibility enforcement, immutable eligibility snapshots, duplicate rejection, time-bound rejection, correct three-option tally, tie handling, and idempotent finalization.
- **Privacy proof:** tests show that an unauthorized participant cannot retrieve another ballot or view per-option totals before closure through PER RPC, APIs, browser state, logs, or public Solana accounts. This is a go/no-go measure, not just a marketing claim.
- **Receipt verification:** an independent client reconstructs the public receipt digest and detects any altered field.
- **Operational clarity:** the UI distinguishes wallet-signed, ER/PER-accepted, and Solana-committed states.

No analytics event may contain invitation secrets, ballot choices, wallet signatures, meeting titles, or private participant metadata.

---

# 3. Product Language and Core Concepts

## 3.1 Terms

- **Meeting:** A private, scheduled video and audio room with a maximum active duration of 60 minutes.
- **Host:** The wallet that creates the meeting and can control admission, voter eligibility, vote creation, and early meeting closure.
- **Participant:** A wallet-authenticated person admitted to the meeting.
- **Voter:** An admitted participant included in the eligibility snapshot for a particular vote round.
- **Observer:** An admitted participant who can participate in the video meeting but is not eligible to vote in a particular vote round.
- **Invite secret:** A high-entropy secret included in an invitation link or represented by a join code. It is not a wallet private key and must never be written to Solana.
- **VRF output:** Verifiable random data returned through MagicBlock's VRF flow. It contributes to a public, non-secret room identifier or room nonce. It is not the invitation secret.
- **ER:** MagicBlock Ephemeral Rollup, used for fast execution of supported delegated account state.
- **PER:** MagicBlock Private Ephemeral Rollup, a privacy-focused ER environment using its documented TEE and access-control model.
- **Private ballot:** The individual choice submitted by one eligible wallet. It is stored only in the designated permissioned private execution environment and is never committed to the public base layer.
- **Vote result:** Public aggregate values produced after the vote is closed and finalized.
- **Meeting receipt:** A deterministic public record describing the completed meeting outcome and the commitments needed to verify it.
- **Receipt digest:** The cryptographic digest calculated from the agreed public receipt fields and committed on Solana.

## 3.2 What “private meeting” means in V1

Concord provides invitation-controlled access and does not publish the meeting name, description, invite secret, participant display names, participant wallet list, meeting discussion, or individual ballot choices to the public base layer.

The on-chain room registry will still expose a minimal record that a room-related program operation occurred. The paying/creating wallet may be visible in Solana transaction history. Concord must not promise that the existence of an on-chain transaction or the creator's wallet identity is hidden.

Video and audio are handled by LiveKit, not by MagicBlock. LiveKit uses encrypted transport for media, but Concord must not claim end-to-end media encryption unless a separate E2EE mode has been implemented and tested. LiveKit room names and participant identities must be opaque identifiers, never meeting titles, email addresses, or other personal information.

## 3.3 What “private vote” means in V1

The product requirement is that individual choices are not available to other participants and are not published to Solana's public base layer. The implementation must prove all of the following before Concord claims this behavior is working:

- Ballots are not stored in PostgreSQL, ordinary server logs, analytics, receipt JSON, or normal API responses. Until the deployed PER tests pass, label private voting as experimental and do not market it as a guaranteed privacy feature.
- A participant cannot query another wallet's ballot through the deployed PER RPC and cannot inspect the tally while the vote is open.
- The program accepts at most one ballot per eligible wallet per vote round and checks the wallet against an eligibility snapshot that cannot change after the vote opens.
- While a vote is open, the UI reveals neither per-option totals nor the identities of wallets that have voted. Even an overall submission count should only be exposed if privacy tests show it is safe; default to not displaying it.
- After finalization, only aggregate counts, the outcome, intended public question/options, and approved receipt fields may be published. No account containing a wallet-to-choice mapping is committed to Solana.

The final aggregate result and receipt are public. The host previews and confirms the disclosure before commitment. PER privacy is not a zero-knowledge proof: the trust model includes program correctness, MagicBlock PER/TEE and access-control implementation, and the selected account lifecycle. Receipt hashing proves consistency with committed fields; it does not independently prove that a real-world meeting happened or that every off-chain statement was true. If deployed PER permissions cannot satisfy the requirements, stop and redesign before shipping the private-voting claim.

---

# 4. User Roles and Permissions

| Action | Host | Admitted voter | Admitted observer | Unadmitted invitee |
|---|---|---|---|---|
| View landing page and FAQ | Yes | Yes | Yes | Yes |
| Create meeting | Yes, after wallet authentication | Yes, after wallet authentication | Yes, after wallet authentication | No until authenticated |
| Request room entry | Yes | Yes | Yes | Yes, with valid invite |
| Admit/reject waiting participants | Yes | No | No | No |
| Publish own camera/microphone | Yes | Yes | Yes | No |
| See admitted participant list | Yes | Yes | Yes | No |
| Change voter eligibility | Yes, before an individual vote opens | No | No | No |
| Create/open/close vote | Yes | No | No | No |
| Cast vote | Only if host is eligible for that vote | Yes, if included in frozen eligibility snapshot | No | No |
| See private individual ballots | No | No | No | No |
| See aggregate vote result | Yes, after finalization | Yes, after finalization | Yes, after finalization | Only via public receipt after publication |
| End meeting early | Yes | No | No | No |
| Finalize after timeout if host is absent | Any wallet that submits the permitted permissionless instruction | Any wallet that submits the permitted permissionless instruction | Same | No access to private room needed unless program rules require it |
| Publish/confirm public receipt | Host | No | No | No |

The on-chain program must enforce voting and finalization constraints. Backend roles are used for media access and waiting-room decisions, not as a substitute for contract validation.

All users who intend to enter the video room or vote must connect a Solana wallet. V1 does not include anonymous guest participation. A wallet is not created by Concord itself. If no wallet is detected, the user is guided to connect an existing supported wallet or create one using a trusted wallet provider, then returns to the meeting flow.

---

# 5. Brand, Interface, and Visual System

## 5.1 Visual direction

Use a clean, minimalistic black and blue interface. It should feel professional and calm, with strong spacing and readable controls. Do not use gradients, glassmorphism, animated backgrounds, decorative emoji, cartoon illustrations, or visual effects that compete with the meeting content.

### Core palette

| Token | Suggested value | Usage |
|---|---|---|
| `background` | `#07090D` | Main page background |
| `surface` | `#10141C` | Cards, modal surfaces, panels |
| `surface-raised` | `#171D28` | Hover states and nested panels |
| `border` | `#252D3A` | Dividers, cards, form borders |
| `text-primary` | `#F5F7FB` | Main text |
| `text-secondary` | `#9AA6B7` | Supporting text |
| `accent` | `#4D8DFF` | Primary action and focus accent |
| `accent-hover` | `#75A6FF` | Hover and active accent |
| `success` | `#40C995` | Confirmed/finalized status only |
| `warning` | `#F3B552` | Pending or expiring status |
| `danger` | `#F16C78` | Error, rejection, leave/end confirmation |

These are starting tokens, not a requirement to hardcode colors in every component. Define CSS variables and use them consistently.

## 5.2 Components and interaction style

- Use rounded pill buttons for primary and secondary actions.
- Use a restrained radius of 12 to 16 px for large cards and meeting panels.
- Use simple Lucide icons, such as `video`, `mic`, `mic-off`, `camera`, `camera-off`, `users`, `shield-check`, `clock`, `copy`, `external-link`, `wallet`, `check-circle`, `alert-circle`, and `log-out`.
- Never use emoji as icons or status indicators.
- Avoid icon-only actions without accessible labels or tooltips.
- Use clear state labels such as `Waiting for randomness`, `Preparing private room`, `Waiting for host`, `Voting open`, and `Receipt confirmed`.
- Include keyboard focus states, sufficient contrast, loading feedback, disabled states, and errors next to the action that caused them.
- Design the meeting room for desktop first because the V1 meeting uses a 20-person video grid. It must still be responsive on tablets and phones, but mobile must not sacrifice voting accessibility or meeting controls.

## 5.3 Public landing page

Route: `/`

The landing page must be a proper marketing and entry point, not just a dashboard with a logo.

### Header

- Concord wordmark and simple mark.
- Navigation links: `About`, `How it works`, `Features`, `FAQ`.
- Right-side primary CTA: `Create a meeting`.
- Secondary header link: `Join a meeting`.
- On mobile, collapse navigation into an accessible menu while keeping the main CTA visible.

### Hero section

Headline: **Meet together. Decide privately. Verify the outcome.**

Supporting text: **Concord brings private video meetings, confidential voting, and verifiable decision records into one experience powered by Solana and MagicBlock.**

Primary CTA: `Create a meeting`.

Secondary CTA: `Join a meeting`.

Visual: a restrained meeting-room interface composition with video tiles, a compact three-option voting panel, and a finalized receipt card. This is a product illustration, not an animated fake meeting. Do not use emojis or stock-photo collages.

Trust line: `Invite-only rooms. Private ballots. Verifiable outcomes.` Use the private-ballot claim only after the deployed PER privacy gates pass. Do not state that all meeting metadata or participant identity is invisible on-chain.

### About section

Explain the problem: communities can meet and discuss online, but votes and decisions often end up scattered across calls, chat reactions, and unstructured notes.

Explain Concord: the discussion happens face-to-face, voting happens inside the meeting, and the outcome can be verified afterward without publishing private ballots or the conversation.

### How it works section

Use four compact steps:

1. **Create a private room.** Connect a wallet, schedule a meeting, and receive an invite link and join code.
2. **Meet face-to-face.** Admit participants and speak over live video and audio.
3. **Vote privately.** Open a proposal with three options and collect eligible participants' ballots.
4. **Verify the decision.** Finalize the result and publish a receipt commitment to Solana.

### Features section

Use compact feature cards for:

- Private invite-only meetings.
- Live video and audio for up to 20 participants.
- Host-controlled voter eligibility.
- Private individual ballots.
- Fast ER/PER-backed coordination.
- VRF-backed room creation.
- Public, verifiable decision receipts.

Every feature must correspond to an implemented requirement. Do not describe features that are merely planned or not yet working.

### FAQ section

Required questions:

1. **Do I need a wallet?** Yes. You need a supported Solana wallet to create or join a meeting and to vote. Concord never asks for your recovery phrase.
2. **Are the meetings public?** No. Meetings are invite-controlled. Minimal blockchain activity can still be publicly observable, including the creator's wallet and public receipt commitment.
3. **Can other people see my vote?** Individual ballot choices are private. The aggregate result is published after the vote is finalized.
4. **Does Concord record meetings?** No. V1 does not record or transcribe meetings.
5. **How long can a meeting last?** Up to 60 minutes after the host starts it.
6. **How many people can join?** Up to 20 participants, including the host, in V1.
7. **What does the on-chain receipt prove?** It proves that the committed receipt digest and public result fields match the finalized program record. It does not publish the private discussion or prove facts that were not included in the committed receipt.

### Final CTA

Headline: **Make the decision. Keep the proof.**

Text: `Create a private meeting, bring your community together, and leave with a verifiable result.`

Buttons: `Create a meeting` and `Join a meeting`.

### Footer

Include Concord, `How it works`, `Privacy model`, `Documentation`, `Solana Explorer` where applicable, and a Devnet indicator. Do not add social channels that do not exist.

---

# 6. Frontend Routes and Screen Specifications

## 6.1 Route map

| Route | Purpose | Authentication |
|---|---|---|
| `/` | Public landing page | No |
| `/create` | Create a meeting | Wallet session required |
| `/join/[roomId]` | Open invite link or submit join code | Wallet required to request entry |
| `/meeting/[roomId]/lobby` | Waiting room for host and invitees | Wallet session required |
| `/meeting/[roomId]` | Live meeting room | Admitted participant only |
| `/meeting/[roomId]/receipt` | Host review and finalize receipt | Host required for editing/finalization |
| `/receipt/[roomId]` | Public receipt and verification | No; public data only |
| `/dashboard` | User's upcoming and recent meetings | Wallet session required |
| `/privacy` | Plain-language privacy and verification explanation | No |

## 6.2 Wallet gate and identity onboarding

Trigger: user clicks `Create a meeting`, `Join a meeting`, or `Vote` without a connected wallet.

Show a centered wallet modal with two actions:

- `Connect a wallet` for an installed supported Solana wallet.
- `Create a wallet` for users without one, explaining that creation happens through a wallet provider.

Never request a seed phrase or private key. Never store wallet key material. After the wallet connects, request a signed, domain-bound authentication challenge before creating or joining a meeting. If the user was trying to create or join a room, preserve that intent and continue to the relevant flow after successful authentication.

On Devnet, clearly show the active network and prompt the user to switch to Devnet if the wallet is connected to another cluster. Never silently send transactions to Mainnet.

## 6.3 Create meeting screen

Fields:

- Meeting name: required, 3 to 80 characters.
- Description: optional, up to 280 characters. Stored off-chain and not included in public receipt by default.
- Schedule: `Start soon` or `Schedule for later`.
- Scheduled date and time: required for scheduled meetings and shown in the user's local timezone. Store as UTC.
- Maximum duration: fixed display value `Up to 60 minutes` and not editable in V1.
- Access mode: `Invite only`, selected by default and the only supported V1 mode.

CTA: `Create private meeting`.

After submit, show a multi-step progress panel instead of a blank loading spinner:

1. `Preparing room request`
2. `Waiting for verifiable randomness`
3. `Setting up private room state`
4. `Preparing secure invitation`
5. `Meeting ready`

Each stage must show success, pending, or recoverable error. The UI must not say the room is ready before VRF fulfilment and private room setup are confirmed.

Once ready, show the invitation link and join code. The full invite secret is displayed only on successful creation and when the host explicitly rotates it. Do not log it. Provide `Copy link`, `Copy join code`, and `Open lobby` actions. The host can rotate the invitation credential if it is exposed; the old credential becomes invalid immediately.

If VRF has not fulfilled yet, retain a draft with `Waiting for randomness`. Do not generate a second VRF request on browser refresh. Fetch and resume the existing request by id. A retry action may be shown only if the program state proves the request failed or expired according to the current VRF implementation.

## 6.4 Join screen

Support either:

- Invite link with an embedded high-entropy secret in the URL fragment, such as `#invite=<secret>`. The fragment is not sent in the initial HTTP request. Client code reads it and submits it in the authenticated request body.
- Manual entry of the join code.

Sequence:

1. Resolve the public room identifier.
2. Require the user to connect a wallet and authenticate.
3. Validate the invitation secret server-side using a stored keyed hash, rate limits, and the room's allowed join window.
4. Create a `pending` join request.
5. Show `Waiting for host approval`.
6. Once approved, show `Enter meeting`.
7. Request a short-lived LiveKit access token from the backend only after approval.

An invite code grants the right to request entry, not automatic admission. Invalid, rotated, expired, canceled, or already-ended invitations must return a generic failure message that does not expose private meeting metadata.

## 6.5 Lobby and waiting-room screen

Host view:

- Meeting name, scheduled time, and countdown to start.
- Copy invite link and code.
- List of pending join requests with wallet-shortened identifier and user-selected display name.
- `Admit` and `Reject` controls.
- List of admitted participants.
- `Start meeting` button, available only within the allowed start window.
- A clear 60-minute duration notice.

Invitee view:

- Meeting title only after a valid invite has been accepted by the backend.
- Display name (3 to 40 characters, no HTML) and wallet indicator.
- Camera/microphone preview and device checks.
- `Request to join` button.
- Waiting status that updates without reloading.

Do not show a public participant directory or allow unapproved users to connect to the LiveKit room.

## 6.6 Live meeting room

Main layout:

- Header: meeting name, elapsed time, time remaining, network status, private-room status.
- Main area: responsive video tile grid.
- Side panel: participants and host admission notifications when applicable.
- Bottom pill control bar: microphone, camera, participants, voting status, leave, and host-only end controls.
- Voting overlay: appears when host opens a vote.

Controls:

- Toggle microphone.
- Toggle camera.
- Choose camera and microphone device from available browser devices.
- Display connection/reconnection state.
- Leave meeting.
- Host-only `End meeting` with confirmation modal.

No chat, screen share, recording, transcription, or emoji reaction controls.

### Participant grid

- Maximum 20 participants, host included.
- Highlight the current speaker using LiveKit active-speaker information where reliable.
- Video off uses a neutral initials/avatar treatment, not an emoji.
- On mobile, show the active speaker and a horizontally scrollable participant strip.
- Never render wallet addresses as large display names. Use the participant's chosen display name and a short wallet suffix in the participant panel.

### Vote creation panel

Host clicks `Start voting` and fills:

- Question: required, 5 to 240 characters.
- Option 1 label: required, 1 to 80 characters.
- Option 2 label: required, 1 to 80 characters.
- Option 3 label: required, 1 to 80 characters.
- Vote deadline: default 5 minutes, capped at the remaining meeting time.
- Eligible voters: select among admitted participants; eligibility is confirmed on-chain before the vote opens.

The host must see a confirmation message: `Eligible voters will be locked for this vote once it opens.`

Only one vote may be open at a time. If a vote is open, the `Start voting` action is disabled.

### Voting panel for participants

- Show the question and three options as accessible radio cards.
- Allow exactly one selection.
- Submit button: `Submit vote`.
- On submission, the client signs/sends the on-chain instruction and waits for the program to confirm acceptance.
- After confirmation, show `Vote submitted` and disable further submission for that wallet and vote.
- During voting, do not show option counts or which people have voted. An overall submitted count is optional and must remain disabled unless the privacy review demonstrates that it does not leak information.
- Do not update the displayed progress solely because a backend request succeeded. Only update after confirmed ER/PER state.
- If an accepted transaction is still pending, show `Confirming your vote` and prevent duplicate submissions. Use an idempotent vote PDA or program-level duplicate check to make replays harmless.

### Vote close behavior

- Each vote uses a simple plurality rule: the option with the highest count wins when it has a unique highest count. If two or three options tie for the highest count, the outcome is `TIE`. If zero ballots are accepted, the outcome is `NO_DECISION`. V1 has no quorum or weighted-voting logic. The host-defined option labels are presentation text; the program stores option indices and hashes and does not give any option a special meaning.
- Host can close a vote early.
- A vote stops accepting ballots at its on-chain deadline or when the meeting's maximum duration is reached, whichever comes first.
- After close, the program finalizes the aggregate counts from private ballots and prepares a separate public result account.
- Individual ballots remain in private accounts. Never commit an account that contains an individual choice.
- The aggregate result is committed to the base layer as a separate, intentionally public account.
- If the host disconnects after a deadline, the permitted permissionless close/finalize instruction must allow the vote to progress without host availability.

## 6.7 Meeting receipt screen

Once the meeting is ended, the host reviews the receipt before committing it.

Receipt fields:

- Public room identifier.
- Meeting start and end timestamps.
- Number of finalized vote rounds.
- For each vote: question, three option labels, aggregate count for each option, final decision according to the selected rule, and voting close time.
- Optional action items entered by the host after discussion. Each item has a short text description and optional owner display name; do not publish owner wallet addresses by default.
- VRF result digest or reference, where supported by the current VRF program.
- Public summary account address and transaction signatures after commit.
- Receipt digest.

The host sees a clear disclosure preview that states: `The information shown below will be public and permanently linked to the Solana transaction. Private ballots, attendee names, and meeting media are not included.`

The host can edit optional action items before committing. The host cannot edit finalized vote questions, options, totals, or outcomes. To correct a mistake in optional receipt text, the host must revise it before final commit. After commit, the receipt is immutable. Do not provide an edit action that silently changes committed content.

CTA: `Commit receipt to Solana`.

Statuses:

- `Preparing receipt`
- `Waiting for wallet approval`
- `Submitting public result`
- `Confirming on Solana`
- `Receipt verified`
- `Commit failed, retry available`

Retry must be idempotent. If the transaction succeeded but the browser missed the confirmation, inspect the on-chain state before sending another transaction.

## 6.8 Public receipt verification page

Route: `/receipt/[roomId]`.

Show only receipt data intentionally made public by the host. Provide:

- Final questions and option labels.
- Aggregate results and decisions.
- Approved action items, if present.
- Receipt digest.
- Solana cluster label (`Devnet` in V1).
- On-chain account address and confirmed transaction signature.
- `View on Solana Explorer` link using the configured Devnet explorer URL.
- `Verify receipt` button that recalculates the deterministic digest from the public receipt data and compares it with the committed account.

Result statuses:

- `Verified`: computed digest matches the on-chain account and the required account fields match the published receipt.
- `Mismatch`: public data does not match the committed account.
- `Not yet committed`: no finalized public record is available.
- `RPC unavailable`: could not complete verification; this is not a success or a mismatch.

Never show `Verified` just because the backend database contains a receipt.

---

# 7. End-to-End Workflows

## 7.1 Create meeting workflow

1. User clicks `Create a meeting` on the landing page.
2. If no wallet is connected, show wallet modal with `Connect a wallet` and `Create a wallet` guidance.
3. User connects wallet and signs an authentication challenge.
4. Frontend validates the network is Devnet.
5. User submits meeting name, optional description, and scheduled time.
6. Backend creates an off-chain draft and returns an opaque internal identifier.
7. Frontend constructs the room setup transaction using the program IDL and the connected wallet.
8. Wallet signs the VRF request transaction. The program validates host authority and requested schedule bounds.
9. The program requests MagicBlock VRF using the current documented queue and callback pattern. It does not trust a client-supplied random value.
10. After the verified callback, the program derives/records a non-secret room identifier or room nonce.
11. Frontend resumes by reading program state, not by assuming success from a submitted transaction signature.
12. The frontend initializes the private room state and account permissions in the selected PER configuration.
13. The backend creates a cryptographically random invitation secret and join code, stores only a keyed hash, and associates the opaque LiveKit room name with the meeting.
14. The host receives the invitation link/code and lobby controls.
15. If any step fails, show the exact recoverable stage. Never create a duplicate room because of a browser refresh.

### VRF and access credential rule

VRF is mandatory for V1 room creation. Its output contributes to a verifiable, non-secret room identifier or room nonce. The actual invite credential is separately generated using a cryptographically secure random-number generator and stored only as a keyed hash. **Never derive a short invitation code directly from a public VRF output.** Anyone who can read the output could calculate such a code, defeating private admission.

The implementation must follow the current official MagicBlock VRF example for callback and queue setup. Do not invent VRF program IDs, queue addresses, or callback account metas. Pin the compatible SDK/program versions and add a test that demonstrates successful fulfilment on the selected Devnet/ER environment.

## 7.2 Join and admission workflow

1. Invitee opens the link or enters the code.
2. Invitee connects a Solana wallet and signs an authentication challenge.
3. Client sends the invite secret to the backend in the request body. It must not be logged.
4. Backend validates the keyed invite hash, room status, join window, current capacity, and rate limits.
5. Backend creates a join request in `PENDING_HOST_APPROVAL`.
6. Host receives a waiting-room notification.
7. Host approves or rejects the request.
8. If approved, the backend marks the participant `ADMITTED`. This permission allows media access only. Voting eligibility remains a separate per-vote on-chain decision.
9. Invitee requests a LiveKit token.
10. Backend verifies admission again and returns a short-lived token with the correct opaque room name and wallet-based opaque participant identity.
11. Client connects to LiveKit. Camera and microphone permissions are requested locally.
12. LiveKit participant events update the meeting UI. The backend verifies LiveKit webhook signatures before using server events to update persisted media state.

The backend must enforce the 20-participant cap before issuing a token and re-check capacity when admitting participants. If race conditions allow simultaneous admissions, LiveKit's actual room count must be checked and excess join requests rejected before token issuance.

## 7.3 Open vote workflow

1. Host fills the question, exactly three options, vote deadline, and eligible voter selection.
2. Frontend validates the form and previews the frozen eligible voter list.
3. Host confirms the voter snapshot.
4. Each eligibility change is applied through a permitted on-chain/PER instruction and waits for confirmation.
5. Host sends `open_vote` through the connected wallet.
6. Program verifies the host, meeting status, no other active vote, the three non-empty option labels, deadline, eligibility snapshot, and remaining meeting time.
7. Program freezes eligibility for that vote round and creates private vote state.
8. Vote UI appears for all participants. Ineligible participants see the question as read-only and cannot submit.

## 7.4 Cast vote workflow

1. Eligible voter selects exactly one option.
2. Frontend builds the vote instruction and submits through the MagicBlock ER/PER route required for the delegated account.
3. Program checks: meeting active, vote open, deadline not passed, wallet belongs to the frozen eligibility snapshot, no accepted ballot already exists for this wallet/vote, and option index is valid.
4. Program writes the selected index to the voter's deterministic private ballot account. The initial design does not update a shared option counter while the vote is open, because shared counters can create an avoidable information channel.
5. UI waits for ER/PER state confirmation.
6. UI changes to `Vote submitted` only after the program state confirms acceptance.
7. Other clients see no per-option totals or voter-to-choice mapping. An overall submission count is exposed only if privacy tests approve it; otherwise show the vote status without a count.

## 7.5 Close and finalize vote workflow

1. Host closes early, or the configured deadline/meeting expiry prevents new ballots.
2. Program transitions vote `OPEN -> CLOSING`; further `cast_vote` calls are rejected based on authoritative on-chain clock/state.
3. The finalization instruction supplies the full eligibility snapshot's expected ballot PDA set. The program validates that set and computes the tally from private ballot accounts inside PER. Account-access and transaction-size behavior must pass the integration tests with up to 20 eligible wallets.
4. Program writes only aggregate counts, option/question hashes, eligible/submitted counts, outcome code, and a summary digest into the separate public-result account.
5. Result visibility changes only after the result is frozen, then the account is committed through the currently documented lifecycle. Prove there is no pre-finalization public read path.
6. Frontend waits for confirmed/finalized base-layer state and independently verifies the public result account.
7. Vote becomes `COMMITTED` and aggregate totals are visible. Private ballot accounts remain private and are never committed.

If a vote's individual ballot records cannot be read and counted by the deployed program under the documented PER permissions model, treat that as a blocking architecture issue. Do not simulate private voting with a normal database table or a standard public ER account while claiming the ballot is private.

## 7.6 End meeting and publish receipt workflow

1. Host ends the meeting early, or the 60-minute maximum is reached.
2. New joins are rejected immediately. If a vote remains open, it stops accepting ballots at the meeting end timestamp and enters finalization.
3. Ensure every vote is finalized. If the host is disconnected, the permissionless timeout path can finish any expired vote.
4. Backend closes/revokes LiveKit admission. The host and participants disconnect. No recording is created.
5. Host sees a receipt preview assembled from verified public vote summaries and optional action items.
6. Host confirms public disclosure and submits `finalize_meeting` with receipt commitment fields through the connected wallet.
7. On-chain program validates that each vote summary was finalized and committed, validates the meeting end state, and stores the public receipt digest in the public registry/receipt account.
8. Commit the public receipt account if it was delegated. Only this purpose-built public account may be committed. Never commit private room or ballot accounts.
9. Frontend reads the confirmed public account, reconstructs the receipt digest, and displays `Receipt verified` only if all fields match.
10. Public verification page becomes available. Invitation links and join codes are invalidated.

---

# 8. Transaction and Lifecycle State Machines

## 8.1 Meeting lifecycle

Use a meeting lifecycle state separate from individual vote status.

`DRAFT -> VRF_PENDING -> PRIVATE_STATE_SETUP -> SCHEDULED -> WAITING_ROOM -> LIVE -> FINALIZING -> RECEIPT_PENDING -> FINALIZED`

Terminal alternatives: `CANCELLED`, `EXPIRED`, `FAILED`.

| State | Meaning | Permitted next states |
|---|---|---|
| `DRAFT` | Metadata exists off-chain; no on-chain room is ready | `VRF_PENDING`, `CANCELLED`, `FAILED` |
| `VRF_PENDING` | VRF request submitted and callback not yet confirmed | `PRIVATE_STATE_SETUP`, `FAILED`, `CANCELLED` if program supports safe cancellation |
| `PRIVATE_STATE_SETUP` | Randomness fulfilled; PER accounts and permissions being initialized | `SCHEDULED`, `FAILED` |
| `SCHEDULED` | Room is initialized and waiting for the allowed start window | `WAITING_ROOM`, `CANCELLED`, `EXPIRED` |
| `WAITING_ROOM` | Invitees can request admission; host has not started media meeting | `LIVE`, `CANCELLED`, `EXPIRED` |
| `LIVE` | Host started meeting; 60-minute clock is running | `FINALIZING` |
| `FINALIZING` | No new vote may remain open; finalize incomplete expired votes | `RECEIPT_PENDING` |
| `RECEIPT_PENDING` | Host-reviewed receipt is awaiting on-chain commitment | `FINALIZED`, `RECEIPT_PENDING` after retry |
| `FINALIZED` | Receipt is committed and digest verified | Terminal |
| `CANCELLED` | Host canceled before meeting started | Terminal |
| `EXPIRED` | Meeting never started in its permitted window | Terminal |
| `FAILED` | Irrecoverable room setup failure | Terminal unless an explicit retry transition exists |

### Time policy

- The host may start up to 15 minutes before the scheduled time.
- Invitees may request admission up to 15 minutes before the scheduled time.
- If the host has not started within 30 minutes after the scheduled time, the meeting expires.
- Once started, the meeting ends no later than 60 minutes after the on-chain start timestamp.
- Early host closure is permitted.
- Server and browser clocks are used for display only. Program instructions enforce any contract-critical expiry using the authoritative on-chain clock.

## 8.2 Vote lifecycle

`DRAFT -> OPEN -> CLOSING -> FINALIZED -> COMMIT_PENDING -> COMMITTED`

Alternative: `FAILED` only for a recoverable program/RPC fault that leaves enough state to retry safely. Never label a vote `FAILED` merely because the frontend timed out.

| State | Meaning |
|---|---|
| `DRAFT` | Host is configuring a vote. No ballot can be submitted. |
| `OPEN` | Eligible wallets can submit exactly one ballot each. |
| `CLOSING` | Host closed voting or deadline passed. New ballots are rejected. |
| `FINALIZED` | Private tally is computed and final aggregate values are fixed. |
| `COMMIT_PENDING` | Separate public aggregate result account is ready for commit. |
| `COMMITTED` | Aggregate result account is confirmed on Solana. |

## 8.3 Transaction UI statuses

Every wallet-backed operation must display one of:

- `Ready for wallet approval`
- `Awaiting wallet signature`
- `Submitted`
- `Confirming on execution layer`
- `Waiting for VRF callback`
- `Waiting for account delegation`
- `Committing result to Solana`
- `Confirmed`
- `Failed, safe to retry`
- `Failed, support details available`

Do not automatically resend a transaction solely because the client timed out. First inspect the signature and relevant on-chain state. Operations need request/operation IDs and on-chain idempotency checks to prevent duplicate rooms, votes, receipts, and commits.

---

# 9. Solana Program and MagicBlock Design

## 9.1 Chosen architecture

Use one Anchor program, named `concord`, with separate account types for public state and private state. Integrate the currently supported MagicBlock ER/PER SDK and VRF SDK versions from the official repositories. Do not guess program IDs, delegation program IDs, VRF queue addresses, RPC URLs, or account-meta layouts.

The architecture uses:

- **Solana base layer:** room registry, verified VRF request/result linkage, finalized public vote summaries, and finalized receipt commitment.
- **MagicBlock ER/PER:** active room coordination state, voter eligibility snapshots, individual ballots, private tally accumulator, and private workflow transitions.
- **LiveKit:** media tracks and room networking only.
- **Backend database:** meeting metadata, invitation-secret hashes, admission requests, opaque LiveKit mapping, auth nonces/sessions, and non-sensitive UI metadata. Never store ballot choices in the database.

The private account design must use PER and its documented access-control model. A standard ER is insufficient for any state described by Concord as private.

## 9.2 Account model and data classification

The following is a **logical design**, not an assumption that every account can be initialized, delegated, read, committed, or undelegated in this exact order. The first implementation phase must verify the selected SDK and PER deployment. Keep the public/private boundary explicit in Rust account types and tests.

### A. `RoomRegistry` (public base-layer PDA)

Purpose: identify the meeting on-chain and bind the VRF request/result plus the eventual public receipt digest. Candidate fields:

- `room_id: [u8; 32]`
- `creator: Pubkey`
- `vrf_request_reference` or a supported reference/digest to the verified request
- `vrf_output_digest: [u8; 32]` after fulfillment
- `created_at: i64`
- `receipt_status: enum`
- `receipt_digest: Option<[u8; 32]>`
- `public_receipt_account: Option<Pubkey>`
- `bump: u8`

Never place the private room name/description, invitation secret or hash, private schedule, participant roster, voter list, ballot values, media credentials, or LiveKit room names in this account. A Solana transaction still reveals the creator wallet and that an on-chain operation occurred.

### B. `PrivateRoomState` (permissioned delegated account on the chosen PER)

Purpose: authoritative private room lifecycle used by program instructions. Candidate fields include `room_id`, `host_wallet`, `scheduled_start_at`, `started_at`, `ended_at`, lifecycle enum, fixed `max_duration_seconds = 3600`, fixed `max_participants = 20`, active vote ID, and private roster/eligibility data necessary to validate participation.

Do not expose this whole account to every participant if it contains roster, access state, or other sensitive values. Current PER documentation describes account-level permissions and states that a permission currently implies read access to the delegated account. Do not assume write-only member access unless the pinned deployment actually supports it.

### C. `VoteState` and eligibility snapshot (private PER state)

One state per vote round. Candidate fields: room ID, vote ID, host, question/option hashes, open/close timestamps, vote status, fixed eligible-wallet set or another validated private membership representation, eligible count, and snapshot digest. Once the vote opens, the eligibility set is immutable.

Question/option labels may be kept off-chain and bound by hash if the host does not want them public before close. A hash alone does not hide low-entropy values from guessing, so do not describe a content hash as encryption.

### D. `PrivateBallot` (one deterministic private account per `(room_id, vote_id, voter_wallet)`)

Candidate fields: room ID, vote ID, voter wallet or derivation evidence, selected option index `0..=2`, accepted timestamp, and bump. The PDA must make duplicate submission for the same wallet and vote impossible. Each ballot's PER read policy should not grant other participants permission to inspect its contents.

The first tallying design to validate is: the close/finalize instruction receives every expected ballot PDA derived from the frozen eligibility set. The program verifies that the supplied list is complete and in the expected order, reads valid ballot accounts inside PER, and computes the final tally. V1 has at most 20 connected participants, so this explicit-account pattern is small enough to test, but it must still be checked against account-meta, compute, and authorization constraints. Missing/uninitialized ballot accounts count as no submitted ballot, not as a choice.

Do not rely on the program scanning arbitrary accounts. Solana programs do not have a general account-enumeration primitive; required accounts must be passed to the instruction or represented by another documented design.

### E. `PublicVoteSummary` (separate aggregate-only account)

This is the only vote account intended to become public after finalization. It contains no ballot records or wallet-to-choice mapping. Candidate fields: room ID, vote ID, question hash, three option hashes, final counts, eligible/submitted counts, outcome enum (`OPTION_0`, `OPTION_1`, `OPTION_2`, `TIE`, `NO_DECISION`), close timestamp, eligibility-snapshot digest, summary digest, and finalized flag.

Keep result fields unavailable to unauthorized readers while the vote is open. At finalization, compute the totals inside the validated PER instruction path, populate this separate summary, freeze it, then make aggregate results public and commit them. Prove the permission transition and commit lifecycle in integration tests. If the deployment cannot safely do this, the privacy requirement is not complete.

### F. `PublicMeetingReceipt` (public immutable account)

The receipt contains room identifier, ordered public vote-summary references/digests, approved action-items hash, explicitly intended public timestamps, VRF result digest/reference, receipt digest, finalized timestamp, and bump. Keep attendee names, voter wallet lists, invitation data, media credentials, and individual ballots out of it.

### G. What lives off-chain

PostgreSQL stores users by wallet address, one-time auth nonces, session metadata, private meeting display metadata, schedule/UI state, invitation-secret keyed hashes, join requests/admission decisions, opaque LiveKit room/participant mappings, webhook idempotency records, and draft receipt/action-item text before finalization. It must not store ballot choices or an authoritative vote tally. Any cached public receipt is never the source of truth for verification.

## 9.3 Required instruction capabilities

Instruction names describe required behavior; final Rust names and account lists must follow the pinned official SDK examples. Do not generate a fictional IDL from this list.

### Room setup and lifecycle

1. `request_room_randomness`: request VRF through the documented SDK; persist request reference and pending state.
2. VRF callback/fulfillment handler: accept only the verified callback path. Never accept a client-supplied random value as verified output.
3. `initialize_room_registry`: derive/register a non-secret room identifier bound to verified VRF output.
4. `initialize_private_room`: initialize permissioned private room state and supported PER permission record.
5. `start_meeting`: host-only; enforce permitted start window and set authoritative start time.
6. `end_meeting`: host may end early; prevent new votes and new joins after closure.
7. `expire_meeting` or equivalent: permissionless lifecycle transition after the maximum duration, using authoritative program time checks.

### Admission and eligibility

8. `register_or_authorize_participant`: only if the final PER/account model needs an on-chain participant record. Do not put a public roster on base layer.
9. `set_voter_eligibility`: host-only and allowed only before the relevant vote opens.
10. `open_vote`: validate active meeting, exactly three valid options, deadline, no other active vote, and eligibility snapshot; freeze the snapshot atomically where supported.

### Voting

11. `cast_vote`: validate meeting/vote windows, frozen eligibility, option index, and absence of a prior ballot PDA. Write the ballot to private PER state.
12. `close_vote`: host can close early; reject further ballots after close transition.
13. `finalize_vote`: permissionless once deadline/meeting expiry applies; validate the complete expected ballot account set, calculate aggregates inside PER, and write an aggregate-only summary.
14. `publish_vote_summary` or equivalent visibility transition: run only after summary is frozen; use the permission/commit mechanism confirmed in the technical proof.
15. Commit/finalize the public summary using the current MagicBlock account lifecycle. Make retries idempotent.

### Receipt

16. `prepare_receipt`: require meeting finalization, no active vote, all summaries finalized/public, and valid approved receipt fields.
17. `finalize_receipt`: calculate/validate a deterministic digest and enforce write-once semantics.
18. Commit the public receipt through the documented lifecycle; never commit private state containing ballots or roster values.

A UI action is not complete until its real program instruction, IDL account schema, confirmation state, and test exist. If lifecycle mechanics require fewer or more instructions, update this list based on current SDK behavior rather than forcing implementation into fictional names.

## 9.4 MagicBlock execution, permission, and commit policy

- Use the current official ER/PER SDK for routing, delegation, permission setup, account-status inspection, commitment, and undelegation.
- ER is the candidate execution layer for low-latency coordination state; it is not private by default. PER is the candidate environment for ballot state and privacy-sensitive state.
- PER's member permissions and authenticated RPC query behavior must be proven against the selected endpoint. Current docs describe account-level permissions and flags for authority, transaction logs, balances, messages, and signatures; the authorization overview notes that permissions currently imply read access to the delegated account. Do not model these permissions as arbitrary write-only ACLs unless the selected deployment supports that.
- Do not add every voter to a shared private accumulator if this grants them read access to option totals. Prefer individual ballot accounts and tally at close, subject to the explicit-account tally feasibility test.
- Do not assume the program can enumerate private ballot PDAs. Pass required accounts and validate the complete set, or adopt another documented pattern.
- Do not commit private ballots, private rosters, shared state containing ballot choices, or other sensitive data. A commit makes the committed account state available on the public base layer.
- Keep `wallet accepted`, `ER/PER execution accepted`, `state committed to Solana`, and `finalized/verified` as separate status transitions.
- VRF output is public/verifiable entropy, not an invitation secret. Generate invite secrets separately with a cryptographically secure random-number generator, use high entropy, store only a keyed hash, and rate-limit attempts.
- VRF's product role in V1 is modest: it provides a verifiable non-secret session nonce/initialization input. It does not by itself improve admission security or confidentiality. If that integration proves ornamental rather than useful, make an explicit product decision before release; do not overstate its value.
- A finalized receipt hash binds exact data to a digest. It does not prove discussion content, real-world truth, participant consent, or correctness beyond the assumptions of the program and deployed rollup/TEE system.

## 9.5 Receipt digest format

Implement one deterministic encoding and document it in code and tests. Do not hash arbitrary JSON produced by multiple serializers unless a canonical JSON standard is used.

Recommended fixed-field digest:

`SHA256("CONCORD_RECEIPT_V1" || room_id || vrf_result_digest || started_at_i64_le || ended_at_i64_le || vote_count_u32_le || ordered_vote_summary_digests || action_items_hash)`

Each `PublicVoteSummary.summary_digest` must itself bind the room ID, vote ID, question hash, three option hashes, the three finalized counts, eligible count, submitted count, outcome code, close timestamp, and eligibility snapshot hash. The program must compute this digest from validated program state or validate it against those fields. The client verifier uses the same byte encoding and fixed-width integer rules. Supply unit tests and cross-language test vectors proving that Rust and TypeScript compute identical digests.

The public receipt JSON must include the question, options, aggregate counts, outcome, and action items that correspond to the committed hashes. The verification page recomputes each content hash and the receipt digest. If a hash does not match, report a mismatch rather than assuming the data is correct.

## 9.6 Mandatory MagicBlock feasibility gates

Run these as explicit integration tests before building the full meeting UI. Record source commit/version, commands, endpoint, test account addresses, and results in `docs/architecture/magicblock-proof.md`.

**Gate A: versions and routing**

- Pin a compatible Rust, Solana/Agave, Anchor, `ephemeral-rollups-sdk`, TypeScript SDK, and VRF package matrix from current official examples.
- Initialize, delegate, execute against, commit, and read back a simple test account using the selected Devnet ER/PER endpoint.
- Prove the app distinguishes ER/PER execution acceptance from a base-layer commit.

**Gate B: VRF lifecycle**

- Request randomness using the current official SDK example.
- Verify the callback/fulfillment changes the correct request state and arbitrary caller-supplied output is rejected.
- Refresh/retry during pending fulfillment and prove no duplicate room request is generated.
- Confirm the selected flow works on the target environment. Do not infer PER compatibility from an ER-only example.

**Gate C: private ballot write and read isolation**

- Initialize deterministic private ballot accounts per voter/vote.
- Verify an eligible voter can submit a ballot through the intended client/auth flow.
- Verify the voter cannot query another ballot; an observer and unapproved wallet cannot query any ballot.
- Inspect query responses, transaction logs, signatures/message visibility, account snapshots, and RPC responses, not just frontend UI.
- Test whether the program can read all supplied ballot accounts inside PER at close without granting voters access to other ballots.

**Gate D: tally completeness and correctness**

- Pass the complete frozen eligibility set's expected ballot PDAs to the tally instruction. Validate expected count, order, derivations, owner/discriminator/state, and vote ID.
- Test missing ballots, empty ballot accounts, duplicate account metas, unexpected accounts, malformed values, zero ballots, every option, ties, late ballots, and 20 eligible voters.
- Prove a caller cannot omit a ballot that would change the result or substitute a fabricated ballot.
- Keep pre-close submitted-count display disabled unless the privacy review approves it.

**Gate E: no premature public result**

- During an open vote, inspect base-layer account bytes and PER query paths as an unauthorized participant. No option totals or ballot values may be discoverable.
- Finalize inside PER, create the aggregate-only summary, change visibility only after the result is frozen, then commit it using the documented lifecycle.
- Read the base-layer account after finalization and prove it contains aggregates/hashes only.
- Confirm retries after a lost client confirmation do not duplicate or mutate the summary.

**Gate F: receipt verification**

- Confirm summary/receipt digest test vectors match byte-for-byte in Rust and TypeScript.
- Commit the receipt and reconstruct it independently from public data.
- Alter any public field and confirm the verifier reports mismatch.

If Gates C, D, or E fail, this is a blocking architecture issue. Do not quietly store votes in PostgreSQL, fall back to a public ER account, or ship a mocked vote while saying private voting is complete. Investigate an alternate design and update the PRD before proceeding. Local permission emulation or query-filtering tests help but do not alone establish behavior of the deployed TEE/PER environment.

---

# 10. Backend Architecture and API Contract

## 10.1 Backend responsibilities

The backend is responsible for:

- Wallet-signature challenge and session management.
- Off-chain meeting display metadata and scheduling.
- Generation and keyed hashing of invite secrets.
- Join-code rate limiting and join-request records.
- Host approval workflow.
- Issuing LiveKit tokens only to approved participants.
- Verifying LiveKit webhook signatures and tracking media-room lifecycle.
- Serving receipt JSON and public verification inputs.
- Reading/verifying on-chain records for API responses and support diagnostics.

The backend is not authoritative for:

- VRF validity.
- Contract ownership or vote eligibility.
- Acceptance of ballots.
- Duplicate-vote prevention.
- Final vote totals.
- Whether a receipt was committed.

These must come from program state and verified on-chain data.

## 10.2 API style

Use versioned JSON APIs under `/api/v1`. Validate all request and response payloads with shared Zod schemas. Use consistent errors:

```json
{
  "error": {
    "code": "MEETING_NOT_JOINABLE",
    "message": "This meeting is not accepting join requests.",
    "requestId": "opaque-request-id"
  }
}
```

Do not expose private room configuration, invite hashes, individual ballots, LiveKit secrets, or session secrets through error payloads or logs.

## 10.3 Authentication endpoints

### `POST /api/v1/auth/nonce`

Request:

```json
{ "walletAddress": "<base58-public-key>" }
```

Response:

```json
{
  "nonceId": "opaque-id",
  "message": "Concord sign-in message bound to app origin and nonce",
  "expiresAt": "ISO-8601 timestamp"
}
```

Behavior:

- Create a cryptographically random, single-use nonce with a short expiry.
- Include app domain, purpose, nonce, issue time, and expiry in the signed message.
- Rate-limit by IP and wallet address.
- Do not authenticate the user yet.

### `POST /api/v1/auth/verify`

Request includes `walletAddress`, `nonceId`, and wallet signature.

Response: `{ "user": { "walletAddress": "..." } }` with a secure, HttpOnly, SameSite cookie set by the server.

Behavior:

- Verify the signature over the exact stored message.
- Reject reused, expired, cross-domain, or mismatched nonces.
- Never accept a wallet address without signature proof.
- Never request or store the user's private key or seed phrase.
- Wallet signatures authenticate the session; on-chain transactions still require the connected wallet to sign their transaction payloads.

### `POST /api/v1/auth/logout`

Invalidate the session and clear its cookie.

## 10.4 Meeting metadata endpoints

### `POST /api/v1/meetings/drafts`

Host-authenticated request:

```json
{
  "name": "Community roadmap meeting",
  "description": "Optional private description",
  "scheduledStartAt": "ISO-8601 UTC timestamp"
}
```

Response:

```json
{
  "meetingId": "opaque-app-id",
  "roomId": null,
  "status": "DRAFT",
  "maximumDurationSeconds": 3600,
  "maximumParticipants": 20
}
```

This endpoint creates off-chain metadata only. It does not mark the meeting as on-chain-created and does not fulfill VRF. The frontend must submit the required wallet-signed program instruction. The backend then reads verified program state before changing the UI status to `SCHEDULED`.

### `GET /api/v1/meetings/:meetingId`

Returns safe display metadata, the derived lifecycle status after checking the current program state, time bounds, and the authenticated user's access level. Never return invite hashes or private ballot values.

### `GET /api/v1/meetings/:meetingId/join-requests`

Host-only. Returns pending join requests and their display names, wallet-shortened identifiers, and timestamps. It must not return invite secrets.

### `POST /api/v1/meetings/:meetingId/join-requests`

Request:

```json
{
  "inviteSecret": "<secret from fragment or manually entered code>",
  "displayName": "Taylor"
}
```

Requires an authenticated wallet session. Response:

```json
{
  "joinRequestId": "opaque-id",
  "status": "PENDING_HOST_APPROVAL"
}
```

Behavior:

- Verify keyed invite hash in constant-time where applicable.
- Check meeting status and join window.
- Rate-limit invalid attempts and apply temporary lockout after repeated failures.
- Enforce capacity based on actual admitted/connected room state.
- Do not log the request body containing the invite secret.

### `POST /api/v1/meetings/:meetingId/join-requests/:requestId/decision`

Host-only request:

```json
{ "decision": "APPROVE" }
```

or

```json
{ "decision": "REJECT" }
```

Response contains the resulting request status. On approval, the backend marks the participant admitted for media access. It does not automatically make them a voter.

### `POST /api/v1/meetings/:meetingId/invitation/rotate`

Host-only. Generates a new link secret and join code, invalidates prior credentials, stores only keyed hashes, and returns the new secret once. Protect with reauthentication or wallet signature for high-impact rotation.

## 10.5 LiveKit endpoints

### `POST /api/v1/meetings/:meetingId/livekit-token`

Request:

```json
{ "joinRequestId": "opaque-id" }
```

Response:

```json
{
  "serverUrl": "wss://<configured-livekit-host>",
  "participantToken": "<short-lived-signed-token>",
  "expiresAt": "ISO-8601 timestamp"
}
```

Rules:

- The current wallet session must match the admitted participant.
- The join request must be approved and the meeting must be in a joinable state.
- Issue a short-lived LiveKit token with the opaque room name and opaque participant identity.
- The token must grant only necessary capabilities. V1 participants may publish/subscribe to audio and video after admission.
- Only the host token may have moderation-related grants, and only where needed.
- Keep `LIVEKIT_API_SECRET` server-only. Never expose it through a `NEXT_PUBLIC_` variable, frontend bundle, API response, or source map.
- Check room capacity before token creation and reconcile with actual LiveKit participant count.

### `POST /api/v1/webhooks/livekit`

Behavior:

- Verify LiveKit's webhook signature using the official SDK.
- Accept only known event types needed for room/participant state.
- Treat webhook delivery as retryable and idempotent.
- Use server event data to update media-room status only. Never use LiveKit data as proof that a vote was accepted.

## 10.6 Receipt endpoints

### `GET /api/v1/receipts/:roomId`

Return only the public receipt JSON and public on-chain verification references. If the receipt is not committed, return `NOT_YET_COMMITTED`. The endpoint must not return private meeting metadata, participant names, or ballots.

### `POST /api/v1/meetings/:meetingId/receipt-draft`

Host-only. Accept optional action items and receipt display data. This endpoint stores a draft for user convenience. It does not publish or finalize a receipt. The on-chain program remains the authority for vote summaries and result fields.

The client computes the receipt digest from the specified deterministic encoding. The program must validate the relevant summary hashes and finalized vote commitments before accepting the receipt digest. Do not trust a backend-calculated tally.

## 10.7 API security and operational rules

- All endpoints validate content type and payload size.
- Apply CSRF protection if cookie-authenticated mutations are used.
- Use secure, HttpOnly, SameSite cookies and rotate session IDs after authentication.
- Restrict CORS to configured Concord origins.
- Rate-limit authentication, invitation validation, join requests, token minting, and any operation that can incur external cost.
- Redact invitation secrets, signatures, cookies, LiveKit tokens, and wallet-auth messages from application logs where applicable.
- Verify transaction status from configured RPC/program state before returning a final success state.
- Do not return private PER account data through broad account fetch endpoints.
- Validate all LiveKit webhook signatures.
- The public API must not have any endpoint that accepts an arbitrary tally and publishes it without validating against the finalized program summary.

---

## 10.8 System architecture and component connections

This section defines which component owns each decision and the direction of requests. Concord should be one Next.js modular monolith plus one Anchor program. Do not introduce microservices unless a chain watcher or scheduled-room expiry worker proves necessary.

### 10.8.1 Logical architecture

```mermaid
flowchart TB
  U[Host and participant browser] --> UI[Next.js App Router UI]
  UI -->|HTTPS JSON| API[Next.js Route Handlers - Node runtime]
  UI -->|wallet-signed transactions| WALLET[Solana wallet]
  WALLET -->|base-layer transactions| SOL[Solana Devnet]
  WALLET -->|supported ER/PER route| MB[MagicBlock ER / PER endpoints]
  API --> DB[(PostgreSQL)]
  API -->|short-lived participant token| LK[LiveKit Cloud]
  UI <-->|WebRTC media| LK
  API -->|verified reads and public receipts| SOL
  API -->|PER auth/status reads if required| MB
  SOL --> PROGRAM[Concord Anchor program]
  MB -->|delegated state execution| PROGRAM
  PROGRAM -->|public summaries and receipt only| SOL
  VRF[MagicBlock VRF service/program] -->|verified randomness callback| PROGRAM
```

The drawing is logical, not a claim that every transaction is sent through one endpoint. Follow the current MagicBlock SDK for exact routing, authentication, delegation, and commitment semantics.

### 10.8.2 Component responsibilities and contracts

| Component | Owns | Connects to | Must not do |
|---|---|---|---|
| Landing and app UI | Layout, forms, local device selection, user-visible status | Next.js APIs, wallet adapter, LiveKit client, typed Anchor/MagicBlock client | Hold API secrets; decide authoritative eligibility or tally; report unconfirmed transactions as complete |
| Wallet connector | Connect wallet, sign auth challenge, sign on-chain transactions | Browser wallet provider | Export or persist seed/private keys |
| Auth module | Nonce verification, session cookie, origin and replay protection | Signature bytes, wallet public key, database | Trust an address without signature proof |
| Meeting service | Draft metadata, invitation rotation, join requests, host admission workflow | Auth, database, program-state readers, LiveKit token service | Create fake chain state or decide vote results |
| Invitation service | Generate high-entropy link secret and join code, store keyed hash, rate-limit attempts | CSPRNG, server-only secret, database | Use VRF output as a secret; log raw invitation credentials |
| LiveKit token service | Issue short-lived participant tokens after admission and capacity checks | Auth session, admission state, LiveKit server SDK | Return API secret or issue tokens to unapproved users |
| LiveKit browser room | Camera, microphone, publish/subscribe, media reconnection | WebRTC and LiveKit events | Store media or decide on-chain outcomes |
| Chain client | PDA derivation, IDL calls, cluster guard, transaction state | Wallet, Solana RPC, MagicBlock endpoints | Guess account metas or casually mix web3.js and @solana/kit abstractions |
| Concord Anchor program | Authority checks, lifecycle, eligibility, duplicate rejection, tally, digest | Signed transaction, validated account metas, VRF callback, PER state | Trust backend-only checks; enumerate arbitrary accounts; log ballots |
| MagicBlock adapter | Delegation/status/routing/permission/commit lifecycle | Current supported SDK and endpoints | Invent lifecycle behavior or treat ordinary ER as private |
| Receipt builder/verifier | Canonical public receipt, digest, on-chain comparison | Final public vote summaries and approved action items | Claim a hash proves off-chain facts that were never committed |
| PostgreSQL | Auth nonces, sessions, private app metadata, join requests, keyed invite hashes, LiveKit mapping and webhook idempotency | Next.js server modules | Store individual ballot choices, private tally or user private keys |
| Optional chain worker | Observe VRF fulfillment and chain status, retryable expiry/media closure jobs | Solana/MagicBlock subscriptions or bounded polling | Become source of truth or silently alter program state |

### 10.8.3 Primary data flows

### Create meeting

1. Browser connects a wallet and signs a domain-bound nonce.
2. Next.js verifies the signature and issues an HttpOnly session cookie.
3. Next.js stores private draft metadata in PostgreSQL.
4. Browser asks the wallet to sign the Anchor instruction that requests VRF and establishes the on-chain request reference.
5. The official VRF callback fulfills randomness. The app/worker observes confirmed program state; no browser-supplied value can fulfill it.
6. Private room state and permissions are initialized using the selected supported PER SDK path.
7. Server independently generates a high-entropy invitation secret, stores only its keyed hash, creates an opaque LiveKit room name, and associates it with the application meeting ID.
8. UI reports ready only after required program/PER states and invitation setup are verified.

### Join and start media

1. Invitee opens the invite link or enters a code. A link secret is placed in a URL fragment and submitted in a POST body, not in logs.
2. Wallet authentication is verified; backend checks the invitation, rate-limits attempts and creates a pending request.
3. Host approves/rejects. Approval grants media access, not vote eligibility.
4. Server checks meeting status and actual room capacity, then issues a short-lived LiveKit token with opaque room and participant identities.
5. Browser joins LiveKit directly. LiveKit handles media packets; Next.js does not relay audio/video.
6. A server-side expiry job closes LiveKit at the 60-minute limit and refuses new tokens after closure. Program clock checks independently reject late votes even if media cleanup is delayed.

### Open and cast vote

1. Host chooses eligible admitted wallets, writes the question, exactly three options and deadline.
2. Browser validates input and asks host wallet to sign `open_vote`.
3. Program validates host authority, room/vote state and time bounds, then freezes eligibility.
4. Eligible voter chooses an option and signs `cast_vote`.
5. Program checks eligibility, option index, deadline and duplicate ballot PDA before writing the private ballot through the validated PER path.
6. The vote choice never passes through a Next.js API route. No option totals are displayed before finalization.

### Close, publish and verify

1. Close/finalize receives every ballot PDA expected by the frozen eligibility list. The program validates the list; it does not scan arbitrary accounts or trust a caller-provided subset.
2. Inside validated PER execution, the program computes aggregates and writes only aggregate fields and hashes to a separate result account.
3. Result visibility changes only once the result is frozen; the public summary is committed through the verified MagicBlock lifecycle.
4. Host reviews the receipt preview and public disclosure, including action items.
5. Receipt digest is calculated using the canonical encoder, then finalized and committed.
6. Public receipt route reconstructs the digest from on-chain/public fields and reports verified, mismatch, not yet committed, or RPC unavailable.

### 10.8.4 Time and capacity enforcement

The 60-minute duration begins when the host successfully starts the meeting, not when the draft is created. On-chain instructions reject vote actions at or after `started_at + 3600` using the program clock. Media closure needs server-side enforcement: a scheduled expiry or worker closes the LiveKit room and refuses tokens after expiry. If the worker is offline, on-chain vote acceptance still stops at the deadline; media cleanup happens when the server reconciles.

The cap is 20 connected participants, including the host. Enforce it in admission API checks and LiveKit room `maxParticipants: 20`, plus the UI. If the program also tracks participant/eligible counts, that state does not replace LiveKit's live connection count. Handle simultaneous join races by checking actual LiveKit room count before issuing tokens; the room-level limit is the final media gate.

### 10.8.5 Source-of-truth matrix

| Fact | Authority | Database role | UI rule |
|---|---|---|---|
| Wallet session | Verified signature and server session | Stores nonce/session metadata | Signed in only after verification |
| Invitation validity | Server keyed hash and meeting status | Stores hash/status | Invalid invite reveals no private details |
| Media admission | Admission service plus LiveKit room state | Stores request and decision | Token only after approval |
| Vote time bounds | Anchor program state and clock | Cache only | Backend timer cannot extend voting |
| Vote eligibility | Frozen program/PER snapshot | No authoritative copy | Locked after vote opens |
| Ballot accepted | Program/PER ballot state | Never store choice | Success only after execution state confirms |
| Final tally | Final aggregate from PER, then public summary | Cache only if needed | No totals before finalization/commit |
| Receipt verified | Digest compared with base-layer account | Cache only | Verification requires real chain comparison |

---

# 11. Data Model

Use PostgreSQL for backend metadata. The database is not the voting ledger.

## 11.1 `users`

- `id` UUID primary key
- `wallet_address` unique text
- `created_at`
- `last_authenticated_at`

Do not store wallet private keys, seed phrases, or decrypted ballot data.

## 11.2 `auth_nonces`

- `id` UUID
- `wallet_address`
- `nonce_hash`
- `message_hash`
- `expires_at`
- `consumed_at`
- `created_at`

## 11.3 `meetings`

- `id` UUID primary key, internal opaque app identifier
- `room_id` text/byte representation, unique when on-chain creation succeeds
- `creator_wallet`
- `name`
- `description` nullable
- `scheduled_start_at` UTC timestamp
- `started_at` nullable
- `ended_at` nullable
- `maximum_duration_seconds` fixed to 3600
- `maximum_participants` fixed to 20
- `lifecycle_status`
- `invite_secret_hash`
- `invite_code_hash`
- `livekit_room_name` opaque random identifier
- `vrf_request_reference` nullable
- `room_registry_address` nullable
- `receipt_address` nullable
- `receipt_digest` nullable
- `created_at`, `updated_at`

Meeting title and description are off-chain metadata, never copied to a public on-chain account automatically.

## 11.4 `join_requests`

- `id` UUID
- `meeting_id` foreign key
- `wallet_address`
- `display_name`
- `status`: `PENDING_HOST_APPROVAL`, `ADMITTED`, `REJECTED`, `LEFT`, `EXPIRED`
- `requested_at`
- `decided_at` nullable
- `decided_by_wallet` nullable
- Unique active request per `(meeting_id, wallet_address)`

## 11.5 `live_media_sessions`

- `id` UUID
- `meeting_id`
- `wallet_address`
- `livekit_participant_identity` opaque unique room identity
- `connected_at` nullable
- `disconnected_at` nullable
- `last_event_at` nullable

Do not store access tokens in this table.

## 11.6 `receipt_drafts`

- `id` UUID
- `meeting_id`
- `action_items_json` bounded JSON text
- `action_items_hash` nullable until calculated
- `public_payload_json` nullable until finalization
- `receipt_digest` nullable
- `created_by_wallet`
- `created_at`, `updated_at`

This stores only host-entered draft output and public receipt data. It must not store individual ballots or a transcript.

## 11.7 No `votes` or `ballots` database table

The database must not maintain a shadow list of individual ballots. Ballots and private tally state belong in the designated private on-chain/PER program state. The backend may cache public finalized vote summaries after validating them, but the verified program account remains authoritative.

---

# 12. Recommended Build Stack

## 12.1 Frontend

- Next.js App Router with TypeScript.
- React.
- Tailwind CSS with CSS variables for the theme.
- shadcn/ui for accessible primitives.
- Lucide React for simple icons.
- React Hook Form and Zod for forms and validation.
- A small data-fetching/cache layer such as TanStack Query where useful.
- LiveKit React components and `livekit-client` for video/audio.
- Solana Wallet Adapter or a Wallet Standard compatible connector selected to work with the pinned Anchor/MagicBlock SDK versions.
- `@solana/web3.js` plus the compatible Anchor TypeScript client if the selected MagicBlock example/SDK uses web3.js. Do not mix web3.js and @solana/kit abstractions inside the same hook without an explicit boundary.

## 12.2 Backend

- Next.js Route Handlers running in the Node.js runtime, not Edge runtime, for APIs that need Solana, database, or LiveKit server SDK dependencies.
- TypeScript.
- PostgreSQL.
- Drizzle ORM and Drizzle migrations.
- Zod request/response schemas.
- `livekit-server-sdk` for server-side token generation and webhook validation.
- An opaque server-side session cookie based on wallet signature authentication.

A small Node.js chain watcher may be added to the same repository if polling/subscriptions for VRF fulfilment or account changes cannot be handled reliably through request-time reads. It must only mirror program state; it cannot override the contract's state. Keep it minimal and document how it is started.

## 12.3 On-chain program

- Rust.
- Anchor, using a version compatible with the current MagicBlock ER SDK and official examples selected at implementation time.
- MagicBlock `ephemeral-rollups-sdk` or its compatible supported SDK package.
- MagicBlock VRF SDK (`ephemeral-vrf-sdk` package family) following the current official Solana VRF example.
- Anchor TypeScript IDL/client generated from the same program build.

Version compatibility is important. MagicBlock's current SDK repository distinguishes Anchor 1.0 compatibility from older Anchor versions. Choose one compatible toolchain, pin it, and use matching official examples. Do not blindly combine code copied from legacy examples with current SDK releases.

## 12.4 Dev infrastructure

- LiveKit Cloud for V1 audio/video.
- Solana Devnet for base-layer program interactions.
- MagicBlock-supported Devnet ER/PER endpoints and configuration from the current official documentation.
- PostgreSQL on local Docker during development and a managed PostgreSQL instance for a shared demo if needed.
- One supported hosting environment for Next.js with Node runtime. The chain watcher must run as a long-lived process if the implementation requires subscriptions.

## 12.5 Repository layout

```text
concord/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   ├── create/page.tsx
│   │   │   ├── join/[roomId]/page.tsx
│   │   │   ├── meeting/[roomId]/page.tsx
│   │   │   ├── meeting/[roomId]/lobby/page.tsx
│   │   │   ├── meeting/[roomId]/receipt/page.tsx
│   │   │   ├── receipt/[roomId]/page.tsx
│   │   │   └── api/v1/...
│   │   ├── components/
│   │   │   ├── landing/
│   │   │   ├── wallet/
│   │   │   ├── meeting/
│   │   │   ├── voting/
│   │   │   └── receipt/
│   │   ├── lib/
│   │   │   ├── auth/
│   │   │   ├── db/
│   │   │   ├── livekit/
│   │   │   ├── solana/
│   │   │   ├── magicblock/
│   │   │   ├── receipts/
│   │   │   └── validation/
│   │   └── styles/
│   └── chain-worker/             # Add only if persistent chain subscriptions are required
├── programs/
│   └── concord/
│       ├── src/lib.rs
│       ├── Cargo.toml
│       └── tests/
├── tests/
│   ├── e2e/
│   ├── privacy/
│   ├── receipts/
│   └── fixtures/
├── packages/
│   ├── shared-types/
│   └── receipt-hash/
├── Anchor.toml
├── pnpm-workspace.yaml
├── package.json
├── .env.example
└── README.md
```

The chain worker is conditional. Keep the architecture as a modular monolith until persistent subscriptions, VRF fulfillment tracking, or scheduled expiry require a long-running worker.

---

# 13. LiveKit Setup and Integration

## 13.1 Create a LiveKit Cloud project

1. Create/sign in to a LiveKit Cloud account.
2. Create a project for Concord.
3. Copy the project WebSocket URL, API key, and API secret from the project credentials page.
4. Keep the API secret on the server only.
5. Configure the LiveKit webhook URL once the Concord API is deployed, if webhook-driven media lifecycle tracking is used.
6. Use the same project and credentials in local development and the shared Devnet demo, unless a separate test project is intentionally created.

Official documentation:

- [LiveKit token generation and grants](https://docs.livekit.io/home/server/generating-tokens)
- [LiveKit JS server SDK](https://docs.livekit.io/reference/server-sdk-js/)
- [LiveKit room and participant concepts](https://docs.livekit.io/intro/basics/rooms-participants-tracks/)
- [LiveKit quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- [LiveKit Cloud billing](https://docs.livekit.io/deploy/admin/billing/)

## 13.2 Install the SDKs

From the web application workspace, install the current compatible versions of:

```bash
pnpm add @livekit/components-react @livekit/components-styles livekit-client livekit-server-sdk
```

Keep `livekit-server-sdk` imports in server-only modules. Frontend components may import `livekit-client` and React components, but never import the server SDK into a client component.

## 13.3 Environment variables

```dotenv
# App
APP_BASE_URL=http://localhost:3000
SESSION_SECRET=replace-with-32-bytes-or-more-of-random-secret
INVITE_HASH_SECRET=replace-with-a-different-random-secret

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/concord

# Solana Devnet
NEXT_PUBLIC_SOLANA_CLUSTER=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
CONCORD_PROGRAM_ID=replace-after-deploy

# MagicBlock: populate from the current official Devnet/ER/PER setup instructions.
MAGICBLOCK_BASE_RPC_URL=replace-with-current-supported-base-rpc
MAGICBLOCK_ER_RPC_URL=replace-with-current-supported-er-rpc
MAGICBLOCK_PER_RPC_URL=replace-with-current-supported-per-rpc
MAGICBLOCK_VRF_QUEUE=replace-with-current-supported-vrf-queue

# LiveKit, server only
LIVEKIT_URL=wss://replace-with-your-livekit-project-host
LIVEKIT_API_KEY=replace-with-livekit-api-key
LIVEKIT_API_SECRET=replace-with-livekit-api-secret
```

These values are placeholders. Do not paste credentials into source files, commit real `.env` files, or invent MagicBlock endpoint/queue values. Use the endpoints and queue addresses listed for the exact selected Devnet deployment and current SDK version. If a browser needs a connection URL, return the non-secret URL from the authenticated token endpoint or expose only the non-secret URL through a correctly named public variable. Never expose the API secret.

Generate secrets locally, for example:

```bash
openssl rand -hex 32
```

Use different values for `SESSION_SECRET` and `INVITE_HASH_SECRET`. Keep `.env.local` ignored by Git. Provide `.env.example` with placeholders only.

## 13.4 Token generation rules

The backend creates a `livekit-server-sdk` `AccessToken` only after verifying a current session, approved admission, meeting status, and participant capacity. The token must contain:

- Opaque participant identity derived from a stable internal ID, not a wallet address or real name.
- Opaque LiveKit room name, not the meeting title or public room ID.
- `roomJoin: true`.
- Required publish/subscribe permissions for audio and video.
- Short expiry for initial connection and reconnection policy appropriate to the chosen LiveKit setup.

Host moderation grants are only assigned to the host. A participant must not be able to set their own identity, room name, or moderation permissions by changing the request payload.

LiveKit tokens are credentials. Do not store them in local storage, persist them in the database, include them in URLs, or write them to logs. Keep them in application memory only as needed by the SDK.

## 13.5 Frontend room setup

Use `LiveKitRoom` and appropriate React components/hooks from the LiveKit SDK. Include:

- Camera/microphone preflight checks.
- Permission-denied explanations.
- Connect/disconnect state.
- Remote participant video tracks and audio renderer.
- Camera/microphone toggles.
- Device selection where supported.
- Reconnection feedback.
- Leave/end behavior.

Do not issue a token during the initial page render. Issue it after the backend confirms admission and just before the user enters the LiveKit room.

## 13.6 Webhooks and room cleanup

Verify webhook signatures using the current official SDK. Process events idempotently. Use room/participant events to update `live_media_sessions` and capacity calculations. Never use webhooks to determine vote validity or receipt finalization.

When a meeting ends or expires:

- Stop issuing tokens.
- Remove/revoke admitted participants where supported.
- Delete/close the LiveKit room using the server API if it remains active.
- Invalidate the invitation credential.
- Do not start recording or egress.

## 13.7 Cost planning

As checked against LiveKit documentation on 30 October 2026, the Build plan lists **5,000 WebRTC participant-minutes** and **50 GB downstream data transfer**, plus a 100-participant concurrent limit. A full 20-person, 60-minute meeting consumes up to 1,200 participant-minutes, or 24% of that monthly allowance. Four such meetings consume 4,800 minutes and leave only 200 for development, reconnects, and smaller tests. Limits may change; confirm your dashboard before a larger test.

One meeting with 20 connected people for the full 60 minutes uses:

`20 participants × 60 minutes = 1,200 participant-minutes`

That estimate does not include retries, other meetings, or any additional bandwidth usage. Downstream video bandwidth can become the limiting quota before participant-minutes do. Start with default/moderate video settings, test a full 20-person room, and monitor the dashboard. Do not promise free unlimited use.

---

# 14. MagicBlock, Solana, and Devnet Setup

## 14.1 Official implementation references

Read and follow the current source of truth for the exact selected versions:

- [MagicBlock documentation index](https://docs.magicblock.gg/llms.txt)
- [ER quickstart](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart)
- [ER delegation, commitment, and undelegation concepts](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup)
- [ER fees, commits, and refunds](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/fees-and-commit-economics)
- [PER quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart)
- [PER authorization](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/authorization) (check documented read-permission semantics; do not assume write-only access)
- [PER access control guide](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control)
- [MagicBlock VRF quickstart](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart)
- [MagicBlock VRF source repository](https://github.com/magicblock-labs/solana-vrf)
- [MagicBlock ER integration examples](https://github.com/magicblock-labs/magicblock-engine-examples)
- [MagicBlock ER SDK](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [Solana Anchor program quickstart](https://solana.com/docs/intro/quick-start/build-first-program)
- [Solana Devnet and cluster information](https://solana.com/docs/rpc)

The official MagicBlock example repository includes VRF dice, private counter with permissions, ephemeral account chats, session keys, and other ER patterns. Use the VRF and privacy examples as reference patterns, not as a substitute for testing Concord's account lifecycle.

## 14.2 Toolchain and deployment sequence

Install and pin the compatible versions of:

- Solana/Agave CLI.
- Rust toolchain.
- Anchor CLI.
- Node.js LTS and pnpm.
- MagicBlock ER SDK and VRF SDK crate versions used by the selected official example.

The exact version tuple must be recorded in `README.md` and lockfiles. Do not mix legacy Anchor 0.31/0.32 patterns with newer Anchor SDK APIs unless the chosen MagicBlock library explicitly supports that combination.

Suggested order:

1. Clone or create the project and configure workspace/package manager.
2. Install Rust, Solana/Agave CLI, and Anchor CLI following the current Solana docs.
3. Build the basic program locally.
4. Run the program tests before integrating the frontend.
5. Configure and run MagicBlock's local ER/PER privacy test environment, including its local query filtering setup if the current guide requires it.
6. Prove the VRF callback on the target cluster using the official example.
7. Deploy the program to Devnet using the deployer wallet.
8. Configure frontend/backend RPCs for Devnet and MagicBlock's supported ER/PER endpoints.
9. Fund the Devnet deployer and demo wallets through the official faucet. Devnet airdrops are rate-limited and are not guaranteed to succeed for arbitrary amounts.
10. Run account delegation, private ballot tests, separate public summary commit, and receipt commit against the actual deployment.
11. Create the LiveKit project and configure server-only credentials.
12. Complete an end-to-end meeting with at least three wallets before load-testing 20 participants.

Do not assume ordinary Devnet SOL pays LiveKit usage or any separately billed hosted MagicBlock resource. Devnet SOL is test currency. Hosted media, RPC, or rollup services may have their own plans, quotas, and payment requirements.

## 14.3 Fee and commit budget

Record actual results in a small test report:

- Base-layer transaction count for meeting creation and VRF flow.
- Account rent/space requirements.
- ER/PER operations per meeting.
- Commit operations per finalized vote and meeting receipt.
- Actual confirmed signatures for the end-to-end flow.
- Failure and retry behavior.
- Any MagicBlock account/delegation deposit or fee requirement in the selected setup.

Do not estimate total use from the frontend click count. Different operations may be transactions, callbacks, account initialization, delegation, or commits. The selected SDK and current fee documentation determine the real path.

For shared Devnet testing, use a clearly identified deployer wallet with only the required Devnet funds and program-account funding. Do not put a deployer private key in the frontend or use a server-held wallet to sign arbitrary user-vote instructions.

---

# 15. Non-Functional Requirements

## 15.1 Security

- Wallet ownership must be verified with a signature challenge.
- The app must never request, log, or store wallet seed phrases or private keys.
- Invite secrets must be high entropy, hashed at rest with a server-only keyed secret, rate-limited, rotatable, and invalidated at room closure.
- Invitation secrets must not be included in server access logs, analytics, error reports, or public blockchain state.
- LiveKit API secrets and session secrets remain server-only.
- Votes are validated in the program, not merely by frontend/backend checks.
- Vote eligibility is snapshotted when voting opens and cannot be altered for that vote afterward.
- Each eligible wallet can submit at most one accepted vote per vote ID.
- Ballot account contents must never enter ordinary API responses, analytics, logs, receipt JSON, or public committed account data.
- Receipt finalization is write-once and idempotent.
- The backend verifies webhook signatures and applies idempotency to duplicate events.
- All user-entered text is length-limited, rendered safely, and escaped. Do not render raw HTML in names, titles, options, or action items.
- Use rate limits for join-code brute-force resistance and token issuance.

## 15.2 Reliability

- Refreshing the browser must resume the state of an existing VRF request, not create another room.
- The client must distinguish wallet rejection, pending transactions, failed transactions, RPC errors, VRF delays, permission errors, and commit delays.
- A wallet disconnect must not silently finalize a vote or receipt.
- Host absence must not permit expired votes to remain accepting ballots forever. Include timeout-based close/finalize instructions.
- Retrying a final commit must not create duplicate receipt accounts or overwrite a finalized result.
- If LiveKit temporarily disconnects, attempt SDK reconnection and show status. Do not reissue unlimited tokens.
- If Solana or MagicBlock RPC is unavailable, voting must fail closed rather than accept an off-chain-only ballot that appears confirmed.

## 15.3 Performance and capacity

- Target up to 20 participants per meeting.
- Keep video settings moderate and verify a complete 20-participant test before demo day.
- Keep the meeting UI interactive when on-chain confirmation is pending, but always display the pending status.
- The frontend must not poll at excessive frequency. Prefer supported account subscriptions where reliable, with a bounded polling fallback.
- No app-side chat WebSocket is required in V1. LiveKit handles media participation events; MagicBlock account subscriptions or a lightweight application update mechanism handle voting state.

## 15.4 Accessibility and usability

- All core actions work by keyboard.
- Visible focus indicators are present.
- Controls have accessible labels.
- Three-option voting can be operated with keyboard or screen reader.
- Error messages explain recovery actions.
- Status is not conveyed by color alone.
- Landing page and app layout work at desktop, tablet, and mobile widths.
- Keep wallet setup, transaction status, and privacy disclosure understandable to non-technical community members.

## 15.5 Privacy and data retention

- No meeting media recordings are made.
- No transcript or automated meeting summary is generated.
- Delete or invalidate invitation credentials when the meeting closes or expires.
- Keep authentication/session records only for the minimum operational period required by V1.
- Do not collect email or phone number unless a later product requirement justifies it.
- Avoid adding third-party analytics that might capture invite URLs, wallet signatures, or meeting titles. If analytics are used, exclude sensitive paths and strip query/hash fragments.
- Public receipt content is permanently discoverable once committed. Show a pre-commit disclosure.

---

# 16. Error Handling and Edge Cases

| Scenario | Required behavior |
|---|---|
| User has no wallet | Show connect/create wallet guidance; do not request a seed phrase |
| Wallet on wrong network | Show Devnet switch prompt and block transaction submission |
| Wallet rejects a transaction | Return to safe prior state with a clear `Transaction rejected` status |
| VRF callback is delayed | Keep `VRF_PENDING`, resume by stored request reference, do not create another request on refresh |
| VRF callback fails | Show support details and allow retry only when program state and VRF docs establish retry safety |
| User refreshes during account delegation | Re-read on-chain delegation/account state and resume from the correct step |
| Invalid invitation | Generic error, rate-limited, no meeting details disclosed |
| Invitation secret is exposed | Host rotates invite secret; prior code/link no longer works |
| Host receives more than 19 additional participants | Enforce capacity including host and all active participants; refuse excess admissions |
| Host leaves before starting | Room remains in waiting room until host returns or the scheduled window expires |
| Host disconnects during meeting | Participants may continue temporarily; expiry enforcement remains on-chain; if host cannot return, timeout finalization path remains available |
| Host attempts to change voters after vote opens | Reject the instruction and show that eligibility is frozen for this round |
| Ineligible participant submits a ballot | Program rejects it; UI explains they are not eligible for this vote |
| Participant submits duplicate vote | Program rejects duplicate ballot; frontend maintains submitted state after confirmation |
| Ballot transaction is pending | Show `Confirming your vote`; do not show success or permit a conflicting second ballot |
| Vote deadline passes during wallet confirmation | Program timestamp decides. If it rejects, show that the voting deadline passed |
| Meeting ends while voting is open | No further ballots accepted after meeting end; expire/close/finalize the vote before receipt creation |
| ER update succeeds but base commit is pending | Keep separate status; do not show the public result as committed until base-layer account confirms |
| Commit succeeds but frontend timed out | Check transaction/account status, then render success without sending a duplicate commit |
| Receipt JSON changed after finalization | Verification must fail with `Mismatch`; never silently rewrite the committed receipt |
| LiveKit token request from unapproved user | Reject before token generation |
| LiveKit service unavailable | Show connection error and retry option; do not mark the meeting ended or vote closed based on media outage alone |
| Browser asks for mic/camera permission and user denies | Let the participant enter only if product policy allows receive-only media; show how to enable device access. V1 should not block observing the meeting solely because camera is denied |
| Devnet RPC rate limit | Show recoverable RPC status and backoff; do not trust an unverified local UI state |
| Local PER/QFS privacy check passes but Devnet PER is not checked | Do not claim the live deployment privacy requirement is complete |

---

# 17. Acceptance Criteria and Testing

## 17.1 Product acceptance criteria

V1 is acceptable only when all of the following pass:

1. The landing page includes hero, about, features, how it works, FAQ, and final CTA using the black/blue visual system and Lucide icons only.
2. Clicking `Create a meeting` without a wallet shows the wallet connect/create flow and resumes after connection.
3. A host can schedule a room and complete the required VRF setup on the target Devnet configuration.
4. Refreshing during VRF fulfilment does not issue a duplicate room request.
5. The host receives a private link and join code generated separately from the public VRF output.
6. A participant with a valid invitation can request entry; a participant with an invalid or rotated invitation cannot.
7. The host can admit/reject participants and the backend will not issue LiveKit tokens to unapproved users.
8. Twenty total participants can join a test room. A twenty-first participant cannot be admitted.
9. LiveKit video and audio work for host and participants, with usable camera and microphone controls.
10. A host can create a vote with exactly three options and a deadline within the meeting's remaining time.
11. Eligibility changes are rejected after a vote opens.
12. An eligible wallet can submit one ballot, and a duplicate attempt is rejected by the program.
13. A non-eligible wallet cannot submit a ballot.
14. Before close, the UI shows no option-by-option counts and no voter-to-choice mapping.
15. After close/finalization, aggregate totals are correct and visible.
16. No private ballot account or ballot field is included in any public committed account.
17. A vote summary commits to Solana and can be independently read from the configured cluster.
18. The host can create and review a receipt with decisions and optional action items.
19. Receipt preview warns the host what becomes public.
20. The on-chain program computes or validates the receipt digest against final summary data.
21. The public verifier recomputes the digest correctly and reports mismatches.
22. The app displays `Receipt verified` only after checking the base-layer account and confirmed transaction.
23. Meeting expiry and vote timeout work even if the host disappears.
24. No database table, server log, receipt payload, or browser API response contains individual ballot choices for another participant.
25. LiveKit secrets and wallet key material never reach client-side bundles.

## 17.2 Program tests

Required unit/integration tests:

- Creator authority validation.
- VRF callback path validation and rejection of arbitrary random values.
- Room nonce/identifier derivation.
- Start time window validation.
- 60-minute duration enforcement.
- Maximum 20 participant enforcement at the applicable authorization layer.
- Host-only voting actions.
- Exactly three options per vote.
- Empty/invalid option label rejection.
- Eligibility snapshot immutability.
- Ineligible voter rejection.
- Duplicate voter rejection.
- Invalid option index rejection.
- Vote after deadline rejection.
- Vote after meeting expiry rejection.
- Tally computed correctly for all combinations.
- Tie behavior, including a tie for the most-selected option.
- All-abstain equivalent if abstain is offered as one of the three host-defined options. The program treats options as labels, not fixed `approve/reject/abstain` semantics.
- Public summary contains no ballot account data.
- Private account is never part of the base-layer commit instruction.
- Expired vote can be finalized permissionlessly.
- Receipt finalization requires all votes to be finalized.
- Receipt is immutable after finalization.
- Retry does not duplicate summary or receipt accounts.
- Rust and TypeScript digest test vectors match byte-for-byte.

## 17.3 Backend tests

- Signature challenge accepts valid wallet signature and rejects invalid/reused/expired nonce.
- Session cookie flags are correct.
- Invitation hash matches valid code and rejects incorrect code.
- Join-code attempts are rate-limited.
- Rotating invitation invalidates old invitations.
- Unapproved users cannot receive LiveKit tokens.
- Room capacity is checked before admission/token issuance.
- LiveKit API secret never appears in response payloads or frontend bundle.
- Invalid LiveKit webhooks are rejected.
- Duplicate webhook delivery is idempotent.
- Receipt endpoint returns only public data.
- Receipt endpoint refuses to report success from a database-only record.

## 17.4 End-to-end demo test

Use at least three separate wallets and browsers:

1. Host creates a room.
2. Wait for VRF callback and private state setup.
3. Two participants join using invitation credentials and request entry.
4. Host admits both and verifies live video/audio.
5. Host sets one participant as a voter and one as an observer.
6. Host opens a three-option vote.
7. Voter submits a ballot and sees success after PER confirmation.
8. Observer attempts to vote and is rejected.
9. Voter attempts to submit a second ballot and is rejected.
10. While voting is open, participants cannot see option counts or the other voter's choice.
11. Host closes voting and finalizes the aggregate result.
12. Vote result account commits to Solana.
13. Host adds action items and reviews the disclosure preview.
14. Host commits the meeting receipt.
15. Public receipt page recomputes the digest and shows `Verified`.
16. Change one byte in a local receipt fixture and confirm the verifier reports `Mismatch`.
17. Confirm public account data contains no individual ballot choices.
18. Repeat a commit request after simulated client timeout and confirm no duplicate receipt is created.

## 17.5 Load test

Before calling V1 complete, perform at least one 20-participant media test with the actual video settings and monitor LiveKit participant minutes and downstream bandwidth. Also test concurrent join requests around the 20-person limit. Do not rely on a UI-only mock of 20 participants as proof of capacity.

---

# 18. Phased build plan and definition of done

The build is organized by technical dependencies, not calendar weeks. Each phase has an output and exit gate. Do not build every screen before the private-state and commit model is proven.

## Phase 0: Freeze decisions and pin the toolchain

**Goal:** Turn documentation and version choices into reproducible decisions.

Tasks:

1. Create the repository layout in Section 12.5, with strict TypeScript, lint/formatting, environment validation and shared schemas.
2. Inspect current MagicBlock ER/PER/VRF docs and official examples. Select one coherent Rust/Solana/Anchor/Node/TypeScript toolchain and pin exact versions in toolchain files, package manifests and lockfiles.
3. Decide whether the Solana client uses `@solana/web3.js` or `@solana/kit` at each boundary. Follow the SDK version chosen by the official example and do not casually mix providers, key types and transaction builders.
4. Confirm the endpoint and auth requirements for Solana Devnet, ER, PER/TEE and VRF. Keep secrets outside source control.
5. Write architecture decision records for the VRF role, invite-secret generation, ballot account model, tally mechanism, result visibility, commit lifecycle, expiry enforcement and receipt encoding.
6. Build and run the official minimal examples without the Concord UI.

**Deliverables:** `docs/architecture/decisions.md`, pinned toolchain matrix, `.env.example`, repo skeleton and smoke-tested official examples.

**Exit gate:** The packages build together and a tested official example exists for VRF, PER permissions, delegation and commit. Resolve version conflicts now.

## Phase 1: MagicBlock vertical proof, especially private ballots

**Goal:** Prove the highest-risk on-chain behavior before implementing the complete product.

Tasks:

1. Implement a minimal Anchor program with room state, one lifecycle transition and a public receipt digest field.
2. Integrate VRF using the official request/callback flow. Verify fulfillment and recovery after browser/server restart.
3. Integrate PER account initialization, permission records and auth/query paths. Test authorized and unauthorized queries.
4. Create a deterministic ballot PDA per wallet/vote. Submit the choice without sending it through a Next.js API.
5. Confirm a voter cannot fetch another ballot via PER RPC, APIs, logs, browser state or public Solana data.
6. Test whether the program can tally inside PER from the complete ballot PDA set without granting voters access to other voters' choices.
7. Test the not-yet-finalized summary account, then prove it becomes public only after closure and commits aggregate data only.
8. Test commit, read-back, retry-after-timeout and immutable receipt digest.
9. Test with up to 20 eligible ballot accounts and verify account-meta/compute constraints.

**Deliverables:** minimal Anchor/VRF/PER proof, privacy and tally tests, `docs/architecture/magicblock-proof.md`.

**Exit gate:** Gates A-F in Section 9.6 pass on the intended deployment, not only local emulation. If private tally cannot be safely implemented, pause UI work and redesign. Do not substitute a public ER account or database ballot table while claiming private voting.

## Phase 2: Core Anchor program and test suite

**Goal:** Implement the room/vote state machine and test it independently of the browser.

Tasks:

1. Define bounded account structs, PDA seeds, enums, error codes, maximum serialized sizes and version conventions.
2. Implement room creation/VRF completion, start, early end and expiry behavior.
3. Implement vote opening with exactly three options, deadline validation and immutable eligibility snapshot.
4. Implement private ballot submission, duplicate prevention, eligibility checks and time checks.
5. Implement close/finalize, aggregate-only public summary, receipt finalization and idempotent recovery paths using the proven PER model.
6. Implement canonical receipt encoding and Rust digest test vectors. Never rely on default JSON serialization for the on-chain digest.
7. Generate the IDL and have client fixtures derive from that exact build.
8. Test wrong authority/PDA, invalid VRF callback, changed eligibility, late votes, early close, expired close, zero ballot, each option, ties, malformed ballots, public-account leakage and retry idempotency.

**Deliverables:** Anchor program, IDL/client bindings, test suite, digest module, deployment script and documented state machine.

**Exit gate:** Invalid transitions fail in the program without frontend/backend checks. Public account bytes pass a strict field allow-list.

## Phase 3: Next.js foundation, identity and metadata

**Goal:** Add app navigation and secure server workflows without media/voting complexity.

Tasks:

1. Set up Next.js App Router, TypeScript, Tailwind CSS variables, shadcn/ui primitives, Lucide icons, React Hook Form, Zod, Drizzle and PostgreSQL.
2. Build app shell, responsive layout, loading/error boundaries, dialogs/modals and status components.
3. Implement wallet connection and explicit Devnet network guard. Never silently direct a wallet to Mainnet.
4. Implement signed nonce authentication, HttpOnly cookie/session handling, expiry/replay prevention, logout, origin checks and rate limits.
5. Create migrations for users, auth nonces, sessions, meetings, join requests, media sessions, invitation hash rotations and webhook idempotency. Never add ballots or votes to these tables.
6. Implement meeting draft/status endpoints, invitation secret generation/rotation, keyed hashing, join requests and host decisions.
7. Build public landing page and wallet-gate behavior.

**Deliverables:** public site, wallet authentication, DB migrations, secure invitation service and meeting draft UI.

**Exit gate:** Auth/invitation tests pass; raw invitation values never appear in logs or DB; invalid invitees see no private room details; refresh resumes the existing draft/on-chain status.

## Phase 4: LiveKit media and admission

**Goal:** Real audio/video and reliable host-controlled admission.

Tasks:

1. Create a LiveKit Cloud project and store credentials server-side.
2. Implement server-only short-lived token issuance with an opaque room name and participant identity using `livekit-server-sdk`.
3. Build waiting room, host requests, admit/reject, camera/mic preview, participant grid, active-speaker state and leave/end controls.
4. Apply `maxParticipants: 20`, including the host. Check actual room capacity before token minting and test race behavior.
5. Verify webhooks, make duplicate event handling idempotent, and reconcile stale DB rows with LiveKit actual state.
6. Implement the 60-minute server-side expiry/cleanup path that closes LiveKit and refuses tokens after expiry. Do not depend on a browser timer.
7. Test 2, 5 and 20 connected participants, denied device permissions, browser refresh/reconnect, host network drop and full room.

**Deliverables:** working lobby and real media room.

**Exit gate:** 20 participants communicate; participant 21 cannot join; only admitted users get tokens; room expires at 60 minutes; no recording/egress is configured.

## Phase 5: Private voting flow

**Goal:** Connect the proven on-chain ballot system to the in-meeting UX.

Tasks:

1. Build host controls for voter eligibility, question, three options and deadline bounded by remaining meeting time.
2. Show the eligible-voter preview and freeze warning before `open_vote`.
3. Build participant voting panel, selection state, wallet prompt, pending/confirmed states and recovery UI.
4. Use generated IDL/client and supported MagicBlock route for every instruction. No Next.js API may accept a raw ballot and claim it is on-chain.
5. Rely on PDA/program duplicate prevention; UI disablement is only a UX aid.
6. Build host-close and deadline-close/finalize flows, including permissionless finalization if host is absent.
7. Keep option totals hidden until finalization/commit. Do not show which wallets have voted. Keep total submission count hidden unless approved by privacy review.
8. Implement recoverable statuses for wallet rejection, PER auth errors, pending ER/PER state, duplicate ballot, closed vote, deadline, and commit delay.

**Deliverables:** private ballot submission and public aggregate result after proper closure.

**Exit gate:** Program result, public summary and independent test tally match adversarial cases; voters cannot query other ballots; no unfinalized result leaks; no vote choice appears in Postgres, API logs, browser telemetry or committed private data.

## Phase 6: Receipt and public verifier

**Goal:** Turn a completed meeting into a durable, independently checkable record.

Tasks:

1. Build receipt draft from finalized public vote summaries and host-entered action items.
2. Clearly label which fields become public and which stay private/off-chain.
3. Allow action-item edits only before receipt finalization; lock vote result fields.
4. Implement deterministic digest construction and cross-language Rust/TypeScript test vectors.
5. Commit/finalize the public receipt using the proven MagicBlock lifecycle. Show ER/PER completion, base-layer commit and verification as separate states.
6. Build `/receipt/[roomId]` with public results, cluster, account address, transaction link and verification outcome.
7. Confirm local field changes fail verification; RPC outage returns `RPC unavailable`, never `Verified`.
8. Invalidate invitation secrets and refuse further LiveKit access at closure.

**Deliverables:** receipt review screen, immutable commitment and public verifier.

**Exit gate:** Independent digest reconstruction matches on-chain fields; altered content fails; no ballot/roster/invite/media secret is committed; retries are idempotent.

## Phase 7: UI polish, threat testing and operations

**Goal:** Make the experience dependable and understandable as a real side project.

Tasks:

1. Finish landing page sections: hero, problem, solution, how it works, features, FAQ and final CTA. Use black/blue, generous spacing, pill controls, simple icons and restrained motion. Avoid clutter, gradients, emojis and em dashes in product copy.
2. Audit every screen for loading, empty, error, retry, disabled and success states. Never convey status by color alone.
3. Test the full flow with at least three wallets/browsers; separately run a scripted 20-client media test.
4. Run hostile-participant tests: guess invitation, reuse revoked link, request token before admission, query another ballot, request tally before close, replay a vote, submit late, alter receipt JSON.
5. Review base-layer account bytes, PER reads under different roles, server logs, browser network requests and API payloads for leaks.
6. Test RPC outage, wallet disconnect, delayed VRF callback, refresh, LiveKit reconnection, expiry worker downtime, PER token expiry, commit success with browser timeout and duplicate webhook.
7. Track LiveKit participant-minutes and downstream transfer. One 20-person, 60-minute meeting consumes 1,200 participant-minutes; the current 5,000-minute free allowance is tight for repeated tests.
8. Write runbooks for local setup, Devnet deploy, program upgrade, LiveKit setup, secrets, troubleshooting and recovery.

**Deliverables:** release checklist, threat-model summary, privacy report, 20-participant test report, runbooks and final README.

**Exit gate:** All acceptance criteria pass using real wallets, LiveKit media, deployed Anchor program, actual MagicBlock integration and actual Solana commitment.

## Definition of V1 complete

V1 is complete only when a host can create an invite-only room, admit up to 19 additional participants, run real LiveKit audio/video for a meeting capped at 60 minutes, conduct a three-option vote against a frozen eligibility set, pass the deployed PER privacy tests, publish aggregate results separately from ballots, and commit an independently verifiable receipt to Solana Devnet. Mocked voting or mocked receipts may be used for UI prototyping only and must not be confused with completion.

---

# 19. Required Environment and Documentation Notes for the Coding Agent

The coding agent must read the linked official docs and inspect the current source examples before implementing MagicBlock instructions. The following items are not safe to guess:

- Current supported Anchor version and compatible Rust SDK version.
- Correct VRF queue/program IDs and callback account metas for the target cluster.
- How to request and fulfill VRF on the selected execution environment.
- How the room's state account is delegated and how account status is inspected.
- Current PER account permission syntax, policy accounts, and read/write behavior.
- Whether the selected PER permits the target program to read private ballot accounts while denying public clients access.
- How a separate aggregate-only account is safely committed without committing private ballot data.
- Current Devnet ER/PER RPC endpoints and whether special headers, authorization, or registration are required.
- Current MagicBlock fee, commit, account-size, and runtime limits.
- Whether the chosen deployment supports all required account lifecycle transitions without exposing private data.

If one of these is unresolved, record the uncertainty and test it before implementing the full feature. Do not replace a failed PER integration with a regular ER and keep the `private voting` label.

---

# 20. Coding Agent Build Prompt

Implement Concord according to this document as the complete source of truth. Do not invent extra product features or silently weaken requirements.

Start by completing Phase 0 and Phase 1. Validate the MagicBlock integration against current official docs and examples, pin a compatible dependency/toolchain matrix, and prove private ballot isolation, complete tallying, result visibility and commits before creating every screen. Only after those gates pass, build the end-to-end vertical slice: wallet authentication, required VRF room creation, private PER room initialization, host admission, LiveKit audio/video, private three-option vote, separate public aggregate commit, receipt digest commit, and public verification.

Use Next.js App Router and TypeScript for the frontend and API, PostgreSQL for non-sensitive metadata, Anchor/Rust for the Solana program, MagicBlock ER/PER SDKs for supported execution/delegation/commit behavior, MagicBlock VRF for room setup, and LiveKit Cloud for media. Keep the design black and blue, spacious, minimal, pill-shaped controls, and simple Lucide icons. Do not use emojis, gradients, or an em dash in product copy. Build a complete landing page with hero, about, how it works, features, FAQ, and CTA. The primary CTA must trigger the wallet connect/create guidance when no wallet is connected.

Treat privacy as a program and account-design requirement, not a CSS or API requirement. Individual ballots must not be stored in PostgreSQL, exposed over REST, logged, included in receipts, or committed to Solana. Only a separate public aggregate result account and the intended public receipt may be committed. During an open vote, show no option totals or voter identities; show an overall submitted count only if the privacy test explicitly approves it. Freeze voter eligibility at vote opening. The contract, not the backend, decides ballot validity and tally.

Implement explicit lifecycle and transaction states. Never show success before the relevant execution-layer or base-layer confirmation. All retry paths must inspect existing state first and be idempotent. Keep the backend responsible for invitation secrets, admission, LiveKit tokens, metadata, and verified status reads. Do not issue LiveKit credentials to unapproved users and never expose LiveKit API secrets or wallet key material.

Produce working code, migrations, IDL/client bindings, unit tests, privacy tests, end-to-end tests, `.env.example`, local setup instructions, Devnet deployment instructions, LiveKit project setup instructions, and a final test report. Use real integrations rather than fabricated API responses. Document any unresolved compatibility issue clearly and do not call the product complete while private voting or public receipt verification is mocked.

Before adding visual polish, prove the PER privacy feasibility gate in Section 9.6. If the account permissions or commit lifecycle differ from this specification, update the implementation plan to match verified current MagicBlock behavior while preserving the product-level requirements: private ballots, correct aggregate tally, a separate public result, and a verifiable receipt.

---

# 21. Official References

All implementation details must be checked against the current versions of the documentation before coding. These links were reviewed on 30 October 2026; APIs, account-permission semantics, quotas, SDK versions, and hosted-service pricing may change. Re-check the selected endpoint and pinned version before each implementation milestone.

## MagicBlock

- [Documentation index](https://docs.magicblock.gg/llms.txt)
- [Products overview](https://docs.magicblock.gg/pages/overview/products)
- [ER quickstart](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/how-to-guide/quickstart)
- [Delegation, commitment, and undelegation](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/ephemeral-rollup)
- [Fees, commits, and refunds](https://docs.magicblock.gg/pages/ephemeral-rollups-ers/introduction/fees-and-commit-economics)
- [PER quickstart](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/quickstart)
- [PER authorization](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/authorization) (check documented read-permission semantics; do not assume write-only access)
- [PER access control](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/how-to-guide/access-control)
- [VRF quickstart](https://docs.magicblock.gg/pages/verifiable-randomness-functions-vrfs/how-to-guide/quickstart)
- [Solana VRF GitHub repository](https://github.com/magicblock-labs/solana-vrf)
- [MagicBlock ER SDK](https://github.com/magicblock-labs/ephemeral-rollups-sdk)
- [MagicBlock engine examples](https://github.com/magicblock-labs/magicblock-engine-examples)
- [PER private payments example and explanation](https://github.com/magicblock-labs/starter-kits/blob/main/private-payments-demo/README.md)

## Solana

- [Solana developer quickstart](https://solana.com/docs/intro/quick-start)
- [Build an Anchor program](https://solana.com/docs/intro/quick-start/build-first-program)
- [Program Derived Addresses](https://solana.com/docs/core/pda)
- [RPC and cluster information](https://solana.com/docs/rpc)
- [Deploying programs](https://solana.com/docs/programs/deploying)

## LiveKit

- [Tokens and grants](https://docs.livekit.io/home/server/generating-tokens)
- [JS server SDK](https://docs.livekit.io/reference/server-sdk-js/)
- [Room, participant, and track concepts](https://docs.livekit.io/intro/basics/rooms-participants-tracks/)
- [Participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/)
- [Quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- [Billing and metering](https://docs.livekit.io/deploy/admin/billing/)

---

**End of specification.**
