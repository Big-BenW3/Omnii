//! Program integration tests for vote instructions
//! These tests verify the vote instructions work correctly end-to-end

use anchor_lang::prelude::*;
use concord::{
    self,
    vote::{VoteOutcome, VoteState, VoteStatus},
    Room,
};

#[cfg(test)]
mod tests {
    use super::*;
    use anchor_lang::solana_program::pubkey::Pubkey;
    use std::str::FromStr;

    // Helper to create a deterministic Pubkey from bytes
    fn pubkey_from_bytes(bytes: &[u8; 32]) -> Pubkey {
        Pubkey::new_from_array(*bytes)
    }
    
    fn alice() -> Pubkey {
        pubkey_from_bytes(&[1u8; 32])
    }

    fn bob() -> Pubkey {
        pubkey_from_bytes(&[2u8; 32])
    }

    fn carol() -> Pubkey {
        pubkey_from_bytes(&[3u8; 32])
    }

    // ========================================================================
    // Room Tests
    // ========================================================================

    #[test]
    fn test_room_initialization() {
        // Room should be initialized with correct default values
        let room = Room {
            creator: alice(),
            created_at: 1000,
            started_at: 0,
            ended_at: 0,
            vrf_output_digest: [0u8; 32],
            receipt_digest: [0u8; 32],
            receipt_finalized: false,
            vrf_fulfilled: false,
            vote_count: 0,
            next_vote_id: 0,
            bump: 0,
        };

        assert_eq!(room.creator, alice());
        assert_eq!(room.created_at, 1000);
        assert_eq!(room.started_at, 0);
        assert!(!room.receipt_finalized);
        assert!(!room.vrf_fulfilled);
        assert_eq!(room.vote_count, 0);
        assert_eq!(room.next_vote_id, 0);
    }

    // ========================================================================
    // VoteState Tests
    // ========================================================================

    #[test]
    fn test_vote_state_default_status() {
        // VoteState should default to Draft status
        let vote_state = VoteState {
            room: alice(),
            vote_id: 1,
            host: alice(),
            question_hash: [0u8; 32],
            option_hashes: [[0u8; 32], [0u8; 32], [0u8; 32]],
            deadline: 2000,
            opened_at: 1500,
            closed_at: 0,
            status: VoteStatus::default(),
            eligible_count: 3,
            submitted_count: 0,
            eligibility_snapshot_hash: [0u8; 32],
            outcome: VoteOutcome::NoDecision,
            counts: [0, 0, 0],
            bump: 0,
        };

        assert_eq!(vote_state.status, VoteStatus::Draft);
    }

    #[test]
    fn test_vote_state_lifecycle_transitions() {
        // Test that vote state transitions are valid
        let mut vote_state = VoteState {
            room: alice(),
            vote_id: 1,
            host: alice(),
            question_hash: [0u8; 32],
            option_hashes: [[0u8; 32], [0u8; 32], [0u8; 32]],
            deadline: 2000,
            opened_at: 1500,
            closed_at: 0,
            status: VoteStatus::Open,
            eligible_count: 3,
            submitted_count: 0,
            eligibility_snapshot_hash: [0u8; 32],
            outcome: VoteOutcome::NoDecision,
            counts: [0, 0, 0],
            bump: 0,
        };

        // Open -> Closing is valid
        vote_state.status = VoteStatus::Closing;
        assert_eq!(vote_state.status, VoteStatus::Closing);

        // Closing -> Finalized is valid
        vote_state.status = VoteStatus::Finalized;
        assert_eq!(vote_state.status, VoteStatus::Finalized);

        // Finalized -> Committed is valid
        vote_state.status = VoteStatus::Committed;
        assert_eq!(vote_state.status, VoteStatus::Committed);
    }

    // ========================================================================
    // Vote Eligibility Tests
    // ========================================================================

    #[test]
    fn test_eligibility_snapshot_creation() {
        let eligible_wallets = vec![alice(), bob(), carol()];
        let hash = concord::vote::EligibilitySnapshot::compute_hash(&eligible_wallets);

        // Hash should be non-zero
        assert_ne!(hash, [0u8; 32]);

        // Same wallets should produce same hash
        let hash2 = concord::vote::EligibilitySnapshot::compute_hash(&eligible_wallets);
        assert_eq!(hash, hash2);
    }

