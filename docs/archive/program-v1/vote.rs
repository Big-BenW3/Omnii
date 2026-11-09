//! Vote module: Account types for private voting.
//!
//! This module provides the account types needed for Phase 1 privacy proof:
//! - VoteState: private vote round state
//! - PrivateBallot: one per (room, voter) - stores only the option index
//! - PublicVoteSummary: aggregate-only account, committed after finalization
//! - EligibilitySnapshot: frozen list of eligible voters
//!
//! Privacy guarantees (spec 9.3, 9.6 Gates C-E):
//! - PrivateBallot accounts use PER and must not be readable by unauthorized parties
//! - Tally is computed from PrivateBallot accounts inside PER without exposing individual choices
//! - PublicVoteSummary contains only aggregate counts and hashes, never ballot data

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::digest::{VOTE_SUMMARY_PREFIX, OUTCOME_OPTION_0, OUTCOME_OPTION_1, OUTCOME_OPTION_2, OUTCOME_TIE, OUTCOME_NO_DECISION};

/// Maximum number of eligible voters per vote (matches spec constraint of 20 participants)
pub const MAX_ELIGIBLE_VOTERS: usize = 20;

/// Maximum length for hash (SHA-256)
pub const HASH_LENGTH: usize = 32;

/// Seed prefixes for PDAs
pub const VOTE_SEED: &[u8] = b"concord_vote";
pub const BALLOT_SEED: &[u8] = b"concord_ballot";
pub const VOTE_SUMMARY_SEED: &[u8] = b"concord_vote_summary";
pub const ELIGIBILITY_SEED: &[u8] = b"concord_eligibility";

/// Vote lifecycle states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum VoteStatus {
    Draft,
    Open,
    Closing,
    Finalized,
    Committed,
}

impl Default for VoteStatus {
    fn default() -> Self {
        VoteStatus::Draft
    }
}

/// Outcome of a vote after finalization
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum VoteOutcome {
    Option0,
    Option1,
    Option2,
    Tie,
    NoDecision,
}

impl VoteOutcome {
    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            OUTCOME_OPTION_0 => Some(VoteOutcome::Option0),
            OUTCOME_OPTION_1 => Some(VoteOutcome::Option1),
            OUTCOME_OPTION_2 => Some(VoteOutcome::Option2),
            OUTCOME_TIE => Some(VoteOutcome::Tie),
            OUTCOME_NO_DECISION => Some(VoteOutcome::NoDecision),
            _ => None,
        }
    }

    pub fn to_code(&self) -> u8 {
        match self {
            VoteOutcome::Option0 => OUTCOME_OPTION_0,
            VoteOutcome::Option1 => OUTCOME_OPTION_1,
            VoteOutcome::Option2 => OUTCOME_OPTION_2,
            VoteOutcome::Tie => OUTCOME_TIE,
            VoteOutcome::NoDecision => OUTCOME_NO_DECISION,
        }
    }
}

/// Vote configuration and state. Stored in PER as a private account.
#[account]
pub struct VoteState {
    pub room: Pubkey,
    pub vote_id: u64,
    pub host: Pubkey,
    pub question_hash: [u8; HASH_LENGTH],
    pub option_hashes: [[u8; HASH_LENGTH]; 3],
    pub deadline: i64,
    pub opened_at: i64,
    pub closed_at: i64,
    pub status: VoteStatus,
    pub eligible_count: u32,
    pub submitted_count: u32,
    pub eligibility_snapshot_hash: [u8; HASH_LENGTH],
    pub outcome: VoteOutcome,
    pub counts: [u32; 3],
    pub bump: u8,
}

impl VoteState {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 32 + 32 * 3 + 8 + 8 + 8 + 1 + 4 + 4 + 32 + 1 + 4 * 3 + 1;

    pub fn summary_digest(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(VOTE_SUMMARY_PREFIX);
        hasher.update(self.room.to_bytes());
        hasher.update(self.vote_id.to_le_bytes());
        hasher.update(&self.question_hash);
        for option_hash in &self.option_hashes {
            hasher.update(option_hash);
        }
        for count in &self.counts {
            hasher.update(count.to_le_bytes());
        }
        hasher.update(self.eligible_count.to_le_bytes());
        hasher.update(self.submitted_count.to_le_bytes());
        hasher.update([self.outcome.to_code()]);
        hasher.update(self.closed_at.to_le_bytes());
        hasher.update(&self.eligibility_snapshot_hash);
        hasher.finalize().into()
    }
}

/// Private ballot account. One per (room, voter).
/// For Phase 1 proof, we use room + voter as PDA seeds.
#[account]
pub struct PrivateBallot {
    pub room: Pubkey,
    pub voter: Pubkey,
    pub selected_option: u8,
    pub submitted_at: i64,
    pub bump: u8,
}

impl PrivateBallot {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 1;
}

/// Public vote summary. Contains only aggregate data. Safe to commit to base layer.
#[account]
pub struct PublicVoteSummary {
    pub room: Pubkey,
    pub vote_id: u64,
    pub question_hash: [u8; HASH_LENGTH],
    pub option_hashes: [[u8; HASH_LENGTH]; 3],
    pub counts: [u32; 3],
    pub eligible_count: u32,
    pub submitted_count: u32,
    pub outcome: VoteOutcome,
    pub closed_at: i64,
    pub eligibility_snapshot_hash: [u8; HASH_LENGTH],
    pub bump: u8,
}

impl PublicVoteSummary {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 32 * 3 + 4 * 3 + 4 + 4 + 1 + 8 + 32 + 1;
}

/// Eligibility snapshot. Frozen list of eligible voter wallets at vote open time.
#[account]
pub struct EligibilitySnapshot {
    pub room: Pubkey,
    pub vote_id: u64,
    pub eligible_wallets: Vec<Pubkey>,
    pub hash: [u8; HASH_LENGTH],
    pub bump: u8,
}

impl EligibilitySnapshot {
    pub const LEN_PREFIX: usize = 8 + 32 + 8 + 4 + 32 + 1;
    pub const MAX_LEN: usize = Self::LEN_PREFIX + (MAX_ELIGIBLE_VOTERS * 32);

    pub fn compute_hash(wallets: &[Pubkey]) -> [u8; HASH_LENGTH] {
        let mut hasher = Sha256::new();
        for wallet in wallets {
            hasher.update(wallet.to_bytes());
        }
        hasher.finalize().into()
    }
}

/// Compute vote outcome from counts
pub fn compute_outcome(counts: &[u32; 3]) -> VoteOutcome {
    let total: u32 = counts.iter().sum();
    
    if total == 0 {
        return VoteOutcome::NoDecision;
    }
    
    let max_count = counts.iter().max().copied().unwrap_or(0);
    let max_options: Vec<usize> = counts
        .iter()
        .enumerate()
        .filter(|(_, &count)| count == max_count)
        .map(|(idx, _)| idx)
        .collect();
    
    if max_options.len() == 1 {
        match max_options[0] {
            0 => VoteOutcome::Option0,
            1 => VoteOutcome::Option1,
            2 => VoteOutcome::Option2,
            _ => VoteOutcome::NoDecision,
        }
    } else {
        VoteOutcome::Tie
    }
}
