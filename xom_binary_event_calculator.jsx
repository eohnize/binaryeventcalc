import { useState, useMemo } from "react";

const CURRENT_XOM = 161.15;
const XOM_52H = 176.41;
const XOM_52L = 97.80;

const defaultLegs = [
  { id: 1, type: "call", strike: 167, premium: 1.20, contracts: 2, dte: 7, label: "OTM Calls 7DTE" },
  { id: 2, type: "call", strike: 172, premium: 0.55, contracts: 2, dte: 7, label: "Deep OTM Calls 7DTE" },
  { id: 3, type: "put", strike: 155, premium: 1.40, contracts: 2, dte: 2, label: "OTM Puts 2DTE" },
  { id: 4, type: "put", strike: 150, premium: 0.65, contracts: 2, dte: 2, label: "Deep OTM Puts 2DTE" },
];

const scenarios = [
  { name: "Ceasefire + Hormuz Reopens", move: -8.0, color: "#ef4444", icon: "▼▼▼", note: "Oil crashes → XOM dumps" },
  { name: "Partial Deal Framework", move: -4.0, color: "#f97316", icon: "▼▼", note: "Oil eases, XOM fades" },
  { name: "Deadline Extended (Chop)", move: -1.0, color: "#a3a3a3", icon: "—", note: "Status quo theta bleed" },
  { name: "Moderate Escalation", move: 5.0, color: "#22c55e", icon: "▲▲", note: "Oil $120+ → XOM rips" },
  { name: "Full Infrastructure Strikes", move: 10.0, color: "#10b981", icon: "▲▲▲", note: "Oil $130+ → XOM parabolic" },
];

function estimateOptionPrice(type, strike, premium, dte, spotAtExpiry, currentSpot) {
  const intrinsic = type === "call"
    ? Math.max(0, spotAtExpiry - strike)
    : Math.max(0, strike - spotAtExpiry);
  if (dte <= 2) return Math.max(intrinsic, 0.01);
  const moveSize = Math.abs(spotAtExpiry - currentSpot) / currentSpot;
  const inFavor = (type === "call" && spotAtExpiry > currentSpot) || (type === "put" && spotAtExpiry < currentSpot);
  const ivBump = inFavor ? 1.0 + moveSize * 4 : 1.0 - moveSize * 2;
  const timeRemaining = Math.max((dte - 1) / dte, 0.1);
  const timeValue = premium * 0.45 * timeRemaining * Math.max(ivBump, 0.2);
  return Math.max(intrinsic + timeValue, 0.02);
}

function fmt(v) {
  if (Math.abs(v) >= 1000) return (v > 0 ? "+" : "") + "$" + (v / 1000).toFixed(1) + "k";
  return (v > 0 ? "+" : "") + "$" + v.toFixed(0);
}

function fmtPct(v) { return (v > 0 ? "+" : "") + v.toFixed(1) + "%"; }

