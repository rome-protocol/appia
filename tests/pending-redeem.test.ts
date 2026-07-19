/**
 * VAA/redeem detection — the recoverability gap the balance scan can't see. Once a bring-home egresses,
 * the funds LEAVE the user's Rome ATA (burned to the Wormhole token bridge) and a transfer VAA is
 * emitted from the Solana emitter (chain 1). If the user stops before calling completeTransfer on the
 * dest L2, observeChain shows nothing — but the funds are live and recoverable by redeeming the VAA.
 * scanPendingRedeems pages the emitter, keeps VAAs addressed TO the user on a dest we can redeem on, and
 * drops any already completed (isTransferCompleted on the dest bridge). vaaHash is the replay key that
 * check takes: keccak256(keccak256(body)) — the SIGNATURES are excluded (a whole-VAA hash is the classic
 * bug and would never match on-chain).
 */
import { describe, it, expect } from "vitest";
import { keccak256, type Hex } from "viem";
import { vaaHash } from "../src/vaa";
import { isTransferCompletedCalldata, decodeIsTransferCompleted, WORMHOLE_TOKEN_BRIDGE } from "../src/redeem";
import { scanPendingRedeems, isVaaRedeemed } from "../src/bring-home";
import { pendingRedeemView } from "../src/claims";
import { pubkeyBs58ToBytes32 } from "../src/rome/solana-pda";
import { ROME_CHAIN } from "../src/rome/rome-config";

const USER = "0x3403e0de09bc76ca7d74762f264e4f6b649a0562";

/** Build a wormholescan-shaped signed VAA (transfer payload) with a controllable signature block so we
 *  can prove vaaHash ignores the sigs. Mirrors src/vaa.ts offsets (body @ 6+66*sigCount, payload @ +51). */
function buildVaa({ to, toChain, amount = 1n, tokenHex = "", sigFill = 0 }: {
  to: string; toChain: number; amount?: bigint; tokenHex?: string; sigFill?: number;
}): Uint8Array {
  const header = Buffer.alloc(6 + 66);
  header.writeUInt8(1, 0); // version
  header.writeUInt8(1, 5); // sigCount = 1
  header.fill(sigFill, 6); // the 66 signature bytes (varied → prove body-only hashing)
  const bodyMeta = Buffer.alloc(51);
  bodyMeta.writeUInt16BE(1, 8); // emitterChain = Solana
  const payload = Buffer.alloc(101);
  payload.writeUInt8(1, 0); // payload type 1 = transfer
  payload.writeBigUInt64BE(amount, 1 + 24); // low 8 bytes of the 32-byte amount field
  if (tokenHex) Buffer.from(tokenHex.replace(/^0x/, "").padStart(64, "0"), "hex").copy(payload, 33);
  payload.writeUInt16BE(1, 65); // tokenChain = Solana
  Buffer.from(to.replace(/^0x/, "").padStart(64, "0"), "hex").copy(payload, 67);
  payload.writeUInt16BE(toChain, 99);
  return Uint8Array.from(Buffer.concat([header, bodyMeta, payload]));
}
const b64 = (v: Uint8Array) => Buffer.from(v).toString("base64");
const boolRet = (b: boolean): Hex => ("0x" + "0".repeat(63) + (b ? "1" : "0")) as Hex;

