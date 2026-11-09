use anchor_lang::prelude::*;

use crate::logic::{MAX_PARTICIPANTS, MAX_VOTES, NO_VOTE};

pub const ROOM_SEED: &[u8] = b"concord_room";
pub const SESSION_SEED: &[u8] = b"concord_session";
pub const RESULTS_SEED: &[u8] = b"concord_results";
pub const SLOT_SEED: &[u8] = b"concord_slot";

pub const VOTE_NONE: u8 = 0;
pub const VOTE_OPEN: u8 = 1;
pub const VOTE_CLOSING: u8 = 2;

/// Public base-layer registry. Never delegated. Holds only non-sensitive data:
/// creator, VRF output, and the final receipt commitment (spec 9.2-A).
#[account]
#[derive(InitSpace)]
pub struct RoomRegistry {
    pub creator: Pubkey,
    pub room_nonce: [u8; 16],
    pub created_at: i64,
    pub vrf_output: [u8; 32],
    pub vrf_fulfilled: bool,
    pub started_at: i64,
    pub ended_at: i64,
    pub vote_count: u8,
    pub action_items_hash: [u8; 32],
    pub receipt_digest: [u8; 32],
    pub receipt_finalized: bool,
    pub bump: u8,
}

/// Private room lifecycle, delegated to the TEE PER with a permission whose only
/// member is the host. Also the rent sponsor for ephemeral voter slots.
#[account]
#[derive(InitSpace)]
pub struct RoomSession {
    pub registry: Pubkey,
    pub host: Pubkey,
    pub started_at: i64,
    pub ended_at: i64,
    pub next_vote_id: u8,
    /// Ephemeral voter slots currently open (must reach 0 before undelegation).
    pub open_slots: u16,
    pub vote: ActiveVote,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct ActiveVote {
    pub vote_id: u8,
    pub status: u8,
    pub question_hash: [u8; 32],
    pub option_hashes: [[u8; 32]; 3],
    pub opened_at: i64,
    pub deadline: i64,
    pub closed_at: i64,
    /// Frozen, sorted eligibility snapshot. Cleared before the session is committed.
    #[max_len(MAX_PARTICIPANTS)]
    pub eligible: Vec<Pubkey>,
    pub eligibility_hash: [u8; 32],
}

impl ActiveVote {
    pub fn none() -> Self {
        Self {
            vote_id: NO_VOTE,
            status: VOTE_NONE,
            question_hash: [0; 32],
            option_hashes: [[0; 32]; 3],
            opened_at: 0,
            deadline: 0,
            closed_at: 0,
            eligible: vec![],
            eligibility_hash: [0; 32],
        }
    }
}

/// Aggregate-only results, delegated alongside the session and committed to the
/// base layer after each finalized vote. Contains no ballot or voter data.
#[account]
#[derive(InitSpace)]
pub struct RoomResults {
    pub registry: Pubkey,
    #[max_len(MAX_VOTES)]
    pub summaries: Vec<PublicVoteSummary>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct PublicVoteSummary {
    pub vote_id: u8,
    pub question_hash: [u8; 32],
    pub option_hashes: [[u8; 32]; 3],
    pub counts: [u32; 3],
    pub eligible_count: u32,
    pub submitted_count: u32,
    pub outcome: u8,
    pub closed_at: i64,
    pub eligibility_hash: [u8; 32],
    pub summary_digest: [u8; 32],
}
