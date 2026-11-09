//! Concord: private meetings, confidential voting, verifiable decision records.
//!
//! Layout (ADR-012, ADR-017):
//! - `RoomRegistry` (base layer, public): creator, VRF output, receipt commitment.
//! - `RoomSession` (TEE PER, permission = host): lifecycle + active vote; also the
//!   rent sponsor for ephemeral voter slots.
//! - `RoomResults` (delegated, aggregates only): committed after each finalized vote.
//! - Voter slots: ephemeral PER accounts (permission = that voter), never committed.
//!
//! Fees: the host pays every base-layer transaction. Voters sign PER transactions
//! with zero balance (proven in docs/architecture/magicblock-proof.md).

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use ephemeral_rollups_sdk::access_control::instructions::{
    CloseEphemeralPermissionCpi, ClosePermissionCpiBuilder, CommitAndUndelegatePermissionCpiBuilder,
    CreateEphemeralPermissionCpi, CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, MembersArgs, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG,
    PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::ephemeral_accounts::EphemeralAccount;
use ephemeral_rollups_sdk::vrf::instructions::{create_request_randomness_ix, RequestRandomnessParams};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;

pub mod digest;
pub mod errors;
pub mod logic;
pub mod state;

use errors::ConcordError;
use logic::*;
use state::*;

declare_id!("85DsSom7cr5hHVZeTB7k3WKKKpFMB2DLUN3c6FbR9861");

const ALL_FLAGS: u8 =
    AUTHORITY_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG;

/// Which room PDA a generic delegate/close call targets.
pub const KIND_SESSION: u8 = 0;
pub const KIND_RESULTS: u8 = 1;

pub fn kind_seed(kind: u8) -> &'static [u8] {
    if kind == KIND_SESSION {
        SESSION_SEED
    } else {
        RESULTS_SEED
    }
}

fn slot_address(session: &Pubkey, voter: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SLOT_SEED, session.as_ref(), voter.as_ref()], &crate::ID)
}

fn permission_address(account: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[PERMISSION_SEED, account.as_ref()], &PERMISSION_PROGRAM_ID).0
}

/// Reads and validates a voter slot for `voter` under `session`.
fn read_slot(session: &Pubkey, voter: &Pubkey, account: &AccountInfo) -> Result<SlotData> {
    require_keys_eq!(account.key(), slot_address(session, voter).0, ConcordError::SlotSetMismatch);
    require_keys_eq!(*account.owner, crate::ID, ConcordError::BadSlot);
    let slot = SlotData::decode(&account.try_borrow_data()?)?;
    require_keys_eq!(slot.voter, *voter, ConcordError::NotSlotOwner);
    Ok(slot)
}

#[ephemeral]
#[program]
pub mod concord {
    use super::*;

    // ===================== Base layer: setup =====================

    /// Host creates the public registry. `room_nonce` is the 16-byte meeting id,
    /// so one host can run any number of meetings.
    pub fn initialize_room(ctx: Context<InitializeRoom>, room_nonce: [u8; 16]) -> Result<()> {
        let r = &mut ctx.accounts.registry;
        r.creator = ctx.accounts.creator.key();
        r.room_nonce = room_nonce;
        r.created_at = Clock::get()?.unix_timestamp;
        r.vrf_output = [0; 32];
        r.vrf_fulfilled = false;
        r.started_at = 0;
        r.ended_at = 0;
        r.vote_count = 0;
        r.action_items_hash = [0; 32];
        r.receipt_digest = [0; 32];
        r.receipt_finalized = false;
        r.bump = ctx.bumps.registry;
        Ok(())
    }

