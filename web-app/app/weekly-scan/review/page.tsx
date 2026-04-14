import type { Metadata } from "next";
import Link from "next/link";
import {
  getEventLabRuntimeDiagnostics,
  loadRecentOutcomeReview,
  loadRecentScanRunHistory,
} from "../../../lib/event-lab-db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Weekly Event Review | SwingEdge Options",
  description: "Review stored scan runs and compare realized outcomes with the planner's scenario weights.",
};

function fmtDateTime(value: string | null) {
  if (!value) return "Not resolved yet";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(new Date(value));
}

function fmtWeek(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(value));
}

function fmtProbability(value: number | null) {
  return value == null ? "N/A" : `${value}%`;
}

function fmtMove(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default async function WeeklyScanReviewPage() {
  const [runs, outcomes, diagnostics] = await Promise.all([
    loadRecentScanRunHistory(8),
    loadRecentOutcomeReview(10),
    Promise.resolve(getEventLabRuntimeDiagnostics()),
  ]);

  return (
    <main className="app-shell scan-page">
      <section className="hero-card scan-hero">
        <div className="scan-hero-copy">
          <span className="eyebrow">Weekly Review Log</span>
          <h1>Stored runs and realized outcomes</h1>
          <p>
            This is the feedback loop: what the planner favored, what the market actually delivered, and where we were
            directionally right versus surprised.
          </p>
          <div className="scan-chip-row">
            <span className="scan-chip muted">{diagnostics.activeDatabaseSource}</span>
            <span className="scan-chip muted">{runs.length} recent runs</span>
            <span className="scan-chip muted">{outcomes.length} logged outcomes</span>
          </div>
          <div className="scan-review-actions">
            <Link href="/weekly-scan" className="secondary-btn">
              Back To Event Lab
            </Link>
          </div>
        </div>

        <div className="scan-summary-grid">
          <article className="scan-stat-card">
            <span className="level-kicker">Runtime</span>
            <strong>{diagnostics.hasDatabaseUrl ? "Database live" : "Fallback only"}</strong>
            <p>{diagnostics.hasAdminKey ? "Admin write key is present." : "Admin write key is missing."}</p>
          </article>
          <article className="scan-stat-card">
            <span className="level-kicker">Recent Runs</span>
            <strong>{runs.length}</strong>
            <p>Most recent weekly scan snapshots saved in Postgres.</p>
          </article>
          <article className="scan-stat-card">
            <span className="level-kicker">Logged Outcomes</span>
            <strong>{outcomes.length}</strong>
            <p>Resolved event records now available for review and calibration.</p>
          </article>
          <article className="scan-stat-card">
            <span className="level-kicker">Alignment Rate</span>
            <strong>
              {outcomes.length > 0
                ? `${Math.round(
                    (outcomes.filter((outcome) => outcome.matchedPlannerFavorite).length / outcomes.length) * 100,
                  )}%`
                : "N/A"}
            </strong>
            <p>How often the realized closest scenario matched the planner&apos;s highest-probability call.</p>
          </article>
        </div>
      </section>

      <section className="shell-card">
        <div className="scan-workbench-head">
          <div>
            <span className="eyebrow">Run History</span>
            <h2>Recent scan saves</h2>
            <p>Quick pulse on how often we&apos;re refreshing and how much structure is being stored each run.</p>
          </div>
        </div>

        <div className="scan-review-grid">
          {runs.map((run) => (
            <article key={run.scanRunId} className="scan-review-card">
              <span className="level-kicker">{fmtWeek(run.weekStartDate)}</span>
              <strong>{run.sourceMode.toUpperCase()} snapshot</strong>
              <p>
                Saved {fmtDateTime(run.generatedAt)} with {run.eventCount} events and {run.scenarioCount} scenarios.
              </p>
              <div className="scan-chip-row">
                <span className="scan-chip muted">{run.predictionMarketCount} market snapshots</span>
                <span className="scan-chip muted">{run.optionSnapshotCount} option snapshots</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="shell-card">
        <div className="scan-workbench-head">
          <div>
            <span className="eyebrow">Outcome Review</span>
            <h2>Realized versus expected</h2>
            <p>
              The point here is calibration, not perfection. We want to know whether the planner&apos;s favorite scenario
              was directionally aligned and how far off the realized branch sat from the base case.
            </p>
          </div>
        </div>

        {outcomes.length === 0 ? (
          <p className="support-note">No outcomes logged yet. Once you post a resolved event, it will show up here.</p>
        ) : (
          <div className="scan-review-grid">
            {outcomes.map((outcome) => (
              <article key={outcome.outcomeId} className="scan-review-card">
                <div className="scan-review-head">
                  <div>
                    <span className="level-kicker">
                      {outcome.eventTitle} | {fmtWeek(outcome.weekStartDate)}
                    </span>
                    <strong>{outcome.closestScenarioName ?? outcome.realizedBucket ?? "Outcome logged"}</strong>
                  </div>
                  <span className={`scan-chip ${outcome.matchedPlannerFavorite ? "bull-chip" : "bear-chip"}`}>
                    {outcome.matchedPlannerFavorite ? "Planner aligned" : "Planner surprised"}
                  </span>
                </div>

                <div className="scan-review-summary">
                  <div className="scan-review-line">
                    <span className="scan-review-label">Planner favorite</span>
                    <span className="scan-review-value">{outcome.plannerTopScenarioName ?? "N/A"}</span>
                    <span className="scan-review-prob">{fmtProbability(outcome.plannerTopScenarioProbability)}</span>
                  </div>
                  <div className="scan-review-line">
                    <span className="scan-review-label">Realized closest scenario</span>
                    <span className="scan-review-value">{outcome.closestScenarioName ?? "N/A"}</span>
                    <span className="scan-review-prob">{fmtProbability(outcome.realizedScenarioBlendedProbability)}</span>
                  </div>
                </div>

                <div className="scan-mini-grid">
                  <article className="scan-mini-card">
                    <span className="level-kicker">Resolved</span>
                    <strong>{fmtDateTime(outcome.resolvedAt ?? outcome.createdAt)}</strong>
                    <p>Scheduled {outcome.eventLabel}</p>
                  </article>
                  <article className="scan-mini-card">
                    <span className="level-kicker">Probability Gap</span>
                    <strong>
                      {outcome.probabilityGapToFavorite == null
                        ? "N/A"
                        : `${outcome.probabilityGapToFavorite > 0 ? "+" : ""}${outcome.probabilityGapToFavorite}%`}
                    </strong>
                    <p>Realized scenario probability minus planner favorite probability.</p>
                  </article>
                  <article className="scan-mini-card">
                    <span className="level-kicker">Historical Prior</span>
                    <strong>{fmtProbability(outcome.realizedScenarioHistoricalPrior)}</strong>
                    <p>Base-rate view before the live market overlay.</p>
                  </article>
                  <article className="scan-mini-card">
                    <span className="level-kicker">Market Implied</span>
                    <strong>{fmtProbability(outcome.realizedScenarioMarketImplied)}</strong>
                    <p>Seeded live-odds bias that tilted the scenario weights.</p>
                  </article>
                </div>

                <div className="scan-chip-row">
                  {Object.entries(outcome.realizedMoveMap).map(([symbol, move]) => (
                    <span
                      key={`${outcome.outcomeId}-${symbol}`}
                      className={`scan-chip ${move >= 0 ? "bull-chip" : "bear-chip"}`}
                    >
                      {symbol} {fmtMove(move)}
                    </span>
                  ))}
                </div>

                <p className="scan-inline-note">{outcome.realizedSummary ?? "No summary logged for this outcome yet."}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
