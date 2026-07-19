/**
 * Appia — Borrow. Target design (Mango v4): borrow against your Solana
 * positions with the health factor front-and-center. Honestly gated — disabled controls, "rate loading"
 * / "—" placeholders, Soon banner, no invented APY. Presentation only; not yet live.
 */
import { AppBar } from "../_appbar";

export default function Borrow() {
  return (
    <>
      <AppBar current="borrow" />
      <div className="page">
        <div className="rec is-soon" style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 22 }}>
          <span className="pill pill--soon">Soon</span>
          <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}><b style={{ fontWeight: 600 }}>Borrowing on Mango v4 is coming.</b> Borrow against your Solana positions; your health factor stays front and center.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 26, alignItems: "start" }}>
          <div className="action-card" style={{ maxWidth: "none" }}>
            <div className="chips" style={{ marginBottom: 14 }}><button className="chip-btn" aria-pressed="true" disabled>Borrow</button><button className="chip-btn" disabled>Repay</button></div>
            <div className="field"><div className="top"><label>You borrow</label><span className="bal">available —</span></div>
              <div className="mid"><input value="0.00" readOnly aria-label="borrow amount" disabled /><span className="asset-select"><span className="cv usdc">$</span>USDC</span></div></div>
            <div className="quote">
              <div className="qr"><span className="k">Borrow APY</span><span className="v muted mono">rate loading</span></div>
              <div className="qr"><span className="k">Collateral</span><span className="v muted">your Solana positions</span></div>
            </div>
            <div style={{ marginTop: 16 }}><div className="health"><div className="track muted" /><div className="lbls"><span>Health factor</span><span className="mono">— · soon</span></div></div></div>
            <button className="btn btn--primary btn--block" style={{ marginTop: 16 }} disabled>Borrow — soon</button>
          </div>
          <div>
            <div className="psec" style={{ marginTop: 0 }}><h3>Your borrow positions</h3><span className="c">what you owe + health, live</span></div>
            <div className="rec pos-card is-soon" style={{ maxWidth: 420 }}>
              <div className="ph"><span className="token">SOL</span><div><div className="nm">Borrowed</div><div className="pr">Mango v4</div></div><span className="pill pill--soon">Soon</span></div>
              <div className="fig muted">—</div>
              <div className="kv"><span className="k">Borrow APY</span><span className="v dim mono">—</span></div>
              <div className="kv"><span className="k">Collateral</span><span className="v dim mono">—</span></div>
              <div style={{ marginTop: 8 }}><div className="health"><div className="track muted" /><div className="lbls"><span>Health factor</span><span className="mono">—</span></div></div></div>
              <div className="actions"><button className="btn btn--secondary btn--sm" disabled>Repay</button></div>
            </div>
            <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>When live, a healthy factor sits green; approaching the liquidation threshold moves the marker into amber, then red.</p>
          </div>
        </div>
        <div className="pfoot"><span>Appia · Rome Protocol</span><span className="mono">Hadrian devnet</span><span>Self-custody · your keys throughout</span></div>
      </div>
    </>
  );
}
