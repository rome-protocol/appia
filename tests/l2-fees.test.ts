/**
 * Source-L2 burn tx (approve / depositForBurn) fee cap. The app set only a gas
 * LIMIT and let the wallet auto-estimate the fee (~1.2× base). Arbitrum Sepolia
 * base fees can jump >20% between estimate and submit, so that thin margin was
 * eaten and the RPC rejected the tx: "max fee per gas less than block base fee"
 * (maxFeePerGas 20006000 < baseFee 20020000). Fix: read the live base fee and
 * cap with generous headroom — the charge is the actual base fee, so a high cap
 * is free insurance against a base-fee bump.
 */
import { describe, it, expect } from "vitest";
import { burnMaxFees, L2_BASE_FEE_HEADROOM } from "../src/l2-fees";

describe("burnMaxFees — source-L2 fee cap with headroom", () => {
  it("caps maxFeePerGas at base × headroom + priority", () => {
    const { maxFeePerGas, maxPriorityFeePerGas } = burnMaxFees(20_020_000n, 1_000_000n);
    expect(maxPriorityFeePerGas).toBe(1_000_000n);
    expect(maxFeePerGas).toBe(20_020_000n * L2_BASE_FEE_HEADROOM + 1_000_000n);
  });

  it("regression: survives the base-fee bump that rejected the old thin margin", () => {
    // observed: estimate ~16.7M base → maxFee 20006000; base bumped to 20020000 at submit
    const bumpedBase = 20_020_000n;
    const { maxFeePerGas } = burnMaxFees(16_700_000n, 1_000_000n); // computed at the LOW estimate-time base
    expect(maxFeePerGas).toBeGreaterThan(bumpedBase); // still clears a +20% bump
    expect(20_006_000n).toBeLessThan(bumpedBase); // why the old value failed
  });

  it("floors the priority tip so it is never zero (some RPCs require a tip)", () => {
    expect(burnMaxFees(20_000_000n, 0n).maxPriorityFeePerGas).toBeGreaterThan(0n);
  });

  it("headroom is generous (>=3×) — L2 base fees are volatile and the cap is free", () => {
    expect(L2_BASE_FEE_HEADROOM).toBeGreaterThanOrEqual(3n);
  });
});
