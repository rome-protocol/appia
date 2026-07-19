/**
 * Fee = max(bps of amount, fixed floor), quoted in USDC base units (6dp).
 * Charged at the swap leg only (fee iff swap executes — product contract).
 */
export function quoteFee(p: { amountUsdc6: bigint; feeBps: number; floorUsdc6: bigint }): bigint {
  const pct = (p.amountUsdc6 * BigInt(p.feeBps)) / 10_000n;
  const fee = pct > p.floorUsdc6 ? pct : p.floorUsdc6;
  if (fee >= p.amountUsdc6) {
    throw new Error(`amount below fee floor: fee ${fee} >= amount ${p.amountUsdc6}`);
  }
  return fee;
}
