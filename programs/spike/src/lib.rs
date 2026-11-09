//! Phase 1 spike (throwaway). Answers, on Devnet TEE PER:
//! 1. Can a zero-lamport wallet sign and pay for a PER transaction?
//! 2. Can a delegated, host-funded PDA sponsor ephemeral voter slots?
//! 3. Do ephemeral permissions hide a slot from non-members?
//! 4. Do closes refund rent to the sponsor and host?
//! Results go to docs/architecture/magicblock-proof.md, then this program is closed.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use ephemeral_rollups_sdk::access_control::instructions::{
    CloseEphemeralPermissionCpi, CommitAndUndelegatePermissionCpiBuilder,
    CreateEphemeralPermissionCpi, CreatePermissionCpiBuilder, DelegatePermissionCpiBuilder,
};
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, MembersArgs, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG,
    PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::ephemeral_accounts::EphemeralAccount;

declare_id!("4tAykumoiLGeUHcMyXRPt8ihWYYTDwioBy5fNr1mXnLj");

pub const SPONSOR_SEED: &[u8] = b"spike_sponsor";
pub const SLOT_SEED: &[u8] = b"spike_slot";
/// Raw slot layout: magic(8) | voter(32) | option(1)
pub const SLOT_MAGIC: [u8; 8] = *b"SPKSLOT1";
pub const SLOT_LEN: u32 = 8 + 32 + 1;
pub const NO_OPTION: u8 = 255;
const ALL_FLAGS: u8 =
    AUTHORITY_FLAG | TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG;

#[ephemeral]
#[program]
pub mod spike {
    use super::*;

