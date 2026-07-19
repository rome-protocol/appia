/**
 * Dashboard view-model (P0) — the positions-first DApp model. A wallet's on-chain observation splits into
 * held POSITIONS (the earn/pay hero) and ATTENTION items (mid-journey partials to finish). We reuse the
 * tested buildClaims so this stays consistent with the claim center: `position-held` → a position,
 * `funds-in-pda` → an attention item. Positions gain the protocol/earning framing the cards render.
 *
 * Live today: staking (Marinade → mSOL). Lend/borrow are the IA (SERVICES marks them "soon"); when they
 * land they become additional position kinds here. Activity/recent history is its own nav (indexed
 * later), not modeled in this file.
 */
import { buildClaims, type ClaimAsset, type ClaimItem } from "./claims";
import type { ClaimObservation } from "./claims";

export type PositionKind = "stake" | "lend" | "borrow";

export interface DashPosition {
  protocol: string; // e.g. "marinade"
  kind: PositionKind;
  asset: ClaimAsset;
  amount: bigint;
  decimals: number;
  earning: boolean; // true = you earn yield; false = you pay (borrow)
  canBringHome: boolean;
}

export interface DashAttention {
  asset: ClaimAsset;
  amount: bigint;
  decimals: number;
  resumeLeg: string | null;
  canBringHome: boolean;
}

export interface DashboardModel {
  positions: DashPosition[];
  attention: DashAttention[];
  summary: { positions: number; attention: number };
}

/** Which protocol/kind a held asset represents. Today only mSOL (Marinade stake) is a held position;
 *  future lend/borrow positions are read from their own markets (P3/P4) and appended here. */
const HELD_PROTOCOL: Partial<Record<ClaimAsset, { protocol: string; kind: PositionKind; earning: boolean }>> = {
  msol: { protocol: "marinade", kind: "stake", earning: true },
};

export function buildDashboard(
  obs: ClaimObservation,
  opts: {
    dustLamports?: bigint;
    allowlisted?: Partial<Record<ClaimAsset, boolean>>;
    /// Supplied SOL (native 9dp) in the Mango lend market — read separately via
    /// fetchMangoSolDeposited (it lives INSIDE Mango, not in a wallet balance). null/0/omitted → no
    /// lend position. Kept out of ClaimObservation because it's a protocol-internal read, not a balance.
    mangoSolSupplied9?: bigint | null;
  } = {},
): DashboardModel {
  const claims = buildClaims(obs, opts);

  const positions: DashPosition[] = claims
    .filter((c: ClaimItem) => c.claimState === "position-held")
    .map((c) => {
      const meta = HELD_PROTOCOL[c.asset] ?? { protocol: "unknown", kind: "stake" as PositionKind, earning: true };
      return { ...meta, asset: c.asset, amount: c.amount, decimals: c.decimals, canBringHome: c.canBringHome };
    });

  // Mango lend position — supplied wSOL held inside Mango (withdraw to recover; not bring-home-able
  // directly, so canBringHome:false). Appended from the injected reader amount.
  if (opts.mangoSolSupplied9 && opts.mangoSolSupplied9 > 0n) {
    positions.push({ protocol: "mango", kind: "lend", asset: "wsol", amount: opts.mangoSolSupplied9, decimals: 9, earning: true, canBringHome: false });
  }

  const attention: DashAttention[] = claims
    .filter((c: ClaimItem) => c.claimState === "funds-in-pda")
    .map((c) => ({ asset: c.asset, amount: c.amount, decimals: c.decimals, resumeLeg: c.resumeLeg, canBringHome: c.canBringHome }));

  return { positions, attention, summary: { positions: positions.length, attention: attention.length } };
}

// ── Service catalog ────────────────────────────────────────────────────────
// The dashboard's "what you can do" grid + the nav. Live surfaces render as links; "soon" ones render
// disabled (honest — no fake entry points). Lend/borrow flip to live at P3/P4 (Mango).
export interface Service {
  id: "swap" | "stake" | "lend" | "borrow" | "liquidity";
  label: string;
  blurb: string;
  live: boolean;
}

export const SERVICES: Service[] = [
  { id: "swap", label: "Swap", blurb: "USDC ⇄ SOL & more, on Solana DEXs", live: true },
  { id: "stake", label: "Stake", blurb: "Earn staking yield via Marinade", live: true },
  { id: "lend", label: "Lend", blurb: "Supply SOL to Mango, earn lending yield", live: true },
  { id: "borrow", label: "Borrow", blurb: "Borrow against your Solana collateral", live: false },
  { id: "liquidity", label: "Liquidity", blurb: "Provide & earn LP fees", live: false },
];
