/**
 * Swap-resume — the last resume gap. resumeFromLeg already finishes unwrap→/stake→; a wUSDC-stranded
 * position (delivered, never swapped) needs a swap-only min-out to resume swap→unwrap→stake. There's no
 * bridge quote and no fee on a resume — recovery moves the WHOLE live balance — so the min-out is just
 * the constant-product swap step on the LIVE pool reserves + slippage. fetchPoolReserves is the reserve
 * read (the pool's LP share of the shared Meteora vaults) lifted from the quote route as an
 * injectable-RPC helper so both the route and the client-driven resume use one implementation.
 */
import { describe, it, expect } from "vitest";
import { swapOnlyMinOut, constantProductOut, applySlippage } from "../src/quote-math";
import { fetchPoolReserves, type SolRpc } from "../src/pool-reserves";
import { ROME_METEORA_POOL } from "../src/rome/meteora-pool";
import { bytes32ToPublicKey } from "../src/rome/solana-pda";

describe("swapOnlyMinOut — swap-only floor for a resume (no bridge quote, no fee)", () => {
  const reserves = { poolUsdcReserve6: 24_400_000n, poolWsolReserve9: 2_060_000_000n }; // ~ live pool

  it("= applySlippage(constantProductOut(...)) with the pool defaults (25 bps fee, 300 bps slippage)", () => {
    const est = constantProductOut(reserves.poolUsdcReserve6, reserves.poolWsolReserve9, 1_000_000n, 25);
    expect(swapOnlyMinOut(1_000_000n, reserves)).toBe(applySlippage(est, 300));
  });

  it("more slippage → a lower floor", () => {
    const tight = swapOnlyMinOut(1_000_000n, reserves, { slippageBps: 50 });
    const loose = swapOnlyMinOut(1_000_000n, reserves, { slippageBps: 500 });
    expect(loose).toBeLessThan(tight);
  });

  it("floor is strictly below the raw estimate (slippage protects the user)", () => {
    const est = constantProductOut(reserves.poolUsdcReserve6, reserves.poolWsolReserve9, 1_000_000n, 25);
    expect(swapOnlyMinOut(1_000_000n, reserves)).toBeLessThan(est);
  });

  it("zero input → zero out", () => {
    expect(swapOnlyMinOut(0n, reserves)).toBe(0n);
  });
});

describe("fetchPoolReserves — pool LP-share of the shared vaults, injectable RPC", () => {
  // account layout offsets: dynamic-vault total_amount u64 @ 11; SPL token amount u64 @ 64; mint supply u64 @ 36
  const acct = (off: number, val: bigint, size = 200): Buffer => {
    const b = Buffer.alloc(size);
    b.writeBigUInt64LE(val, off);
    return b;
  };
  // keys order: [0]aVault [1]bVault [2]aVaultLp [3]bVaultLp [4]aVaultLpMint [5]bVaultLpMint. A=WSOL, B=USDC.
  const bufs = [
    acct(11, 1000n), // aVault total
    acct(11, 2000n), // bVault total
    acct(64, 100n), //  aVaultLp balance (WSOL side)
    acct(64, 200n), //  bVaultLp balance (USDC side)
    acct(36, 400n), //  aVaultLpMint supply
    acct(36, 800n), //  bVaultLpMint supply
  ];
  const mockRpc = (data: (Buffer | null)[], captured?: { keys?: string[] }): SolRpc =>
    (async (method: string, params: unknown[]) => {
      if (method !== "getMultipleAccounts") throw new Error("unexpected " + method);
      if (captured) captured.keys = (params as [string[]])[0];
      return { value: data.map((b) => (b ? { data: [b.toString("base64"), "base64"] } : null)) };
    }) as SolRpc;

  it("maps the six vault accounts to {usdc6, wsol9} via effectiveReserve (lp × total / supply)", async () => {
    const r = await fetchPoolReserves({ solRpc: mockRpc(bufs) });
    // wsol9 = 100 * 1000 / 400 = 250 ; usdc6 = 200 * 2000 / 800 = 500
    expect(r).toEqual({ wsol9: 250n, usdc6: 500n });
  });

  it("requests exactly the six pool vault accounts (base58), in order", async () => {
    const cap: { keys?: string[] } = {};
    await fetchPoolReserves({ solRpc: mockRpc(bufs, cap) });
    const expected = [ROME_METEORA_POOL.aVault, ROME_METEORA_POOL.bVault, ROME_METEORA_POOL.aVaultLp, ROME_METEORA_POOL.bVaultLp, ROME_METEORA_POOL.aVaultLpMint, ROME_METEORA_POOL.bVaultLpMint]
      .map((h) => bytes32ToPublicKey(h).toBase58());
    expect(cap.keys).toEqual(expected);
  });

  it("throws when an account is unreadable", async () => {
    const missing: (Buffer | null)[] = [...bufs]; missing[0] = null;
    await expect(fetchPoolReserves({ solRpc: mockRpc(missing) })).rejects.toThrow(/unreadable/i);
  });

  it("throws when reserves compute to zero (no quote possible)", async () => {
    const zeroed: (Buffer | null)[] = [...bufs]; zeroed[2] = acct(64, 0n); // aVaultLp balance 0 → wsol9 = 0
    await expect(fetchPoolReserves({ solRpc: mockRpc(zeroed) })).rejects.toThrow(/unavailable/i);
  });
});
