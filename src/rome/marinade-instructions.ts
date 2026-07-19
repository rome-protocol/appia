// Marinade Liquid Staking — deposit invoke builder.
//
// Pattern matches `lib/raydium-cpmm-instructions.ts`: pure function,
// no network reads, no hooks. Caller passes `msolMint` + `msolLeg`
// out of the live State view (`lib/marinade-state.ts`); everything
// else is constant or PDA-derivable.
//
// Per the IDL (`marinade-ts-sdk/src/programs/idl/json/marinade_finance.json`)
// the `deposit` ix takes 11 accounts in this exact order:
//
//   0.  state                       (writable)
//   1.  msol_mint                   (writable)
//   2.  liq_pool_sol_leg_pda        (writable)             ← PDA
//   3.  liq_pool_msol_leg           (writable)             ← state.liq_pool.msol_leg
//   4.  liq_pool_msol_leg_authority (readonly)             ← PDA
//   5.  reserve_pda                 (writable)             ← PDA
//   6.  transfer_from               (signer, writable)     ← user's Rome PDA
//   7.  mint_to                     (writable)             ← user's mSOL ATA
//   8.  msol_mint_authority         (readonly)             ← PDA
//   9.  system_program              (readonly)
//   10. token_program               (readonly)
//
// Args (after the 8-byte disc):
//   lamports: u64 LE
//
// Source cross-checked verbatim against
//   marinade-finance/liquid-staking-program
//   programs/marinade-finance/src/instructions/user/deposit.rs

import { concat, type Address, type Hex } from 'viem';
import { PublicKey } from '@solana/web3.js';
import type { AccountMeta } from './cpi-precompile';
import {
  SPL_TOKEN_PROGRAM_ID,
  deriveAta,
  deriveRomeUserPda,
  pubkeyToBytes32,
} from './solana-pda';
import {
  DEPOSIT_DISC,
  MARINADE_PROGRAM,
  MARINADE_STATE,
} from './marinade-program';
import {
  MARINADE_LIQ_POOL_MSOL_LEG_AUTHORITY,
  MARINADE_LIQ_POOL_SOL_LEG,
  MARINADE_MSOL_MINT_AUTHORITY,
  MARINADE_RESERVE_PDA,
} from './marinade-pdas';

const SYSTEM_PROGRAM = pubkeyToBytes32(PublicKey.default);
const SPL_TOKEN_PROGRAM_HEX = pubkeyToBytes32(SPL_TOKEN_PROGRAM_ID);

function toU64Le(v: bigint): Hex {
  if (v < 0n || v > 0xffffffffffffffffn) {
    throw new Error(`u64 out of range: ${v}`);
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return ('0x' + b.toString('hex')) as Hex;
}

export type MarinadeDepositAddresses = {
  user: Hex;
  state: Hex;
  msolMint: Hex;
  msolLeg: Hex;
  msolLegAuthority: Hex;
  solLeg: Hex;
  reservePda: Hex;
  msolMintAuthority: Hex;
  userMsolAta: Hex;
};

export type MarinadeDepositInvoke = {
  program: Hex;
  accounts: AccountMeta[];
  data: Hex;
  addresses: MarinadeDepositAddresses;
};

/// Build a `deposit(lamports)` invoke against the Marinade program.
///
/// Caller MUST pre-flight that the user's mSOL ATA exists; the
/// `mint_to` slot is checked with `token::mint = state.msol_mint`,
/// which fails if the account doesn't exist (no idempotent init in
/// this ix).
export function buildMarinadeDepositInvoke(args: {
  userEvmAddress: Address;
  /// `state.msol_mint` from the live State view. Decoupled from the
  /// hardcoded constant so a hot-swap of the mSOL mint (vanishingly
  /// unlikely) wouldn't strand the adapter. We could pin it; we
  /// don't because it costs nothing to plumb through and it makes
  /// the build deterministic with the on-chain state we just read.
  msolMint: Hex;
  /// `state.liq_pool.msol_leg` — the LP's mSOL token account. Read
  /// from the live State view.
  msolLeg: Hex;
  /// Lamports (u64) to deposit. Caller is responsible for clamping
  /// this to `transfer_from`'s lamport balance — the program will
  /// revert with `MarinadeError::NotEnoughUserFunds` otherwise.
  lamports: bigint;
}): MarinadeDepositInvoke {
  const user = deriveRomeUserPda(args.userEvmAddress);
  const userMsolAta = deriveAta(user, args.msolMint);

  const accounts: AccountMeta[] = [
    { pubkey: MARINADE_STATE, is_signer: false, is_writable: true },
    { pubkey: args.msolMint, is_signer: false, is_writable: true },
    { pubkey: MARINADE_LIQ_POOL_SOL_LEG, is_signer: false, is_writable: true },
    { pubkey: args.msolLeg, is_signer: false, is_writable: true },
    {
      pubkey: MARINADE_LIQ_POOL_MSOL_LEG_AUTHORITY,
      is_signer: false,
      is_writable: false,
    },
    { pubkey: MARINADE_RESERVE_PDA, is_signer: false, is_writable: true },
    { pubkey: user, is_signer: true, is_writable: true }, // transfer_from
    { pubkey: userMsolAta, is_signer: false, is_writable: true }, // mint_to
    {
      pubkey: MARINADE_MSOL_MINT_AUTHORITY,
      is_signer: false,
      is_writable: false,
    },
    { pubkey: SYSTEM_PROGRAM, is_signer: false, is_writable: false },
    { pubkey: SPL_TOKEN_PROGRAM_HEX, is_signer: false, is_writable: false },
  ];

  const data = concat([DEPOSIT_DISC, toU64Le(args.lamports)]);

  return {
    program: MARINADE_PROGRAM,
    accounts,
    data,
    addresses: {
      user,
      state: MARINADE_STATE,
      msolMint: args.msolMint,
      msolLeg: args.msolLeg,
      msolLegAuthority: MARINADE_LIQ_POOL_MSOL_LEG_AUTHORITY,
      solLeg: MARINADE_LIQ_POOL_SOL_LEG,
      reservePda: MARINADE_RESERVE_PDA,
      msolMintAuthority: MARINADE_MSOL_MINT_AUTHORITY,
      userMsolAta,
    },
  };
}
