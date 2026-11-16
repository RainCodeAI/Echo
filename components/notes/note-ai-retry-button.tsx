"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

export function NoteAiRetryButton({
  noteId,
  hasOwnerEdits = false,
}: {
  noteId: Id<"voiceNotes">;
  /** Show the "let AI replace my edits" option. */
  hasOwnerEdits?: boolean;
}) {
  const requestAiRetry = useMutation(api.voiceNotes.requestAiRetry);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            await requestAiRetry({
              noteId,
              overwriteOwnerEdits: hasOwnerEdits && overwrite ? true : undefined,
            });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Retry failed.");
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Retry AI
      </Button>
      {hasOwnerEdits ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-input"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Let AI replace my edits (otherwise they&apos;re kept)
        </label>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
