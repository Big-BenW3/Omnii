use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    anchor::{commit, delegate, ephemeral, vrf, vrf_callback},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::instructions::{create_request_randomness_ix, RequestRandomnessParams},
    vrf::types::SerializableAccountMeta,
};

pub mod digest;
pub mod vote;

use digest::receipt_digest;
pub use vote::{
    compute_outcome, EligibilitySnapshot, PrivateBallot, PublicVoteSummary,
    VoteOutcome, VoteState, VoteStatus, HASH_LENGTH, MAX_ELIGIBLE_VOTERS,
    VOTE_SEED, BALLOT_SEED, VOTE_SUMMARY_SEED, ELIGIBILITY_SEED,
};

// New Devnet keypair (ADR-008). Never guessed: generated with
// solana-keygen and kept at target/deploy/concord-keypair.json.
declare_id!("85DsSom7cr5hHVZeTB7k3WKKKpFMB2DLUN3c6FbR9861");

pub const ROOM_SEED: &[u8] = b"concord_room";

#[ephemeral]
#[program]
pub mod concord {
    use super::*;

    /// Creates the room PDA (base layer). Stores only wallet-level metadata;
    /// meeting titles/descriptions never go on-chain.
    pub fn initialize_room(ctx: Context<InitializeRoom>, created_at: i64) -> Result<()> {
        let room = &mut ctx.accounts.room;
        room.creator = ctx.accounts.creator.key();
        room.created_at = created_at;
        room.started_at = 0;
        room.ended_at = 0;
        room.vrf_output_digest = [0u8; 32];
        room.receipt_digest = [0u8; 32];
        room.receipt_finalized = false;
        room.vrf_fulfilled = false;
        room.vote_count = 0;
        room.next_vote_id = 0;
        msg!("room initialized: {}", room.key());
        Ok(())
    }

    /// Marks the room started (host action). Write-once.
    pub fn start_room(ctx: Context<HostOnly>) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(room.started_at == 0, ConcordError::AlreadyStarted);
        room.started_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Delegates the room account to the ephemeral rollup so VRF and
    /// subsequent state work execute in the ER environment.
    pub fn delegate_room(ctx: Context<DelegateRoom>) -> Result<()> {
        ctx.accounts.delegate_room(
            &ctx.accounts.creator,
            &[ROOM_SEED, ctx.accounts.creator.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
                ..Default::default()
            },
        )?;
        msg!("room delegated: {}", ctx.accounts.room.key());
        Ok(())
    }

