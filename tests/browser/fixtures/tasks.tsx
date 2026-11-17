import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import TasksPage from "@/app/dashboard/tasks/page";
import { NoteAiPanel } from "@/components/notes/note-ai-panel";

const calls: { name: string; args: unknown }[] = [];
(window as unknown as { __calls: typeof calls }).__calls = calls;
const people = [
  { kind: "member", id: "m-luis", name: "Luis Garcia" },
  { kind: "member", id: "m-ana", name: "Ana Ruiz" },
  { kind: "user", id: "u-dana", name: "Dana Owner" },
];
const D = 86_400_000;
const all = [
  { noteId: "n2", index: 0, title: "Tarp the kitchen leak today", priority: "high", dueHint: "today", assigneeHint: "Luis", assignee: { kind: "member", id: "m-luis" }, completed: false, completedAt: null, noteTitle: "Water through kitchen ceiling", jobTitle: "Ramirez reroof", crewName: "Luis Garcia", createdAt: Date.now() - D },
  { noteId: "n1", index: 1, title: "Call Chen about downspout", priority: "medium", dueHint: null, assigneeHint: "office", assignee: null, completed: false, completedAt: null, noteTitle: "Downspout pulled off", jobTitle: "Chen gutters", crewName: "Ana Ruiz", createdAt: Date.now() - 3 * D },
  { noteId: "n3", index: 0, title: "Quote deck stain", priority: "low", dueHint: "this week", assigneeHint: null, assignee: null, completed: false, completedAt: null, noteTitle: "Deck stain request", jobTitle: null, crewName: "Ana Ruiz", createdAt: Date.now() - D },
];
const fake = {
  watchQuery(ref: unknown, args: { filter?: { kind: string; ref?: { id: string } } }) {
    const name = getFunctionName(ref as never);
    let value: unknown;
    if (name === "tasks:people") value = people;
    if (name === "tasks:list") {
      const f = args?.filter ?? { kind: "all" };
      value = all.filter((t) => f.kind === "all" || (f.kind === "unassigned" ? !t.assignee : t.assignee?.id === f.ref?.id));
    }
    return { localQueryResult: () => value, onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: unknown) {
    calls.push({ name: getFunctionName(ref as never), args });
    return "ok";
  },
};
const view = new URLSearchParams(location.search).get("view");
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}>
    <div className="p-4">
      {view === "note" ? (
        <div className="mx-auto max-w-3xl">
          <NoteAiPanel
            noteId={"n2" as never}
            aiStatus="completed"
            aiTitle="Water through kitchen ceiling"
            actionItems={[
              { title: "Tarp the kitchen leak today", priority: "high", assigneeHint: "Luis", assignee: { kind: "member", id: "m-luis" } },
              { title: "Call the homeowner", priority: "medium", assigneeHint: "office" },
            ]}
          />
        </div>
      ) : (
        <TasksPage />
      )}
    </div>
  </ConvexProvider>,
);
