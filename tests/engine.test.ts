/**
 * Appia engine — core unit suite (TDD: written before the modules).
 *
 * Covers the pure product logic: route-catalog gating, fee math, the
 * Wormhole transfer-VAA parser (pins the to@67/toChain@99 offsets that a
 * hand-parse got wrong on 2026-07-06) and the journey state machine incl.
 * resume-from-every-leg.
 */
import { describe, it, expect } from "vitest";
import { gateRoutes, type RouteHealth } from "../src/routes-catalog.js";
import { quoteFee } from "../src/fee.js";
import { parseTransferVaa } from "../src/vaa.js";
import { createJourney, advance, resumable, JOURNEY_LEGS, type Journey } from "../src/journey.js";

// ── routes catalog ────────────────────────────────────────────────────────
describe("routes catalog gating", () => {
  const NOW = Date.parse("2026-07-06T12:00:00Z");
  const health = (over: Partial<RouteHealth>): RouteHealth => ({
    chainId: 11155111,
    journey: "earn",
    lastVerifiedAt: "2026-07-06T10:00:00Z",
    p50DurationMin: 4,
    minAmountUsdc: "1000000",
    status: "green",
    ...over,
  });

  it("offers only green routes verified within the freshness window", () => {
    const routes = [
      health({}),
      health({ chainId: 421614, lastVerifiedAt: "2026-07-01T00:00:00Z" }), // stale
      health({ chainId: 84532, status: "red" }),
    ];
    const offered = gateRoutes(routes, { nowMs: NOW, maxAgeHours: 24 });
    expect(offered.map((r) => r.chainId)).toEqual([11155111]);
  });

  it("never offers Monad for delivery journeys (no Wormhole token bridge)", () => {
    const routes = [health({ chainId: 10143, journey: "swap" })];
    expect(gateRoutes(routes, { nowMs: NOW, maxAgeHours: 24 })).toEqual([]);
  });

  it("allows Monad for earn-keep journeys (exit is CCTP, not Wormhole)", () => {
    const routes = [health({ chainId: 10143, journey: "earn" })];
    expect(gateRoutes(routes, { nowMs: NOW, maxAgeHours: 24 }).length).toBe(1);
  });
});

// ── fee ───────────────────────────────────────────────────────────────────
describe("fee = max(bps, floor), taken at the swap leg", () => {
  it("percentage dominates on large amounts", () => {
    // 1000 USDC @ 100bps = 10 USDC > $1 floor
    expect(quoteFee({ amountUsdc6: 1_000_000_000n, feeBps: 100, floorUsdc6: 1_000_000n }))
      .toBe(10_000_000n);
  });
  it("floor dominates on small amounts", () => {
    // 20 USDC @ 100bps = 0.2 USDC < $1 floor
    expect(quoteFee({ amountUsdc6: 20_000_000n, feeBps: 100, floorUsdc6: 1_000_000n }))
      .toBe(1_000_000n);
  });
  it("rejects amounts the fee would consume entirely", () => {
    expect(() => quoteFee({ amountUsdc6: 900_000n, feeBps: 100, floorUsdc6: 1_000_000n }))
      .toThrow(/amount below fee floor/);
  });
});

// ── VAA parse (offset regression, 2026-07-06) ─────────────────────────────
describe("transfer VAA parse", () => {
  function syntheticVaa(opts: { to: string; toChain: number; amount: bigint }): Uint8Array {
    // header: version(1) guardianSetIdx(4) sigCount(1)=1 sig(66)
    const header = Buffer.alloc(6 + 66);
    header.writeUInt8(1, 0);
    header.writeUInt8(1, 5);
    // body: ts(4) nonce(4) emitterChain(2) emitter(32) seq(8) consistency(1)
    const bodyMeta = Buffer.alloc(51);
    bodyMeta.writeUInt16BE(1, 8); // emitterChain = Solana
    // payload: type(1) amount(32) tokenAddress(32) tokenChain(2) to(32) toChain(2)
    const payload = Buffer.alloc(101);
    payload.writeUInt8(1, 0);
    payload.writeBigUInt64BE(opts.amount, 1 + 24); // amount low 8 bytes of u256
    Buffer.from(opts.to.replace("0x", "").padStart(64, "0"), "hex").copy(payload, 67);
    payload.writeUInt16BE(opts.toChain, 99);
    return Uint8Array.from(Buffer.concat([header, bodyMeta, payload]));
  }

  it("reads to@67 and toChain@99 (NOT 65/97 — the hand-parse bug)", () => {
    const vaa = syntheticVaa({ to: "0x2cD347E873424Ad72B1D4bB2c17D21BA6124B5f9", toChain: 10002, amount: 400_000n });
    const parsed = parseTransferVaa(vaa);
    if (!parsed) throw new Error("expected transfer VAA to parse");
    expect(parsed.payloadType).toBe(1);
    expect(parsed.toChain).toBe(10002);
    expect(parsed.to.toLowerCase()).toBe("0x" + "2cD347E873424Ad72B1D4bB2c17D21BA6124B5f9".toLowerCase().padStart(64, "0"));
    expect(parsed.amount).toBe(400_000n);
  });

  it("rejects non-transfer payloads", () => {
    const vaa = syntheticVaa({ to: "0x00", toChain: 10002, amount: 1n });
    vaa[6 + 66 + 51] = 2; // AttestMeta
    expect(parseTransferVaa(vaa)).toBeNull();
  });
});

