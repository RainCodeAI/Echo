import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { GettingStarted } from "@/components/onboarding/getting-started";
import PosterPage from "@/app/dashboard/poster/page";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const q = new URLSearchParams(location.search);
const view = q.get("view") ?? "checklist";
const doneCount = Number(q.get("done") ?? 0);
const ids = ["profile", "crew", "share", "firstNote", "alerts"];
const status = {
  steps: ids.map((id, i) => ({ id, done: id !== "alerts" && i < doneCount, optional: id === "alerts" })),
  requiredDone: Math.min(doneCount, 4), requiredTotal: 4, allRequiredDone: doneCount >= 4,
  isOwner: !q.has("member"), dismissed: q.has("dismissed"), sampleNoteId: null,
};
const me = { _id: "u1", companyId: "k57c0mpany123", role: "owner", company: { name: "Acme Roofing" } };
const fake = {
  watchQuery(ref: unknown) {
    const n = getFunctionName(ref as never);
    const v = n === "onboarding:status" ? status : n === "users:current" ? me : undefined;
    return { localQueryResult: () => v, onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: any) {
    const name = getFunctionName(ref as never);
    calls.push({ name, args });
    return name === "onboarding:createSampleNote" ? "sample123" : null;
  },
};
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}><div className="mx-auto max-w-3xl p-4 print:p-0">{view === "poster" ? <PosterPage /> : <GettingStarted />}</div></ConvexProvider>,
);
