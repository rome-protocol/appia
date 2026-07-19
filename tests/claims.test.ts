/**
 * Claim center = recoverability, reconstructed FROM CHAIN (no browser state). buildClaims is the pure
 * core: given the user's on-chain balances (wUSDC / wSOL / native lamports / mSOL in their OWN Rome
 * account), produce the recoverable positions — each with the leg to resume from and whether it can be
 * brought home today (asset allowlisted on egress). Because self-custody keeps every asset in the
 * user's own PDA/ATA, the chain IS the durable per-leg record; this maps it to claim items.
 */
import { describe, it, expect } from "vitest";
import { buildClaims, claimView, observeChain, scanClaims } from "../src/claims";
import { bytes32ToPublicKey, deriveAta, deriveRomeUserPda, pubkeyBs58ToBytes32 } from "../src/rome/solana-pda";
import { ROME_CHAIN } from "../src/rome/rome-config";

const ZERO = { usdc6: 0n, wsol9: 0n, lamports: 0n, msol9: 0n };

describe("buildClaims — recoverable positions from on-chain balances", () => {
  it("no positions (all zero, only dust lamports) → empty", () => {
    expect(buildClaims({ ...ZERO, lamports: 4_000_000n })).toEqual([]); // 0.004 SOL < dust floor
  });

  it("mSOL held → a 'position-held' claim: keep (no resume) + bring-home (gated until allowlisted)", () => {
    const claims = buildClaims({ ...ZERO, msol9: 8_187_770_315n });
    expect(claims).toHaveLength(1);
    const c = claims[0]!;
    expect(c).toMatchObject({ asset: "msol", amount: 8_187_770_315n, decimals: 9, claimState: "position-held", resumeLeg: null });
    expect(c.canBringHome).toBe(false); // mSOL wrapper not allowlisted on v11 yet (D2)
  });

  it("mSOL bring-home unlocks once the asset is allowlisted", () => {
    const [c] = buildClaims({ ...ZERO, msol9: 1_000_000_000n }, { allowlisted: { msol: true } });
    expect(c!.canBringHome).toBe(true);
  });

  it("wSOL present → parked before unwrap; native SOL above dust → parked before stake", () => {
    const claims = buildClaims({ ...ZERO, wsol9: 100_000_000n, lamports: 100_000_000n });
    const byAsset = Object.fromEntries(claims.map((c) => [c.asset, c]));
    expect(byAsset.wsol).toMatchObject({ resumeLeg: "unwrap", claimState: "funds-in-pda", canBringHome: true });
    expect(byAsset.sol).toMatchObject({ resumeLeg: "stake", claimState: "funds-in-pda", amount: 100_000_000n });
  });

  it("dust lamports are NOT a claim (the rent buffer a completed journey leaves behind)", () => {
    const claims = buildClaims({ ...ZERO, lamports: 5_000_000n }); // ~ the 5M rentBuffer
    expect(claims.find((c) => c.asset === "sol")).toBeUndefined();
  });

  it("delivered USDC not yet swapped → parked before swap", () => {
    const [c] = buildClaims({ ...ZERO, usdc6: 2_000_000n });
    expect(c).toMatchObject({ asset: "usdc", amount: 2_000_000n, decimals: 6, resumeLeg: "swap", claimState: "funds-in-pda" });
  });

  it("a mid-journey wallet surfaces every stranded leg at once (order: usdc→wsol→sol→msol)", () => {
    const claims = buildClaims({ usdc6: 1_000_000n, wsol9: 2_000_000n, lamports: 100_000_000n, msol9: 3_000_000n });
    expect(claims.map((c) => c.asset)).toEqual(["usdc", "wsol", "sol", "msol"]);
  });
});

