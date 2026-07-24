"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@/components/ui/label";

type NoteLinksProps = {
  noteId: Id<"voiceNotes">;
  leadId?: Id<"leads">;
  jobId?: Id<"jobs">;
};

export function NoteLinks({ noteId, leadId, jobId }: NoteLinksProps) {
  const leads = useQuery(api.leads.listForLink, {});
  const jobs = useQuery(api.jobs.listForLink, {});
  const setLinks = useMutation(api.voiceNotes.setLinks);

  const [pending, setPending] = useState<"lead" | "job" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changeLead(value: string) {
    setPending("lead");
    setError(null);
    try {
      await setLinks({
        noteId,
        leadId: value ? (value as Id<"leads">) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update link.");
    } finally {
      setPending(null);
    }
  }

  async function changeJob(value: string) {
    setPending("job");
    setError(null);
    try {
      await setLinks({
        noteId,
        jobId: value ? (value as Id<"jobs">) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update link.");
    } finally {
      setPending(null);
    }
  }

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="link-lead" className="flex items-center gap-2">
            Lead
            {pending === "lead" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
          </Label>
          <select
            id="link-lead"
            value={leadId ?? ""}
            disabled={pending !== null || leads === undefined}
            onChange={(e) => void changeLead(e.target.value)}
            className={selectClass}
          >
            <option value="">Not linked</option>
            {(leads ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="link-job" className="flex items-center gap-2">
            Job
            {pending === "job" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
          </Label>
          <select
            id="link-job"
            value={jobId ?? ""}
            disabled={pending !== null || jobs === undefined}
            onChange={(e) => void changeJob(e.target.value)}
            className={selectClass}
          >
            <option value="">Not linked</option>
            {(jobs ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
