// Constant-product pool quote. Meteora DAMM v1 is x*y=k on the tokens held in
// the pool's two token vaults, with the trade fee taken on the input. The quote
// the user sees — and the minimumOut we enforce — must come from THIS, the
// pool's real reserves, not an oracle: the pool can only ever pay out from what
// it holds, so its reserve ratio IS the price. A mispriced pool quotes a
// "bad" rate honestly; that's an arbitrage signal, not a bug.
//
// All amounts are raw on-chain integer units (token decimals already applied).

export function constantProductOut(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const bps = Math.max(0, Math.min(10_000, Math.floor(feeBps)));
  const amountInAfterFee = (amountIn * BigInt(10_000 - bps)) / 10_000n;
  if (amountInAfterFee <= 0n) return 0n;
  // x*y=k: out = reserveOut * dx / (reserveIn + dx). Floor division is
  // conservative (never over-quotes), which is what we want for minimumOut.
  return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
}

// Meteora DAMM v1 holds each pool token in a SHARED dynamic vault and tracks
// the pool's stake as vault-LP tokens. The pool's real reserve is therefore its
// LP share of the vault, NOT the vault's full token balance (which is shared
// across every pool on that vault). Using the raw vault balance over-quotes
// massively → minimumOut set too high → the swap reverts on slippage.
//   reserve = lpBalance * vaultTotalAmount / vaultLpSupply
export function effectiveReserve(
  lpBalance: bigint,
  vaultTotalAmount: bigint,
  vaultLpSupply: bigint,
): bigint {
  if (lpBalance <= 0n || vaultTotalAmount <= 0n || vaultLpSupply <= 0n) return 0n;
  return (lpBalance * vaultTotalAmount) / vaultLpSupply;
}

/** minimumOut = expectedOut shaved by the user's slippage tolerance (bps). */
export function applySlippage(expectedOut: bigint, slippageBps: number): bigint {
  if (expectedOut <= 0n) return 0n;
  const bps = Math.max(0, Math.min(10_000, Math.floor(slippageBps)));
  return (expectedOut * BigInt(10_000 - bps)) / 10_000n;
}
