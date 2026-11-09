import { describe, expect, it } from "vitest";
import { flattenTasks, matchAssignee, type Person, type TaskNote } from "../convex/lib/tasks";
import { normalizeOwnerEdits } from "../convex/lib/noteEdits";

const PEOPLE: Person[] = [
  { kind: "member", id: "m-luis", name: "Luis Garcia" },
  { kind: "member", id: "m-jose", name: "José Ruiz" },
  { kind: "member", id: "m-chris1", name: "Chris Lee" },
  { kind: "member", id: "m-chris2", name: "Chris Park" },
  { kind: "user", id: "u-dana", name: "Dana Owner" },
];

describe("matchAssignee", () => {
  it("matches a full name or a unique first name, ignoring case and accents", () => {
    expect(matchAssignee("Luis", PEOPLE)).toEqual({ kind: "member", id: "m-luis" });
    expect(matchAssignee("luis garcia", PEOPLE)).toEqual({ kind: "member", id: "m-luis" });
    expect(matchAssignee("Jose", PEOPLE)).toEqual({ kind: "member", id: "m-jose" });
    expect(matchAssignee("dana", PEOPLE)).toEqual({ kind: "user", id: "u-dana" });
  });
  it("leaves ambiguous, generic or unknown hints unassigned", () => {
    expect(matchAssignee("Chris", PEOPLE)).toBeNull();
    expect(matchAssignee("Chris Park", PEOPLE)).toEqual({ kind: "member", id: "m-chris2" });
    expect(matchAssignee("Luis G", PEOPLE)).toEqual({ kind: "member", id: "m-luis" });
    // A surname that doesn't match is a different person, not our Luis.
    expect(matchAssignee("Luis Outsider", PEOPLE)).toBeNull();
    expect(matchAssignee("Chris P", PEOPLE)).toEqual({ kind: "member", id: "m-chris2" });
    expect(matchAssignee("office", PEOPLE)).toBeNull();
    expect(matchAssignee("crew", PEOPLE)).toBeNull();
    expect(matchAssignee("", PEOPLE)).toBeNull();
    expect(matchAssignee(undefined, PEOPLE)).toBeNull();
  });
});

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const note = (o: Partial<TaskNote>): TaskNote => ({
  _id: "n1",
  createdAt: NOW - DAY,
  status: "ready",
  rawTranscript: "x",
  aiTitle: "Note",
  jobTitle: null,
  crewName: null,
  ...o,
});

describe("flattenTasks", () => {
  const notes = [
    note({
      _id: "old",
      createdAt: NOW - 5 * DAY,
      actionItems: [
        { title: "Old medium" },
        { title: "Done long ago", completed: true, completedAt: NOW - 30 * DAY },
      ],
    }),
    note({
      _id: "new",
      createdAt: NOW - DAY,
      actionItems: [
        { title: "New high", priority: "high", assignee: { kind: "member", id: "m-luis" } },
        { title: "New low", priority: "low" },
        { title: "Done yesterday", completed: true, completedAt: NOW - DAY },
      ],
    }),
    note({ _id: "arch", status: "archived", actionItems: [{ title: "Archived item", priority: "high" }] }),
  ];

  it("lists open items: high priority first, then oldest first", () => {
    expect(flattenTasks(notes).map((t) => t.title)).toEqual(["New high", "Old medium", "New low"]);
  });
  it("keeps note + index so the item can be ticked/assigned", () => {
    expect(flattenTasks(notes)[0]).toMatchObject({ noteId: "new", index: 0 });
  });
  it("filters by unassigned and by person", () => {
    expect(flattenTasks(notes, { filter: { kind: "unassigned" } }).map((t) => t.title)).toEqual(["Old medium", "New low"]);
    expect(
      flattenTasks(notes, { filter: { kind: "person", ref: { kind: "member", id: "m-luis" } } }).map((t) => t.title),
    ).toEqual(["New high"]);
  });
  it("shows recently completed items last when asked", () => {
    const titles = flattenTasks(notes, { includeCompletedSince: NOW - 7 * DAY }).map((t) => t.title);
    expect(titles.at(-1)).toBe("Done yesterday");
    expect(titles).not.toContain("Done long ago");
  });
});

describe("owner edits keep assignment", () => {
  it("normalizeOwnerEdits preserves assignee and completion time", () => {
    const { patch } = normalizeOwnerEdits({
      actionItems: [
        { title: " Call Ramirez ", assignee: { kind: "user", id: "u-dana" }, completed: true, completedAt: NOW },
        { title: "Open item", assignee: { kind: "member", id: "m-luis" }, completedAt: NOW },
      ],
    });
    expect(patch.actionItems?.[0]).toMatchObject({ title: "Call Ramirez", assignee: { kind: "user", id: "u-dana" }, completedAt: NOW });
    // completedAt is dropped when the item isn't completed.
    expect(patch.actionItems?.[1].completedAt).toBeUndefined();
  });
});
