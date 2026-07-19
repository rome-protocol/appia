/**
 * "Arrives on Solana" false-completed in ~5s. watchDelivered returned as soon
 * as the session USDC ATA held >= a static threshold (amountOut/2). But the
 * session key is reused across journeys (localStorage), so the ATA already held
 * ~8 USDC of residual from prior runs — the check was already true, the leg
 * flipped instantly without waiting for THIS transfer, and the journey swapped
 * the leftover. Fix: gate on the DELTA — baseline the balance at entry and wait
 * until it rises by the expected delivered amount (so residual can't trip it).
 */
import { describe, it, expect, vi } from "vitest";
import { watchDelivered } from "../src/drivers";
import type { RomeSigner } from "../src/rome-signer";

const signer: RomeSigner = { address: "0x0000000000000000000000000000000000000001", sendRomeTx: async () => "0x" };

describe("watchDelivered — delta gate (reused-session false-complete fix)", () => {
  it("does NOT complete on residual balance; waits until it rises by the expected delivery", async () => {
    const read = vi.fn<() => Promise<bigint>>()
      .mockResolvedValueOnce(8_240_000n)   // baseline — residual from prior journeys
      .mockResolvedValueOnce(8_240_000n)   // new transfer not arrived yet
      .mockResolvedValueOnce(8_240_000n)
      .mockResolvedValueOnce(10_238_000n); // +~1.998 USDC actually delivered
    await watchDelivered(signer, 1_999_800n, { read, sleep: async () => {}, timeoutMs: 10_000 });
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(4); // did NOT return on the residual reads
  });

  it("times out (funds recoverable) if the delivery never arrives", async () => {
    const read = vi.fn<() => Promise<bigint>>().mockResolvedValue(8_240_000n); // never rises past baseline
    await expect(
      watchDelivered(signer, 1_999_800n, { read, sleep: async () => {}, timeoutMs: 40 }),
    ).rejects.toThrow(/delivery timeout/);
  });

  it("regression: the old static threshold (amountOut/2) false-completed on residual", () => {
    const residual = 8_240_000n, oldThreshold = 1_999_800n / 2n;
    expect(residual >= oldThreshold).toBe(true); // why "Arrives on Solana" flipped in ~5s
  });
});
