"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  AudioLines,
  Bot,
  CheckCircle2,
  QrCode,
  UsersRound,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEntryUrl } from "@/hooks/use-entry-url";

/**
 * Owner overview — pulse counts + shortcuts into notes and crew entry.
 */
export default function DashboardOverviewPage() {
  const stats = useQuery(api.voiceNotes.dashboardStats, {});
  const recent = useQuery(api.voiceNotes.listForCompany, { limit: 5 });
  const { entryUrl, isLoading: entryLoading } = useEntryUrl();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Welcome to Echo</h2>
        <p className="text-sm text-muted-foreground">
          Capture field voice notes, review structured materials and actions,
          and keep jobs moving.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Needs review"
          value={stats?.needsReview}
          loading={stats === undefined}
        />
        <StatCard
          label="Urgent"
          value={stats?.urgent}
          loading={stats === undefined}
          emphasis
        />
        <StatCard
          label="Active crew"
          value={stats?.activeCrew}
          loading={stats === undefined}
        />
        <StatCard
          label="AI pending / failed"
          value={
            stats
              ? `${stats.aiPending}${stats.aiFailed ? ` / ${stats.aiFailed}` : ""}`
              : undefined
          }
          loading={stats === undefined}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AudioLines className="h-4 w-4 text-primary" />
              Voice notes
            </CardTitle>
            <CardDescription>
              Review transcripts, AI structure, and urgency from the field.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button asChild>
              <Link href="/dashboard/notes">
                Open notes <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>

            {recent === undefined ? (
              <Skeleton className="h-20 w-full" />
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No notes yet. Share the field entry link with crew to get the
                first capture.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recent.map((n) => (
                  <li key={n._id}>
                    <Link
                      href={`/dashboard/notes/${n._id}`}
                      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-muted/40"
                    >
                      <span className="min-w-0 truncate">
                        {n.workerFlaggedUrgent ? (
                          <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-destructive" />
                        ) : null}
                        {n.aiTitle || n.crewName}
                        <span className="text-muted-foreground">
                          {" "}
                          · {new Date(n.recordedAt).toLocaleDateString()}
                        </span>
                      </span>
                      {n.aiStatus === "completed" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      ) : n.aiStatus === "failed" ? (
                        <Bot className="h-4 w-4 shrink-0 text-destructive" />
                      ) : (
                        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="h-4 w-4 text-primary" />
              Field entry
            </CardTitle>
            <CardDescription>
              Share a PIN + link (or QR) so crews can record without Clerk
              accounts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild>
              <Link href="/dashboard/team">
                Manage crew &amp; PINs <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {entryLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : entryUrl ? (
              <p className="break-all rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                <QrCode className="mr-1 inline h-3.5 w-3.5" />
                {entryUrl}
              </p>
            ) : null}
            {stats !== undefined ? (
              <p className="text-xs text-muted-foreground">
                {stats.totalNotes} total note{stats.totalNotes === 1 ? "" : "s"}
                {stats.reviewed ? ` · ${stats.reviewed} reviewed` : ""}
                {stats.archived ? ` · ${stats.archived} archived` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  emphasis,
}: {
  label: string;
  value: string | number | undefined;
  loading?: boolean;
  emphasis?: boolean;
}) {
  return (
    <Card className={emphasis ? "border-orange-200/80" : undefined}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">
          {loading ? <Skeleton className="h-9 w-12" /> : (value ?? "—")}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}
