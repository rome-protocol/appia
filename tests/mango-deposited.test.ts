/**
 * Mango deposited-position READER — decode the user's SUPPLIED balance in the Mango SOL
 * bank from raw MangoAccount + Bank bytes. The wallet's ATA balance is the WRONG number for a position
 * card (that's what deposit consumes); the supplied amount lives inside Mango.
 *
 * `parseMangoDepositedNative` is lifted verbatim from Cardo's funded-proven decoder and pinned against
 * the SAME real devnet snapshots (captured 2026-07-07):
 *   fixtures/mango-sol-bank.b64          — Bank 7trXn2uYWg… (the SOL bank Appia lends into)
 *   fixtures/mango-account-treasury.b64  — a MangoAccount holding indexed_position 6.0 × deposit_index
 *                                          1e6 → 6_000_000 native = 0.006 SOL (owner 2Q93vtBv…).
 * `fetchMangoDeposited` is the plain-async reader (getMultipleAccounts → decode); rpc injectable.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseMangoDepositedNative, fetchMangoDeposited } from "../src/rome/mango-state";
import {
  pubkeyBs58ToBytes32,
  bytes32ToPublicKey,
  deriveRomeUserPda,
} from "../src/rome/solana-pda";
import { deriveMangoAccount } from "../src/rome/mango-pdas";
import { MANGO_SOL_BANK } from "../src/rome/mango-config";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f: string) => Buffer.from(readFileSync(join(here, "fixtures", f), "utf8"), "base64");
const bankData = fixture("mango-sol-bank.b64");
const acctData = fixture("mango-account-treasury.b64");

const GROUP = pubkeyBs58ToBytes32("FHnZBXLaKBKLg8Qwzt31Ft2ZDNbkM9j4UWREkYP4o25d");
const OWNER = pubkeyBs58ToBytes32("2Q93vtBvo4VJL2iN1h68fmHcSxSGuv8mzmXvFUyps2RK");
const WSOL = pubkeyBs58ToBytes32("So11111111111111111111111111111111111111112");

describe("parseMangoDepositedNative — supplied balance from live account snapshots", () => {
  it("reads the treasury deposit (0.006 SOL = 6_000_000 native)", () => {
    expect(
      parseMangoDepositedNative({
        mangoAccountData: acctData,
        bankData,
        ownerPdaHex: OWNER,
        groupHex: GROUP,
        bankMintHex: WSOL,
      }),
    ).toBe(6_000_000n);
  });

  it("rejects an account whose owner does not match (no lying about someone else's position)", () => {
    expect(
      parseMangoDepositedNative({
        mangoAccountData: acctData,
        bankData,
        ownerPdaHex: GROUP, // wrong on purpose
        groupHex: GROUP,
        bankMintHex: WSOL,
      }),
    ).toBeNull();
  });

  it("rejects a bank whose mint does not match", () => {
    expect(
      parseMangoDepositedNative({
        mangoAccountData: acctData,
        bankData,
        ownerPdaHex: OWNER,
        groupHex: GROUP,
        bankMintHex: GROUP, // wrong on purpose
      }),
    ).toBeNull();
  });

  it("returns null on truncated data instead of garbage", () => {
    expect(
      parseMangoDepositedNative({
        mangoAccountData: acctData.subarray(0, 300),
        bankData,
        ownerPdaHex: OWNER,
        groupHex: GROUP,
        bankMintHex: WSOL,
      }),
    ).toBeNull();
  });
});

describe("fetchMangoDeposited — plain-async reader (getMultipleAccounts → decode)", () => {
  const USER = "0x3403e0de09bc76ca7d74762f264e4f6b649a0562" as const;
  const b64 = (buf: Buffer) => buf.toString("base64");
  const acct = (buf: Buffer) => ({ data: [b64(buf), "base64"] });

  function mockRpc(value: Array<{ data: string[] } | null>, seen?: { method?: string; params?: unknown[] }) {
    return (async (method: string, params: unknown[]) => {
      if (seen) {
        seen.method = method;
        seen.params = params;
      }
      return { value } as never;
    }) as <T>(m: string, p: unknown[]) => Promise<T>;
  }

  it("queries the user's derived MangoAccount + the bank, and pipes bytes into the decoder", async () => {
    const seen: { method?: string; params?: unknown[] } = {};
    const expectedMango = bytes32ToPublicKey(
      deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: deriveRomeUserPda(USER) }),
    ).toBase58();
    const expectedBank = bytes32ToPublicKey(MANGO_SOL_BANK.bankHex).toBase58();
    const out = await fetchMangoDeposited(mockRpc([acct(acctData), acct(bankData)], seen), {
      userEvmAddress: USER,
      groupHex: MANGO_SOL_BANK.groupHex,
      bankHex: MANGO_SOL_BANK.bankHex,
      bankMintHex: MANGO_SOL_BANK.mintHex,
    });
    expect(seen.method).toBe("getMultipleAccounts");
    expect((seen.params as unknown[])[0]).toEqual([expectedMango, expectedBank]);
    // USER's derived PDA ≠ the fixture owner, so the decoder's owner guard fires → null (pipe proven).
    expect(out).toBeNull();
  });

  it("returns 0 (nothing deposited) when the user has no MangoAccount yet", async () => {
    const out = await fetchMangoDeposited(mockRpc([null, acct(bankData)]), {
      userEvmAddress: USER,
      groupHex: MANGO_SOL_BANK.groupHex,
      bankHex: MANGO_SOL_BANK.bankHex,
      bankMintHex: MANGO_SOL_BANK.mintHex,
    });
    expect(out).toBe(0n);
  });

  it("returns null (hide the number) when the bank is unreadable", async () => {
    const out = await fetchMangoDeposited(mockRpc([acct(acctData), null]), {
      userEvmAddress: USER,
      groupHex: MANGO_SOL_BANK.groupHex,
      bankHex: MANGO_SOL_BANK.bankHex,
      bankMintHex: MANGO_SOL_BANK.mintHex,
    });
    expect(out).toBeNull();
  });
});