    /// Requests verifiable randomness for this room using the scoped VRF
    /// identity. Must run on the ER after delegation.
    pub fn request_room_randomness(ctx: Context<RequestRoomRandomness>) -> Result<()> {
        require!(
            !ctx.accounts.room.vrf_fulfilled,
            ConcordError::RandomnessAlreadyFulfilled
        );
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: ID,
            callback_discriminator: instruction::StoreRoomRandomness::DISCRIMINATOR.to_vec(),
            caller_seed: ctx.accounts.room.key().to_bytes(),
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.room.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        });
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        msg!("randomness requested for room: {}", ctx.accounts.room.key());
        Ok(())
    }

    /// VRF callback. The #[vrf_callback] macro validates the scoped VRF
    /// identity PDA as the signer; arbitrary callers cannot fulfill.
    pub fn store_room_randomness(
        ctx: Context<StoreRoomRandomness>,
        randomness: [u8; 32],
    ) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(
            !room.vrf_fulfilled,
            ConcordError::RandomnessAlreadyFulfilled
        );
        room.vrf_output_digest = randomness;
        room.vrf_fulfilled = true;
        msg!("randomness stored for room: {}", room.key());
        Ok(())
    }

    /// Finalizes the public receipt: computes the deterministic digest over
    /// the public fields (spec 9.5) and stores it write-once. Vote summary
    /// digests are passed ordered; per-summary validation against program
    /// vote state lands with the Phase 4 vote instructions.
    pub fn finalize_receipt(
        ctx: Context<FinalizeReceipt>,
        ordered_summary_digests: Vec<[u8; 32]>,
        action_items_hash: [u8; 32],
        ended_at: i64,
    ) -> Result<()> {
        let room = &mut ctx.accounts.room;
        require!(room.vrf_fulfilled, ConcordError::RandomnessPending);
        require!(!room.receipt_finalized, ConcordError::ReceiptAlreadyFinalized);
        require!(room.started_at != 0, ConcordError::NotStarted);
        require!(ended_at >= room.started_at, ConcordError::InvalidTimestamp);
        require!(
            ordered_summary_digests.len() <= u8::MAX as usize,
            ConcordError::TooManySummaries
        );

        let room_id = room.key();
        let digest = receipt_digest(
            &room_id.to_bytes(),
            &room.vrf_output_digest,
            room.started_at,
            ended_at,
            &ordered_summary_digests,
            &action_items_hash,
        );
        room.ended_at = ended_at;
        room.vote_count = ordered_summary_digests.len() as u8;
        room.receipt_digest = digest;
        room.receipt_finalized = true;
        msg!("receipt finalized for room: {}", room_id);
        Ok(())
    }

    /// Commits the room account (with its receipt digest) from the ER to the
    /// base layer. Distinguishes ER acceptance from base commit: only after
    /// the base-layer account confirms is the receipt public.
    pub fn commit_room(ctx: Context<CommitRoom>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.room.to_account_info()])
        .build_and_invoke()?;
        msg!("room commit submitted: {}", ctx.accounts.room.key());
        Ok(())
    }

    // ========================================================================
    // Vote Instructions (Phase 1)
    // ========================================================================

    /// Opens a new vote round. Host-only. Creates VoteState and EligibilitySnapshot.
    /// Freezes the eligibility list at open time.
    pub fn open_vote(
        ctx: Context<OpenVote>,
        question_hash: [u8; HASH_LENGTH],
        option_hashes: [[u8; HASH_LENGTH]; 3],
        deadline: i64,
        eligible_wallets: Vec<Pubkey>,
    ) -> Result<()> {
        let vote_state = &mut ctx.accounts.vote_state;
        let room = &mut ctx.accounts.room;
        let host = &ctx.accounts.host;
        let eligibility_snapshot = &mut ctx.accounts.eligibility_snapshot;
        
        let clock = Clock::get()?;
        
        require!(
            host.key() == room.creator,
            ConcordError::Unauthorized
        );
        
        require!(room.started_at != 0, ConcordError::NotStarted);
        require!(!room.receipt_finalized, ConcordError::ReceiptAlreadyFinalized);
        
        let meeting_end = room.started_at + 3600;
        require!(deadline <= meeting_end, ConcordError::InvalidDeadline);
        require!(deadline > clock.unix_timestamp, ConcordError::InvalidDeadline);
        
        require!(
            eligible_wallets.len() <= MAX_ELIGIBLE_VOTERS,
            ConcordError::TooManyEligibleVoters
        );
        
        let mut sorted_wallets = eligible_wallets.clone();
        sorted_wallets.sort();
        let eligibility_hash = EligibilitySnapshot::compute_hash(&sorted_wallets);
        
        let vote_id = room.next_vote_id;
        room.next_vote_id += 1;
        
        vote_state.room = room.key();
        vote_state.vote_id = vote_id;
        vote_state.host = host.key();
        vote_state.question_hash = question_hash;
        vote_state.option_hashes = option_hashes;
        vote_state.deadline = deadline;
        vote_state.opened_at = clock.unix_timestamp;
        vote_state.closed_at = 0;
        vote_state.status = VoteStatus::Open;
        vote_state.eligible_count = eligible_wallets.len() as u32;
        vote_state.submitted_count = 0;
        vote_state.eligibility_snapshot_hash = eligibility_hash;
        vote_state.outcome = VoteOutcome::NoDecision;
        vote_state.counts = [0, 0, 0];
        
        eligibility_snapshot.room = room.key();
        eligibility_snapshot.vote_id = vote_id;
        eligibility_snapshot.eligible_wallets = sorted_wallets;
        eligibility_snapshot.hash = eligibility_hash;
        
        msg!("vote opened: room={}, vote_id={}", room.key(), vote_id);
        Ok(())
    }

    /// Casts a ballot. Voter must be authenticated.
    /// Creates a PrivateBallot account.
    pub fn cast_vote(ctx: Context<CastVote>, selected_option: u8) -> Result<()> {
        let vote_state = &mut ctx.accounts.vote_state;
        let ballot = &mut ctx.accounts.ballot;
        let room = &ctx.accounts.room;
        let voter = &ctx.accounts.voter;
        
        let clock = Clock::get()?;
        
        require!(
            vote_state.status == VoteStatus::Open,
            ConcordError::VoteNotOpen
        );
        
        require!(
            clock.unix_timestamp <= vote_state.deadline,
            ConcordError::VoteDeadlinePassed
        );
        
        require!(selected_option < 3, ConcordError::InvalidOption);
        
        ballot.room = room.key();
        ballot.voter = voter.key();
        ballot.selected_option = selected_option;
        ballot.submitted_at = clock.unix_timestamp;
        
        vote_state.submitted_count += 1;
        
        msg!("ballot cast: room={}, voter={:?}", room.key(), voter.key());
        Ok(())
    }

    /// Closes a vote. Host can close early; anyone can close after deadline.
    pub fn close_vote(ctx: Context<CloseVote>) -> Result<()> {
        let vote_state = &mut ctx.accounts.vote_state;
        let room = &ctx.accounts.room;
        let host = &ctx.accounts.host;
        
        let clock = Clock::get()?;
        
        if host.key() != room.creator {
            require!(
                clock.unix_timestamp >= vote_state.deadline,
                ConcordError::Unauthorized
            );
        }
        
        require!(
            vote_state.status == VoteStatus::Open,
            ConcordError::VoteAlreadyClosed
        );
        
        vote_state.status = VoteStatus::Closing;
        vote_state.closed_at = clock.unix_timestamp;
        
        msg!("vote closed: room={}, vote_id={}", vote_state.room, vote_state.vote_id);
        Ok(())
    }

    /// Finalizes a vote. Permissionless once closed.
    /// For Phase 1 proof: counts and submitted_count are passed as parameters.
    /// In production: these would be computed from PrivateBallot accounts.
    pub fn finalize_vote(
        ctx: Context<FinalizeVote>,
        counts: [u32; 3],
        submitted_count: u32,
    ) -> Result<()> {
        let vote_state = &mut ctx.accounts.vote_state;
        let public_summary = &mut ctx.accounts.public_summary;
        
        require!(
            vote_state.status == VoteStatus::Closing,
            ConcordError::VoteNotClosed
        );
        
        let total: u32 = counts.iter().sum();
        require!(
            total == submitted_count,
            ConcordError::InvalidTally
        );
        
        let outcome = compute_outcome(&counts);
        
        vote_state.status = VoteStatus::Finalized;
        vote_state.counts = counts;
        vote_state.outcome = outcome.clone();
        vote_state.submitted_count = submitted_count;
        
        public_summary.room = vote_state.room;
        public_summary.vote_id = vote_state.vote_id;
        public_summary.question_hash = vote_state.question_hash;
        public_summary.option_hashes = vote_state.option_hashes;
        public_summary.counts = counts;
        public_summary.eligible_count = vote_state.eligible_count;
        public_summary.submitted_count = submitted_count;
        public_summary.outcome = outcome.clone();
        public_summary.closed_at = vote_state.closed_at;
        public_summary.eligibility_snapshot_hash = vote_state.eligibility_snapshot_hash;
        
        msg!("vote finalized: room={}, vote_id={}, outcome={:?}", 
            vote_state.room, vote_state.vote_id, outcome
        );
        Ok(())
    }

    /// Commits the PublicVoteSummary to base layer.
    pub fn commit_vote_summary(ctx: Context<CommitVoteSummary>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.public_summary.to_account_info()])
        .build_and_invoke()?;
        
        let vote_state = &mut ctx.accounts.vote_state;
        vote_state.status = VoteStatus::Committed;
        
        msg!("vote summary committed: room={}, vote_id={}", 
            vote_state.room, vote_state.vote_id
        );
        Ok(())
    }
}

