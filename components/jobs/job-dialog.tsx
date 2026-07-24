"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JOB_STATUSES } from "@/lib/constants";
import type { JobStatus } from "@/types";

export type JobRow = {
  _id: Id<"jobs">;
  title: string;
  status: JobStatus;
  scheduledFor?: number;
  address?: string;
  notes?: string;
  leadId?: Id<"leads">;
};

/** ms epoch → value for <input type="datetime-local"> (local time). */
function toLocalInput(ms?: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

type JobDialogProps = {
  mode: "create" | "edit";
  job?: JobRow;
};

export function JobDialog({ mode, job }: JobDialogProps) {
  const createJob = useMutation(api.jobs.create);
  const updateJob = useMutation(api.jobs.update);
  const leads = useQuery(api.leads.listForLink, {});

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(job?.title ?? "");
  const [status, setStatus] = useState<JobStatus>(job?.status ?? "scheduled");
  const [scheduledFor, setScheduledFor] = useState(
    toLocalInput(job?.scheduledFor),
  );
  const [address, setAddress] = useState(job?.address ?? "");
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [leadId, setLeadId] = useState<string>(job?.leadId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    setError(null);
    setPending(false);
    if (nextOpen) {
      setTitle(job?.title ?? "");
      setStatus(job?.status ?? "scheduled");
      setScheduledFor(toLocalInput(job?.scheduledFor));
      setAddress(job?.address ?? "");
      setNotes(job?.notes ?? "");
      setLeadId(job?.leadId ?? "");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Job title is required.");
      return;
    }
    const scheduledMs = scheduledFor
      ? new Date(scheduledFor).getTime()
      : undefined;
    const linkedLead = leadId ? (leadId as Id<"leads">) : undefined;

    setPending(true);
    try {
      if (mode === "create") {
        await createJob({
          title,
          status,
          scheduledFor: scheduledMs,
          address,
          notes,
          leadId: linkedLead,
        });
      } else if (job) {
        await updateJob({
          jobId: job._id,
          title,
          status,
          scheduledFor: scheduledMs,
          address,
          notes,
          // null clears the link; undefined would leave it unchanged.
          leadId: linkedLead ?? null,
        });
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New job
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New job" : "Edit job"}</DialogTitle>
          <DialogDescription>
            Scheduled or active work that field notes can attach to.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="job-title">Title</Label>
            <Input
              id="job-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Re-roof at 123 Main St"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="job-status">Status</Label>
              <select
                id="job-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as JobStatus)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {JOB_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-scheduled">Scheduled for</Label>
              <Input
                id="job-scheduled"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="job-address">Address</Label>
              <Input
                id="job-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="job-lead">Linked lead (optional)</Label>
              <select
                id="job-lead"
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">No linked lead</option>
                {(leads ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="job-notes">Notes</Label>
            <textarea
              id="job-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Scope, crew, gotchas…"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : mode === "create" ? (
                "Create job"
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
