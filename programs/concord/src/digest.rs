//! Deterministic public receipt digest (spec CONCORD_PRODUCT_SPEC.md 9.5).
//!
//! One fixed-field encoding shared by the program (Rust) and the browser
//! verifier (TypeScript, packages/receipt-hash). Cross-language vectors in
//! tests/receipt-digest-vectors.json are asserted by both sides.

use sha2::{Digest, Sha256};

/// Domain separator for the top-level receipt digest.
pub const RECEIPT_PREFIX: &[u8] = b"CONCORD_RECEIPT_V1";
/// Domain separator for a single public vote summary digest.
pub const VOTE_SUMMARY_PREFIX: &[u8] = b"CONCORD_VOTE_SUMMARY_V1";

/// Outcome codes bound into a vote summary digest.
pub const OUTCOME_OPTION_0: u8 = 0;
pub const OUTCOME_OPTION_1: u8 = 1;
pub const OUTCOME_OPTION_2: u8 = 2;
pub const OUTCOME_TIE: u8 = 3;
pub const OUTCOME_NO_DECISION: u8 = 4;

/// Public vote summary fields bound by `VoteSummary::digest`.
///
/// Fixed-width little-endian integers; the TypeScript verifier mirrors this
/// byte layout exactly (ADR-009).
pub struct VoteSummary<'a> {
    pub room_id: &'a [u8; 32],
    pub vote_id: u64,
    pub question_hash: &'a [u8; 32],
    pub option_hashes: &'a [[u8; 32]; 3],
    pub counts: [u32; 3],
    pub eligible_count: u32,
    pub submitted_count: u32,
    pub outcome: u8,
    pub close_timestamp: i64,
    pub eligibility_snapshot_hash: &'a [u8; 32],
}

impl VoteSummary<'_> {
    pub fn digest(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(VOTE_SUMMARY_PREFIX);
        hasher.update(self.room_id);
        hasher.update(self.vote_id.to_le_bytes());
        hasher.update(self.question_hash);
        for option_hash in self.option_hashes {
            hasher.update(option_hash);
        }
        for count in self.counts {
            hasher.update(count.to_le_bytes());
        }
        hasher.update(self.eligible_count.to_le_bytes());
        hasher.update(self.submitted_count.to_le_bytes());
        hasher.update([self.outcome]);
        hasher.update(self.close_timestamp.to_le_bytes());
        hasher.update(self.eligibility_snapshot_hash);
        hasher.finalize().into()
    }
}

