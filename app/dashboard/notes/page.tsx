"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { AudioLines, AlertTriangle, ChevronRight } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDurationShort } from "@/lib/utils";
import {
  AI_STATUS_MAP,
  URGENCY_MAP,
  VOICE_NOTE_STATUS_MAP,
} from "@/lib/constants";

/**
 * Owner notes list — newest first, links into detail/review.
 */
export default function NotesPage() {
  const notes = useQuery(api.voiceNotes.listForCompany, { limit: 50 });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Voice notes</h2>
        <p className="text-sm text-muted-foreground">
          Field captures from crew PIN entry. Open a note to review, flag, or
          archive.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent notes</CardTitle>
          <CardDescription>
            Newest first. Transcript and audio are saved even before AI runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notes === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
              <AudioLines className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">No notes yet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Add a crew member under Crew, open the field entry link, enter a
                PIN, and record a note.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {notes.map((note) => {
                const urgency = note.urgency
                  ? URGENCY_MAP[note.urgency]
                  : null;
                const ai = AI_STATUS_MAP[note.aiStatus];
                const status = VOICE_NOTE_STATUS_MAP[note.status];
                const preview =
                  note.aiSummary?.trim() ||
                  note.rawTranscript?.trim() ||
                  (note.audioStorageId
                    ? "(audio only — no transcript yet)"
                    : "—");
                const title = note.aiTitle || note.crewName;

                return (
                  <li key={note._id}>
                    <Link
                      href={`/dashboard/notes/${note._id}`}
                      className="flex items-start justify-between gap-3 py-4 transition-colors hover:bg-muted/40 -mx-2 rounded-lg px-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{title}</span>
                          <Badge className={status.badgeClass}>
                            {status.label}
                          </Badge>
                          {note.workerFlaggedUrgent ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Urgent
                            </Badge>
                          ) : null}
                          {urgency ? (
                            <Badge className={urgency.badgeClass}>
                              {urgency.label}
                            </Badge>
                          ) : null}
                          <Badge className={ai.badgeClass}>{ai.label}</Badge>
                        </div>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {preview}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {note.crewName} ·{" "}
                          {new Date(note.recordedAt).toLocaleString()}
                          {note.audioDurationMs
                            ? ` · ${formatDurationShort(note.audioDurationMs)}`
                            : ""}
                          {note.audioStorageId ? " · audio" : ""}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