describe("observeChain + scanClaims — reconstruct from the user's own Rome account", () => {
  const ADDR = "0x3403e0de09bc76ca7d74762f264e4f6b649a0562" as const;
  const ata = (m: string) => bytes32ToPublicKey(deriveAta(deriveRomeUserPda(ADDR), pubkeyBs58ToBytes32(m))).toBase58();
  const pda = bytes32ToPublicKey(deriveRomeUserPda(ADDR)).toBase58();

  it("maps each ATA + the PDA lamports into a ClaimObservation", async () => {
    const amt: Record<string, string> = { [ata(ROME_CHAIN.msolMint)]: "8187770315" };
    const solRpc = (async (method: string, params: string[]) => {
      if (method === "getTokenAccountBalance") return { value: { amount: amt[params[0]!] ?? "0" } };
      if (method === "getBalance") { expect(params[0]).toBe(pda); return { value: 5_000_000 }; }
      throw new Error("unexpected " + method);
    }) as never;
    const obs = await observeChain(ADDR, { solRpc });
    expect(obs).toEqual({ usdc6: 0n, wsol9: 0n, lamports: 5_000_000n, msol9: 8_187_770_315n });
  });

  it("scanClaims(address) → only the mSOL held position (dust lamports filtered)", async () => {
    const solRpc = (async (method: string, params: string[]) =>
      method === "getTokenAccountBalance"
        ? { value: { amount: params[0] === ata(ROME_CHAIN.msolMint) ? "8187770315" : "0" } }
        : { value: 5_000_000 }) as never;
    const claims = await scanClaims(ADDR, { solRpc });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ asset: "msol", amount: 8_187_770_315n, claimState: "position-held", canBringHome: false });
  });
});

describe("claimView — display copy + the recovery OPTIONS the user chooses from", () => {
  const item = (over: Partial<Parameters<typeof claimView>[0]>) =>
    claimView({ asset: "msol", amount: 1_000_000_000n, decimals: 9, claimState: "position-held", resumeLeg: null, canBringHome: false, ...over });
  const kinds = (v: ReturnType<typeof claimView>) => v.actions.map((a) => a.kind);

  it("mSOL held → a single bring-home option, DISABLED until the asset is listed on the bridge", () => {
    const v = item({});
    expect(kinds(v)).toEqual(["bring-home"]);
    expect(v.actions[0]!.enabled).toBe(false);
    // HONEST copy: it's a one-time GLOBAL bridge listing, never the user's own permission "pending".
    expect(v.actions[0]!.label).toMatch(/listed on the bridge|enables when/i);
    expect(v.actions[0]!.label).not.toMatch(/pending/i);
    expect(v.title).toMatch(/earning/i);
    // the detail must convey self-custody (funds are the user's) + that the gate is a one-time global listing
    expect(v.detail).toMatch(/self-custod|your own|your control/i);
    expect(v.detail).toMatch(/one-time|global|listing|listed/i);
    expect(v.amountLabel).toBe("1.000000 mSOL");
  });

  it("mSOL bring-home ENABLES once the asset is allowlisted", () => {
    const [a] = item({ canBringHome: true }).actions;
    expect(a).toMatchObject({ kind: "bring-home", enabled: true });
    expect(a!.label).toMatch(/bring home/i);
  });

  it("mid-journey funds offer BOTH options — resume OR bring-home (the user chooses)", () => {
    const v = claimView({ asset: "wsol", amount: 1n, decimals: 9, claimState: "funds-in-pda", resumeLeg: "unwrap", canBringHome: true });
    expect(kinds(v)).toEqual(["resume", "bring-home"]);
    const resume = v.actions.find((a) => a.kind === "resume")!;
    expect(resume.enabled).toBe(true);
    expect(resume.label).toMatch(/unwrap/i);
    expect(v.actions.find((a) => a.kind === "bring-home")!.enabled).toBe(true);
  });

  it("resume label names the remaining legs per parked position", () => {
    const resumeLabel = (leg: string, asset: "usdc" | "sol", decimals: number) =>
      claimView({ asset, amount: 1n, decimals, claimState: "funds-in-pda", resumeLeg: leg, canBringHome: true }).actions.find((a) => a.kind === "resume")!.label;
    expect(resumeLabel("swap", "usdc", 6)).toMatch(/swap/i);
    expect(resumeLabel("stake", "sol", 9)).toMatch(/stake/i);
  });

  it("bring-home for mid-journey funds is gated by the same allowlist", () => {
    const v = claimView({ asset: "wsol", amount: 1n, decimals: 9, claimState: "funds-in-pda", resumeLeg: "unwrap", canBringHome: false });
    expect(v.actions.find((a) => a.kind === "bring-home")!.enabled).toBe(false);
  });
});
