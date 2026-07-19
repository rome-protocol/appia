// Funded /lend proof rig — drives supply → read position → withdraw on-chain against the LIVE Rome
// devnet (Hadrian) + Mango v4, self-custody (the user's OWN key signs every leg via keyRomeSigner —
// no session key). Exercises the REAL 3a builders + the 3c reader (the load-bearing on-chain code);
// the thin driver wrappers (supplyToMango/…) are unit-tested separately. Delta-based so a pre-existing
// position doesn't confuse it. Reads the funding key from $E2E_KEY_FILE (never printed).
// Amount: tiny (0.005 SOL), fully reversed at the end.
import { encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { keyRomeSigner } from "./src/rome-signer.js";
import { CPI_INVOKE_ABI, CPI_PRECOMPILE } from "./src/rome/cpi-precompile.js";
import { buildMangoAccountCreateInvoke, buildMangoTokenDepositInvoke, buildMangoTokenWithdrawInvoke } from "./src/rome/mango-instructions.js";
import { parseMangoDepositedNative } from "./src/rome/mango-state.js";
import { deriveMangoAccount } from "./src/rome/mango-pdas.js";
import { MANGO_SOL_BANK } from "./src/rome/mango-config.js";
import { bytes32ToPublicKey, deriveAta, deriveRomeUserPda, pubkeyBs58ToBytes32 } from "./src/rome/solana-pda.js";
import { ROME_CHAIN } from "./src/rome/rome-config.js";

const ROME = "https://hadrian.testnet.romeprotocol.xyz";
const SOL = ROME_CHAIN.solanaRpc;
const AMOUNT = 5_000_000n; // 0.005 wSOL (9dp)
const raw = readFileSync(process.env.E2E_KEY_FILE ?? "./e2e-funding.key", "utf8").trim();
const tkey = (raw.startsWith("0x") ? raw : "0x" + raw) as Hex;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function rpc<T>(url: string, m: string, p: unknown[]): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
  const j: any = await r.json(); if (j.error) throw new Error(m + ": " + JSON.stringify(j.error)); return j.result;
}
const romeRpc = <T,>(m: string, p: unknown[]) => rpc<T>(ROME, m, p);
const solRpc = <T,>(m: string, p: unknown[]) => rpc<T>(SOL, m, p);
const invokeData = (inv: any) => encodeFunctionData({ abi: CPI_INVOKE_ABI, functionName: "invoke", args: [inv.program, inv.accounts, inv.data] });

const signer = keyRomeSigner(tkey, { rpc: romeRpc, chainId: ROME_CHAIN.chainId });
const addr = privateKeyToAccount(tkey).address as Address;
const owner = deriveRomeUserPda(addr);
const mangoB58 = bytes32ToPublicKey(deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: owner })).toBase58();
const bankB58 = bytes32ToPublicKey(MANGO_SOL_BANK.bankHex).toBase58();
const wsolAtaB58 = bytes32ToPublicKey(deriveAta(owner, pubkeyBs58ToBytes32(ROME_CHAIN.wsolMint))).toBase58();
const bankArg = { pubkey: MANGO_SOL_BANK.bankHex, vault: MANGO_SOL_BANK.vaultHex, oracle: MANGO_SOL_BANK.oracleHex };

async function wsolBal(): Promise<bigint> { try { const b = await solRpc<any>("getTokenAccountBalance", [wsolAtaB58]); return BigInt(b.value.amount); } catch { return 0n; } }
async function supplied(): Promise<bigint | null> {
  const res = await solRpc<any>("getMultipleAccounts", [[mangoB58, bankB58], { encoding: "base64", commitment: "confirmed" }]);
  const [a, bk] = res.value ?? [];
  if (!a || !bk) return a ? null : 0n;
  return parseMangoDepositedNative({ mangoAccountData: Buffer.from(a.data[0], "base64"), bankData: Buffer.from(bk.data[0], "base64"), ownerPdaHex: owner, groupHex: MANGO_SOL_BANK.groupHex, bankMintHex: MANGO_SOL_BANK.mintHex });
}
async function waitSupplied(pred: (v: bigint) => boolean, label: string): Promise<bigint> {
  for (let i = 0; i < 15; i++) { const v = await supplied(); if (v != null && pred(v)) return v; await sleep(3000); }
  throw new Error(`timeout waiting for supplied ${label}`);
}
const fmt = (v: bigint) => (Number(v) / 1e9).toFixed(6);

