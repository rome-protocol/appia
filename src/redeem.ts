/**
 * Deliver-home REDEEM — lands the Solana asset in the user's L2 wallet.
 *
 * After `burnToWormhole` on Rome (egress), a Wormhole token-transfer VAA is
 * emitted from the SOLANA side (emitterChain 1). Anyone (the recipient or a
 * relayer) then fetches the signed VAA and calls `completeTransfer` on the
 * destination chain's Wormhole token bridge, which mints the wrapped ERC-20 to
 * the VAA's `to`. Permissionless → trustless: the user signs only the egress on
 * Rome; the redeem needs no session key.
 *
 * The prior redeem script lived in a scratchpad and was wiped on compaction —
 * this is the committed, tested replacement. VAA payload offsets are pinned in
 * `src/vaa.ts` (to@67 / toChain@99). On-chain submit + Wormhole-sequence
 * extraction from the egress tx are wired by the driver (they need a live tx +
 * a dest-chain gas key); the deterministic primitives live here.
 */
import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { PublicKey } from "@solana/web3.js";

/** Rome rides Solana DEVNET → the TESTNET guardian set / wormholescan. Hitting
 *  the mainnet host silently returns mainnet VAAs (wrong network — cost two
 *  tries on 2026-07-08); testnet is the default. */
export const WORMHOLESCAN = {
  mainnet: "https://api.wormholescan.io",
  testnet: "https://api.testnet.wormholescan.io",
} as const;

/** Solana Wormhole token bridge whose emitter emits the egress VAA. Testnet
 *  (Rome's devnet substrate) is `DZnkkTmC…`; mainnet is `wormDTUJ…` — different
 *  program, different emitter. The emitter is `PDA(["emitter"], tokenBridge)`. */
export const SOLANA_TOKENBRIDGE_TESTNET = "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe";

/** 32-byte hex emitter for the wormholescan lookup (chain 1 = Solana). */
export function solanaTokenBridgeEmitterHex(tokenBridgeBase58: string = SOLANA_TOKENBRIDGE_TESTNET): string {
  const [emitter] = PublicKey.findProgramAddressSync([Buffer.from("emitter")], new PublicKey(tokenBridgeBase58));
  return Buffer.from(emitter.toBytes()).toString("hex");
}

/** Destination Wormhole token bridges (where completeTransfer runs). Sourced
 *  from the registry — `chains/200010-hadrian/bridge.json` lists each dest L2's
 *  Wormhole addresses. Chain-first; extend from the registry, never hand-add. */
export const WORMHOLE_TOKEN_BRIDGE: Record<number, Hex> = {
  11155111: "0xDB5492265f6038831E89f495670FF909aDe94bd9", // Ethereum Sepolia
};

const TOKEN_BRIDGE_ABI = parseAbi([
  "function completeTransfer(bytes encodedVm)",
  "function isTransferCompleted(bytes32 hash) view returns (bool)",
]);

/** wormholescan VAA lookup is by emitter+sequence, NOT txHash (txHash isn't
 *  indexed reliably). emitterChain 1 = Solana for a Rome→L2 native egress. */
export function wormholescanVaaUrl(emitterChain: number, emitterAddressHex: string, sequence: bigint, network: "mainnet" | "testnet" = "testnet"): string {
  const emitter = emitterAddressHex.replace(/^0x/, "");
  return `${WORMHOLESCAN[network]}/api/v1/vaas/${emitterChain}/${emitter}/${sequence}`;
}

/** wormholescan returns the signed VAA base64 at `data.vaa`. */
export function signedVaaFromBase64(b64: string): Hex {
  return `0x${Buffer.from(b64, "base64").toString("hex")}`;
}

/** completeTransfer(encodedVm) calldata for the destination Wormhole token bridge. */
export function completeTransferCalldata(signedVaa: Hex): Hex {
  return encodeFunctionData({ abi: TOKEN_BRIDGE_ABI, functionName: "completeTransfer", args: [signedVaa] });
}

/** isTransferCompleted(hash) calldata — a read on the dest token bridge that tells us whether a VAA has
 *  already been redeemed. `hash` is the VAA replay key (src/vaa.ts vaaHash). Used to drop already-landed
 *  transfers from the pending-redeem scan. */
export function isTransferCompletedCalldata(vaaHash: Hex): Hex {
  return encodeFunctionData({ abi: TOKEN_BRIDGE_ABI, functionName: "isTransferCompleted", args: [vaaHash] });
}

/** Decode an eth_call return for isTransferCompleted → bool. */
export function decodeIsTransferCompleted(ret: Hex): boolean {
  return decodeFunctionResult({ abi: TOKEN_BRIDGE_ABI, functionName: "isTransferCompleted", data: ret }) as boolean;
}

/** Fetch the signed VAA (poll — the guardian set takes time to attest,
 *  bounded by the source chain's finality; Solana emitter → seconds-minutes). */
export async function fetchSignedVaa(
  emitterChain: number,
  emitterAddressHex: string,
  sequence: bigint,
  opts: { tries?: number; sleep?: (ms: number) => Promise<void>; fetchFn?: typeof fetch } = {},
): Promise<Hex> {
  const tries = opts.tries ?? 40;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const doFetch = opts.fetchFn ?? fetch;
  const url = wormholescanVaaUrl(emitterChain, emitterAddressHex, sequence);
  for (let i = 0; i < tries; i++) {
    const r = await doFetch(url).catch(() => null);
    if (r && r.ok) {
      const j = (await r.json()) as { data?: { vaa?: string } };
      if (j.data?.vaa) return signedVaaFromBase64(j.data.vaa);
    }
    await sleep(15_000);
  }
  throw new Error(`VAA not available after ${tries} tries — ${url} (guardians may still be attesting; funds are safe, retry)`);
}
