"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Trash2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

/**
 * Owner-only permanent delete (recording, photos, transcript, AI fields).
 * Archiving stays the everyday, reversible option.
 */
export function DeleteNote({ noteId }: { noteId: Id<"voiceNotes"> }) {
  const status = useQuery(api.privacy.status, {});
  const deleteNote = useMutation(api.privacy.deleteNote);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status?.isOwner) return null;

  return (
    <div className="rounded-lg border border-dashed px-4 py-3 text-sm" data-testid="delete-note">
      {!confirming ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground">Need it gone for good, e.g. someone asked you to delete a recording?</p>
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirming(true)}>
            <Trash2 /> Delete permanently
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p>
            This deletes the recording, photos, transcript and everything the AI extracted from it. It can&rsquo;t be
            undone. To just hide it, archive it instead.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await deleteNote({ noteId });
                  router.push("/dashboard/notes");
                } catch (err) {
                  setError(err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Try again.");
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Trash2 />} Yes, delete forever
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error ? <p className="mt-1 text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
