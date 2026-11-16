"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2, OctagonX } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const money = (micros: number) =>
  (micros / 1_000_000).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const monthLabel = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

const LEVEL = {
  ok: { label: "Within limit", icon: CheckCircle2, bar: "bg-primary", text: "text-primary" },
  warning: { label: "Nearing limit", icon: AlertTriangle, bar: "bg-amber-500", text: "text-amber-700" },
  exceeded: { label: "Limit reached", icon: OctagonX, bar: "bg-destructive", text: "text-destructive" },
} as const;

/** Settings → AI usage: this month's estimated spend against the workspace's limit. */
export function AiUsageCard() {
  const s = useQuery(api.aiUsage.summary, {});

  if (s === undefined) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    );
  }

  const meta = LEVEL[s.level];
  const budgetMicros = s.budgetUsd * 1_000_000;
  const pct = budgetMicros > 0 ? Math.min(100, (s.spentMicros / budgetMicros) * 100) : 100;
  const Icon = meta.icon;

  return (
    <Card data-testid="ai-usage">
      <CardHeader>
        <CardTitle>AI usage</CardTitle>
        <CardDescription>
          Transcription, note summaries and customer drafts this month (resets on the 1st, UTC).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <p>
            <span className="text-2xl font-semibold tabular-nums">{money(s.spentMicros)}</span>
            <span className="text-sm text-muted-foreground"> of {money(budgetMicros)} limit</span>
          </p>
          <p className={`flex items-center gap-1 text-sm font-medium ${meta.text}`} data-testid="ai-usage-level">
            <Icon className="h-4 w-4" aria-hidden="true" /> {meta.label}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="AI spend this month"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-valuetext={`${money(s.spentMicros)} of ${money(budgetMicros)}`}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.max(pct, s.spentMicros > 0 ? 2 : 0)}%` }} />
        </div>
        {s.message ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{s.message}</p>
        ) : s.level === "warning" ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Over 80% of this month&rsquo;s AI limit is used. When it&rsquo;s reached, new notes are still saved but
            aren&rsquo;t transcribed or summarized until next month.
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {[
            ["Notes summarized", s.thisMonth.notes],
            ["Audio minutes", s.thisMonth.audioMinutes],
            ["Customer drafts", s.thisMonth.customerUpdates],
            ["Skipped (limit)", s.thisMonth.skippedNotes],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        {s.history.length > 1 ? (
          <table className="w-full text-sm">
            <caption className="sr-only">AI spend by month</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="font-normal">Month</th>
                <th className="text-right font-normal">Notes</th>
                <th className="text-right font-normal">Estimated spend</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {s.history.map((h) => (
                <tr key={h.month} className="border-t">
                  <td className="py-1">{monthLabel(h.month)}</td>
                  <td className="py-1 text-right">{h.notes}</td>
                  <td className="py-1 text-right">{money(h.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Estimates from published per-minute and per-token prices. Need a higher limit? Contact support.
        </p>
      </CardContent>
    </Card>
  );
}

/** Dashboard home: only shows when the limit is close or reached. */
export function AiUsageBanner() {
  const s = useQuery(api.aiUsage.summary, {});
  if (!s || s.level === "ok") return null;
  const exceeded = s.level === "exceeded";
  return (
    <div
      role={exceeded ? "alert" : "status"}
      data-testid="ai-usage-banner"
      className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${
        exceeded ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      {exceeded ? <OctagonX className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <p>
        {exceeded
          ? s.message
          : `You've used ${money(s.spentMicros)} of this month's ${money(s.budgetUsd * 1_000_000)} AI limit.`}{" "}
        <Link href="/dashboard/settings" className="underline">See usage</Link>
      </p>
    </div>
  );
}
