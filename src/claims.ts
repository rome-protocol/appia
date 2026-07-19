/**
 * Claim center — recoverability reconstructed FROM CHAIN. Self-custody keeps every asset in the user's
 * OWN Rome PDA/ATA (or a fixed-recipient VAA), so their on-chain balances ARE the durable record of
 * where a journey got to — no browser state needed. buildClaims maps those balances to recoverable
 * positions: for each, the leg to resume from and whether it can be delivered home today (the asset's
 * egress wrapper allowlisted). The on-chain reads live in the scanner; this stays pure + testable.
 *
 * States mirror src/journey.ts CLAIM_STATE: an asset sitting mid-journey in the PDA is "funds-in-pda";
 * a staked (kept) position is "position-held".
 */
import type { Address } from "viem";
import { bytes32ToPublicKey, deriveAta, deriveRomeUserPda, pubkeyBs58ToBytes32 } from "./rome/solana-pda";
import { ROME_CHAIN } from "./rome/rome-config";
import type { PendingRedeem } from "./bring-home";

export type ClaimAsset = "usdc" | "wsol" | "sol" | "msol";

export interface ClaimObservation {
  usdc6: bigint; // delivered USDC (wrapper) balance, 6dp
  wsol9: bigint; // wSOL (wrapper) balance, 9dp
  lamports: bigint; // native SOL on the user's Rome PDA (9dp)
  msol9: bigint; // mSOL (wrapper) balance, 9dp
}

export interface ClaimItem {
  asset: ClaimAsset;
  amount: bigint; // native decimals of the asset
  decimals: number;
  claimState: string; // journey.ts CLAIM_STATE value
  resumeLeg: string | null; // journey leg to resume from; null when terminal (a held position)
  canBringHome: boolean; // deliver-home executable today (asset's egress wrapper allowlisted)
}

/** Native lamports below this are the rent buffer a completed journey leaves behind — not a position. */
export const DUST_LAMPORTS = 10_000_000n; // 0.01 SOL (> the ~5M stake rent buffer)

/** Which assets can be delivered home TODAY. wSOL is allowlisted on v11; native SOL rides the wSOL
 *  wrapper (wrap→egress); USDC goes home via CCTP. mSOL's wrapper is NOT yet allowlisted (D2). */
const DEFAULT_ALLOWLISTED: Record<ClaimAsset, boolean> = { usdc: true, wsol: true, sol: true, msol: false };

export function buildClaims(
  obs: ClaimObservation,
  opts: { dustLamports?: bigint; allowlisted?: Partial<Record<ClaimAsset, boolean>> } = {},
): ClaimItem[] {
  const dust = opts.dustLamports ?? DUST_LAMPORTS;
  const allow = { ...DEFAULT_ALLOWLISTED, ...opts.allowlisted };
  const items: ClaimItem[] = [];

  // Ordered by journey progress so a mid-journey wallet reads front-to-back.
  if (obs.usdc6 > 0n)
    items.push({ asset: "usdc", amount: obs.usdc6, decimals: 6, claimState: "funds-in-pda", resumeLeg: "swap", canBringHome: allow.usdc });
  if (obs.wsol9 > 0n)
    items.push({ asset: "wsol", amount: obs.wsol9, decimals: 9, claimState: "funds-in-pda", resumeLeg: "unwrap", canBringHome: allow.wsol });
  if (obs.lamports > dust)
    items.push({ asset: "sol", amount: obs.lamports, decimals: 9, claimState: "funds-in-pda", resumeLeg: "stake", canBringHome: allow.sol });
  if (obs.msol9 > 0n)
    items.push({ asset: "msol", amount: obs.msol9, decimals: 9, claimState: "position-held", resumeLeg: null, canBringHome: allow.msol });

  return items;
}

// ── On-chain scanner ─────────────────────────────────────────────────────────
// Self-custody means the chain is the durable record; reconstruct straight from the user's balances.
type SolRpc = <T>(method: string, params: unknown[]) => Promise<T>;

