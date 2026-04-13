import type { Metadata } from "next";
import { WeeklyEventLab } from "../../components/weekly-event-lab";
import { getWeeklyScanSnapshot } from "../../lib/event-lab-db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Weekly Event Lab | SwingEdge Options",
  description: "Seeded weekly event scan and binary scenario planner built beside the legacy calculator.",
};

export default async function WeeklyScanPage() {
  const snapshot = await getWeeklyScanSnapshot();

  return (
    <main className="app-shell scan-page">
      <WeeklyEventLab snapshot={snapshot} />
    </main>
  );
}
