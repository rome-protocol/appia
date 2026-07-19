"use client";

/**
 * Appia — Swap, to the design system. Inbound → SOL: pay USDC from the wallet you already
 * have → receive SOL (wSOL) in your own Rome account. Same proven engine as Stake, one leg shorter —
 * the `swap-keep` journey stops after the swap (burn → delivered → fuel → swap; no unwrap/stake). A swap
 * lands → it shows in Activity. Source = the CONNECTED wallet's chain (no dropdown). Honest quote from
 * the live pool reserves; you sign every leg.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useSendTransaction, useSwitchChain, useConfig } from "wagmi";
import { getBlock, waitForTransactionReceipt, sendTransaction } from "wagmi/actions";
import type { Hex } from "viem";
import { AppBar, CHAIN_NAME } from "../_appbar";
import { isSupportedSource, supportedSourceNames } from "@/src/source-chains";
import { createJourney, advance, type Journey } from "@/src/journey";
import { ataBalance, requestFuel, romeRpc, swapUsdcToWsol, watchDelivered } from "@/src/drivers";
import { walletRomeSigner, type RomeSigner } from "@/src/rome-signer";
import { ROME_CHAIN } from "@/src/rome/rome-config";
import { burnMaxFees } from "@/src/l2-fees";
import { estimateEta, formatEta } from "@/src/cost-eta";

const J_STORE = "appia:swap:v1";
type QuoteResp = {
  podQuote: { amountOut: string; steps: Array<{ unsignedTxs: Array<{ to: Hex; data: Hex; value: string }> }> };
  preview?: boolean;
  feeUsdc6: string; swapInUsdc6: string; estWsol9: string; minWsol9: string; estMsol9: string; solPerMsol: string;
  error?: string;
};
const LEG_COPY: Record<string, { title: string; sub: string }> = {
  burn: { title: "Left your chain", sub: "USDC burned — one signature in your wallet" },
  delivered: { title: "Arrived on Solana", sub: "Circle attests · minted to your own account" },
  fuel: { title: "Fueled", sub: "Appia fronts the Rome gas (repaid in the fee)" },
  swap: { title: "Swapped to SOL", sub: "Meteora, at the rate you were quoted — held in your account" },
};
const ROMAN = ["I", "II", "III", "IV"];
function fmt(units: bigint, dp: number, show = 6): string {
  const s = units.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp)}.${s.slice(-dp).slice(0, show)}`;
}

export default function Swap() {
  const { address, isConnected: wagmiConnected, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isConnected = mounted && wagmiConnected;
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const { connect, connectors } = useConnect();
  const cfg = useConfig();

  const [amount, setAmount] = useState("2.00");
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [legTxs, setLegTxs] = useState<Record<string, string[]>>({});
  const [runErr, setRunErr] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [position, setPosition] = useState<{ wsol9: bigint } | null>(null);

  const src = chainId ?? 0;
  const supportedSrc = isSupportedSource(chainId);
  const chainName = chainId ? CHAIN_NAME[chainId] ?? `Chain ${chainId}` : "";

  const romeSigner = useMemo<RomeSigner | null>(() => {
    if (!address) return null;
    return walletRomeSigner({
      address,
      walletClient: { sendTransaction: (a) => sendTransaction(cfg, { account: a.account, to: a.to, data: a.data, value: a.value ?? 0n, chainId: a.chainId, ...(a.gas != null ? { gas: a.gas } : {}) }) },
      rpc: romeRpc,
      chainId: ROME_CHAIN.chainId,
    });
  }, [address, cfg]);

  useEffect(() => {
    const j = localStorage.getItem(J_STORE);
    if (j) { const p = JSON.parse(j) as Journey & { amountUsdc6: string }; setJourney({ ...p, amountUsdc6: BigInt(p.amountUsdc6) }); }
  }, []);

  const amountUsdc6 = useMemo(() => { const n = Number(amount); return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 1e6)) : 0n; }, [amount]);

  const ready = isConnected && !!address && supportedSrc;                 // connected on a supported source → can swap
  const showForm = !running;                                             // the interface is always up except during an active swap — clean page; recovery lives in Activity

  useEffect(() => {
    // Quote ALWAYS: a deterministic USDC→SOL PREVIEW pre-connect / on an unsupported chain (pool math,
    // no wallet); the full route (bridge fee + ETA) once ready. The deterministic outcome the operator
    // asked to show before connecting.
    if (!amountUsdc6 || !showForm) { setQuote(null); return; }
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
  }, [amountUsdc6, src, ready, address, showForm]);

  const refreshPosition = useCallback(async () => {
    if (!romeSigner) return;
    const wsol = await ataBalance(romeSigner, ROME_CHAIN.wsolMint);
    setPosition(wsol > 0n ? { wsol9: wsol } : null);
  }, [romeSigner]);
  useEffect(() => { void refreshPosition(); }, [refreshPosition, journey]);

  function persist(j: Journey) { setJourney(j); localStorage.setItem(J_STORE, JSON.stringify({ ...j, amountUsdc6: j.amountUsdc6.toString() })); }

  async function start() {
    if (!quote || !address || !romeSigner || running || !supportedSrc) return;
    setRunErr(null); setRunning(true);
    let j = createJourney({ journey: "swap", terminal: "keep", sourceChainId: src, amountUsdc6 });
    persist(j);
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
      setLegTxs((p) => ({ ...p, burn: burnHashes }));
      let registered = false;
      for (let attempt = 0; attempt < 4 && !registered; attempt++) {
        try {
          const res = await fetch("/api/pod/transfers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: { ...quote.podQuote, recipient: address, intent: "wrapper" }, step1TxHash: burnHashes.at(-1) }) });
          const rec = (await res.json()) as { id?: string };
          if (rec.id) { registered = true; setLegTxs((p) => ({ ...p, burn: [...burnHashes, `pod:${rec.id}`] })); }
        } catch { /* retry */ }
        if (!registered) await new Promise((r) => setTimeout(r, 3000));
      }
      if (!registered) throw new Error("could not register the transfer with the bridge — your burn is safe and attested; retry from Activity");
      j = advance(j, { legId: "burn", txs: burnHashes }); persist(j);

      await watchDelivered(romeSigner, BigInt(quote.podQuote.amountOut));
      j = advance(j, { legId: "delivered", txs: [] }); persist(j);
      await requestFuel(romeSigner);
      j = advance(j, { legId: "fuel", txs: [] }); persist(j);
      await switchChainAsync({ chainId: ROME_CHAIN.chainId });
      const swapTx = await swapUsdcToWsol(romeSigner, BigInt(quote.swapInUsdc6), BigInt(quote.minWsol9));
      setLegTxs((p) => ({ ...p, swap: [swapTx] })); j = advance(j, { legId: "swap", txs: [swapTx] }); persist(j);
      await refreshPosition();
    } catch (e) { setRunErr((e as Error).message); } finally { setRunning(false); }
  }

  return (
    <>
      <AppBar current="swap" />
      <div className="page action-cols">
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Swap · USDC → SOL on Meteora</div>
          <h2 className="serif" style={{ font: "500 28px var(--serif)", letterSpacing: "-.01em" }}>Buy SOL with USDC.</h2>
          {ready
            ? <div className="from-line"><span>Paid from your</span><span className="chain-badge"><span className="dot" /> {chainName}</span><span>wallet</span></div>
            : <p className="lede" style={{ marginTop: 14 }}>Pay USDC from an L2 you already hold → receive SOL in your own account, self-custodied, done the moment it lands. Enter an amount to see the rate.</p>}

          {showForm && (
            <div className="action-card" style={{ marginTop: 16 }}>
              <div className="field"><div className="top"><label>You pay</label><span className="bal">USDC{ready ? " from your wallet" : ""}</span></div>
                <div className="mid"><input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount in USDC" /><span className="asset-select"><span className="cv usdc">$</span>USDC</span></div></div>
              <div className="swap-mid"><span className="arrow"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M6 13l6 6 6-6" /></svg></span></div>
              <div className="field"><div className="top"><label>You receive</label><span className="bal">to your own account</span></div>
                <div className="mid"><input value={quote ? fmt(BigInt(quote.estWsol9), 9) : "…"} readOnly aria-label="Amount in SOL" /><span className="asset-select"><span className="cv sol">◎</span>SOL</span></div></div>
              <div className="quote">
                {quote ? (<>
                  <div className="qr"><span className="k">Market</span><span className="v">Meteora · USDC/SOL pool on Solana</span></div>
                  <div className="qr"><span className="k">You receive</span><span className="v mono">≈ {fmt(BigInt(quote.estWsol9), 9)} SOL</span></div>
                  <div className="qr"><span className="k">Floor</span><span className="v mono">≥ {fmt(BigInt(quote.minWsol9), 9)} SOL, or nothing moves</span></div>
                  <div className="qr"><span className="k">Fee (0.5%, min $0.25)</span><span className="v mono">{fmt(BigInt(quote.feeUsdc6), 6, 2)} USDC{quote.preview ? " · pre-bridge" : ""}</span></div>
                  {ready
                    ? <div className="qr"><span className="k">Arrives in</span><span className="v muted">{formatEta(estimateEta(src).totalSec)} · your own account</span></div>
                    : <div className="qr"><span className="k muted">Network fee + ETA</span><span className="v muted">shown once you connect</span></div>}
                </>) : (<div className="qr"><span className="k muted">{quoteErr ?? "Enter an amount for a live quote"}</span></div>)}
              </div>
              {!isConnected ? (
                <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
                  <span className="stack">Connect wallet to swap<small>pay USDC from a supported chain</small></span>
                </button>
              ) : !supportedSrc ? (
                <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} disabled>
                  <span className="stack">Switch to a supported chain<small>connect on any listed below</small></span>
                </button>
              ) : (
                <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} onClick={start} disabled={!quote || running}>
                  <span className="stack">Swap {amount || "…"} USDC → SOL<small>you approve each step · your keys throughout</small></span>
                </button>
              )}
              {!ready && (
                <div style={{ marginTop: 12, fontSize: 12, color: "var(--ink-2)", textAlign: "center" }}>
                  {isConnected ? "Supported source chains: " : "Connect a wallet on any of these: "}{supportedSourceNames().join(" · ")}.
                </div>
              )}
            </div>
          )}

          {running && journey && (
            <div className="action-card" style={{ marginTop: 18 }}>
              <div className="psec" style={{ marginTop: 0 }}><h3>{runErr ? "Paused" : "Buying your SOL…"}</h3><span className="c">{journey.legs.filter((l) => l.status === "done").length}/{journey.legs.length} · a minute or two</span></div>
              <div className="legs">
                {journey.legs.map((leg, i) => {
                  const st = leg.status === "done" ? "done" : leg.status === "running" ? "now" : "pending";
                  const copy = LEG_COPY[leg.id] ?? { title: leg.id, sub: "" };
                  return (
                    <div className={`leg${st === "pending" ? " pending" : ""}`} key={leg.id}>
                      <span className="rn">{ROMAN[i]}</span>
                      <div><div className="lt">{copy.title}</div></div>
                      <div className="rt">{st === "done" ? <span className="pill pill--done"><span className="led" />Done</span> : st === "now" ? <span className={`pill ${runErr ? "pill--attn" : "pill--flight"}`}><span className="led" />{runErr ? "Stuck" : "Now"}</span> : null}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {runErr && <div className="rec is-risk attn-card" style={{ marginTop: 14 }}><span className="ico">!</span><div className="tx"><b>The swap hit a snag.</b><div className="sub">{runErr} — your funds are recoverable from Activity.</div></div></div>}
        </div>

        <aside>
          <div className="psec" style={{ marginTop: 34 }}><h3>Your SOL</h3></div>
          {position ? (
            <div className="rec pos-card is-earn">
              <div className="ph"><span className="token sol">SOL</span><div><div className="nm">Wrapped SOL</div><div className="pr">in your own account</div></div></div>
              <div className="fig">{fmt(position.wsol9, 9)} <span className="u">SOL</span></div>
              <div className="kv"><span className="k">Next</span><span className="v">stake it, or bring it home — from Activity</span></div>
            </div>
          ) : (
            <p className="dim" style={{ fontSize: 12 }}>Your SOL lands in your own account and shows on the <a href="/">Dashboard</a> — then stake it or bring it home anytime.</p>
          )}
        </aside>
      </div>
      <div className="page" style={{ paddingTop: 0 }}><div className="pfoot"><span>Appia · Rome Protocol</span><span className="mono">Hadrian devnet</span><span>Self-custody · your keys throughout</span></div></div>
    </>
  );
}
