/**
 * Action items as tasks (pure, unit-tested).
 *
 * Action items live inside their note (`voiceNotes.actionItems`); this module
 * flattens open ones across notes for the Tasks page and resolves the AI's
 * free-text "who" hint to a real person when the match is unambiguous.
 */

export type AssigneeRef = { kind: "member" | "user"; id: string };
export type Person = AssigneeRef & { name: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // "José" matches "Jose"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Match an AI hint ("Luis", "luis g", "Ana Ruiz") to exactly one person by
 * full name or first name. Ambiguous ("Chris" with two Chrises), generic
 * ("office", "crew") or unknown hints return null and stay unassigned.
 */
export function matchAssignee(hint: string | undefined, people: Person[]): AssigneeRef | null {
  const h = hint ? norm(hint) : "";
  if (!h) return null;
  const full = people.filter((p) => norm(p.name) === h);
  if (full.length === 1) return { kind: full[0].kind, id: full[0].id };
  if (full.length > 1) return null;
  // Partial names: the first name must match exactly and every further word
  // must start the corresponding name part. "luis g" → "Luis Garcia", but
  // "luis outsider" matches nobody (a different Luis, not ours).
  const hintParts = h.split(" ");
  const partial = people.filter((p) => {
    const nameParts = norm(p.name).split(" ");
    if (hintParts.length > nameParts.length || nameParts[0] !== hintParts[0]) return false;
    return hintParts.every((part, i) => i === 0 || nameParts[i].startsWith(part));
  });
  if (partial.length === 1) return { kind: partial[0].kind, id: partial[0].id };
  return null;
}

export const sameAssignee = (a?: AssigneeRef | null, b?: AssigneeRef | null) =>
  (!a && !b) || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export type TaskNote = {
  _id: string;
  createdAt: number;
  status: "processing" | "ready" | "reviewed" | "archived" | "failed";
  aiTitle?: string;
  rawTranscript: string;
  jobTitle: string | null;
  crewName: string | null;
  actionItems?: {
    title: string;
    assigneeHint?: string;
    assignee?: AssigneeRef;
    dueHint?: string;
    priority?: "low" | "medium" | "high";
    completed?: boolean;
    completedAt?: number;
  }[];
};

export type Task = {
  noteId: string;
  index: number;
  title: string;
  priority: "low" | "medium" | "high" | null;
  dueHint: string | null;
  assigneeHint: string | null;
  assignee: AssigneeRef | null;
  completed: boolean;
  completedAt: number | null;
  noteTitle: string;
  jobTitle: string | null;
  crewName: string | null;
  createdAt: number;
};

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export type TaskFilter =
  | { kind: "all" }
  | { kind: "unassigned" }
  | { kind: "person"; ref: AssigneeRef };

/**
 * Flatten action items across notes. Open tasks: high priority first, then
 * oldest first (things waiting longest). Archived notes' items are hidden.
 */
export function flattenTasks(
  notes: TaskNote[],
  opts: { filter?: TaskFilter; includeCompletedSince?: number } = {},
): Task[] {
  const filter = opts.filter ?? { kind: "all" };
  const tasks: Task[] = [];
  for (const n of notes) {
    if (n.status === "archived") continue;
    (n.actionItems ?? []).forEach((a, index) => {
      const completed = !!a.completed;
      if (completed) {
        if (opts.includeCompletedSince === undefined) return;
        if (!a.completedAt || a.completedAt < opts.includeCompletedSince) return;
      }
      const assignee = a.assignee ?? null;
      if (filter.kind === "unassigned" && assignee) return;
      if (filter.kind === "person" && !sameAssignee(assignee, filter.ref)) return;
      tasks.push({
        noteId: n._id,
        index,
        title: a.title,
        priority: a.priority ?? null,
        dueHint: a.dueHint ?? null,
        assigneeHint: a.assigneeHint ?? null,
        assignee,
        completed,
        completedAt: a.completedAt ?? null,
        noteTitle:
          n.aiTitle || n.rawTranscript.replace(/\s+/g, " ").trim().slice(0, 60) || "Field note",
        jobTitle: n.jobTitle,
        crewName: n.crewName,
        createdAt: n.createdAt,
      });
    });
  }
  return tasks.sort((x, y) => {
    if (x.completed !== y.completed) return x.completed ? 1 : -1;
    if (x.completed) return (y.completedAt ?? 0) - (x.completedAt ?? 0);
    const px = PRIORITY_RANK[x.priority ?? "medium"];
    const py = PRIORITY_RANK[y.priority ?? "medium"];
    return px - py || x.createdAt - y.createdAt || x.index - y.index;
  });
}