export default function XOMCalculator() {
  const [legs, setLegs] = useState(defaultLegs);
  const [customMove, setCustomMove] = useState(0);

  const totalInvested = useMemo(() => legs.reduce((s, l) => s + l.premium * l.contracts * 100, 0), [legs]);
  const callCost = useMemo(() => legs.filter(l => l.type === "call").reduce((s, l) => s + l.premium * l.contracts * 100, 0), [legs]);
  const putCost = useMemo(() => legs.filter(l => l.type === "put").reduce((s, l) => s + l.premium * l.contracts * 100, 0), [legs]);

  function calc(movePct) {
    const spot = CURRENT_XOM * (1 + movePct / 100);
    let totalPnl = 0;
    const legResults = legs.map(l => {
      const exit = estimateOptionPrice(l.type, l.strike, l.premium, l.dte, spot, CURRENT_XOM);
      const cost = l.premium * l.contracts * 100;
      const value = exit * l.contracts * 100;
      const pnl = value - cost;
      totalPnl += pnl;
      return { ...l, exit, cost, value, pnl, mult: value / cost };
    });
    return { spot: spot.toFixed(2), totalPnl, legResults, roi: (totalPnl / totalInvested) * 100 };
  }

  function updateLeg(id, field, val) {
    setLegs(prev => prev.map(l => l.id === id ? { ...l, [field]: field === "type" ? val : (parseFloat(val) || 0) } : l));
  }

  function addLeg() {
    const newId = Math.max(...legs.map(l => l.id), 0) + 1;
    setLegs(prev => [...prev, { id: newId, type: "call", strike: 165, premium: 1.0, contracts: 1, dte: 7, label: "New" }]);
  }

  function removeLeg(id) {
    if (legs.length <= 1) return;
    setLegs(prev => prev.filter(l => l.id !== id));
  }

  const sResults = scenarios.map(s => ({ ...s, r: calc(s.move) }));
  const customR = calc(customMove);
  const best = sResults.reduce((a, b) => a.r.totalPnl > b.r.totalPnl ? a : b);
  const worst = sResults.reduce((a, b) => a.r.totalPnl < b.r.totalPnl ? a : b);

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace", background: "#08080e", color: "#d4d4d4", minHeight: "100vh", padding: "20px 16px", maxWidth: 900, margin: "0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Sora:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type="number"] { background: #12121e; border: 1px solid #252540; color: #e0e0e0; padding: 5px 7px; border-radius: 3px; font-family: inherit; font-size: 12.5px; width: 72px; text-align: right; outline: none; }
        input[type="number"]:focus { border-color: #f59e0b; }
        input[type="range"] { width: 100%; accent-color: #f59e0b; cursor: pointer; }
        select { background: #12121e; border: 1px solid #252540; color: #e0e0e0; padding: 5px 7px; border-radius: 3px; font-family: inherit; font-size: 12px; outline: none; cursor: pointer; }
        .g { text-shadow: 0 0 10px rgba(34,197,94,0.5); }
        .r { text-shadow: 0 0 10px rgba(239,68,68,0.5); }
        .amber { text-shadow: 0 0 10px rgba(245,158,11,0.4); }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "2px solid #f59e0b", paddingBottom: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "Sora, sans-serif", fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>XOM</span>
          <span style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600, letterSpacing: "2px" }}>IRAN BINARY EVENT</span>
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 20, fontSize: 12, color: "#777", flexWrap: "wrap" }}>
          <span>Spot <span style={{ color: "#fff", fontWeight: 600 }}>${CURRENT_XOM}</span></span>
          <span>52w <span style={{ color: "#ef4444" }}>${XOM_52L}</span> — <span style={{ color: "#22c55e" }}>${XOM_52H}</span></span>
          <span>WTI <span style={{ color: "#f59e0b", fontWeight: 600 }}>~$112</span></span>
          <span>Deadline <span style={{ color: "#ef4444", fontWeight: 600 }}>8PM ET Tonight</span></span>
          <span>Earnings <span style={{ color: "#a855f7", fontWeight: 500 }}>Apr 24</span></span>
        </div>

        {/* XOM-specific insight */}
        <div style={{ marginTop: 12, background: "#12121e", borderRadius: 6, padding: "10px 14px", border: "1px solid #252540", fontSize: 12, lineHeight: 1.7 }}>
          <span style={{ color: "#f59e0b", fontWeight: 600 }}>KEY INSIGHT:</span>{" "}
          <span style={{ color: "#aaa" }}>
            XOM has <span style={{ color: "#fff" }}>inverse</span> payoff vs. QQQ/SPY here. Escalation = oil spikes = <span style={{ color: "#22c55e" }}>XOM up</span>. 
            Ceasefire = oil crashes = <span style={{ color: "#ef4444" }}>XOM down</span>. 
            Your CALLS are the escalation bet. Your PUTS are the peace bet. 
            This is flipped from index logic.
          </span>
        </div>
      </div>

      {/* Budget Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, marginBottom: 22 }}>
        {[
          { label: "DEPLOYED", val: `$${totalInvested.toFixed(0)}`, color: "#fff", sub: `${legs.length} legs` },
          { label: "CALLS (ESCALATION)", val: `$${callCost.toFixed(0)}`, color: "#22c55e", sub: `${((callCost/totalInvested)*100).toFixed(0)}%` },
          { label: "PUTS (CEASEFIRE)", val: `$${putCost.toFixed(0)}`, color: "#ef4444", sub: `${((putCost/totalInvested)*100).toFixed(0)}%` },
          { label: "BEST OUTCOME", val: fmt(best.r.totalPnl), color: "#22c55e", sub: `${best.r.roi.toFixed(0)}% ROI` },
          { label: "WORST OUTCOME", val: fmt(worst.r.totalPnl), color: "#ef4444", sub: `${worst.r.roi.toFixed(0)}% ROI` },
        ].map((c, i) => (
          <div key={i} style={{ background: "#0e0e1a", borderRadius: 6, padding: "12px 14px", border: "1px solid #1a1a30" }}>
            <div style={{ fontSize: 9, color: "#555", letterSpacing: "1.5px", fontWeight: 700, marginBottom: 5 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color, fontFamily: "Sora, sans-serif" }}>{c.val}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Legs Table */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: "#777" }}>POSITION LEGS</span>
          <button onClick={addLeg} style={{ background: "transparent", border: "1px solid #252540", color: "#888", padding: "5px 12px", borderRadius: 4, fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>+ Add</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 5px" }}>
            <thead>
              <tr style={{ fontSize: 9, color: "#444", letterSpacing: "1.2px" }}>
                {["TYPE", "STRIKE", "PREM", "QTY", "DTE", "COST", "THESIS", ""].map((h, i) => (
                  <th key={i} style={{ textAlign: i === 6 ? "left" : "right", padding: "3px 6px", fontWeight: 700, ...(i === 0 && { textAlign: "left" }) }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {legs.map(l => {
                const isCall = l.type === "call";
                return (
                  <tr key={l.id} style={{ background: "#0e0e1a" }}>
                    <td style={{ padding: "7px 6px", borderRadius: "4px 0 0 4px" }}>
                      <select value={l.type} onChange={e => updateLeg(l.id, "type", e.target.value)}
                        style={{ background: isCall ? "#0a1e0a" : "#1e0a0a", color: isCall ? "#22c55e" : "#ef4444", borderColor: isCall ? "#1a3a1a" : "#3a1a1a", fontWeight: 700, width: 65 }}>
                        <option value="call">CALL</option>
                        <option value="put">PUT</option>
                      </select>
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "right" }}><input type="number" value={l.strike} step={1} onChange={e => updateLeg(l.id, "strike", e.target.value)} style={{ width: 65 }} /></td>
                    <td style={{ padding: "7px 6px", textAlign: "right" }}><input type="number" value={l.premium} step={0.05} min={0.01} onChange={e => updateLeg(l.id, "premium", e.target.value)} style={{ width: 60 }} /></td>
                    <td style={{ padding: "7px 6px", textAlign: "right" }}><input type="number" value={l.contracts} step={1} min={1} onChange={e => updateLeg(l.id, "contracts", e.target.value)} style={{ width: 50 }} /></td>
                    <td style={{ padding: "7px 6px", textAlign: "right" }}><input type="number" value={l.dte} step={1} min={0} max={30} onChange={e => updateLeg(l.id, "dte", e.target.value)} style={{ width: 50 }} /></td>
                    <td style={{ padding: "7px 6px", textAlign: "right", color: "#fff", fontWeight: 600, fontSize: 13 }}>${(l.premium * l.contracts * 100).toFixed(0)}</td>
                    <td style={{ padding: "7px 6px", fontSize: 10, color: "#666" }}>
                      {isCall ? "🛢️ Escalation" : "🕊️ Ceasefire"}
                    </td>
                    <td style={{ padding: "7px 6px", textAlign: "center", borderRadius: "0 4px 4px 0" }}>
                      <button onClick={() => removeLeg(l.id)} style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 15, fontFamily: "inherit" }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Scenario Analysis */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: "#777", marginBottom: 12 }}>SCENARIO ANALYSIS</div>
        {sResults.map((s, i) => {
          const pos = s.r.totalPnl > 0;
          const barW = Math.min(Math.abs(s.r.roi) / 6, 100);
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "minmax(160px, 1.2fr) 55px 70px 1fr 80px 75px",
              alignItems: "center", gap: 6, padding: "10px 12px", marginBottom: 3,
              borderLeft: `3px solid ${s.color}`, background: i % 2 === 0 ? "#0b0b16" : "#0e0e1a",
              borderRadius: "0 6px 6px 0",
            }}>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: "#e0e0e0" }}>{s.icon} {s.name}</div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{s.note}</div>
              </div>
              <div style={{ fontSize: 11.5, color: "#888", textAlign: "right" }}>{s.move > 0 ? "+" : ""}{s.move}%</div>
              <div style={{ fontSize: 11.5, color: "#888", textAlign: "right" }}>${s.r.spot}</div>
              <div style={{ position: "relative", height: 5, background: "#151525", borderRadius: 3, overflow: "hidden" }}>
                {pos ? (
                  <div style={{ position: "absolute", left: "50%", width: `${barW/2}%`, height: "100%", background: s.color, borderRadius: "0 3px 3px 0" }} />
                ) : (
                  <div style={{ position: "absolute", right: "50%", width: `${barW/2}%`, height: "100%", background: s.color, borderRadius: "3px 0 0 3px" }} />
                )}
                <div style={{ position: "absolute", left: "50%", top: -2, width: 1, height: 9, background: "#333" }} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, textAlign: "right", color: pos ? "#22c55e" : "#ef4444", fontFamily: "Sora, sans-serif" }} className={pos ? "g" : "r"}>
                {fmt(s.r.totalPnl)}
              </div>
              <div style={{ fontSize: 11, textAlign: "right", color: pos ? "#22c55e" : "#ef4444", fontWeight: 500 }}>
                {fmtPct(s.r.roi)} ROI
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Slider */}
      <div style={{ background: "#0e0e1a", borderRadius: 8, padding: "18px 20px", marginBottom: 24, border: "1px solid #1a1a30" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: "#777" }}>CUSTOM SCENARIO</span>
          <span style={{ fontSize: 12 }}>
            XOM move: <span style={{ color: customMove >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: 17, fontFamily: "Sora, sans-serif" }} className={customMove >= 0 ? "g" : "r"}>
              {fmtPct(customMove)}
            </span>
            <span style={{ color: "#555", marginLeft: 8 }}>→ ${customR.spot}</span>
          </span>
        </div>
        <input type="range" min={-15} max={15} step={0.5} value={customMove} onChange={e => setCustomMove(parseFloat(e.target.value))} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#444", marginTop: 4 }}>
          <span>-15% Ceasefire (${(CURRENT_XOM * 0.85).toFixed(0)})</span>
          <span>0%</span>
          <span>+15% Escalation (${(CURRENT_XOM * 1.15).toFixed(0)})</span>
        </div>

        {/* Leg Breakdown */}
        <div style={{ marginTop: 14, borderTop: "1px solid #1a1a30", paddingTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 65px 65px 70px 70px", gap: 3, fontSize: 9.5, color: "#444", marginBottom: 6, fontWeight: 700, letterSpacing: "0.5px" }}>
            <span>LEG</span><span style={{ textAlign: "right" }}>ENTRY</span><span style={{ textAlign: "right" }}>EXIT</span><span style={{ textAlign: "right" }}>P&L</span><span style={{ textAlign: "right" }}>MULT</span>
          </div>
          {customR.legResults.map((l, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1fr 65px 65px 70px 70px", gap: 3,
              padding: "5px 0", fontSize: 12, borderBottom: "1px solid #0b0b16",
            }}>
              <span>
                <span style={{ color: l.type === "call" ? "#22c55e" : "#ef4444", fontWeight: 700, fontSize: 10 }}>{l.type.toUpperCase()}</span>
                <span style={{ color: "#777", marginLeft: 5 }}>${l.strike} ×{l.contracts}</span>
              </span>
              <span style={{ textAlign: "right", color: "#666" }}>${l.premium.toFixed(2)}</span>
              <span style={{ textAlign: "right", color: "#fff", fontWeight: 500 }}>${l.exit.toFixed(2)}</span>
              <span style={{ textAlign: "right", color: l.pnl >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>{fmt(l.pnl)}</span>
              <span style={{ textAlign: "right", color: l.mult >= 2 ? "#f59e0b" : l.mult >= 1 ? "#888" : "#ef4444", fontWeight: l.mult >= 2 ? 700 : 400 }}>
                {l.mult.toFixed(1)}x
              </span>
            </div>
          ))}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 65px 65px 70px 70px", gap: 3,
            padding: "8px 0 0", fontSize: 14, fontWeight: 700, borderTop: "1px solid #252540", marginTop: 4,
          }}>
            <span style={{ color: "#fff", fontFamily: "Sora, sans-serif" }}>NET P&L</span>
            <span></span><span></span>
            <span style={{ textAlign: "right", color: customR.totalPnl >= 0 ? "#22c55e" : "#ef4444", fontFamily: "Sora, sans-serif", fontSize: 17 }} className={customR.totalPnl >= 0 ? "g" : "r"}>
              {fmt(customR.totalPnl)}
            </span>
            <span style={{ textAlign: "right", color: customR.totalPnl >= 0 ? "#22c55e" : "#ef4444", fontSize: 12 }}>
              {fmtPct(customR.roi)}
            </span>
          </div>
        </div>
      </div>

      {/* XOM-Specific Execution Notes */}
      <div style={{ background: "linear-gradient(135deg, #0e0e1a, #12100a)", borderRadius: 8, padding: "18px 20px", border: "1px solid #2a2515", marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", color: "#f59e0b", marginBottom: 12 }}>XOM-SPECIFIC PLAYBOOK</div>
        {[
          { label: "INVERTED LOGIC", text: "Unlike index trades, your CALLS are the war bet and PUTS are the peace bet. Escalation → oil spikes → XOM rips. Ceasefire → oil crashes → XOM dumps. Keep this straight when managing the position.", color: "#f59e0b" },
          { label: "OIL IS YOUR SIGNAL", text: "Watch WTI crude, not S&P futures. If CL breaks $115 before the deadline, your calls are winning. If CL drops below $108, your puts are in play. XOM moves ~0.6-0.8% for every 1% move in crude.", color: "#22c55e" },
          { label: "EARNINGS RISK", text: "XOM reports Apr 24 — your 7DTE calls survive into the earnings IV build-up zone, which adds a hidden tailwind to call premiums even if XOM stays flat. Time value won't decay as fast as normal.", color: "#a855f7" },
          { label: "WIDER STRIKES NEEDED", text: "XOM has higher single-stock vol than SPY/QQQ. A 5-8% move in a session is realistic on a genuine Hormuz event. Go wider OTM than you would on index — that's where the asymmetry lives.", color: "#ef4444" },
          { label: "BID-ASK WATCH", text: "XOM options are liquid but not SPY-liquid. Use limit orders, target the mid. Avoid the first 5 minutes of the session — spreads are widest then. Enter after 9:45 ET.", color: "#888" },
        ].map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
            <div style={{ minWidth: 100, fontSize: 10, fontWeight: 700, color: n.color, letterSpacing: "0.5px", paddingTop: 2 }}>{n.label}</div>
            <div style={{ fontSize: 12, color: "#aaa", lineHeight: 1.6 }}>{n.text}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: "#333", textAlign: "center", padding: "12px 16px", borderTop: "1px solid #151525", lineHeight: 1.6 }}>
        Model uses simplified intrinsic + time value estimation. Actual option prices depend on IV surface, skew, and real-time liquidity. 
        Swap in live premiums at open. Max loss = total premium.
      </div>
    </div>
  );
}
