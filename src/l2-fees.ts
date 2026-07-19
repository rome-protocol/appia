/**
 * Source-L2 burn fee cap (principle #3: read the chain, don't rely on a thin
 * auto-estimate). Rome-invisible L2 burns (approve + depositForBurn) are 1559
 * txs; L2 base fees — especially Arbitrum — can jump >20% between the wallet's
 * fee estimate and RPC submit, so a ~1.2× auto-cap gets rejected with
 * "max fee per gas less than block base fee". The ACTUAL charge is the block
 * base fee (the cap is only a ceiling), so a generous cap costs nothing and
 * removes the race. Read baseFeePerGas live and cap at base × headroom.
 */
export const L2_BASE_FEE_HEADROOM = 3n;
const MIN_PRIORITY_WEI = 1_000_000n; // 0.001 gwei — never zero (some RPCs require a tip)

/** maxFeePerGas / maxPriorityFeePerGas for a source-L2 burn tx, from the live base fee. */
export function burnMaxFees(baseFeeWei: bigint, priorityFeeWei = MIN_PRIORITY_WEI): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  const maxPriorityFeePerGas = priorityFeeWei > 0n ? priorityFeeWei : MIN_PRIORITY_WEI;
  const maxFeePerGas = baseFeeWei * L2_BASE_FEE_HEADROOM + maxPriorityFeePerGas;
  return { maxFeePerGas, maxPriorityFeePerGas };
}
