"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Briefcase, MapPin } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Label } from "@/components/ui/label";
import {
  loadJobList,
  saveJobList,
  type CachedFieldJob,
  type FieldJobList,
  type PickedJob,
} from "@/lib/offline/job-cache";

type Props = {
  companyId: Id<"companies">;
  teamMemberId: Id<"teamMembers">;
  verificationToken: string;
  value: PickedJob | null;
  onChange: (job: PickedJob | null) => void;
  disabled?: boolean;
};

function timeLabel(job: CachedFieldJob) {
  if (job.status === "in_progress") return "in progress";
  if (job.scheduledFor === null) return "";
  return new Date(job.scheduledFor).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "Which job?" picker on the field entry page. Uses the live list when online
 * and the last list saved on this phone when not, so it works in dead zones.
 * Optional: "No job / not sure" leaves the note for the office to link.
 */
export function FieldJobPicker({
  companyId,
  teamMemberId,
  verificationToken,
  value,
  onChange,
  disabled,
}: Props) {
  const live = useQuery(api.jobs.listForField, {
    companyId,
    teamMemberId,
    verificationToken,
  });
  // Cached copy: read once on mount (client-only component).
  const [cached] = useState(() => loadJobList(companyId));

  useEffect(() => {
    if (live) saveJobList(companyId, live);
  }, [companyId, live]);

  const list: FieldJobList | null = live ?? cached;
  const usingCache = !live && !!cached;
  const all = list ? [...list.today, ...list.other] : [];
  const selected = value ? all.find((j) => j.id === value.id) : undefined;

  if (!list && live === undefined) {
    return (
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Briefcase className="h-3.5 w-3.5" />
          Which job?
        </Label>
        <div className="h-11 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }
  // No jobs set up at all: don't show an empty picker.
  if (all.length === 0 && !value) return null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="field-job" className="flex items-center gap-1.5">
        <Briefcase className="h-3.5 w-3.5" />
        Which job?
      </Label>
      <select
        id="field-job"
        value={value?.id ?? ""}
        disabled={disabled}
        onChange={(e) => {
          const job = all.find((j) => j.id === e.target.value);
          onChange(job ? { id: job.id, title: job.title } : null);
        }}
        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="">No job / not sure</option>
        {value && !selected ? (
          // Picked earlier but no longer in the list (e.g. completed since).
          <option value={value.id}>{value.title}</option>
        ) : null}
        {list && list.today.length > 0 ? (
          <optgroup label="Today">
            {list.today.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {timeLabel(j) ? ` — ${timeLabel(j)}` : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
        {list && list.other.length > 0 ? (
          <optgroup label="Other open jobs">
            {list.other.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title}
                {timeLabel(j) ? ` — ${timeLabel(j)}` : ""}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {selected?.address ? (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" />
          {selected.address}
        </p>
      ) : null}
      {usingCache ? (
        <p className="text-[11px] text-muted-foreground" data-testid="jobs-cached">
          Showing the job list saved on this phone (offline).
        </p>
      ) : null}
    </div>
  );
}
