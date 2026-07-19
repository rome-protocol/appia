// Marinade Liquid Staking program constants for Cardo `/stake-marinade`.
//
// **Source of truth**: github.com/marinade-finance/liquid-staking-program
// (`programs/marinade-finance/src/instructions/user/deposit.rs`,
//  `programs/marinade-finance/src/state/mod.rs`).
//
// Devnet bootstrap state (verified live 2026-04-25):
//   - Program  MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD   executable=true ✓
//     (owner: BPFLoaderUpgradeab1e…)
//   - State    8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC   2048-byte initialized account ✓
//     (decoded fields verified — see lib/marinade-state.ts)
//   - mSOL mint mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So   classic SPL Token, decimals=9 ✓
//
// The mainnet program id is `MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhJqFiWk6kT`
// — different from devnet. The TS SDK's MARINADE_FINANCE_PROGRAM_ID
// constant matches the devnet redeploy used here.
//
// Per the integration roadmap at
//   rome-specs/active/technical/2026-04-25-cardo-solana-integration-roadmap.md
// (Family 4, A1 → A0 promotion: Marinade is on devnet at a published
// redeploy; no auto-deploy needed).

import type { Hex } from 'viem';
import { pubkeyBs58ToBytes32 } from './solana-pda';
import { solanaProgramId } from './rome-config';

// ─────────────────────────────────────────────────────────────────────
// Program id — devnet redeploy from registry.
//
// Mainnet ≠ devnet. Devnet uses `MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD`
// (per marinade-ts-sdk/src/config/marinade-config.ts default). Mainnet
// is `MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhJqFiWk6kT`. Both are
// published in the Rome registry.
// ─────────────────────────────────────────────────────────────────────

export const MARINADE_PROGRAM: Hex = pubkeyBs58ToBytes32(
  solanaProgramId('marinade', 'devnet'),
);

/// Singleton State PDA on devnet. Holds msol_mint, msol_supply,
/// total_active_balance, available_reserve_balance, circulating_ticket_balance,
/// and the LiqPool sub-struct. We hardcode the bs58 + hex form below;
/// derivation is not deterministic from program id alone (admin-managed).
export const MARINADE_STATE_BS58 =
  '8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC' as const;

export const MARINADE_STATE: Hex = pubkeyBs58ToBytes32(MARINADE_STATE_BS58);

// ─────────────────────────────────────────────────────────────────────
// Anchor instruction discriminators
//
// Computed: sha256("global:<method>")[..8].
//   deposit = [242, 35, 198, 137, 82, 225, 242, 182]
//
// Verified by hashing locally + confirmed against the IDL on devnet.
// ─────────────────────────────────────────────────────────────────────

/// `deposit(lamports: u64)` — user supplies SOL, mints/transfers mSOL
/// to their `mint_to` ATA. Single ix; no init.
export const DEPOSIT_DISC: Hex = '0xf223c68952e1f2b6';

// ─────────────────────────────────────────────────────────────────────
// PDA seeds
//
// Marinade State has four child PDAs we need to drive `deposit`:
//   reserve_pda                = PDA([state, "reserve"], program)
//   liq_pool_sol_leg_pda       = PDA([state, "liq_sol"], program)
//   liq_pool_msol_leg_authority= PDA([state, "liq_st_sol_authority"], program)
//   msol_mint_authority        = PDA([state, "st_mint"], program)
//
// Seed string constants per
// `programs/marinade-finance/src/state/mod.rs` and
// `programs/marinade-finance/src/state/liq_pool.rs`:
//   State::RESERVE_SEED                       = b"reserve"
//   State::MSOL_MINT_AUTHORITY_SEED           = b"st_mint"
//   LiqPool::SOL_LEG_SEED                     = b"liq_sol"
//   LiqPool::MSOL_LEG_AUTHORITY_SEED          = b"liq_st_sol_authority"
//
// Seed strings cross-checked against the live State account's on-chain
// bumps AND the mSOL mint's on-chain mint_authority (see
// lib/marinade-state.ts):
//   reserve_bump_seed              = 255
//   msol_mint_authority_bump_seed  = 253  → PDA([state,"st_mint"]) =
//                                    3JLPCS1qM2zRw3Dp6V4hZnYHd4toMNPkNesXdX9tg6KM
//                                    (the mint's actual authority on-chain)
//   liq_pool.sol_leg_bump_seed     = 254
//   liq_pool.msol_leg_authority_bump_seed = 255
//
// NOTE: the mint-authority seed is "st_mint", NOT "mint". A prior
// transcription used "mint", which derived a wrong msol_mint_authority PDA
// → Anchor ConstraintSeeds → deposit reverted Custom(2006).
// ─────────────────────────────────────────────────────────────────────

export const RESERVE_SEED = Buffer.from('reserve');
export const MSOL_MINT_AUTHORITY_SEED = Buffer.from('st_mint');
export const SOL_LEG_SEED = Buffer.from('liq_sol');
export const MSOL_LEG_AUTHORITY_SEED = Buffer.from('liq_st_sol_authority');

// ─────────────────────────────────────────────────────────────────────
// State account
//
// Anchor account; first 8 bytes are the IDL discriminator
//   sha256("account:State")[..8] = d8 92 6b 5e 68 4b b6 b1
// (verified — matches the on-chain account's first 8 bytes).
// ─────────────────────────────────────────────────────────────────────

export const STATE_DISC: number[] = [216, 146, 107, 94, 104, 75, 182, 177];

// ─────────────────────────────────────────────────────────────────────
// CU budget (empirical estimate; deposit touches state + msol_mint +
// reserve + sol_leg + msol_leg + ATA + mint authority CPI).
//
// Marinade's deposit logic is ~3-5x more work than a stake-pool
// DepositSol because of the LP rebalancing path. Pad accordingly.
// ─────────────────────────────────────────────────────────────────────

export const CU_MARINADE_DEPOSIT = 100_000n;
