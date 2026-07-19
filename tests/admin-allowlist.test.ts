/**
 * Owner-gated asset allowlist — the UI replacement for the raw `cast send setWormholeAssetAllowed`.
 * The owner connects their wallet and signs the setter (self-custody — no key handling), instead of a
 * terminal + private key. Pure pieces here: the calldata encoder, the allowed-bool decoder, the
 * owner-match gate, and the asset list (wrappers from chain config). The page wires reads + the signed
 * write on the Rome chain.
 */
import { describe, it, expect } from "vitest";
import { setWormholeAssetAllowedCalldata, decodeAllowed, isOwner, assetRowState, adminViewMode, ALLOWLIST_ASSETS } from "../src/admin-allowlist";
import { ROME_CHAIN } from "../src/rome/rome-config";

const WRAPPER = "0x0ea6e66d26c5e1f6fd3886a080db837b841c5b89" as const;

describe("setWormholeAssetAllowedCalldata", () => {
  it("encodes setWormholeAssetAllowed(address,bool) — selector + wrapper + bool", () => {
    const cd = setWormholeAssetAllowedCalldata(WRAPPER, true);
    expect(cd.length).toBe(2 + 8 + 64 + 64); // 0x + selector(4) + address(32) + bool(32)
    expect(cd.toLowerCase()).toContain(WRAPPER.slice(2)); // wrapper appears (left-padded)
    expect(cd.endsWith("0".repeat(63) + "1")).toBe(true); // allowed = true
  });
  it("encodes allowed=false as a zero word", () => {
    expect(setWormholeAssetAllowedCalldata(WRAPPER, false).endsWith("0".repeat(64))).toBe(true);
  });
});

describe("decodeAllowed", () => {
  it("decodes the wormholeAssetAllowed bool", () => {
    expect(decodeAllowed(("0x" + "0".repeat(63) + "1") as `0x${string}`)).toBe(true);
    expect(decodeAllowed(("0x" + "0".repeat(64)) as `0x${string}`)).toBe(false);
  });
});

describe("isOwner — case-insensitive owner gate", () => {
  it("matches regardless of checksum casing", () => {
    expect(isOwner("0x38a773254d64a3a641c500af451bc5d2e2a06f4b", "0x38A773254D64a3a641c500Af451bC5D2e2a06F4B")).toBe(true);
  });
  it("false on mismatch or missing", () => {
    expect(isOwner("0xdeadbeef", "0x38A773254D64a3a641c500Af451bC5D2e2a06F4B")).toBe(false);
    expect(isOwner(undefined, "0x38A7")).toBe(false);
    expect(isOwner("0x38A7", undefined)).toBe(false);
  });
});

describe("assetRowState — how each asset row renders (no misleading labels)", () => {
  it("allowed → a done status, never a button", () => {
    expect(assetRowState({ allowed: true, owns: false, symbol: "wSOL", running: false })).toEqual({ kind: "allowed" });
    // ownership is irrelevant once allowed
    expect(assetRowState({ allowed: true, owns: true, symbol: "wSOL", running: false }).kind).toBe("allowed");
  });
  it("not allowed + owner → an actionable Allowlist button", () => {
    expect(assetRowState({ allowed: false, owns: true, symbol: "mSOL", running: false })).toEqual({ kind: "action", label: "Allowlist mSOL" });
  });
  it("not allowed + NOT owner → a clear owner-gated status (NOT a 'not allowed' button — that read as asset state)", () => {
    const s = assetRowState({ allowed: false, owns: false, symbol: "mSOL", running: false });
    expect(s.kind).toBe("status");
    expect(s.kind === "status" && s.label).toMatch(/owner/i); // explains WHY it's disabled
    expect(s.kind === "status" && s.label).not.toMatch(/^not allowed$/i);
  });
  it("running → the action button shows the live phase", () => {
    expect(assetRowState({ allowed: false, owns: true, symbol: "mSOL", running: true, phase: "Confirming…" })).toEqual({ kind: "action", label: "Confirming…" });
    expect(assetRowState({ allowed: false, owns: true, symbol: "mSOL", running: true })).toEqual({ kind: "action", label: "Working…" });
  });
});

describe("adminViewMode — /admin is an ops page, gated so it never masquerades as a user view", () => {
  const OWNER = "0x38A773254D64a3a641c500Af451bC5D2e2a06F4B";
  it("no wallet → disconnected (ops notice, no controls)", () => {
    expect(adminViewMode(undefined, OWNER)).toBe("disconnected");
  });
  it("connected non-owner → not-owner (read-only ops view — this is not their page)", () => {
    expect(adminViewMode("0x3403e0de09bc76ca7d74762f264e4f6b649a0562", OWNER)).toBe("not-owner");
  });
  it("connected owner → owner (actionable), case-insensitive", () => {
    expect(adminViewMode(OWNER.toLowerCase(), OWNER)).toBe("owner");
  });
  it("owner not yet loaded → not-owner when connected (safe: no actions until proven owner)", () => {
    expect(adminViewMode("0x3403e0de09bc76ca7d74762f264e4f6b649a0562", undefined)).toBe("not-owner");
  });
});

describe("ALLOWLIST_ASSETS — Appia's bridgeable assets from chain config", () => {
  it("carries wSOL + mSOL with their egress wrappers", () => {
    const bySym = Object.fromEntries(ALLOWLIST_ASSETS.map((a) => [a.symbol, a.wrapper.toLowerCase()]));
    expect(bySym.wSOL).toBe(ROME_CHAIN.wsolWrapper.toLowerCase());
    expect(bySym.mSOL).toBe(ROME_CHAIN.msolWrapper.toLowerCase());
  });
});
