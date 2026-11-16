import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { SuggestedJobUpdates } from "@/components/notes/suggested-job-updates";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const fake = {
  watchQuery() { return { localQueryResult: () => undefined, onUpdate: () => () => {} }; },
  async mutation(ref: unknown, args: any) {
    calls.push({ name: getFunctionName(ref as never), args });
    if (getFunctionName(ref as never) === "jobUpdates:undo") {
      throw new Error("[CONVEX M(jobUpdates:undo)] Server Error\nUncaught Error: The job has changed since this was applied — edit the job directly instead.\n    at handler");
    }
    return null;
  },
};
const suggestions = [
  { field: "status", value: "in_progress", rationale: "crew started tear-off" },
  { field: "scheduledFor", value: "2026-11-17" },
  { field: "notes", value: "Dog in back yard", appliedAt: 1 },
  { field: "address", value: "14 Oak St", dismissedAt: 1 },
  { field: "crew size", value: "3" },
];
const job = { id: "j1", title: "Ramirez reroof", status: "scheduled" as const, scheduledFor: null, address: "12 Oak St" };
const noJob = new URLSearchParams(location.search).has("nojob");
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}>
    <div className="mx-auto max-w-3xl p-4">
      <SuggestedJobUpdates noteId={"n1" as never} suggestions={suggestions} job={noJob ? null : job} />
    </div>
  </ConvexProvider>,
);