const defaultSolRpc: SolRpc = async (method, params) => {
  const r = await fetch("/api/rpc/solana", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error(`solana ${method}: ${JSON.stringify(j.error)}`);
  return j.result as never;
};

const userAta = (address: Address, mintB58: string): string =>
  bytes32ToPublicKey(deriveAta(deriveRomeUserPda(address), pubkeyBs58ToBytes32(mintB58))).toBase58();

async function ataAmount(rpc: SolRpc, address: Address, mintB58: string): Promise<bigint> {
  try {
    const b = await rpc<{ value: { amount: string } }>("getTokenAccountBalance", [userAta(address, mintB58)]);
    return BigInt(b.value.amount);
  } catch {
    return 0n; // missing ATA reads as no balance
  }
}

/** Read the user's OWN Rome balances — their PDA-ATAs (wUSDC/wSOL/mSOL) + native PDA lamports. The
 *  durable, browserless source of truth for a journey's state. `solRpc` is injectable (tests + a node
 *  harness on the absolute RPC; the browser default proxies /api/rpc/solana). */
export async function observeChain(address: Address, opts: { solRpc?: SolRpc } = {}): Promise<ClaimObservation> {
  const rpc = opts.solRpc ?? defaultSolRpc;
  const pda = bytes32ToPublicKey(deriveRomeUserPda(address)).toBase58();
  const [usdc6, wsol9, msol9, bal] = await Promise.all([
    ataAmount(rpc, address, ROME_CHAIN.usdcMint),
    ataAmount(rpc, address, ROME_CHAIN.wsolMint),
    ataAmount(rpc, address, ROME_CHAIN.msolMint),
    rpc<{ value: number }>("getBalance", [pda]),
  ]);
  return { usdc6, wsol9, lamports: BigInt(bal.value), msol9 };
}

/** Scan an address → its recoverable positions, reconstructed entirely from chain. */
export async function scanClaims(
  address: Address,
  opts: { solRpc?: SolRpc; dustLamports?: bigint; allowlisted?: Partial<Record<ClaimAsset, boolean>> } = {},
): Promise<ClaimItem[]> {
  return buildClaims(await observeChain(address, opts), opts);
}

// ── Display ──────────────────────────────────────────────────────────────────
export interface ClaimAction {
  kind: "resume" | "bring-home" | "redeem";
  label: string;
  enabled: boolean;
}
export interface ClaimView {
  title: string;
  detail: string;
  amountLabel: string;
  actions: ClaimAction[];
}

/** Bring-home is offered on every position but only ENABLED when the asset's egress wrapper is listed on
 *  the bridge. When it isn't, the label says so HONESTLY: it's a one-time GLOBAL bridge listing (enables
 *  the asset for everyone), never the user's own permission "pending" — the funds are self-custodied
 *  throughout. */
function bringHome(item: ClaimItem): ClaimAction {
  return item.canBringHome
    ? { kind: "bring-home", label: "Bring home", enabled: true }
    : { kind: "bring-home", label: "Bring home — enables when listed on the bridge", enabled: false };
}

const ASSET_SYMBOL: Record<ClaimAsset, string> = { usdc: "USDC", wsol: "SOL", sol: "SOL", msol: "mSOL" };

function fmtAmount(amount: bigint, decimals: number, show = 6): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals).slice(0, show)}`;
}

const RESUME_COPY: Record<string, { title: string; detail: string; label: string }> = {
  swap: { title: "USDC delivered", detail: "In your own Rome account, ready to swap to SOL.", label: "Resume — swap → stake" },
  unwrap: { title: "SOL bought", detail: "Wrapped SOL in your own account, ready to unwrap + stake.", label: "Resume — unwrap → stake" },
  stake: { title: "SOL unwrapped", detail: "Native SOL in your own account, ready to stake.", label: "Resume — stake" },
};

/** Map a recoverable position to display copy + its one recovery action. A held mSOL position keeps
 *  earning and can be brought home anytime (gated only by the asset allowlist); a mid-journey position
 *  resumes from its remaining legs. Pure — the page renders it, the executor wires the action. */
export function claimView(item: ClaimItem): ClaimView {
  const amountLabel = `${fmtAmount(item.amount, item.decimals)} ${ASSET_SYMBOL[item.asset]}`;
  if (item.asset === "msol") {
    // Honest framing (answers "why does another wallet gate my funds?"): the mSOL is fully self-custodied
    // in the user's own account. Bringing it home as mSOL turns on with a ONE-TIME, GLOBAL bridge listing
    // (enables the asset for everyone) — never a per-wallet gate, and it never gives anyone control of the
    // funds. When enabled, the detail reflects that; when not, it explains the listing without alarm.
    const detail = item.canBringHome
      ? "Staked in your own account — fully self-custodied. Keep earning, or bring it home to your wallet anytime; your funds stay in your control throughout."
      : "Staked in your own account — fully self-custodied, always in your control. Bringing it home as mSOL switches on with a one-time bridge listing (a global setting that enables mSOL for everyone, never a per-wallet gate).";
    return { title: "mSOL — earning on Rome", detail, amountLabel, actions: [bringHome(item)] };
  }
  const c = RESUME_COPY[item.resumeLeg ?? ""] ?? { title: ASSET_SYMBOL[item.asset], detail: "", label: "Resume" };
  // mid-journey funds → the user's choice: finish the journey, OR claw this asset back home now.
  return { title: c.title, detail: c.detail, amountLabel, actions: [{ kind: "resume", label: c.label, enabled: true }, bringHome(item)] };
}

/** EVM chain id → display name (the dests we can redeem on). */
const DEST_CHAIN_NAME: Record<number, string> = {
  11155111: "Sepolia", 421614: "Arbitrum Sepolia", 84532: "Base Sepolia", 43113: "Avalanche Fuji", 80002: "Polygon Amoy",
};

/** A pending redeem is an IN-FLIGHT bring-home: the asset already left Rome (burned to Wormhole) and is
 *  waiting for completeTransfer on the dest L2. It never shows in the balance scan (the ATA is empty), so
 *  the scanner surfaces it separately with one action — finish the delivery (redeem the VAA). */
export function pendingRedeemView(pr: PendingRedeem): ClaimView {
  const symbol = pr.tokenAddressHex.toLowerCase() === pubkeyBs58ToBytes32(ROME_CHAIN.msolMint).toLowerCase() ? "mSOL" : "SOL";
  const where = DEST_CHAIN_NAME[pr.destChainId] ?? `chain ${pr.destChainId}`;
  return {
    title: "Delivery on the way",
    detail: `Left Rome and waiting to land in your wallet on ${where}. Finish it anytime — the funds are safe as a signed transfer.`,
    amountLabel: `≈ ${fmtAmount(pr.amount, 8)} ${symbol}`, // Wormhole normalizes transfer amounts to 8dp
    actions: [{ kind: "redeem", label: `Finish delivery to ${where}`, enabled: true }],
  };
}
