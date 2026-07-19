/**
 * Source chain = the CONNECTED wallet's chain (no dropdown, per the design system). The Stake/Swap flows
 * bridge USDC in FROM the connected L2, so that chain must be a supported CCTP source. isSupportedSource
 * gates the form: connected on a supported L2 → show it; on Rome / an unsupported chain / disconnected →
 * prompt to switch. Replaces the legacy source-chain <select>.
 */
import { describe, it, expect } from "vitest";
import { isSupportedSource, SUPPORTED_SOURCE_IDS, supportedSourceNames } from "../src/source-chains";

describe("isSupportedSource — the connected chain is a valid bridge source", () => {
  it("the 5 CCTP source L2s are supported", () => {
    for (const id of [11155111, 421614, 84532, 43113, 80002]) expect(isSupportedSource(id)).toBe(true);
    expect(SUPPORTED_SOURCE_IDS).toHaveLength(5);
  });
  it("Rome (200010), an unknown chain, or undefined are NOT a source", () => {
    expect(isSupportedSource(200010)).toBe(false);
    expect(isSupportedSource(1)).toBe(false);
    expect(isSupportedSource(undefined)).toBe(false);
  });
});

describe("supportedSourceNames — the 'these chains are supported, connect with any' list", () => {
  it("names every supported source, parallel to the ids", () => {
    const names = supportedSourceNames();
    expect(names).toHaveLength(SUPPORTED_SOURCE_IDS.length);
    expect(names).toContain("Ethereum Sepolia");
    expect(names).toContain("Arbitrum Sepolia");
    expect(names.every((n) => n.length > 0)).toBe(true);
  });
});
