"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Pencil } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  noteId: Id<"voiceNotes">;
  rawTranscript: string;
  transcriptSource?: string;
  hasAudio: boolean;
};

/**
 * Transcript view + owner correction. A corrected transcript is final: AI
 * re-runs use it and never re-transcribe the audio over it.
 */
export function NoteTranscriptEditor({
  noteId,
  rawTranscript,
  transcriptSource,
  hasAudio,
}: Props) {
  const updateTranscript = useMutation(api.voiceNotes.updateTranscript);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rawTranscript);
  const [pending, setPending] = useState<"save" | "rerun" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(rerunAi: boolean) {
    setPending(rerunAi ? "rerun" : "save");
    setError(null);
    try {
      await updateTranscript({ noteId, rawTranscript: draft, rerunAi });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(null);
    }
  }

  const unchanged = draft.trim() === rawTranscript.trim();

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Transcript
          {transcriptSource === "manual" ? (
            <Badge variant="secondary" className="normal-case tracking-normal">
              Corrected by office
            </Badge>
          ) : null}
        </p>
        {!editing ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(rawTranscript);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            aria-label="Transcript"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Fix names, numbers or misheard words. Your version is kept: AI
            re-runs won&apos;t re-transcribe over it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!!pending || unchanged || !draft.trim()}
              onClick={() => void save(true)}
            >
              {pending === "rerun" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save &amp; re-run AI
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!!pending || unchanged || !draft.trim()}
              onClick={() => void save(false)}
            >
              {pending === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save only
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!!pending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
          {rawTranscript.trim() || (
            <span className="text-muted-foreground">
              No transcript yet
              {hasAudio ? " — audio is saved; server transcription can fill this in." : "."}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
