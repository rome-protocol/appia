/**
 * Principle #3 (nothing hard-coded): Appia's chain config is RESOLVED from the
 * rome-protocol/rome-registry, not pinned in source. This tests the pure resolver
 * against real registry fixtures (chains/200010-hadrian/*). The load-bearing
 * property: RomeBridgeWithdraw is selected by status=="live" — reading a stale
 * clone or picking the wrong version regresses native egress (8.0.0 is
 * transfer_wrapped-only; 9.0.0/0x65fc94ba is the live native-egress v11).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveRomeChain } from "../src/rome/chain-resolve";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (f: string) => JSON.parse(readFileSync(join(here, "fixtures/registry", f), "utf8"));
const REG = { chain: fx("chain.json"), contracts: fx("contracts.json"), tokens: fx("tokens.json") };

describe("resolveRomeChain — registry-driven config", () => {
  it("resolves core fields from the registry (no source literals)", () => {
    const c = resolveRomeChain(REG);
    expect(c.chainId).toBe(200010);
    expect(c.romeEvmProgramId).toBe("RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf");
    expect(c.rpcUrl).toBe("https://hadrian.testnet.romeprotocol.xyz");     // trailing slash normalized
    expect(c.solanaRpc).toBe("https://api.devnet.solana.com");
    expect(c.usdcMint).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    expect(c.wsolMint).toBe("So11111111111111111111111111111111111111112");
    expect(c.wsolWrapper.toLowerCase()).toBe("0x1dece035621c65a90349b56a801068b439fa4201");
  });

  it("selects the LIVE RomeBridgeWithdraw (9.0.0), never a retired one", () => {
    const c = resolveRomeChain(REG);
    expect(c.bridgeWithdraw.toLowerCase()).toBe("0x65fc94ba1045b65889f0b27d3d02e5bfbc2aee03");
    // guard: even though 7.0.0/8.0.0 exist in the list, the retired ones are never chosen
    const retired = ["0xd2161cd539c20f0cb1cbf5bf9a8456cd16c9034f", "0xc1543b5efbeb98ff63506541b146c6fa3060b394"];
    expect(retired).not.toContain(c.bridgeWithdraw.toLowerCase());
  });

  it("throws loud if no live bridgeWithdraw (never silently pick a stale pointer)", () => {
    const noLive = {
      ...REG,
      contracts: REG.contracts.map((e: { name: string; versions: { status: string }[] }) =>
        e.name === "RomeBridgeWithdraw"
          ? { ...e, versions: e.versions.map((v) => ({ ...v, status: "retired" })) }
          : e),
    };
    expect(() => resolveRomeChain(noLive)).toThrow(/no live RomeBridgeWithdraw/i);
  });
});
