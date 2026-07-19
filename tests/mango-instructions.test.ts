/**
 * Mango v4 lend plumbing — the CPI builders that make /lend (supply/withdraw) real.
 * Lifted from Cardo's funded-proven `lib/mango-*` (deposit+withdraw verified on-chain),
 * re-homed onto Appia's src/rome/* conventions (program id via rome-config solanaProgramId,
 * PDA/ATA helpers via solana-pda). Self-custody: EVERY signer slot is the user's own Rome
 * PDA — Rome's CPI precompile auto-signs as msg.sender, so one wallet signature covers all
 * signer slots (owner / tokenAuthority / payer). This asserts the builders are byte-exact:
 *  - discriminators are the real Anchor sha256("global:<snake_case_fn>")[..8] (mango hashes
 *    the rust snake_case name, NOT the IDL camelCase — the classic Custom(0) trap),
 *  - account lists match mango-v4's ix order + signer/writable flags,
 *  - instruction data = disc ++ borsh args.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import type { Hex } from "viem";
import {
  MANGO_V4_PROGRAM,
  ACCOUNT_CREATE_DISC,
  TOKEN_DEPOSIT_DISC,
  TOKEN_WITHDRAW_DISC,
  ACCOUNT_CLOSE_DISC,
} from "../src/rome/mango-program";
import { deriveMangoAccount } from "../src/rome/mango-pdas";
import {
  buildMangoAccountCreateInvoke,
  buildMangoTokenDepositInvoke,
  buildMangoTokenWithdrawInvoke,
  buildMangoAccountCloseInvoke,
} from "../src/rome/mango-instructions";
import { MANGO_SOL_BANK } from "../src/rome/mango-config";
import {
  SPL_TOKEN_PROGRAM_ID,
  deriveRomeUserPda,
  deriveAta,
  pubkeyBs58ToBytes32,
  pubkeyToBytes32,
} from "../src/rome/solana-pda";
import { ROME_CHAIN } from "../src/rome/rome-config";
import { PublicKey } from "@solana/web3.js";

const USER = "0x3403e0de09bc76ca7d74762f264e4f6b649a0562";
const OTHER = "0x00000000000000000000000000000000000000ff";
const MANGO_V4_BS58 = "4MangoMjqJ2firMokCjjGgoK8d4MXcrgL7XJaL3w6fVg";
const CANONICAL_WSOL = "So11111111111111111111111111111111111111112";
const SPL_TOKEN_HEX = pubkeyToBytes32(SPL_TOKEN_PROGRAM_ID);
const SYSTEM_HEX = pubkeyToBytes32(PublicKey.default);

const anchorDisc = (fn: string): Hex =>
  ("0x" +
    createHash("sha256").update("global:" + fn).digest("hex").slice(0, 16)) as Hex;

/** u64 LE read from a `0x…` hex string at a byte offset. */
function readU64Le(hex: Hex, byteOffset: number): bigint {
  return Buffer.from(hex.slice(2), "hex").readBigUInt64LE(byteOffset);
}

const bank = {
  pubkey: MANGO_SOL_BANK.bankHex,
  vault: MANGO_SOL_BANK.vaultHex,
  oracle: MANGO_SOL_BANK.oracleHex,
};

