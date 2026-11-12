"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, Loader2, Undo2, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { classifySuggestion, describeSuggestion } from "@/convex/lib/jobUpdates";

type Suggestion = {
  field: string;
  value: string;
  rationale?: string;
  appliedAt?: number;
  dismissedAt?: number;
};

type JobInfo = {
  id: string;
  title: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduledFor: number | null;
  address: string | null;
} | null;

const statusLabel = (s: string) => s.replace("_", " ");
const when = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "not set";

/**
 * AI-suggested changes to the linked job, applicable in one click (with undo).
 * Dates are confirmed in a date/time box first, converted in this browser's
 * timezone, so a wrong guess is never applied blindly.
 */
export function SuggestedJobUpdates({
  noteId,
  suggestions,
  job,
}: {
  noteId: Id<"voiceNotes">;
  suggestions: Suggestion[];
  job: JobInfo;
}) {
  const apply = useMutation(api.jobUpdates.apply);
  const undo = useMutation(api.jobUpdates.undo);
  const dismiss = useMutation(api.jobUpdates.dismiss);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<number, string>>({});

  async function run(i: number, fn: () => Promise<unknown>) {
    setPending(i);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Could not update.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div data-testid="job-suggestions">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Suggested job updates{job ? ` · ${job.title}` : ""}
      </p>
      <ul className="space-y-1.5 text-sm">
        {suggestions.map((s, i) => {
          const c = classifySuggestion(s);
          const target = { noteId, index: i, expectedField: s.field, expectedValue: s.value };
          const busy = pending === i;
          const dateValue = dates[i] ?? (c.kind === "scheduledFor" ? c.localDateTime : "");
          return (
            <li
              key={`${s.field}-${i}`}
              className={`rounded-md border px-3 py-2 ${s.dismissedAt ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{describeSuggestion(s)}</p>
                  {job && c.kind === "status" ? (
                    <p className="text-xs text-muted-foreground">
                      Now: {statusLabel(job.status)}
                    </p>
                  ) : null}
                  {job && c.kind === "address" ? (
                    <p className="text-xs text-muted-foreground">Now: {job.address ?? "not set"}</p>
                  ) : null}
                  {job && c.kind === "scheduledFor" ? (
                    <p className="text-xs text-muted-foreground">Now: {when(job.scheduledFor)}</p>
                  ) : null}
                  {s.rationale ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">“{s.rationale}”</p>
                  ) : null}
                </div>

                {s.appliedAt ? (
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-xs font-medium text-primary">
                      <Check className="h-3.5 w-3.5" /> Applied
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(i, () => undo(target))}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                      Undo
                    </Button>
                  </div>
                ) : s.dismissedAt ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(i, () => dismiss({ ...target, dismissed: false }))}
                  >
                    Restore
                  </Button>
                ) : c.kind === "unsupported" ? (
                  <span className="text-xs text-muted-foreground">{c.reason}</span>
                ) : !job ? (
                  <span className="text-xs text-muted-foreground">Link a job below to apply</span>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {c.kind === "scheduledFor" ? (
                      <input
                        type="datetime-local"
                        aria-label="Confirm new date and time"
                        value={dateValue}
                        onChange={(e) => setDates((d) => ({ ...d, [i]: e.target.value }))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      />
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || (c.kind === "scheduledFor" && !dateValue)}
                      onClick={() =>
                        void run(i, () =>
                          apply({
                            ...target,
                            scheduledForMs:
                              c.kind === "scheduledFor" ? new Date(dateValue).getTime() : undefined,
                          }),
                        )
                      }
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Apply
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Dismiss suggestion"
                      disabled={busy}
                      onClick={() => void run(i, () => dismiss({ ...target, dismissed: true }))}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
