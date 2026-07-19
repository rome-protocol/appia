/**
 * Bring-home = deliver a Solana position to the user's L2 wallet: egress on Rome (deliverNative) →
 * Wormhole VAA → completeTransfer on the destination L2. bringHomePlan is the pure params builder
 * (wrapper + WH chain id + dest token bridge); a dest is "supported" only when BOTH its WH id and its
 * completeTransfer token bridge are known (redeem can actually run there). findVaaByPayload locates the
 * egress VAA without a sequence (the sequence isn't in the Rome tx — match by the transfer payload).
 */
import { describe, it, expect } from "vitest";
import { bringHomePlan, findVaaByPayload } from "../src/bring-home";
import { ROME_CHAIN } from "../src/rome/rome-config";

describe("bringHomePlan — egress+redeem params", () => {
  it("wSOL → Sepolia: wrapper + WH chain id (10002) + dest token bridge, supported", () => {
    const p = bringHomePlan("wsol", 11155111);
    expect(p.wrapper.toLowerCase()).toBe(ROME_CHAIN.wsolWrapper.toLowerCase());
    expect(p.targetWhChainId).toBe(10002);
    expect(p.destTokenBridge).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(p.supported).toBe(true);
  });

  it("mSOL → Sepolia: uses the mSOL wrapper (dest supported; allowlist gating is separate)", () => {
    const p = bringHomePlan("msol", 11155111);
    expect(p.wrapper.toLowerCase()).toBe(ROME_CHAIN.msolWrapper.toLowerCase());
    expect(p.supported).toBe(true);
  });

  it("dest with a WH id but no known token bridge → NOT supported (redeem can't run)", () => {
    const p = bringHomePlan("wsol", 421614); // arb-sep: WH id known, completeTransfer bridge not yet
    expect(p.targetWhChainId).toBe(10003);
    expect(p.destTokenBridge).toBeNull();
    expect(p.supported).toBe(false);
  });

  it("throws on an asset that can't egress natively", () => {
    expect(() => bringHomePlan("usdc" as never, 11155111)).toThrow(/bring-home|asset/i);
  });
});

describe("findVaaByPayload — locate the egress VAA by its transfer payload (no sequence)", () => {
  // build a wormholescan-shaped list; one VAA matches (to+toChain), others don't
  function vaaB64(to: string, toChain: number, amount: bigint): string {
    const header = Buffer.alloc(6 + 66); header.writeUInt8(1, 0); header.writeUInt8(1, 5);
    const bodyMeta = Buffer.alloc(51); bodyMeta.writeUInt16BE(1, 8); // emitterChain = Solana
    const payload = Buffer.alloc(101); payload.writeUInt8(1, 0);
    payload.writeBigUInt64BE(amount, 1 + 24);
    Buffer.from(to.replace("0x", "").padStart(64, "0"), "hex").copy(payload, 67);
    payload.writeUInt16BE(toChain, 99);
    return Buffer.concat([header, bodyMeta, payload]).toString("base64");
  }
  const USER = "0x3403e0de09bc76ca7d74762f264e4f6b649a0562";

  it("returns the signed VAA whose payload matches to+toChain", async () => {
    const list = {
      data: [
        { vaa: vaaB64("0x00000000000000000000000000000000000000ff", 10002, 1n) }, // wrong recipient
        { vaa: vaaB64(USER, 10002, 42n) },                                       // MATCH
      ],
    };
    const fetchFn = (async () => ({ ok: true, json: async () => list })) as unknown as typeof fetch;
    const vaa = await findVaaByPayload("emitterhex", { toHex: USER, toChain: 10002 }, { fetchFn, tries: 1 });
    expect(vaa.startsWith("0x")).toBe(true);
    // it should be the second (matching) VAA
    expect(vaa).toBe(`0x${Buffer.from(list.data[1]!.vaa, "base64").toString("hex")}`);
  });

  it("throws after exhausting tries when no VAA matches (funds still safe as a pending VAA)", async () => {
    const list = { data: [{ vaa: vaaB64("0x00000000000000000000000000000000000000ff", 10002, 1n) }] };
    const fetchFn = (async () => ({ ok: true, json: async () => list })) as unknown as typeof fetch;
    await expect(
      findVaaByPayload("emitterhex", { toHex: USER, toChain: 10002 }, { fetchFn, tries: 2, sleep: async () => {} }),
    ).rejects.toThrow(/VAA/i);
  });
});
