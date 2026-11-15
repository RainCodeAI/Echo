"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, ChevronDown, ClipboardCopy, Download, Loader2, Mail, PackageCheck, Share2, Undo2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatOrderCsv, formatOrderText } from "@/convex/lib/orderList";

const day = (ms: number) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
const today = () => new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

const errorText = (err: unknown) =>
  err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Something went wrong.";

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "job";
}

/**
 * One job's materials, merged across its notes: pick lines, send them to the
 * supply house (copy / share / email / CSV), then mark them ordered.
 */
export function JobOrderList({ jobId }: { jobId: Id<"jobs"> }) {
  const data = useQuery(api.materials.forJob, { jobId });
  const markOrdered = useMutation(api.materials.markOrdered);
  const undoOrder = useMutation(api.materials.undoOrder);
  // Unchecked keys (so lines added by new notes start checked).
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => (data?.toOrder ?? []).filter((l) => !unchecked.has(l.key)),
    [data, unchecked],
  );

  if (data === undefined) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const { job, toOrder, ordered, history } = data;
  const text = () =>
    formatOrderText({ jobTitle: job.title, address: job.address, companyName: data.companyName, date: today() }, selected);

  async function run(label: string, fn: () => Promise<unknown> | unknown, done?: string) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      if (done) {
        setFlash(done);
        setTimeout(() => setFlash((f) => (f === done ? null : f)), 2500);
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const none = selected.length === 0;

  return (
    <div className="space-y-4" data-testid="order-list">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <Link href="/dashboard/materials" className="text-xs text-muted-foreground hover:underline">
            ← All jobs
          </Link>
          <h2 className="text-xl font-semibold">{job.title}</h2>
          <p className="text-sm text-muted-foreground">
            {job.address ?? "No site address"} · {job.status.replace("_", " ")}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">To order</CardTitle>
          <CardDescription>
            Everything crews mentioned in this job&rsquo;s notes, merged. Untick anything you don&rsquo;t need.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {toOrder.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing to order. Materials crews mention in notes linked to this job show up here.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="to-order">
              {toOrder.map((l) => {
                const checked = !unchecked.has(l.key);
                const expanded = open.has(l.key);
                return (
                  <li key={l.key} className="px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-primary"
                        checked={checked}
                        aria-label={`Include ${l.name}`}
                        onChange={() => setUnchecked((s) => toggle(s, l.key))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className={`font-medium ${checked ? "" : "text-muted-foreground line-through"}`}>{l.name}</span>
                          <span className="text-sm font-semibold tabular-nums">{l.quantityLabel}</span>
                        </div>
                        {l.notes.length ? <p className="text-xs text-muted-foreground">{l.notes.join("; ")}</p> : null}
                        <button
                          type="button"
                          className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          aria-expanded={expanded}
                          onClick={() => setOpen((s) => toggle(s, l.key))}
                        >
                          From {l.sources.length === 1 ? "1 note" : `${l.sources.length} notes`}
                          <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                        {expanded ? (
                          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {l.sources.map((s, i) => (
                              <li key={`${s.noteId}-${i}`}>
                                <Link href={`/dashboard/notes/${s.noteId}`} className="text-foreground hover:underline">
                                  {s.noteTitle}
                                </Link>
                                {" · "}
                                {[s.crewName, day(s.recordedAt), s.quantityText || "no qty"].filter(Boolean).join(" · ")}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {toOrder.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground" data-testid="selected-count">
                {selected.length} of {toOrder.length} selected
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={none || !!busy}
                  onClick={() => void run("copy", () => navigator.clipboard.writeText(text()), "Copied")}
                >
                  <ClipboardCopy /> Copy list
                </Button>
                {canShare ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={none || !!busy}
                    onClick={() => void run("share", () => navigator.share({ title: `Materials: ${job.title}`, text: text() }))}
                  >
                    <Share2 /> Share
                  </Button>
                ) : null}
                {none ? (
                  <Button type="button" variant="outline" size="sm" disabled>
                    <Mail /> Email
                  </Button>
                ) : (
                  <a
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    href={`mailto:?subject=${encodeURIComponent(`Materials order: ${job.title}`)}&body=${encodeURIComponent(text())}`}
                  >
                    <Mail /> Email
                  </a>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={none || !!busy}
                  onClick={() =>
                    void run("csv", () => {
                      const blob = new Blob([formatOrderCsv(selected)], { type: "text/csv;charset=utf-8" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `materials-${slug(job.title)}-${new Date().toISOString().slice(0, 10)}.csv`;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                    })
                  }
                >
                  <Download /> CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={none || !!busy}
                  onClick={() =>
                    void run(
                      "order",
                      () =>
                        markOrdered({
                          jobId,
                          lines: selected.map((l) => ({ key: l.key, quantityLabel: l.quantityLabel })),
                        }),
                      "Marked as ordered",
                    )
                  }
                >
                  {busy === "order" ? <Loader2 className="animate-spin" /> : <PackageCheck />}
                  Mark {selected.length === toOrder.length ? "all" : selected.length} ordered
                </Button>
              </div>
            </div>
          ) : null}
          {flash ? (
            <p className="flex items-center gap-1 text-xs font-medium text-primary" role="status">
              <Check className="h-3.5 w-3.5" /> {flash}
            </p>
          ) : null}
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </CardContent>
      </Card>

      {history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Already ordered</CardTitle>
            <CardDescription>
              {ordered.length === 1 ? "1 item" : `${ordered.length} items`} covered. New notes asking for more show up above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2" data-testid="order-history">
              {history.map((o) => (
                <li key={o.orderId} className="rounded-lg border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      {o.createdByName ? ` · ${o.createdByName}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!!busy}
                      aria-label="Undo this order"
                      onClick={() => void run(`undo-${o.orderId}`, () => undoOrder({ orderId: o.orderId }))}
                    >
                      {busy === `undo-${o.orderId}` ? <Loader2 className="animate-spin" /> : <Undo2 />}
                      Undo
                    </Button>
                  </div>
                  <p className="text-muted-foreground">
                    {o.lines.map((l) => `${l.name} (${l.quantity})`).join(", ")}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
