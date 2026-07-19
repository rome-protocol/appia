// Mango v4 deposited-position reader for Appia /lend.
//
// Lifted from Cardo lib/use-mango-deposited.ts (the pure decoder + the
// getMultipleAccounts probe, minus the React hook — appia readers are plain
// async, like fetchMarinadeState / fetchPoolReserves). Reads the user's
// SUPPLIED amount in one Mango bank — the number a position card needs (the
// wallet ATA balance is what deposit CONSUMES, not what's inside Mango).
//
// Layout facts (no Anchor dep; parsed from raw bytes) were calibrated against
// LIVE devnet accounts 2026-07-07 and are pinned by tests/mango-deposited.test.ts:
//
// MangoAccount (dynamic zero-copy):
//   group @8, owner @40 (validated against the caller's PDA), token positions
//   start @424, stride 184: indexed_position i128 I80F48 @+0, token_index u16
//   @+16. Inactive slots carry token_index = 0xFFFF.
// Bank:
//   group @8, mint @56 (both validated), deposit_index i128 I80F48 @536,
//   token_index u16 @888.
//
// deposited_native = indexed_position × deposit_index (I80F48 × I80F48, so
// >> 96 for the integer part). Negative indexed_position = borrow → deposited 0.

import type { Address, Hex } from "viem";
import { bytes32ToPublicKey, deriveRomeUserPda } from "./solana-pda";
import { deriveMangoAccount } from "./mango-pdas";
import { MANGO_SOL_BANK } from "./mango-config";

const ACCT_GROUP_OFFSET = 8;
const ACCT_OWNER_OFFSET = 40;
const ACCT_POSITIONS_BASE = 424;
const POSITION_STRIDE = 184;
const POSITION_TOKEN_INDEX_OFFSET = 16;
const INACTIVE_TOKEN_INDEX = 0xffff;

const BANK_GROUP_OFFSET = 8;
const BANK_MINT_OFFSET = 56;
const BANK_DEPOSIT_INDEX_OFFSET = 536;
const BANK_TOKEN_INDEX_OFFSET = 888;

const I80F48_FRACTIONAL_BITS = 48n;

// Byte accesses below are length-guarded by the callers (parseMangoDepositedNative
// checks acct/bank length first), so the in-bounds `!` assertions are safe under
// noUncheckedIndexedAccess.
function i128At(data: Uint8Array, offset: number): bigint {
  let lo = 0n;
  for (let i = 7; i >= 0; i--) lo = (lo << 8n) | BigInt(data[offset + i]!);
  let hi = 0n;
  for (let i = 7; i >= 0; i--) hi = (hi << 8n) | BigInt(data[offset + 8 + i]!);
  if (hi >= 1n << 63n) hi -= 1n << 64n; // sign of the high limb
  return (hi << 64n) | lo;
}

function u16At(data: Uint8Array, offset: number): number {
  return data[offset]! | (data[offset + 1]! << 8);
}

function bytesEq(data: Uint8Array, offset: number, expectedHex: Hex): boolean {
  const expected = expectedHex.slice(2);
  for (let i = 0; i < 32; i++) {
    const b = parseInt(expected.slice(i * 2, i * 2 + 2), 16);
    if (data[offset + i]! !== b) return false;
  }
  return true;
}

