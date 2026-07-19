// Mango v4 invoke builders for Appia /lend (supply / withdraw).
//
// Lifted from Cardo lib/mango-instructions.ts (deposit + withdraw funded-proven).
// Four invokes:
//   accountCreate — register a fresh MangoAccount PDA (first supply)
//   tokenDeposit  — move wSOL from the user's Rome ATA into the bank vault
//   tokenWithdraw — move wSOL from the bank vault back to the user's ATA
//   accountClose  — close the MangoAccount, refund rent (full exit)
//
// Self-custody: EVERY signer slot (owner / tokenAuthority / payer) is the
// user's own Rome PDA. Rome's CPI precompile auto-signs as msg.sender, so a
// single wallet signature covers all signer slots — no app key, no ephemeral
// signer. (Same model as the marinade / meteora builders.)

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
  ACCOUNT_CLOSE_DISC,
  ACCOUNT_CREATE_DISC,
  DEFAULT_PERP_COUNT,
  DEFAULT_PERP_OO_COUNT,
  DEFAULT_SERUM3_COUNT,
  DEFAULT_TOKEN_COUNT,
  MANGO_V4_PROGRAM,
  TOKEN_DEPOSIT_DISC,
  TOKEN_WITHDRAW_DISC,
} from './mango-program';
import { deriveMangoAccount } from './mango-pdas';

const SPL_TOKEN_PROGRAM_HEX = pubkeyToBytes32(SPL_TOKEN_PROGRAM_ID);
const SYSTEM_PROGRAM_HEX = pubkeyToBytes32(PublicKey.default);

// ── Encoders ──

function toU64Le(v: bigint): Hex {
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error(`u64 out of range: ${v}`);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return ('0x' + b.toString('hex')) as Hex;
}

function toU32Le(v: number): Hex {
  if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new Error(`u32 out of range: ${v}`);
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return ('0x' + b.toString('hex')) as Hex;
}

function toU8(v: number): Hex {
  if (!Number.isInteger(v) || v < 0 || v > 0xff) throw new Error(`u8 out of range: ${v}`);
  return ('0x' + v.toString(16).padStart(2, '0')) as Hex;
}

function toBool(v: boolean): Hex {
  return v ? '0x01' : '0x00';
}

/// Borsh string: u32-le length + utf8 bytes.
function toBorshString(s: string): Hex {
  const utf8 = Buffer.from(s, 'utf8');
  return concat([toU32Le(utf8.length), ('0x' + utf8.toString('hex')) as Hex]);
}

// ─────────────────────────────────────────────────────────────────────
// accountCreate (5 accounts)
// ─────────────────────────────────────────────────────────────────────

export type MangoAccountCreateInvoke = {
  program: Hex;
  accounts: AccountMeta[];
  data: Hex;
  addresses: { user: Hex; mangoAccount: Hex; group: Hex };
};

export function buildMangoAccountCreateInvoke(args: {
  userEvmAddress: Address;
  groupHex: Hex;
  /// Account number (defaults to 0 — first account under the group).
  accountNum?: number;
  /// Optional UI label for the MangoAccount.
  name?: string;
  tokenCount?: number;
  serum3Count?: number;
  perpCount?: number;
  perpOoCount?: number;
}): MangoAccountCreateInvoke {
  const user = deriveRomeUserPda(args.userEvmAddress);
  const accountNum = args.accountNum ?? 0;
  const mangoAccount = deriveMangoAccount({
    groupHex: args.groupHex,
    ownerHex: user,
    accountNum,
  });

  const accounts: AccountMeta[] = [
    { pubkey: args.groupHex, is_signer: false, is_writable: false },
    { pubkey: mangoAccount, is_signer: false, is_writable: true },
    { pubkey: user, is_signer: true, is_writable: false }, // owner
    { pubkey: user, is_signer: true, is_writable: true }, // payer (same PDA)
    { pubkey: SYSTEM_PROGRAM_HEX, is_signer: false, is_writable: false },
  ];

  const data = concat([
    ACCOUNT_CREATE_DISC,
    toU32Le(accountNum),
    toU8(args.tokenCount ?? DEFAULT_TOKEN_COUNT),
    toU8(args.serum3Count ?? DEFAULT_SERUM3_COUNT),
    toU8(args.perpCount ?? DEFAULT_PERP_COUNT),
    toU8(args.perpOoCount ?? DEFAULT_PERP_OO_COUNT),
    toBorshString(args.name ?? ''),
  ]);

  return {
    program: MANGO_V4_PROGRAM,
    accounts,
    data,
    addresses: { user, mangoAccount, group: args.groupHex },
  };
}

// ─────────────────────────────────────────────────────────────────────
// tokenDeposit (9 accounts) / tokenWithdraw (8 accounts)
// ─────────────────────────────────────────────────────────────────────

export type MangoTokenInvoke = {
  program: Hex;
  accounts: AccountMeta[];
  data: Hex;
  addresses: { user: Hex; mangoAccount: Hex; userTokenAccount: Hex };
};