    /// Base layer. Host creates the sponsor PDA and funds it for ephemeral rent.
    pub fn init_sponsor(ctx: Context<InitSponsor>, fund_lamports: u64) -> Result<()> {
        let sponsor = &mut ctx.accounts.sponsor;
        sponsor.authority = ctx.accounts.authority.key();
        sponsor.bump = ctx.bumps.sponsor;
        sponsor.writes = 0;
        if fund_lamports > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.key(),
                    system_program::Transfer {
                        from: ctx.accounts.authority.to_account_info(),
                        to: ctx.accounts.sponsor.to_account_info(),
                    },
                ),
                fund_lamports,
            )?;
        }
        Ok(())
    }

    /// Base layer. Permission (member: host) + delegate permission + delegate sponsor
    /// to the `validator` account (the TEE identity).
    pub fn delegate_sponsor(ctx: Context<DelegateSponsor>) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let bump = ctx.bumps.sponsor;
        let seeds: &[&[u8]] = &[SPONSOR_SEED, authority_key.as_ref(), &[bump]];
        let validator = ctx.accounts.validator.as_ref();

        if ctx.accounts.permission.data_is_empty() {
            CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .permissioned_account(&ctx.accounts.sponsor.to_account_info())
                .permission(&ctx.accounts.permission.to_account_info())
                .payer(&ctx.accounts.authority.to_account_info())
                .system_program(&ctx.accounts.system_program.to_account_info())
                .args(MembersArgs {
                    members: Some(vec![Member {
                        flags: ALL_FLAGS,
                        pubkey: authority_key,
                    }]),
                })
                .invoke_signed(&[seeds])?;
        }

        if ctx.accounts.permission.owner != &ephemeral_rollups_sdk::id() {
            DelegatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
                .permissioned_account(&ctx.accounts.sponsor.to_account_info(), true)
                .permission(&ctx.accounts.permission.to_account_info())
                .payer(&ctx.accounts.authority.to_account_info())
                .authority(&ctx.accounts.sponsor.to_account_info(), false)
                .system_program(&ctx.accounts.system_program.to_account_info())
                .owner_program(&ctx.accounts.permission_program.to_account_info())
                .delegation_buffer(&ctx.accounts.buffer_permission.to_account_info())
                .delegation_metadata(&ctx.accounts.delegation_metadata_permission.to_account_info())
                .delegation_record(&ctx.accounts.delegation_record_permission.to_account_info())
                .delegation_program(&ctx.accounts.delegation_program.to_account_info())
                .validator(validator)
                .invoke_signed(&[seeds])?;
        }

        ctx.accounts.delegate_sponsor(
            &ctx.accounts.authority,
            &[SPONSOR_SEED, authority_key.as_ref()],
            DelegateConfig {
                validator: validator.map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// PER. Creates an ephemeral voter slot sponsored by the delegated sponsor PDA,
    /// with an ephemeral permission whose only member is the voter.
    pub fn create_slot(ctx: Context<CreateSlot>, voter: Pubkey) -> Result<()> {
        let sponsor_key = ctx.accounts.sponsor.key();
        let authority_key = ctx.accounts.authority.key();
        let sponsor_bump = ctx.bumps.sponsor;
        let slot_bump = ctx.bumps.slot;
        let sponsor_seeds: &[&[u8]] = &[SPONSOR_SEED, authority_key.as_ref(), &[sponsor_bump]];
        let slot_seeds: &[&[u8]] = &[SLOT_SEED, sponsor_key.as_ref(), voter.as_ref(), &[slot_bump]];

        EphemeralAccount::new(
            &ctx.accounts.sponsor.to_account_info(),
            &ctx.accounts.slot.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
        )
        .with_signer_seeds(&[sponsor_seeds, slot_seeds])
        .create(SLOT_LEN)?;

        {
            let mut data = ctx.accounts.slot.try_borrow_mut_data()?;
            data[0..8].copy_from_slice(&SLOT_MAGIC);
            data[8..40].copy_from_slice(voter.as_ref());
            data[40] = NO_OPTION;
        }

        CreateEphemeralPermissionCpi {
            permissioned_account: ctx.accounts.slot.to_account_info(),
            permission: ctx.accounts.slot_permission.to_account_info(),
            payer: ctx.accounts.sponsor.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member {
                    flags: ALL_FLAGS,
                    pubkey: voter,
                }],
            },
        }
        .invoke_signed(&[sponsor_seeds, slot_seeds])?;
        Ok(())
    }

    /// PER. Voter writes their option. The voter is a plain signer, not mut:
    /// whoever pays the fee is decided by the transaction, not the program.
    pub fn cast(ctx: Context<Cast>, option: u8) -> Result<()> {
        require!(option < 3, SpikeError::InvalidOption);
        let slot = &ctx.accounts.slot;
        require_keys_eq!(*slot.owner, crate::ID, SpikeError::BadSlot);
        let mut data = slot.try_borrow_mut_data()?;
        require!(data.len() >= SLOT_LEN as usize, SpikeError::BadSlot);
        require!(data[0..8] == SLOT_MAGIC, SpikeError::BadSlot);
        require!(
            data[8..40] == ctx.accounts.voter.key().to_bytes(),
            SpikeError::NotSlotOwner
        );
        data[40] = option;
        Ok(())
    }

    /// PER. Closes the slot's permission and the slot, refunding rent to the sponsor.
    pub fn close_slot(ctx: Context<CloseSlot>, voter: Pubkey) -> Result<()> {
        let sponsor_key = ctx.accounts.sponsor.key();
        let authority_key = ctx.accounts.authority.key();
        let sponsor_seeds: &[&[u8]] =
            &[SPONSOR_SEED, authority_key.as_ref(), &[ctx.bumps.sponsor]];
        let slot_seeds: &[&[u8]] =
            &[SLOT_SEED, sponsor_key.as_ref(), voter.as_ref(), &[ctx.bumps.slot]];

        CloseEphemeralPermissionCpi {
            permissioned_account: ctx.accounts.slot.to_account_info(),
            permission: ctx.accounts.slot_permission.to_account_info(),
            payer: ctx.accounts.sponsor.to_account_info(),
            authority: ctx.accounts.slot.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[sponsor_seeds, slot_seeds])?;

        EphemeralAccount::new(
            &ctx.accounts.sponsor.to_account_info(),
            &ctx.accounts.slot.to_account_info(),
            &ctx.accounts.vault.to_account_info(),
        )
        .with_signer_seeds(&[sponsor_seeds])
        .close()?;
        Ok(())
    }

    /// PER. Commit + undelegate the sponsor and its permission back to base layer.
    pub fn undelegate_sponsor(ctx: Context<UndelegateSponsor>) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let seeds: &[&[u8]] = &[SPONSOR_SEED, authority_key.as_ref(), &[ctx.bumps.sponsor]];
        CommitAndUndelegatePermissionCpiBuilder::new(
            &ctx.accounts.permission_program.to_account_info(),
        )
        .authority(&ctx.accounts.authority.to_account_info(), true)
        .permissioned_account(&ctx.accounts.sponsor.to_account_info(), true)
        .permission(&ctx.accounts.permission.to_account_info())
        .magic_context(&ctx.accounts.magic_context.to_account_info())
        .magic_program(&ctx.accounts.magic_program.to_account_info())
        .invoke_signed(&[seeds])?;

        MagicIntentBundleBuilder::new(
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.sponsor.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Base layer, after undelegation. Returns all sponsor lamports to the host.
    pub fn close_sponsor(_ctx: Context<CloseSponsor>) -> Result<()> {
        Ok(())
    }
}

