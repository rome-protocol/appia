/**
 * Self-custody signer. Appia has NO session key — the user's own wallet signs every Rome leg
 * (walletRomeSigner), and the headless harness/tests sign with a raw key standing in for that
 * wallet (keyRomeSigner — NOT a session key; the product never generates or stores one). Both
 * expose the same RomeSigner surface { address, sendRomeTx } so the drivers are custody-agnostic.
 */
import { describe, it, expect } from "vitest";
import { keyRomeSigner, walletRomeSigner } from "../src/rome-signer";

// anvil test account #1 (well-known; never funded on any live chain)
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ADDR = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

describe("keyRomeSigner", () => {
  it("exposes the key's address", () => {
    const s = keyRomeSigner(PK, { rpc: (async () => "0x0") as never, chainId: 200010 });
    expect(s.address.toLowerCase()).toBe(ADDR);
  });

  it("signs a legacy tx and submits it, resolving with the hash on receipt 0x1", async () => {
    const seen: string[] = [];
    const rpc = (async (m: string) => {
      seen.push(m);
      if (m === "eth_getTransactionCount") return "0x5";
      if (m === "eth_gasPrice") return "0x3b9aca00"; // 1 gwei
      if (m === "eth_sendRawTransaction") return "0xdeadbeef";
      if (m === "eth_getTransactionReceipt") return { status: "0x1" };
      throw new Error("unexpected " + m);
    }) as never;
    const s = keyRomeSigner(PK, { rpc, chainId: 200010, pollMs: 0 });
    const hash = await s.sendRomeTx("0xff00000000000000000000000000000000000008", "0xabcd", 30_000_000n);
    expect(hash).toBe("0xdeadbeef");
    expect(seen).toContain("eth_sendRawTransaction"); // it actually broadcast a signed raw tx
  });

  it("throws when the tx reverts (receipt status 0x0)", async () => {
    const rpc = (async (m: string) => {
      if (m === "eth_getTransactionCount") return "0x0";
      if (m === "eth_gasPrice") return "0x1";
      if (m === "eth_sendRawTransaction") return "0xbad";
      if (m === "eth_getTransactionReceipt") return { status: "0x0" };
      throw new Error("x");
    }) as never;
    const s = keyRomeSigner(PK, { rpc, chainId: 200010, pollMs: 0, tries: 3 });
    await expect(s.sendRomeTx("0x0000000000000000000000000000000000000000", "0x", 1n)).rejects.toThrow(/revert/i);
  });
});

describe("walletRomeSigner (the user's own wallet — self-custody)", () => {
  it("sends via the wallet client on the Rome chain and confirms via rpc", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const walletClient = { sendTransaction: async (a: Record<string, unknown>) => { sent.push(a); return "0xwhash" as `0x${string}`; } };
    const rpc = (async (m: string) => (m === "eth_getTransactionReceipt" ? { status: "0x1" } : null)) as never;
    const s = walletRomeSigner({ address: "0x1111111111111111111111111111111111111111", walletClient, rpc, chainId: 200010, pollMs: 0 });
    const hash = await s.sendRomeTx("0x00000000000000000000000000000000000000aa", "0xdata", 30_000_000n);
    expect(hash).toBe("0xwhash");
    expect(sent[0]).toMatchObject({ to: "0x00000000000000000000000000000000000000aa", data: "0xdata", chainId: 200010 });
    expect(sent[0]!.account).toBe("0x1111111111111111111111111111111111111111"); // signs AS the user
  });
});
