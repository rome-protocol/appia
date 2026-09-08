/**
 * Client-side leg drivers — each drives ONE journey leg against live rails and resolves when the
 * leg is verifiably done (balance/receipt observed, never assumed). Every Rome write goes through a
 * RomeSigner (self-custody: the user's own wallet; harness: a raw key). Appia has NO session key.
 */
import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import { CPI_INVOKE_ABI, CPI_PRECOMPILE } from "./rome/cpi-precompile";
import { buildCloseAccountInvoke } from "./rome/spl-close";
import { buildChainMeteoraSwapInvoke } from "./rome/meteora-swap";
import { ROME_METEORA_POOL } from "./rome/meteora-pool";
import { buildMarinadeDepositInvoke } from "./rome/marinade-instructions";
import { fetchMarinadeState } from "./rome/marinade-state";
import { MARINADE_STATE_BS58 } from "./rome/marinade-program";
import { MANGO_SOL_BANK } from "./rome/mango-config";
import {
  buildMangoAccountCreateInvoke,
  buildMangoTokenDepositInvoke,
  buildMangoTokenWithdrawInvoke,
} from "./rome/mango-instructions";
import { deriveMangoAccount } from "./rome/mango-pdas";
import { bytes32ToPublicKey, deriveAta, deriveRomeUserPda, pubkeyBs58ToBytes32 } from "./rome/solana-pda";
import { ROME_CHAIN } from "./rome/rome-config";
import { encodeTransferNativeToWormhole, evmRecipient32, encodeApproveSplGrant, HELPER_PROGRAM } from "./egress";
import type { RomeSigner } from "./rome-signer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: T; error?: unknown };
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result as T;
}
/** /api/rpc/rome proxy caller — exported so the browser can build a walletRomeSigner that confirms
 *  Rome receipts through the same proxy the reads use. */
export const romeRpc = <T,>(m: string, p: unknown[]) => rpc<T>("/api/rpc/rome", m, p);
export const solRpc = <T,>(m: string, p: unknown[]) => rpc<T>("/api/rpc/solana", m, p);

const invokeData = (inv: { program: Hex; accounts: unknown[]; data: Hex }) =>
  encodeFunctionData({ abi: CPI_INVOKE_ABI, functionName: "invoke", args: [inv.program, inv.accounts as never, inv.data] });

function ataFor(address: Address, mintB58: string): string {
  return bytes32ToPublicKey(deriveAta(deriveRomeUserPda(address), pubkeyBs58ToBytes32(mintB58))).toBase58();
}

export async function ataBalance(signer: RomeSigner, mintB58: string): Promise<bigint> {
  try {
    const b = await solRpc<{ value: { amount: string } }>("getTokenAccountBalance", [ataFor(signer.address, mintB58)]);
    return BigInt(b.value.amount);
  } catch { return 0n; }
}

export async function pdaLamports(signer: RomeSigner): Promise<bigint> {
  const pda = bytes32ToPublicKey(deriveRomeUserPda(signer.address)).toBase58();
  const b = await solRpc<{ value: number }>("getBalance", [pda]);
  return BigInt(b.value);
}

/** unwrap→stake confirmation gate. DELTA-gated on the PDA lamports (baseline captured BEFORE the
 * unwrap), never a static threshold — the Solana RPC lags the Rome tx AND the user's PDA is stable
 * across their journeys, so it may carry residual lamports from a prior journey; a static ">6M" read
 * let stake build from a stale/residual balance and under-stake the fresh unwrap (~0.5 SOL stranded
 * once). Waits until the PDA rises by ~`expectedIncrease` (the unwrapped wSOL, 9dp = lamports 1:1;
 * the released ATA rent makes the real rise strictly larger), then returns the CONFIRMED balance for
 * the caller to stake from. read/sleep injectable for tests. Same fix class as watchDelivered. */
