/**
 * Mango lend DRIVERS — supply / withdraw wSOL against the Mango SOL bank, self-custody.
 * These wire the 3a builders into the CPI precompile via a RomeSigner (the user's own wallet), the same
 * shape as swapUsdcToWsol / stakeMarinade. What's asserted here (no network — fake signer records the
 * tx, injected guards stub the on-chain checks):
 *  - supply/withdraw send ONE tx to the CPI precompile whose calldata decodes back to the exact
 *    Mango deposit/withdraw invoke bound to MANGO_SOL_BANK (config wired correctly),
 *  - supply first ensures the user's wSOL ATA + their MangoAccount (create-if-missing),
 *  - ensureMangoAccount is idempotent: creates iff absent, no-ops if present,
 *  - self-custody: the signer slots are the user's own Rome PDA.
 */
import { describe, it, expect, vi } from "vitest";
import { decodeFunctionData } from "viem";
import type { Hex } from "viem";
import {
  supplyToMango,
  withdrawFromMango,
  ensureMangoAccount,
  ensurePdaLamports,
} from "../src/drivers";
import type { RomeSigner } from "../src/rome-signer";
import { CPI_INVOKE_ABI, CPI_PRECOMPILE } from "../src/rome/cpi-precompile";
import {
  buildMangoTokenDepositInvoke,
  buildMangoTokenWithdrawInvoke,
  buildMangoAccountCreateInvoke,
} from "../src/rome/mango-instructions";
import { MANGO_SOL_BANK } from "../src/rome/mango-config";
import { deriveRomeUserPda } from "../src/rome/solana-pda";
import { ROME_CHAIN } from "../src/rome/rome-config";

const USER = "0x3403e0de09bc76ca7d74762f264e4f6b649a0562" as const;

/** A RomeSigner that records every (to, data) it's asked to send and returns a stub hash. */
function recordingSigner() {
  const sent: Array<{ to: string; data: Hex }> = [];
  const signer: RomeSigner = {
    address: USER,
    sendRomeTx: async (to, data) => {
      sent.push({ to, data });
      return "0x" + "ab".repeat(32);
    },
  };
  return { signer, sent };
}

/** Decode a recorded CPI-precompile tx back into its invoke(program, accounts, data). */
function decodeInvoke(data: Hex) {
  const { functionName, args } = decodeFunctionData({ abi: CPI_INVOKE_ABI, data });
  return { functionName, program: args[0], accounts: args[1], data: args[2] };
}

const bank = {
  pubkey: MANGO_SOL_BANK.bankHex,
  vault: MANGO_SOL_BANK.vaultHex,
  oracle: MANGO_SOL_BANK.oracleHex,
};
const noopGuards = { ensureAta: async () => {}, ensureAccount: async () => {} };

describe("supplyToMango — deposit wSOL into the Mango SOL bank", () => {
  it("sends one CPI-precompile tx whose calldata IS the exact token_deposit invoke", async () => {
    const { signer, sent } = recordingSigner();
    await supplyToMango(signer, 1_500_000_000n, noopGuards);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(CPI_PRECOMPILE);

    const got = decodeInvoke(sent[0]!.data);
    const want = buildMangoTokenDepositInvoke({
      userEvmAddress: USER,
      groupHex: MANGO_SOL_BANK.groupHex,
      mintHex: MANGO_SOL_BANK.mintHex,
      bank,
      amount: 1_500_000_000n,
    });
    expect(got.functionName).toBe("invoke");
    expect(got.program).toBe(want.program);
    expect(got.accounts).toEqual(want.accounts);
    expect(got.data).toBe(want.data);
  });

  it("self-custody: the deposit's signer slots are the user's own Rome PDA", async () => {
    const { signer, sent } = recordingSigner();
    await supplyToMango(signer, 1n, noopGuards);
    const user = deriveRomeUserPda(USER);
    const signers = decodeInvoke(sent[0]!.data).accounts.filter((a) => a.is_signer);
    expect(signers.map((a) => a.pubkey)).toEqual([user, user]);
  });

  it("ensures the wSOL ATA + the MangoAccount BEFORE depositing", async () => {
    const { signer } = recordingSigner();
    const calls: string[] = [];
    const ensureAta = vi.fn(async (m: string) => {
      calls.push("ata:" + m);
    });
    const ensureAccount = vi.fn(async () => {
      calls.push("account");
    });
    await supplyToMango(signer, 42n, { ensureAta, ensureAccount });
    expect(ensureAta).toHaveBeenCalledWith(ROME_CHAIN.wsolMint);
    expect(ensureAccount).toHaveBeenCalledOnce();
    // both guards ran before the deposit was built/sent
    expect(calls).toEqual(["ata:" + ROME_CHAIN.wsolMint, "account"]);
  });
});