// ========================================================================
// Accounts
// ========================================================================

#[account]
pub struct Room {
    pub creator: Pubkey,
    pub created_at: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub vrf_output_digest: [u8; 32],
    pub receipt_digest: [u8; 32],
    pub receipt_finalized: bool,
    pub vrf_fulfilled: bool,
    pub vote_count: u8,
    pub next_vote_id: u64,
    pub bump: u8,
}

impl Room {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 32 + 32 + 1 + 1 + 1 + 8 + 1;
}

// ========================================================================
// Room Account Contexts
// ========================================================================

#[derive(Accounts)]
pub struct InitializeRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(
        init,
        payer = creator,
        space = Room::LEN,
        seeds = [ROOM_SEED, creator.key().as_ref()],
        bump
    )]
    pub room: Account<'info, Room>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct HostOnly<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [ROOM_SEED, creator.key().as_ref()],
        bump,
        has_one = creator @ ConcordError::Unauthorized
    )]
    pub room: Account<'info, Room>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: validated PDA; becomes delegated account state
    #[account(
        mut,
        del,
        seeds = [ROOM_SEED, creator.key().as_ref()],
        bump
    )]
    pub room: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestRoomRandomness<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [ROOM_SEED, payer.key().as_ref()],
        bump,
        constraint = room.creator == payer.key() @ ConcordError::Unauthorized
    )]
    pub room: Account<'info, Room>,
    /// CHECK: validated by the ephemeral VRF program when it processes the request
    #[account(mut)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct StoreRoomRandomness<'info> {
    #[account(mut)]
    pub room: Account<'info, Room>,
}

