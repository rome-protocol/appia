/**
 * Bring-home — deliver a Solana position to the user's L2 wallet: egress on Rome (deliverNative) →
 * Wormhole VAA → completeTransfer on the destination L2. This reuses the #15-proven flow (wSOL →
 * Sepolia). `bringHomePlan` is the pure params builder; `findVaaByPayload` locates the egress VAA by
 * its transfer payload (the Wormhole sequence is NOT in the Rome tx — it's Solana-emitted); the
 * orchestrator that signs egress + completeTransfer lives with the UI (it needs the wallet + a
 * chain-switch).
 */
import type { Hex } from "viem";
import { ROME_CHAIN } from "./rome/rome-config";
import { WORMHOLE_CHAIN_IDS } from "./egress";
import {
  WORMHOLE_TOKEN_BRIDGE, WORMHOLESCAN, signedVaaFromBase64,
  solanaTokenBridgeEmitterHex, isTransferCompletedCalldata, decodeIsTransferCompleted,
} from "./redeem";
import { parseTransferVaa, vaaHash } from "./vaa";

export type HomeAsset = "wsol" | "msol";

/** EVM chain id → Wormhole chain id (from egress.WORMHOLE_CHAIN_IDS; registry-backed). */
const WH_ID_BY_CHAIN: Record<number, number> = {
  11155111: WORMHOLE_CHAIN_IDS.sepolia,
  421614: WORMHOLE_CHAIN_IDS.arbitrumSepolia,
  84532: WORMHOLE_CHAIN_IDS.baseSepolia,
  43113: WORMHOLE_CHAIN_IDS.avalancheFuji,
  80002: WORMHOLE_CHAIN_IDS.polygonAmoy,
};

/** EVM chain id ← Wormhole chain id — the inverse, so a VAA's payload toChain maps back to a dest. */
const CHAIN_BY_WH_ID: Record<number, number> = Object.fromEntries(
  Object.entries(WH_ID_BY_CHAIN).map(([evm, wh]) => [wh, Number(evm)]),
);

export interface BringHomePlan {
  wrapper: Hex;
  targetWhChainId: number | null;
  destTokenBridge: Hex | null;
  /** egress AND redeem are both possible for this (asset, dest) — needs a WH id + a completeTransfer bridge. */
  supported: boolean;
}

export function bringHomePlan(asset: HomeAsset, destChainId: number): BringHomePlan {
  let wrapper: Hex;
  if (asset === "wsol") wrapper = ROME_CHAIN.wsolWrapper as Hex;
  else if (asset === "msol") wrapper = ROME_CHAIN.msolWrapper as Hex;
  else throw new Error(`bring-home unsupported for asset ${asset}`);
  const targetWhChainId = WH_ID_BY_CHAIN[destChainId] ?? null;
  const destTokenBridge = WORMHOLE_TOKEN_BRIDGE[destChainId] ?? null;
  return { wrapper, targetWhChainId, destTokenBridge, supported: targetWhChainId !== null && destTokenBridge !== null };
}

/**
 * Find the egress VAA by its transfer payload. The Wormhole sequence isn't in the Rome tx (the VAA is
 * Solana-emitted, chain 1), so we page the emitter's recent VAAs and match on the parsed payload
 * (to == recipient32, toChain == the dest WH id). Polls — guardians take time to attest.
 */
