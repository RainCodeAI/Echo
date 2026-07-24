"use client";

import { useQuery } from "convex/react";
import { Briefcase } from "lucide-react";

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
import { JobDialog } from "@/components/jobs/job-dialog";
import type { JobStatus } from "@/types";

const JOB_STATUS_META: Record<JobStatus, { label: string; badgeClass: string }> = {
  scheduled: {
    label: "Scheduled",
    badgeClass: "bg-sky-100 text-sky-700 ring-sky-600/20",
  },
  in_progress: {
    label: "In progress",
    badgeClass: "bg-amber-100 text-amber-700 ring-amber-600/20",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-100 text-emerald-700 ring-emerald-600/20",
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-slate-100 text-slate-500 ring-slate-400/20",
  },
};

export default function JobsPage() {
  const jobs = useQuery(api.jobs.list, {});

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Jobs</h2>
          <p className="text-sm text-muted-foreground">
            Scheduled and active work that field notes can attach to.
          </p>
        </div>
        <JobDialog mode="create" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All jobs</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
              <Briefcase className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">No jobs yet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Create a job, then link field notes to it from a note’s detail
                page.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {jobs.map((job) => {
                const meta = JOB_STATUS_META[job.status];
                return (
                  <li
                    key={job._id}
                    className="flex items-start justify-between gap-3 py-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{job.title}</span>
                        <Badge className={meta.badgeClass}>{meta.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {job.scheduledFor
                          ? new Date(job.scheduledFor).toLocaleString()
                          : "Not scheduled"}
                        {job.address ? ` · ${job.address}` : ""}
                      </p>
                      {job.notes ? (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {job.notes}
                        </p>
                      ) : null}
                    </div>
                    <JobDialog
                      mode="edit"
                      job={{
                        _id: job._id,
                        title: job.title,
                        status: job.status,
                        scheduledFor: job.scheduledFor,
                        address: job.address,
                        notes: job.notes,
                        leadId: job.leadId,
                      }}
                    />
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
