"use client";

import Link from "next/link";
import { use } from "react";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  Loader2,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NoteAiPanel } from "@/components/notes/note-ai-panel";
import { NoteAiRetryButton } from "@/components/notes/note-ai-retry-button";
import { NoteOwnerFields } from "@/components/notes/note-owner-fields";
import { NoteReviewActions } from "@/components/notes/note-review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AI_STATUS_MAP,
  URGENCY_MAP,
  VOICE_NOTE_STATUS_MAP,
} from "@/lib/constants";
import { formatDurationShort } from "@/lib/utils";

export default function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const noteId = id as Id<"voiceNotes">;
  const note = useQuery(api.voiceNotes.get, { noteId });

  if (note === undefined) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (note === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/notes">
            <ArrowLeft className="h-4 w-4" />
            Back to notes
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Note not found</CardTitle>
            <CardDescription>
              This note may have been deleted or belongs to another workspace.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const status = VOICE_NOTE_STATUS_MAP[note.status];
  const urgency = note.urgency ? URGENCY_MAP[note.urgency] : null;
  const ai = AI_STATUS_MAP[note.aiStatus];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/notes">
            <ArrowLeft className="h-4 w-4" />
            Back to notes
          </Link>
        </Button>
        <NoteReviewActions noteId={note._id} status={note.status} />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">
            {note.aiTitle || note.crewName || "Voice note"}
          </h2>
          <Badge className={status.badgeClass}>{status.label}</Badge>
          <Badge className={ai.badgeClass}>{ai.label}</Badge>
          {urgency ? (
            <Badge className={urgency.badgeClass}>{urgency.label}</Badge>
          ) : null}
          {note.workerFlaggedUrgent ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Urgent
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {note.crewName ?? "Unknown crew"} ·{" "}
          {new Date(note.recordedAt).toLocaleString()}
          {note.audioDurationMs
            ? ` · ${formatDurationShort(note.audioDurationMs)}`
            : ""}
          {note.transcriptSource
            ? ` · transcript: ${note.transcriptSource}`
            : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AudioLines className="h-4 w-4 text-primary" />
            Capture
          </CardTitle>
          <CardDescription>
            Raw field memo. Always durable — independent of AI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {note.audioUrl ? (
            <audio controls className="w-full" preload="metadata" src={note.audioUrl}>
              Your browser does not support audio playback.
            </audio>
          ) : (
            <p className="text-sm text-muted-foreground">No audio attached.</p>
          )}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transcript
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {note.rawTranscript?.trim() || (
                <span className="text-muted-foreground">
                  No transcript yet
                  {note.audioStorageId
                    ? " — audio is saved; Whisper can fill this in."
                    : "."}
                </span>
              )}
            </p>
          </div>

          {note.reviewedAt ? (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">
                Reviewed {new Date(note.reviewedAt).toLocaleString()}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      <NoteAiPanel
        aiStatus={note.aiStatus}
        aiTitle={note.aiTitle}
        aiSummary={note.aiSummary}
        materials={note.materials}
        actionItems={note.actionItems}
        tags={note.tags}
        siteAddress={note.siteAddress}
        timelineNotes={note.timelineNotes}
        suggestedJobUpdates={note.suggestedJobUpdates}
        aiConfidence={note.aiConfidence}
        aiErrorMessage={note.aiErrorMessage}
        retrySlot={
          note.aiStatus === "failed" || note.aiStatus === "pending" ? (
            <NoteAiRetryButton noteId={note._id} />
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Owner review</CardTitle>
          <CardDescription>
            Internal notes and urgency for the office.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NoteOwnerFields
            noteId={note._id}
            ownerNote={note.ownerNote}
            urgency={note.urgency}
            workerFlaggedUrgent={note.workerFlaggedUrgent}
          />
        </CardContent>
      </Card>
    </div>
  );
}
