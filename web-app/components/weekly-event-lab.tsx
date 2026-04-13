"use client";

import { useEffect, useState } from "react";
import {
  buildPortfolioStarterLegs,
  estimateOptionPrice,
  type EventCandidate,
  type EventKind,
  type PlannerLeg,
  type PortfolioScenario,
  type TickerProfile,
  type WeeklyScanSnapshot,
} from "../lib/weekly-event-lab";

function fmtDollar(value: number, digits = 0) {
  return `$${value.toFixed(digits)}`;
}

function fmtPct(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function fmtSignedNumber(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}`;
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 1000) return `${value > 0 ? "+" : ""}$${(value / 1000).toFixed(1)}k`;
  return `${value > 0 ? "+" : ""}$${value.toFixed(0)}`;
}

function fmtMultiple(value: number) {
  return `${value.toFixed(1)}x`;
}

function fmtProbability(value: number | null) {
  return value == null ? "N/A" : `${value}%`;
}

function qualityTone(quality: "high" | "medium" | "low") {
  if (quality === "high") return "bull-chip";
  if (quality === "low") return "bear-chip";
  return "muted";
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
  totalPnl: number;
  roi: number;
  symbolMoves: Array<{
    symbol: string;
    movePct: number;
    spot: number;
    spotAtEvent: number;
    impliedMovePct: number;
  }>;
  legResults: Array<
    PlannerLeg & {
      exit: number;
      value: number;
      cost: number;
      pnl: number;
      multiple: number;
      spotAtEvent: number;
      movePct: number;
    }
  >;
};

type TickerInputState = Record<string, { spot: string; impliedMove: string }>;

function buildTickerInputs(event: EventCandidate): TickerInputState {
  return Object.fromEntries(
    event.tickerProfiles.map((profile) => [
      profile.symbol,
      {
        spot: profile.seedSpot.toFixed(2),
        impliedMove: profile.impliedMovePct.toFixed(1),
      },
    ]),
  );
}

export function WeeklyEventLab({ snapshot }: { snapshot: WeeklyScanSnapshot }) {
  const [kindFilter, setKindFilter] = useState<"all" | EventKind>("all");
  const [selectedEventId, setSelectedEventId] = useState(snapshot.events[0]?.id ?? "");
  const [selectedSymbol, setSelectedSymbol] = useState(snapshot.events[0]?.primarySymbol ?? "");
  const [tickerInputs, setTickerInputs] = useState<TickerInputState>(
    snapshot.events[0] ? buildTickerInputs(snapshot.events[0]) : {},
  );
  const [selectedScenarioName, setSelectedScenarioName] = useState(snapshot.events[0]?.portfolioScenarios[0]?.name ?? "");
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
    if (!selectedEvent) return;
    setTickerInputs(buildTickerInputs(selectedEvent));
    setLegs(buildPortfolioStarterLegs(selectedEvent));
    setSelectedScenarioName(selectedEvent.portfolioScenarios[0]?.name ?? "");
  }, [selectedEvent]);

  if (!selectedEvent || !selectedProfile) {
    return (
      <section className="shell-card scan-shell">
        <p className="support-note">No events are available for this week yet.</p>
      </section>
    );
  }

  const spotBySymbol = Object.fromEntries(
    selectedEvent.tickerProfiles.map((profile) => [
      profile.symbol,
      safeNumber(tickerInputs[profile.symbol]?.spot ?? "", profile.seedSpot),
    ]),
  );
  const impliedMoveBySymbol = Object.fromEntries(
    selectedEvent.tickerProfiles.map((profile) => [
      profile.symbol,
      safeNumber(tickerInputs[profile.symbol]?.impliedMove ?? "", profile.impliedMovePct),
    ]),
  );
  const totalInvested = legs.reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);
  const callCost = legs.filter((leg) => leg.type === "call").reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);
  const putCost = legs.filter((leg) => leg.type === "put").reduce((sum, leg) => sum + leg.premium * leg.contracts * 100, 0);
  const uniqueCoverage = new Set(snapshot.events.flatMap((event) => event.watchlistTickers)).size;
  const probabilityWeightByName = new Map(
    selectedEvent.probabilityOverlay.scenarioWeights.map((weight) => [weight.scenarioName, weight]),
  );

  function calculateScenario(scenario: PortfolioScenario): ScenarioResult {
    const symbolMoves = selectedEvent.tickerProfiles.map((profile) => {
      const spot = spotBySymbol[profile.symbol] ?? profile.seedSpot;
      const movePct = scenario.moves[profile.symbol] ?? 0;
      return {
        symbol: profile.symbol,
        movePct,
        spot,
        spotAtEvent: spot * (1 + movePct / 100),
        impliedMovePct: impliedMoveBySymbol[profile.symbol] ?? profile.impliedMovePct,
      };
    });
    const moveBySymbol = Object.fromEntries(symbolMoves.map((move) => [move.symbol, move]));
    let totalPnl = 0;
    const legResults = legs.map((leg) => {
      const currentSpot = moveBySymbol[leg.symbol]?.spot ?? 100;
      const spotAtEvent = moveBySymbol[leg.symbol]?.spotAtEvent ?? currentSpot;
      const movePct = moveBySymbol[leg.symbol]?.movePct ?? 0;
      const exit = estimateOptionPrice(leg.type, leg.strike, leg.premium, leg.dte, spotAtEvent, currentSpot);
      const cost = leg.premium * leg.contracts * 100;
      const value = exit * leg.contracts * 100;
      const pnl = value - cost;
      totalPnl += pnl;
      return { ...leg, exit, value, cost, pnl, multiple: cost > 0 ? value / cost : 0, spotAtEvent, movePct };
    });

    return {
      totalPnl,
      roi: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
      symbolMoves,
      legResults,
    };
  }

  function updateLeg(id: number, field: "symbol" | "type" | "strike" | "premium" | "contracts" | "dte", value: string) {
    setLegs((current) =>
      current.map((leg) => {
        if (leg.id !== id) return leg;
        if (field === "symbol") return { ...leg, symbol: value };
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
        symbol: selectedSymbol,
        type: "call",
        strike: Math.round(spotBySymbol[selectedSymbol] ?? selectedProfile.seedSpot),
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
    setLegs(buildPortfolioStarterLegs(selectedEvent, spotBySymbol));
  }

  function updateTickerInput(symbol: string, field: "spot" | "impliedMove", value: string) {
    setTickerInputs((current) => ({
      ...current,
      [symbol]: {
        spot: current[symbol]?.spot ?? "",
        impliedMove: current[symbol]?.impliedMove ?? "",
        [field]: value,
      },
    }));
  }

  const scenarioRows = selectedEvent.portfolioScenarios.map((scenario) => ({
    scenario,
    probabilityWeight: probabilityWeightByName.get(scenario.name),
    result: calculateScenario(scenario),
  }));
  const bestRow = scenarioRows.reduce((best, row) => (row.result.totalPnl > best.result.totalPnl ? row : best), scenarioRows[0]);
  const worstRow = scenarioRows.reduce((worst, row) => (row.result.totalPnl < worst.result.totalPnl ? row : worst), scenarioRows[0]);
  const weightedExpectedPnl = scenarioRows.reduce(
    (sum, row) => sum + row.result.totalPnl * (row.scenario.probability / 100),
    0,
  );
  const rewardRiskMultiple =
    bestRow.result.totalPnl > 0 && worstRow.result.totalPnl < 0
      ? bestRow.result.totalPnl / Math.abs(worstRow.result.totalPnl)
      : 0;
  const passesGuardrail = rewardRiskMultiple >= 2.5;
  const selectedScenarioRow =
    scenarioRows.find((row) => row.scenario.name === selectedScenarioName) ?? scenarioRows[0];
  const selectedScenarioStress = selectedScenarioRow.result.symbolMoves.reduce((max, move) => {
    const multiple = move.impliedMovePct > 0 ? Math.abs(move.movePct) / move.impliedMovePct : 0;
    return Math.max(max, multiple);
  }, 0);
  const launchLeg = legs[0];
  const legacyHref = `/?ticker=${encodeURIComponent(selectedProfile.symbol)}&price=${encodeURIComponent(
    (spotBySymbol[selectedProfile.symbol] ?? selectedProfile.seedSpot).toFixed(2),
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
            <strong>Seeded + Blend</strong>
            <p>Built to stay deployable on Vercel while we wire in live calendars, prediction markets, and options data next.</p>
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

              <div className="scan-score-grid">
                <article className="scan-score-card"><span className="level-kicker">Market Impact</span><strong>{selectedEvent.ranking.marketImpact}</strong></article>
                <article className="scan-score-card"><span className="level-kicker">Ticker Sensitivity</span><strong>{selectedEvent.ranking.tickerSensitivity}</strong></article>
                <article className="scan-score-card"><span className="level-kicker">Liquidity</span><strong>{selectedEvent.ranking.liquidity}</strong></article>
                <article className="scan-score-card"><span className="level-kicker">Confidence</span><strong>{selectedEvent.ranking.confidence}</strong></article>
                <article className="scan-score-card"><span className="level-kicker">Composite Logic</span><strong>{selectedEvent.ranking.composite}</strong><p>Weighted blend with a confidence penalty so high-impact but lower-conviction events do not crowd the top of the board.</p></article>
              </div>

              <div className="scan-chip-row">
                {selectedEvent.tags.map((tag) => (
                  <span key={tag} className="scan-chip muted">{tag}</span>
                ))}
              </div>

              <div className="scan-probability-panel">
                <div className="scan-detail-head compact">
                  <div>
                    <h3>Probability Engine</h3>
                    <p>{selectedEvent.probabilityOverlay.note}</p>
                  </div>
                  <span className={`scan-mode-pill ${selectedEvent.probabilityOverlay.mode}`}>
                    {selectedEvent.probabilityOverlay.mode === "hybrid" ? "Hybrid Blend" : "Historical Only"}
                  </span>
                </div>

                <div className="scan-probability-grid">
                  {selectedEvent.probabilityOverlay.sources.length > 0 ? (
                    selectedEvent.probabilityOverlay.sources.map((source) => (
                      <article key={`${source.source}-${source.marketLabel}-${source.contractLabel}`} className="scan-probability-card">
                        <div className="scan-probability-top">
                          <strong>{source.source.toUpperCase()}</strong>
                          <span className={`scan-chip ${qualityTone(source.quality)}`}>{source.quality} quality</span>
                        </div>
                        <p>{source.marketLabel}</p>
                        <strong>{source.contractLabel}</strong>
                        <div className="scan-probability-stats">
                          <span>{fmtProbability(source.probability)} live bias</span>
                          <span>{fmtSignedNumber(source.change1d)} pts 1d</span>
                        </div>
                        <p>{source.note}</p>
                      </article>
                    ))
                  ) : (
                    <article className="scan-probability-card">
                      <div className="scan-probability-top">
                        <strong>No Direct Market</strong>
                        <span className="scan-chip muted">Historical prior</span>
                      </div>
                      <p>This setup currently leans on category history and your forward event journal rather than a clean market-implied odds feed.</p>
                    </article>
                  )}
                </div>

                <p className="scan-inline-note">
                  {selectedEvent.probabilityOverlay.blendRule}
                </p>
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
                <button type="button" className="secondary-btn" onClick={resetStarterLegs}>Reset Starter Legs</button>
                <a className="primary-btn" href={legacyHref}>Open Legacy Calculator</a>
              </div>

              <div className="scan-context-banner">
                <div>
                  <span className="level-kicker">Portfolio Mode</span>
                  <strong>{selectedEvent.tickerProfiles.map((profile) => profile.symbol).join(" / ")}</strong>
                </div>
                <p>
                  One event can now mix adjacent tickers in the same setup. Keep <strong>{selectedProfile.symbol}</strong> as your
                  focus name for chain work, but use the editable legs below to stack cleaner cross-ticker asymmetry.
                </p>
              </div>

              <div className="scan-symbol-grid">
                {selectedEvent.tickerProfiles.map((profile) => (
                  <article key={profile.symbol} className={`scan-symbol-card ${profile.symbol === selectedProfile.symbol ? "focus" : ""}`}>
                    <div className="scan-symbol-head">
                      <button type="button" className={`scan-tab ${profile.symbol === selectedProfile.symbol ? "active" : ""}`} onClick={() => loadProfile(profile)}>
                        {profile.symbol}
                      </button>
                      <span>{profile.driver}</span>
                    </div>
                    <div className="scan-symbol-input-grid">
                      <label className="field-row compact-input">
                        <span>Spot</span>
                        <input
                          value={tickerInputs[profile.symbol]?.spot ?? profile.seedSpot.toFixed(2)}
                          onChange={(event) => updateTickerInput(profile.symbol, "spot", event.target.value)}
                          inputMode="decimal"
                        />
                      </label>
                      <label className="field-row compact-input">
                        <span>Implied Move %</span>
                        <input
                          value={tickerInputs[profile.symbol]?.impliedMove ?? profile.impliedMovePct.toFixed(1)}
                          onChange={(event) => updateTickerInput(profile.symbol, "impliedMove", event.target.value)}
                          inputMode="decimal"
                        />
                      </label>
                    </div>
                    <p>{profile.scenarioFocus}</p>
                  </article>
                ))}
              </div>

              <div className="scan-mini-grid">
                <article className="scan-mini-card"><span className="level-kicker">Focus Ticker</span><strong>{selectedProfile.label}</strong><p>{selectedProfile.driver}</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Deployed</span><strong>{fmtDollar(totalInvested)}</strong><p>{legs.length} editable legs across {selectedEvent.tickerProfiles.length} tickers</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Calls vs Puts</span><strong>{fmtDollar(callCost)} / {fmtDollar(putCost)}</strong><p>Starter allocation can now mix symbols</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Weighted Expectancy</span><strong>{compactMoney(weightedExpectedPnl)}</strong><p>Uses blended scenario weights from history and prediction-market bias when a clean market exists.</p></article>
                <article className="scan-mini-card"><span className="level-kicker">Best vs Worst</span><strong>{compactMoney(bestRow.result.totalPnl)} / {compactMoney(worstRow.result.totalPnl)}</strong><p className={passesGuardrail ? "bull-text" : "bear-text"}>{passesGuardrail ? `Passes 1:2.5 floor at ${fmtMultiple(rewardRiskMultiple)}` : `Needs rebalance: ${fmtMultiple(rewardRiskMultiple)} vs 2.5x floor`}</p></article>
              </div>

              <div className="scan-method-grid">
                <article className="scan-method-card">
                  <span className="level-kicker">Outcome Memory</span>
                  <strong>Not Stored Yet</strong>
                  <p>This version does not write event outcomes to a database yet, so the weights are seeded rather than learned from prior weeks.</p>
                </article>
                <article className="scan-method-card">
                  <span className="level-kicker">Prediction Market Blend</span>
                  <strong>{selectedEvent.probabilityOverlay.mode === "hybrid" ? "Bias overlay active" : "No direct contract yet"}</strong>
                  <p>{selectedEvent.probabilityOverlay.mode === "hybrid" ? "Live market odds help tilt the scenario weights, but they do not replace move mapping or option-chain quality checks." : "This board keeps the historical prior fully in control until we have a cleaner external probability source."}</p>
                </article>
                <article className="scan-method-card">
                  <span className="level-kicker">Seeded Inputs</span>
                  <strong>Manual Starting Point</strong>
                  <p>Spot, implied move, and premiums are starter values. Replace them with live chain data before using the planner for sizing.</p>
                </article>
                <article className="scan-method-card">
                  <span className="level-kicker">Strike Logic</span>
                  <strong>Percent Off Spot</strong>
                  <p>Reset Starter Legs rebuilds strikes off the spot you enter using each leg&apos;s seeded distance band, then rounds to listed strike increments.</p>
                </article>
                <article className="scan-method-card">
                  <span className="level-kicker">Scenario Realism</span>
                  <strong>{fmtMultiple(selectedScenarioStress)} max implied stretch</strong>
                  <p>Anything much above roughly 2.0x the seeded implied move should be treated as a stress case, not a base expectation.</p>
                </article>
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
                            <select className="scan-select" value={leg.symbol} onChange={(event) => updateLeg(leg.id, "symbol", event.target.value)}>
                              {selectedEvent.tickerProfiles.map((profile) => (
                                <option key={profile.symbol} value={profile.symbol}>{profile.symbol}</option>
                              ))}
                            </select>
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
                            <span>
                              {(() => {
                                const currentSpot = spotBySymbol[leg.symbol] ?? 0;
                                const impliedMovePct = impliedMoveBySymbol[leg.symbol] ?? 0;
                                const strikeDistancePct =
                                  currentSpot > 0 ? (Math.abs(leg.strike - currentSpot) / currentSpot) * 100 : 0;
                                const impliedMultiple =
                                  impliedMovePct > 0 ? strikeDistancePct / impliedMovePct : 0;
                                return `${strikeDistancePct.toFixed(1)}% from spot | ${fmtMultiple(impliedMultiple)} of implied`;
                              })()}
                            </span>
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
                {scenarioRows.map(({ scenario, probabilityWeight, result }) => (
                  <button
                    key={scenario.name}
                    type="button"
                    className={`scan-scenario-row ${selectedScenarioRow.scenario.name === scenario.name ? "selected" : ""}`}
                    onClick={() => setSelectedScenarioName(scenario.name)}
                  >
                    <div>
                      <strong>{scenario.name}</strong>
                      <p>{scenario.note}</p>
                    </div>
                    {probabilityWeight ? (
                      <div className="scan-probability-row">
                        <span>Hist {fmtProbability(probabilityWeight.historicalPrior)}</span>
                        <span>Market {fmtProbability(probabilityWeight.marketImplied)}</span>
                        <span>Blend {fmtProbability(probabilityWeight.blendedProbability)}</span>
                      </div>
                    ) : null}
                    <div className="scan-chip-row">
                      {result.symbolMoves.map((move) => (
                        <span key={`${scenario.name}-${move.symbol}`} className={`scan-chip ${move.movePct >= 0 ? "bull-chip" : "bear-chip"}`}>
                          {move.symbol} {fmtPct(move.movePct)}
                        </span>
                      ))}
                    </div>
                    <div className="scan-scenario-metrics">
                      <span>{scenario.probability}% weight</span>
                      <span className={result.totalPnl >= 0 ? "bull-text" : "bear-text"}>{compactMoney(result.totalPnl)}</span>
                      <span>{result.roi.toFixed(0)}% ROI</span>
                      <span>
                        {fmtMultiple(
                          result.symbolMoves.reduce((max, move) => {
                            const multiple = move.impliedMovePct > 0 ? Math.abs(move.movePct) / move.impliedMovePct : 0;
                            return Math.max(max, multiple);
                          }, 0),
                        )}{" "}
                        max implied stretch
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="scan-slider-card">
                <div className="scan-slider-head">
                  <strong>{selectedScenarioRow.scenario.name} Breakdown</strong>
                  <span className={selectedScenarioRow.result.totalPnl >= 0 ? "bull-text" : "bear-text"}>
                    {compactMoney(selectedScenarioRow.result.totalPnl)} | {selectedScenarioRow.result.roi.toFixed(0)}% ROI
                  </span>
                </div>
                <div className="scan-chip-row">
                  {selectedScenarioRow.result.symbolMoves.map((move) => (
                    <span key={move.symbol} className={`scan-chip ${move.movePct >= 0 ? "bull-chip" : "bear-chip"}`}>
                      {move.symbol} {fmtDollar(move.spot, 2)} to {fmtDollar(move.spotAtEvent, 2)} ({fmtPct(move.movePct)} | {fmtMultiple(Math.abs(move.movePct) / Math.max(move.impliedMovePct, 0.1))} of implied)
                    </span>
                  ))}
                </div>
                <p className="scan-inline-note">
                  Scenario weights are now blended from historical priors and seeded prediction-market bias when available. Implied moves and option prices are still starter inputs until we wire live vendors.
                </p>
                <div className="scan-breakdown-grid">
                  {selectedScenarioRow.result.legResults.map((leg) => (
                    <div key={leg.id} className="scan-breakdown-card">
                      <strong>{leg.symbol} {leg.type.toUpperCase()} {fmtDollar(leg.strike, 2)}</strong>
                      <p>{leg.label} | {leg.contracts}x | {leg.dte} DTE</p>
                      <p>{fmtPct(leg.movePct)} underlying | {compactMoney(leg.pnl)} | {leg.multiple.toFixed(1)}x</p>
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
      </section>
    </>
  );
}
