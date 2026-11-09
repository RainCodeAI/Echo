/**
 * Owner edits to AI-structured note fields, and how they survive AI re-runs.
 *
 * Any field the owner edits by hand is recorded in `voiceNotes.ownerEditedFields`.
 * When AI structuring runs again (retry, or after a transcript correction),
 * `mergeAiStructure` leaves those fields alone — so a re-run can never undo
 * the office's corrections. Pure functions: unit-tested without Convex.
 */

export const OWNER_EDITABLE_FIELDS = [
  "title",
  "summary",
  "materials",
  "actionItems",
  "urgency",
  "siteAddress",
  "timelineNotes",
  "tags",
] as const;

export type OwnerEditableField = (typeof OWNER_EDITABLE_FIELDS)[number];

export const LIMITS = {
  title: 200,
  summary: 4_000,
  siteAddress: 500,
  timelineNotes: 4_000,
  textField: 300,
  materials: 100,
  actionItems: 100,
  tags: 20,
  tag: 40,
} as const;

/** Add fields to the owner-edited set (stable order, no duplicates). */
export function markEdited(
  existing: readonly string[] | undefined,
  fields: readonly OwnerEditableField[],
): OwnerEditableField[] {
  const set = new Set<string>([...(existing ?? []), ...fields]);
  return OWNER_EDITABLE_FIELDS.filter((f) => set.has(f));
}

type Priority = "low" | "medium" | "high";
type Urgency = "low" | "medium" | "high" | "emergency";

export type MaterialLine = {
  name: string;
  quantity?: string;
  unit?: string;
  notes?: string;
};
export type ActionItem = {
  title: string;
  assigneeHint?: string;
  dueHint?: string;
  priority?: Priority;
  completed?: boolean;
};

/** The structured output of one AI run, in note-field names. */
export type AiStructurePatch = {
  aiTitle: string;
  aiSummary: string;
  materials: MaterialLine[];
  actionItems: ActionItem[];
  urgency: Urgency;
  siteAddress?: string;
  timelineNotes?: string;
  tags: string[];
};

const FIELD_TO_NOTE_KEY: Record<OwnerEditableField, keyof AiStructurePatch> = {
  title: "aiTitle",
  summary: "aiSummary",
  materials: "materials",
  actionItems: "actionItems",
  urgency: "urgency",
  siteAddress: "siteAddress",
  timelineNotes: "timelineNotes",
  tags: "tags",
};

/** Drop AI values for every field the owner has edited. */
export function mergeAiStructure(
  ai: AiStructurePatch,
  ownerEdited: readonly string[] | undefined,
): Partial<AiStructurePatch> {
  const protectedKeys = new Set(
    (ownerEdited ?? [])
      .filter((f): f is OwnerEditableField =>
        (OWNER_EDITABLE_FIELDS as readonly string[]).includes(f),
      )
      .map((f) => FIELD_TO_NOTE_KEY[f]),
  );
  const merged: Partial<AiStructurePatch> = {};
  for (const [key, value] of Object.entries(ai) as [keyof AiStructurePatch, unknown][]) {
    if (!protectedKeys.has(key)) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

// --- Normalising owner input --------------------------------------------------

function clip(value: string | undefined, max: number): string | undefined {
  const t = value?.trim();
  return t ? t.slice(0, max) : undefined;
}

export type OwnerFieldEdits = {
  title?: string;
  summary?: string;
  materials?: MaterialLine[];
  actionItems?: ActionItem[];
  siteAddress?: string;
  timelineNotes?: string;
  tags?: string[];
};

/**
 * Trim/clip owner input, drop blank rows, and report which fields changed.
 * Returns the note patch (in note-field names) and the fields to protect.
 * Throws with an owner-readable message on input that can't be saved.
 */
export function normalizeOwnerEdits(edits: OwnerFieldEdits): {
  patch: Partial<AiStructurePatch>;
  fields: OwnerEditableField[];
} {
  const patch: Partial<AiStructurePatch> = {};
  const fields: OwnerEditableField[] = [];

  if (edits.title !== undefined) {
    const title = clip(edits.title, LIMITS.title);
    if (!title) throw new Error("Title can't be empty.");
    patch.aiTitle = title;
    fields.push("title");
  }
  if (edits.summary !== undefined) {
    patch.aiSummary = clip(edits.summary, LIMITS.summary) ?? "";
    fields.push("summary");
  }
  if (edits.siteAddress !== undefined) {
    patch.siteAddress = clip(edits.siteAddress, LIMITS.siteAddress);
    fields.push("siteAddress");
  }
  if (edits.timelineNotes !== undefined) {
    patch.timelineNotes = clip(edits.timelineNotes, LIMITS.timelineNotes);
    fields.push("timelineNotes");
  }
  if (edits.materials !== undefined) {
    if (edits.materials.length > LIMITS.materials) {
      throw new Error(`At most ${LIMITS.materials} materials.`);
    }
    patch.materials = edits.materials
      .map((m) => ({
        name: clip(m.name, LIMITS.textField) ?? "",
        quantity: clip(m.quantity, LIMITS.textField),
        unit: clip(m.unit, LIMITS.textField),
        notes: clip(m.notes, LIMITS.textField),
      }))
      .filter((m) => m.name.length > 0);
    fields.push("materials");
  }
  if (edits.actionItems !== undefined) {
    if (edits.actionItems.length > LIMITS.actionItems) {
      throw new Error(`At most ${LIMITS.actionItems} action items.`);
    }
    patch.actionItems = edits.actionItems
      .map((a) => ({
        title: clip(a.title, LIMITS.textField) ?? "",
        assigneeHint: clip(a.assigneeHint, LIMITS.textField),
        dueHint: clip(a.dueHint, LIMITS.textField),
        priority: a.priority,
        completed: a.completed || undefined,
      }))
      .filter((a) => a.title.length > 0);
    fields.push("actionItems");
  }
  if (edits.tags !== undefined) {
    const seen = new Set<string>();
    patch.tags = edits.tags
      .map((t) =>
        t.trim().toLowerCase().replace(/\s+/g, "_").slice(0, LIMITS.tag),
      )
      .filter((t) => t && !seen.has(t) && seen.add(t))
      .slice(0, LIMITS.tags);
    fields.push("tags");
  }

  return { patch, fields };
}