export async function awaitPdaCredit(
  signer: RomeSigner,
  baseline: bigint,
  expectedIncrease: bigint,
  opts: { timeoutMs?: number; toleranceBps?: number; read?: () => Promise<bigint>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<bigint> {
  const read = opts.read ?? (() => pdaLamports(signer));
  const wait = opts.sleep ?? sleep;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const target = baseline + (expectedIncrease * BigInt(10_000 - (opts.toleranceBps ?? 100))) / 10_000n;
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("unwrap credit timeout — see the claim center; funds are recoverable");
    const cur = await read();
    if (cur >= target) return cur;
    await wait(3000);
  }
}

/** Wait until an ATA balance reaches an absolute floor `atLeast`. Used after a resume-swap to confirm
 * the wSOL landed on the Solana side before the chained unwrap reads it — the swap confirmed on Rome but
 * the Solana RPC lags, and the resume unwrap guards on a non-zero wSOL balance, so reading too early
 * would false-negative. The swap guarantees ≥ its minimumOut, so that floor is the gate. read/sleep
 * injectable for tests. */
export async function awaitAtaCredit(
  signer: RomeSigner,
  mintB58: string,
  atLeast: bigint,
  opts: { timeoutMs?: number; read?: () => Promise<bigint>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<bigint> {
  const read = opts.read ?? (() => ataBalance(signer, mintB58));
  const wait = opts.sleep ?? sleep;
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000;
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("swap credit timeout — see the claim center; funds are recoverable");
    const cur = await read();
    if (cur >= atLeast) return cur;
    await wait(3000);
  }
}

/** delivered: wait until the user's USDC ATA RISES by ~the expected delivery. DELTA-gated (baseline
 * captured at entry), never a static threshold — the user's PDA-ATA is stable across their journeys,
 * so residual USDC from a prior run must NOT satisfy the gate (a static threshold false-completed
 * "Arrives on Solana" in ~5s off leftover funds). read/sleep injectable for tests. */
export async function watchDelivered(
  signer: RomeSigner,
  expectedIncrease6: bigint,
  opts: { timeoutMs?: number; toleranceBps?: number; read?: () => Promise<bigint>; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const read = opts.read ?? (() => ataBalance(signer, ROME_CHAIN.usdcMint));
  const wait = opts.sleep ?? sleep;
  const timeoutMs = opts.timeoutMs ?? 25 * 60_000;
  const baseline = await read();
  // require the balance to climb by the delivered amount (1% tolerance for rounding)
  const target = baseline + (expectedIncrease6 * BigInt(10_000 - (opts.toleranceBps ?? 100))) / 10_000n;
  const t0 = Date.now();
  for (;;) {
    if (Date.now() - t0 > timeoutMs) throw new Error("delivery timeout — see the claim center; funds are recoverable");
    if ((await read()) >= target) return;
    await wait(10_000);
  }
}

/** fuel: operator fronts Rome gas to the USER's own Rome address (reimbursed via the fee).
 *  Sends both keys for a safe route migration (the route reads `address ?? sessionAddress`). */
export async function requestFuel(signer: RomeSigner): Promise<void> {
  const r = await fetch("/api/drip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: signer.address, sessionAddress: signer.address }),
  });
  const j = (await r.json()) as { ok?: boolean; error?: string };
  if (!j.ok) throw new Error(j.error ?? "fuel drip failed");
}

// HelperProgram.create_ata(address,bytes32) at 0xFF..09 — the OPERATOR funds the ATA
// rent (create_ata_internal signs as state.signer()); the user pays the equivalent in gas.
// The external_auth PDA is NEVER the payer, so no PDA reserve / activation is required.
const CREATE_ATA_ABI = [{ name: "create_ata", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes32" }], outputs: [] }] as const;

/** ensure an ATA exists via the operator-funded primitive — idempotent, no PDA reserve.
 *  Replaces the retired hand-rolled buildAtaInitInvoke (which named the PDA as payer). */
export async function ensureAta(signer: RomeSigner, mintB58: string): Promise<void> {
  const exists = await solRpc<{ value: unknown }>("getAccountInfo", [ataFor(signer.address, mintB58), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  if (exists.value) return;
  await signer.sendRomeTx(HELPER_PROGRAM, encodeFunctionData({ abi: CREATE_ATA_ABI, functionName: "create_ata", args: [signer.address, pubkeyBs58ToBytes32(mintB58)] }));
}

/** swap: USDC → wSOL on the canonical Meteora pool (A=WSOL ⇒ USDC in = BToA). */
export async function swapUsdcToWsol(signer: RomeSigner, amountIn6: bigint, minOut9: bigint): Promise<string> {
  await ensureAta(signer, ROME_CHAIN.wsolMint); // output ATA must exist first (was the cold-path Custom(3012))
  const inv = buildChainMeteoraSwapInvoke({
    userEvmAddress: signer.address, direction: "BToA",
    amountIn: amountIn6, minimumOut: minOut9, pool: ROME_METEORA_POOL,
  });
  return signer.sendRomeTx(CPI_PRECOMPILE, invokeData(inv));
}

/** unwrap: close the wSOL ATA → lamports land on the user's PDA. */
export async function unwrapWsol(signer: RomeSigner): Promise<string> {
  const inv = buildCloseAccountInvoke({ userEvmAddress: signer.address, mintB58: ROME_CHAIN.wsolMint });
  return signer.sendRomeTx(CPI_PRECOMPILE, invokeData(inv));
}

/** stake: Marinade deposit(lamports) → mSOL to the user's PDA's ATA. */
export async function stakeMarinade(signer: RomeSigner, lamports: bigint): Promise<string> {
  await ensureAta(signer, ROME_CHAIN.msolMint); // operator-funded; no PDA reserve
  // live State decode (cardo marinade-state.ts, verified on-chain 2026-07-05)
  const state = await fetchMarinadeState("/api/rpc/solana", MARINADE_STATE_BS58);
  const inv = buildMarinadeDepositInvoke({
    userEvmAddress: signer.address,
    msolMint: state.msolMint,
    msolLeg: state.msolLeg,
    lamports,
  });
  return signer.sendRomeTx(CPI_PRECOMPILE, invokeData(inv));
}

// ── Mango v4 lend (P3): supply / withdraw wSOL into the SOL bank. Self-custody —
// every signer slot is the user's Rome PDA (the CPI precompile auto-signs as
// msg.sender). Bank vault/oracle come from the verified, immutable MANGO_SOL_BANK
// config; the deposit amount comes from the caller's live wSOL balance. ──

const MANGO_BANK_ARG = {
  pubkey: MANGO_SOL_BANK.bankHex,
  vault: MANGO_SOL_BANK.vaultHex,
  oracle: MANGO_SOL_BANK.oracleHex,
} as const;

/** Does the user's MangoAccount PDA exist on-chain yet? */
export async function mangoAccountExists(signer: RomeSigner): Promise<boolean> {
  const acct = bytes32ToPublicKey(
    deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: deriveRomeUserPda(signer.address) }),
  ).toBase58();
  const info = await solRpc<{ value: unknown }>("getAccountInfo", [
    acct,
    { encoding: "base64", dataSlice: { offset: 0, length: 0 } },
  ]);
  return !!info.value;
}

// Mango v4 MangoAccount allocated size for the default slot counts (8 token / 0 serum3 / 0 perp /
// 0 perpOo) — used only to READ its rent-exempt minimum live (getMinimumBalanceForRentExemption).
// A generous fixed size (a fresh default MangoAccount is ~2.4KB); over-reading rent is safe — the
// reserve lands in the user's OWN PDA and is fully refunded to them when they close the account.
const MANGO_ACCOUNT_SPACE = 2560;

const SWAP_GAS_ABI = [{ name: "swap_gas_to_lamports", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint64" }], outputs: [] }] as const;

/** Convert some of the user's Rome gas into native lamports on their own Rome PDA, via HelperProgram
 *  0xFF..09 `swap_gas_to_lamports` (self-custody, lazy — the same primitive the outbound egress uses). */
export async function swapGasToLamports(signer: RomeSigner, lamports: bigint): Promise<string> {
  return signer.sendRomeTx(HELPER_PROGRAM, encodeFunctionData({ abi: SWAP_GAS_ABI, functionName: "swap_gas_to_lamports", args: [lamports] }));
}

/** Ensure the user's Rome PDA holds ≥ `targetLamports`; top up the deficit (+ a small buffer) from
 *  their own Rome gas. Returns true if it topped up. read/topUp injectable for tests. The lend journey
 *  never unwraps (unlike stake), so a first-time supplier's PDA holds no lamports for a downstream
 *  create that names it as rent-payer — this funds that lazily, self-custody, reclaimable on close. */
export async function ensurePdaLamports(
  signer: RomeSigner,
  targetLamports: bigint,
  opts: { bufferLamports?: bigint; read?: () => Promise<bigint>; topUp?: (lamports: bigint) => Promise<unknown> } = {},
): Promise<boolean> {
  const read = opts.read ?? (() => pdaLamports(signer));
  const topUp = opts.topUp ?? ((amt: bigint) => swapGasToLamports(signer, amt));
  const cur = await read();
  if (cur >= targetLamports) return false;
  await topUp(targetLamports - cur + (opts.bufferLamports ?? 2_000_000n));
  return true;
}

/** Fund the MangoAccount rent on the user's PDA — rent read LIVE, topped up from the user's gas. */
async function ensureMangoAccountRent(signer: RomeSigner): Promise<void> {
  const rent = await solRpc<number>("getMinimumBalanceForRentExemption", [MANGO_ACCOUNT_SPACE]);
  await ensurePdaLamports(signer, BigInt(rent));
}

/** Ensure the user's MangoAccount exists — `account_create` (self-custody) iff absent. When it must
 *  create, it self-funds the PDA rent FIRST (lend never unwraps → the PDA may be empty). Idempotent;
 *  returns true when it created one. `exists` / `ensureRent` injectable for tests. */
export async function ensureMangoAccount(
  signer: RomeSigner,
  opts: { exists?: () => Promise<boolean>; ensureRent?: () => Promise<unknown> } = {},
): Promise<boolean> {
  const exists = opts.exists ?? (() => mangoAccountExists(signer));
  if (await exists()) return false;
  await (opts.ensureRent ?? (() => ensureMangoAccountRent(signer)))(); // fund rent BEFORE the create
  const inv = buildMangoAccountCreateInvoke({ userEvmAddress: signer.address, groupHex: MANGO_SOL_BANK.groupHex });
  await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(inv));
  return true;
}

/** supply: deposit wSOL (from the user's ATA) into the Mango SOL bank → earns lending APY.
 *  Ensures the wSOL ATA (source) + the MangoAccount first. `amount9` = native wSOL (9dp). */
export async function supplyToMango(
  signer: RomeSigner,
  amount9: bigint,
  opts: { ensureAta?: (mintB58: string) => Promise<void>; ensureAccount?: () => Promise<unknown> } = {},
): Promise<string> {
  await (opts.ensureAta ?? ((m: string) => ensureAta(signer, m)))(ROME_CHAIN.wsolMint);
  await (opts.ensureAccount ?? (() => ensureMangoAccount(signer)))();
  const inv = buildMangoTokenDepositInvoke({
    userEvmAddress: signer.address,
    groupHex: MANGO_SOL_BANK.groupHex,
    mintHex: MANGO_SOL_BANK.mintHex,
    bank: MANGO_BANK_ARG,
    amount: amount9,
  });
  return signer.sendRomeTx(CPI_PRECOMPILE, invokeData(inv));
}

/** withdraw: pull wSOL from the Mango SOL bank back to the user's ATA (never borrows —
 *  borrow is P4 with its own health UX). Ensures the destination wSOL ATA exists first. */
export async function withdrawFromMango(
  signer: RomeSigner,
  amount9: bigint,
  opts: { ensureAta?: (mintB58: string) => Promise<void> } = {},
): Promise<string> {
  await (opts.ensureAta ?? ((m: string) => ensureAta(signer, m)))(ROME_CHAIN.wsolMint);
  const inv = buildMangoTokenWithdrawInvoke({
    userEvmAddress: signer.address,
    groupHex: MANGO_SOL_BANK.groupHex,
    mintHex: MANGO_SOL_BANK.mintHex,
    bank: MANGO_BANK_ARG,
    amount: amount9,
  });
  return signer.sendRomeTx(CPI_PRECOMPILE, invokeData(inv));
}

/**
 * deliver-home (v11 native egress): the user's approve_spl(bridge, amount, mint) grant on
 * HelperProgram, then transferNativeToWormhole on RomeBridgeWithdraw — both signed by the USER's
 * own wallet, sending the mSOL/wSOL to the token bridge's custody with the user's L2 wallet as the
 * VAA recipient. v10 pulls the SPL as the user's delegate, so the grant is the user's own tx. The redeem on the L2 is a
 * separate, permissionless completeTransfer (v1: user-signed). Active only once the registry flips
 * to v11 AND the asset is allowlisted on it (D2 — every supported asset is allowlisted).
 */
export async function deliverNative(
  signer: RomeSigner,
  opts: { wrapper: string; mint: string; amount: bigint; recipientEvm: string; targetChain: number },
): Promise<{ approveTx: string; egressTx: string }> {
  const withdraw = ROME_CHAIN.bridgeWithdraw as Address;
  const approveTx = await signer.sendRomeTx(HELPER_PROGRAM, encodeApproveSplGrant(withdraw, opts.amount, opts.mint), 100_000_000n);
  const egressTx = await signer.sendRomeTx(
    withdraw,
    encodeTransferNativeToWormhole(opts.wrapper, opts.amount, evmRecipient32(opts.recipientEvm), opts.targetChain),
    100_000_000n,
  );
  return { approveTx, egressTx };
}