describe("vaaHash — Wormhole replay hash (double-keccak of the body, signatures excluded)", () => {
  it("is a 32-byte hex", () => {
    expect(vaaHash(buildVaa({ to: USER, toChain: 10002 }))).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("ignores the signature bytes — hashes the BODY, not the whole VAA", () => {
    const a = vaaHash(buildVaa({ to: USER, toChain: 10002, sigFill: 0x00 }));
    const b = vaaHash(buildVaa({ to: USER, toChain: 10002, sigFill: 0xff }));
    expect(a).toBe(b);
  });
  it("changes when the body changes", () => {
    const a = vaaHash(buildVaa({ to: USER, toChain: 10002, amount: 1n }));
    const b = vaaHash(buildVaa({ to: USER, toChain: 10002, amount: 2n }));
    expect(a).not.toBe(b);
  });
  it("equals keccak256(keccak256(body)) at the correct body offset (double, not single)", () => {
    const vaa = buildVaa({ to: USER, toChain: 10002 });
    const body = Uint8Array.from(Buffer.from(vaa).subarray(6 + 66));
    expect(vaaHash(vaa)).toBe(keccak256(keccak256(body)));
  });
});

describe("isTransferCompleted calldata / decode", () => {
  const hash = ("0x" + "ab".repeat(32)) as Hex;
  it("encodes the hash as the sole bytes32 arg (selector + 32 bytes)", () => {
    const cd = isTransferCompletedCalldata(hash);
    expect(cd.length).toBe(2 + 8 + 64);
    expect(cd.toLowerCase().endsWith("ab".repeat(32))).toBe(true);
  });
  it("decodes the bool return", () => {
    expect(decodeIsTransferCompleted(boolRet(true))).toBe(true);
    expect(decodeIsTransferCompleted(boolRet(false))).toBe(false);
  });
});

describe("scanPendingRedeems — interrupted bring-homes (egress done, redeem pending)", () => {
  const bridge = WORMHOLE_TOKEN_BRIDGE[11155111]!;
  function mockFetch(vaas: string[], captured?: { url?: string }) {
    return (async (url: string) => {
      if (captured) captured.url = url;
      return { ok: true, json: async () => ({ data: vaas.map((v) => ({ vaa: v })) }) };
    }) as unknown as typeof fetch;
  }
  // ethCall stand-in: returns completed=true for hashes in `done`; records the calls it received.
  function mockEthCall(done = new Set<string>(), calls?: Array<{ chainId: number; to: string; data: string }>) {
    return async (chainId: number, to: Hex, data: Hex): Promise<Hex> => {
      calls?.push({ chainId, to, data });
      const hash = ("0x" + data.slice(-64)).toLowerCase();
      return boolRet(done.has(hash));
    };
  }
  const emitterHex = "de".repeat(32);

  it("surfaces a VAA addressed to the user on a supported dest that is NOT yet redeemed", async () => {
    const vaa = buildVaa({ to: USER, toChain: 10002, amount: 7431520n, tokenHex: pubkeyBs58ToBytes32(ROME_CHAIN.wsolMint) });
    const calls: Array<{ chainId: number; to: string; data: string }> = [];
    const pending = await scanPendingRedeems(USER, { fetchFn: mockFetch([b64(vaa)]), ethCall: mockEthCall(new Set(), calls), emitterHex });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ destChainId: 11155111, amount: 7431520n });
    expect(pending[0]!.vaa.startsWith("0x")).toBe(true);
    // it checked isTransferCompleted on the right chain + the dest token bridge
    expect(calls[0]!.chainId).toBe(11155111);
    expect(calls[0]!.to.toLowerCase()).toBe(bridge.toLowerCase());
  });

  it("drops a VAA that has already been redeemed (isTransferCompleted → true)", async () => {
    const vaa = buildVaa({ to: USER, toChain: 10002 });
    const done = new Set([vaaHash(vaa).toLowerCase()]);
    const pending = await scanPendingRedeems(USER, { fetchFn: mockFetch([b64(vaa)]), ethCall: mockEthCall(done), emitterHex });
    expect(pending).toEqual([]);
  });

  it("ignores VAAs addressed to a different recipient", async () => {
    const other = buildVaa({ to: "0x00000000000000000000000000000000000000ff", toChain: 10002 });
    const pending = await scanPendingRedeems(USER, { fetchFn: mockFetch([b64(other)]), ethCall: mockEthCall(), emitterHex });
    expect(pending).toEqual([]);
  });

  it("ignores dests with no completeTransfer bridge (can't redeem there yet)", async () => {
    const arb = buildVaa({ to: USER, toChain: 10003 }); // arb-sep: WH id known, no dest token bridge
    const pending = await scanPendingRedeems(USER, { fetchFn: mockFetch([b64(arb)]), ethCall: mockEthCall(), emitterHex });
    expect(pending).toEqual([]);
  });

  it("empty emitter history → no pending redeems", async () => {
    const pending = await scanPendingRedeems(USER, { fetchFn: mockFetch([]), ethCall: mockEthCall(), emitterHex });
    expect(pending).toEqual([]);
  });

  it("pages the Solana emitter (chain 1) at the given emitter + pageSize", async () => {
    const cap: { url?: string } = {};
    await scanPendingRedeems(USER, { fetchFn: mockFetch([], cap), ethCall: mockEthCall(), emitterHex, pageSize: 25 });
    expect(cap.url).toContain("/vaas/1/" + emitterHex);
    expect(cap.url).toContain("pageSize=25");
  });
});

describe("isVaaRedeemed — pre-submit guard so we never re-submit a completed VAA (the 'gas limit too high' bug)", () => {
  const bridge = WORMHOLE_TOKEN_BRIDGE[11155111]!;
  const vaa = buildVaa({ to: USER, toChain: 10002 });
  it("true when the dest bridge reports the transfer completed", async () => {
    expect(await isVaaRedeemed(vaa, 11155111, bridge, async () => boolRet(true))).toBe(true);
  });
  it("false when not yet completed", async () => {
    expect(await isVaaRedeemed(vaa, 11155111, bridge, async () => boolRet(false))).toBe(false);
  });
  it("queries the given chain + bridge with the VAA's double-keccak hash", async () => {
    let seen: { c: number; to: string; data: string } | undefined;
    await isVaaRedeemed(vaa, 11155111, bridge, async (c, to, data) => { seen = { c, to, data }; return boolRet(false); });
    expect(seen!.c).toBe(11155111);
    expect(seen!.to.toLowerCase()).toBe(bridge.toLowerCase());
    expect(seen!.data.toLowerCase()).toContain(vaaHash(vaa).slice(2));
  });
});

describe("pendingRedeemView — display + the finish-delivery action", () => {
  it("renders an in-flight delivery with a single redeem action", () => {
    const v = pendingRedeemView({
      vaa: "0xabcd", destChainId: 11155111, toChainWh: 10002, amount: 7431520n,
      tokenAddressHex: pubkeyBs58ToBytes32(ROME_CHAIN.wsolMint),
    });
    expect(v.actions.map((a) => a.kind)).toEqual(["redeem"]);
    expect(v.actions[0]!.enabled).toBe(true);
    expect(v.title).toMatch(/deliver|progress|way|flight/i);
    expect(v.amountLabel).toMatch(/SOL/);
  });
});
