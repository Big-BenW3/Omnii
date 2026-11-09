//! Pure rules: no accounts, no CPIs. Everything here is unit-tested directly.

use anchor_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::digest::{
    VoteSummary, OUTCOME_NO_DECISION, OUTCOME_OPTION_0, OUTCOME_OPTION_1, OUTCOME_OPTION_2,
    OUTCOME_TIE,
};
use crate::errors::ConcordError;

pub const MAX_DURATION_SECONDS: i64 = 3600;
pub const MAX_PARTICIPANTS: usize = 20;
pub const MAX_VOTES: usize = 8;
pub const NO_OPTION: u8 = 255;
pub const NO_VOTE: u8 = 255;

/// Raw ephemeral VoterSlot layout (ephemeral accounts are created raw, not by Anchor):
/// magic(8) | voter(32) | last_vote_id(1) | option(1) | submitted_at(8)
pub const SLOT_MAGIC: [u8; 8] = *b"CNCSLOT1";
pub const SLOT_LEN: usize = 8 + 32 + 1 + 1 + 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotData {
    pub voter: Pubkey,
    pub last_vote_id: u8,
    pub option: u8,
    pub submitted_at: i64,
}

impl SlotData {
    pub fn new(voter: Pubkey) -> Self {
        Self { voter, last_vote_id: NO_VOTE, option: NO_OPTION, submitted_at: 0 }
    }

    pub fn encode(&self, out: &mut [u8]) -> Result<()> {
        require!(out.len() >= SLOT_LEN, ConcordError::BadSlot);
        out[0..8].copy_from_slice(&SLOT_MAGIC);
        out[8..40].copy_from_slice(self.voter.as_ref());
        out[40] = self.last_vote_id;
        out[41] = self.option;
        out[42..50].copy_from_slice(&self.submitted_at.to_le_bytes());
        Ok(())
    }

    pub fn decode(data: &[u8]) -> Result<Self> {
        require!(data.len() >= SLOT_LEN, ConcordError::BadSlot);
        require!(data[0..8] == SLOT_MAGIC, ConcordError::BadSlot);
        Ok(Self {
            voter: Pubkey::new_from_array(data[8..40].try_into().unwrap()),
            last_vote_id: data[40],
            option: data[41],
            submitted_at: i64::from_le_bytes(data[42..50].try_into().unwrap()),
        })
    }
}

/// Meeting window: [started_at, started_at + 3600). Not started => not active.
pub fn meeting_active(started_at: i64, ended_at: i64, now: i64) -> bool {
    started_at != 0 && ended_at == 0 && now < started_at + MAX_DURATION_SECONDS
}

pub fn meeting_expired(started_at: i64, now: i64) -> bool {
    started_at != 0 && now >= started_at + MAX_DURATION_SECONDS
}

/// Sorts, rejects duplicates, enforces 1..=20 voters. Returns the canonical list.
pub fn canonical_eligible(mut wallets: Vec<Pubkey>) -> Result<Vec<Pubkey>> {
    require!(!wallets.is_empty(), ConcordError::NoEligibleVoters);
    require!(wallets.len() <= MAX_PARTICIPANTS, ConcordError::TooManyEligibleVoters);
    wallets.sort();
    for pair in wallets.windows(2) {
        require!(pair[0] != pair[1], ConcordError::DuplicateEligibleVoter);
    }
    Ok(wallets)
}

/// SHA256 over the sorted eligible wallets (bound into each vote summary digest).
pub fn eligibility_hash(sorted: &[Pubkey]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"CONCORD_ELIGIBILITY_V1");
    for w in sorted {
        hasher.update(w.as_ref());
    }
    hasher.finalize().into()
}

pub fn validate_options(question_hash: &[u8; 32], option_hashes: &[[u8; 32]; 3]) -> Result<()> {
    require!(*question_hash != [0u8; 32], ConcordError::InvalidLabel);
    for h in option_hashes {
        require!(*h != [0u8; 32], ConcordError::InvalidLabel);
    }
    require!(
        option_hashes[0] != option_hashes[1]
            && option_hashes[1] != option_hashes[2]
            && option_hashes[0] != option_hashes[2],
        ConcordError::DuplicateOption
    );
    Ok(())
}

