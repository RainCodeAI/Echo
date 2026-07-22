"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, RefreshCw } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

export function NoteAiRetryButton({ noteId }: { noteId: Id<"voiceNotes"> }) {
  const requestAiRetry = useMutation(api.voiceNotes.requestAiRetry);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            await requestAiRetry({ noteId });
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
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