#[derive(Accounts)]
pub struct FinalizeReceipt<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [ROOM_SEED, creator.key().as_ref()],
        bump,
        has_one = creator @ ConcordError::Unauthorized
    )]
    pub room: Account<'info, Room>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [ROOM_SEED, payer.key().as_ref()],
        bump,
        constraint = room.creator == payer.key() @ ConcordError::Unauthorized,
        constraint = room.receipt_finalized @ ConcordError::ReceiptNotFinalized
    )]
    pub room: Account<'info, Room>,
    #[account(mut)]
    pub magic_context: UncheckedAccount<'info>,
    pub magic_program: UncheckedAccount<'info>,
}

// ========================================================================
// Vote Account Contexts
// ========================================================================

/// Context for opening a vote. Requires host signature.
#[derive(Accounts)]
pub struct OpenVote<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    
    #[account(
        mut,
        seeds = [ROOM_SEED, host.key().as_ref()],
        bump,
    )]
    pub room: Account<'info, Room>,
    
    #[account(
        init,
        payer = host,
        space = VoteState::LEN,
        seeds = [vote::VOTE_SEED, room.key().as_ref()],
        bump,
    )]
    pub vote_state: Account<'info, VoteState>,
    
    #[account(
        init,
        payer = host,
        space = EligibilitySnapshot::MAX_LEN,
        seeds = [vote::ELIGIBILITY_SEED, room.key().as_ref()],
        bump,
    )]
    pub eligibility_snapshot: Account<'info, EligibilitySnapshot>,
    
    pub system_program: Program<'info, System>,
}

