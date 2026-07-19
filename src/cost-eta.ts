/**
 * Cost + ETA transparency — "the user always knows what's next, WHEN, and what it will COST" (a founding
 * requirement). Pure + testable; the UI feeds it live inputs (source base fee, fee, rent) and renders.
 *
 * ETA is source-aware because the bridge-in finality dominates and varies hugely by source chain. The
 * finality table is a FLAGGED config (principle #3 last-resort): CCTP attestation latency is NOT
 * chain-readable — it's a property of Circle's attestation service + the source chain's finality, so it
 * can't be sourced from chain/registry. Refine from observed p50s. (The pod `/v1/quote` returns a flat
 * etaSeconds=40 regardless of source — that's a bug handed to bridge-api; we compute source-aware here.)
 */

// Source-chain bridge-in finality (seconds). Ethereum Sepolia needs CCTP hard finality (~13-19 min);
// fast-finality L2s attest in ~a minute. FLAGGED config — not chain-readable.
const BRIDGE_IN_SEC: Record<number, number> = {
  11155111: 19 * 60, // Ethereum Sepolia
  421614: 60, //        Arbitrum Sepolia
  84532: 60, //         Base Sepolia
  43113: 60, //         Avalanche Fuji
  80002: 60, //         Polygon Amoy
};
const UNKNOWN_SOURCE_SEC = 15 * 60; // conservative default for a source not in the table

export const ROME_LEG_SEC = 12; // one Rome leg settling to Solana (observed seconds-scale)
export const VAA_SEC = 5 * 60; //  guardian attestation of the egress VAA (deliver-home)
export const REDEEM_SEC = 60; //   dest-L2 completeTransfer inclusion (deliver-home)
const DEFAULT_LEGS = 3; //          Earn = swap + unwrap + stake

export interface EtaBreakdown {
  bridgeInSec: number;
  romeLegsSec: number;
  vaaSec: number; // 0 unless deliver-home
  redeemSec: number; // 0 unless deliver-home
  totalSec: number;
}

export function estimateEta(sourceChainId: number, opts: { legs?: number; deliverHome?: boolean } = {}): EtaBreakdown {
  const bridgeInSec = BRIDGE_IN_SEC[sourceChainId] ?? UNKNOWN_SOURCE_SEC;
  const romeLegsSec = (opts.legs ?? DEFAULT_LEGS) * ROME_LEG_SEC;
  const vaaSec = opts.deliverHome ? VAA_SEC : 0;
  const redeemSec = opts.deliverHome ? REDEEM_SEC : 0;
  return { bridgeInSec, romeLegsSec, vaaSec, redeemSec, totalSec: bridgeInSec + romeLegsSec + vaaSec + redeemSec };
}

/**
 * Remaining ETA for an OUTBOUND or mid-journey action (no bridge-in — the funds are already on Rome):
 * bring-home from a held position (egress leg + VAA + redeem), a detected pending redeem (just the
 * redeem — the VAA is already attested), or a resume (only its remaining Rome legs). Each phase is
 * toggled explicitly since these cases mix differently.
 */
export function estimateRemainingEta(opts: { legs?: number; vaa?: boolean; redeem?: boolean } = {}): EtaBreakdown {
  const romeLegsSec = (opts.legs ?? 0) * ROME_LEG_SEC;
  const vaaSec = opts.vaa ? VAA_SEC : 0;
  const redeemSec = opts.redeem ? REDEEM_SEC : 0;
  return { bridgeInSec: 0, romeLegsSec, vaaSec, redeemSec, totalSec: romeLegsSec + vaaSec + redeemSec };
}

/** Human ETA: seconds under 90s (rounded to 5s), otherwise whole minutes. */
export function formatEta(totalSec: number): string {
  if (totalSec < 90) return `~${Math.max(5, Math.round(totalSec / 5) * 5)} sec`;
  return `~${Math.round(totalSec / 60)} min`;
}

// Approximate gas units (FLAGGED config): CCTP approve+depositForBurn ~200k; Wormhole completeTransfer
// ~150k. Refine from eth_estimateGas per chain later; used only for the displayed network-fee estimate
// (the real charge is metered on-chain). The ACTUAL source fee is base×units — the l2-fees 3× headroom
// is only a submit ceiling, so estimate at base (×1).
export const BURN_GAS_UNITS = 200_000n;
export const REDEEM_GAS_UNITS = 150_000n;

export interface CostBreakdown {
  feeUsdc6: bigint; //     the Appia fee (explicit; covers operator-fronted Rome gas)
  sourceGasWei: bigint; // source-L2 burn gas, paid by the user's own wallet
  destGasWei: bigint; //   dest-L2 redeem gas (deliver-home only), user's wallet
  rentLamports: bigint; // ATA rent (operator-fronted, RECLAIMABLE — a deposit, not a true cost)
}

/**
 * All-in cost, kept per-currency on purpose: USDC fee, source/dest network gas (wei), reclaimable rent
 * (lamports). No single grand total — summing across USDC/ETH/SOL would need a price oracle and read as
 * false precision. The UI shows each line in its own unit.
 */
export function estimateCost(p: {
  feeUsdc6: bigint;
  sourceBaseFeeWei: bigint;
  deliverHome?: boolean;
  destBaseFeeWei?: bigint;
  rentLamports?: bigint;
}): CostBreakdown {
  return {
    feeUsdc6: p.feeUsdc6,
    sourceGasWei: p.sourceBaseFeeWei * BURN_GAS_UNITS,
    destGasWei: p.deliverHome ? (p.destBaseFeeWei ?? 0n) * REDEEM_GAS_UNITS : 0n,
    rentLamports: p.rentLamports ?? 0n,
  };
}