describe("mango-program — program id + Anchor discriminators", () => {
  it("resolves the Mango v4 program id (same devnet + mainnet) via config", () => {
    expect(MANGO_V4_PROGRAM).toBe(pubkeyBs58ToBytes32(MANGO_V4_BS58));
    expect(MANGO_V4_PROGRAM).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("discriminators are the real sha256(global:<snake_case>)[..8] — not camelCase", () => {
    // Mango hashes the rust fn name (snake_case). camelCase would yield a
    // different hash and Custom(0) at sim — pin it against a bad port.
    expect(ACCOUNT_CREATE_DISC).toBe(anchorDisc("account_create"));
    expect(TOKEN_DEPOSIT_DISC).toBe(anchorDisc("token_deposit"));
    expect(TOKEN_WITHDRAW_DISC).toBe(anchorDisc("token_withdraw"));
    expect(ACCOUNT_CLOSE_DISC).toBe(anchorDisc("account_close"));
    // camelCase must NOT match — proves the snake_case rule is enforced.
    expect(TOKEN_DEPOSIT_DISC).not.toBe(anchorDisc("tokenDeposit"));
  });
});

describe("deriveMangoAccount — PDA(['MangoAccount', group, owner, num_le])", () => {
  const group = MANGO_SOL_BANK.groupHex;
  const owner = deriveRomeUserPda(USER);

  it("is a deterministic 32-byte pubkey", () => {
    const a = deriveMangoAccount({ groupHex: group, ownerHex: owner });
    const b = deriveMangoAccount({ groupHex: group, ownerHex: owner });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes with the account number", () => {
    const a0 = deriveMangoAccount({ groupHex: group, ownerHex: owner, accountNum: 0 });
    const a1 = deriveMangoAccount({ groupHex: group, ownerHex: owner, accountNum: 1 });
    expect(a0).not.toBe(a1);
  });

  it("changes with the owner (per-user account)", () => {
    const mine = deriveMangoAccount({ groupHex: group, ownerHex: owner });
    const theirs = deriveMangoAccount({
      groupHex: group,
      ownerHex: deriveRomeUserPda(OTHER),
    });
    expect(mine).not.toBe(theirs);
  });
});

describe("buildMangoTokenDepositInvoke — supply into the bank (9 accounts)", () => {
  const user = deriveRomeUserPda(USER);
  const mangoAccount = deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: user });
  const userAta = deriveAta(user, MANGO_SOL_BANK.mintHex);
  const inv = buildMangoTokenDepositInvoke({
    userEvmAddress: USER,
    groupHex: MANGO_SOL_BANK.groupHex,
    mintHex: MANGO_SOL_BANK.mintHex,
    bank,
    amount: 1_500_000_000n,
  });

  it("targets the Mango v4 program", () => {
    expect(inv.program).toBe(MANGO_V4_PROGRAM);
  });

  it("emits the exact mango-v4 token_deposit account list + flags", () => {
    expect(inv.accounts).toEqual([
      { pubkey: MANGO_SOL_BANK.groupHex, is_signer: false, is_writable: false },
      { pubkey: mangoAccount, is_signer: false, is_writable: true },
      { pubkey: user, is_signer: true, is_writable: false }, // owner
      { pubkey: bank.pubkey, is_signer: false, is_writable: true },
      { pubkey: bank.vault, is_signer: false, is_writable: true },
      { pubkey: bank.oracle, is_signer: false, is_writable: false },
      { pubkey: userAta, is_signer: false, is_writable: true },
      { pubkey: user, is_signer: true, is_writable: false }, // tokenAuthority
      { pubkey: SPL_TOKEN_HEX, is_signer: false, is_writable: false },
    ]);
  });

  it("self-custody: both signer slots are the user's own Rome PDA", () => {
    const signers = inv.accounts.filter((a) => a.is_signer).map((a) => a.pubkey);
    expect(signers).toEqual([user, user]);
  });

  it("data = disc ++ u64LE(amount) ++ reduceOnly(false)", () => {
    expect(inv.data.startsWith(TOKEN_DEPOSIT_DISC.slice(2), 2)).toBe(true);
    expect(readU64Le(inv.data, 8)).toBe(1_500_000_000n);
    expect(inv.data.slice(-2)).toBe("00"); // reduceOnly = false
    expect(inv.data.length).toBe(2 + (8 + 8 + 1) * 2); // disc + u64 + bool
  });
});

describe("buildMangoTokenWithdrawInvoke — withdraw from the bank (8 accounts, no tokenAuthority)", () => {
  const user = deriveRomeUserPda(USER);
  const mangoAccount = deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: user });
  const userAta = deriveAta(user, MANGO_SOL_BANK.mintHex);
  const inv = buildMangoTokenWithdrawInvoke({
    userEvmAddress: USER,
    groupHex: MANGO_SOL_BANK.groupHex,
    mintHex: MANGO_SOL_BANK.mintHex,
    bank,
    amount: 500_000_000n,
  });

  it("emits the exact mango-v4 token_withdraw account list (8, single signer)", () => {
    expect(inv.accounts).toEqual([
      { pubkey: MANGO_SOL_BANK.groupHex, is_signer: false, is_writable: false },
      { pubkey: mangoAccount, is_signer: false, is_writable: true },
      { pubkey: user, is_signer: true, is_writable: false }, // owner
      { pubkey: bank.pubkey, is_signer: false, is_writable: true },
      { pubkey: bank.vault, is_signer: false, is_writable: true },
      { pubkey: bank.oracle, is_signer: false, is_writable: false },
      { pubkey: userAta, is_signer: false, is_writable: true },
      { pubkey: SPL_TOKEN_HEX, is_signer: false, is_writable: false },
    ]);
    expect(inv.accounts.filter((a) => a.is_signer)).toHaveLength(1);
  });

  it("data = disc ++ u64LE(amount) ++ allowBorrow(false) — pure withdraw, never borrows", () => {
    expect(inv.data.startsWith(TOKEN_WITHDRAW_DISC.slice(2), 2)).toBe(true);
    expect(readU64Le(inv.data, 8)).toBe(500_000_000n);
    expect(inv.data.slice(-2)).toBe("00"); // allowBorrow = false
  });
});