/// Context for casting a vote. Requires voter signature.
#[derive(Accounts)]
pub struct CastVote<'info> {
    #[account(mut)]
    pub voter: Signer<'info>,
    
    #[account(
        seeds = [ROOM_SEED, room.creator.as_ref()],
        bump,
    )]
    pub room: Account<'info, Room>,
    
    #[account(
        mut,
        seeds = [vote::VOTE_SEED, room.key().as_ref()],
        bump,
    )]
    pub vote_state: Account<'info, VoteState>,
    
    #[account(
        init,
        payer = voter,
        space = PrivateBallot::LEN,
        seeds = [vote::BALLOT_SEED, room.key().as_ref(), voter.key().as_ref()],
        bump,
    )]
    pub ballot: Account<'info, PrivateBallot>,
    
    pub system_program: Program<'info, System>,
}

/// Context for closing a vote.
#[derive(Accounts)]
pub struct CloseVote<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    
    #[account(
        mut,
        seeds = [ROOM_SEED, room.creator.as_ref()],
        bump,
    )]
    pub room: Account<'info, Room>,
    
    #[account(
        mut,
        seeds = [vote::VOTE_SEED, room.key().as_ref()],
        bump,
    )]
    pub vote_state: Account<'info, VoteState>,
}

/// Context for finalizing a vote.
#[derive(Accounts)]
pub struct FinalizeVote<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        seeds = [ROOM_SEED, room.creator.as_ref()],
        bump,
    )]
    pub room: Account<'info, Room>,
    
    #[account(
        mut,
        seeds = [vote::VOTE_SEED, room.key().as_ref()],
        bump,
    )]
    pub vote_state: Account<'info, VoteState>,
    
    #[account(
        init,
        payer = payer,
        space = PublicVoteSummary::LEN,
        seeds = [vote::VOTE_SUMMARY_SEED, room.key().as_ref()],
        bump,
    )]
    pub public_summary: Account<'info, PublicVoteSummary>,
    
    pub system_program: Program<'info, System>,
}

/// Context for committing vote summary to base layer.
#[commit]
#[derive(Accounts)]
pub struct CommitVoteSummary<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    #[account(
        seeds = [ROOM_SEED, room.creator.as_ref()],
        bump,
    )]
    pub room: Account<'info, Room>,
    
    #[account(
        mut,
        seeds = [vote::VOTE_SEED, room.key().as_ref()],
        bump,
    )]
    pub vote_state: Account<'info, VoteState>,
    
    #[account(
        mut,
        seeds = [vote::VOTE_SUMMARY_SEED, room.key().as_ref()],
        bump,
    )]
    pub public_summary: Account<'info, PublicVoteSummary>,
    
    #[account(mut)]
    pub magic_context: UncheckedAccount<'info>,
    
    pub magic_program: UncheckedAccount<'info>,
}

// ========================================================================
// Error Codes
// ========================================================================

#[error_code]
pub enum ConcordError {
    #[msg("Unauthorized: signer is not the room creator")]
    Unauthorized,
    #[msg("Room already started")]
    AlreadyStarted,
    #[msg("Room not started")]
    NotStarted,
    #[msg("Randomness already fulfilled")]
    RandomnessAlreadyFulfilled,
    #[msg("Randomness not yet fulfilled")]
    RandomnessPending,
    #[msg("Receipt already finalized")]
    ReceiptAlreadyFinalized,
    #[msg("Receipt not yet finalized")]
    ReceiptNotFinalized,
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
    #[msg("Too many vote summaries")]
    TooManySummaries,
    
    // Vote-related errors
    #[msg("Vote is not open")]
    VoteNotOpen,
    #[msg("Vote already closed")]
    VoteAlreadyClosed,
    #[msg("Vote deadline has passed")]
    VoteDeadlinePassed,
    #[msg("Invalid option index")]
    InvalidOption,
    #[msg("Voter is not eligible for this vote")]
    NotEligible,
    #[msg("Vote not closed yet")]
    VoteNotClosed,
    #[msg("Too many eligible voters")]
    TooManyEligibleVoters,
    #[msg("Invalid deadline")]
    InvalidDeadline,
    #[msg("Invalid tally: counts do not sum to submitted count")]
    InvalidTally,
}
