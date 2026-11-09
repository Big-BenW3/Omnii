use anchor_lang::prelude::*;

#[error_code]
pub enum ConcordError {
    #[msg("Only the meeting host can do this")]
    Unauthorized,
    #[msg("Verifiable randomness has not been fulfilled yet")]
    RandomnessPending,
    #[msg("Verifiable randomness was already fulfilled")]
    RandomnessAlreadyFulfilled,
    #[msg("Meeting already started")]
    AlreadyStarted,
    #[msg("Meeting has not started")]
    NotStarted,
    #[msg("Meeting has ended or passed its 60-minute limit")]
    MeetingNotActive,
    #[msg("Meeting has not ended")]
    MeetingNotEnded,
    #[msg("Another vote is already active")]
    VoteAlreadyActive,
    #[msg("No vote is open")]
    VoteNotOpen,
    #[msg("Vote cannot be finalized yet")]
    VoteNotClosable,
    #[msg("The vote deadline has passed")]
    VoteDeadlinePassed,
    #[msg("Option must be 0, 1 or 2")]
    InvalidOption,
    #[msg("Wallet is not eligible for this vote")]
    NotEligible,
    #[msg("This wallet already voted in this round")]
    AlreadyVoted,
    #[msg("At least one eligible voter is required")]
    NoEligibleVoters,
    #[msg("At most 20 eligible voters")]
    TooManyEligibleVoters,
    #[msg("Eligible voter listed twice")]
    DuplicateEligibleVoter,
    #[msg("Question and options must be non-empty")]
    InvalidLabel,
    #[msg("The three options must be different")]
    DuplicateOption,
    #[msg("Deadline must be in the future and within the meeting")]
    InvalidDeadline,
    #[msg("Maximum number of votes for this meeting reached")]
    TooManyVotes,
    #[msg("Not a valid voter slot")]
    BadSlot,
    #[msg("Voter slot does not belong to this voter")]
    NotSlotOwner,
    #[msg("Slot accounts must match the eligible list exactly and in order")]
    SlotSetMismatch,
    #[msg("Every voter slot must be closed first")]
    SlotsStillOpen,
    #[msg("Receipt already finalized")]
    ReceiptAlreadyFinalized,
    #[msg("Receipt not finalized")]
    ReceiptNotFinalized,
    #[msg("Room accounts are still delegated")]
    StillDelegated,
    #[msg("Too many participants")]
    TooManyParticipants,
}
