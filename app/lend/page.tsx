"use client";

/**
 * Appia — Lend (P3, LIVE + one-shot buy-and-supply). Two modes:
 *  • SUPPLY = ONE SHOT: pay USDC from the L2 you're on → bridge → swap → SUPPLY to Mango v4 (the
 *    `lend-keep` journey; no unwrap — Mango takes the wSOL SPL). You never need to "get SOL first".
 *  • WITHDRAW = pull SOL back out of your Mango position (a single Rome-side, user-signed tx).
 * Self-custody throughout (the user's Rome PDA owns the position). Honest: no invented APY (yield accrues
 * in Mango's deposit rate); the supplied balance is read LIVE and hidden if it can't be validated.
 * Same proven engine + drivers as Stake — the terminal leg is `supply` instead of unwrap→stake.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useSendTransaction, useSwitchChain, useConfig } from "wagmi";
import { getBlock, waitForTransactionReceipt, sendTransaction } from "wagmi/actions";
import type { Hex } from "viem";
import { AppBar, CHAIN_NAME } from "../_appbar";
import { isSupportedSource, supportedSourceNames } from "@/src/source-chains";
import { createJourney, advance, type Journey } from "@/src/journey";
import {
  awaitAtaCredit, requestFuel, romeRpc, solRpc,
  supplyToMango, swapUsdcToWsol, watchDelivered, withdrawFromMango,
} from "@/src/drivers";
import { fetchMangoSolDeposited } from "@/src/rome/mango-state";
import { walletRomeSigner, type RomeSigner } from "@/src/rome-signer";
import { ROME_CHAIN } from "@/src/rome/rome-config";
import { burnMaxFees } from "@/src/l2-fees";
import { estimateEta, formatEta } from "@/src/cost-eta";
import { buildLendView } from "@/src/lend-view";

type QuoteResp = {
  podQuote: { amountOut: string; steps: Array<{ unsignedTxs: Array<{ to: Hex; data: Hex; value: string }> }> };
  preview?: boolean;
  feeUsdc6: string; swapInUsdc6: string; estWsol9: string; minWsol9: string; estMsol9: string; solPerMsol: string;
  error?: string;
};
const LEG_COPY: Record<string, { title: string }> = {
  burn: { title: "Left your chain" },
  delivered: { title: "Arrived on Solana" },
  fuel: { title: "Fueled" },
  swap: { title: "Swapped to SOL" },
  supply: { title: "Supplied to Mango — earning" },
};
const ROMAN = ["I", "II", "III", "IV", "V"];
function fmt(units: bigint, dp: number, show = 6): string {
  const s = units.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp)}.${s.slice(-dp).slice(0, show)}`;
}
const toUsdc6 = (s: string): bigint => { const n = Number(s); return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n; };
const toNative9 = (s: string): bigint => { const n = Number(s); return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e9)) : 0n; };

export default function Lend() {
  const { address, isConnected: wagmiConnected, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isConnected = mounted && wagmiConnected;
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { connect, connectors } = useConnect();
  const cfg = useConfig();

  const [mode, setMode] = useState<"supply" | "withdraw">("supply");
  const [supplyAmt, setSupplyAmt] = useState("2.00");     // USDC to buy & supply
  const [withdrawAmt, setWithdrawAmt] = useState("");     // SOL to withdraw
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [supplied9, setSupplied9] = useState<bigint | null>(0n);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const src = chainId ?? 0;
  const supportedSrc = isSupportedSource(chainId);
  const ready = isConnected && !!address && supportedSrc;                 // connected on a supported source → can buy & supply
  const chainName = chainId ? CHAIN_NAME[chainId] ?? `Chain ${chainId}` : "";
  const showForm = !running;

  const romeSigner = useMemo<RomeSigner | null>(() => {
    if (!address) return null;
    return walletRomeSigner({
      address,
      walletClient: { sendTransaction: (a) => sendTransaction(cfg, { account: a.account, to: a.to, data: a.data, value: a.value ?? 0n, chainId: a.chainId, ...(a.gas != null ? { gas: a.gas } : {}) }) },
      rpc: romeRpc,
      chainId: ROME_CHAIN.chainId,
    });
  }, [address, cfg]);

  const refresh = useCallback(async () => {
    if (!address) return;
    try { setSupplied9(await fetchMangoSolDeposited(solRpc, address)); }
    catch { /* keep last-known; the view hides an unreadable position rather than lying */ }
  }, [address]);
  useEffect(() => { void refresh(); }, [refresh, journey]);

  const amountUsdc6 = useMemo(() => toUsdc6(supplyAmt), [supplyAmt]);

  // Supply quote ALWAYS (even pre-connect): deterministic USDC→SOL preview; full route (bridge + ETA) once ready.
  useEffect(() => {
    if (mode !== "supply" || !amountUsdc6 || !showForm) { setQuote(null); return; }
    let stale = false;
    const t = setTimeout(async () => {
      try {
        setQuoteErr(null);
        const body = ready
          ? { sourceChainId: src, amountUsdc6: amountUsdc6.toString(), sender: address, recipient: address }
          : { amountUsdc6: amountUsdc6.toString() };
        const r = await (await fetch("/api/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as QuoteResp;
        if (stale) return;
        if (r.error) { setQuote(null); setQuoteErr(r.error); return; }
        setQuote(r);
      } catch (e) { if (!stale) setQuoteErr((e as Error).message); }
    }, 500);
    return () => { stale = true; clearTimeout(t); };
  }, [mode, amountUsdc6, src, ready, address, showForm]);

  const withdrawAmt9 = useMemo(() => toNative9(withdrawAmt), [withdrawAmt]);
  const wView = buildLendView({ mode: "withdraw", amount9: withdrawAmt9, walletWsol9: 0n, supplied9 });
  const hasPosition = wView.hasPosition;

  function switchMode(m: "supply" | "withdraw") { setMode(m); setErr(null); setNotice(null); }

  // SUPPLY = the one-shot lend-keep journey (mirrors Stake; terminal leg supplies to Mango, no unwrap/stake).
  async function startSupply() {
    if (!quote || !address || !romeSigner || running || !ready) return;
    setErr(null); setNotice(null); setRunning(true);
    let j = createJourney({ journey: "lend", terminal: "keep", sourceChainId: src, amountUsdc6 });
    setJourney(j);
    try {
      if (chainId !== src) await switchChainAsync({ chainId: src });
      const burnHashes: string[] = [];
      for (const tx of quote.podQuote.steps[0]!.unsignedTxs as Array<{ to: Hex; data: Hex; value?: string; estimatedGas?: string }>) {
        const gas = tx.estimatedGas ? (BigInt(tx.estimatedGas) * 3n) / 2n : undefined;
        const blk = await getBlock(cfg, { chainId: src });
        const fees = blk.baseFeePerGas != null ? burnMaxFees(blk.baseFeePerGas) : undefined;
        const h = await sendTransactionAsync({ to: tx.to, data: tx.data, value: BigInt(tx.value ?? "0"), chainId: src, ...(gas ? { gas } : {}), ...(fees ?? {}) });
        await waitForTransactionReceipt(cfg, { hash: h, chainId: src });
        burnHashes.push(h);
      }
      let registered = false;
      for (let attempt = 0; attempt < 4 && !registered; attempt++) {
        try {
          const res = await fetch("/api/pod/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: { ...quote.podQuote, recipient: address, intent: "wrapper" }, step1TxHash: burnHashes.at(-1) }) });
          if (((await res.json()) as { id?: string }).id) registered = true;
        } catch { /* retry */ }
        if (!registered) await new Promise((r) => setTimeout(r, 3000));
      }
      if (!registered) throw new Error("could not register the transfer with the bridge — your burn is safe and attested; retry from Activity");
      j = advance(j, { legId: "burn", txs: burnHashes }); setJourney(j);

      await watchDelivered(romeSigner, BigInt(quote.podQuote.amountOut));
      j = advance(j, { legId: "delivered", txs: [] }); setJourney(j);
      await requestFuel(romeSigner);
      j = advance(j, { legId: "fuel", txs: [] }); setJourney(j);
      await switchChainAsync({ chainId: ROME_CHAIN.chainId });
      const swapTx = await swapUsdcToWsol(romeSigner, BigInt(quote.swapInUsdc6), BigInt(quote.minWsol9));
      j = advance(j, { legId: "swap", txs: [swapTx] }); setJourney(j);
      // supply leg: confirm the wSOL landed, then supply the confirmed balance to Mango (no unwrap).
      const wsol = await awaitAtaCredit(romeSigner, ROME_CHAIN.wsolMint, BigInt(quote.minWsol9));
      const supplyTx = await supplyToMango(romeSigner, wsol);
      j = advance(j, { legId: "supply", txs: [supplyTx] }); setJourney(j);
      setNotice("Supplied to Mango — earning now.");
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setRunning(false); }
  }

  async function submitWithdraw() {
    if (!romeSigner || running || !wView.canSubmit) return;
    setErr(null); setNotice(null); setRunning(true);
    try {
      await switchChainAsync({ chainId: ROME_CHAIN.chainId });
      await withdrawFromMango(romeSigner, withdrawAmt9);
      setNotice("Withdrawn to your own account.");
      setWithdrawAmt("");
      await refresh();
    } catch (e) { setErr((e as Error).message); } finally { setRunning(false); }
  }

  return (
    <>
      <AppBar current="lend" />
      <div className="page action-cols">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Lend · Mango v4 on Solana</div>
          <h2 className="serif" style={{ font: "500 28px var(--serif)", letterSpacing: "-.01em" }}>Earn on SOL. Keep your keys.</h2>
          {ready
            ? <div className="from-line"><span>Paid from your</span><span className="chain-badge"><span className="dot" /> {chainName}</span><span>wallet</span></div>
            : <p className="lede" style={{ marginTop: 14 }}>Supply SOL to Mango and earn — in one shot: pay USDC from an L2 you already hold, we buy the SOL and supply it, self-custodied. Enter an amount to see the rate.</p>}

          {showForm && (
            <div className="action-card" style={{ marginTop: 16 }}>
              <div className="chips" style={{ marginBottom: 14 }}>
                <button className="chip-btn" aria-pressed={mode === "supply"} onClick={() => switchMode("supply")}>Buy &amp; supply</button>
                <button className="chip-btn" aria-pressed={mode === "withdraw"} onClick={() => switchMode("withdraw")}>Withdraw</button>
              </div>

              {mode === "supply" ? (<>
                <div className="field"><div className="top"><label>You supply</label><span className="bal">USDC{ready ? " from your wallet" : ""}</span></div>
                  <div className="mid"><input value={supplyAmt} onChange={(e) => setSupplyAmt(e.target.value)} inputMode="decimal" aria-label="Amount in USDC" /><span className="asset-select"><span className="cv usdc">$</span>USDC</span></div></div>
                <div className="swap-mid"><span className="arrow"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M6 13l6 6 6-6" /></svg></span></div>
                <div className="field"><div className="top"><label>Supplied · a position</label><span className="bal">earning in Mango</span></div>
                  <div className="mid"><input value={quote ? fmt(BigInt(quote.estWsol9), 9) : "…"} readOnly aria-label="SOL supplied" /><span className="asset-select"><span className="cv sol">◎</span>SOL</span></div></div>
                <div className="quote">
                  {quote ? (<>
                    <div className="qr"><span className="k">Market</span><span className="v">Mango v4 · SOL lending on Solana</span></div>
                    <div className="qr"><span className="k">Yield</span><span className="v muted">accrues in Mango’s deposit rate — no fixed APY</span></div>
                    <div className="qr"><span className="k">Floor</span><span className="v mono">≥ {fmt(BigInt(quote.minWsol9), 9)} SOL supplied, or nothing moves</span></div>
                    <div className="qr"><span className="k">Fee (0.5%, min $0.25)</span><span className="v mono">{fmt(BigInt(quote.feeUsdc6), 6, 2)} USDC{quote.preview ? " · pre-bridge" : ""}</span></div>
                    {ready
                      ? <div className="qr"><span className="k">Arrives in</span><span className="v muted">{formatEta(estimateEta(src).totalSec)} · your own account</span></div>
                      : <div className="qr"><span className="k muted">Network fee + ETA</span><span className="v muted">shown once you connect</span></div>}
                  </>) : (<div className="qr"><span className="k muted">{quoteErr ?? "Enter an amount for a live quote"}</span></div>)}
                </div>
                {!isConnected ? (
                  <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
                    <span className="stack">Connect wallet to lend<small>pay USDC from a supported chain</small></span>
                  </button>
                ) : !supportedSrc ? (
                  <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} disabled>
                    <span className="stack">Switch to a supported chain<small>connect on any listed below</small></span>
                  </button>
                ) : (
                  <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={startSupply} disabled={!quote || running}>
                    <span className="stack">Supply {supplyAmt || "…"} USDC → Mango<small>buy &amp; supply in one flow · your keys throughout</small></span>
                  </button>
                )}
                {!ready && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-2)", textAlign: "center" }}>
                    {isConnected ? "Supported source chains: " : "Connect a wallet on any of these: "}{supportedSourceNames().join(" · ")}.
                  </div>
                )}
              </>) : (<>
                <div className="field"><div className="top"><label>You withdraw</label>
                  <span className="bal">{wView.suppliedKnown ? `${fmt(wView.maxWithdraw9, 9, 4)} SOL supplied` : "position unavailable"}{hasPosition && <button onClick={() => setWithdrawAmt(fmt(wView.maxWithdraw9, 9))} style={{ marginLeft: 8, background: "none", border: 0, color: "var(--via)", cursor: "pointer", font: "inherit" }}>max</button>}</span></div>
                  <div className="mid"><input value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Amount in SOL" disabled={!isConnected || running} /><span className="asset-select"><span className="cv sol">◎</span>SOL</span></div></div>
                <div className="quote">
                  <div className="qr"><span className="k">Market</span><span className="v">Mango v4 · SOL lending on Solana</span></div>
                  <div className="qr"><span className="k">To</span><span className="v">your own account</span></div>
                  <div className="qr"><span className="k">You sign</span><span className="v muted">one approval in your wallet</span></div>
                </div>
                {wView.error && withdrawAmt9 > 0n && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--ink-2)" }}>{wView.error}</div>}
                {!isConnected ? (
                  <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>Connect a wallet to withdraw</button>
                ) : (
                  <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={submitWithdraw} disabled={!wView.canSubmit || running}>
                    <span className="stack">{running ? "Confirm in your wallet…" : `Withdraw ${withdrawAmt || "…"} SOL`}<small>self-custody · your keys throughout</small></span>
                  </button>
                )}
              </>)}
              {err && <div className="rec is-risk attn-card" style={{ marginTop: 12 }}><span className="ico">!</span><div className="tx"><b>That didn’t go through.</b><div className="sub">{err} — your funds are recoverable from Activity.</div></div></div>}
              {notice && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--earn, #1a7f5a)" }}>{notice}</div>}
            </div>
          )}

          {running && journey && (
            <div className="action-card" style={{ marginTop: 16 }}>
              <div className="psec" style={{ marginTop: 0 }}><h3>{err ? "Paused" : "Buying &amp; supplying…"}</h3><span className="c">{journey.legs.filter((l) => l.status === "done").length}/{journey.legs.length} · a few minutes</span></div>
              <div className="legs">
                {journey.legs.map((leg, i) => {
                  const st = leg.status === "done" ? "done" : leg.status === "running" ? "now" : "pending";
                  const copy = LEG_COPY[leg.id] ?? { title: leg.id };
                  return (
                    <div className={`leg${st === "pending" ? " pending" : ""}`} key={leg.id}>
                      <span className="rn">{ROMAN[i]}</span>
                      <div><div className="lt">{copy.title}</div></div>
                      <div className="rt">{st === "done" ? <span className="pill pill--done"><span className="led" />Done</span> : st === "now" ? <span className={`pill ${err ? "pill--attn" : "pill--flight"}`}><span className="led" />{err ? "Stuck" : "Now"}</span> : null}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <aside>
          <div className="psec" style={{ marginTop: 34 }}><h3>Your lend position</h3></div>
          {hasPosition ? (
            <div className="rec pos-card is-earn">
              <div className="ph"><span className="token sol">SOL</span><div><div className="nm">Supplied SOL</div><div className="pr">Mango v4</div></div><span className="pill pill--earn"><span className="led" />Earning</span></div>
              <div className="fig">{fmt(wView.supplied9, 9)} <span className="u">SOL</span></div>
              <div className="kv"><span className="k">Yield</span><span className="v muted">accrues in the deposit rate</span></div>
              <div className="kv"><span className="k">Custody</span><span className="v">your own account</span></div>
              <div className="actions"><button className="btn btn--secondary btn--sm" onClick={() => switchMode("withdraw")}>Withdraw</button></div>
            </div>
          ) : (
            <p className="dim" style={{ fontSize: 12 }}>{isConnected ? "Your supplied SOL will appear here and on the Dashboard — earning continuously until you withdraw." : "Connect a wallet to see your supplied balance."}</p>
          )}
        </aside>
      </div>
      <div className="page" style={{ paddingTop: 0 }}><div className="pfoot"><span>Appia · Rome Protocol</span><span className="mono">Hadrian devnet</span><span>Self-custody · your keys throughout</span></div></div>
    </>
  );
}
