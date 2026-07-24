"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AudioLines, AlertTriangle, ChevronRight, Search, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDurationShort } from "@/lib/utils";
import {
  AI_STATUS_MAP,
  URGENCY_MAP,
  VOICE_NOTE_STATUSES,
  VOICE_NOTE_STATUS_MAP,
} from "@/lib/constants";
import type { VoiceNoteStatus } from "@/types";

/**
 * Owner notes list — newest first, with status/crew/urgent filters and
 * transcript search. Links into detail/review.
 */
export default function NotesPage() {
  const [statusFilter, setStatusFilter] = useState<VoiceNoteStatus | "">("");
  const [crewFilter, setCrewFilter] = useState<Id<"teamMembers"> | "">("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce the search box so we don't re-query on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const crew = useQuery(api.teamMembers.list, {});
  const notes = useQuery(api.voiceNotes.listForCompany, {
    limit: 50,
    status: statusFilter || undefined,
    teamMemberId: crewFilter || undefined,
    urgentOnly: urgentOnly || undefined,
    search: search || undefined,
  });

  const hasActiveFilters = useMemo(
    () => !!(statusFilter || crewFilter || urgentOnly || search),
    [statusFilter, crewFilter, urgentOnly, search],
  );

  function clearFilters() {
    setStatusFilter("");
    setCrewFilter("");
    setUrgentOnly(false);
    setSearchInput("");
    setSearch("");
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Voice notes</h2>
        <p className="text-sm text-muted-foreground">
          Field captures from crew PIN entry. Filter, search, then open a note
          to review, flag, or archive.
        </p>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div>
            <CardTitle className="text-base">Recent notes</CardTitle>
            <CardDescription>
              Newest first. Transcript and audio are saved even before AI runs.
            </CardDescription>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search transcript, summary, title…"
                className="pl-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as VoiceNoteStatus | "")
                }
                aria-label="Filter by status"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All statuses</option>
                {VOICE_NOTE_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>

              <select
                value={crewFilter}
                onChange={(e) =>
                  setCrewFilter(e.target.value as Id<"teamMembers"> | "")
                }
                aria-label="Filter by crew member"
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All crew</option>
                {(crew ?? []).map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={urgentOnly}
                  onChange={(e) => setUrgentOnly(e.target.checked)}
                />
                Urgent
              </label>

              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                >
                  <X className="h-4 w-4" />
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {notes === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : notes.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
              <AudioLines className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">
                {hasActiveFilters ? "No matching notes" : "No notes yet"}
              </h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "Try clearing filters or widening your search."
                  : "Add a crew member under Crew, open the field entry link, enter a PIN, and record a note."}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {notes.map((note) => {
                const urgency = note.urgency
                  ? URGENCY_MAP[note.urgency]
                  : null;
                const ai = AI_STATUS_MAP[note.aiStatus];
                const status = VOICE_NOTE_STATUS_MAP[note.status];
                const preview =
                  note.aiSummary?.trim() ||
                  note.rawTranscript?.trim() ||
                  (note.audioStorageId
                    ? "(audio only — no transcript yet)"
                    : "—");
                const title = note.aiTitle || note.crewName;

                return (
                  <li key={note._id}>
                    <Link
                      href={`/dashboard/notes/${note._id}`}
                      className="flex items-start justify-between gap-3 py-4 transition-colors hover:bg-muted/40 -mx-2 rounded-lg px-2"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{title}</span>
                          <Badge className={status.badgeClass}>
                            {status.label}
                          </Badge>
                          {note.workerFlaggedUrgent ? (
                            <Badge variant="destructive" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Urgent
                            </Badge>
                          ) : null}
                          {urgency ? (
                            <Badge className={urgency.badgeClass}>
                              {urgency.label}
                            </Badge>
                          ) : null}
                          <Badge className={ai.badgeClass}>{ai.label}</Badge>
                        </div>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {preview}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {note.crewName} ·{" "}
                          {new Date(note.recordedAt).toLocaleString()}
                          {note.audioDurationMs
                            ? ` · ${formatDurationShort(note.audioDurationMs)}`
                            : ""}
                          {note.audioStorageId ? " · audio" : ""}
                          {note.leadName ? ` · ${note.leadName}` : ""}
                          {note.jobTitle ? ` · ${note.jobTitle}` : ""}
                        </p>
                      </div>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
                    </Link>
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
