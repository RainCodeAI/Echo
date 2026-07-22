"use client";

import { Badge } from "@/components/ui/badge";
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

export function NoteAiPanel({
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
        <Badge className={ai.badgeClass}>{ai.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {aiStatus === "failed" && aiErrorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {aiErrorMessage}
            {retrySlot ? <div className="mt-3">{retrySlot}</div> : null}
          </div>
        ) : null}

        {(aiStatus === "pending" || aiStatus === "processing") && !hasStructure ? (
          <p className="text-sm text-muted-foreground">
            {aiStatus === "processing"
              ? "Structuring this note…"
              : "Waiting for AI enrichment. Raw transcript and audio are already saved."}
            {retrySlot ? <div className="mt-3">{retrySlot}</div> : null}
          </p>
        ) : null}

        {aiTitle ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Title
            </p>
            <p className="mt-1 font-medium">{aiTitle}</p>
          </div>
        ) : null}

        {aiSummary ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Summary
            </p>
            <p className="mt-1 text-sm leading-relaxed">{aiSummary}</p>
          </div>
        ) : null}

        {siteAddress ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Site
            </p>
            <p className="mt-1 text-sm">{siteAddress}</p>
          </div>
        ) : null}

        {materials && materials.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Materials
            </p>
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
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Action items
            </p>
            <ul className="space-y-1.5 text-sm">
              {actionItems.map((item, i) => (
                <li
                  key={`${item.title}-${i}`}
                  className="rounded-md border bg-muted/30 px-3 py-2"
                >
                  <span className="font-medium">{item.title}</span>
                  {item.priority ? (
                    <span className="ml-2 text-xs capitalize text-muted-foreground">
                      ({item.priority})
                    </span>
                  ) : null}
                  {item.assigneeHint || item.dueHint ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[item.assigneeHint, item.dueHint].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {timelineNotes ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Timeline
            </p>
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
          <div className="flex flex-wrap gap-1.5">
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
    </Card>
  );
}
