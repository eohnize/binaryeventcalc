import { NextResponse } from "next/server";
import { getEventLabRuntimeDiagnostics, loadRecentEventOutcomes, persistEventOutcome, type PersistOutcomeInput } from "../../../lib/event-lab-db";

export const dynamic = "force-dynamic";

function getAdminKey() {
  return process.env.EVENT_LAB_ADMIN_KEY?.trim() || "";
}

function isAuthorized(request: Request) {
  const adminKey = getAdminKey();
  const providedKey = request.headers.get("x-event-lab-key")?.trim() || "";

  if (!adminKey) {
    return { ok: false as const, status: 503, error: "EVENT_LAB_ADMIN_KEY is not configured." };
  }

  if (!providedKey || providedKey !== adminKey) {
    return { ok: false as const, status: 401, error: "Unauthorized." };
  }

  return { ok: true as const };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "10", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 10;

  return NextResponse.json({
    diagnostics: getEventLabRuntimeDiagnostics(),
    outcomes: await loadRecentEventOutcomes(limit),
  });
}

export async function POST(request: Request) {
  const auth = isAuthorized(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as PersistOutcomeInput | null;

  if (!body?.eventKey) {
    return NextResponse.json(
      { ok: false, error: "eventKey is required." },
      { status: 400 },
    );
  }

  const result = await persistEventOutcome(body);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    outcomeId: result.outcomeId,
    action: result.action,
    matchedEventCandidate: result.matchedEventCandidate,
  });
}
