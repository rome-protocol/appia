/**
 * Meteora DAMM v1 parks each pool token in a SHARED dynamic vault and records
 * the pool's stake as vault-LP tokens. A pool's real reserve is its LP SHARE of
 * the vault — not the vault's whole balance (which serves every pool on it):
 *   reserve = poolVaultLpBalance * vault.total_amount / vaultLpMint.supply
 * The quote read the raw vault balance instead (wSOL vault = 26,762 wSOL vs
 * 283 USDC → "wSOL ≈ $0.01"), so estWsol9 was ~4 orders too high and the
 * enforced minWsol9 landed far above what the pool pays → the swap reverted
 * Meteora Custom(6004). effectiveReserve computes the share correctly.
 */
import { describe, it, expect } from "vitest";
import { effectiveReserve, composeEarnQuote } from "../src/quote-math";

describe("effectiveReserve — pool LP-share of the shared vault (Custom(6004) fix)", () => {
  it("= lpBalance × vaultTotal / lpSupply", () => {
    expect(effectiveReserve(100n, 26_762_689_557_211n, 200n)).toBe((100n * 26_762_689_557_211n) / 200n);
  });

  it("guards zero/empty inputs → 0 (any missing account ⇒ no quote)", () => {
    expect(effectiveReserve(0n, 1n, 1n)).toBe(0n);
    expect(effectiveReserve(1n, 0n, 1n)).toBe(0n);
    expect(effectiveReserve(1n, 1n, 0n)).toBe(0n);
  });

  it("regression: quoting off the real reserve gives a sane, achievable minOut — the raw vault total did not", () => {
    const vaultTotalWsol9 = 26_762_689_557_211n; // shared wSOL vault total (what the OLD quote used as the reserve)
    const usdcReserve6 = 30_000_000n; // ~30 USDC pool side
    // this pool owns a small slice of the shared vault:
    const wsolReserveReal9 = effectiveReserve(1_000_000n, vaultTotalWsol9, 60_000_000_000n);
    expect(wsolReserveReal9).toBeLessThan(vaultTotalWsol9 / 100n); // real reserve ≪ raw vault total

    const args = { bridgedUsdc6: 1_000_000n, feeUsdc6: 250_000n, poolUsdcReserve6: usdcReserve6, poolFeeBps: 25, msolPerSol: 0.998, slippageBps: 300 };
    const good = composeEarnQuote({ ...args, poolWsolReserve9: wsolReserveReal9 }); // real reserve
    const bad = composeEarnQuote({ ...args, poolWsolReserve9: vaultTotalWsol9 }); // the old bug
    expect(bad.minWsol9).toBeGreaterThan(good.minWsol9 * 100n); // old minOut was orders too high ⇒ unpayable ⇒ 6004
  });
});
