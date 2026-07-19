/**
 * The stake leg underflowed because it read the PDA balance immediately after
 * the unwrap tx confirmed on Rome — before the Solana RPC reflected the new
 * lamports (read-after-write race) — so `lam - rentBuffer` went negative
 * ("u64 out of range: -5000000") and under-staked. waitForLamports is the gate:
 * poll the balance until it settles at/above a threshold, or throw loud (never
 * silently proceed on a stale-low read).
 */
import { describe, it, expect, vi } from "vitest";
import { waitForLamports } from "../src/rome/settle-gate";

describe("waitForLamports — settle gate", () => {
  it("waits past early stale-low reads and returns the settled balance", async () => {
    const read = vi.fn<() => Promise<bigint>>()
      .mockResolvedValueOnce(0n)      // RPC hasn't caught up
      .mockResolvedValueOnce(0n)      // still lagging
      .mockResolvedValueOnce(7_000_000n); // settled
    const got = await waitForLamports(read, 6_000_000n, { tries: 5, sleep: async () => {} });
    expect(got).toBe(7_000_000n);
    expect(read).toHaveBeenCalledTimes(3); // did NOT return early on the 0 reads
  });

  it("throws (never silently under-stakes) if the balance never settles", async () => {
    const read = vi.fn<() => Promise<bigint>>().mockResolvedValue(0n);
    await expect(
      waitForLamports(read, 6_000_000n, { tries: 3, sleep: async () => {} }),
    ).rejects.toThrow(/did not reach/);
  });
});
