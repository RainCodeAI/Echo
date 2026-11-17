import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { AiUsageBanner, AiUsageCard } from "@/components/settings/ai-usage-card";

const level = new URLSearchParams(location.search).get("level") ?? "ok";
const spent = level === "ok" ? 4_120_000 : level === "warning" ? 21_300_000 : 25_040_000;
const value = {
  month: "2026-11", level, spentMicros: spent, budgetUsd: 25,
  message: level === "exceeded" ? "This month's AI limit ($25) is used up. The recording and phone transcript are saved; AI picks up again on Dec 1, or sooner if the limit is raised." : null,
  thisMonth: { notes: 612, audioMinutes: 410, customerUpdates: 37, skippedNotes: level === "exceeded" ? 3 : 0 },
  history: [
    { month: "2026-11", costMicros: spent, notes: 612 },
    { month: "2026-10", costMicros: 18_400_000, notes: 540 },
    { month: "2026-09", costMicros: 9_100_000, notes: 260 },
  ],
};
const fake = { watchQuery() { return { localQueryResult: () => value, onUpdate: () => () => {} }; } };
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}>
    <div className="mx-auto max-w-2xl space-y-4 p-4"><AiUsageBanner /><AiUsageCard /></div>
  </ConvexProvider>,
);
