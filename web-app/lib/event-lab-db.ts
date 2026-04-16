import { neon } from "@neondatabase/serverless";
import {
  buildPortfolioStarterLegs,
  evaluatePortfolioScenarios,
  type ProbabilityOverlay,
  type WeeklyScanSnapshot,
} from "./weekly-event-lab";
import { buildResolvedWeeklyScanSnapshot } from "./weekly-event-lab-live";

type ScanRunRow = {
  id: string;
  snapshot_payload: WeeklyScanSnapshot | string | null;
};

type InsertedIdRow = {
  id: string;
};

type LatestRunSummaryRow = {
  scan_run_id: string;
  week_of_date: string;
  generated_at: string;
  source_mode: string;
  event_count: number | string;
  scenario_count: number | string;
  prediction_market_count: number | string;
  option_snapshot_count: number | string;
};

type RecentOutcomeRow = {
  outcome_id: string;
  event_candidate_id: string;
  event_key: string;
  event_title: string;
  week_of_date: string;
  resolved_at: string | null;
  realized_bucket: string | null;
  realized_move_map: Record<string, number> | string | null;
  closest_scenario_name: string | null;
  realized_summary: string | null;
  created_at: string;
};

type EventCandidateLookupRow = {
  event_candidate_id: string;
  event_title: string;
  scan_run_id: string;
  week_of_date: string;
};

type ExistingOutcomeLookupRow = {
  outcome_id: string;
};

type OutcomeReviewRow = {
  outcome_id: string;
  event_key: string;
  event_title: string;
  event_kind: string;
  event_date: string;
  event_label: string;
  week_of_date: string;
  resolved_at: string | null;
  realized_bucket: string | null;
  realized_move_map: Record<string, number> | string | null;
  realized_summary: string | null;
  closest_scenario_name: string | null;
  probability_overlay: ProbabilityOverlay | string | null;
  created_at: string;
};

export type PersistOutcomeInput = {
  eventKey: string;
  scanRunId?: string;
  weekStartDate?: string;
  resolvedAt?: string;
  realizedBucket?: string;
  realizedMoveMap?: Record<string, number>;
  realizedSummary?: string;
  closestScenarioName?: string;
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

type SqlClient = NonNullable<ReturnType<typeof getSql>>;

function parseSnapshot(value: WeeklyScanSnapshot | string | null | undefined) {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as WeeklyScanSnapshot;
      return {
        ...parsed,
        dataSources: parsed.dataSources ?? {
          calendars: "seeded",
          historical: "seeded",
          predictionMarkets: "seeded",
          liveEventIds: [],
        },
      };
    } catch {
      return null;
    }
  }
  return {
    ...value,
    dataSources: value.dataSources ?? {
      calendars: "seeded",
      historical: "seeded",
      predictionMarkets: "seeded",
      liveEventIds: [],
    },
  };
}

function parseMoveMap(value: Record<string, number> | string | null | undefined) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, number>;
    } catch {
      return {};
    }
  }
  return value;
}

function parseProbabilityOverlay(
  value: ProbabilityOverlay | string | null | undefined,
): ProbabilityOverlay | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as ProbabilityOverlay;
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
    hasFmpKey: Boolean(process.env.FMP_API_KEY?.trim()),
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
  const sourceSnapshot = await buildResolvedWeeklyScanSnapshot(now);
  const storedSnapshot = await loadStoredWeeklyScanSnapshot(sourceSnapshot.weekStartDate);
  if (process.env.FMP_API_KEY?.trim()) {
    return sourceSnapshot;
  }
  return storedSnapshot ?? sourceSnapshot;
}

