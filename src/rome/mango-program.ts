// Mango v4 program constants for Appia /lend (supply / withdraw).
//
// Lifted from Cardo lib/mango-program.ts (deposit + withdraw funded-proven on
// the Solana devnet substrate). The program id comes from Appia's rome-config
// `solanaProgramId` (an app-level constant, like Marinade — Mango v4 is the
// same address on devnet + mainnet, not a per-chain registry value).
//
// Discriminators are Anchor `sha256("global:<rust_fn>")[..8]`. Mango hashes the
// rust SNAKE_CASE fn name, NOT the IDL camelCase — the classic Custom(0) trap.
// tests/mango-instructions.test.ts recomputes each hash to pin this.

import type { Hex } from 'viem';
import { pubkeyBs58ToBytes32 } from './solana-pda';
import { solanaProgramId } from './rome-config';

/// Mango v4 — same address on devnet + mainnet.
export const MANGO_V4_PROGRAM: Hex = pubkeyBs58ToBytes32(
  solanaProgramId('mangoV4', 'devnet'),
);

// ── Anchor instruction discriminators — sha256("global:<snake_case>")[..8] ──

/// `account_create(account_num, token_count, serum3_count, perp_count,
/// perp_oo_count, name)` — 5 accounts. Registers a fresh MangoAccount PDA.
export const ACCOUNT_CREATE_DISC: Hex = '0xc65f27c529d69d12';

/// `token_deposit(amount: u64, reduce_only: bool)` — 9 accounts.
export const TOKEN_DEPOSIT_DISC: Hex = '0x75ff9a47f53a5f59';

/// `token_withdraw(amount: u64, allow_borrow: bool)` — 8 accounts.
export const TOKEN_WITHDRAW_DISC: Hex = '0x3fdf2a3b0f806642';

/// `account_close` — close a MangoAccount, refund rent to sol_destination.
/// 5 accounts.
export const ACCOUNT_CLOSE_DISC: Hex = '0x7305c01c56dd8966';

// ── PDA seeds ──

/// MangoAccount PDA seed:
/// PDA(["MangoAccount", group, owner, account_num_le_u32], MANGO_V4_PROGRAM).
export const MANGO_ACCOUNT_SEED = Buffer.from('MangoAccount');

// ── Bank account decode (for the supplied-position reader) ──

/// IDL discriminator for the `Bank` account: `sha256("account:Bank")[..8]`.
export const BANK_DISC: number[] = [142, 49, 166, 242, 50, 66, 97, 188];

/// Bank field byte offsets — the first 152 bytes carry everything we need:
///   8..40  group | 40..56 name | 56..88 mint | 88..120 vault | 120..152 oracle
export const BANK_FIELD_OFFSETS = {
  group: 8,
  name: 40,
  mint: 56,
  vault: 88,
  oracle: 120,
} as const;

// ── Default account-create slot counts ──
//
// A lend user only ever deposits/withdraws a single token: 8 token slots,
// 0 serum3 / perp / perp-oo.

export const DEFAULT_TOKEN_COUNT = 8;
export const DEFAULT_SERUM3_COUNT = 0;
export const DEFAULT_PERP_COUNT = 0;
export const DEFAULT_PERP_OO_COUNT = 0;

// ── CU budgets (empirical estimates; revisit after live runs) ──

export const CU_ACCOUNT_CREATE = 80_000n;
export const CU_TOKEN_DEPOSIT = 200_000n;
export const CU_TOKEN_WITHDRAW = 220_000n;
