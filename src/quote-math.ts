/**
 * Earn quote composition: bridged USDC − fee → constant-product swap
 * estimate on the live pool reserves → mSOL via Marinade's rate. Pure math;
 * reserves and rate are fetched by the caller. Mirrors cardo/lib/pool-quote
 * for the swap step so the UI quote matches what the swap leg submits.
 */
export interface EarnQuoteIn {
  bridgedUsdc6: bigint;
  feeUsdc6: bigint;
  poolUsdcReserve6: bigint;
  poolWsolReserve9: bigint;
  poolFeeBps: number;
  msolPerSol: number;
  slippageBps: number;
}

export interface EarnQuote {
  swapInUsdc6: bigint;
  estWsol9: bigint;
  minWsol9: bigint;
  estMsol9: bigint;
}

export function constantProductOut(rIn: bigint, rOut: bigint, amountIn: bigint, feeBps: number): bigint {
  const inAfterFee = amountIn * BigInt(10_000 - feeBps);
  return (rOut * inAfterFee) / (rIn * 10_000n + inAfterFee);
}

export function applySlippage(out: bigint, slippageBps: number): bigint {
  return (out * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * A Meteora DAMM v1 pool's real reserve = its LP share of the SHARED dynamic
 * vault, NOT the vault's whole balance (which aggregates every pool on it):
 *   reserve = poolVaultLpBalance * vault.total_amount / vaultLpMint.supply
 * Reading the raw vault balance over-quotes massively → minimumOut lands above
 * what the pool pays → the swap reverts Meteora Custom(6004). Any missing/empty
 * component ⇒ 0 (caller treats a 0 reserve as "no quote").
 */
export function effectiveReserve(lpBalance: bigint, vaultTotalAmount: bigint, vaultLpSupply: bigint): bigint {
  if (lpBalance <= 0n || vaultTotalAmount <= 0n || vaultLpSupply <= 0n) return 0n;
  return (lpBalance * vaultTotalAmount) / vaultLpSupply;
}

export function composeEarnQuote(q: EarnQuoteIn): EarnQuote {
  if (q.feeUsdc6 >= q.bridgedUsdc6) {
    throw new Error(`fee exceeds bridged amount: ${q.feeUsdc6} >= ${q.bridgedUsdc6}`);
  }
  const swapInUsdc6 = q.bridgedUsdc6 - q.feeUsdc6;
  const estWsol9 = constantProductOut(q.poolUsdcReserve6, q.poolWsolReserve9, swapInUsdc6, q.poolFeeBps);
  const minWsol9 = applySlippage(estWsol9, q.slippageBps);
  const estMsol9 = BigInt(Math.floor(Number(estWsol9) * q.msolPerSol));
  return { swapInUsdc6, estWsol9, minWsol9, estMsol9 };
}

/**
 * Swap-only minimum-out for a RESUME (not the full-journey quote): the constant-product swap step +
 * slippage on the LIVE pool reserves. No bridge quote, no fee — a resume recovers the whole stranded
 * balance, so we swap all of it and protect it with the same slippage floor the Earn quote uses (pool
 * fee 25 bps, slippage 300 bps by default; the `/api/quote` full-journey path is unchanged).
 */
export function swapOnlyMinOut(
  amountInUsdc6: bigint,
  reserves: { poolUsdcReserve6: bigint; poolWsolReserve9: bigint },
  opts: { poolFeeBps?: number; slippageBps?: number } = {},
): bigint {
  const est = constantProductOut(reserves.poolUsdcReserve6, reserves.poolWsolReserve9, amountInUsdc6, opts.poolFeeBps ?? 25);
  return applySlippage(est, opts.slippageBps ?? 300);
}
