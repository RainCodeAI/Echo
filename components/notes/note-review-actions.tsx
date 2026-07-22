"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { VoiceNoteStatus } from "@/types";

type NoteReviewActionsProps = {
  noteId: Id<"voiceNotes">;
  status: VoiceNoteStatus;
};

export function NoteReviewActions({ noteId, status }: NoteReviewActionsProps) {
  const markReviewed = useMutation(api.voiceNotes.markReviewed);
  const markReady = useMutation(api.voiceNotes.markReady);
  const archive = useMutation(api.voiceNotes.archive);
  const unarchive = useMutation(api.voiceNotes.unarchive);

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setPending(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "ready" || status === "processing" ? (
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run("reviewed", () => markReviewed({ noteId }))
            }
          >
            {pending === "reviewed" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Mark reviewed
          </Button>
        ) : null}

        {status === "reviewed" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run("ready", () => markReady({ noteId }))}
          >
            {pending === "ready" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            Re-open
          </Button>
        ) : null}

        {status !== "archived" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run("archive", () => archive({ noteId }))}
          >
            {pending === "archive" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            Archive
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run("unarchive", () => unarchive({ noteId }))}
          >
            {pending === "unarchive" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArchiveRestore className="h-4 w-4" />
            )}
            Unarchive
          </Button>
        )}
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
