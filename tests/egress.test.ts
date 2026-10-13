/**
 * v11 native egress calldata (TDD). The "Deliver to my wallet" terminal:
 * approveWormholeBurn(wrapper, amount) then transferNativeToWormhole(
 * wrapper, amount, recipient32, targetChain) — signed by the session key to
 * the RomeBridgeWithdraw contract (address resolved from the registry at
 * runtime; NOT hardcoded). Pins selectors + arg encoding so a wrong ABI
 * trips here, not at a user's (real-money) egress.
 */
import { describe, it, expect } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { HELPER_PROGRAM, encodeApproveSplGrant, encodeTransferNativeToWormhole, evmRecipient32, WORMHOLE_CHAIN_IDS } from "../src/egress.js";
import { pubkeyBs58ToBytes32 } from "../src/rome/solana-pda.js";

const WRAPPER = "0x0ea6e66d26c5e1f6fd3886a080db837b841c5b89"; // mSOL wrapper (Rome)
const USER = "0x2cD347E873424Ad72B1D4bB2c17D21BA6124B5f9";

describe("v11 native egress calldata", () => {
  // RomeBridgeWithdraw v10 pulls the user's SPL as the user's DELEGATE. The user
  // grants that with their own tx to HelperProgram (0xff..09):
  //   approve_spl(address spender, uint64 amount, bytes32 mint) — 0xabf6f675
  // spender = the bridge, amount in the mint's units, mint = the wrapper's SPL mint.
  it("approve_spl grant: HelperProgram target, selector 0xabf6f675, (bridge, u64 amount, mint) args", () => {
    const BRIDGE = "0x65fc94ba1045b65889f0b27d3d02e5bfbc2aee03";
    const MSOL = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
    expect(HELPER_PROGRAM.toLowerCase()).toBe("0xff00000000000000000000000000000000000009");
    const data = encodeApproveSplGrant(BRIDGE, 400_000_000n, MSOL);
    expect(data.slice(0, 10)).toBe("0xabf6f675");
    const { functionName, args } = decodeFunctionData({
      abi: parseAbi(["function approve_spl(address spender, uint64 amount, bytes32 mint)"]), data,
    });
    expect(functionName).toBe("approve_spl");
    expect((args[0] as string).toLowerCase()).toBe(BRIDGE);
    expect(args[1]).toBe(400_000_000n);
    expect((args[2] as string).toLowerCase()).toBe(pubkeyBs58ToBytes32(MSOL).toLowerCase());
  });
  it("approve_spl grant refuses an amount above uint64", () => {
    expect(() => encodeApproveSplGrant("0x65fc94ba1045b65889f0b27d3d02e5bfbc2aee03", 2n ** 64n, "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So")).toThrow(/uint64/);
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
