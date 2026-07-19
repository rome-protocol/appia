// Marinade PDA derivations.
//
// Source: github.com/marinade-finance/liquid-staking-program +
// on-chain bump verification on Solana devnet 2026-04-25 (bumps in the
// State account match these derivations).

import { PublicKey } from '@solana/web3.js';
import type { Hex } from 'viem';
import { bytes32ToPublicKey, pubkeyToBytes32 } from './solana-pda';
import {
  MARINADE_PROGRAM,
  MARINADE_STATE,
  MSOL_LEG_AUTHORITY_SEED,
  MSOL_MINT_AUTHORITY_SEED,
  RESERVE_SEED,
  SOL_LEG_SEED,
} from './marinade-program';

function deriveStatePda(seed: Buffer): Hex {
  const program = bytes32ToPublicKey(MARINADE_PROGRAM);
  const state = bytes32ToPublicKey(MARINADE_STATE);
  const [pda] = PublicKey.findProgramAddressSync(
    [state.toBuffer(), seed],
    program,
  );
  return pubkeyToBytes32(pda);
}

/// `reserve_pda` — system-account PDA holding the protocol's idle SOL.
/// `PDA([state_key, "reserve"], program)`. On-chain bump=255.
export const MARINADE_RESERVE_PDA: Hex = deriveStatePda(RESERVE_SEED);

/// `msol_mint_authority` — PDA that signs as mSOL mint authority.
/// `PDA([state_key, "st_mint"], program)`. On-chain bump=253; equals the
/// mint's actual authority 3JLPCS1qM2zRw3Dp6V4hZnYHd4toMNPkNesXdX9tg6KM.
export const MARINADE_MSOL_MINT_AUTHORITY: Hex = deriveStatePda(
  MSOL_MINT_AUTHORITY_SEED,
);

/// `liq_pool_sol_leg_pda` — system-account PDA holding the LP's idle SOL.
/// `PDA([state_key, "liq_sol"], program)`. On-chain bump=254.
export const MARINADE_LIQ_POOL_SOL_LEG: Hex = deriveStatePda(SOL_LEG_SEED);

/// `liq_pool_msol_leg_authority` — PDA that authorizes the LP's mSOL token
/// account. `PDA([state_key, "liq_st_sol_authority"], program)`.
/// On-chain bump=255.
export const MARINADE_LIQ_POOL_MSOL_LEG_AUTHORITY: Hex = deriveStatePda(
  MSOL_LEG_AUTHORITY_SEED,
);
