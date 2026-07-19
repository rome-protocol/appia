// Full Appia EARN journey, instrumented, driven headless with the REAL app builders. CCTP inbound
// (wrapper) goes through the DEPLOYED pod; the Rome legs (swap/unwrap/stake) are direct Rome EVM via
// the CPI precompile, SELF-CUSTODY: the user's OWN key signs every leg (keyRomeSigner) — Appia has
// NO session key. Measures signatures + per-leg wall time.
import { createWalletClient, createPublicClient, http, encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { keyRomeSigner } from "./src/rome-signer.js";
import { encodeApproveWormholeBurn, encodeTransferNativeToWormhole, evmRecipient32, WORMHOLE_CHAIN_IDS } from "./src/egress.js";
import { CPI_INVOKE_ABI, CPI_PRECOMPILE } from "./src/rome/cpi-precompile.js";
import { buildCloseAccountInvoke } from "./src/rome/spl-close.js";
import { buildChainMeteoraSwapInvoke } from "./src/rome/meteora-swap.js";
import { ROME_METEORA_POOL } from "./src/rome/meteora-pool.js";
import { buildMarinadeDepositInvoke } from "./src/rome/marinade-instructions.js";
import { fetchMarinadeState } from "./src/rome/marinade-state.js";
import { MARINADE_STATE_BS58 } from "./src/rome/marinade-program.js";
import { bytes32ToPublicKey, deriveAta, deriveRomeUserPda, pubkeyBs58ToBytes32 } from "./src/rome/solana-pda.js";
import { ROME_CHAIN } from "./src/rome/rome-config.js";
import { awaitPdaCredit } from "./src/drivers.js";

const POD = "https://bridge-api.devnet.romeprotocol.xyz";
const ROME = "https://hadrian.testnet.romeprotocol.xyz";
const SOL = ROME_CHAIN.solanaRpc;
const SRC = Number(process.env.SRC_CHAIN ?? "11155111");   // source L2 (default Sepolia)
const SEP = process.env.SRC_RPC ?? process.env.SEP_RPC!;    // source RPC
const SRC_CHAIN_VIEM = { id: SRC, name: "src", nativeCurrency: { name: "n", symbol: "NAT", decimals: 18 }, rpcUrls: { default: { http: [SEP] } } };
const tkey = (process.env.TKEY!.startsWith("0x") ? process.env.TKEY! : "0x" + process.env.TKEY!) as Hex;
const solPayer = Keypair.fromSecretKey(Buffer.from(JSON.parse(readFileSync(process.env.SOL_KEY!, "utf8"))));
const AMOUNT = "1200000"; // 1.2 USDC

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j: any = await r.json(); if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`); return j.result;
}
const romeRpc = <T,>(m: string, p: unknown[]) => rpc<T>(ROME, m, p);
const solRpc = <T,>(m: string, p: unknown[]) => rpc<T>(SOL, m, p);
const invokeData = (inv: any) => encodeFunctionData({ abi: CPI_INVOKE_ABI, functionName: "invoke", args: [inv.program, inv.accounts, inv.data] });

// SELF-CUSTODY: the user's OWN key is the Rome identity + signs every leg (each = a real wallet
// popup in the browser). keyRomeSigner is the headless stand-in for that wallet — NOT a session key.
const signer = keyRomeSigner(tkey, { rpc: romeRpc, chainId: ROME_CHAIN.chainId });

// HelperProgram.create_ata(address,bytes32) 0xFF..09 — OPERATOR funds the ATA rent, user pays via
// gas. The external_auth PDA is NEVER the payer, so no PDA reserve is required.
const HELPER_PROGRAM = "0xff00000000000000000000000000000000000009" as Address;
const CREATE_ATA_ABI = [{ name: "create_ata", type: "function", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bytes32" }], outputs: [] }] as const;
const createAta = (mintB58: string) =>
  signer.sendRomeTx(HELPER_PROGRAM, encodeFunctionData({ abi: CREATE_ATA_ABI, functionName: "create_ata", args: [signer.address, pubkeyBs58ToBytes32(mintB58)] }));
const userAtaB58 = (mintB58: string) => bytes32ToPublicKey(deriveAta(deriveRomeUserPda(signer.address), pubkeyBs58ToBytes32(mintB58))).toBase58();
async function ataBal(mintB58: string): Promise<bigint> { try { const b = await solRpc<any>("getTokenAccountBalance", [userAtaB58(mintB58)]); return BigInt(b.value.amount); } catch { return 0n; } }

const T: Record<string, number> = {}; const sigs: string[] = [];
(async () => {
  const user = privateKeyToAccount(tkey);
  console.log("MODE: SELF-CUSTODY (user signs every leg) — no session key");
  const wallet = createWalletClient({ account: user, chain: SRC_CHAIN_VIEM, transport: http(SEP) });
  const pub = createPublicClient({ chain: SRC_CHAIN_VIEM, transport: http(SEP) });
  console.log(`user (L2 + Rome identity) = ${user.address}`);

  // --- QUOTE (wrapper) — deliver USDC to the USER's OWN Rome PDA-ATA ---
  const q: any = await (await fetch(POD + "/v1/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ asset: "USDC", direction: "to-rome", sourceChain: "eip155:"+SRC, romeChainId: "200010", amount: AMOUNT, intent: "wrapper", speed: "fast", sender: { ethereum: user.address }, recipient: user.address }) })).json();

  // --- LEG 1: burn (USER-SIGNED: approve + deposit) ---
  T.burnStart = now();
  let burnTx = "";
  for (const tx of q.steps[0].unsignedTxs) {
    const h = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
    const rc = await pub.waitForTransactionReceipt({ hash: h as Hex });
    if (rc.status !== "success") throw new Error(`burn step to ${tx.to} reverted (${h})`);
    burnTx = h; sigs.push("USER: " + (tx === q.steps[0].unsignedTxs[0] ? "approve" : "burn"));
    await sleep(5000); // settle gate: let the RPC reflect the approve before the deposit's gas estimate (read-after-write)
  }
  T.burnDone = now();

  // --- register with deployed pod (wrapper; inject recipient+intent like the app) ---
  const reg: any = await (await fetch(POD + "/v1/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: { ...q, recipient: user.address, intent: "wrapper" }, step1TxHash: burnTx }) })).json();
  T.registered = now(); console.log(`burn ${burnTx} → pod ${reg.id} (${reg.stamp?.cctpVersion ? "V" + reg.stamp.cctpVersion : reg.code})`);

  // --- LEG 2: delivered (PASSIVE — pod worker) ---
  const min = BigInt(q.amountOut);
  for (;;) { if (await ataBal(ROME_CHAIN.usdcMint) >= min) break; if (now() - T.registered > 20 * 60_000) throw new Error("delivery timeout"); await sleep(5000); }
  T.delivered = now();

  // --- LEG 3: fuel (OPERATOR fronts Rome gas to the USER's address via /api/drip — chain-sourced) ---
  const APPIA = process.env.APPIA_URL ?? "https://appia.devnet.romeprotocol.xyz";
  const dripRes: any = await (await fetch(APPIA + "/api/drip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: user.address, sessionAddress: user.address }) })).json();
  if (!dripRes.ok) throw new Error("drip failed: " + JSON.stringify(dripRes));
  console.log(`fuel via /api/drip: ${dripRes.value ? (Number(dripRes.value) / 1e18).toFixed(3) + " gas @ " + (Number(dripRes.gasPrice) / 1e9).toFixed(1) + " Gwei" : dripRes.note ?? "ok"}`);
  const conn = new Connection(SOL, "confirmed");
  const pda = bytes32ToPublicKey(deriveRomeUserPda(signer.address));
  const bal = await conn.getBalance(pda);
  if (process.env.SKIP_PDA_FUND) { console.log(`[test] SKIPPING external_auth PDA funding — bal=${bal} lamports (PDA ${pda.toBase58()})`); }
  else if (bal < 12_000_000) { const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: solPayer.publicKey, toPubkey: pda, lamports: 12_000_000 - bal })); const { blockhash } = await conn.getLatestBlockhash("confirmed"); tx.recentBlockhash = blockhash; tx.feePayer = solPayer.publicKey; tx.sign(solPayer); await conn.sendRawTransaction(tx.serialize()); await sleep(4000); }
  T.fueled = now();

  // --- LEG 4: swap USDC→wSOL (USER-SIGNED) ---
  // cold-path: the swap's OUTPUT wSOL ATA must exist first (else Custom(3012) AccountNotInitialized).
  const wsolAtaInfo = await solRpc<any>("getAccountInfo", [userAtaB58(ROME_CHAIN.wsolMint), { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  if (!wsolAtaInfo.value) { await createAta(ROME_CHAIN.wsolMint); sigs.push("USER: wSOL-ata(helper)"); }
  const usdcIn = await ataBal(ROME_CHAIN.usdcMint);
  const swapInv = buildChainMeteoraSwapInvoke({ userEvmAddress: signer.address, direction: "BToA", amountIn: usdcIn, minimumOut: 1n, pool: ROME_METEORA_POOL });
  const swapTx = await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(swapInv)); sigs.push("USER: swap");
  T.swapped = now();
  let wsol = 0n; for (let i = 0; i < 10; i++) { wsol = await ataBal(ROME_CHAIN.wsolMint); if (wsol > 0n) break; await sleep(2000); } // settle read (Solana RPC lags the Rome tx)

  // --- LEND one-shot (LEND=1): SUPPLY the swapped wSOL to Mango — the /lend `lend-keep` terminal
  //     (burn → delivered → fuel → swap → SUPPLY; no unwrap). Proves the composed buy&supply journey. ---
  if (process.env.LEND) {
    const mango = await import("./src/rome/mango-instructions.js");
    const { deriveMangoAccount } = await import("./src/rome/mango-pdas.js");
    const { MANGO_SOL_BANK } = await import("./src/rome/mango-config.js");
    const { parseMangoDepositedNative } = await import("./src/rome/mango-state.js");
    let wsolAmt = 0n; for (let i = 0; i < 15; i++) { wsolAmt = await ataBal(ROME_CHAIN.wsolMint); if (wsolAmt > 0n) break; await sleep(2000); }
    if (wsolAmt === 0n) throw new Error("swap produced no wSOL — cannot supply");
    const owner = deriveRomeUserPda(signer.address);
    const mangoB58 = bytes32ToPublicKey(deriveMangoAccount({ groupHex: MANGO_SOL_BANK.groupHex, ownerHex: owner })).toBase58();
    const acctInfo: any = await solRpc("getAccountInfo", [mangoB58, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
    if (!acctInfo.value) {
      // self-fund the MangoAccount rent on the PDA from the user's Rome gas (lend never unwraps, so the
      // PDA may be empty) — mirrors the shipped ensureMangoAccount → ensurePdaLamports behavior.
      const rent = Number(await solRpc("getMinimumBalanceForRentExemption", [2560]));
      const pdaBal = Number((await solRpc("getBalance", [pda.toBase58()]) as any).value);
      if (pdaBal < rent + 2_000_000) {
        const SWAP_GAS_ABI = [{ name: "swap_gas_to_lamports", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint64" }], outputs: [] }] as const;
        await signer.sendRomeTx(HELPER_PROGRAM, encodeFunctionData({ abi: SWAP_GAS_ABI, functionName: "swap_gas_to_lamports", args: [BigInt(rent + 2_000_000 - pdaBal)] }));
        sigs.push("USER: fund-pda-rent"); await sleep(3000);
        console.log(`self-funded PDA rent for MangoAccount: +${((rent + 2_000_000 - pdaBal) / 1e9).toFixed(4)} SOL (rent ${(rent / 1e9).toFixed(4)})`);
      }
      await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(mango.buildMangoAccountCreateInvoke({ userEvmAddress: signer.address, groupHex: MANGO_SOL_BANK.groupHex }))); sigs.push("USER: mango-account-create");
    }
    const bankArg = { pubkey: MANGO_SOL_BANK.bankHex, vault: MANGO_SOL_BANK.vaultHex, oracle: MANGO_SOL_BANK.oracleHex };
    const supplyTx = await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(mango.buildMangoTokenDepositInvoke({ userEvmAddress: signer.address, groupHex: MANGO_SOL_BANK.groupHex, mintHex: MANGO_SOL_BANK.mintHex, bank: bankArg, amount: wsolAmt })));
    sigs.push("USER: supply"); T.supplied = now();
    await sleep(4000);
    const res: any = await solRpc("getMultipleAccounts", [[mangoB58, bytes32ToPublicKey(MANGO_SOL_BANK.bankHex).toBase58()], { encoding: "base64", commitment: "confirmed" }]);
    const [a, bk] = res.value ?? [];
    const dep = (a && bk) ? parseMangoDepositedNative({ mangoAccountData: Buffer.from(a.data[0], "base64"), bankData: Buffer.from(bk.data[0], "base64"), ownerPdaHex: owner, groupHex: MANGO_SOL_BANK.groupHex, bankMintHex: MANGO_SOL_BANK.mintHex }) : null;
    const ss = (x: string, y: string) => ((T[y] - T[x]) / 1000).toFixed(1);
    console.log("\n── LEND ONE-SHOT (buy & supply) ──");
    console.log(`bridged→swapped→supplied ${wsolAmt} wSOL native to Mango  supplyTx ${supplyTx}`);
    console.log(`✅ Mango deposited now = ${dep} native (${dep != null ? (Number(dep) / 1e9).toFixed(6) : "?"} SOL)`);
    console.log(`burn→supply: ${ss("burnStart", "supplied")}s · USER sigs: ${sigs.length}`);
    console.log(JSON.stringify({ user: user.address, burnTx, swapTx, supplyTx, wsol: wsolAmt.toString(), depositedNative: dep?.toString() }));
    return;
  }

  // --- OUTBOUND test (OUTBOUND=1): deliver wSOL home via v11, PDA funded LAZILY ---
  if (process.env.OUTBOUND) {
    const WSOL_WRAPPER = "0x1dece035621c65a90349b56a801068b439fa4201";
    const bwithdraw = ROME_CHAIN.bridgeWithdraw as Address;
    let wsolAmt = 0n;
    for (let i = 0; i < 15; i++) { wsolAmt = await ataBal(ROME_CHAIN.wsolMint); if (wsolAmt > 0n) break; await sleep(2000); }
    const before = (await solRpc<any>("getBalance", [pda.toBase58()])).value;
    console.log(`\n── OUTBOUND (wSOL→Sepolia via v11 ${bwithdraw.slice(0, 10)}) ──`);
    console.log(`wSOL=${wsolAmt}  external_auth PDA lamports BEFORE=${before} (never pre-funded)`);
    if (wsolAmt === 0n) throw new Error("swap produced no wSOL (read race?) — cannot test outbound");
    // Lazy top-up: fund the PDA (the WH message-account rent-payer) from the user's OWN gas.
    const SWAP_GAS_ABI = [{ name: "swap_gas_to_lamports", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint64" }], outputs: [] }] as const;
    await signer.sendRomeTx(HELPER_PROGRAM, encodeFunctionData({ abi: SWAP_GAS_ABI, functionName: "swap_gas_to_lamports", args: [10_000_000n] }));
    let after = 0; for (let i = 0; i < 12; i++) { after = (await solRpc<any>("getBalance", [pda.toBase58()])).value; if (after >= 5_000_000) break; await sleep(2000); }
    console.log(`swap_gas_to_lamports(10M) ok — PDA lamports AFTER=${after}`);
    // deliverNative: approve + burn (transferNativeToWormhole creates the msg account, payer=PDA)
    const recipientEvm = (process.env.RECIPIENT ?? user.address) as `0x${string}`;
    await signer.sendRomeTx(bwithdraw, encodeApproveWormholeBurn(WSOL_WRAPPER, wsolAmt), 150_000_000n);
    const burnHome = await signer.sendRomeTx(bwithdraw, encodeTransferNativeToWormhole(WSOL_WRAPPER, wsolAmt, evmRecipient32(recipientEvm), WORMHOLE_CHAIN_IDS.sepolia), 200_000_000n);
    console.log(`✅ OUTBOUND burn ok (recipient ${recipientEvm} on Sepolia) — PDA funded LAZILY from user gas: ${burnHome}`);
    console.log(JSON.stringify({ user: user.address, recipient: recipientEvm, wsolAmt: wsolAmt.toString(), burnHome, pdaBefore: before, pdaAfter: after }));
    return;
  }

  // --- LEG 5: unwrap wSOL → lamports (USER-SIGNED) ---
  const pdaBefore = BigInt((await solRpc<any>("getBalance", [pda.toBase58()])).value); // baseline BEFORE unwrap (delta-gate)
  const unwrapInv = buildCloseAccountInvoke({ userEvmAddress: signer.address, mintB58: ROME_CHAIN.wsolMint });
  const unwrapTx = await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(unwrapInv)); sigs.push("USER: unwrap");
  T.unwrapped = now();

  // --- LEG 6: stake → mSOL (USER-SIGNED) ---
  const msolAta = userAtaB58(ROME_CHAIN.msolMint);
  const exists = await solRpc<any>("getAccountInfo", [msolAta, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  if (!exists.value) { await createAta(ROME_CHAIN.msolMint); sigs.push("USER: mSOL-ata(helper)"); }
  // DELTA-gate the credit (shared, tested awaitPdaCredit): wait until the PDA RISES by ~the swapped
  // wSOL, so residual on the user PDA from a prior journey can't under-stake the fresh unwrap.
  const lam = await awaitPdaCredit(signer, pdaBefore, wsol, { read: async () => BigInt((await solRpc<any>("getBalance", [pda.toBase58()])).value), sleep });
  const state = await fetchMarinadeState(SOL, MARINADE_STATE_BS58);
  const stakeInv = buildMarinadeDepositInvoke({ userEvmAddress: signer.address, msolMint: state.msolMint, msolLeg: state.msolLeg, lamports: lam - 5_000_000n });
  const stakeTx = await signer.sendRomeTx(CPI_PRECOMPILE, invokeData(stakeInv)); sigs.push("USER: stake");
  T.staked = now();
  let msol = 0n; for (let i = 0; i < 10; i++) { msol = await ataBal(ROME_CHAIN.msolMint); if (msol > 0n) break; await sleep(2000); } // settle read (Solana RPC lags the Rome tx)

  const s = (a: string, b: string) => ((T[b] - T[a]) / 1000).toFixed(1);
  console.log("\n── EARN JOURNEY (measured) ──");
  console.log(`burn (approve+deposit, USER): ${s("burnStart", "burnDone")}s`);
  console.log(`delivered (pod, passive):     ${s("registered", "delivered")}s`);
  console.log(`fuel (operator drip):         ${s("delivered", "fueled")}s`);
  console.log(`swap (user-signed):           ${s("fueled", "swapped")}s   wSOL=${wsol}`);
  console.log(`unwrap (user-signed):         ${s("swapped", "unwrapped")}s`);
  console.log(`stake (user-signed):          ${s("unwrapped", "staked")}s   mSOL=${msol}`);
  console.log(`TOTAL burn→mSOL:              ${s("burnStart", "staked")}s`);
  console.log(`USER signatures (popups): ${sigs.length}  (self-custody — every leg is user-signed)`);
  console.log(`legs: ${sigs.map((x) => x.replace(/^USER: /, "")).join(" · ")}`);
  console.log(`swapTx=${swapTx}\nunwrapTx=${unwrapTx}\nstakeTx=${stakeTx}`);
  console.log(JSON.stringify({ user: user.address, burnTx, podId: reg.id, swapTx, unwrapTx, stakeTx, wsol: wsol.toString(), msol: msol.toString(), T }, null, 2));
})().catch((e) => { console.error("ERR:", e.message); console.log("partial T:", JSON.stringify(T)); process.exit(1); });
