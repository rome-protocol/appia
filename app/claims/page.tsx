"use client";

/**
 * Activity — the filterable log, reconstructed FROM CHAIN. Reads the connected wallet's own
 * Rome balances (scanClaims) + interrupted bring-homes (scanPendingRedeems), maps them to log rows
 * (buildActivity), and renders the Activity page: type × status filters, rows that expand into a
 * per-item story (legs + safe-to-walk-away + custody), and one finish/resume action per actionable row.
 * All user-signed. NO chain selector — bring-home + redeem target the CONNECTED chain (wallet = one chain);
 * where a chain has no redeem bridge yet, the action is honestly gated. Full historical done-events need a
 * tx indexer (later); today we show what chain-truth gives: what's recoverable + in-flight + held.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useConfig, useDisconnect, useSwitchChain } from "wagmi";
import { sendTransaction, getPublicClient } from "wagmi/actions";
import { scanClaims, type ClaimItem } from "@/src/claims";
import { walletRomeSigner, type RomeSigner } from "@/src/rome-signer";
import { resumeFromLeg, type RomeLeg } from "@/src/runner";
import { hexToBytes } from "viem";
import { bringHomePlan, findVaaByPayload, scanPendingRedeems, isVaaRedeemed, type PendingRedeem } from "@/src/bring-home";
import { deliverNative, romeRpc } from "@/src/drivers";
import { completeTransferCalldata, solanaTokenBridgeEmitterHex, WORMHOLE_TOKEN_BRIDGE } from "@/src/redeem";
import { buildActivity, type ActivityRow } from "@/src/activity";
import { ROME_CHAIN } from "@/src/rome/rome-config";
import { AppBar } from "../_appbar";

const TYPES = ["All types", "Swap", "Stake", "Lend", "Borrow", "Bridge"] as const;
const STATUSES = ["Any status", "Done", "Partial", "In-flight"] as const;

export default function Activity() {
  const { address, isConnected: wagmiConnected, chainId } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isConnected = mounted && wagmiConnected;
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const cfg = useConfig();

  const [items, setItems] = useState<ClaimItem[]>([]);
  const [pendings, setPendings] = useState<PendingRedeem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [typeF, setTypeF] = useState(0);
  const [statusF, setStatusF] = useState(0);

  const romeSigner = useMemo<RomeSigner | null>(() => {
    if (!address) return null;
    return walletRomeSigner({
      address,
      walletClient: {
        sendTransaction: (a) =>
          sendTransaction(cfg, { account: a.account, to: a.to, data: a.data, value: a.value ?? 0n, chainId: a.chainId, ...(a.gas != null ? { gas: a.gas } : {}) }),
      },
      rpc: romeRpc,
      chainId: ROME_CHAIN.chainId,
    });
  }, [address, cfg]);

  const ethCall = useCallback(
    async (cid: number, to: `0x${string}`, data: `0x${string}`): Promise<`0x${string}`> => {
      const pc = getPublicClient(cfg, { chainId: cid });
      if (!pc) throw new Error(`no public client for chain ${cid}`);
      const res = await pc.call({ to, data });
      return (res.data ?? "0x00") as `0x${string}`;
    },
    [cfg],
  );

  const scan = useCallback(async () => {
    if (!address) return;
    setLoading(true); setErr(null);
    try {
      const [claims, prs] = await Promise.all([
        scanClaims(address),
        scanPendingRedeems(address, { ethCall }).catch(() => [] as PendingRedeem[]),
      ]);
      setItems(claims); setPendings(prs);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [address, ethCall]);
  useEffect(() => { if (isConnected && address) void scan(); else { setItems([]); setPendings([]); } }, [isConnected, address, scan]);

  const rows = useMemo(() => buildActivity(items, pendings), [items, pendings]);
  const shown = rows.filter((r) => {
    const t = TYPES[typeF]!;
    const s = STATUSES[statusF]!;
    const typeOk = t === "All types" || t.toLowerCase() === r.type || (t === "Bridge" && (r.type === "bridge" || r.type === "bring-home"));
    const statusOk = s === "Any status" || s.toLowerCase() === r.status;
    return typeOk && statusOk;
  });

  // One dispatcher for every actionable row. All user-signed; targets the CONNECTED chain (no selector).
  async function runAction(r: ActivityRow) {
    if (!romeSigner || !address || !r.action) return;
    setBusyId(r.id); setRunErr(null); setNotice(null);
    try {
      if (r.action.kind === "resume") {
        const it = items.find((c) => `partial:${c.asset}` === r.id);
        if (!it || !(it.resumeLeg === "swap" || it.resumeLeg === "unwrap" || it.resumeLeg === "stake")) return;
        setPhase("Resuming — approve on Rome…");
        await switchChainAsync({ chainId: ROME_CHAIN.chainId });
        await resumeFromLeg(romeSigner, it.resumeLeg as RomeLeg);
      } else if (r.action.kind === "redeem") {
        const pr = pendings.find((p) => `redeem:${p.vaa.slice(0, 12)}` === r.id);
        const bridge = pr && WORMHOLE_TOKEN_BRIDGE[pr.destChainId];
        if (!pr || !bridge) return;
        // Guard: never submit a completeTransfer for a VAA that already landed (reverts "already
        // completed" → RPC "gas limit too high"). If done, refresh + say so.
        if (await isVaaRedeemed(hexToBytes(pr.vaa), pr.destChainId, bridge, ethCall)) { setNotice("Already delivered — this transfer already landed in your wallet."); await scan(); return; }
        setPhase("Finishing delivery — approve in your wallet…");
        await switchChainAsync({ chainId: pr.destChainId });
        await sendTransaction(cfg, { account: address, to: bridge, data: completeTransferCalldata(pr.vaa), chainId: pr.destChainId });
      } else if (r.action.kind === "bring-home") {
        // deliver a held/mid-journey asset to the CONNECTED chain: egress on Rome → VAA → redeem.
        const it = items.find((c) => `held:${c.asset}` === r.id || `partial:${c.asset}` === r.id);
        if (!it || chainId == null || (it.asset !== "wsol" && it.asset !== "msol")) return;
        const plan = bringHomePlan(it.asset, chainId);
        if (!plan.supported || !it.canBringHome || plan.targetWhChainId == null || !plan.destTokenBridge) {
          setRunErr(`Bring-home to your chain isn’t available yet for ${it.asset.toUpperCase()} — the asset or a redeem bridge isn’t wired here.`);
          return;
        }
        setPhase("Sending home from Rome…");
        await switchChainAsync({ chainId: ROME_CHAIN.chainId });
        await deliverNative(romeSigner, { wrapper: plan.wrapper, amount: it.amount, recipientEvm: address, targetChain: plan.targetWhChainId });
        setPhase("Waiting for the guardian VAA…");
        const vaa = await findVaaByPayload(solanaTokenBridgeEmitterHex(), { toHex: address, toChain: plan.targetWhChainId });
        // Same guard: findVaaByPayload matches by payload and could return an already-redeemed VAA.
        if (await isVaaRedeemed(hexToBytes(vaa), chainId, plan.destTokenBridge, ethCall)) { setNotice("Already delivered — this asset already landed in your wallet."); await scan(); return; }
        setPhase("Redeeming on your chain — approve in your wallet…");
        await switchChainAsync({ chainId });
        await sendTransaction(cfg, { account: address, to: plan.destTokenBridge, data: completeTransferCalldata(vaa), chainId });
      }
      await scan();
    } catch (e) { setRunErr((e as Error).message); } finally { setBusyId(null); setPhase(null); }
  }

  const pill = (s: ActivityRow["status"]) =>
    s === "done" ? "pill--done" : s === "partial" ? "pill--attn" : "pill--flight";
  const pillTxt = (s: ActivityRow["status"]) => (s === "in-flight" ? "In-flight" : s === "partial" ? "Partial" : "Done");
  const ico = (r: ActivityRow) => (r.type === "stake" ? "ST" : r.type === "swap" ? "SW" : r.type === "bring-home" ? "BH" : "BI");

  return (
    <>
      <AppBar current="activity" />
      <div className="page">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Activity · reconstructed from chain</div>
        <h2 className="serif" style={{ font: "500 28px var(--serif)", letterSpacing: "-.01em" }}>Everything this wallet did.</h2>
        <p className="dim" style={{ fontSize: 13.5, marginTop: 6, maxWidth: "60ch" }}>
          Read straight from chain — clear your browser and it’s all still here. Unfinished journeys carry one action to finish them.
        </p>

        {!isConnected && <div className="psec" style={{ marginTop: 22 }}><h3>Connect your wallet to see its activity.</h3></div>}

        {isConnected && (
          <>
            <div className="flex" style={{ justifyContent: "space-between", margin: "20px 0 12px", alignItems: "flex-end" }}>
              <div style={{ display: "grid", gap: 9 }}>
                <div className="chips">{TYPES.map((t, i) => <button key={t} className="chip-btn" aria-pressed={typeF === i} onClick={() => setTypeF(i)}>{t}</button>)}</div>
                <div className="chips">{STATUSES.map((s, i) => <button key={s} className="chip-btn" aria-pressed={statusF === i} onClick={() => setStatusF(i)}>{s}</button>)}</div>
              </div>
            </div>

            {loading && <div className="psec"><h3>Reading the chain…</h3></div>}
            {err && <div className="rec is-risk attn-card"><span className="ico">!</span><div className="tx"><b>Couldn’t read the chain.</b><div className="sub">{err} — your funds are on-chain regardless; retry.</div></div></div>}
            {runErr && <div className="rec is-risk attn-card"><span className="ico">!</span><div className="tx"><b>That didn’t go through.</b><div className="sub">{runErr} — your funds stayed in your own account; try again.</div></div></div>}
            {notice && <div className="rec attn-card"><span className="pill pill--done"><span className="led" />✓</span><div className="tx"><b>{notice}</b><div className="sub">The list has been refreshed from chain.</div></div></div>}

            <div className="tablewrap"><div className="tscroll"><table className="tbl">
              <thead><tr><th>Action</th><th className="r">Amount</th><th className="r">Status</th><th className="r">When</th><th></th></tr></thead>
              <tbody>
                {shown.length === 0 && !loading && (
                  <tr><td colSpan={5}><div className="tcell"><div><div className="nm">Nothing to show</div><div className="sub">No recoverable, in-flight, or held items for this filter.</div></div></div></td></tr>
                )}
                {shown.map((r) => {
                  const open = openId === r.id;
                  const busy = busyId === r.id;
                  return (
                    <>
                      <tr className={`row${open ? " open" : ""}`} key={r.id} onClick={() => setOpenId(open ? null : r.id)} style={{ cursor: "pointer" }}>
                        <td><div className="tcell"><span className="ico">{ico(r)}</span><div><div className="nm">{r.title}</div><div className="sub">{r.sub}</div></div></div></td>
                        <td className="r amt">{r.amountLabel}</td>
                        <td className="r"><span className={`pill ${pill(r.status)}`}><span className="led" />{pillTxt(r.status)}</span></td>
                        <td className="r when">—</td>
                        <td className="r"><span className="chev">{open ? "⌄" : "›"}</span></td>
                      </tr>
                      {open && (
                        <tr key={`${r.id}:story`}><td className="story-td" colSpan={5}>
                          <div className="story"><div className="story-grid">
                            <div>
                              <div style={{ font: "700 11px var(--sans)", letterSpacing: ".05em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 10 }}>The steps</div>
                              <div className="legs">
                                {r.legs.map((l) => (
                                  <div className={`leg${l.status === "pending" ? " pending" : ""}`} key={l.n}>
                                    <span className="rn">{l.n}</span>
                                    <div><div className="lt">{l.title}</div>{l.sub && <div className="ls">{l.sub}</div>}</div>
                                    <div className="rt">{l.status === "done" ? <span className="pill pill--done"><span className="led" />Done</span> : l.status === "now" ? <span className={`pill ${r.status === "in-flight" ? "pill--flight" : "pill--attn"}`}><span className="led" />{r.status === "in-flight" ? "Now" : "Paused"}</span> : null}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              {r.action && (
                                <div className={`recover${r.status === "in-flight" ? " flight" : ""}`}>
                                  <div className="rh">Safe to walk away.</div>
                                  <div className="rd">Your <b>{r.amountLabel}</b> is in your own account (or a signed transfer addressed to you). Nothing expires and no one else can touch it — Appia rebuilds this from chain, not your browser.</div>
                                  <div className="ra">
                                    <button className="btn btn--primary btn--sm" disabled={!!busyId} onClick={(e) => { e.stopPropagation(); void runAction(r); }}>{busy ? phase ?? "Working…" : r.action.label}</button>
                                    <span className="eta">{r.action.eta}</span>
                                  </div>
                                </div>
                              )}
                              <div className="panel"><div className="h">Custody</div><div className="custody-line">
                                <svg className="k" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6L9 17l-5-5" /></svg>
                                <span>Every step signed by your wallet. The funds never left your own account — no app key, no custody.</span>
                              </div></div>
                            </div>
                          </div></div>
                        </td></tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table></div>
            <div className="pager"><span>Showing what’s recoverable + in-flight now · full history index coming</span></div>
            </div>
          </>
        )}

        <div className="pfoot"><span>Appia · Rome Protocol</span><span className="mono">Hadrian devnet</span><span>Self-custody · your keys throughout</span></div>
      </div>
    </>
  );
}
