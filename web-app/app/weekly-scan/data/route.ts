import { NextResponse } from "next/server";
import {
  getEventLabRuntimeDiagnostics,
  getWeeklyScanSnapshot,
  hasEventLabDatabase,
  persistWeeklyScanSnapshot,
} from "../../../lib/event-lab-db";
import { buildWeeklyScanSnapshot } from "../../../lib/weekly-event-lab";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getWeeklyScanSnapshot();
  const diagnostics = getEventLabRuntimeDiagnostics();
  return NextResponse.json({
    ...snapshot,
    storage: hasEventLabDatabase() ? "database-or-fallback" : "seeded-only",
    diagnostics,
  });
}

export async function POST(request: Request) {
  const adminKey = process.env.EVENT_LAB_ADMIN_KEY?.trim();
  const providedKey = request.headers.get("x-event-lab-key")?.trim();

  if (!adminKey) {
    return NextResponse.json(
      { ok: false, error: "EVENT_LAB_ADMIN_KEY is not configured." },
      { status: 503 },
    );
  }

  if (!providedKey || providedKey !== adminKey) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let sourceMode: "seeded" | "database" | "manual" = "manual";
  let snapshot = buildWeeklyScanSnapshot();

  try {
    const body = (await request.json().catch(() => null)) as
      | { snapshot?: ReturnType<typeof buildWeeklyScanSnapshot>; sourceMode?: "seeded" | "database" | "manual" }
      | null;

    if (body?.snapshot) snapshot = body.snapshot;
    if (body?.sourceMode) sourceMode = body.sourceMode;
  } catch {
    // Fall back to the default seeded snapshot when no JSON body is supplied.
  }

  const result = await persistWeeklyScanSnapshot(snapshot, sourceMode);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanRunId: result.scanRunId,
    weekStartDate: snapshot.weekStartDate,
  });
}