#[account]
pub struct Sponsor {
    pub authority: Pubkey,
    pub bump: u8,
    pub writes: u64,
}

impl Sponsor {
    pub const LEN: usize = 8 + 32 + 1 + 8;
}

#[derive(Accounts)]
pub struct InitSponsor<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Sponsor::LEN,
        seeds = [SPONSOR_SEED, authority.key().as_ref()],
        bump
    )]
    pub sponsor: Account<'info, Sponsor>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateSponsor<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: sponsor PDA being delegated
    #[account(mut, del, seeds = [SPONSOR_SEED, authority.key().as_ref()], bump)]
    pub sponsor: AccountInfo<'info>,
    /// CHECK: validated by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, sponsor.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: delegation buffer for the permission account (validated by the permission program)
    #[account(mut)]
    pub buffer_permission: AccountInfo<'info>,
    /// CHECK: delegation record for the permission account (validated by the delegation program)
    #[account(mut)]
    pub delegation_record_permission: AccountInfo<'info>,
    /// CHECK: delegation metadata for the permission account (validated by the delegation program)
    #[account(mut)]
    pub delegation_metadata_permission: AccountInfo<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
    /// CHECK: validator identity to delegate to (the TEE validator for PER)
    pub validator: Option<AccountInfo<'info>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(voter: Pubkey)]
pub struct CreateSlot<'info> {
    pub authority: Signer<'info>,
    /// CHECK: delegated sponsor PDA; pays ephemeral rent
    #[account(mut, seeds = [SPONSOR_SEED, authority.key().as_ref()], bump)]
    pub sponsor: AccountInfo<'info>,
    /// CHECK: ephemeral slot PDA created here
    #[account(mut, seeds = [SLOT_SEED, sponsor.key().as_ref(), voter.as_ref()], bump)]
    pub slot: AccountInfo<'info>,
    /// CHECK: ephemeral permission PDA for the slot
    #[account(
        mut,
        seeds = [PERMISSION_SEED, slot.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub slot_permission: AccountInfo<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: AccountInfo<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Cast<'info> {
    pub voter: Signer<'info>,
    /// CHECK: owner, magic and voter are checked in the handler
    #[account(mut)]
    pub slot: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(voter: Pubkey)]
pub struct CloseSlot<'info> {
    pub authority: Signer<'info>,
    /// CHECK: delegated sponsor PDA; receives the refund
    #[account(mut, seeds = [SPONSOR_SEED, authority.key().as_ref()], bump)]
    pub sponsor: AccountInfo<'info>,
    /// CHECK: ephemeral slot PDA
    #[account(mut, seeds = [SLOT_SEED, sponsor.key().as_ref(), voter.as_ref()], bump)]
    pub slot: AccountInfo<'info>,
    /// CHECK: ephemeral permission PDA for the slot
    #[account(
        mut,
        seeds = [PERMISSION_SEED, slot.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub slot_permission: AccountInfo<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: AccountInfo<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateSponsor<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: delegated sponsor PDA
    #[account(mut, seeds = [SPONSOR_SEED, authority.key().as_ref()], bump)]
    pub sponsor: AccountInfo<'info>,
    /// CHECK: validated by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, sponsor.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CloseSponsor<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        close = authority,
        has_one = authority,
        seeds = [SPONSOR_SEED, authority.key().as_ref()],
        bump = sponsor.bump
    )]
    pub sponsor: Account<'info, Sponsor>,
}

#[error_code]
pub enum SpikeError {
    #[msg("Option must be 0, 1 or 2")]
    InvalidOption,
    #[msg("Not a spike slot")]
    BadSlot,
    #[msg("Signer is not this slot's voter")]
    NotSlotOwner,
}