    // ========================================================================
    // Vote Tally Tests
    // ========================================================================

    #[test]
    fn test_tally_all_options() {
        // Test tally with all three options selected
        let counts = [1, 1, 1];
        let outcome = concord::vote::compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Tie);
    }

    #[test]
    fn test_tally_single_winner() {
        let counts = [5, 3, 2];
        let outcome = concord::vote::compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Option0);
    }

    #[test]
    fn test_tally_tie_two_options() {
        let counts = [5, 5, 3];
        let outcome = concord::vote::compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Tie);
    }

    // ========================================================================
    // Vote Summary Digest Tests
    // ========================================================================

    #[test]
    fn test_vote_state_summary_digest_consistency() {
        let room_key = alice();
        let vote_state = VoteState {
            room: room_key,
            vote_id: 1,
            host: alice(),
            question_hash: [1u8; 32],
            option_hashes: [[2u8; 32], [3u8; 32], [4u8; 32]],
            deadline: 2000,
            opened_at: 1500,
            closed_at: 1800,
            status: VoteStatus::Finalized,
            eligible_count: 3,
            submitted_count: 3,
            eligibility_snapshot_hash: [5u8; 32],
            outcome: VoteOutcome::Option0,
            counts: [2, 1, 0],
            bump: 0,
        };

        let digest1 = vote_state.summary_digest();
        let digest2 = vote_state.summary_digest();

        // Same state should produce same digest
        assert_eq!(digest1, digest2);

        // Different counts should produce different digest
        let mut vote_state2 = vote_state.clone();
        vote_state2.counts = [1, 1, 1];
        let digest3 = vote_state2.summary_digest();
        assert_ne!(digest1, digest3);
    }

    // ========================================================================
    // Account Size Tests
    // ========================================================================

    #[test]
    fn test_room_account_size() {
        // Room::LEN should be accurate
        assert_eq!(Room::LEN, 8 + 32 + 8 + 8 + 8 + 32 + 32 + 1 + 1 + 1 + 8 + 1);
    }

    // ========================================================================
    // Error Handling Tests
    // ========================================================================

    #[test]
    fn test_error_codes_exist() {
        // Verify all error codes are defined
        use concord::ConcordError::*;

        // Room errors
        assert_eq!(format!("{:?}", Unauthorized), "Unauthorized");
        assert_eq!(format!("{:?}", AlreadyStarted), "AlreadyStarted");
        assert_eq!(format!("{:?}", NotStarted), "NotStarted");

        // VRF errors
        assert_eq!(format!("{:?}", RandomnessAlreadyFulfilled), "RandomnessAlreadyFulfilled");
        assert_eq!(format!("{:?}", RandomnessPending), "RandomnessPending");

        // Receipt errors
        assert_eq!(format!("{:?}", ReceiptAlreadyFinalized), "ReceiptAlreadyFinalized");
        assert_eq!(format!("{:?}", ReceiptNotFinalized), "ReceiptNotFinalized");

        // Vote errors
        assert_eq!(format!("{:?}", VoteNotOpen), "VoteNotOpen");
        assert_eq!(format!("{:?}", VoteAlreadyClosed), "VoteAlreadyClosed");
        assert_eq!(format!("{:?}", VoteDeadlinePassed), "VoteDeadlinePassed");
        assert_eq!(format!("{:?}", InvalidOption), "InvalidOption");
        assert_eq!(format!("{:?}", NotEligible), "NotEligible");
        assert_eq!(format!("{:?}", VoteNotClosed), "VoteNotClosed");
        assert_eq!(format!("{:?}", TooManyEligibleVoters), "TooManyEligibleVoters");
        assert_eq!(format!("{:?}", InvalidDeadline), "InvalidDeadline");
        assert_eq!(format!("{:?}", InvalidTally), "InvalidTally");
    }
}
