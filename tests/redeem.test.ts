/**
 * Deliver-home REDEEM — the piece that lands the Solana asset in the user's L2
 * wallet. After burnToWormhole on Rome (egress), a Wormhole VAA is emitted from
 * the Solana side (emitterChain 1); the recipient (or any relayer) fetches the
 * signed VAA and calls completeTransfer on the destination chain's Wormhole
 * token bridge, which mints the wrapped ERC-20. Permissionless → trustless
 * (self-custody: the user signs only the egress; redeem needs no session key).
 *
 * The prior redeem script lived in a scratchpad and was wiped on compaction —
 * this is the committed, tested replacement. Deterministic pieces here; the
 * on-chain submit + sequence extraction are wired in the driver.
 */
import { describe, it, expect } from "vitest";
import { toFunctionSelector, decodeFunctionData, parseAbi } from "viem";
import { PublicKey } from "@solana/web3.js";
import { wormholescanVaaUrl, completeTransferCalldata, WORMHOLE_TOKEN_BRIDGE, signedVaaFromBase64, solanaTokenBridgeEmitterHex } from "../src/redeem";

describe("redeem — deliver-home to the user's L2 wallet", () => {
  it("Sepolia Wormhole token bridge is the registry-sourced address", () => {
    expect(WORMHOLE_TOKEN_BRIDGE[11155111]).toBe("0xDB5492265f6038831E89f495670FF909aDe94bd9");
  });

  it("builds the wormholescan VAA url by emitter+sequence — TESTNET default (Rome rides devnet)", () => {
    expect(wormholescanVaaUrl(1, "0xabc123", 42n)).toBe("https://api.testnet.wormholescan.io/api/v1/vaas/1/abc123/42");
    expect(wormholescanVaaUrl(1, "0xabc123", 42n, "mainnet")).toBe("https://api.wormholescan.io/api/v1/vaas/1/abc123/42");
  });

  it("derives the testnet Solana token-bridge emitter (proven 2026-07-08 = 4yttKWzR…)", () => {
    const hex = solanaTokenBridgeEmitterHex();
    expect(hex).toHaveLength(64);
    // 4yttKWzRoNYS2HekxDfcZYmfQqnVWpKiJ8eydYRuFRgs, the emitter that emitted seq 56879
    expect(new PublicKey(Buffer.from(hex, "hex")).toBase58()).toBe("4yttKWzRoNYS2HekxDfcZYmfQqnVWpKiJ8eydYRuFRgs");
  });

  it("completeTransfer calldata = correct selector + round-trips the VAA bytes", () => {
    const data = completeTransferCalldata("0xdeadbeef");
    expect(data.startsWith(toFunctionSelector("function completeTransfer(bytes encodedVm)"))).toBe(true);
    const { args } = decodeFunctionData({ abi: parseAbi(["function completeTransfer(bytes encodedVm)"]), data });
    expect(args[0]).toBe("0xdeadbeef");
  });

  it("decodes a base64 VAA (wormholescan shape) to 0x-hex bytes", () => {
    const b64 = Buffer.from("0102ff", "hex").toString("base64");
    expect(signedVaaFromBase64(b64)).toBe("0x0102ff");
  });
});
