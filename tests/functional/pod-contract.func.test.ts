/**
 * FUNCTIONAL gate (CI-only; hits the live bridge-api pod — not hermetic).
 *
 * Proves the EXTERNAL contract Appia's committed code depends on still holds
 * on-chain reality — the class of break that unit tests can't catch and that
 * bit us as bugs B (wrapper quote missing outputs[0].chainId) and C (settle
 * typedData missing EIP712Domain). If the pod's quote shape drifts, THIS fails
 * and the PR is blocked — so what merges is code that actually works against
 * the deployed world, not just code that compiles.
 *
 * Runs only when APPIA_FUNCTIONAL=1 (CI sets it); local `npm test` stays
 * hermetic. Config: vitest.functional.config.ts.
 */
import { describe, it, expect } from "vitest";

// Self-gate on the flag so this is safe even if it's ever collected by the
// hermetic unit run — it stays a no-op locally and only fires in the CI
// functional job (which sets APPIA_FUNCTIONAL=1). Belt-and-suspenders with the
// vitest.config.ts exclusion.
const FUNCTIONAL = process.env.APPIA_FUNCTIONAL === "1";
const POD = process.env.APPIA_POD_URL ?? "https://bridge-api.devnet.romeprotocol.xyz";
const USER = "0x3403e0De09Bc76Ca7d74762F264e4F6B649A0562";

async function quote(intent: "wrapper" | "gas") {
  const r = await fetch(`${POD}/v1/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      asset: "USDC", direction: "to-rome", sourceChain: "eip155:11155111",
      romeChainId: "200010", amount: "2000000", intent, speed: "fast",
      sender: { ethereum: USER }, recipient: USER,
    }),
  });
  expect(r.status, "pod /v1/quote reachable").toBe(200);
  return r.json();
}

describe.skipIf(!FUNCTIONAL)("bridge-api pod contract Appia depends on", () => {
  it("pod is healthy", async () => {
    const h = await (await fetch(`${POD}/v1/health`)).json();
    expect(h.status).toBe("ok");
  });

  it("wrapper quote carries outputs[0].chainId (Bug B invariant)", async () => {
    const q = await quote("wrapper");
    expect(q.amountOut, "amountOut present").toBeTruthy();
    expect(q.cctpVersion).toBe(2);
    expect(q.outputs?.[0]?.chainId, "wrapper output MUST carry chainId or it registers unstamped").toBeTruthy();
  });

  it("gas quote settle typedData includes EIP712Domain, numeric chainId (Bug C invariant)", async () => {
    const q = await quote("gas");
    const td = q.signatureRequests?.[0]?.typedData;
    expect(td, "gas quote emits a settle authorization").toBeTruthy();
    expect(td.types?.EIP712Domain, "EIP712Domain MUST be present or MetaMask signs a degenerate domain").toBeTruthy();
    expect(typeof td.domain?.chainId, "domain.chainId MUST be numeric").toBe("number");
    expect(td.types.EIP712Domain.map((f: { name: string }) => f.name)).toEqual(["name", "version", "chainId", "salt"]);
  });
});
