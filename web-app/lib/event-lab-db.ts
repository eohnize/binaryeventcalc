import { neon } from "@neondatabase/serverless";
import { buildWeeklyScanSnapshot, type WeeklyScanSnapshot } from "./weekly-event-lab";

type ScanRunRow = {
  id: string;
  snapshot_payload: WeeklyScanSnapshot | string | null;
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

    return {
      ok: true as const,
      scanRunId: rows[0]?.id ?? null,
    };
  } catch (error) {
    console.error("event-lab-db: failed to persist weekly scan snapshot", error);
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}
