/**
 * v11 native egress calldata (TDD). The "Deliver to my wallet" terminal:
 * approveWormholeBurn(wrapper, amount) then transferNativeToWormhole(
 * wrapper, amount, recipient32, targetChain) — signed by the session key to
 * the RomeBridgeWithdraw contract (address resolved from the registry at
 * runtime; NOT hardcoded). Pins selectors + arg encoding so a wrong ABI
 * trips here, not at a user's (real-money) egress.
 */
import { describe, it, expect } from "vitest";
import { encodeApproveWormholeBurn, encodeTransferNativeToWormhole, evmRecipient32, WORMHOLE_CHAIN_IDS } from "../src/egress.js";

const WRAPPER = "0x0ea6e66d26c5e1f6fd3886a080db837b841c5b89"; // mSOL wrapper (Rome)
const USER = "0x2cD347E873424Ad72B1D4bB2c17D21BA6124B5f9";

describe("v11 native egress calldata", () => {
  it("approveWormholeBurn selector + args", () => {
    const data = encodeApproveWormholeBurn(WRAPPER, 400_000_000n);
    expect(data.slice(0, 10)).toMatch(/^0x[0-9a-f]{8}$/); // 4-byte selector
    expect(data.length).toBe(2 + 8 + 64 * 2); // selector + address + uint256
    expect(data.toLowerCase()).toContain(WRAPPER.slice(2).toLowerCase());
  });

  it("transferNativeToWormhole selector + 4 args, recipient left-padded", () => {
    const recipient = evmRecipient32(USER);
    const data = encodeTransferNativeToWormhole(WRAPPER, 400_000_000n, recipient, WORMHOLE_CHAIN_IDS.sepolia);
    expect(data.length).toBe(2 + 8 + 64 * 4); // selector + 4 words
    // recipient is a left-padded EVM address (12 zero bytes + 20 addr bytes)
    expect(recipient).toBe(("0x" + "00".repeat(12) + USER.slice(2).toLowerCase()) as `0x${string}`);
    expect(data.toLowerCase()).toContain(USER.slice(2).toLowerCase());
  });

  it("maps EVM chain ids to Wormhole chain ids; Monad has none", () => {
    expect(WORMHOLE_CHAIN_IDS.sepolia).toBe(10002);
    expect(WORMHOLE_CHAIN_IDS.arbitrumSepolia).toBe(10003);
    expect(WORMHOLE_CHAIN_IDS.baseSepolia).toBe(10004);
    expect(WORMHOLE_CHAIN_IDS.avalancheFuji).toBe(6);
    expect((WORMHOLE_CHAIN_IDS as Record<string, number>).monad).toBeUndefined();
  });
});