describe("buildMangoAccountCreateInvoke — first-time supply registers the MangoAccount (5 accounts)", () => {
  const user = deriveRomeUserPda(USER);
  const mangoAccount = deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: user });
  const inv = buildMangoAccountCreateInvoke({
    userEvmAddress: USER,
    groupHex: MANGO_SOL_BANK.groupHex,
  });

  it("emits group/account/owner/payer/system — owner==payer==user PDA (self-custody)", () => {
    expect(inv.accounts).toEqual([
      { pubkey: MANGO_SOL_BANK.groupHex, is_signer: false, is_writable: false },
      { pubkey: mangoAccount, is_signer: false, is_writable: true },
      { pubkey: user, is_signer: true, is_writable: false }, // owner
      { pubkey: user, is_signer: true, is_writable: true }, // payer
      { pubkey: SYSTEM_HEX, is_signer: false, is_writable: false },
    ]);
  });

  it("data starts with the account_create disc and a u32LE(0) account number", () => {
    expect(inv.data.startsWith(ACCOUNT_CREATE_DISC.slice(2), 2)).toBe(true);
    // after disc: accountNum u32LE (0), then 4 slot-count bytes, then a borsh
    // empty-name string (u32LE length 0).
    expect(inv.data.slice(2 + 16, 2 + 16 + 8)).toBe("00000000"); // accountNum = 0
    expect(inv.data.endsWith("00000000")).toBe(true); // borsh empty string len
  });

  it("exposes the derived mango account + user addresses", () => {
    expect(inv.addresses.mangoAccount).toBe(mangoAccount);
    expect(inv.addresses.user).toBe(user);
  });
});

describe("buildMangoAccountCloseInvoke — reclaim rent (5 accounts, rent → user by default)", () => {
  const user = deriveRomeUserPda(USER);
  const inv = buildMangoAccountCloseInvoke({
    userEvmAddress: USER,
    groupHex: MANGO_SOL_BANK.groupHex,
  });

  it("defaults the rent destination to the user's own PDA", () => {
    expect(inv.accounts[3]!.pubkey).toBe(user);
    expect(inv.accounts[3]!.is_writable).toBe(true);
    expect(inv.accounts).toHaveLength(5);
  });

  it("data = disc ++ force_close(false)", () => {
    expect(inv.data.startsWith(ACCOUNT_CLOSE_DISC.slice(2), 2)).toBe(true);
    expect(inv.data.slice(-2)).toBe("00");
  });
});

describe("MANGO_SOL_BANK — the SOL lending market, wired to Appia's own wSOL", () => {
  it("is the canonical wSOL mint (matches Appia's swap/bridge wSOL)", () => {
    expect(MANGO_SOL_BANK.mintBs58).toBe(CANONICAL_WSOL);
    expect(ROME_CHAIN.wsolMint).toBe(CANONICAL_WSOL);
    expect(MANGO_SOL_BANK.mintHex).toBe(pubkeyBs58ToBytes32(CANONICAL_WSOL));
  });

  it("uses Appia's wSOL wrapper, not a foreign one", () => {
    expect(MANGO_SOL_BANK.wrapper).toBe(ROME_CHAIN.wsolWrapper);
  });

  it("carries a full on-chain bank identity (group/bank/vault/oracle)", () => {
    for (const hex of [
      MANGO_SOL_BANK.groupHex,
      MANGO_SOL_BANK.bankHex,
      MANGO_SOL_BANK.vaultHex,
      MANGO_SOL_BANK.oracleHex,
    ]) {
      expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
    }
    expect(MANGO_SOL_BANK.symbol).toBe("SOL");
    expect(MANGO_SOL_BANK.decimals).toBe(9);
  });
});