    /// Host requests verifiable randomness on the base layer (before any delegation).
    pub fn request_room_randomness(ctx: Context<RequestRoomRandomness>) -> Result<()> {
        require!(!ctx.accounts.registry.vrf_fulfilled, ConcordError::RandomnessAlreadyFulfilled);
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.creator.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: instruction::StoreRoomRandomness::DISCRIMINATOR.to_vec(),
            caller_seed: ctx.accounts.registry.key().to_bytes(),
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.registry.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.creator.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback. `#[vrf_callback]` checks the VRF program identity signer, so no
    /// caller can supply its own "randomness".
    pub fn store_room_randomness(ctx: Context<StoreRoomRandomness>, randomness: [u8; 32]) -> Result<()> {
        let r = &mut ctx.accounts.registry;
        require!(!r.vrf_fulfilled, ConcordError::RandomnessAlreadyFulfilled);
        r.vrf_output = randomness;
        r.vrf_fulfilled = true;
        Ok(())
    }

    /// Creates the session (funded with `sponsor_budget` lamports for ephemeral slot
    /// rent) and the results account. Requires fulfilled VRF.
    pub fn init_room_state(ctx: Context<InitRoomState>, sponsor_budget: u64) -> Result<()> {
        require!(ctx.accounts.registry.vrf_fulfilled, ConcordError::RandomnessPending);
        let registry = ctx.accounts.registry.key();
        let s = &mut ctx.accounts.session;
        s.registry = registry;
        s.host = ctx.accounts.host.key();
        s.started_at = 0;
        s.ended_at = 0;
        s.next_vote_id = 0;
        s.open_slots = 0;
        s.vote = ActiveVote::none();
        s.bump = ctx.bumps.session;
        let res = &mut ctx.accounts.results;
        res.registry = registry;
        res.summaries = vec![];
        res.bump = ctx.bumps.results;
        if sponsor_budget > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.host.to_account_info(),
                        to: ctx.accounts.session.to_account_info(),
                    },
                ),
                sponsor_budget,
            )?;
        }
        Ok(())
    }

    /// Creates the permission (member: host), delegates it, then delegates the
    /// session or results PDA to the validator (the TEE identity for PER).
    pub fn delegate_room_pda(ctx: Context<DelegateRoomPda>, kind: u8) -> Result<()> {
        require!(kind <= KIND_RESULTS, ConcordError::Unauthorized);
        let registry = ctx.accounts.registry.key();
        let host = ctx.accounts.host.key();
        let bump = ctx.bumps.pda;
        let seeds: &[&[u8]] = &[kind_seed(kind), registry.as_ref(), &[bump]];
        let validator = ctx.accounts.validator.as_ref().map(|v| v.to_account_info());

        if ctx.accounts.permission.data_is_empty() {
            CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .permissioned_account(&ctx.accounts.pda.to_account_info())
                .permission(&ctx.accounts.permission.to_account_info())
                .payer(&ctx.accounts.host.to_account_info())
                .system_program(&ctx.accounts.system_program.to_account_info())
                .args(MembersArgs { members: Some(vec![Member { flags: ALL_FLAGS, pubkey: host }]) })
                .invoke_signed(&[seeds])?;
        }
        if ctx.accounts.permission.owner != &ephemeral_rollups_sdk::id() {
            DelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .permissioned_account(&ctx.accounts.pda.to_account_info(), true)
                .permission(&ctx.accounts.permission.to_account_info())
                .payer(&ctx.accounts.host.to_account_info())
                .authority(&ctx.accounts.pda.to_account_info(), false)
                .system_program(&ctx.accounts.system_program.to_account_info())
                .owner_program(&ctx.accounts.permission_program.to_account_info())
                .delegation_buffer(&ctx.accounts.buffer_permission.to_account_info())
                .delegation_metadata(&ctx.accounts.delegation_metadata_permission.to_account_info())
                .delegation_record(&ctx.accounts.delegation_record_permission.to_account_info())
                .delegation_program(&ctx.accounts.delegation_program.to_account_info())
                .validator(validator.as_ref())
                .invoke_signed(&[seeds])?;
        }
        ctx.accounts.delegate_pda(
            &ctx.accounts.host,
            &[kind_seed(kind), registry.as_ref()],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    // ===================== PER: participants and lifecycle =====================

    /// Host creates ephemeral voter slots (sponsored by the session). Remaining
    /// accounts: `[slot, slot_permission]` per voter, in `voters` order. Idempotent.
    pub fn add_voter_slots<'info>(
        ctx: Context<'info, AddVoterSlots<'info>>,
        voters: Vec<Pubkey>,
    ) -> Result<()> {
        require!(ctx.accounts.session.ended_at == 0, ConcordError::MeetingNotActive);
        require!(ctx.remaining_accounts.len() == voters.len() * 2, ConcordError::SlotSetMismatch);
        let session_key = ctx.accounts.session.key();
        let registry = ctx.accounts.session.registry;
        let session_bump = ctx.accounts.session.bump;
        let session_seeds: &[&[u8]] = &[SESSION_SEED, registry.as_ref(), &[session_bump]];
        let mut created: u16 = 0;

        for (i, voter) in voters.iter().enumerate() {
            let slot = &ctx.remaining_accounts[i * 2];
            let slot_permission = &ctx.remaining_accounts[i * 2 + 1];
            let (expected, slot_bump) = slot_address(&session_key, voter);
            require_keys_eq!(slot.key(), expected, ConcordError::SlotSetMismatch);
            require_keys_eq!(slot_permission.key(), permission_address(&expected), ConcordError::SlotSetMismatch);
            if !slot.data_is_empty() {
                continue; // already created
            }
            let slot_seeds: &[&[u8]] = &[SLOT_SEED, session_key.as_ref(), voter.as_ref(), &[slot_bump]];
            EphemeralAccount::new(
                &ctx.accounts.session.to_account_info(),
                slot,
                &ctx.accounts.vault.to_account_info(),
            )
            .with_signer_seeds(&[session_seeds, slot_seeds])
            .create(SLOT_LEN as u32)?;
            SlotData::new(*voter).encode(&mut slot.try_borrow_mut_data()?)?;
            CreateEphemeralPermissionCpi {
                permissioned_account: slot.clone(),
                permission: slot_permission.clone(),
                payer: ctx.accounts.session.to_account_info(),
                vault: ctx.accounts.vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                args: EphemeralMembersArgs {
                    is_private: true,
                    members: vec![Member { flags: ALL_FLAGS, pubkey: *voter }],
                },
            }
            .invoke_signed(&[session_seeds, slot_seeds])?;
            created += 1;
        }
        let s = &mut ctx.accounts.session;
        s.open_slots = s.open_slots.checked_add(created).ok_or(ConcordError::TooManyParticipants)?;
        require!(s.open_slots as usize <= MAX_PARTICIPANTS, ConcordError::TooManyParticipants);
        Ok(())
    }

    /// Host starts the meeting; the 60-minute clock starts now (program time).
    pub fn start_meeting(ctx: Context<HostSession>) -> Result<()> {
        let s = &mut ctx.accounts.session;
        require!(s.started_at == 0, ConcordError::AlreadyStarted);
        require!(s.ended_at == 0, ConcordError::MeetingNotActive);
        s.started_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    // ===================== PER: voting =====================

    /// Host opens a vote and freezes the eligibility snapshot. Remaining accounts:
    /// the voter slot of every eligible wallet (any order). The eligible list is read
    /// from the slots themselves, so 20 voters fit in one transaction.
    pub fn open_vote<'info>(
        ctx: Context<'info, HostSession<'info>>,
        question_hash: [u8; 32],
        option_hashes: [[u8; 32]; 3],
        deadline: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let session_key = ctx.accounts.session.key();
        let s = &ctx.accounts.session;
        require!(s.started_at != 0, ConcordError::NotStarted);
        require!(meeting_active(s.started_at, s.ended_at, now), ConcordError::MeetingNotActive);
        require!(s.vote.status == VOTE_NONE, ConcordError::VoteAlreadyActive);
        require!((s.next_vote_id as usize) < MAX_VOTES, ConcordError::TooManyVotes);
        validate_options(&question_hash, &option_hashes)?;
        validate_deadline(s.started_at, now, deadline)?;
        let mut voters = Vec::with_capacity(ctx.remaining_accounts.len());
        for account in ctx.remaining_accounts.iter() {
            require_keys_eq!(*account.owner, crate::ID, ConcordError::BadSlot);
            let slot = SlotData::decode(&account.try_borrow_data()?)?;
            // Address must derive from the voter recorded inside the slot.
            read_slot(&session_key, &slot.voter, account)?;
            voters.push(slot.voter);
        }
        let eligible = canonical_eligible(voters)?;
        let hash = eligibility_hash(&eligible);
        let s = &mut ctx.accounts.session;
        s.vote = ActiveVote {
            vote_id: s.next_vote_id,
            status: VOTE_OPEN,
            question_hash,
            option_hashes,
            opened_at: now,
            deadline,
            closed_at: 0,
            eligible,
            eligibility_hash: hash,
        };
        s.next_vote_id += 1;
        Ok(())
    }

    /// Eligible voter writes their choice to their own private slot. The voter only
    /// signs; any wallet (including one with 0 SOL) can be the fee payer on PER.
    pub fn cast_vote(ctx: Context<CastVote>, option: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let s = &ctx.accounts.session;
        let voter = ctx.accounts.voter.key();
        require!(s.vote.status == VOTE_OPEN, ConcordError::VoteNotOpen);
        require!(now <= s.vote.deadline, ConcordError::VoteDeadlinePassed);
        require!(meeting_active(s.started_at, s.ended_at, now), ConcordError::MeetingNotActive);
        require!(option < 3, ConcordError::InvalidOption);
        require!(s.vote.eligible.binary_search(&voter).is_ok(), ConcordError::NotEligible);
        let slot_info = ctx.accounts.slot.to_account_info();
        let mut slot = read_slot(&s.key(), &voter, &slot_info)?;
        require!(slot.last_vote_id != s.vote.vote_id, ConcordError::AlreadyVoted);
        slot.last_vote_id = s.vote.vote_id;
        slot.option = option;
        slot.submitted_at = now;
        slot.encode(&mut slot_info.try_borrow_mut_data()?)?;
        Ok(())
    }

    /// Host closes early; anyone may close once the deadline or meeting limit passes.
    pub fn close_vote(ctx: Context<AnySession>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let s = &mut ctx.accounts.session;
        require!(s.vote.status == VOTE_OPEN, ConcordError::VoteNotOpen);
        let is_host = ctx.accounts.signer.key() == s.host;
        let timed_out = now > s.vote.deadline || meeting_expired(s.started_at, now);
        require!(is_host || timed_out, ConcordError::VoteNotClosable);
        s.vote.status = VOTE_CLOSING;
        s.vote.closed_at = now.min(s.vote.deadline);
        Ok(())
    }

    /// Permissionless. Tallies every eligible slot (remaining accounts, exact
    /// eligible order) inside PER, writes an aggregate-only summary, resets the slots.
    pub fn finalize_vote<'info>(ctx: Context<'info, FinalizeVote<'info>>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let session_key = ctx.accounts.session.key();
        let s = &mut ctx.accounts.session;
        if s.vote.status == VOTE_OPEN && (now > s.vote.deadline || meeting_expired(s.started_at, now)) {
            s.vote.status = VOTE_CLOSING;
            s.vote.closed_at = now.min(s.vote.deadline);
        }
        require!(s.vote.status == VOTE_CLOSING, ConcordError::VoteNotClosable);
        require!(ctx.remaining_accounts.len() == s.vote.eligible.len(), ConcordError::SlotSetMismatch);

        let mut slots = Vec::with_capacity(s.vote.eligible.len());
        for (voter, account) in s.vote.eligible.iter().zip(ctx.remaining_accounts.iter()) {
            slots.push(read_slot(&session_key, voter, account)?);
        }
        let (counts, submitted) = tally(&slots, s.vote.vote_id);
        let result = outcome(&counts);
        let registry = s.registry;
        let digest = summary_digest(
            &registry,
            s.vote.vote_id,
            &s.vote.question_hash,
            &s.vote.option_hashes,
            counts,
            s.vote.eligible.len() as u32,
            submitted,
            result,
            s.vote.closed_at,
            &s.vote.eligibility_hash,
        );

        // Reset choices so no ballot value outlives the tally.
        for (slot, account) in slots.iter_mut().zip(ctx.remaining_accounts.iter()) {
            if slot.option != NO_OPTION {
                slot.option = NO_OPTION;
                slot.encode(&mut account.try_borrow_mut_data()?)?;
            }
        }

        ctx.accounts.results.summaries.push(PublicVoteSummary {
            vote_id: s.vote.vote_id,
            question_hash: s.vote.question_hash,
            option_hashes: s.vote.option_hashes,
            counts,
            eligible_count: s.vote.eligible.len() as u32,
            submitted_count: submitted,
            outcome: result,
            closed_at: s.vote.closed_at,
            eligibility_hash: s.vote.eligibility_hash,
            summary_digest: digest,
        });
        s.vote = ActiveVote::none();
        Ok(())
    }

    /// Commits the aggregate results to the base layer (keeps them delegated).
    pub fn commit_results(ctx: Context<CommitResults>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.results.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    // ===================== PER: end and teardown =====================

    /// Host ends early; anyone may end once 60 minutes have passed. An active vote
    /// must be finalized first.
    pub fn end_meeting(ctx: Context<AnySession>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let s = &mut ctx.accounts.session;
        require!(s.started_at != 0, ConcordError::NotStarted);
        require!(s.ended_at == 0, ConcordError::MeetingNotActive);
        let is_host = ctx.accounts.signer.key() == s.host;
        require!(is_host || meeting_expired(s.started_at, now), ConcordError::Unauthorized);
        require!(s.vote.status == VOTE_NONE, ConcordError::VoteAlreadyActive);
        s.ended_at = now.min(s.started_at + MAX_DURATION_SECONDS);
        Ok(())
    }

    /// After the meeting ends, closes ephemeral slots and their permissions,
    /// refunding rent to the session. Remaining accounts: `[slot, slot_permission]`.
    pub fn close_voter_slots<'info>(
        ctx: Context<'info, CloseVoterSlots<'info>>,
        voters: Vec<Pubkey>,
    ) -> Result<()> {
        require!(ctx.accounts.session.ended_at != 0, ConcordError::MeetingNotEnded);
        require!(ctx.remaining_accounts.len() == voters.len() * 2, ConcordError::SlotSetMismatch);
        let session_key = ctx.accounts.session.key();
        let registry = ctx.accounts.session.registry;
        let session_seeds: &[&[u8]] = &[SESSION_SEED, registry.as_ref(), &[ctx.accounts.session.bump]];
        let mut closed: u16 = 0;
        for (i, voter) in voters.iter().enumerate() {
            let slot = &ctx.remaining_accounts[i * 2];
            let slot_permission = &ctx.remaining_accounts[i * 2 + 1];
            let (expected, slot_bump) = slot_address(&session_key, voter);
            require_keys_eq!(slot.key(), expected, ConcordError::SlotSetMismatch);
            require_keys_eq!(slot_permission.key(), permission_address(&expected), ConcordError::SlotSetMismatch);
            if slot.data_is_empty() {
                continue;
            }
            let slot_seeds: &[&[u8]] = &[SLOT_SEED, session_key.as_ref(), voter.as_ref(), &[slot_bump]];
            CloseEphemeralPermissionCpi {
                permissioned_account: slot.clone(),
                permission: slot_permission.clone(),
                payer: ctx.accounts.session.to_account_info(),
                authority: slot.clone(),
                vault: ctx.accounts.vault.to_account_info(),
                magic_program: ctx.accounts.magic_program.to_account_info(),
                permission_program: ctx.accounts.permission_program.to_account_info(),
                authority_is_signer: false,
            }
            .invoke_signed(&[session_seeds, slot_seeds])?;
            EphemeralAccount::new(
                &ctx.accounts.session.to_account_info(),
                slot,
                &ctx.accounts.vault.to_account_info(),
            )
            .with_signer_seeds(&[session_seeds])
            .close()?;
            closed += 1;
        }
        let s = &mut ctx.accounts.session;
        s.open_slots = s.open_slots.saturating_sub(closed);
        Ok(())
    }

    /// Commits and undelegates the session and results (and their permissions) back
    /// to the base layer. Requires an ended meeting with every slot closed, so no
    /// roster or ballot data is ever committed. Host only: the Magic program needs a
    /// signing permission member as the commit authority (Devnet-verified), and the
    /// next step (the receipt) is host-only anyway. Ending and finalizing stay
    /// permissionless, so an absent host cannot block vote outcomes.
    pub fn undelegate_room(ctx: Context<UndelegateRoom>) -> Result<()> {
        let s = &ctx.accounts.session;
        require_keys_eq!(ctx.accounts.payer.key(), s.host, ConcordError::Unauthorized);
        require!(s.ended_at != 0, ConcordError::MeetingNotEnded);
        require!(s.open_slots == 0, ConcordError::SlotsStillOpen);
        require!(s.vote.eligible.is_empty(), ConcordError::VoteAlreadyActive);
        // Anchor rewrites only the serialized prefix; stale bytes from the earlier
        // (longer) eligible list survive in the tail. Zero everything past the live
        // struct so no roster bytes are committed to the base layer (Gate E).
        let mut live = Vec::new();
        AnchorSerialize::serialize(&**s, &mut live)?;
        let used = 8 + live.len();
        {
            let info = ctx.accounts.session.to_account_info();
            let mut data = info.try_borrow_mut_data()?;
            data[used..].fill(0);
        }
        let registry = s.registry;
        let session_seeds: &[&[u8]] = &[SESSION_SEED, registry.as_ref(), &[s.bump]];
        let results_seeds: &[&[u8]] = &[RESULTS_SEED, registry.as_ref(), &[ctx.accounts.results.bump]];

        for (pda, permission, seeds) in [
            (ctx.accounts.session.to_account_info(), ctx.accounts.session_permission.to_account_info(), session_seeds),
            (ctx.accounts.results.to_account_info(), ctx.accounts.results_permission.to_account_info(), results_seeds),
        ] {
            CommitAndUndelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .authority(&ctx.accounts.payer.to_account_info(), true)
                .permissioned_account(&pda, true)
                .permission(&permission)
                .magic_context(&ctx.accounts.magic_context.to_account_info())
                .magic_program(&ctx.accounts.magic_program.to_account_info())
                .invoke_signed(&[seeds])?;
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.session.to_account_info(), ctx.accounts.results.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    // ===================== Base layer: receipt and cleanup =====================

    /// Host finalizes the public receipt after undelegation. Every summary digest is
    /// recomputed from its fields; times come from program state, not the caller.
    pub fn finalize_receipt(ctx: Context<FinalizeReceipt>, action_items_hash: [u8; 32]) -> Result<()> {
        let s = &ctx.accounts.session;
        require!(s.ended_at != 0, ConcordError::MeetingNotEnded);
        let registry_key = ctx.accounts.registry.key();
        let mut digests = Vec::with_capacity(ctx.accounts.results.summaries.len());
        for (i, v) in ctx.accounts.results.summaries.iter().enumerate() {
            require!(v.vote_id as usize == i, ConcordError::SlotSetMismatch);
            let d = summary_digest(
                &registry_key,
                v.vote_id,
                &v.question_hash,
                &v.option_hashes,
                v.counts,
                v.eligible_count,
                v.submitted_count,
                v.outcome,
                v.closed_at,
                &v.eligibility_hash,
            );
            require!(d == v.summary_digest, ConcordError::SlotSetMismatch);
            digests.push(d);
        }
        let r = &mut ctx.accounts.registry;
        require!(!r.receipt_finalized, ConcordError::ReceiptAlreadyFinalized);
        r.started_at = s.started_at;
        r.ended_at = s.ended_at;
        r.vote_count = digests.len() as u8;
        r.action_items_hash = action_items_hash;
        r.receipt_digest = digest::receipt_digest(
            &registry_key.to_bytes(),
            &r.vrf_output,
            s.started_at,
            s.ended_at,
            &digests,
            &action_items_hash,
        );
        r.receipt_finalized = true;
        Ok(())
    }

    /// Host reclaims rent for the session or results PDA and its permission after the
    /// receipt is final. The registry (the public receipt) is kept.
    pub fn close_room_pda(ctx: Context<CloseRoomPda>, kind: u8) -> Result<()> {
        require!(ctx.accounts.registry.receipt_finalized, ConcordError::ReceiptNotFinalized);
        require_keys_eq!(*ctx.accounts.pda.owner, crate::ID, ConcordError::StillDelegated);
        let registry = ctx.accounts.registry.key();
        let bump = ctx.bumps.pda;
        let seeds: &[&[u8]] = &[kind_seed(kind), registry.as_ref(), &[bump]];
        if !ctx.accounts.permission.data_is_empty() {
            ClosePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .payer(&ctx.accounts.host.to_account_info())
                .authority(&ctx.accounts.host.to_account_info(), true)
                .permissioned_account(&ctx.accounts.pda.to_account_info(), true)
                .permission(&ctx.accounts.permission.to_account_info())
                .invoke_signed(&[seeds])?;
        }
        // Return all lamports to the host and zero the account.
        let pda = ctx.accounts.pda.to_account_info();
        let host = ctx.accounts.host.to_account_info();
        let lamports = pda.lamports();
        **host.try_borrow_mut_lamports()? += lamports;
        **pda.try_borrow_mut_lamports()? = 0;
        pda.assign(&system_program::ID);
        pda.resize(0)?;
        Ok(())
    }
}

// ===================== Account contexts =====================

#[derive(Accounts)]
#[instruction(room_nonce: [u8; 16])]
pub struct InitializeRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + RoomRegistry::INIT_SPACE,
        seeds = [ROOM_SEED, creator.key().as_ref(), room_nonce.as_ref()],
        bump
    )]
    pub registry: Account<'info, RoomRegistry>,
    pub system_program: Program<'info, System>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRoomRandomness<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [ROOM_SEED, creator.key().as_ref(), registry.room_nonce.as_ref()],
        bump = registry.bump,
        has_one = creator @ ConcordError::Unauthorized
    )]
    pub registry: Account<'info, RoomRegistry>,
    /// CHECK: validated by the VRF program when it processes the request
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct StoreRoomRandomness<'info> {
    #[account(mut)]
    pub registry: Account<'info, RoomRegistry>,
}

