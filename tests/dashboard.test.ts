/**
 * Dashboard view-model (P0). The DApp dashboard is positions-first: a wallet's on-chain observation
 * splits into HELD POSITIONS (staking now; lend/borrow later — the earn/pay hero) and ATTENTION items
 * (mid-journey funds that need finishing — the partials). buildDashboard reuses the tested buildClaims
 * (position-held → positions, funds-in-pda → attention) so the split stays consistent with the claim
 * center, and adds the protocol/earning framing the position cards render. Services are a static catalog
 * (some live, some "soon"); Activity/recent history is its own nav (indexed later) — not modeled here.
 */
import { describe, it, expect } from "vitest";
import { buildDashboard, SERVICES } from "../src/dashboard";

const ZERO = { usdc6: 0n, wsol9: 0n, lamports: 0n, msol9: 0n };

describe("buildDashboard — positions vs attention, from on-chain balances", () => {
  it("held mSOL → a staking POSITION (earning, Marinade), no attention", () => {
    const d = buildDashboard({ ...ZERO, msol9: 8_187_770_315n });
    expect(d.attention).toEqual([]);
    expect(d.positions).toHaveLength(1);
    expect(d.positions[0]).toMatchObject({
      protocol: "marinade", kind: "stake", asset: "msol",
      amount: 8_187_770_315n, decimals: 9, earning: true,
    });
    expect(d.summary).toMatchObject({ positions: 1, attention: 0 });
  });

  it("mid-journey funds (delivered USDC, not staked) → an ATTENTION item, no position", () => {
    const d = buildDashboard({ ...ZERO, usdc6: 2_000_000n });
    expect(d.positions).toEqual([]);
    expect(d.attention).toHaveLength(1);
    expect(d.attention[0]).toMatchObject({ asset: "usdc", amount: 2_000_000n, resumeLeg: "swap" });
    expect(d.summary).toMatchObject({ positions: 0, attention: 1 });
  });

  it("mixed wallet → held mSOL is a position; the stranded wSOL is attention", () => {
    const d = buildDashboard({ ...ZERO, wsol9: 100_000_000n, msol9: 1_000_000_000n });
    expect(d.positions.map((p) => p.asset)).toEqual(["msol"]);
    expect(d.attention.map((a) => a.asset)).toEqual(["wsol"]);
  });

  it("dust-only wallet → empty dashboard (nothing held, nothing stranded)", () => {
    const d = buildDashboard({ ...ZERO, lamports: 4_000_000n });
    expect(d.positions).toEqual([]);
    expect(d.attention).toEqual([]);
    expect(d.summary).toEqual({ positions: 0, attention: 0 });
  });

  it("mSOL bring-home readiness flows through from the allowlist (canBringHome)", () => {
    expect(buildDashboard({ ...ZERO, msol9: 1n }).positions[0]!.canBringHome).toBe(false);
    expect(buildDashboard({ ...ZERO, msol9: 1n }, { allowlisted: { msol: true } }).positions[0]!.canBringHome).toBe(true);
  });
});

describe("buildDashboard — Mango lend position (supplied SOL, read separately from wallet balances)", () => {
  // Supplied SOL lives INSIDE Mango (not a wallet balance), so it's read via fetchMangoSolDeposited
  // and passed in — not derived from the ClaimObservation.
  it("a supplied Mango balance → a lend POSITION (earning, Mango), keyed on wSOL", () => {
    const d = buildDashboard(ZERO, { mangoSolSupplied9: 5_000_000n });
    expect(d.positions).toHaveLength(1);
    expect(d.positions[0]).toMatchObject({
      protocol: "mango", kind: "lend", asset: "wsol",
      amount: 5_000_000n, decimals: 9, earning: true,
    });
    expect(d.summary.positions).toBe(1);
  });

  it("no supplied balance (0 / null / omitted) → no lend position", () => {
    expect(buildDashboard(ZERO, { mangoSolSupplied9: 0n }).positions).toEqual([]);
    expect(buildDashboard(ZERO, { mangoSolSupplied9: null }).positions).toEqual([]);
    expect(buildDashboard(ZERO).positions).toEqual([]);
  });

  it("stake + lend coexist — held mSOL AND supplied SOL are both positions", () => {
    const d = buildDashboard({ ...ZERO, msol9: 1_000_000_000n }, { mangoSolSupplied9: 5_000_000n });
    expect(d.positions.map((p) => `${p.protocol}:${p.kind}`).sort()).toEqual(["mango:lend", "marinade:stake"]);
    expect(d.summary.positions).toBe(2);
  });
});

describe("SERVICES — the catalog the dashboard + nav render", () => {
  it("swap + stake + lend are live; borrow, liquidity are 'soon'", () => {
    const by = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
    expect(by.swap!.live).toBe(true);
    expect(by.stake!.live).toBe(true);
    expect(by.lend!.live).toBe(true);
    expect(by.borrow!.live).toBe(false);
    expect(by.liquidity!.live).toBe(false);
  });
  it("each service has a label + one-line blurb", () => {
    for (const s of SERVICES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeGreaterThan(0);
    }
  });
});
