import { neon } from "@neondatabase/serverless";
import {
  buildWeeklyScanSnapshot,
  buildPortfolioStarterLegs,
  evaluatePortfolioScenarios,
  type WeeklyScanSnapshot,
} from "./weekly-event-lab";

type ScanRunRow = {
  id: string;
  snapshot_payload: WeeklyScanSnapshot | string | null;
};

type InsertedIdRow = {
  id: string;
};

type LatestRunSummaryRow = {
  scan_run_id: string;
  generated_at: string;
  source_mode: string;
  event_count: number | string;
  scenario_count: number | string;
  prediction_market_count: number | string;
  option_snapshot_count: number | string;
};

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    ""
  );
}

function getSql() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;
  return neon(databaseUrl);
}

function parseSnapshot(value: WeeklyScanSnapshot | string | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as WeeklyScanSnapshot;
    } catch {
      return null;
    }
  }
  return value;
}

export function hasEventLabDatabase() {
  return Boolean(getDatabaseUrl());
}

export function getEventLabRuntimeDiagnostics() {
  return {
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL?.trim()),
    hasPostgresUrl: Boolean(process.env.POSTGRES_URL?.trim()),
    hasPostgresPrismaUrl: Boolean(process.env.POSTGRES_PRISMA_URL?.trim()),
    hasPostgresUrlNonPooling: Boolean(process.env.POSTGRES_URL_NON_POOLING?.trim()),
    hasAdminKey: Boolean(process.env.EVENT_LAB_ADMIN_KEY?.trim()),
    activeDatabaseSource:
      process.env.DATABASE_URL?.trim()
        ? "DATABASE_URL"
        : process.env.POSTGRES_URL?.trim()
          ? "POSTGRES_URL"
          : process.env.POSTGRES_PRISMA_URL?.trim()
            ? "POSTGRES_PRISMA_URL"
            : process.env.POSTGRES_URL_NON_POOLING?.trim()
              ? "POSTGRES_URL_NON_POOLING"
              : "none",
  };
}

export async function loadStoredWeeklyScanSnapshot(weekStartDate: string) {
  const sql = getSql();
  if (!sql) return null;

  try {
    const rows = (await sql.query(
      `
        select id, snapshot_payload
        from scan_runs
        where week_of_date = $1
          and snapshot_payload is not null
        order by generated_at desc
        limit 1
      `,
      [weekStartDate],
    )) as ScanRunRow[];

    return parseSnapshot(rows[0]?.snapshot_payload);
  } catch (error) {
    console.error("event-lab-db: failed to load stored weekly scan snapshot", error);
    return null;
  }
}

export async function getWeeklyScanSnapshot(now = new Date()) {
  const seededSnapshot = buildWeeklyScanSnapshot(now);
  const storedSnapshot = await loadStoredWeeklyScanSnapshot(seededSnapshot.weekStartDate);
  return storedSnapshot ?? seededSnapshot;
}