#[derive(Accounts)]
pub struct InitRoomState<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(constraint = registry.creator == host.key() @ ConcordError::Unauthorized)]
    pub registry: Account<'info, RoomRegistry>,
    #[account(
        init,
        payer = host,
        space = 8 + RoomSession::INIT_SPACE,
        seeds = [SESSION_SEED, registry.key().as_ref()],
        bump
    )]
    pub session: Account<'info, RoomSession>,
    #[account(
        init,
        payer = host,
        space = 8 + RoomResults::INIT_SPACE,
        seeds = [RESULTS_SEED, registry.key().as_ref()],
        bump
    )]
    pub results: Account<'info, RoomResults>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(kind: u8)]
pub struct DelegateRoomPda<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(constraint = registry.creator == host.key() @ ConcordError::Unauthorized)]
    pub registry: Account<'info, RoomRegistry>,
    /// CHECK: session or results PDA being delegated (seeds checked)
    #[account(mut, del, seeds = [kind_seed(kind), registry.key().as_ref()], bump)]
    pub pda: UncheckedAccount<'info>,
    /// CHECK: permission PDA, validated by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, pda.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: delegation buffer for the permission (validated by the permission program)
    #[account(mut)]
    pub buffer_permission: UncheckedAccount<'info>,
    /// CHECK: delegation record for the permission (validated by the delegation program)
    #[account(mut)]
    pub delegation_record_permission: UncheckedAccount<'info>,
    /// CHECK: delegation metadata for the permission (validated by the delegation program)
    #[account(mut)]
    pub delegation_metadata_permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: validator identity to delegate to (the TEE validator for PER)
    pub validator: Option<UncheckedAccount<'info>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddVoterSlots<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [SESSION_SEED, session.registry.as_ref()],
        bump = session.bump,
        has_one = host @ ConcordError::Unauthorized
    )]
    pub session: Account<'info, RoomSession>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct HostSession<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [SESSION_SEED, session.registry.as_ref()],
        bump = session.bump,
        has_one = host @ ConcordError::Unauthorized
    )]
    pub session: Account<'info, RoomSession>,
}

