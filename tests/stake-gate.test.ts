/**
 * Stake under-staked ~0.5 SOL once. The stake leg read the PDA lamports right after
 * unwrap, but (a) the Solana RPC lags the Rome tx confirmation and (b) the reused
 * session PDA carries residual lamports from prior journeys — so a static ">6M"
 * threshold was already true and stake built from a stale/residual balance, under-
 * staking the amount the fresh unwrap actually released. Fix: DELTA-gate — baseline
 * the PDA lamports BEFORE the unwrap and wait until they rise by the unwrapped amount,
 * then stake the CONFIRMED balance. Same class of fix as watchDelivered's delta-gate.
 */
import { describe, it, expect, vi } from "vitest";
import { awaitPdaCredit } from "../src/drivers";
import type { RomeSigner } from "../src/rome-signer";

const signer: RomeSigner = { address: "0x0000000000000000000000000000000000000001", sendRomeTx: async () => "0x" };

describe("awaitPdaCredit — unwrap→stake confirmation gate", () => {
  it("does NOT complete on residual PDA lamports; waits until they rise by the unwrapped amount", async () => {
    const baseline = 7_000_000n;        // residual from prior journeys — already > the old 6M threshold
    const unwrapped = 100_000_000n;     // ~0.1 SOL released by closing the wSOL ATA
    const read = vi
      .fn<() => Promise<bigint>>()
      .mockResolvedValueOnce(7_000_000n)     // RPC still lagging — unwrap not reflected
      .mockResolvedValueOnce(7_000_000n)
      .mockResolvedValueOnce(109_039_280n);  // baseline + unwrapped + ATA rent — credit landed
    const confirmed = await awaitPdaCredit(signer, baseline, unwrapped, { read, sleep: async () => {}, timeoutMs: 10_000 });
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(3); // did NOT return on the residual reads
    expect(confirmed).toBe(109_039_280n);                     // returns the CONFIRMED risen balance to stake from
  });

  it("times out (funds recoverable) if the unwrap credit never lands", async () => {
    const read = vi.fn<() => Promise<bigint>>().mockResolvedValue(7_000_000n); // never rises past baseline
    await expect(
      awaitPdaCredit(signer, 7_000_000n, 100_000_000n, { read, sleep: async () => {}, timeoutMs: 40 }),
    ).rejects.toThrow(/unwrap credit timeout/i);
  });

  it("regression: the old static >6M threshold false-completes on residual (root cause)", () => {
    const residual = 7_000_000n, oldThreshold = 6_000_000n;
    expect(residual > oldThreshold).toBe(true); // why stake built from residual and under-staked the new unwrap
  });
});
