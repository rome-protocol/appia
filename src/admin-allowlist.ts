/**
 * Owner-gated Wormhole asset allowlist — the UI path for enabling an asset's native egress
 * (`setWormholeAssetAllowed` on RomeBridgeWithdraw, `onlyOwner`). Instead of a raw `cast send` + private
 * key, the contract owner connects their wallet and SIGNS the setter (self-custody — consistent with the
 * rest of Appia). Pure helpers here; the /admin page reads state + sends the signed write on Rome.
 */
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { ROME_CHAIN } from "./rome/rome-config";

export const WITHDRAW_ABI = parseAbi([
  "function setWormholeAssetAllowed(address assetWrapper, bool allowed)",
  "function wormholeAssetAllowed(address assetWrapper) view returns (bool)",
  "function owner() view returns (address)",
]);

export interface AllowlistAsset {
  symbol: string;
  wrapper: Hex;
}

/** Appia's bridgeable assets + their egress wrappers (from chain config). wSOL is already allowlisted on
 *  v11; mSOL is the one this surface enables. Extends automatically as chain config gains wrappers. */
export const ALLOWLIST_ASSETS: AllowlistAsset[] = [
  { symbol: "wSOL", wrapper: ROME_CHAIN.wsolWrapper as Hex },
  { symbol: "mSOL", wrapper: ROME_CHAIN.msolWrapper as Hex },
];

export function setWormholeAssetAllowedCalldata(wrapper: Hex, allowed: boolean): Hex {
  return encodeFunctionData({ abi: WITHDRAW_ABI, functionName: "setWormholeAssetAllowed", args: [wrapper, allowed] });
}

export function decodeAllowed(ret: Hex): boolean {
  return decodeFunctionResult({ abi: WITHDRAW_ABI, functionName: "wormholeAssetAllowed", data: ret }) as boolean;
}

/** Case-insensitive owner match — only the owner may set the allowlist. */
export function isOwner(connected: string | undefined, owner: string | undefined): boolean {
  return !!connected && !!owner && connected.toLowerCase() === owner.toLowerCase();
}

/** /admin is a BRIDGE-OPS page, not a user view — it manages shared bridge config, not anyone's funds.
 *  This gate keeps it from masquerading as a personal page: only the proven owner sees actionable
 *  controls; a connected non-owner sees a read-only ops notice ("not your page, doesn't touch your
 *  funds"); a disconnected visitor is prompted to connect the owner wallet. Defaults to not-owner
 *  whenever ownership isn't proven (owner unread) — never shows actions on an unproven match. */
export type AdminViewMode = "disconnected" | "not-owner" | "owner";

export function adminViewMode(connected: string | undefined, owner: string | undefined): AdminViewMode {
  if (!connected) return "disconnected";
  return isOwner(connected, owner) ? "owner" : "not-owner";
}

/** How an asset row renders — keeps the label logic out of the JSX and testable. Three kinds so a
 *  non-owner never sees a "not allowed" button (that read as the asset's STATUS, conflated with the row
 *  itself); they get an explicit owner-gated status instead. */
export type AssetRowState =
  | { kind: "allowed" } //                 already allowlisted → done marker, no button
  | { kind: "action"; label: string } //   owner + not allowed → the Allowlist button
  | { kind: "status"; label: string }; //  non-owner + not allowed → why-disabled status, no button

export function assetRowState(p: { allowed: boolean; owns: boolean; symbol: string; running: boolean; phase?: string | null }): AssetRowState {
  if (p.allowed) return { kind: "allowed" };
  if (!p.owns) return { kind: "status", label: "not allowlisted · owner only" };
  return { kind: "action", label: p.running ? (p.phase ?? "Working…") : `Allowlist ${p.symbol}` };
}