export async function findVaaByPayload(
  emitterHex: string,
  match: { toHex: string; toChain: number },
  opts: { tries?: number; sleep?: (ms: number) => Promise<void>; fetchFn?: typeof fetch; network?: "mainnet" | "testnet"; pageSize?: number } = {},
): Promise<Hex> {
  const tries = opts.tries ?? 40;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const doFetch = opts.fetchFn ?? fetch;
  const network = opts.network ?? "testnet";
  const pageSize = opts.pageSize ?? 50;
  const emitter = emitterHex.replace(/^0x/, "");
  const url = `${WORMHOLESCAN[network]}/api/v1/vaas/1/${emitter}?page=0&pageSize=${pageSize}`;
  const wantTo = `0x${match.toHex.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;

  for (let i = 0; i < tries; i++) {
    const r = await doFetch(url).catch(() => null);
    if (r && r.ok) {
      const j = (await r.json()) as { data?: Array<{ vaa?: string }> };
      for (const item of j.data ?? []) {
        if (!item.vaa) continue;
        const signed = signedVaaFromBase64(item.vaa);
        const bytes = Uint8Array.from(Buffer.from(signed.slice(2), "hex"));
        const p = parseTransferVaa(bytes);
        if (p && p.toChain === match.toChain && p.to.toLowerCase() === wantTo) return signed;
      }
    }
    await sleep(15_000);
  }
  throw new Error(`egress VAA not found for ${match.toHex} on WH chain ${match.toChain} after ${tries} tries — funds are safe as a pending VAA; retry`);
}

/** Has this VAA already been redeemed on the dest bridge? The `isTransferCompleted(vaaHash)` read that
 *  both the pending scan AND the pre-submit guard share — so we never build a completeTransfer for a VAA
 *  that's already landed (which reverts "transfer already completed" → the RPC surfaces it as the cryptic
 *  "gas limit too high"). `ethCall` is injectable (the browser's dest-chain client; tests mock it). */
export async function isVaaRedeemed(
  vaaBytes: Uint8Array,
  destChainId: number,
  bridge: Hex,
  ethCall: (chainId: number, to: Hex, data: Hex) => Promise<Hex>,
): Promise<boolean> {
  const ret = await ethCall(destChainId, bridge, isTransferCompletedCalldata(vaaHash(vaaBytes)));
  return decodeIsTransferCompleted(ret);
}

export interface PendingRedeem {
  vaa: Hex; // signed VAA, ready to completeTransfer on the dest bridge
  destChainId: number; // EVM chain id to redeem on
  toChainWh: number; // Wormhole id (payload toChain)
  amount: bigint; // transfer payload amount (Wormhole-normalized to 8dp)
  tokenAddressHex: string; // origin Solana mint (32-byte hex) — resolves the symbol
}

/**
 * Detect interrupted bring-homes: egress done (funds burned on Rome, VAA live) but completeTransfer not
 * yet called on the dest L2 — INVISIBLE to the balance scan (the ATA is empty), yet fully recoverable by
 * redeeming the VAA. Pages the Solana token-bridge emitter (chain 1), keeps transfer VAAs addressed TO
 * this user on a dest we can actually redeem on (a known completeTransfer bridge), and drops any already
 * redeemed (isTransferCompleted on the dest bridge — keyed by the VAA replay hash). `ethCall`/`fetchFn`
 * are injectable (tests + the browser's own dest-chain public client).
 *
 * v1 LIMITATION (not silent): pages ONE window of the shared emitter's recent VAAs, so a pending redeem
 * older than `pageSize` transfers back can be missed. Widen pageSize or index by recipient when volume
 * grows; today the emitter is low-traffic so the recent window covers real interrupted deliveries.
 */
export async function scanPendingRedeems(
  userHex: string,
  opts: {
    ethCall: (chainId: number, to: Hex, data: Hex) => Promise<Hex>;
    fetchFn?: typeof fetch;
    network?: "mainnet" | "testnet";
    pageSize?: number;
    emitterHex?: string;
  },
): Promise<PendingRedeem[]> {
  const doFetch = opts.fetchFn ?? fetch;
  const network = opts.network ?? "testnet";
  const pageSize = opts.pageSize ?? 50;
  const emitter = (opts.emitterHex ?? solanaTokenBridgeEmitterHex()).replace(/^0x/, "");
  const wantTo = `0x${userHex.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
  const url = `${WORMHOLESCAN[network]}/api/v1/vaas/1/${emitter}?page=0&pageSize=${pageSize}`;

  const r = await doFetch(url).catch(() => null);
  if (!r || !r.ok) return [];
  const j = (await r.json()) as { data?: Array<{ vaa?: string }> };

  const out: PendingRedeem[] = [];
  for (const item of j.data ?? []) {
    if (!item.vaa) continue;
    const signed = signedVaaFromBase64(item.vaa);
    const bytes = Uint8Array.from(Buffer.from(signed.slice(2), "hex"));
    const p = parseTransferVaa(bytes);
    if (!p || p.to.toLowerCase() !== wantTo) continue;
    const destChainId = CHAIN_BY_WH_ID[p.toChain];
    const bridge = destChainId != null ? WORMHOLE_TOKEN_BRIDGE[destChainId] : undefined;
    if (destChainId == null || !bridge) continue; // no completeTransfer bridge → can't redeem there
    if (await isVaaRedeemed(bytes, destChainId, bridge, opts.ethCall)) continue; // already landed
    out.push({ vaa: signed, destChainId, toChainWh: p.toChain, amount: p.amount, tokenAddressHex: p.tokenAddress });
  }
  return out;
}
