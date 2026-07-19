/**
 * Settle gate for the read-after-write race between a confirmed Rome tx and the
 * Solana RPC reflecting its effect (e.g. unwrap credits the PDA, but a stake
 * that reads the balance too soon sees 0 and underflows). Poll until the read
 * settles at/above `atLeast`, or throw loud — never silently proceed on a
 * stale-low value. `sleep` is injectable so it's unit-testable without waiting.
 */
export async function waitForLamports(
  read: () => Promise<bigint>,
  atLeast: bigint,
  opts: { tries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<bigint> {
  const tries = opts.tries ?? 15;
  const delayMs = opts.delayMs ?? 2000;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  let last = 0n;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (last >= atLeast) return last;
    if (i < tries - 1) await sleep(delayMs);
  }
  throw new Error(`balance did not reach ${atLeast} after ${tries} tries (last ${last}) — upstream tx not settled`);
}
