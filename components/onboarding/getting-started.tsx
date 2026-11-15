"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Check, Copy, ExternalLink, Loader2, Printer, Sparkles, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamMemberDialog } from "@/components/team/team-member-dialog";
import { useEntryUrl } from "@/hooks/use-entry-url";
import type { StepId } from "@/convex/lib/onboarding";

const COPY: Record<StepId, { title: string; body: string }> = {
  profile: { title: "Name your company and pick your trade", body: "Crews see your name, and the AI uses your trade to read notes better." },
  crew: { title: "Add your first crew member", body: "Each person gets a 4-digit PIN. No app, no account, no per-seat price." },
  share: { title: "Put the crew link where crews will see it", body: "Print the QR poster for the shop or a sticker for the truck, or text the link." },
  firstNote: {
    title: "Get the first field note",
    body: "Have a crew member scan the code, enter their PIN and talk for 30 seconds. Or open the crew page and try it yourself.",
  },
  alerts: { title: "Turn on urgent alerts (optional)", body: "Get a text or email within a minute when a crew flags something urgent." },
};

/** Dashboard home: setup checklist for new workspaces (owner only). */
export function GettingStarted() {
  const status = useQuery(api.onboarding.status, {});
  const { entryUrl } = useEntryUrl();
  const markShared = useMutation(api.onboarding.markShared);
  const setDismissed = useMutation(api.onboarding.setDismissed);
  const createSample = useMutation(api.onboarding.createSampleNote);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!status || !status.isOwner || status.allRequiredDone) return null;

  if (status.dismissed) {
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground underline"
        onClick={() => void setDismissed({ dismissed: false })}
      >
        Show setup checklist ({status.requiredDone} of {status.requiredTotal} done)
      </button>
    );
  }

  const actions: Record<StepId, React.ReactNode> = {
    profile: (
      <Link href="/dashboard/settings" className={buttonVariants({ size: "sm", variant: "outline" })}>
        Open settings
      </Link>
    ),
    crew: <TeamMemberDialog mode="create" trigger={<Button size="sm" variant="outline">Add crew member</Button>} />,
    share: (
      <>
        <Link href="/dashboard/poster" className={buttonVariants({ size: "sm", variant: "outline" })}>
          <Printer /> Print QR poster
        </Link>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!entryUrl}
          onClick={async () => {
            if (!entryUrl) return;
            await navigator.clipboard.writeText(entryUrl);
            setCopied(true);
            await markShared({});
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy crew link"}
        </Button>
      </>
    ),
    firstNote: (
      <>
        {entryUrl ? (
          <a href={entryUrl} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
            <ExternalLink /> Open crew page
          </a>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy === "sample"}
          onClick={async () => {
            setBusy("sample");
            try {
              const id = await createSample({});
              router.push(`/dashboard/notes/${id}`);
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "sample" ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {status.sampleNoteId ? "Open the sample note" : "See a sample note"}
        </Button>
      </>
    ),
    alerts: (
      <Link href="/dashboard/settings" className={buttonVariants({ size: "sm", variant: "outline" })}>
        Set up alerts
      </Link>
    ),
  };

  const next = status.steps.find((s) => !s.done && !s.optional)?.id;

  return (
    <Card data-testid="getting-started">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Get set up</CardTitle>
          <CardDescription>
            {status.requiredDone} of {status.requiredTotal} done. About 10 minutes, then your crews can start recording.
          </CardDescription>
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="Hide setup checklist" onClick={() => void setDismissed({ dismissed: true })}>
          <X />
        </Button>
      </CardHeader>
      <CardContent>
        <div
          className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={status.requiredTotal}
          aria-valuenow={status.requiredDone}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${(status.requiredDone / status.requiredTotal) * 100}%` }} />
        </div>
        <ol className="space-y-3">
          {status.steps.map((step, i) => (
            <li key={step.id} className="flex gap-3" data-testid={`step-${step.id}`} data-done={step.done}>
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done ? "bg-primary text-primary-foreground" : "border text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="h-3.5 w-3.5" aria-label="Done" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}>{COPY[step.id].title}</p>
                {!step.done ? (
                  <>
                    <p className="text-sm text-muted-foreground">{COPY[step.id].body}</p>
                    {step.id === next || step.optional ? <div className="mt-2 flex flex-wrap gap-2">{actions[step.id]}</div> : null}
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
