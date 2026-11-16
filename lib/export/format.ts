/**
 * Turns the owner's exported rows into readable files (pure, tested).
 * The raw rows also go into data.json, so nothing is lost by the CSVs being
 * a friendlier subset.
 */
import { toCsv } from "../../convex/lib/csv";
import { mimeToExtension } from "../../convex/lib/openaiCalls";

type Row = Record<string, unknown> & { _id: string };

export type ExportTables = {
  voiceNotes: Row[];
  voiceNotePhotos: Row[];
  leads: Row[];
  jobs: Row[];
  teamMembers: Row[];
  users: Row[];
  materialOrders: Row[];
  customerUpdates: Row[];
  alerts: Row[];
};

export const EXPORT_TABLES = [
  "voiceNotes",
  "voiceNotePhotos",
  "leads",
  "jobs",
  "teamMembers",
  "users",
  "materialOrders",
  "customerUpdates",
  "alerts",
] as const satisfies readonly (keyof ExportTables)[];

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const iso = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString() : "");
const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

function namesById(rows: Row[], field: string) {
  return new Map(rows.map((r) => [r._id, str(r[field])]));
}

/** Paths inside the zip for a note's audio and a photo. */
export function audioPath(note: Row): string {
  const date = iso(note.recordedAt).slice(0, 10) || "undated";
  return `audio/${date}-${note._id}.${mimeToExtension(str(note.audioMimeType) || undefined)}`;
}
export function photoPath(photo: Row): string {
  return `photos/${str(photo.voiceNoteId)}-${photo._id}.jpg`;
}

export function buildExportFiles(t: ExportTables, opts: { companyName: string; exportedAt: number }): Record<string, string> {
  const crew = namesById(t.teamMembers, "name");
  const users = namesById(t.users, "name");
  const jobs = namesById(t.jobs, "title");
  const leads = namesById(t.leads, "customerName");
  const person = (a: unknown) => {
    const ref = a as { kind?: string; id?: string } | undefined;
    if (!ref?.id) return "";
    return (ref.kind === "user" ? users.get(ref.id) : crew.get(ref.id)) ?? "";
  };
  const notes = [...t.voiceNotes].sort((a, b) => Number(a.recordedAt) - Number(b.recordedAt));

  const files: Record<string, string> = {};
  files["notes.csv"] = toCsv([
    ["recorded_at", "crew", "job", "lead", "status", "urgency", "title", "summary", "transcript", "materials", "action_items", "site_address", "owner_note", "audio_url", "note_id"],
    ...notes.map((n) => [
      iso(n.recordedAt),
      crew.get(str(n.teamMemberId)) ?? users.get(str(n.recordedBy)) ?? "",
      jobs.get(str(n.jobId)) ?? "",
      leads.get(str(n.leadId)) ?? "",
      str(n.status),
      str(n.urgency),
      str(n.aiTitle),
      str(n.aiSummary),
      str(n.rawTranscript),
      list<{ name: string; quantity?: string; unit?: string }>(n.materials)
        .map((m) => [m.name, m.quantity, m.unit].filter(Boolean).join(" "))
        .join("; "),
      list<{ title: string }>(n.actionItems).map((a) => a.title).join("; "),
      str(n.siteAddress),
      str(n.ownerNote),
      str(n.audioUrl),
      n._id,
    ]),
  ]);
  files["action-items.csv"] = toCsv([
    ["note_id", "recorded_at", "title", "priority", "assigned_to", "done", "done_at"],
    ...notes.flatMap((n) =>
      list<{ title: string; priority?: string; assignee?: unknown; completed?: boolean; completedAt?: number }>(n.actionItems).map((a) => [
        n._id,
        iso(n.recordedAt),
        a.title,
        a.priority ?? "",
        person(a.assignee),
        a.completed ? "yes" : "no",
        iso(a.completedAt),
      ]),
    ),
  ]);
  files["leads.csv"] = toCsv([
    ["customer", "phone", "email", "address", "service", "status", "urgency", "description", "created_at", "lead_id"],
    ...t.leads.map((l) => [str(l.customerName), str(l.phone), str(l.email), str(l.address), str(l.serviceType), str(l.status), str(l.urgency), str(l.description), iso(l.createdAt), l._id]),
  ]);
  files["jobs.csv"] = toCsv([
    ["title", "status", "scheduled_for", "address", "customer", "notes", "created_at", "job_id"],
    ...t.jobs.map((j) => [str(j.title), str(j.status), iso(j.scheduledFor), str(j.address), leads.get(str(j.leadId)) ?? "", str(j.notes), iso(j.createdAt), j._id]),
  ]);
  files["crew.csv"] = toCsv([
    ["name", "role", "active", "recording_notice_accepted_at"],
    ...t.teamMembers.map((m) => [str(m.name), str(m.role), m.isActive ? "yes" : "no", iso(m.noticeAcceptedAt)]),
  ]);
  files["office-users.csv"] = toCsv([["name", "email", "role"], ...t.users.map((u) => [str(u.name), str(u.email), str(u.role)])]);
  files["materials-orders.csv"] = toCsv([
    ["ordered_at", "job", "ordered_by", "items"],
    ...t.materialOrders.map((o) => [
      iso(o.createdAt),
      jobs.get(str(o.jobId)) ?? "",
      users.get(str(o.createdBy)) ?? "",
      list<{ name: string; quantity: string }>(o.lines).map((l) => `${l.name} (${l.quantity})`).join("; "),
    ]),
  ]);
  files["customer-updates.csv"] = toCsv([
    ["created_at", "job", "status", "sent_via", "sent_at", "text_message", "email_subject", "email_body"],
    ...t.customerUpdates.map((u) => [iso(u.createdAt), jobs.get(str(u.jobId)) ?? "", str(u.status), str(u.sentVia), iso(u.sentAt), str(u.text), str(u.emailSubject), str(u.emailBody)]),
  ]);
  files["media-links.csv"] = toCsv([
    ["type", "note_id", "file_in_zip", "url"],
    ...notes.filter((n) => n.audioUrl).map((n) => ["audio", n._id, audioPath(n), str(n.audioUrl)]),
    ...t.voiceNotePhotos.filter((p) => p.url).map((p) => ["photo", str(p.voiceNoteId), photoPath(p), str(p.url)]),
  ]);
  files["data.json"] = JSON.stringify({ exportedAt: iso(opts.exportedAt), workspace: opts.companyName, tables: t }, null, 2);
  files["README.txt"] = [
    `Echo data export: ${opts.companyName}`,
    `Exported ${iso(opts.exportedAt)}`,
    "",
    "notes.csv             One row per field note: transcript, AI summary, materials, action items.",
    "action-items.csv      Every action item, who it's assigned to and whether it's done.",
    "leads.csv, jobs.csv   Customers and jobs.",
    "crew.csv              Crew members (PINs are never exported).",
    "office-users.csv      People who sign in to the dashboard.",
    "materials-orders.csv  Materials marked as ordered.",
    "customer-updates.csv  Customer update drafts and what was sent.",
    "media-links.csv       Each recording and photo. If you included media, the file is in audio/ or photos/.",
    "                      Links work while the workspace exists.",
    "data.json             Everything above as raw records, for importing elsewhere.",
    "",
  ].join("\r\n");
  return files;
}
