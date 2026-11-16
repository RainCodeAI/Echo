"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ListChecks } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AssigneeSelect, type AssigneeRef } from "@/components/tasks/assignee-select";

type Filter =
  | { kind: "all" }
  | { kind: "unassigned" }
  | { kind: "person"; ref: AssigneeRef };

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-red-100 text-red-800 hover:bg-red-100",
  medium: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  low: "bg-slate-100 text-slate-700 hover:bg-slate-100",
};

function age(ms: number) {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/**
 * Every open action item across notes, in one list: tick done, reassign,
 * filter by person, jump to the note it came from.
 */
export default function TasksPage() {
  const [filterKey, setFilterKey] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const people = useQuery(api.tasks.people, {});

  const filter: Filter =
    filterKey === "all"
      ? { kind: "all" }
      : filterKey === "unassigned"
        ? { kind: "unassigned" }
        : {
            kind: "person",
            ref: { kind: filterKey.split(":")[0] as AssigneeRef["kind"], id: filterKey.split(":")[1] },
          };
  const tasks = useQuery(api.tasks.list, { filter, includeRecentlyDone: showDone });
  const setCompleted = useMutation(api.voiceNotes.setActionItemCompleted);
  const setAssignee = useMutation(api.voiceNotes.setActionItemAssignee);
  const [error, setError] = useState<string | null>(null);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not update."));
  };

  const openCount = tasks?.filter((t) => !t.completed).length ?? 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Action items</h2>
        <p className="text-sm text-muted-foreground">
          Every open action item from your crews&apos; notes, in one place. High
          priority first, then the ones waiting longest.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base" data-testid="task-count">
              {tasks === undefined ? "Loading…" : `${openCount} open`}
            </CardTitle>
            <CardDescription>Assigning or ticking here updates the note too.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Show tasks for"
              value={filterKey}
              onChange={(e) => setFilterKey(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-sm"
            >
              <option value="all">Everyone</option>
              <option value="unassigned">Unassigned</option>
              {(people ?? []).map((p) => (
                <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>
                  {p.name}
                  {p.kind === "user" ? " (office)" : ""}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={showDone}
                onChange={(e) => setShowDone(e.target.checked)}
              />
              Done this week
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
          {tasks === undefined ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-10 text-center">
              <ListChecks className="mx-auto h-9 w-9 text-muted-foreground/50" />
              <p className="mt-3 font-medium">Nothing open here</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Action items the AI pulls out of field notes show up here.
              </p>
            </div>
          ) : (
            <ul className="divide-y" data-testid="task-list">
              {tasks.map((t) => (
                <li
                  key={`${t.noteId}:${t.index}`}
                  className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 sm:flex-nowrap"
                >
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-input"
                    aria-label={`Mark "${t.title}" done`}
                    checked={t.completed}
                    onChange={(e) =>
                      run(
                        setCompleted({
                          noteId: t.noteId as Id<"voiceNotes">,
                          index: t.index,
                          completed: e.target.checked,
                          expectedTitle: t.title,
                        }),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-medium ${t.completed ? "text-muted-foreground line-through" : ""}`}>
                        {t.title}
                      </span>
                      {t.priority && !t.completed ? (
                        <Badge className={PRIORITY_BADGE[t.priority]}>{t.priority}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.dueHint ? `${t.dueHint} · ` : ""}
                      <Link href={`/dashboard/notes/${t.noteId}`} className="underline-offset-2 hover:underline">
                        {t.noteTitle}
                      </Link>
                      {t.jobTitle ? ` · ${t.jobTitle}` : ""}
                      {t.crewName ? ` · from ${t.crewName}` : ""} · {age(t.createdAt)}
                    </p>
                  </div>
                  <div className="w-full pl-7 sm:w-auto sm:pl-0">
                  <AssigneeSelect
                    label={`Assign "${t.title}"`}
                    value={t.assignee}
                    hint={t.assigneeHint}
                    disabled={t.completed}
                    onChange={(next) =>
                      run(
                        setAssignee({
                          noteId: t.noteId as Id<"voiceNotes">,
                          index: t.index,
                          expectedTitle: t.title,
                          assignee: next,
                        }),
                      )
                    }
                  />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
