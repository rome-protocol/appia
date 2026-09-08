/**
 * v11 native Wormhole egress — the "Deliver to my wallet" terminal.
 *
 * Two session-signed calls (RomeBridgeWithdraw address resolved from the
 * registry at runtime — see rome-config):
 *   1. approve_spl(bridge, amount, mint) on HelperProgram 0xff..09 — the USER
 *      grants RomeBridgeWithdraw delegate rights over their SPL. v10 pulls the
 *      wrapper's underlying SPL as the user's delegate (external_auth(bridge)
 *      signs; SPL Token accepts owner OR delegate), so the grant is the user's
 *      own tx, never a call on the bridge.
 *   2. transferNativeToWormhole(wrapper, amount, recipient32, targetChain) on
 *      RomeBridgeWithdraw — Solana-native mint (mSOL/wSOL) → Token Bridge
 *      custody + transfer VAA.
 * The recipient redeems on their L2 (permissionless completeTransfer).
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { pubkeyBs58ToBytes32 } from "./rome/solana-pda.js";

export const HELPER_PROGRAM = "0xff00000000000000000000000000000000000009" as Address;

const HELPER_ABI = [
  { type: "function", name: "approve_spl", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint64" }, { name: "mint", type: "bytes32" }], outputs: [] },
] as const;

const ABI = [
  { type: "function", name: "transferNativeToWormhole", stateMutability: "nonpayable",
    inputs: [
      { name: "assetWrapper", type: "address" }, { name: "amount", type: "uint256" },
      { name: "recipient", type: "bytes32" }, { name: "targetChain", type: "uint16" },
    ], outputs: [] },
] as const;

/** EVM chain id → Wormhole chain id. Monad testnet has no token bridge → absent. */
export const WORMHOLE_CHAIN_IDS = {
  sepolia: 10002,
  arbitrumSepolia: 10003,
  baseSepolia: 10004,
  avalancheFuji: 6,
  polygonAmoy: 10007,
} as const;

export function evmRecipient32(addr: string): Hex {
  return ("0x" + "00".repeat(12) + addr.replace(/^0x/, "").toLowerCase()) as Hex;
}

const U64_MAX = 2n ** 64n - 1n;

/** The user's delegate grant to the bridge: approve_spl(bridge, amount, mint) — 0xabf6f675. */
export function encodeApproveSplGrant(bridge: Address | string, amount: bigint, mintB58: string): Hex {
  if (amount < 0n || amount > U64_MAX) throw new Error(`approve_spl amount ${amount} does not fit uint64`);
  return encodeFunctionData({ abi: HELPER_ABI, functionName: "approve_spl", args: [bridge as Address, amount, pubkeyBs58ToBytes32(mintB58) as Hex] });
}

export function encodeTransferNativeToWormhole(wrapper: Address | string, amount: bigint, recipient32: Hex, targetChain: number): Hex {
  return encodeFunctionData({ abi: ABI, functionName: "transferNativeToWormhole", args: [wrapper as Address, amount, recipient32, targetChain] });
}
