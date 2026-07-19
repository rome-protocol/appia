"use client";

/**
 * Appia — Dashboard, built to the design system. Positions-first DApp landing:
 * connect a wallet → its Solana footprint via Rome. Markup/classes ported from the design (globals.css is
 * the design system). Honest data: on-chain amounts via observeChain→buildDashboard; net USD "—" (no
 * devnet price feed); no fabricated rows. Wallet = login; connected chain is an inert badge (no selector).
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { observeChain } from "@/src/claims";
import { buildDashboard, SERVICES, type DashboardModel } from "@/src/dashboard";
import { fetchMangoSolDeposited } from "@/src/rome/mango-state";
import { solRpc } from "@/src/drivers";
import { supportedSourceNames } from "@/src/source-chains";
import { AppBar, CHAIN_NAME } from "./_appbar";

const ASSET_SYMBOL: Record<string, string> = { usdc: "USDC", wsol: "SOL", sol: "SOL", msol: "mSOL" };
const TOKEN_CLASS: Record<string, string> = { usdc: "usdc", wsol: "sol", sol: "sol", msol: "sol" };
const SVC_HREF: Record<string, string> = { swap: "/swap", stake: "/earn", lend: "/lend", borrow: "/borrow", liquidity: "#" };
function fmt(units: bigint, dp: number, show = 6): string {
  const s = units.toString().padStart(dp + 1, "0");
  return `${s.slice(0, -dp)}.${s.slice(-dp).slice(0, show)}`;
}

export default function Dashboard() {
  const { address, isConnected: wagmiConnected, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isConnected = mounted && wagmiConnected;

  const [model, setModel] = useState<DashboardModel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const chainName = chainId ? CHAIN_NAME[chainId] ?? `Chain ${chainId}` : "";

  const scan = useCallback(async () => {
    if (!address) return;
    setLoading(true); setErr(null);
    try {
      const [obs, supplied] = await Promise.all([observeChain(address), fetchMangoSolDeposited(solRpc, address)]);
      setModel(buildDashboard(obs, { mangoSolSupplied9: supplied }));
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [address]);
  useEffect(() => { if (isConnected && address) void scan(); else setModel(null); }, [isConnected, address, scan]);

  return (
    <>
      <AppBar current="dashboard" />
      <div className="page">
        <div className="idband">
          <div className="eyebrow">Your Solana · via Rome</div>
          <h2>This wallet, <em>on Solana.</em></h2>
          {isConnected ? (
            <>
              <div className="who">
                {chainName && <span className="chain-badge plain"><span className="dot" /> {chainName}</span>}
                <span className="pill pill--done" title="Your own wallet signs every action">Self-custodied</span>
              </div>
              <div className="stats">
                <div className="stat"><div className="n">{model?.summary.positions ?? "—"}</div><div className="l">{(model?.summary.positions ?? 0) === 1 ? "position" : "positions"}</div></div>
                <div className="stat"><div className={`n${(model?.summary.attention ?? 0) > 0 ? " attn" : ""}`}>{model?.summary.attention ?? "—"}</div><div className="l">needs attention</div></div>
                <div className="stat"><div className="n">—<span className="fn">*</span></div><div className="l">net value</div></div>
              </div>
              <div className="footnote">* No USD value shown — there’s no price feed on devnet yet. We show what’s real: your on-chain amounts.</div>
            </>
          ) : (
            <div className="who"><span className="lede">Connect a wallet to see its positions on Solana — read straight from chain, self-custodied throughout.</span></div>
          )}
        </div>

        {isConnected && loading && <div className="psec" style={{ marginTop: 24 }}><h3>Reading the chain…</h3></div>}
        {isConnected && err && <div className="rec is-risk attn-card" style={{ marginTop: 24 }}><span className="ico">!</span><div className="tx"><b>Couldn’t read the chain.</b><div className="sub">{err} — your funds are on-chain regardless; retry.</div></div></div>}

        {isConnected && model && model.attention.length > 0 && (
          <>
            <div className="psec" style={{ marginTop: 24 }}><h3>Needs your attention</h3></div>
            {model.attention.map((a) => (
              <div className="rec is-attn attn-card" key={a.asset}>
                <span className="ico">!</span>
                <div className="tx"><b>A journey didn’t finish.</b><div className="sub">{fmt(a.amount, a.decimals)} {ASSET_SYMBOL[a.asset]} is in your own account — resume to {a.resumeLeg ?? "recover"}, or bring it home.</div></div>
                <a className="btn btn--secondary btn--sm go" href="/claims">Resume →</a>
              </div>
            ))}
          </>
        )}

        {isConnected && (
          <>
            <div className="psec"><h3>Your positions</h3><span className="c">what you hold + earn, live</span></div>
            <div className="pos-grid">
              {model?.positions.map((p) => {
                const lend = p.kind === "lend";
                return (
                <div className="rec pos-card is-earn" key={`${p.protocol}:${p.asset}`}>
                  <div className="ph"><span className={`token ${TOKEN_CLASS[p.asset] ?? ""}`}>{ASSET_SYMBOL[p.asset]}</span><div><div className="nm">{lend ? "Supplied SOL" : "Staked SOL"}</div><div className="pr">{lend ? "Mango · lending" : "Marinade · liquid staking"}</div></div><span className="pill pill--earn"><span className="led" />Earning</span></div>
                  <div className="fig">{fmt(p.amount, p.decimals)} <span className="u">{ASSET_SYMBOL[p.asset]}</span></div>
                  <div className="kv"><span className="k">Yield</span><span className="v earn">{lend ? "accrues in the deposit rate" : "accrues in the mSOL rate"}</span></div>
                  <div className="kv"><span className="k">Custody</span><span className="v">your own account</span></div>
                  <div className="actions">{lend
                    ? <><a className="btn btn--secondary btn--sm" href="/lend">Supply</a><a className="btn btn--ghost btn--sm" href="/lend">Withdraw</a></>
                    : <><a className="btn btn--secondary btn--sm" href="/claims">Bring home{chainName ? ` → ${chainName}` : ""}</a><a className="btn btn--ghost btn--sm" href="/claims">History</a></>}</div>
                </div>
              );})}
              <div className="rec pos-card ghost is-soon">
                <div className="ph"><span className="token">SOL</span><div><div className="nm">Borrowed</div><div className="pr">Mango · lending</div></div><span className="pill pill--soon">Soon</span></div>
                <div className="fig muted">—</div>
                <div className="kv"><span className="k">Health</span><span className="v dim">—</span></div>
                <div className="actions"><button className="btn btn--secondary btn--sm" disabled>Borrow</button><button className="btn btn--secondary btn--sm" disabled>Repay</button></div>
              </div>
            </div>
          </>
        )}

        <div className="psec"><h3>What you can do</h3><span className="c">grows as we open more of Solana</span></div>
        <div className="svc-grid">
          {SERVICES.map((s) =>
            s.live ? (
              <a className="svc" href={SVC_HREF[s.id] ?? "#"} key={s.id}><span className="st">{s.label}</span><span className="sd">{s.blurb}</span></a>
            ) : (
              <div className="svc soon" key={s.id}><span className="st">{s.label} <span className="pill pill--soon" style={{ marginLeft: "auto" }}>Soon</span></span><span className="sd">{s.blurb}</span></div>
            ),
          )}
        </div>

        <div className="psec"><h3>Works with</h3><span className="c">connect a wallet on any of these — more chains, with faster finality, coming</span></div>
        <div className="chainstrip">
          {supportedSourceNames().map((n) => (
            <span className="chain-badge" key={n}><span className="dot" />{n}</span>
          ))}
          <span className="pill pill--soon">More chains soon</span>
        </div>

        <div className="psec"><h3>Recent activity</h3><a className="more" href="/claims">View all →</a></div>
        <div className="tablewrap"><div className="pager"><span>Your journeys + recoverable funds live in Activity.</span><span className="grow"><a className="btn btn--ghost btn--sm" href="/claims">Open Activity →</a></span></div></div>

        <div className="pfoot"><span>Appia · Rome Protocol</span><span className="mono">Hadrian devnet</span><span>Self-custody · your keys throughout</span></div>
      </div>
    </>
  );
}