export function buildMangoTokenDepositInvoke(args: {
  userEvmAddress: Address;
  groupHex: Hex;
  /// Bank's mint (used to derive the user's ATA).
  mintHex: Hex;
  /// Decoded Bank fields (fetch + decode the live Bank per BANK_FIELD_OFFSETS).
  bank: { pubkey: Hex; vault: Hex; oracle: Hex };
  amount: bigint;
  reduceOnly?: boolean;
  accountNum?: number;
}): MangoTokenInvoke {
  const user = deriveRomeUserPda(args.userEvmAddress);
  const mangoAccount = deriveMangoAccount({
    groupHex: args.groupHex,
    ownerHex: user,
    accountNum: args.accountNum ?? 0,
  });
  const userTokenAccount = deriveAta(user, args.mintHex);

  const accounts: AccountMeta[] = [
    { pubkey: args.groupHex, is_signer: false, is_writable: false },
    { pubkey: mangoAccount, is_signer: false, is_writable: true },
    { pubkey: user, is_signer: true, is_writable: false }, // owner
    { pubkey: args.bank.pubkey, is_signer: false, is_writable: true },
    { pubkey: args.bank.vault, is_signer: false, is_writable: true },
    { pubkey: args.bank.oracle, is_signer: false, is_writable: false },
    { pubkey: userTokenAccount, is_signer: false, is_writable: true },
    { pubkey: user, is_signer: true, is_writable: false }, // tokenAuthority (same PDA)
    { pubkey: SPL_TOKEN_PROGRAM_HEX, is_signer: false, is_writable: false },
  ];

  const data = concat([
    TOKEN_DEPOSIT_DISC,
    toU64Le(args.amount),
    toBool(args.reduceOnly ?? false),
  ]);

  return {
    program: MANGO_V4_PROGRAM,
    accounts,
    data,
    addresses: { user, mangoAccount, userTokenAccount },
  };
}

export function buildMangoTokenWithdrawInvoke(args: {
  userEvmAddress: Address;
  groupHex: Hex;
  mintHex: Hex;
  bank: { pubkey: Hex; vault: Hex; oracle: Hex };
  amount: bigint;
  /// Pure withdraw never borrows — defaults false. (Appia lend is deposit-only;
  /// borrow is a later phase with its own health-factor UX.)
  allowBorrow?: boolean;
  accountNum?: number;
}): MangoTokenInvoke {
  const user = deriveRomeUserPda(args.userEvmAddress);
  const mangoAccount = deriveMangoAccount({
    groupHex: args.groupHex,
    ownerHex: user,
    accountNum: args.accountNum ?? 0,
  });
  const userTokenAccount = deriveAta(user, args.mintHex);

  const accounts: AccountMeta[] = [
    { pubkey: args.groupHex, is_signer: false, is_writable: false },
    { pubkey: mangoAccount, is_signer: false, is_writable: true },
    { pubkey: user, is_signer: true, is_writable: false }, // owner
    { pubkey: args.bank.pubkey, is_signer: false, is_writable: true },
    { pubkey: args.bank.vault, is_signer: false, is_writable: true },
    { pubkey: args.bank.oracle, is_signer: false, is_writable: false },
    { pubkey: userTokenAccount, is_signer: false, is_writable: true },
    { pubkey: SPL_TOKEN_PROGRAM_HEX, is_signer: false, is_writable: false },
  ];

  const data = concat([
    TOKEN_WITHDRAW_DISC,
    toU64Le(args.amount),
    toBool(args.allowBorrow ?? false),
  ]);

  return {
    program: MANGO_V4_PROGRAM,
    accounts,
    data,
    addresses: { user, mangoAccount, userTokenAccount },
  };
}

// ─────────────────────────────────────────────────────────────────────
// accountClose (5 accounts) — refund rent to sol_destination (default: user)
// ─────────────────────────────────────────────────────────────────────

export type MangoAccountCloseInvoke = {
  program: Hex;
  accounts: AccountMeta[];
  data: Hex;
  addresses: { user: Hex; mangoAccount: Hex };
};

export function buildMangoAccountCloseInvoke(args: {
  userEvmAddress: Address;
  groupHex: Hex;
  accountNum?: number;
  /// Rent destination. Defaults to the user's own Rome PDA.
  solDestinationHex?: Hex;
}): MangoAccountCloseInvoke {
  const user = deriveRomeUserPda(args.userEvmAddress);
  const accountNum = args.accountNum ?? 0;
  const mangoAccount = deriveMangoAccount({
    groupHex: args.groupHex,
    ownerHex: user,
    accountNum,
  });
  const solDestination = args.solDestinationHex ?? user;

  const accounts: AccountMeta[] = [
    { pubkey: args.groupHex, is_signer: false, is_writable: false },
    { pubkey: mangoAccount, is_signer: false, is_writable: true },
    { pubkey: user, is_signer: true, is_writable: false }, // owner
    { pubkey: solDestination, is_signer: false, is_writable: true },
    { pubkey: SPL_TOKEN_PROGRAM_HEX, is_signer: false, is_writable: false },
  ];

  // force_close = false (owner-callable path only).
  const data = concat([ACCOUNT_CLOSE_DISC, '0x00' as Hex]);

  return {
    program: MANGO_V4_PROGRAM,
    accounts,
    data,
    addresses: { user, mangoAccount },
  };
}
