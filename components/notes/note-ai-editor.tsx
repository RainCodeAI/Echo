"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionItem, MaterialLine } from "@/types";

type Props = {
  noteId: Id<"voiceNotes">;
  aiTitle?: string;
  aiSummary?: string;
  materials?: MaterialLine[];
  actionItems?: ActionItem[];
  siteAddress?: string;
  timelineNotes?: string;
  tags?: string[];
  onDone: () => void;
};

const textareaClass =
  "w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const selectClass =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Owner correction of the AI-structured fields. Only fields that actually
 * changed are sent, so opening the editor and saving doesn't freeze every
 * field against future AI runs.
 */
export function NoteAiEditor(props: Props) {
  const update = useMutation(api.voiceNotes.updateAiFields);

  const initial = {
    title: props.aiTitle ?? "",
    summary: props.aiSummary ?? "",
    siteAddress: props.siteAddress ?? "",
    timelineNotes: props.timelineNotes ?? "",
    tags: (props.tags ?? []).join(", "),
    materials: (props.materials ?? []).map((m) => ({
      name: m.name,
      quantity: m.quantity ?? "",
      unit: m.unit ?? "",
      notes: m.notes ?? "",
    })),
    actionItems: (props.actionItems ?? []).map((a) => ({
      title: a.title,
      assigneeHint: a.assigneeHint ?? "",
      dueHint: a.dueHint ?? "",
      priority: a.priority ?? "",
      completed: !!a.completed,
    })),
  };

  const [form, setForm] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const changes: Parameters<typeof update>[0] = { noteId: props.noteId };
    if (form.title !== initial.title) changes.title = form.title;
    if (form.summary !== initial.summary) changes.summary = form.summary;
    if (form.siteAddress !== initial.siteAddress) changes.siteAddress = form.siteAddress;
    if (form.timelineNotes !== initial.timelineNotes) changes.timelineNotes = form.timelineNotes;
    if (form.tags !== initial.tags) {
      changes.tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    }
    if (!same(form.materials, initial.materials)) {
      changes.materials = form.materials.map((m) => ({
        name: m.name,
        quantity: m.quantity || undefined,
        unit: m.unit || undefined,
        notes: m.notes || undefined,
      }));
    }
    if (!same(form.actionItems, initial.actionItems)) {
      changes.actionItems = form.actionItems.map((a) => ({
        title: a.title,
        assigneeHint: a.assigneeHint || undefined,
        dueHint: a.dueHint || undefined,
        priority: (a.priority || undefined) as ActionItem["priority"],
        completed: a.completed || undefined,
      }));
    }
    if (Object.keys(changes).length === 1) {
      props.onDone();
      return;
    }

    setPending(true);
    setError(null);
    try {
      await update(changes);
      props.onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="ai-editor">
      <div className="space-y-1.5">
        <Label htmlFor="edit-title">Title</Label>
        <Input id="edit-title" value={form.title} onChange={(e) => set("title", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-summary">Summary</Label>
        <textarea
          id="edit-summary"
          rows={3}
          className={textareaClass}
          value={form.summary}
          onChange={(e) => set("summary", e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="edit-site">Site address</Label>
          <Input id="edit-site" value={form.siteAddress} onChange={(e) => set("siteAddress", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-tags">Tags (comma separated)</Label>
          <Input id="edit-tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Materials</Label>
        {form.materials.map((m, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[1fr_5rem_6rem_1fr_auto] sm:border-0 sm:p-0"
          >
            <Input
              aria-label={`Material ${i + 1} name`}
              placeholder="Item"
              className="col-span-3 sm:col-span-1"
              value={m.name}
              onChange={(e) =>
                set("materials", form.materials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <Input
              aria-label={`Material ${i + 1} quantity`}
              placeholder="Qty"
              value={m.quantity}
              onChange={(e) =>
                set("materials", form.materials.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
              }
            />
            <Input
              aria-label={`Material ${i + 1} unit`}
              placeholder="Unit"
              value={m.unit}
              onChange={(e) =>
                set("materials", form.materials.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))
              }
            />
            <Input
              aria-label={`Material ${i + 1} notes`}
              placeholder="Notes"
              className="hidden sm:block"
              value={m.notes}
              onChange={(e) =>
                set("materials", form.materials.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))
              }
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove material ${i + 1}`}
              onClick={() => set("materials", form.materials.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => set("materials", [...form.materials, { name: "", quantity: "", unit: "", notes: "" }])}
        >
          <Plus className="h-3.5 w-3.5" />
          Add material
        </Button>
      </div>

      <div className="space-y-2">
        <Label>Action items</Label>
        {form.actionItems.map((a, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-dashed p-2 sm:grid-cols-[1fr_8rem_8rem_auto_auto] sm:border-0 sm:p-0"
          >
            <Input
              aria-label={`Action item ${i + 1}`}
              placeholder="What needs doing"
              className="col-span-2 sm:col-span-1"
              value={a.title}
              onChange={(e) =>
                set("actionItems", form.actionItems.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <Input
              aria-label={`Action item ${i + 1} assignee`}
              placeholder="Who"
              className="hidden sm:block"
              value={a.assigneeHint}
              onChange={(e) =>
                set("actionItems", form.actionItems.map((x, j) => (j === i ? { ...x, assigneeHint: e.target.value } : x)))
              }
            />
            <Input
              aria-label={`Action item ${i + 1} due`}
              placeholder="When"
              className="hidden sm:block"
              value={a.dueHint}
              onChange={(e) =>
                set("actionItems", form.actionItems.map((x, j) => (j === i ? { ...x, dueHint: e.target.value } : x)))
              }
            />
            <select
              aria-label={`Action item ${i + 1} priority`}
              className={selectClass}
              value={a.priority}
              onChange={(e) =>
                set("actionItems", form.actionItems.map((x, j) => (j === i ? { ...x, priority: e.target.value } : x)))
              }
            >
              <option value="">—</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Remove action item ${i + 1}`}
              onClick={() => set("actionItems", form.actionItems.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            set("actionItems", [
              ...form.actionItems,
              { title: "", assigneeHint: "", dueHint: "", priority: "", completed: false },
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add action item
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-timeline">Timeline notes</Label>
        <textarea
          id="edit-timeline"
          rows={2}
          className={textareaClass}
          value={form.timelineNotes}
          onChange={(e) => set("timelineNotes", e.target.value)}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Fields you change are kept when AI re-runs on this note.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={() => void handleSave()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save changes
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={props.onDone}>
          Cancel
        </Button>
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
