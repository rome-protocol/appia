/**
 * Activity view-model — maps chain-reconstructed claim data into the log rows the
 * Activity page renders. Today's real, honest content: IN-FLIGHT bring-homes (pending redeems), PARTIAL
 * journeys (mid-journey funds to resume), and held positions as DONE rows. Full historical done-events
 * (past swaps/completed stakes) need a tx indexer — not modeled here. Each row has a status, a type, an
 * amount label, an expandable story of legs, and (for actionable rows) one finish/resume action.
 */
import type { ClaimItem, ClaimAsset } from "./claims";
import type { PendingRedeem } from "./bring-home";

export type ActivityStatus = "in-flight" | "partial" | "done";
export type ActivityType = "swap" | "stake" | "lend" | "borrow" | "bridge" | "bring-home";
export type LegStatus = "done" | "now" | "pending";

export interface ActivityLeg {
  n: string; // Roman numeral
  title: string;
  sub?: string;
  status: LegStatus;
}
export interface ActivityAction {
  kind: "resume" | "redeem" | "bring-home";
  label: string;
  eta: string;
}
export interface ActivityRow {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  title: string;
  sub: string;
  amountLabel: string;
  legs: ActivityLeg[];
  action?: ActivityAction;
}

const SYMBOL: Record<ClaimAsset, string> = { usdc: "USDC", wsol: "SOL", sol: "SOL", msol: "mSOL" };
const ROMAN = ["I", "II", "III", "IV", "V"];

function fmt(amount: bigint, decimals: number, show = 6): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals).slice(0, show)}`;
}

/** The inbound journey legs, in order. A partial's resumeLeg marks the current (paused/now) leg; earlier
 *  legs are done, later legs pending. */
const JOURNEY: { leg: string; title: string; sub: string }[] = [
  { leg: "burn", title: "Left your chain", sub: "USDC burned on your L2 · your signature" },
  { leg: "delivered", title: "Arrived on Solana", sub: "Circle attested · minted to your own account" },
  { leg: "swap", title: "Swap to SOL", sub: "on Meteora" },
  { leg: "unwrap", title: "Unwrap → native SOL", sub: "" },
  { leg: "stake", title: "Stake with Marinade → mSOL", sub: "" },
];

function partialLegs(resumeLeg: string | null): ActivityLeg[] {
  const idx = JOURNEY.findIndex((j) => j.leg === resumeLeg);
  return JOURNEY.map((j, i) => ({
    n: ROMAN[i]!,
    title: j.title,
    sub: j.sub || undefined,
    status: i < idx ? "done" : i === idx ? "now" : "pending",
  }));
}

export function buildActivity(claims: ClaimItem[], pendings: PendingRedeem[]): ActivityRow[] {
  const rows: ActivityRow[] = [];

  // in-flight: a bring-home whose egress + VAA are done, redeem pending
  for (const p of pendings) {
    rows.push({
      id: `redeem:${p.vaa.slice(0, 12)}`,
      type: "bring-home",
      status: "in-flight",
      title: "Bring home · SOL",
      sub: "→ your wallet · Wormhole",
      amountLabel: `${fmt(p.amount, 8)} SOL`, // Wormhole normalizes to 8dp
      legs: [
        { n: "I", title: "Sent home from Rome", sub: "egress burned to Wormhole · your signature", status: "done" },
        { n: "II", title: "Guardian attested (VAA)", sub: "Wormhole guardians signed the transfer", status: "done" },
        { n: "III", title: "Redeem on your chain", sub: "one signature — the funds already left Rome", status: "now" },
      ],
      action: { kind: "redeem", label: "Finish delivery", eta: "~60 sec · 1 signature" },
    });
  }

  // partial: mid-journey funds waiting to resume
  for (const c of claims.filter((x) => x.claimState === "funds-in-pda")) {
    rows.push({
      id: `partial:${c.asset}`,
      type: "bridge",
      status: "partial",
      title: `Bridge in · ${SYMBOL[c.asset]} → (swap → stake)`,
      sub: "from your L2 · CCTP",
      amountLabel: `${fmt(c.amount, c.decimals)} ${SYMBOL[c.asset]}`,
      legs: partialLegs(c.resumeLeg),
      action: { kind: "resume", label: `Resume → ${c.resumeLeg}`, eta: "~6 min · from live balances" },
    });
  }

  // done: held positions (settled — a position, shown here as its opening stake)
  for (const c of claims.filter((x) => x.claimState === "position-held")) {
    rows.push({
      id: `held:${c.asset}`,
      type: "stake",
      status: "done",
      title: `Stake · ${SYMBOL[c.asset]}`,
      sub: "Marinade · in your own account",
      amountLabel: `${fmt(c.amount, c.decimals)} ${SYMBOL[c.asset]}`,
      legs: [{ n: "I", title: "Staked with Marinade", sub: "mSOL in your own account", status: "done" }],
      // a held position can be brought home anytime (gated at execution on allowlist + a redeem bridge)
      action: { kind: "bring-home", label: "Bring home", eta: "~6 min · egress + redeem" },
    });
  }

  return rows;
}
