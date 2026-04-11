"use client";

import { useEffect, useState } from "react";
import {
  buildStarterLegs,
  estimateOptionPrice,
  type EventCandidate,
  type EventKind,
  type PlannerLeg,
  type TickerProfile,
  type WeeklyScanSnapshot,
} from "../lib/weekly-event-lab";

function fmtDollar(value: number, digits = 0) {
  return `$${value.toFixed(digits)}`;
}

function fmtPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 1000) return `${value > 0 ? "+" : ""}$${(value / 1000).toFixed(1)}k`;
  return `${value > 0 ? "+" : ""}$${value.toFixed(0)}`;
}

function scoreHint(event: EventCandidate) {
  if (event.ranking.marketImpact >= 95) return "Broad market mover";
  if (event.ranking.asymmetry >= 90) return "Best asymmetry";
  if (event.ranking.tickerSensitivity >= 90) return "Strong ticker transmission";
  return "Solid weekly candidate";
}

function safeNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

type ScenarioResult = {
  spotAtEvent: number;
  totalPnl: number;
  roi: number;
  legResults: Array<
    PlannerLeg & {
      exit: number;
      value: number;
      cost: number;
      pnl: number;
      multiple: number;
    }
  >;
};

export function WeeklyEventLab({ snapshot }: { snapshot: WeeklyScanSnapshot }) {
  const [kindFilter, setKindFilter] = useState<"all" | EventKind>("all");
  const [selectedEventId, setSelectedEventId] = useState(snapshot.events[0]?.id ?? "");
  const [selectedSymbol, setSelectedSymbol] = useState(snapshot.events[0]?.primarySymbol ?? "");
  const [spotInput, setSpotInput] = useState("");
  const [impliedMoveInput, setImpliedMoveInput] = useState("");
  const [customMove, setCustomMove] = useState(0);
  const [legs, setLegs] = useState<PlannerLeg[]>([]);

  const filteredEvents = snapshot.events.filter((event) => kindFilter === "all" || event.kind === kindFilter);
  const selectedEvent =
    filteredEvents.find((event) => event.id === selectedEventId) ??
    snapshot.events.find((event) => event.id === selectedEventId) ??
    filteredEvents[0] ??
    snapshot.events[0];
  const selectedProfile =
    selectedEvent?.tickerProfiles.find((profile) => profile.symbol === selectedSymbol) ??
    selectedEvent?.tickerProfiles[0] ??
    null;

  useEffect(() => {
    if (!filteredEvents.some((event) => event.id === selectedEventId) && filteredEvents[0]) {
      setSelectedEventId(filteredEvents[0].id);
      setSelectedSymbol(filteredEvents[0].primarySymbol);
    }
  }, [filteredEvents, selectedEventId]);

  useEffect(() => {
    if (!selectedEvent) return;
    if (!selectedEvent.tickerProfiles.some((profile) => profile.symbol === selectedSymbol)) {
      setSelectedSymbol(selectedEvent.primarySymbol);
    }
  }, [selectedEvent, selectedSymbol]);

  useEffect(() => {
    if (!selectedProfile) return;
    setSpotInput(selectedProfile.seedSpot.toFixed(2));
    setImpliedMoveInput(selectedProfile.impliedMovePct.toFixed(1));
    setLegs(buildStarterLegs(selectedProfile, selectedProfile.seedSpot));
    setCustomMove(0);
  }, [selectedProfile]);

  if (!selectedEvent || !selectedProfile) {
    return (
      <section className="shell-card scan-shell">
        <p className="support-note">No events are available for this week yet.</p>
      </section>
    );
  }

  const currentSpot = safeNumber(spotInput, selectedProfile.seedSpot);
  const impliedMove = safeNumber(impliedMoveInput, selectedProfile.impliedMovePct);
  const totalInvested = legs.reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);
  const callCost = legs.filter((leg) => leg.type === "call").reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);
  const putCost = legs.filter((leg) => leg.type === "put").reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);
  const uniqueCoverage = new Set(snapshot.events.flatMap((event) => event.watchlistTickers)).size;

  function calculateScenario(movePct: number): ScenarioResult {
    const spotAtEvent = currentSpot * (1 + movePct / 100);
    let totalPnl = 0;
    const legResults = legs.map((leg) => {
      const exit = estimateOptionPrice(leg.type, leg.strike, leg.premium, leg.dte, spotAtEvent, currentSpot);
      const cost = leg.premium * leg.contracts * 100;
      const value = exit * leg.contracts * 100;
      const pnl = value - cost;
      totalPnl += pnl;
      return { ...leg, exit, value, cost, pnl, multiple: cost > 0 ? value / cost : 0 };
    });

    return {
      spotAtEvent,
      totalPnl,
      roi: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
      legResults,
    };
  }

  function updateLeg(id: number, field: "type" | "strike" | "premium" | "contracts" | "dte", value: string) {
    setLegs((current) =>
      current.map((leg) => {
        if (leg.id !== id) return leg;
        if (field === "type") return { ...leg, type: value === "put" ? "put" : "call" };
        if (field === "strike") return { ...leg, strike: Number.parseFloat(value) || 0 };
        if (field === "premium") return { ...leg, premium: Number.parseFloat(value) || 0 };
        if (field === "contracts") return { ...leg, contracts: Number.parseFloat(value) || 0 };
        return { ...leg, dte: Number.parseFloat(value) || 0 };
      }),
    );
  }

  function addLeg() {
    const nextId = Math.max(0, ...legs.map((leg) => leg.id)) + 1;
    setLegs((current) => [
      ...current,
      {
        id: nextId,
        type: "call",
        strike: Math.round(currentSpot),
        premium: 1,
        contracts: 1,
        dte: 7,
        label: "New leg",
        thesis: "Custom",
      },
    ]);
  }

  function removeLeg(id: number) {
    if (legs.length <= 1) return;
    setLegs((current) => current.filter((leg) => leg.id !== id));
  }

  function loadEvent(event: EventCandidate) {
    setSelectedEventId(event.id);
    setSelectedSymbol(event.primarySymbol);
  }

  function loadProfile(profile: TickerProfile) {
    setSelectedSymbol(profile.symbol);
  }

  function resetStarterLegs() {
    setLegs(buildStarterLegs(selectedProfile, currentSpot));
  }

  const scenarioRows = selectedProfile.scenarios.map((scenario) => ({
    scenario,
    result: calculateScenario(scenario.movePct),
    versusImplied: impliedMove > 0 ? Math.abs(scenario.movePct) / impliedMove : 0,
  }));
  const bestRow = scenarioRows.reduce((best, row) => (row.result.totalPnl > best.result.totalPnl ? row : best), scenarioRows[0]);
  const worstRow = scenarioRows.reduce((worst, row) => (row.result.totalPnl < worst.result.totalPnl ? row : worst), scenarioRows[0]);
  const customResult = calculateScenario(customMove);
  const moves = selectedProfile.scenarios.map((scenario) => scenario.movePct);
  const sliderMin = Math.floor(Math.min(-10, ...moves) - 2);
  const sliderMax = Math.ceil(Math.max(10, ...moves) + 2);
  const launchLeg = legs[0];
  const legacyHref = `/?ticker=${encodeURIComponent(selectedProfile.symbol)}&price=${encodeURIComponent(
    currentSpot.toFixed(2),
  )}${launchLeg ? `&strike=${encodeURIComponent(launchLeg.strike.toFixed(2))}&dte=${encodeURIComponent(String(launchLeg.dte))}` : ""}`;

  return (
    <>
      <section className="hero-card scan-hero">
        <div className="scan-hero-copy">
          <span className="eyebrow">Weekly Event Lab</span>
          <h1>{snapshot.weekLabel}</h1>
          <p>
            Monday-style scan for the week&apos;s most relevant catalysts, ranked before we drop into implied move work and
            scenario planning.
          </p>
          <div className="scan-chip-row">
            {snapshot.topThemes.map((theme) => (
              <span key={theme} className="scan-chip muted">
                {theme}
              </span>
            ))}
          </div>
          <ul className="scan-note-list">
            {snapshot.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>

        <div className="scan-summary-grid">
          <article className="scan-stat-card">
            <span className="level-kicker">Top Event</span>
            <strong>{snapshot.events[0]?.title ?? "--"}</strong>
            <p>{snapshot.events[0] ? `${snapshot.events[0].ranking.composite}/100 scan score` : "No event seeded yet."}</p>
          </article>
          <article className="scan-stat-card">
            <span className="level-kicker">Coverage</span>
            <strong>{uniqueCoverage} tickers</strong>
            <p>Across your core book, macro vehicles, and a smaller beta satellite bucket.</p>
          </article>
          <article className="scan-stat-card">
            <span className="level-kicker">Data Mode</span>
            <strong>Seeded v1</strong>
            <p>Built to stay deployable on Vercel while we wire in live calendars and options data next.</p>
          </article>
          <article className="scan-stat-card">
            <span className="level-kicker">JSON Hook</span>
            <strong>/weekly-scan/data</strong>
            <p>A separate data endpoint for future cron jobs, without touching the legacy calculator backend.</p>
          </article>
        </div>
      </section>

      <section className="shell-card scan-workbench">
        <div className="scan-workbench-head">
          <div>
            <span className="eyebrow">Event Ranking</span>
            <h2>{snapshot.weekRangeLabel}</h2>
            <p>Filter the board, pick the event, then swap in live spot, implied move, and premiums before planning the trade.</p>
          </div>
          <div className="scan-filter-row">
            {(["all", "macro", "commodity", "earnings"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`scan-filter-pill ${kindFilter === kind ? "active" : ""}`}
                onClick={() => setKindFilter(kind)}
              >
                {kind}
              </button>
            ))}
          </div>
        </div>

        <div className="scan-event-grid">
          {filteredEvents.map((event, index) => (
            <button
              key={event.id}
              type="button"
              className={`scan-event-row ${event.id === selectedEvent.id ? "selected" : ""}`}
              onClick={() => loadEvent(event)}
            >
              <div className="scan-event-row-top">
                <span className="scan-rank">#{index + 1}</span>
                <span className="scan-score">{event.ranking.composite}</span>
              </div>
              <strong>{event.title}</strong>
              <p>{event.summary}</p>
              <div className="scan-meta-line">
                <span>{event.eventLabel}</span>
                <span>{event.timeLabel}</span>
                <span>{scoreHint(event)}</span>
              </div>
              <div className="scan-chip-row">
                {event.watchlistTickers.slice(0, 4).map((ticker) => (
                  <span key={ticker} className="scan-chip">
                    {ticker}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="scan-detail-panel">
            <section className="scan-detail-card">
              <div className="scan-detail-head">
                <div>
                  <span className="eyebrow">{selectedEvent.kind}</span>
                  <h3>{selectedEvent.title}</h3>
                  <p>{selectedEvent.whyItMatters}</p>
                </div>
                <div className="scan-score-block">
                  <strong>{selectedEvent.ranking.composite}</strong>
                  <span>Scan score</span>
                </div>
              </div>

              <div className="scan-kpi-grid">
                <article className="scan-kpi-card"><span className="level-kicker">Scope</span><strong>{selectedEvent.scope}</strong></article>
                <article className="scan-kpi-card"><span className="level-kicker">Market Proxy</span><strong>{selectedEvent.marketProxy}</strong></article>
                <article className="scan-kpi-card"><span className="level-kicker">Timing</span><strong>{selectedEvent.eventLabel} | {selectedEvent.timeLabel}</strong></article>
                <article className="scan-kpi-card"><span className="level-kicker">Asymmetry</span><strong>{selectedEvent.ranking.asymmetry}/100</strong></article>
              </div>

              <div className="scan-chip-row">
                {selectedEvent.tags.map((tag) => (
                  <span key={tag} className="scan-chip muted">{tag}</span>
                ))}
              </div>
            </section>

            <section className="scan-detail-card">
              <div className="scan-detail-head compact">
                <div>
                  <h3>Scenario Planner</h3>
                  <p>{selectedEvent.scenarioPlanningNote}</p>
                </div>
                <div className="scan-chip-row">
                  {selectedEvent.tickerProfiles.map((profile) => (
                    <button
                      key={profile.symbol}
                      type="button"
                      className={`scan-tab ${profile.symbol === selectedProfile.symbol ? "active" : ""}`}
                      onClick={() => loadProfile(profile)}
                    >
                      {profile.symbol}
                    </button>
                  ))}
                </div>
              </div>

              <div className="scan-planner-toolbar">
                <label className="field-row compact-input">
                  <span>Spot</span>
                  <input value={spotInput} onChange={(event) => setSpotInput(event.target.value)} inputMode="decimal" />
                </label>
                <label className="field-row compact-input">
                  <span>Implied Move %</span>
                  <input value={impliedMoveInput} onChange={(event) => setImpliedMoveInput(event.target.value)} inputMode="decimal" />
                </label>
                <button type="button" className="secondary-btn" onClick={resetStarterLegs}>Reset Starter Legs</button>
                <a className="primary-btn" href={legacyHref}>Open Legacy Calculator</a>
              </div>

              <div className="scan-context-banner">
                <div>
                  <span className="level-kicker">Selected Ticker</span>
                  <strong>{selectedProfile.symbol}</strong>
                </div>
                <p>
                  Every leg below belongs to <strong>{selectedProfile.symbol}</strong>. Use <strong>CALL</strong> for the upside
                  expression and <strong>PUT</strong> for the downside or relief leg depending on the event.
                </p>
              </div>

              <div className="scan-mini-grid">
                <article className="scan-mini-card"><span className="level-kicker">Profile</span><strong>{selectedProfile.label}</strong><p>{selectedProfile.driver}</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Deployed</span><strong>{fmtDollar(totalInvested)}</strong><p>{legs.length} editable legs</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Calls vs Puts</span><strong>{fmtDollar(callCost)} / {fmtDollar(putCost)}</strong><p>Starter allocation only</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Best vs Worst</span><strong>{compactMoney(bestRow.result.totalPnl)} / {compactMoney(worstRow.result.totalPnl)}</strong><p>{selectedProfile.scenarioFocus}</p></article>
              </div>

              <div className="scan-table-wrap">
                <div className="scan-table-head">
                  <strong>Editable Legs</strong>
                  <button type="button" className="secondary-btn" onClick={addLeg}>Add Leg</button>
                </div>
                <table className="scan-leg-table">
                  <thead>
                    <tr>
                      <th>Contract</th><th>Setup</th><th>Strike</th><th>Premium</th><th>Qty</th><th>DTE</th><th>Cost</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {legs.map((leg) => (
                      <tr key={leg.id}>
                        <td>
                          <div className="scan-contract-cell">
                            <span className="scan-ticker-pill">{selectedProfile.symbol}</span>
                            <select className="scan-select" value={leg.type} onChange={(event) => updateLeg(leg.id, "type", event.target.value)}>
                              <option value="call">CALL</option>
                              <option value="put">PUT</option>
                            </select>
                          </div>
                        </td>
                        <td>
                          <div className="scan-setup-cell">
                            <strong>{leg.label}</strong>
                            <span>{leg.thesis}</span>
                          </div>
                        </td>
                        <td><input className="scan-input" value={leg.strike} onChange={(event) => updateLeg(leg.id, "strike", event.target.value)} inputMode="decimal" /></td>
                        <td><input className="scan-input" value={leg.premium} onChange={(event) => updateLeg(leg.id, "premium", event.target.value)} inputMode="decimal" /></td>
                        <td><input className="scan-input" value={leg.contracts} onChange={(event) => updateLeg(leg.id, "contracts", event.target.value)} inputMode="numeric" /></td>
                        <td><input className="scan-input" value={leg.dte} onChange={(event) => updateLeg(leg.id, "dte", event.target.value)} inputMode="numeric" /></td>
                        <td>{fmtDollar(leg.premium * leg.contracts * 100)}</td>
                        <td><button type="button" className="scan-remove" onClick={() => removeLeg(leg.id)}>x</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="scan-scenario-list">
                {scenarioRows.map(({ scenario, result, versusImplied }) => (
                  <article key={scenario.name} className="scan-scenario-row">
                    <div>
                      <strong>{scenario.name}</strong>
                      <p>{scenario.note}</p>
                    </div>
                    <div className="scan-scenario-metrics">
                      <span>{fmtPct(scenario.movePct)}</span>
                      <span>{fmtDollar(result.spotAtEvent, 2)}</span>
                      <span>{versusImplied.toFixed(1)}x implied</span>
                      <span className={result.totalPnl >= 0 ? "bull-text" : "bear-text"}>{compactMoney(result.totalPnl)}</span>
                    </div>
                  </article>
                ))}
              </div>

              <div className="scan-slider-card">
                <div className="scan-slider-head">
                  <strong>Custom Move {fmtPct(customMove)}</strong>
                  <span>{fmtDollar(customResult.spotAtEvent, 2)} | {compactMoney(customResult.totalPnl)}</span>
                </div>
                <input type="range" min={sliderMin} max={sliderMax} step={0.5} value={customMove} onChange={(event) => setCustomMove(Number.parseFloat(event.target.value))} />
                <div className="scan-breakdown-grid">
                  {customResult.legResults.map((leg) => (
                    <div key={leg.id} className="scan-breakdown-card">
                      <strong>{leg.type.toUpperCase()} {fmtDollar(leg.strike, 2)}</strong>
                      <p>{leg.label} | {leg.contracts}x | {leg.dte} DTE</p>
                      <p>{compactMoney(leg.pnl)} | {leg.multiple.toFixed(1)}x</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="scan-detail-card">
              <div className="scan-two-col">
                <div>
                  <h3>Data Checklist</h3>
                  <ul className="scan-note-list dense">
                    {selectedEvent.dataChecklist.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3>Watchlist Lens</h3>
                  <div className="scan-watchlist-grid">
                    {snapshot.watchlist.map((group) => (
                      <article key={group.name} className="scan-watch-card">
                        <strong>{group.name}</strong>
                        <p>{group.note}</p>
                        <div className="scan-chip-row">
                          {group.tickers.slice(0, 5).map((ticker) => (
                            <span key={ticker} className="scan-chip">{ticker}</span>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </>
  );
}
