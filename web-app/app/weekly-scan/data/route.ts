import { NextResponse } from "next/server";
import { buildWeeklyScanSnapshot } from "../../../lib/weekly-event-lab";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildWeeklyScanSnapshot());
}