(async () => {
  console.log(`funded /lend drive — user ${addr} (self-custody, one key signs every leg)`);
  console.log(`  MangoAccount ${mangoB58}  wSOL ATA ${wsolAtaB58}`);

  const wsol0 = await wsolBal();
  const sup0 = await supplied();
  if (sup0 == null) throw new Error("baseline supplied unreadable");
  console.log(`\nBASELINE: wallet wSOL ${fmt(wsol0)} · supplied ${fmt(sup0)} SOL`);
  if (wsol0 < AMOUNT) throw new Error(`not enough wSOL to supply (have ${fmt(wsol0)}, need ${fmt(AMOUNT)})`);

  // ensure the MangoAccount exists (mirrors ensureMangoAccount; treasury's already exists → no-op)
  const acctInfo = await solRpc<any>("getAccountInfo", [mangoB58, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  if (!acctInfo.value) { console.log("MangoAccount absent → account_create"); await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(buildMangoAccountCreateInvoke({ userEvmAddress: addr, groupHex: MANGO_SOL_BANK.groupHex }))); }
  else console.log("MangoAccount exists → skip account_create");

  // ── SUPPLY 0.005 SOL ──
  const supplyTx = await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(buildMangoTokenDepositInvoke({ userEvmAddress: addr, groupHex: MANGO_SOL_BANK.groupHex, mintHex: MANGO_SOL_BANK.mintHex, bank: bankArg, amount: AMOUNT })));
  const supAfterDep = await waitSupplied((v) => v >= sup0 + (AMOUNT * 99n) / 100n, "to rise by ~0.005");
  const wsolAfterDep = await wsolBal();
  console.log(`\nSUPPLY ${fmt(AMOUNT)} SOL  tx ${supplyTx}`);
  console.log(`  supplied ${fmt(sup0)} → ${fmt(supAfterDep)}  (+${fmt(supAfterDep - sup0)})`);
  console.log(`  wallet wSOL ${fmt(wsol0)} → ${fmt(wsolAfterDep)}  (${fmt(wsolAfterDep - wsol0)})`);

  // ── WITHDRAW 0.005 SOL ──
  const withdrawTx = await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(buildMangoTokenWithdrawInvoke({ userEvmAddress: addr, groupHex: MANGO_SOL_BANK.groupHex, mintHex: MANGO_SOL_BANK.mintHex, bank: bankArg, amount: AMOUNT })));
  const supAfterWd = await waitSupplied((v) => v <= supAfterDep - (AMOUNT * 99n) / 100n, "to fall back");
  const wsolAfterWd = await wsolBal();
  console.log(`\nWITHDRAW ${fmt(AMOUNT)} SOL  tx ${withdrawTx}`);
  console.log(`  supplied ${fmt(supAfterDep)} → ${fmt(supAfterWd)}  (${fmt(supAfterWd - supAfterDep)})`);
  console.log(`  wallet wSOL ${fmt(wsolAfterDep)} → ${fmt(wsolAfterWd)}  (+${fmt(wsolAfterWd - wsolAfterDep)})`);

  const roundTripOk = supAfterDep - sup0 >= (AMOUNT * 99n) / 100n && wsolAfterWd >= wsol0 - (AMOUNT / 100n);
  console.log(`\n${roundTripOk ? "✅" : "❌"} round-trip: supply landed in Mango (reader saw +${fmt(supAfterDep - sup0)}), withdraw returned it (wallet back to ${fmt(wsolAfterWd)}).`);
  console.log(JSON.stringify({ user: addr, supplyTx, withdrawTx, sup0: sup0.toString(), supAfterDep: supAfterDep.toString(), supAfterWd: supAfterWd.toString(), wsol0: wsol0.toString(), wsolAfterWd: wsolAfterWd.toString() }));
  if (!roundTripOk) process.exit(1);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
