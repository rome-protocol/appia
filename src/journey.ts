/**
 * Journey state machine — strictly sequential legs; every non-terminal
 * state maps to a claim-center state with a one-tx resolution. Pure data;
 * leg *drivers* (network) live elsewhere and call advance() on success.
 */
export type Terminal = "keep" | "deliver";
export type JourneyKind = "swap" | "earn" | "lend";
export type LegStatus = "pending" | "running" | "done";

export interface Leg {
  id: string;
  status: LegStatus;
  txs: string[];
}

export interface Journey {
  journey: JourneyKind;
  terminal: Terminal;
  sourceChainId: number;
  amountUsdc6: bigint;
  legs: Leg[];
}

const EARN_BASE = ["burn", "delivered", "fuel", "swap", "unwrap", "stake"] as const;
const DELIVERY_TAIL = ["egress", "vaa", "redeem"] as const;

export const JOURNEY_LEGS: Record<string, string[]> = {
  "earn-keep": [...EARN_BASE],
  "earn-deliver": [...EARN_BASE, ...DELIVERY_TAIL],
  // swap-keep = inbound → SOL: pay L2 USDC → hold SOL (wSOL) on Rome; no stake, no deliver.
  "swap-keep": ["burn", "delivered", "fuel", "swap"],
  "swap-deliver": ["burn", "delivered", "fuel", "swap", ...DELIVERY_TAIL],
  // lend-keep = buy & supply in one shot: pay L2 USDC → bridge → swap to wSOL → SUPPLY to Mango.
  // No unwrap (Mango takes the wSOL SPL directly); the position is the supplied balance in Mango.
  "lend-keep": ["burn", "delivered", "fuel", "swap", "supply"],
};

/** Claim-center state when a journey is parked with the given leg active. */
const CLAIM_STATE: Record<string, string> = {
  burn: "not-started",
  delivered: "burned-awaiting-delivery",
  fuel: "delivered-awaiting-fuel",
  swap: "funds-in-pda",
  unwrap: "funds-in-pda",
  stake: "funds-in-pda",
  supply: "funds-in-pda",
  egress: "position-held",
  vaa: "burnt-awaiting-vaa",
  redeem: "vaa-unredeemed",
};

export function createJourney(p: {
  journey: JourneyKind;
  terminal: Terminal;
  sourceChainId: number;
  amountUsdc6: bigint;
}): Journey {
  const key = `${p.journey}-${p.terminal}`;
  const ids = JOURNEY_LEGS[key];
  if (!ids) throw new Error(`unknown journey ${key}`);
  return {
    ...p,
    legs: ids.map((id) => ({ id, status: "pending" as LegStatus, txs: [] })),
  };
}

function activeLeg(j: Journey): Leg | undefined {
  return j.legs.find((l) => l.status !== "done");
}

export function advance(j: Journey, p: { legId: string; txs: string[] }): Journey {
  const active = activeLeg(j);
  if (!active || active.id !== p.legId) {
    throw new Error(`${p.legId} is not the active leg (active: ${active?.id ?? "none"})`);
  }
  const legs = j.legs.map((l) => {
    if (l.id === p.legId) return { ...l, status: "done" as LegStatus, txs: [...l.txs, ...p.txs] };
    return l;
  });
  const next = legs.find((l) => l.status !== "done");
  if (next) next.status = "running";
  return { ...j, legs };
}

/** Where a parked journey resumes from, and how the claim center labels it. */
export function resumable(j: Journey): { legId: string; claimState: string } | null {
  const active = activeLeg(j);
  if (!active) return null;
  return { legId: active.id, claimState: CLAIM_STATE[active.id] ?? "unknown" };
}