function normalizeCount(value: number | string | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

async function persistStructuredEventRows(
  sql: SqlClient,
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
          sr.week_of_date,
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
      weekStartDate: row.week_of_date,
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

export async function loadRecentScanRunHistory(limit = 8) {
  const sql = getSql();
  if (!sql) return [];

  try {
    const rows = (await sql.query(
      `
        select
          sr.id as scan_run_id,
          sr.week_of_date,
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
        order by sr.generated_at desc
        limit $1
      `,
      [limit],
    )) as LatestRunSummaryRow[];

    return rows.map((row) => ({
      scanRunId: row.scan_run_id,
      weekStartDate: row.week_of_date,
      generatedAt: row.generated_at,
      sourceMode: row.source_mode,
      eventCount: normalizeCount(row.event_count),
      scenarioCount: normalizeCount(row.scenario_count),
      predictionMarketCount: normalizeCount(row.prediction_market_count),
      optionSnapshotCount: normalizeCount(row.option_snapshot_count),
    }));
  } catch (error) {
    console.error("event-lab-db: failed to load recent scan run history", error);
    return [];
  }
}

export async function loadRecentEventOutcomes(limit = 10) {
  const sql = getSql();
  if (!sql) return [];

  try {
    const rows = (await sql.query(
      `
        select
          eo.id as outcome_id,
          eo.event_candidate_id,
          ec.event_key,
          ec.title as event_title,
          sr.week_of_date,
          eo.resolved_at,
          eo.realized_bucket,
          eo.realized_move_map,
          eo.closest_scenario_name,
          eo.realized_summary,
          eo.created_at
        from event_outcomes eo
        join event_candidates ec on ec.id = eo.event_candidate_id
        join scan_runs sr on sr.id = ec.scan_run_id
        order by coalesce(eo.resolved_at, eo.created_at) desc
        limit $1
      `,
      [limit],
    )) as RecentOutcomeRow[];

    return rows.map((row) => ({
      outcomeId: row.outcome_id,
      eventCandidateId: row.event_candidate_id,
      eventKey: row.event_key,
      eventTitle: row.event_title,
      weekStartDate: row.week_of_date,
      resolvedAt: row.resolved_at,
      realizedBucket: row.realized_bucket,
      realizedMoveMap: parseMoveMap(row.realized_move_map),
      closestScenarioName: row.closest_scenario_name,
      realizedSummary: row.realized_summary,
      createdAt: row.created_at,
    }));
  } catch (error) {
    console.error("event-lab-db: failed to load recent event outcomes", error);
    return [];
  }
}

export async function loadRecentOutcomeReview(limit = 10) {
  const sql = getSql();
  if (!sql) return [];

  try {
    const rows = (await sql.query(
      `
        select
          eo.id as outcome_id,
          ec.event_key,
          ec.title as event_title,
          ec.kind as event_kind,
          ec.event_date,
          ec.event_label,
          sr.week_of_date,
          eo.resolved_at,
          eo.realized_bucket,
          eo.realized_move_map,
          eo.realized_summary,
          eo.closest_scenario_name,
          ec.probability_overlay,
          eo.created_at
        from event_outcomes eo
        join event_candidates ec on ec.id = eo.event_candidate_id
        join scan_runs sr on sr.id = ec.scan_run_id
        order by coalesce(eo.resolved_at, eo.created_at) desc
        limit $1
      `,
      [limit],
    )) as OutcomeReviewRow[];

    return rows.map((row) => {
      const overlay = parseProbabilityOverlay(row.probability_overlay);
      const scenarioWeights = overlay?.scenarioWeights ?? [];
      const plannerTopScenario =
        scenarioWeights.length > 0
          ? [...scenarioWeights].sort(
              (left, right) => right.blendedProbability - left.blendedProbability,
            )[0]
          : null;
      const realizedScenario =
        scenarioWeights.find((scenario) => scenario.scenarioName === row.closest_scenario_name) ?? null;

      return {
        outcomeId: row.outcome_id,
        eventKey: row.event_key,
        eventTitle: row.event_title,
        eventKind: row.event_kind,
        eventDate: row.event_date,
        eventLabel: row.event_label,
        weekStartDate: row.week_of_date,
        resolvedAt: row.resolved_at,
        realizedBucket: row.realized_bucket,
        realizedMoveMap: parseMoveMap(row.realized_move_map),
        realizedSummary: row.realized_summary,
        closestScenarioName: row.closest_scenario_name,
        overlayMode: overlay?.mode ?? "unknown",
        plannerTopScenarioName: plannerTopScenario?.scenarioName ?? null,
        plannerTopScenarioProbability: plannerTopScenario?.blendedProbability ?? null,
        realizedScenarioHistoricalPrior: realizedScenario?.historicalPrior ?? null,
        realizedScenarioMarketImplied: realizedScenario?.marketImplied ?? null,
        realizedScenarioBlendedProbability: realizedScenario?.blendedProbability ?? null,
        matchedPlannerFavorite:
          Boolean(row.closest_scenario_name) &&
          row.closest_scenario_name === (plannerTopScenario?.scenarioName ?? null),
        probabilityGapToFavorite:
          realizedScenario && plannerTopScenario
            ? realizedScenario.blendedProbability - plannerTopScenario.blendedProbability
            : null,
        createdAt: row.created_at,
      };
    });
  } catch (error) {
    console.error("event-lab-db: failed to load recent outcome review", error);
    return [];
  }
}

async function findEventCandidateForOutcome(sql: SqlClient, input: PersistOutcomeInput) {
  const rows = (await sql.query(
    `
      select
        ec.id as event_candidate_id,
        ec.title as event_title,
        sr.id as scan_run_id,
        sr.week_of_date
      from event_candidates ec
      join scan_runs sr on sr.id = ec.scan_run_id
      where ec.event_key = $1
        and ($2::uuid is null or sr.id = $2::uuid)
        and ($3::date is null or sr.week_of_date = $3::date)
      order by sr.generated_at desc
      limit 1
    `,
    [input.eventKey, input.scanRunId ?? null, input.weekStartDate ?? null],
  )) as EventCandidateLookupRow[];

  return rows[0] ?? null;
}

async function findExistingOutcomeForEventCandidate(sql: SqlClient, eventCandidateId: string) {
  const rows = (await sql.query(
    `
      select id as outcome_id
      from event_outcomes
      where event_candidate_id = $1
      order by coalesce(resolved_at, created_at) desc, created_at desc
      limit 1
    `,
    [eventCandidateId],
  )) as ExistingOutcomeLookupRow[];

  return rows[0] ?? null;
}

export async function persistEventOutcome(input: PersistOutcomeInput) {
  const sql = getSql();
  if (!sql) {
    return {
      ok: false as const,
      reason: "DATABASE_URL is not configured.",
    };
  }

  try {
    const matchedEventCandidate = await findEventCandidateForOutcome(sql, input);

    if (!matchedEventCandidate) {
      return {
        ok: false as const,
        reason: `No event candidate found for eventKey=${input.eventKey}.`,
      };
    }

    const existingOutcome = await findExistingOutcomeForEventCandidate(
      sql,
      matchedEventCandidate.event_candidate_id,
    );

    const rows = existingOutcome
      ? ((await sql.query(
          `
            update event_outcomes
            set
              resolved_at = $2,
              realized_bucket = $3,
              realized_move_map = $4::jsonb,
              realized_summary = $5,
              closest_scenario_name = $6
            where id = $1
            returning id
          `,
          [
            existingOutcome.outcome_id,
            input.resolvedAt ?? null,
            input.realizedBucket ?? null,
            JSON.stringify(input.realizedMoveMap ?? {}),
            input.realizedSummary ?? null,
            input.closestScenarioName ?? null,
          ],
        )) as InsertedIdRow[])
      : ((await sql.query(
          `
            insert into event_outcomes (
              event_candidate_id,
              resolved_at,
              realized_bucket,
              realized_move_map,
              realized_summary,
              closest_scenario_name
            )
            values ($1, $2, $3, $4::jsonb, $5, $6)
            returning id
          `,
          [
            matchedEventCandidate.event_candidate_id,
            input.resolvedAt ?? null,
            input.realizedBucket ?? null,
            JSON.stringify(input.realizedMoveMap ?? {}),
            input.realizedSummary ?? null,
            input.closestScenarioName ?? null,
          ],
        )) as InsertedIdRow[]);

    return {
      ok: true as const,
      outcomeId: rows[0]?.id ?? null,
      action: existingOutcome ? ("updated" as const) : ("inserted" as const),
      matchedEventCandidate: {
        eventCandidateId: matchedEventCandidate.event_candidate_id,
        eventTitle: matchedEventCandidate.event_title,
        scanRunId: matchedEventCandidate.scan_run_id,
        weekStartDate: matchedEventCandidate.week_of_date,
      },
    };
  } catch (error) {
    console.error("event-lab-db: failed to persist event outcome", error);
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}

export async function persistWeeklyScanSnapshot(
  snapshot: WeeklyScanSnapshot,
  sourceMode: "seeded" | "database" | "manual" | "live" = "manual",
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
