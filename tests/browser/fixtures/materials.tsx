import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import MaterialsPage from "@/app/dashboard/materials/page";
import { buildOrderList } from "@/convex/lib/orderList";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const D = 86_400_000;
const notes = [
  { noteId: "n1", recordedAt: Date.now() - 2 * D, noteTitle: "Tear-off started", crewName: "Luis Garcia", materials: [
    { name: "Architectural shingles", quantity: "12", unit: "bundles", notes: "Charcoal, match existing" },
    { name: "Roofing nails", quantity: "a few", unit: "boxes" },
    { name: "Drip edge", quantity: "about 40", unit: "ft" },
  ] },
  { noteId: "n2", recordedAt: Date.now() - D, noteTitle: "Rotten decking on north side", crewName: "Ana Ruiz", materials: [
    { name: "architectural shingle", quantity: "3 bundles" },
    { name: "Roofing nails", quantity: "2", unit: "box" },
    { name: "OSB sheathing 7/16\"", quantity: "6", unit: "sheets" },
  ] },
];
const { toOrder, ordered } = buildOrderList(notes, new Set(["n1#drip edge|ft"]));
const forJob = {
  job: { id: "j1", title: "Ramirez reroof", status: "in_progress", address: "12 Oak St" },
  companyName: "Acme Roofing",
  toOrder,
  ordered,
  history: [{ orderId: "o1", createdAt: Date.now() - 3 * 3600_000, createdByName: "Dana", lines: [{ key: "drip edge|ft", name: "Drip edge", quantity: "~40 ft" }] }],
};
const overview = {
  jobs: [
    { jobId: "j1", title: "Ramirez reroof", status: "in_progress", address: "12 Oak St", toOrder: 3, ordered: 1, noteCount: 2, lastNoteAt: Date.now() },
    { jobId: "j2", title: "Chen gutters", status: "scheduled", address: null, toOrder: 0, ordered: 2, noteCount: 1, lastNoteAt: Date.now() - D },
  ],
  unlinkedNotes: 2,
};
const fake = {
  watchQuery(ref: unknown) {
    const name = getFunctionName(ref as never);
    const value = name === "materials:forJob" ? forJob : name === "materials:overview" ? overview : undefined;
    return { localQueryResult: () => value, onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: any) {
    calls.push({ name: getFunctionName(ref as never), args });
    return "ok";
  },
};
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}>
    <div className="p-4"><MaterialsPage /></div>
  </ConvexProvider>,
);