#[derive(Accounts)]
pub struct AnySession<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SESSION_SEED, session.registry.as_ref()], bump = session.bump)]
    pub session: Account<'info, RoomSession>,
}

#[derive(Accounts)]
pub struct CastVote<'info> {
    /// Signs as authority only; need not hold SOL or pay the fee.
    pub voter: Signer<'info>,
    #[account(seeds = [SESSION_SEED, session.registry.as_ref()], bump = session.bump)]
    pub session: Account<'info, RoomSession>,
    /// CHECK: ephemeral slot; address, owner, magic and voter checked in handler
    #[account(mut)]
    pub slot: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeVote<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SESSION_SEED, session.registry.as_ref()], bump = session.bump)]
    pub session: Account<'info, RoomSession>,
    #[account(
        mut,
        seeds = [RESULTS_SEED, session.registry.as_ref()],
        bump = results.bump,
        constraint = results.registry == session.registry @ ConcordError::SlotSetMismatch
    )]
    pub results: Account<'info, RoomResults>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitResults<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [RESULTS_SEED, results.registry.as_ref()], bump = results.bump)]
    pub results: Account<'info, RoomResults>,
}

#[derive(Accounts)]
pub struct CloseVoterSlots<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [SESSION_SEED, session.registry.as_ref()], bump = session.bump)]
    pub session: Account<'info, RoomSession>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [SESSION_SEED, session.registry.as_ref()], bump = session.bump)]
    pub session: Account<'info, RoomSession>,
    #[account(
        mut,
        seeds = [RESULTS_SEED, session.registry.as_ref()],
        bump = results.bump,
        constraint = results.registry == session.registry @ ConcordError::SlotSetMismatch
    )]
    pub results: Account<'info, RoomResults>,
    /// CHECK: validated by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, session.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub session_permission: UncheckedAccount<'info>,
    /// CHECK: validated by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, results.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub results_permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct FinalizeReceipt<'info> {
    pub host: Signer<'info>,
    #[account(mut, constraint = registry.creator == host.key() @ ConcordError::Unauthorized)]
    pub registry: Account<'info, RoomRegistry>,
    /// Owner check (Anchor) proves the session is undelegated.
    #[account(seeds = [SESSION_SEED, registry.key().as_ref()], bump = session.bump)]
    pub session: Account<'info, RoomSession>,
    #[account(seeds = [RESULTS_SEED, registry.key().as_ref()], bump = results.bump)]
    pub results: Account<'info, RoomResults>,
}

#[derive(Accounts)]
#[instruction(kind: u8)]
pub struct CloseRoomPda<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(constraint = registry.creator == host.key() @ ConcordError::Unauthorized)]
    pub registry: Account<'info, RoomRegistry>,
    /// CHECK: session or results PDA (seeds and owner checked)
    #[account(mut, seeds = [kind_seed(kind), registry.key().as_ref()], bump)]
    pub pda: UncheckedAccount<'info>,
    /// CHECK: validated by the permission program
    #[account(mut, seeds = [PERMISSION_SEED, pda.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
}
