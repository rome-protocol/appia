/**
 * Resume runner — finish a parked journey by running the REMAINING Rome legs from where it stalled,
 * signed by the user's OWN wallet, reading LIVE on-chain amounts (recovery moves whatever is actually
 * there — not a stale quote). Reuses the tested leg drivers.
 */
import { ROME_CHAIN } from "./rome/rome-config";
import { ataBalance, awaitAtaCredit, awaitPdaCredit, pdaLamports, stakeMarinade, swapUsdcToWsol, unwrapWsol } from "./drivers";
import { fetchPoolReserves } from "./pool-reserves";
import { swapOnlyMinOut } from "./quote-math";
import type { RomeSigner } from "./rome-signer";

export type RomeLeg = "swap" | "unwrap" | "stake";
const ORDER: RomeLeg[] = ["swap", "unwrap", "stake"];

/** The remaining Rome legs to run from a parked leg (inclusive). */
export function legsFrom(leg: RomeLeg): RomeLeg[] {
  const i = ORDER.indexOf(leg);
  if (i < 0) throw new Error(`not a rome leg: ${leg}`);
  return ORDER.slice(i);
}

/** Keep a small native-SOL rent buffer on the PDA when staking (mirrors the Earn flow). */
const RENT_BUFFER = 5_000_000n;

/**
 * Resume from `leg` → mSOL, signed by the user's wallet, reading LIVE balances (recovery moves whatever
 * is actually there). Every leg is now supported: swap→ derives a swap-only min-out from the live pool
 * reserves (no bridge quote, no fee — the whole stranded USDC is swapped) and gates on the wSOL landing
 * before the chained unwrap; unwrap→/stake→ need no quote. `onLeg` fires as each leg confirms (UI
 * progress). Returns the tx hash per leg run.
 */
export async function resumeFromLeg(
  signer: RomeSigner,
  leg: RomeLeg,
  opts: { onLeg?: (legId: RomeLeg, tx: string) => void; rentBuffer?: bigint } = {},
): Promise<Partial<Record<RomeLeg, string>>> {
  const buffer = opts.rentBuffer ?? RENT_BUFFER;
  const txs: Partial<Record<RomeLeg, string>> = {};

  for (const l of legsFrom(leg)) {
    if (l === "swap") {
      const usdc = await ataBalance(signer, ROME_CHAIN.usdcMint);
      if (usdc === 0n) throw new Error("nothing to swap — no USDC in your account");
      const { usdc6, wsol9 } = await fetchPoolReserves();
      const minOut = swapOnlyMinOut(usdc, { poolUsdcReserve6: usdc6, poolWsolReserve9: wsol9 });
      const tx = await swapUsdcToWsol(signer, usdc, minOut);
      txs.swap = tx;
      opts.onLeg?.("swap", tx);
      await awaitAtaCredit(signer, ROME_CHAIN.wsolMint, minOut); // gate: wSOL landed before the unwrap reads it
    } else if (l === "unwrap") {
      const wsol = await ataBalance(signer, ROME_CHAIN.wsolMint);
      if (wsol === 0n) throw new Error("nothing to unwrap — no wSOL in your account");
      const pdaBefore = await pdaLamports(signer);
      const tx = await unwrapWsol(signer);
      txs.unwrap = tx;
      opts.onLeg?.("unwrap", tx);
      await awaitPdaCredit(signer, pdaBefore, wsol); // gate: wait until the unwrap credit lands
    } else if (l === "stake") {
      const lam = await pdaLamports(signer);
      if (lam <= buffer) throw new Error("nothing to stake — no unwrapped SOL above the rent buffer");
      const tx = await stakeMarinade(signer, lam - buffer);
      txs.stake = tx;
      opts.onLeg?.("stake", tx);
    }
  }
  return txs;
}