function normalizeCount(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

async function persistStructuredEventRows(
  sql: ReturnType<typeof neon>,
  scanRunId: string,
  snapshot: WeeklyScanSnapshot,
) {
  let eventCount = 0;
  let scenarioCount = 0;
  let predictionMarketCount = 0;
  let optionSnapshotCount = 0;

  for (const event of snapshot.events) {
    const eventRows = (await sql.query(
      `
        insert into event_candidates (
          scan_run_id,
          event_key,
          title,
          kind,
          event_date,
          event_label,
          time_label,
          scope,
          market_proxy,
          ranking,
          probability_overlay
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
        returning id
      `,
      [
        scanRunId,
        event.id,
        event.title,
        event.kind,
        event.eventDate,
        event.eventLabel,
        event.timeLabel,
        event.scope,
        event.marketProxy,
        JSON.stringify(event.ranking),
        JSON.stringify(event.probabilityOverlay),
      ],
    )) as InsertedIdRow[];

    const eventCandidateId = eventRows[0]?.id;
    if (!eventCandidateId) continue;

    eventCount += 1;

    const evaluatedScenarios = new Map(
      evaluatePortfolioScenarios(event, buildPortfolioStarterLegs(event)).map((entry) => [entry.scenario.name, entry]),
    );
    const scenarioByName = new Map(event.portfolioScenarios.map((scenario) => [scenario.name, scenario]));

    for (const weight of event.probabilityOverlay.scenarioWeights) {
      const scenario = scenarioByName.get(weight.scenarioName);
      const evaluated = evaluatedScenarios.get(weight.scenarioName);

      await sql.query(
        `
          insert into scenario_snapshots (
            event_candidate_id,
            scenario_name,
            note,
            historical_prior,
            market_implied,
            blended_probability,
            move_map,
            expected_pnl,
            expected_roi
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        `,
        [
          eventCandidateId,
          weight.scenarioName,
          scenario?.note ?? weight.note,
          weight.historicalPrior,
          weight.marketImplied,
          weight.blendedProbability,
          JSON.stringify(scenario?.moves ?? {}),
          evaluated?.totalPnl ?? null,
          evaluated?.roi ?? null,
        ],
      );

      scenarioCount += 1;
    }

    for (const source of event.probabilityOverlay.sources) {
      await sql.query(
        `
          insert into prediction_market_snapshots (
            event_candidate_id,
            source,
            market_label,
            contract_label,
            probability,
            change_1d,
            quality,
            note,
            meta
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        `,
        [
          eventCandidateId,
          source.source,
          source.marketLabel,
          source.contractLabel,
          source.probability,
          source.change1d,
          source.quality,
          source.note,
          JSON.stringify({
            overlayLabel: event.probabilityOverlay.label,
            marketInfluence: event.probabilityOverlay.marketInfluence,
          }),
        ],
      );

      predictionMarketCount += 1;
    }

    for (const profile of event.tickerProfiles) {
      await sql.query(
        `
          insert into option_snapshots (
            event_candidate_id,
            symbol,
            spot,
            implied_move_pct,
            option_chain
          )
          values ($1, $2, $3, $4, $5::jsonb)
        `,
        [
          eventCandidateId,
          profile.symbol,
          profile.seedSpot,
          profile.impliedMovePct,
          JSON.stringify({
            driver: profile.driver,
            scenarioFocus: profile.scenarioFocus,
            starterLegs: profile.legSeeds,
          }),
        ],
      );

      optionSnapshotCount += 1;
    }
  }

  return {
    eventCount,
    scenarioCount,
    predictionMarketCount,
    optionSnapshotCount,
  };
}

export async function loadLatestScanRunSummary(weekStartDate: string) {
  const sql = getSql();
  if (!sql) return null;

  try {
    const rows = (await sql.query(
      `
        select
          sr.id as scan_run_id,
          sr.generated_at,
          sr.source_mode,
          (
            select count(*)
            from event_candidates ec
            where ec.scan_run_id = sr.id
          ) as event_count,
          (
            select count(*)
            from scenario_snapshots ss
            join event_candidates ec on ec.id = ss.event_candidate_id
            where ec.scan_run_id = sr.id
          ) as scenario_count,
          (
            select count(*)
            from prediction_market_snapshots pms
            join event_candidates ec on ec.id = pms.event_candidate_id
            where ec.scan_run_id = sr.id
          ) as prediction_market_count,
          (
            select count(*)
            from option_snapshots os
            join event_candidates ec on ec.id = os.event_candidate_id
            where ec.scan_run_id = sr.id
          ) as option_snapshot_count
        from scan_runs sr
        where sr.week_of_date = $1
        order by sr.generated_at desc
        limit 1
      `,
      [weekStartDate],
    )) as LatestRunSummaryRow[];

    const row = rows[0];
    if (!row) return null;

    return {
      scanRunId: row.scan_run_id,
      generatedAt: row.generated_at,
      sourceMode: row.source_mode,
      eventCount: normalizeCount(row.event_count),
      scenarioCount: normalizeCount(row.scenario_count),
      predictionMarketCount: normalizeCount(row.prediction_market_count),
      optionSnapshotCount: normalizeCount(row.option_snapshot_count),
    };
  } catch (error) {
    console.error("event-lab-db: failed to load latest scan run summary", error);
    return null;
  }
}

export async function persistWeeklyScanSnapshot(
  snapshot: WeeklyScanSnapshot,
  sourceMode: "seeded" | "database" | "manual" = "manual",
) {
  const sql = getSql();
  if (!sql) {
    return {
      ok: false as const,
      reason: "DATABASE_URL is not configured.",
    };
  }

  try {
    const rows = (await sql.query(
      `
        insert into scan_runs (week_of_date, source_mode, notes, snapshot_payload)
        values ($1, $2, $3::jsonb, $4::jsonb)
        returning id
      `,
      [snapshot.weekStartDate, sourceMode, JSON.stringify(snapshot.notes), JSON.stringify(snapshot)],
    )) as Array<{ id: string }>;

    const scanRunId = rows[0]?.id ?? null;
    const structuredCounts =
      scanRunId ? await persistStructuredEventRows(sql, scanRunId, snapshot) : null;

    return {
      ok: true as const,
      scanRunId,
      structuredCounts,
    };
  } catch (error) {
    console.error("event-lab-db: failed to persist weekly scan snapshot", error);
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}
