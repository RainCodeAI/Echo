"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, ShieldCheck } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

/**
 * The workspace owner accepts the current Terms + Privacy Policy before using
 * the dashboard (again when the version changes). Office members aren't
 * asked: the owner accepts for the business.
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const status = useQuery(api.privacy.status, {});
  const accept = useMutation(api.privacy.acceptTerms);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status || !status.isOwner || status.termsAccepted) return <>{children}</>;

  const renewing = !!status.termsAcceptedAt;
  return (
    <div className="flex min-h-full items-center justify-center p-4" data-testid="terms-gate">
      <div className="w-full max-w-lg space-y-4 rounded-lg border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">{renewing ? "We updated our terms" : "Before you start"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Echo stores your crews&rsquo; recordings, photos and notes, and the customer details you add, so your office can
          use them. Recordings are transcribed and summarized by an AI service. You can export or delete your data at any
          time from Settings.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Crews see a recording notice before their first note.</li>
          <li>You&rsquo;re responsible for getting consent to record people and to message your customers.</li>
          <li>AI output can be wrong. Check it before relying on it.</li>
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-primary"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="underline">Terms of Service</Link> and{" "}
            <Link href="/privacy" target="_blank" className="underline">Privacy Policy</Link> on behalf of{" "}
            {status.companyName || "my business"}.
          </span>
        </label>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <Button
          type="button"
          className="w-full"
          disabled={!checked || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await accept({ version: status.termsVersion });
            } catch (err) {
              setError(err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Try again.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Continue
        </Button>
      </div>
    </div>
  );
}
