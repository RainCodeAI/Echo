"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Pencil } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NoteAiEditor } from "@/components/notes/note-ai-editor";
import { AssigneeSelect } from "@/components/tasks/assignee-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AI_STATUS_MAP } from "@/lib/constants";
import type {
  ActionItem,
  MaterialLine,
  SuggestedJobUpdate,
  VoiceNoteAiStatus,
} from "@/types";

type NoteAiPanelProps = {
  noteId: Id<"voiceNotes">;
  /** Fields the owner corrected (kept when AI re-runs). */
  ownerEditedFields?: string[];
  aiStatus: VoiceNoteAiStatus;
  aiTitle?: string;
  aiSummary?: string;
  materials?: MaterialLine[];
  actionItems?: ActionItem[];
  tags?: string[];
  siteAddress?: string;
  timelineNotes?: string;
  suggestedJobUpdates?: SuggestedJobUpdate[];
  aiConfidence?: number;
  aiErrorMessage?: string;
  /** Slot for retry button once AI action exists. */
  retrySlot?: React.ReactNode;
};

/** Section label with an "Edited" marker when the owner changed it. */
function FieldLabel({
  children,
  edited,
  className = "",
}: {
  children: React.ReactNode;
  edited?: boolean;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground ${className}`}
    >
      {children}
      {edited ? (
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-sky-800">
          Edited
        </span>
      ) : null}
    </p>
  );
}

export function NoteAiPanel({
  noteId,
  ownerEditedFields,
  aiStatus,
  aiTitle,
  aiSummary,
  materials,
  actionItems,
  tags,
  siteAddress,
  timelineNotes,
  suggestedJobUpdates,
  aiConfidence,
  aiErrorMessage,
  retrySlot,
}: NoteAiPanelProps) {
  const ai = AI_STATUS_MAP[aiStatus];
  const [editing, setEditing] = useState(false);
  // Optimistic: the tick shows instantly instead of waiting for the server.
  const setCompleted = useMutation(
    api.voiceNotes.setActionItemCompleted,
  ).withOptimisticUpdate((store, { noteId: id, index, completed }) => {
    const current = store.getQuery(api.voiceNotes.get, { noteId: id });
    if (!current?.actionItems) return;
    store.setQuery(
      api.voiceNotes.get,
      { noteId: id },
      {
        ...current,
        actionItems: current.actionItems.map((item, i) =>
          i === index
            ? { ...item, completed: completed || undefined, completedAt: completed ? Date.now() : undefined }
            : item,
        ),
      },
    );
  });
  const setAssignee = useMutation(api.voiceNotes.setActionItemAssignee);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const edited = new Set(ownerEditedFields ?? []);
  const hasStructure =
    !!aiSummary ||
    (materials && materials.length > 0) ||
    (actionItems && actionItems.length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">AI structure</CardTitle>
          <CardDescription>
            Summary, materials, and actions extracted from the memo.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!editing ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          ) : null}
          <Badge className={`whitespace-nowrap ${ai.badgeClass}`}>{ai.label}</Badge>
        </div>
      </CardHeader>
      {editing ? (
        <CardContent>
          <NoteAiEditor
            noteId={noteId}
            aiTitle={aiTitle}
            aiSummary={aiSummary}
            materials={materials}
            actionItems={actionItems}
            siteAddress={siteAddress}
            timelineNotes={timelineNotes}
            tags={tags}
            onDone={() => setEditing(false)}
          />
        </CardContent>
      ) : (
      <CardContent className="space-y-4">
        {aiStatus === "failed" && aiErrorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {aiErrorMessage}
            {retrySlot ? <div className="mt-3">{retrySlot}</div> : null}
          </div>
        ) : null}

        {(aiStatus === "pending" || aiStatus === "processing") && !hasStructure ? (
          <div className="text-sm text-muted-foreground">
            <p>
              {aiStatus === "processing"
                ? "Structuring this note…"
                : "Waiting for AI enrichment. Raw transcript and audio are already saved."}
            </p>
            {retrySlot ? <div className="mt-3">{retrySlot}</div> : null}
          </div>
        ) : null}

        {aiTitle ? (
          <div>
            <FieldLabel edited={edited.has("title")}>Title</FieldLabel>
            <p className="mt-1 font-medium">{aiTitle}</p>
          </div>
        ) : null}

        {aiSummary ? (
          <div>
            <FieldLabel edited={edited.has("summary")}>Summary</FieldLabel>
            <p className="mt-1 text-sm leading-relaxed">{aiSummary}</p>
          </div>
        ) : null}

        {siteAddress ? (
          <div>
            <FieldLabel edited={edited.has("siteAddress")}>Site</FieldLabel>
            <p className="mt-1 text-sm">{siteAddress}</p>
          </div>
        ) : null}

        {materials && materials.length > 0 ? (
          <div>
            <FieldLabel edited={edited.has("materials")} className="mb-2">
              Materials
            </FieldLabel>
            <ul className="space-y-1.5 text-sm">
              {materials.map((m, i) => (
                <li
                  key={`${m.name}-${i}`}
                  className="rounded-md border bg-muted/30 px-3 py-2"
                >
                  <span className="font-medium">{m.name}</span>
                  {m.quantity || m.unit ? (
                    <span className="text-muted-foreground">
                      {" "}
                      — {[m.quantity, m.unit].filter(Boolean).join(" ")}
                    </span>
                  ) : null}
                  {m.notes ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{m.notes}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {actionItems && actionItems.length > 0 ? (
          <div>
            <FieldLabel edited={edited.has("actionItems")} className="mb-2">
              Action items
            </FieldLabel>
            <ul className="space-y-1.5 text-sm">
              {actionItems.map((item, i) => (
                <li
                  key={`${item.title}-${i}`}
                  className="flex items-start gap-2.5 rounded-md border bg-muted/30 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-input"
                    aria-label={`Mark "${item.title}" done`}
                    checked={!!item.completed}
                    onChange={(e) => {
                      setToggleError(null);
                      setCompleted({
                        noteId,
                        index: i,
                        completed: e.target.checked,
                        expectedTitle: item.title,
                      }).catch(
                        (err: unknown) =>
                          setToggleError(err instanceof Error ? err.message : "Could not update."),
                      );
                    }}
                  />
                  <div className="min-w-0 flex-1">
                  <span className={`font-medium ${item.completed ? "text-muted-foreground line-through" : ""}`}>
                    {item.title}
                  </span>
                  {item.priority ? (
                    <span className="ml-2 text-xs capitalize text-muted-foreground">
                      ({item.priority})
                    </span>
                  ) : null}
                  {item.dueHint ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.dueHint}</p>
                  ) : null}
                  </div>
                  <AssigneeSelect
                    label={`Assign "${item.title}"`}
                    value={item.assignee}
                    hint={item.assigneeHint}
                    onChange={(next) => {
                      setToggleError(null);
                      setAssignee({ noteId, index: i, expectedTitle: item.title, assignee: next }).catch(
                        (err: unknown) =>
                          setToggleError(err instanceof Error ? err.message : "Could not update."),
                      );
                    }}
                  />
                </li>
              ))}
            </ul>
            {toggleError ? (
              <p className="mt-1 text-xs text-destructive">{toggleError}</p>
            ) : null}
          </div>
        ) : null}

        {timelineNotes ? (
          <div>
            <FieldLabel edited={edited.has("timelineNotes")}>Timeline</FieldLabel>
            <p className="mt-1 text-sm whitespace-pre-wrap">{timelineNotes}</p>
          </div>
        ) : null}

        {suggestedJobUpdates && suggestedJobUpdates.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Suggested job updates
            </p>
            <ul className="space-y-1.5 text-sm">
              {suggestedJobUpdates.map((s, i) => (
                <li key={`${s.field}-${i}`} className="rounded-md border px-3 py-2">
                  <span className="font-medium">{s.field}</span>
                  <span className="text-muted-foreground"> → {s.value}</span>
                  {s.rationale ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{s.rationale}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {tags && tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {edited.has("tags") ? (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">
                Edited tags
              </span>
            ) : null}
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}

        {typeof aiConfidence === "number" ? (
          <p className="text-xs text-muted-foreground">
            Confidence: {Math.round(aiConfidence * 100)}%
          </p>
        ) : null}
      </CardContent>
      )}
    </Card>
  );
}