describe("withdrawFromMango — pull wSOL back out (never borrows)", () => {
  it("sends one CPI-precompile tx whose calldata IS the exact token_withdraw invoke", async () => {
    const { signer, sent } = recordingSigner();
    await withdrawFromMango(signer, 500_000_000n, { ensureAta: async () => {} });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(CPI_PRECOMPILE);

    const got = decodeInvoke(sent[0]!.data);
    const want = buildMangoTokenWithdrawInvoke({
      userEvmAddress: USER,
      groupHex: MANGO_SOL_BANK.groupHex,
      mintHex: MANGO_SOL_BANK.mintHex,
      bank,
      amount: 500_000_000n,
    });
    expect(got.accounts).toEqual(want.accounts); // 8 accounts, no tokenAuthority
    expect(got.data).toBe(want.data); // allowBorrow = false
  });

  it("ensures the destination wSOL ATA exists (to receive the withdrawal)", async () => {
    const { signer } = recordingSigner();
    const ensureAta = vi.fn(async () => {});
    await withdrawFromMango(signer, 1n, { ensureAta });
    expect(ensureAta).toHaveBeenCalledWith(ROME_CHAIN.wsolMint);
  });
});

describe("ensureMangoAccount — create-if-missing (idempotent, self-custody)", () => {
  it("no-ops when the MangoAccount already exists", async () => {
    const { signer, sent } = recordingSigner();
    const created = await ensureMangoAccount(signer, { exists: async () => true });
    expect(created).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("sends account_create when the MangoAccount is absent", async () => {
    const { signer, sent } = recordingSigner();
    const created = await ensureMangoAccount(signer, { exists: async () => false, ensureRent: async () => {} });
    expect(created).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(CPI_PRECOMPILE);

    const got = decodeInvoke(sent[0]!.data);
    const want = buildMangoAccountCreateInvoke({
      userEvmAddress: USER,
      groupHex: MANGO_SOL_BANK.groupHex,
    });
    expect(got.accounts).toEqual(want.accounts); // 5 accounts (group/account/owner/payer/system)
    expect(got.data).toBe(want.data);
  });

  it("self-funds the PDA rent BEFORE creating (lend never unwraps → a first-time PDA has no lamports)", async () => {
    const { signer } = recordingSigner();
    const order: string[] = [];
    const ensureRent = vi.fn(async () => { order.push("rent"); });
    const origSend = signer.sendRomeTx;
    signer.sendRomeTx = async (to, data, gas) => { order.push("create"); return origSend(to, data, gas); };
    await ensureMangoAccount(signer, { exists: async () => false, ensureRent });
    expect(ensureRent).toHaveBeenCalledOnce();
    expect(order).toEqual(["rent", "create"]); // rent funded first, THEN the create tx
  });

  it("does NOT touch rent when the account already exists (returning supplier)", async () => {
    const { signer } = recordingSigner();
    const ensureRent = vi.fn(async () => {});
    await ensureMangoAccount(signer, { exists: async () => true, ensureRent });
    expect(ensureRent).not.toHaveBeenCalled();
  });
});

describe("ensurePdaLamports — lazily self-fund the Rome PDA from the user's own gas (swap_gas_to_lamports)", () => {
  const HELPER = "0xff00000000000000000000000000000000000009";
  it("tops up the deficit (+buffer) via a HelperProgram swap-gas tx when the PDA is short", async () => {
    const { signer, sent } = recordingSigner();
    const toppedUp = await ensurePdaLamports(signer, 30_000_000n, {
      read: async () => 10_000_000n, bufferLamports: 2_000_000n,
    });
    expect(toppedUp).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to.toLowerCase()).toBe(HELPER); // 0xFF..09, not the CPI precompile
    // amount = deficit (30M-10M) + buffer (2M) = 22M, ABI-encoded uint64 (big-endian, 32-byte word)
    const argWord = (22_000_000n).toString(16).padStart(64, "0");
    expect(sent[0]!.data.toLowerCase().endsWith(argWord)).toBe(true);
  });

  it("no-ops when the PDA already meets the target", async () => {
    const { signer, sent } = recordingSigner();
    const toppedUp = await ensurePdaLamports(signer, 30_000_000n, { read: async () => 40_000_000n });
    expect(toppedUp).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