pub fn validate_deadline(started_at: i64, now: i64, deadline: i64) -> Result<()> {
    require!(deadline > now, ConcordError::InvalidDeadline);
    require!(deadline <= started_at + MAX_DURATION_SECONDS, ConcordError::InvalidDeadline);
    Ok(())
}

/// Tally from slots that voted in `vote_id`. Slots that did not vote count as no ballot.
pub fn tally(slots: &[SlotData], vote_id: u8) -> ([u32; 3], u32) {
    let mut counts = [0u32; 3];
    let mut submitted = 0u32;
    for s in slots {
        if s.last_vote_id == vote_id && (s.option as usize) < 3 {
            counts[s.option as usize] += 1;
            submitted += 1;
        }
    }
    (counts, submitted)
}

pub fn outcome(counts: &[u32; 3]) -> u8 {
    let max = *counts.iter().max().unwrap_or(&0);
    if max == 0 {
        return OUTCOME_NO_DECISION;
    }
    let leaders: Vec<usize> = (0..3).filter(|&i| counts[i] == max).collect();
    match leaders.as_slice() {
        [0] => OUTCOME_OPTION_0,
        [1] => OUTCOME_OPTION_1,
        [2] => OUTCOME_OPTION_2,
        _ => OUTCOME_TIE,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn summary_digest(
    registry: &Pubkey,
    vote_id: u8,
    question_hash: &[u8; 32],
    option_hashes: &[[u8; 32]; 3],
    counts: [u32; 3],
    eligible_count: u32,
    submitted_count: u32,
    outcome: u8,
    closed_at: i64,
    eligibility_hash: &[u8; 32],
) -> [u8; 32] {
    VoteSummary {
        room_id: &registry.to_bytes(),
        vote_id: vote_id as u64,
        question_hash,
        option_hashes,
        counts,
        eligible_count,
        submitted_count,
        outcome,
        close_timestamp: closed_at,
        eligibility_snapshot_hash: eligibility_hash,
    }
    .digest()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    #[test]
    fn slot_roundtrip_and_magic_check() {
        let s = SlotData { voter: pk(7), last_vote_id: 2, option: 1, submitted_at: 123 };
        let mut buf = [0u8; SLOT_LEN];
        s.encode(&mut buf).unwrap();
        assert_eq!(SlotData::decode(&buf).unwrap(), s);
        buf[0] = b'X';
        assert!(SlotData::decode(&buf).is_err());
        assert!(SlotData::decode(&buf[..10]).is_err());
    }

    #[test]
    fn meeting_window_is_60_minutes_from_start() {
        assert!(!meeting_active(0, 0, 10));
        assert!(meeting_active(1000, 0, 1000));
        assert!(meeting_active(1000, 0, 4599));
        assert!(!meeting_active(1000, 0, 4600));
        assert!(!meeting_active(1000, 2000, 1500));
        assert!(meeting_expired(1000, 4600));
        assert!(!meeting_expired(0, 99999));
    }

    #[test]
    fn eligible_list_is_sorted_deduped_and_bounded() {
        let out = canonical_eligible(vec![pk(3), pk(1), pk(2)]).unwrap();
        assert_eq!(out, vec![pk(1), pk(2), pk(3)]);
        assert!(canonical_eligible(vec![]).is_err());
        assert!(canonical_eligible(vec![pk(1), pk(1)]).is_err());
        assert!(canonical_eligible((0..21).map(pk).collect()).is_err());
        assert!(canonical_eligible((0..20).map(pk).collect()).is_ok());
    }

    #[test]
    fn eligibility_hash_is_order_independent_after_canonicalization() {
        let a = canonical_eligible(vec![pk(2), pk(1)]).unwrap();
        let b = canonical_eligible(vec![pk(1), pk(2)]).unwrap();
        assert_eq!(eligibility_hash(&a), eligibility_hash(&b));
        assert_ne!(eligibility_hash(&a), eligibility_hash(&[pk(1)]));
    }

    #[test]
    fn options_must_be_three_distinct_non_empty_hashes() {
        let q = [1u8; 32];
        assert!(validate_options(&q, &[[1; 32], [2; 32], [3; 32]]).is_ok());
        assert!(validate_options(&[0; 32], &[[1; 32], [2; 32], [3; 32]]).is_err());
        assert!(validate_options(&q, &[[0; 32], [2; 32], [3; 32]]).is_err());
        assert!(validate_options(&q, &[[1; 32], [1; 32], [3; 32]]).is_err());
        assert!(validate_options(&q, &[[1; 32], [2; 32], [1; 32]]).is_err());
    }

    #[test]
    fn deadline_must_be_future_and_inside_meeting() {
        assert!(validate_deadline(1000, 1500, 1600).is_ok());
        assert!(validate_deadline(1000, 1500, 1500).is_err());
        assert!(validate_deadline(1000, 1500, 4600).is_ok());
        assert!(validate_deadline(1000, 1500, 4601).is_err());
    }

    #[test]
    fn tally_counts_only_this_round_and_valid_options() {
        let slots = vec![
            SlotData { voter: pk(1), last_vote_id: 0, option: 0, submitted_at: 1 },
            SlotData { voter: pk(2), last_vote_id: 0, option: 2, submitted_at: 1 },
            SlotData { voter: pk(3), last_vote_id: 0, option: 2, submitted_at: 1 },
            SlotData { voter: pk(4), last_vote_id: NO_VOTE, option: NO_OPTION, submitted_at: 0 },
            // Voted in an earlier round only: must not count.
            SlotData { voter: pk(5), last_vote_id: 9, option: 1, submitted_at: 1 },
        ];
        assert_eq!(tally(&slots, 0), ([1, 0, 2], 3));
        assert_eq!(tally(&slots, 1), ([0, 0, 0], 0));
    }

    #[test]
    fn outcome_handles_winner_tie_and_zero() {
        assert_eq!(outcome(&[0, 0, 0]), OUTCOME_NO_DECISION);
        assert_eq!(outcome(&[3, 1, 0]), OUTCOME_OPTION_0);
        assert_eq!(outcome(&[0, 4, 1]), OUTCOME_OPTION_1);
        assert_eq!(outcome(&[0, 1, 5]), OUTCOME_OPTION_2);
        assert_eq!(outcome(&[2, 2, 1]), OUTCOME_TIE);
        assert_eq!(outcome(&[2, 2, 2]), OUTCOME_TIE);
        assert_eq!(outcome(&[0, 3, 3]), OUTCOME_TIE);
    }

    #[test]
    fn exhaustive_tally_outcome_for_up_to_six_voters() {
        // Every assignment of 0..=6 voters to 3 options matches a brute-force argmax.
        for n in 0..=6usize {
            let total = 3usize.pow(n as u32);
            for code in 0..total {
                let mut c = code;
                let slots: Vec<SlotData> = (0..n)
                    .map(|i| {
                        let opt = (c % 3) as u8;
                        c /= 3;
                        SlotData { voter: pk(i as u8), last_vote_id: 1, option: opt, submitted_at: 1 }
                    })
                    .collect();
                let (counts, submitted) = tally(&slots, 1);
                assert_eq!(submitted as usize, n);
                assert_eq!(counts.iter().sum::<u32>() as usize, n);
                let max = *counts.iter().max().unwrap();
                let winners = counts.iter().filter(|&&x| x == max).count();
                let expected = if n == 0 {
                    OUTCOME_NO_DECISION
                } else if winners > 1 {
                    OUTCOME_TIE
                } else {
                    counts.iter().position(|&x| x == max).unwrap() as u8
                };
                assert_eq!(outcome(&counts), expected);
            }
        }
    }
}
