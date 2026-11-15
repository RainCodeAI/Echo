"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, ClipboardCopy, Loader2, Mail, MessageSquareText, RefreshCw, Sparkles, Trash2, Undo2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { mailtoHref, smsHref, smsSegments } from "@/convex/lib/customerUpdate";

type Tab = "text" | "email";
type Edits = { id: string; text: string; emailSubject: string; emailBody: string };

const errorText = (err: unknown) =>
  err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Something went wrong.";
const when = (ms: number) =>
  new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const VIA: Record<string, string> = { text: "by text", email: "by email", other: "" };

/**
 * "Send the homeowner an update": the AI drafts it from this job's recent
 * notes, the owner edits it and sends it from their own phone or email.
 * Echo never contacts the customer itself.
 */
export function CustomerUpdate({ noteId }: { noteId: Id<"voiceNotes"> }) {
  const data = useQuery(api.customerUpdates.forNote, { noteId });
  const requestDraft = useMutation(api.customerUpdates.requestDraft);
  const updateDraft = useMutation(api.customerUpdates.updateDraft);
  const markSent = useMutation(api.customerUpdates.markSent);
  const undoSent = useMutation(api.customerUpdates.undoSent);
  const discard = useMutation(api.customerUpdates.discard);

  const [tab, setTab] = useState<Tab>("text");
  const [edits, setEdits] = useState<Edits | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  if (data === undefined) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { job, customer, current, lastSentAt } = data;
  const draft = current?.status === "draft" ? current : null;
  // Local edits for this draft; otherwise what the server has.
  const values: Edits | null = draft
    ? edits?.id === draft.id
      ? edits
      : { id: draft.id, text: draft.text, emailSubject: draft.emailSubject, emailBody: draft.emailBody }
    : null;
  const dirty =
    !!draft && !!values && (values.text !== draft.text || values.emailSubject !== draft.emailSubject || values.emailBody !== draft.emailBody);

  const save = async () => {
    if (!draft || !values || !dirty) return;
    await updateDraft({
      updateId: draft.id,
      text: values.text,
      emailSubject: values.emailSubject,
      emailBody: values.emailBody,
    });
  };
  const edit = (patch: Partial<Edits>) => values && setEdits({ ...values, ...patch });
  const sendVia = (via: "text" | "email" | "other") =>
    void run(`send-${via}`, async () => {
      await save();
      await markSent({ updateId: draft!.id, via });
    });
  const start = () => void run("draft", () => requestDraft({ noteId }));

  return (
    <Card data-testid="customer-update">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="h-4 w-4 text-primary" />
          Customer update
        </CardTitle>
        <CardDescription>
          {job
            ? `A short progress update for ${customer?.name ?? "the customer"} on ${job.title}, written from this job's recent notes. You review it and send it from your own phone or email.`
            : "Link this note to a job to draft an update for its customer."}
        </CardDescription>
      </CardHeader>

      {job ? (
        <CardContent className="space-y-3">
          {!current || current.status === "failed" ? (
            <div className="space-y-2">
              {current?.status === "failed" ? (
                <p className="text-sm text-destructive" role="alert">{current.error ?? "Couldn't write the draft."}</p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {lastSentAt
                  ? `Covers notes since your last update (${when(lastSentAt)}).`
                  : "Covers this note and the job's other notes from the past week."}{" "}
                Prices, crew names and your private notes are left out.
              </p>
              <Button type="button" size="sm" onClick={start} disabled={!!busy}>
                {busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {current?.status === "failed" ? "Try again" : "Draft update"}
              </Button>
            </div>
          ) : current.status === "generating" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" /> Writing a draft from {current.noteCount === 1 ? "1 note" : `${current.noteCount} notes`}…
            </p>
          ) : current.status === "sent" ? (
            <div className="space-y-2">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-primary" role="status">
                <Check className="h-4 w-4" /> Sent {VIA[current.sentVia ?? "other"]} · {when(current.sentAt ?? current.createdAt)}
              </p>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                {current.sentVia === "email" ? current.emailBody : current.text}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => void run("undo", () => undoSent({ updateId: current.id }))}>
                  <Undo2 /> Not sent? Undo
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={start}>
                  {busy === "draft" ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft a new update
                </Button>
              </div>
            </div>
          ) : values ? (
            <div className="space-y-3">
              <div className="inline-flex rounded-md border p-0.5" role="tablist">
                {(["text", "email"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded px-3 py-1 text-xs font-medium ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {t === "text" ? "Text message" : "Email"}
                  </button>
                ))}
              </div>

              <p className="text-xs text-muted-foreground" data-testid="recipient">
                {tab === "text"
                  ? customer?.phone
                    ? `To ${customer.name} · ${customer.phone}`
                    : `No phone number on file for ${customer?.name ?? "this job's customer"}. Add one to the lead, or copy the text.`
                  : customer?.email
                    ? `To ${customer.name} · ${customer.email}`
                    : `No email on file for ${customer?.name ?? "this job's customer"}. Add one to the lead, or copy the text.`}
              </p>

              {tab === "text" ? (
                <div>
                  <textarea
                    aria-label="Text message"
                    value={values.text}
                    onChange={(e) => edit({ text: e.target.value })}
                    onBlur={() => void run("save", save)}
                    maxLength={640}
                    rows={5}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <p className="text-right text-xs text-muted-foreground">
                    {values.text.length} characters · {smsSegments(values.text) <= 1 ? "1 text" : `${smsSegments(values.text)} texts`}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    aria-label="Email subject"
                    value={values.emailSubject}
                    onChange={(e) => edit({ emailSubject: e.target.value })}
                    onBlur={() => void run("save", save)}
                    maxLength={120}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <textarea
                    aria-label="Email body"
                    value={values.emailBody}
                    onChange={(e) => edit({ emailBody: e.target.value })}
                    onBlur={() => void run("save", save)}
                    maxLength={4000}
                    rows={8}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {tab === "text" && customer?.phone ? (
                  <a
                    className={buttonVariants({ size: "sm" })}
                    href={smsHref(customer.phone, values.text)}
                    onClick={() => sendVia("text")}
                  >
                    <MessageSquareText /> Send from my phone
                  </a>
                ) : null}
                {tab === "email" && customer?.email ? (
                  <a
                    className={buttonVariants({ size: "sm" })}
                    href={mailtoHref(customer.email, values.emailSubject, values.emailBody)}
                    onClick={() => sendVia("email")}
                  >
                    <Mail /> Send from my email
                  </a>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void run("copy", async () => {
                      await navigator.clipboard.writeText(
                        tab === "text" ? values.text : `${values.emailSubject}\n\n${values.emailBody}`,
                      );
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                  }
                >
                  {copied ? <Check /> : <ClipboardCopy />} {copied ? "Copied" : "Copy"}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={() => sendVia("other")}>
                  <Check /> Mark as sent
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={start}>
                  <RefreshCw /> Redraft
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="Discard draft"
                  disabled={!!busy}
                  onClick={() => void run("discard", () => discard({ updateId: draft!.id }))}
                >
                  <Trash2 />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sending opens your phone&rsquo;s messages or your email app with this filled in, and marks the update as sent.
              </p>
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}
