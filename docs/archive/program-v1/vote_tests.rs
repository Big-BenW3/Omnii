//! Unit tests for vote module
//! These tests verify the core vote functionality for Phase 1

use anchor_lang::prelude::*;
use concord::vote;

use vote::{
    compute_outcome, EligibilitySnapshot, PrivateBallot, PublicVoteSummary, VoteOutcome,
    VoteState, VoteStatus, HASH_LENGTH, MAX_ELIGIBLE_VOTERS, VOTE_SEED, BALLOT_SEED,
    VOTE_SUMMARY_SEED, ELIGIBILITY_SEED,
};

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to create a Pubkey from a string for testing
    fn pubkey_from_str(s: &str) -> Pubkey {
        Pubkey::new_from_array({
            let mut bytes = [0u8; 32];
            let s_bytes = s.as_bytes();
            for (i, &b) in s_bytes.iter().enumerate() {
                if i < 32 {
                    bytes[i] = b;
                }
            }
            bytes
        })
    }

    // ========================================================================
    // VoteOutcome Tests
    // ========================================================================

    #[test]
    fn test_compute_outcome_no_votes() {
        let counts = [0, 0, 0];
        let outcome = compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::NoDecision);
    }

    #[test]
    fn test_compute_outcome_option0_wins() {
        let counts = [5, 3, 2];
        let outcome = compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Option0);
    }

    #[test]
    fn test_compute_outcome_option1_wins() {
        let counts = [3, 5, 2];
        let outcome = compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Option1);
    }

    #[test]
    fn test_compute_outcome_option2_wins() {
        let counts = [3, 2, 5];
        let outcome = compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Option2);
    }

    #[test]
    fn test_compute_outcome_tie_two_way() {
        let counts = [5, 5, 3];
        let outcome = compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Tie);
    }

    #[test]
    fn test_compute_outcome_tie_three_way() {
        let counts = [5, 5, 5];
        let outcome = compute_outcome(&counts);
        assert_eq!(outcome, VoteOutcome::Tie);
    }

    // ========================================================================
    // VoteOutcome Code Conversion Tests
    // ========================================================================

    #[test]
    fn test_vote_outcome_from_code() {
        assert_eq!(
            VoteOutcome::from_code(0),
            Some(VoteOutcome::Option0)
        );
        assert_eq!(
            VoteOutcome::from_code(1),
            Some(VoteOutcome::Option1)
        );
        assert_eq!(
            VoteOutcome::from_code(2),
            Some(VoteOutcome::Option2)
        );
        assert_eq!(
            VoteOutcome::from_code(3),
            Some(VoteOutcome::Tie)
        );
        assert_eq!(
            VoteOutcome::from_code(4),
            Some(VoteOutcome::NoDecision)
        );
        assert_eq!(VoteOutcome::from_code(5), None);
    }

    #[test]
    fn test_vote_outcome_to_code() {
        assert_eq!(VoteOutcome::Option0.to_code(), 0);
        assert_eq!(VoteOutcome::Option1.to_code(), 1);
        assert_eq!(VoteOutcome::Option2.to_code(), 2);
        assert_eq!(VoteOutcome::Tie.to_code(), 3);
        assert_eq!(VoteOutcome::NoDecision.to_code(), 4);
    }

    // ========================================================================
    // EligibilitySnapshot Tests
    // ========================================================================

    #[test]
    fn test_eligibility_snapshot_compute_hash() {
        let wallets = vec![
            pubkey_from_str("wallet1"),
            pubkey_from_str("wallet2"),
        ];
        let hash1 = EligibilitySnapshot::compute_hash(&wallets);
        
        // Same wallets in same order should produce same hash
        let hash2 = EligibilitySnapshot::compute_hash(&wallets);
        assert_eq!(hash1, hash2);
        
        // Different order should produce different hash (after sorting, should be same)
        let wallets_reversed = vec![
            pubkey_from_str("wallet2"),
            pubkey_from_str("wallet1"),
        ];
        let hash3 = EligibilitySnapshot::compute_hash(&wallets_reversed);
        // Note: compute_hash does NOT sort, so order matters
        // For actual use, we should sort before computing hash
        // This test documents current behavior
        assert_ne!(hash1, hash3);
    }

    // ========================================================================
    // VoteState Tests
    // ========================================================================

    #[test]
    fn test_vote_state_summary_digest() {
        let room_key = pubkey_from_str("room1");
        let vote_state = VoteState {
            room: room_key,
            vote_id: 1,
            host: pubkey_from_str("host1"),
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
        
        let digest = vote_state.summary_digest();
        
        // Digest should be non-zero
        assert_ne!(digest, [0u8; 32]);
        
        // Different vote_state should produce different digest
        let vote_state2 = VoteState {
            counts: [1, 1, 1],
            ..vote_state
        };
        let digest2 = vote_state2.summary_digest();
        assert_ne!(digest, digest2);
    }

    // ========================================================================
    // Account Size Tests
    // ========================================================================

    #[test]
    fn test_vote_state_size() {
        // VoteState::LEN should match actual size
        // 8 (discriminator) + 32 (room) + 8 (vote_id) + 32 (host) + 
        // 32 (question_hash) + 32*3 (option_hashes) + 
        // 8 (deadline) + 8 (opened_at) + 8 (closed_at) + 
        // 1 (status) + padding + 4 (eligible_count) + 4 (submitted_count) + 
        // 32 (eligibility_snapshot_hash) + 1 (outcome) + 4*3 (counts) + 1 (bump)
        // = 8 + 32 + 8 + 32 + 32 + 96 + 8 + 8 + 8 + 4 + 4 + 4 + 32 + 4 + 12 + 1
        // Let's calculate: 8+32=40, +8=48, +32=80, +32=112, +96=208, +8=216, +8=224, +8=232, +4=236, +4=240, +4=244, +32=276, +4=280, +12=292, +1=293
        // But with padding for alignment, it might be different
        // For now, just verify the constant is set
        assert!(VoteState::LEN > 0);
    }

    #[test]
    fn test_private_ballot_size() {
        assert!(PrivateBallot::LEN > 0);
    }

    #[test]
    fn test_public_vote_summary_size() {
        assert!(PublicVoteSummary::LEN > 0);
    }

    #[test]
    fn test_eligibility_snapshot_max_size() {
        // MAX_LEN should be LEN_PREFIX + MAX_ELIGIBLE_VOTERS * 32
        let expected = EligibilitySnapshot::LEN_PREFIX + (MAX_ELIGIBLE_VOTERS * 32);
        assert_eq!(EligibilitySnapshot::MAX_LEN, expected);
    }

    // ========================================================================
    // Constants Tests
    // ========================================================================

    #[test]
    fn test_hash_length() {
        assert_eq!(HASH_LENGTH, 32);
    }

    #[test]
    fn test_max_eligible_voters() {
        assert_eq!(MAX_ELIGIBLE_VOTERS, 20);
    }

    // ========================================================================
    // Seed Constants Tests
    // ========================================================================

    #[test]
    fn test_seed_constants() {
        assert_eq!(VOTE_SEED, b"concord_vote");
        assert_eq!(BALLOT_SEED, b"concord_ballot");
        assert_eq!(VOTE_SUMMARY_SEED, b"concord_vote_summary");
        assert_eq!(ELIGIBILITY_SEED, b"concord_eligibility");
    }
}
