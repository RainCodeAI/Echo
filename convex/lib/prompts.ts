/**
 * Prompt construction for Echo AI field-note structuring.
 * Follows the same MAPS-style shape as SiteAssist (Mission / Ask / Parameters / Shape).
 */

export const URGENCY_VALUES = ["low", "medium", "high", "emergency"] as const;
export const PRIORITY_VALUES = ["low", "medium", "high"] as const;

export const ECHO_MISSION = `You are Echo, a voice-first field notes assistant for contractors and trades businesses (landscaping, roofing, HVAC, plumbing, electrical, painting, fence & deck, concrete, pressure washing, security/camera, general contracting). Your mission is to turn messy job-site voice memos into clear, operational structure so owners can act without replaying every recording. Prefer practical job-site language over marketing fluff. Never invent materials, quantities, or site details that are not supported by the transcript.`;

export interface MapsPrompt {
  ask: string;
  parameters: string[];
  shape: string;
}

export function renderSystemPrompt(p: MapsPrompt): string {
  return [
    "# Mission",
    ECHO_MISSION,
    "",
    "# Ask",
    p.ask,
    "",
    "# Parameters",
    ...p.parameters.map((c) => `- ${c}`),
    "",
    "# Shape",
    p.shape,
  ].join("\n");
}

export const STRUCTURE_NOTE_SYSTEM_PROMPT = renderSystemPrompt({
  ask: "Structure one field voice memo into a concise operational record for the office.",
  parameters: [
    "Use only facts supported by the transcript (and any explicit worker urgency flag).",
    "If something is unclear, omit it or put a short note in timelineNotes — do not invent.",
    "Materials: name required; quantity/unit/notes when mentioned.",
    "Action items: concrete next steps for crew or office.",
    "Urgency: low | medium | high | emergency. Respect workerFlaggedUrgent when true (at least high).",
    "suggestedJobUpdates: optional proposals only (field name + value + short rationale).",
    "tags: short snake_or_lowercase labels like change_order, safety, materials_needed.",
    "confidence: 0 to 1 self-score of how complete/clear the memo was.",
    "title: short owner-facing title (max ~80 chars).",
    "summary: 2–4 sentences, operational tone.",
  ],
  shape: "Return a single JSON object matching the provided schema. No markdown.",
});

/** OpenAI json_schema strict shape for voice-note structuring. */
export const STRUCTURE_NOTE_JSON_SCHEMA = {
  name: "echo_voice_note_structure",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      materials: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            quantity: { type: "string" },
            unit: { type: "string" },
            notes: { type: "string" },
          },
          required: ["name", "quantity", "unit", "notes"],
        },
      },
      actionItems: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            assigneeHint: { type: "string" },
            dueHint: { type: "string" },
            priority: { type: "string", enum: [...PRIORITY_VALUES] },
          },
          required: ["title", "assigneeHint", "dueHint", "priority"],
        },
      },
      urgency: { type: "string", enum: [...URGENCY_VALUES] },
      siteAddress: { type: "string" },
      timelineNotes: { type: "string" },
      suggestedJobUpdates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string" },
            value: { type: "string" },
            rationale: { type: "string" },
          },
          required: ["field", "value", "rationale"],
        },
      },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      confidence: { type: "number" },
    },
    required: [
      "title",
      "summary",
      "materials",
      "actionItems",
      "urgency",
      "siteAddress",
      "timelineNotes",
      "suggestedJobUpdates",
      "tags",
      "confidence",
    ],
  },
} as const;

export function buildStructureUserPrompt(input: {
  companyName: string;
  primaryTrade?: string | null;
  crewName?: string | null;
  workerFlaggedUrgent?: boolean;
  transcript: string;
}): string {
  return [
    `Company: ${input.companyName}`,
    input.primaryTrade ? `Primary trade: ${input.primaryTrade}` : null,
    input.crewName ? `Recorded by: ${input.crewName}` : null,
    `Worker flagged urgent: ${input.workerFlaggedUrgent ? "yes" : "no"}`,
    "",
    "Transcript:",
    input.transcript.trim() || "(empty transcript)",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export type StructuredNoteModel = {
  title: string;
  summary: string;
  materials: {
    name: string;
    quantity: string;
    unit: string;
    notes: string;
  }[];
  actionItems: {
    title: string;
    assigneeHint: string;
    dueHint: string;
    priority: (typeof PRIORITY_VALUES)[number];
  }[];
  urgency: (typeof URGENCY_VALUES)[number];
  siteAddress: string;
  timelineNotes: string;
  suggestedJobUpdates: {
    field: string;
    value: string;
    rationale: string;
  }[];
  tags: string[];
  confidence: number;
};

/** Normalize model output into Convex-friendly optional empty strings stripped. */
export function sanitizeStructuredNote(raw: StructuredNoteModel) {
  const blankToUndef = (s: string) => {
    const t = s.trim();
    return t.length ? t : undefined;
  };

  return {
    title: raw.title.trim() || "Field note",
    summary: raw.summary.trim() || "No summary generated.",
    materials: (raw.materials ?? [])
      .map((m) => ({
        name: m.name.trim(),
        quantity: blankToUndef(m.quantity),
        unit: blankToUndef(m.unit),
        notes: blankToUndef(m.notes),
      }))
      .filter((m) => m.name.length > 0),
    actionItems: (raw.actionItems ?? [])
      .map((a) => ({
        title: a.title.trim(),
        assigneeHint: blankToUndef(a.assigneeHint),
        dueHint: blankToUndef(a.dueHint),
        priority: a.priority,
      }))
      .filter((a) => a.title.length > 0),
    urgency: raw.urgency,
    siteAddress: blankToUndef(raw.siteAddress),
    timelineNotes: blankToUndef(raw.timelineNotes),
    suggestedJobUpdates: (raw.suggestedJobUpdates ?? [])
      .map((s) => ({
        field: s.field.trim(),
        value: s.value.trim(),
        rationale: blankToUndef(s.rationale),
      }))
      .filter((s) => s.field && s.value),
    tags: (raw.tags ?? []).map((t) => t.trim()).filter(Boolean),
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
  };
}
