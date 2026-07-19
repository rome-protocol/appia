/**
 * Cost + ETA — the transparency half of the design ("the user always knows what's next, WHEN, and what
 * it will COST"). estimateEta is source-aware: the dominant term is the bridge-in finality, which varies
 * hugely by source chain (Ethereum-Sepolia CCTP hard finality ~19 min vs a fast-finality L2 ~1 min).
 * estimateCost composes the honest per-currency pieces (USDC fee, source/dest network gas in wei,
 * reclaimable ATA rent in lamports) — it deliberately does NOT sum across currencies (that would need a
 * price oracle and would be a false-precision "total").
 */
import { describe, it, expect } from "vitest";
import { estimateEta, estimateRemainingEta, formatEta, estimateCost, BURN_GAS_UNITS, REDEEM_GAS_UNITS, ROME_LEG_SEC, VAA_SEC, REDEEM_SEC } from "../src/cost-eta";

describe("estimateEta — source-aware, leg-aware time to complete", () => {
  it("Ethereum Sepolia is the slow source (CCTP hard finality dominates)", () => {
    const e = estimateEta(11155111);
    expect(e.bridgeInSec).toBe(19 * 60);
    expect(e.romeLegsSec).toBe(3 * ROME_LEG_SEC);
    expect(e.vaaSec).toBe(0);
    expect(e.redeemSec).toBe(0);
    expect(e.totalSec).toBe(19 * 60 + 3 * ROME_LEG_SEC);
  });
  it("fast-finality L2s bridge in quickly", () => {
    for (const id of [421614, 84532, 43113, 80002]) expect(estimateEta(id).bridgeInSec).toBe(60);
  });
  it("an unknown source falls back to a conservative estimate", () => {
    expect(estimateEta(999999).bridgeInSec).toBe(15 * 60);
  });
  it("deliver-home adds the VAA + redeem legs", () => {
    const e = estimateEta(421614, { deliverHome: true });
    expect(e.vaaSec).toBe(VAA_SEC);
    expect(e.redeemSec).toBe(REDEEM_SEC);
    expect(e.totalSec).toBe(60 + 3 * ROME_LEG_SEC + VAA_SEC + REDEEM_SEC);
  });
  it("leg count is configurable (a resume runs fewer legs)", () => {
    expect(estimateEta(421614, { legs: 1 }).romeLegsSec).toBe(ROME_LEG_SEC);
  });
});

describe("estimateRemainingEta — outbound / mid-journey (no bridge-in)", () => {
  it("bring-home from a held position = egress leg + VAA + redeem, no bridge-in", () => {
    const e = estimateRemainingEta({ legs: 1, vaa: true, redeem: true });
    expect(e.bridgeInSec).toBe(0);
    expect(e.romeLegsSec).toBe(ROME_LEG_SEC);
    expect(e.vaaSec).toBe(VAA_SEC);
    expect(e.redeemSec).toBe(REDEEM_SEC);
    expect(e.totalSec).toBe(ROME_LEG_SEC + VAA_SEC + REDEEM_SEC);
  });
  it("a detected pending redeem is just the redeem (the VAA is already attested)", () => {
    const e = estimateRemainingEta({ redeem: true });
    expect(e.totalSec).toBe(REDEEM_SEC);
    expect(e.bridgeInSec).toBe(0);
    expect(e.vaaSec).toBe(0);
  });
  it("a resume runs only its remaining Rome legs (no bridge-in, no VAA)", () => {
    expect(estimateRemainingEta({ legs: 3 }).totalSec).toBe(3 * ROME_LEG_SEC);
  });
});

describe("formatEta — human ETA", () => {
  it("sub-90s reads in seconds; longer rounds to minutes", () => {
    expect(formatEta(45)).toMatch(/45 sec/);
    expect(formatEta(300)).toMatch(/5 min/);
    expect(formatEta(19 * 60 + 36)).toMatch(/20 min/);
  });
});

describe("estimateCost — all-in, honest per-currency (no cross-currency total)", () => {
  it("source network fee = live base fee × burn gas units; fee passes through; no dest/rent by default", () => {
    const c = estimateCost({ feeUsdc6: 250_000n, sourceBaseFeeWei: 1_000_000_000n });
    expect(c.feeUsdc6).toBe(250_000n);
    expect(c.sourceGasWei).toBe(1_000_000_000n * BURN_GAS_UNITS);
    expect(c.destGasWei).toBe(0n);
    expect(c.rentLamports).toBe(0n);
  });
  it("deliver-home adds the dest redeem gas from the dest base fee", () => {
    const c = estimateCost({ feeUsdc6: 0n, sourceBaseFeeWei: 1n, deliverHome: true, destBaseFeeWei: 2_000_000_000n });
    expect(c.destGasWei).toBe(2_000_000_000n * REDEEM_GAS_UNITS);
  });
  it("passes through the reclaimable ATA rent", () => {
    expect(estimateCost({ feeUsdc6: 0n, sourceBaseFeeWei: 1n, rentLamports: 2_039_280n }).rentLamports).toBe(2_039_280n);
  });
});
