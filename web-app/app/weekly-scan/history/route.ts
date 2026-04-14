import { NextResponse } from "next/server";
import { getEventLabRuntimeDiagnostics, hasEventLabDatabase, loadRecentEventOutcomes, loadRecentScanRunHistory } from "../../../lib/event-lab-db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "8", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 25) : 8;

  const [runs, outcomes] = await Promise.all([
    loadRecentScanRunHistory(limit),
    loadRecentEventOutcomes(limit),
  ]);

  return NextResponse.json({
    storage: hasEventLabDatabase() ? "database-or-fallback" : "seeded-only",
    diagnostics: getEventLabRuntimeDiagnostics(),
    runs,
    outcomes,
  });
}
