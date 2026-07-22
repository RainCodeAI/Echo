"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { URGENCIES } from "@/lib/constants";
import type { Urgency } from "@/types";

type NoteOwnerFieldsProps = {
  noteId: Id<"voiceNotes">;
  ownerNote: string | undefined;
  urgency: Urgency | undefined;
  workerFlaggedUrgent: boolean | undefined;
};

export function NoteOwnerFields({
  noteId,
  ownerNote,
  urgency,
  workerFlaggedUrgent,
}: NoteOwnerFieldsProps) {
  const setOwnerNote = useMutation(api.voiceNotes.setOwnerNote);
  const setUrgency = useMutation(api.voiceNotes.setUrgency);
  const setWorkerFlaggedUrgent = useMutation(
    api.voiceNotes.setWorkerFlaggedUrgent,
  );

  const [noteDraft, setNoteDraft] = useState(ownerNote ?? "");
  const [urgencyDraft, setUrgencyDraft] = useState<Urgency>(
    urgency ?? "medium",
  );
  const [urgentDraft, setUrgentDraft] = useState(!!workerFlaggedUrgent);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNoteDraft(ownerNote ?? "");
  }, [ownerNote]);

  useEffect(() => {
    setUrgencyDraft(urgency ?? "medium");
  }, [urgency]);

  useEffect(() => {
    setUrgentDraft(!!workerFlaggedUrgent);
  }, [workerFlaggedUrgent]);

  async function handleSave() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await Promise.all([
        setOwnerNote({ noteId, ownerNote: noteDraft }),
        setUrgency({ noteId, urgency: urgencyDraft }),
        setWorkerFlaggedUrgent({
          noteId,
          workerFlaggedUrgent: urgentDraft,
        }),
      ]);
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="owner-note">Owner note</Label>
        <textarea
          id="owner-note"
          rows={3}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Internal follow-up, callback notes, etc."
          className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="urgency">Urgency</Label>
          <select
            id="urgency"
            value={urgencyDraft}
            onChange={(e) => setUrgencyDraft(e.target.value as Urgency)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {URGENCIES.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-3 sm:mt-6">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            checked={urgentDraft}
            onChange={(e) => setUrgentDraft(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Flag as urgent</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Keep this visible on the needs-attention list.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={pending} onClick={() => void handleSave()}>
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save details"
          )}
        </Button>
        {message ? (
          <span className="text-sm text-primary">{message}</span>
        ) : null}
        {error ? (
          <span className="text-sm text-destructive">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
