// Mango v4 SOL lending market for Appia /lend.
//
// Lifted from Cardo lib/mango-config.ts. The Mango-side accounts (group / bank
// / vault / oracle) are Mango's own devnet accounts, verified on-chain by Cardo
// (2026-04-25). This specific SOL bank was chosen because its oracle_config has
// conf_filter=10000 + maxStalenessSlots=-1 (effectively no validation) — the
// strict conf_filter=0 banks revert Custom(6023) OracleConfidence.
//
// The EVM `wrapper` + SPL `mint` are wired to APPIA's OWN wSOL (via ROME_CHAIN)
// so lend deposits the same wSOL the user already holds from swap/bridge — not
// a foreign wrapper. mint is the canonical WSOL (So1111…112), matching the
// bank's on-chain mint.

import type { Hex } from 'viem';
import { pubkeyBs58ToBytes32 } from './solana-pda';
import { ROME_CHAIN } from './rome-config';

export type MangoBankConfig = {
  /// Display label.
  symbol: string;
  /// Mango Group PDA (multi-bank container).
  groupHex: Hex;
  groupBs58: string;
  /// Bank account (writable in deposit/withdraw).
  bankHex: Hex;
  bankBs58: string;
  /// Bank's SPL ATA (writable; receives the user's tokens on deposit).
  vaultHex: Hex;
  vaultBs58: string;
  /// Oracle account (read-only).
  oracleHex: Hex;
  /// SPL mint backing the bank.
  mintHex: Hex;
  mintBs58: string;
  /// EVM ERC20-SPL wrapper on Rome that maps to the same SPL (Appia's).
  wrapper: `0x${string}`;
  /// Mint decimals.
  decimals: number;
};

/// Mango v4 "SOL" bank in group `FHnZBXLa…`
/// (vault `AhRv7QQU…`, oracle `J83w4HKf…`) — verified on-chain.
export const MANGO_SOL_BANK: MangoBankConfig = {
  symbol: 'SOL',
  groupHex: pubkeyBs58ToBytes32('FHnZBXLaKBKLg8Qwzt31Ft2ZDNbkM9j4UWREkYP4o25d'),
  groupBs58: 'FHnZBXLaKBKLg8Qwzt31Ft2ZDNbkM9j4UWREkYP4o25d',
  bankHex: pubkeyBs58ToBytes32('7trXn2uYWg1FSQhVsWw8mwBXeC9K75PnXVkVQcfE57NH'),
  bankBs58: '7trXn2uYWg1FSQhVsWw8mwBXeC9K75PnXVkVQcfE57NH',
  vaultHex: pubkeyBs58ToBytes32('AhRv7QQU1kv4zJKup5GcRf45FcDpV8wHtTh6icacevqc'),
  vaultBs58: 'AhRv7QQU1kv4zJKup5GcRf45FcDpV8wHtTh6icacevqc',
  oracleHex: pubkeyBs58ToBytes32('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix'),
  mintHex: pubkeyBs58ToBytes32(ROME_CHAIN.wsolMint),
  mintBs58: ROME_CHAIN.wsolMint,
  wrapper: ROME_CHAIN.wsolWrapper as `0x${string}`,
  decimals: 9,
};
