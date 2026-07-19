"use client";

/**
 * Owner-only admin — Wormhole asset allowlist (to the design system). The RomeBridgeWithdraw
 * owner enables an asset's native egress by SIGNING `setWormholeAssetAllowed` with their own wallet — the
 * UI path, not a raw `cast send` + key. Reads live state from Rome; gates the action on owner() == the
 * connected wallet. A hidden OPS route with a minimal ops header (not the user nav): it manages shared
 * bridge config, never anyone's funds — the "not a wallet page" framing is explicit.
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useConfig } from "wagmi";
import { getPublicClient, sendTransaction } from "wagmi/actions";
import { WITHDRAW_ABI, ALLOWLIST_ASSETS, setWormholeAssetAllowedCalldata, isOwner, assetRowState, adminViewMode, type AllowlistAsset } from "@/src/admin-allowlist";
import { ROME_CHAIN } from "@/src/rome/rome-config";
import { Logomark } from "../_appbar";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Row = { asset: AllowlistAsset; allowed: boolean };

export default function Admin() {
  const { address, isConnected: wagmiConnected } = useAccount();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isConnected = mounted && wagmiConnected;
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const cfg = useConfig();

  const withdraw = ROME_CHAIN.bridgeWithdraw as `0x${string}`;
  const [owner, setOwner] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const pc = getPublicClient(cfg, { chainId: ROME_CHAIN.chainId });
      if (!pc) throw new Error("no Rome client");
      setOwner((await pc.readContract({ address: withdraw, abi: WITHDRAW_ABI, functionName: "owner" })) as string);
      const rs: Row[] = [];
      for (const asset of ALLOWLIST_ASSETS) {
        const allowed = (await pc.readContract({ address: withdraw, abi: WITHDRAW_ABI, functionName: "wormholeAssetAllowed", args: [asset.wrapper] })) as boolean;
        rs.push({ asset, allowed });
      }
      setRows(rs);
    } catch (e) { setErr((e as Error).message); }
  }, [cfg, withdraw]);
  useEffect(() => { void load(); }, [load]);

  const owns = isOwner(address, owner ?? undefined);
  const mode = mounted ? adminViewMode(address, owner ?? undefined) : "disconnected";

  async function allow(asset: AllowlistAsset) {
    if (!address || !owns) return;
    setBusy(asset.symbol); setErr(null); setPhase(`Allowlisting ${asset.symbol} — approve in your wallet…`);
    try {
      await switchChainAsync({ chainId: ROME_CHAIN.chainId });
      await sendTransaction(cfg, { account: address, to: withdraw, data: setWormholeAssetAllowedCalldata(asset.wrapper, true), chainId: ROME_CHAIN.chainId, gas: 10_000_000n });
      setPhase("Confirming on-chain…");
      const pc = getPublicClient(cfg, { chainId: ROME_CHAIN.chainId });
      for (let i = 0; i < 20 && pc; i++) {
        await sleep(3000);
        const a = (await pc.readContract({ address: withdraw, abi: WITHDRAW_ABI, functionName: "wormholeAssetAllowed", args: [asset.wrapper] })) as boolean;
        if (a) break;
      }
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); setPhase(null); }
  }

  return (
    <>
      <header className="ab">
        <span className="ab__brand"><Logomark /><span className="name">Appia</span></span>
        <span className="pill pill--soon" style={{ marginLeft: 4 }}>Bridge operations</span>
        <div className="ab__right">
          {isConnected ? (
            <span className="wallet"><span className="addr">{address?.slice(0, 6)}…{address?.slice(-4)}</span><button className="btn-disc" onClick={() => disconnect()}>Disconnect</button></span>
          ) : (
            <button className="btn-connect" onClick={() => connect({ connector: connectors[0]! })}>Connect wallet</button>
          )}
        </div>
      </header>

      <div className="page" style={{ maxWidth: 720 }}>
        <div className="idband">
          <div className="eyebrow">Bridge operations · not a wallet page</div>
          <h2>Asset <em>listing.</em></h2>
          <p className="lede">Shared bridge configuration — <b>not your holdings</b>. The bridge owner lists an asset for native egress by signing <code>setWormholeAssetAllowed</code>. A listing is a one-time, global switch (it enables the asset for every user) and never touches anyone’s funds. Your own positions live in <a href="/">Dashboard</a>.</p>
        </div>

        {err && <div className="rec is-risk attn-card" style={{ marginTop: 18 }}><span className="ico">!</span><div className="tx"><b>Couldn’t reach the contract.</b><div className="sub">{err}</div></div></div>}
        {!rows && !err && <div className="psec" style={{ marginTop: 18 }}><h3>Reading the allowlist…</h3></div>}

        {mode !== "owner" && (
          <div className="rec is-soon attn-card" style={{ marginTop: 18 }}>
            <span className="pill pill--soon">Ops</span>
            <div className="tx">
              {mode === "disconnected"
                ? <><b>Operations page — read-only.</b><div className="sub">This manages shared bridge configuration, not your funds. Connect the bridge-owner wallet to manage listings.</div></>
                : <><b>Not your wallet to manage.</b><div className="sub">{address?.slice(0, 6)}…{address?.slice(-4)} isn’t the bridge owner, so the listings below are read-only. This is bridge config — it doesn’t affect your funds. Manage those in <a href="/">Dashboard</a>.</div></>}
            </div>
          </div>
        )}

        {rows && (
          <div className="rec" style={{ marginTop: 18 }}>
            <div className="ph"><span className="nm">RomeBridgeWithdraw · {withdraw.slice(0, 8)}…</span></div>
            <div className="kv"><span className="k">Bridge owner</span><span className="v mono">{owner?.slice(0, 6)}…{owner?.slice(-4)}{owns ? " · that’s you" : ""}</span></div>
            <p className="dim" style={{ fontSize: 12, margin: "2px 0 14px" }}>A listing is global (enables the asset for every user), never a per-wallet gate.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {rows.map(({ asset, allowed }) => {
                const state = assetRowState({ allowed, owns, symbol: asset.symbol, running: busy === asset.symbol, phase });
                const canAllow = state.kind === "action" && !busy;
                return (
                  <div key={asset.symbol} className="kv" style={{ alignItems: "center" }}>
                    <span><b>{asset.symbol}</b> <span className="dim mono">{asset.wrapper.slice(0, 10)}…</span></span>
                    {state.kind === "allowed" ? (
                      <span className="pill pill--earn"><span className="led" />allowed</span>
                    ) : state.kind === "status" ? (
                      <span className="dim">{state.label}</span>
                    ) : (
                      <button className="btn btn--primary btn--sm" disabled={!canAllow} onClick={canAllow ? () => void allow(asset) : undefined}>{state.label}</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="pfoot"><span>Appia · Rome Protocol</span><span className="mono">Hadrian devnet · owner ops</span></div>
      </div>
    </>
  );
}
