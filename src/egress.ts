/**
 * v11 native Wormhole egress — the "Deliver to my wallet" terminal.
 *
 * Two session-signed calls to RomeBridgeWithdraw (address resolved from the
 * registry at runtime — see rome-config; the live pointer flips v10→v11 when
 * the registry bump lands, and this path activates then):
 *   1. approveWormholeBurn(wrapper, amount)        — delegate authority_signer
 *   2. transferNativeToWormhole(wrapper, amount, recipient32, targetChain)
 *      — Solana-native mint (mSOL/wSOL) → Token Bridge custody + transfer VAA
 * The recipient redeems on their L2 (permissionless completeTransfer).
 */
import { encodeFunctionData, type Address, type Hex } from "viem";

const ABI = [
  { type: "function", name: "approveWormholeBurn", stateMutability: "nonpayable",
    inputs: [{ name: "assetWrapper", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
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

export function encodeApproveWormholeBurn(wrapper: Address | string, amount: bigint): Hex {
  return encodeFunctionData({ abi: ABI, functionName: "approveWormholeBurn", args: [wrapper as Address, amount] });
}

export function encodeTransferNativeToWormhole(wrapper: Address | string, amount: bigint, recipient32: Hex, targetChain: number): Hex {
  return encodeFunctionData({ abi: ABI, functionName: "transferNativeToWormhole", args: [wrapper as Address, amount, recipient32, targetChain] });
}