/// Parse the user's deposited native amount for one bank out of raw MangoAccount
/// + Bank bytes. Returns null when the layout doesn't match (per "real on-chain
/// stats only — if a stat can't be read, hide it") so the UI hides the number
/// rather than lying.
export function parseMangoDepositedNative(args: {
  mangoAccountData: Uint8Array;
  bankData: Uint8Array;
  /// Expected identities — all validated against the raw bytes.
  ownerPdaHex: Hex;
  groupHex: Hex;
  bankMintHex: Hex;
}): bigint | null {
  const { mangoAccountData: acct, bankData: bank } = args;
  if (acct.length < ACCT_POSITIONS_BASE + POSITION_STRIDE) return null;
  if (bank.length < BANK_TOKEN_INDEX_OFFSET + 4) return null;
  if (!bytesEq(acct, ACCT_GROUP_OFFSET, args.groupHex)) return null;
  if (!bytesEq(acct, ACCT_OWNER_OFFSET, args.ownerPdaHex)) return null;
  if (!bytesEq(bank, BANK_GROUP_OFFSET, args.groupHex)) return null;
  if (!bytesEq(bank, BANK_MINT_OFFSET, args.bankMintHex)) return null;

  const bankTokenIndex = u16At(bank, BANK_TOKEN_INDEX_OFFSET);
  const depositIndex = i128At(bank, BANK_DEPOSIT_INDEX_OFFSET);
  if (depositIndex <= 0n) return null;

  for (let o = ACCT_POSITIONS_BASE; o + POSITION_STRIDE <= acct.length; o += POSITION_STRIDE) {
    const tokenIndex = u16At(acct, o + POSITION_TOKEN_INDEX_OFFSET);
    if (tokenIndex === INACTIVE_TOKEN_INDEX) continue;
    // A live token_index far above Mango's bank count means the positions
    // base/stride no longer matches this account version.
    if (tokenIndex > 4096) return null;
    if (tokenIndex !== bankTokenIndex) continue;
    const indexedPosition = i128At(acct, o);
    if (indexedPosition <= 0n) return 0n; // borrow or empty — nothing to withdraw
    return (indexedPosition * depositIndex) >> (I80F48_FRACTIONAL_BITS * 2n);
  }
  return 0n; // account exists but holds no position in this bank
}

type Rpc = <T>(method: string, params: unknown[]) => Promise<T>;
type AccountInfo = { data: [string, string] } | null; // [base64, "base64"] from getMultipleAccounts

/// Read the user's deposited native amount in a Mango bank via one
/// getMultipleAccounts([mangoAccount, bank]). Returns:
///   bigint — the supplied native amount,
///   0n     — the user has no MangoAccount yet (nothing deposited),
///   null   — the bank/account couldn't be read+validated (hide the number).
/// `rpc` injectable (the page passes a /api/rpc/solana caller; tests mock it).
export async function fetchMangoDeposited(
  rpc: Rpc,
  args: {
    userEvmAddress: Address;
    groupHex: Hex;
    bankHex: Hex;
    bankMintHex: Hex;
    accountNum?: number;
  },
): Promise<bigint | null> {
  const ownerPdaHex = deriveRomeUserPda(args.userEvmAddress);
  const mangoAccountB58 = bytes32ToPublicKey(
    deriveMangoAccount({ groupHex: args.groupHex, ownerHex: ownerPdaHex, accountNum: args.accountNum ?? 0 }),
  ).toBase58();
  const bankB58 = bytes32ToPublicKey(args.bankHex).toBase58();

  const res = await rpc<{ value: AccountInfo[] }>("getMultipleAccounts", [
    [mangoAccountB58, bankB58],
    { encoding: "base64", commitment: "confirmed" },
  ]);
  const [acctInfo, bankInfo] = res.value ?? [];
  // No MangoAccount → nothing deposited (0). Bank unreadable → can't validate → hide (null).
  if (!acctInfo || !bankInfo) return acctInfo ? null : 0n;

  return parseMangoDepositedNative({
    mangoAccountData: Buffer.from(acctInfo.data[0], "base64"),
    bankData: Buffer.from(bankInfo.data[0], "base64"),
    ownerPdaHex,
    groupHex: args.groupHex,
    bankMintHex: args.bankMintHex,
  });
}

/// Convenience bound to the SOL bank Appia lends into — the number the /lend
/// position card + the dashboard show.
export async function fetchMangoSolDeposited(rpc: Rpc, userEvmAddress: Address): Promise<bigint | null> {
  return fetchMangoDeposited(rpc, {
    userEvmAddress,
    groupHex: MANGO_SOL_BANK.groupHex,
    bankHex: MANGO_SOL_BANK.bankHex,
    bankMintHex: MANGO_SOL_BANK.mintHex,
  });
}
