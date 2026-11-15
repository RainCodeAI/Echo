"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { KeyRound, Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

/**
 * Owner setting: 4- or 6-digit crew PINs. Switching retires PINs of the other
 * length at once, so the owner sees who needs a new PIN before confirming.
 */
export function PinLengthSetting() {
  const me = useQuery(api.users.current, {});
  const company = useQuery(api.companies.current, {});
  const members = useQuery(api.teamMembers.list, {});
  const setPinLength = useMutation(api.companies.setPinLength);
  const [confirming, setConfirming] = useState<4 | 6 | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!company || !members || me?.role !== "owner") return null;
  const current: 4 | 6 = company.pinLength === 6 ? 6 : 4;
  const target: 4 | 6 = current === 6 ? 4 : 6;
  const active = members.filter((m) => m.isActive);
  const affected = active.filter((m) => (m.pinLength === 6 ? 6 : 4) !== target);
  const waiting = active.filter((m) => m.needsNewPin);

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm" data-testid="pin-length">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <KeyRound className="h-4 w-4 text-primary" /> Crew PINs: {current} digits
        </p>
        {!confirming ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(target)}>
            Switch to {target} digits
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground">
        {current === 4
          ? "6-digit PINs are much harder to guess on a public entry link (a million combinations instead of ten thousand)."
          : "6-digit PINs are on: a million combinations, so guessing is impractical."}
      </p>
      {waiting.length > 0 ? (
        <p className="text-amber-800" role="status">
          {waiting.length === 1 ? "1 crew member needs" : `${waiting.length} crew members need`} a new {current}-digit PIN
          before they can sign in: use Edit on their row below.
        </p>
      ) : null}
      {confirming ? (
        <div className="space-y-2 rounded-md border bg-background p-3" data-testid="pin-length-confirm">
          <p>
            Switch to {confirming}-digit PINs?{" "}
            {affected.length === 0
              ? "No active crew members are affected."
              : `${affected.length === 1 ? "1 crew member's" : `${affected.length} crew members'`} current PIN will stop working right away until you give them a new ${confirming}-digit PIN.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await setPinLength({ length: confirming });
                  setConfirming(null);
                } catch (err) {
                  setError(err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : null} Switch to {confirming} digits
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
    </div>
  );
}