// ── journey machine ───────────────────────────────────────────────────────
describe("journey state machine", () => {
  it("earn-keep journey has the expected leg sequence", () => {
    const j = createJourney({ journey: "earn", terminal: "keep", sourceChainId: 11155111, amountUsdc6: 50_000_000n });
    expect(j.legs.map((l) => l.id)).toEqual(JOURNEY_LEGS["earn-keep"]);
    expect(j.legs[0]!.status).toBe("pending");
  });

  it("advance moves exactly one leg to done and activates the next", () => {
    let j = createJourney({ journey: "earn", terminal: "keep", sourceChainId: 11155111, amountUsdc6: 50_000_000n });
    j = advance(j, { legId: "burn", txs: ["0xaa"] });
    expect(j.legs.find((l) => l.id === "burn")!.status).toBe("done");
    expect(j.legs.find((l) => l.id === "delivered")!.status).toBe("running");
  });

  it("a stuck journey is resumable from its active leg, never from done legs", () => {
    let j = createJourney({ journey: "earn", terminal: "deliver", sourceChainId: 11155111, amountUsdc6: 50_000_000n });
    j = advance(j, { legId: "burn", txs: ["0xaa"] });
    const r = resumable(j);
    expect(r?.legId).toBe("delivered");
    expect(r?.claimState).toBe("burned-awaiting-delivery");
  });

  it("deliver-terminal earn includes egress + redeem legs; keep-terminal does not", () => {
    const keep = createJourney({ journey: "earn", terminal: "keep", sourceChainId: 11155111, amountUsdc6: 1_000_000n });
    const deliver = createJourney({ journey: "earn", terminal: "deliver", sourceChainId: 11155111, amountUsdc6: 1_000_000n });
    expect(keep.legs.some((l) => l.id === "egress")).toBe(false);
    expect(deliver.legs.some((l) => l.id === "egress")).toBe(true);
    expect(deliver.legs.some((l) => l.id === "redeem")).toBe(true);
  });

  it("swap-keep (inbound → SOL) stops at swap: burn → delivered → fuel → swap, no unwrap/stake/deliver", () => {
    const j = createJourney({ journey: "swap", terminal: "keep", sourceChainId: 11155111, amountUsdc6: 1_000_000n });
    expect(j.legs.map((l) => l.id)).toEqual(["burn", "delivered", "fuel", "swap"]);
    expect(j.legs.some((l) => l.id === "unwrap" || l.id === "stake" || l.id === "egress")).toBe(false);
  });

  it("lend-keep (buy & supply in one shot) ends at supply: burn → delivered → fuel → swap → supply, no unwrap/stake", () => {
    const j = createJourney({ journey: "lend", terminal: "keep", sourceChainId: 11155111, amountUsdc6: 1_000_000n });
    expect(j.legs.map((l) => l.id)).toEqual(["burn", "delivered", "fuel", "swap", "supply"]);
    expect(j.legs.some((l) => l.id === "unwrap" || l.id === "stake" || l.id === "egress")).toBe(false);
  });

  it("out-of-order advance throws (legs are strictly sequential)", () => {
    const j = createJourney({ journey: "earn", terminal: "keep", sourceChainId: 11155111, amountUsdc6: 1_000_000n });
    expect(() => advance(j, { legId: "stake", txs: [] })).toThrow(/not the active leg/);
  });
});