/// Top-level receipt digest:
/// SHA256("CONCORD_RECEIPT_V1" || room_id || vrf_result_digest ||
/// started_at_i64_le || ended_at_i64_le || vote_count_u32_le ||
/// ordered_vote_summary_digests || action_items_hash)
///
/// `vote_count` is the number of ordered vote summary digests (u32 LE).
pub fn receipt_digest(
    room_id: &[u8; 32],
    vrf_result_digest: &[u8; 32],
    started_at: i64,
    ended_at: i64,
    ordered_summary_digests: &[[u8; 32]],
    action_items_hash: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(RECEIPT_PREFIX);
    hasher.update(room_id);
    hasher.update(vrf_result_digest);
    hasher.update(started_at.to_le_bytes());
    hasher.update(ended_at.to_le_bytes());
    hasher.update((ordered_summary_digests.len() as u32).to_le_bytes());
    for summary_digest in ordered_summary_digests {
        hasher.update(summary_digest);
    }
    hasher.update(action_items_hash);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_decode(s: &str) -> Vec<u8> {
        assert!(s.len() % 2 == 0, "odd hex length");
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("valid hex"))
            .collect()
    }

    fn hex_encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    fn load_vectors() -> serde_json::Value {
        serde_json::from_str(include_str!("../../../tests/receipt-digest-vectors.json"))
            .expect("valid vectors JSON")
    }

    fn i64_field(value: &serde_json::Value) -> i64 {
        match value {
            serde_json::Value::String(s) => s.parse::<i64>().expect("i64 string"),
            other => other.as_i64().expect("i64 number"),
        }
    }

    #[test]
    fn vote_summary_vectors_match_typescript() {
        let vectors = load_vectors();
        for vector in vectors["voteSummary"].as_array().expect("voteSummary array") {
            let name = vector["name"].as_str().expect("name");
            let room_id: [u8; 32] = hex_decode(vector["roomId"].as_str().unwrap())
                .try_into()
                .expect("32 bytes");
            let question_hash: [u8; 32] = hex_decode(vector["questionHash"].as_str().unwrap())
                .try_into()
                .expect("32 bytes");
            let option_hashes: [[u8; 32]; 3] = vector["optionHashes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| {
                    hex_decode(h.as_str().unwrap())
                        .try_into()
                        .expect("32 bytes")
                })
                .collect::<Vec<[u8; 32]>>()
                .try_into()
                .expect("3 option hashes");
            let eligibility_snapshot_hash: [u8; 32] =
                hex_decode(vector["eligibilitySnapshotHash"].as_str().unwrap())
                    .try_into()
                    .expect("32 bytes");
            let counts: [u32; 3] = vector["counts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c.as_u64().unwrap() as u32)
                .collect::<Vec<u32>>()
                .try_into()
                .expect("3 counts");

            let digest = VoteSummary {
                room_id: &room_id,
                vote_id: vector["voteId"].as_u64().unwrap(),
                question_hash: &question_hash,
                option_hashes: &option_hashes,
                counts,
                eligible_count: vector["eligibleCount"].as_u64().unwrap() as u32,
                submitted_count: vector["submittedCount"].as_u64().unwrap() as u32,
                outcome: vector["outcome"].as_u64().unwrap() as u8,
                close_timestamp: i64_field(&vector["closeTimestamp"]),
                eligibility_snapshot_hash: &eligibility_snapshot_hash,
            }
            .digest();

            let expected = vector["expectedSummaryDigest"].as_str().unwrap();
            assert_eq!(
                hex_encode(&digest),
                expected,
                "vote summary vector mismatch: {name}"
            );
        }
    }

    #[test]
    fn receipt_vectors_match_typescript() {
        let vectors = load_vectors();
        for vector in vectors["receipts"].as_array().expect("receipts array") {
            let name = vector["name"].as_str().expect("name");
            let room_id: [u8; 32] = hex_decode(vector["roomId"].as_str().unwrap())
                .try_into()
                .expect("32 bytes");
            let vrf_result_digest: [u8; 32] =
                hex_decode(vector["vrfResultDigest"].as_str().unwrap())
                    .try_into()
                    .expect("32 bytes");
            let ordered_summary_digests: Vec<[u8; 32]> = vector["orderedSummaryDigests"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| {
                    hex_decode(h.as_str().unwrap())
                        .try_into()
                        .expect("32 bytes")
                })
                .collect();
            let action_items_hash: [u8; 32] =
                hex_decode(vector["actionItemsHash"].as_str().unwrap())
                    .try_into()
                    .expect("32 bytes");

            let digest = receipt_digest(
                &room_id,
                &vrf_result_digest,
                i64_field(&vector["startedAt"]),
                i64_field(&vector["endedAt"]),
                &ordered_summary_digests,
                &action_items_hash,
            );

            let expected = vector["expectedReceiptDigest"].as_str().unwrap();
            assert_eq!(
                hex_encode(&digest),
                expected,
                "receipt vector mismatch: {name}"
            );
        }
    }

    #[test]
    fn receipt_digest_binds_every_field() {
        let room_id = [1u8; 32];
        let vrf = [2u8; 32];
        let action = [3u8; 32];
        let summary = [[4u8; 32]];
        let base = receipt_digest(&room_id, &vrf, 10, 20, &summary, &action);
        assert_ne!(base, receipt_digest(&[9u8; 32], &vrf, 10, 20, &summary, &action));
        assert_ne!(base, receipt_digest(&room_id, &[9u8; 32], 10, 20, &summary, &action));
        assert_ne!(base, receipt_digest(&room_id, &vrf, 11, 20, &summary, &action));
        assert_ne!(base, receipt_digest(&room_id, &vrf, 10, 21, &summary, &action));
        assert_ne!(base, receipt_digest(&room_id, &vrf, 10, 20, &[[9u8; 32]], &action));
        assert_ne!(base, receipt_digest(&room_id, &vrf, 10, 20, &summary, &[9u8; 32]));
    }
}
