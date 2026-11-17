"use client";

import { useState } from "react";
import { CheckCircle2, CircleHelp, Loader2, Smartphone, XCircle } from "lucide-react";

import { useFieldQueue } from "@/components/entry/field-queue-provider";
import { gatherPhoneCheck, phoneChecks, type PhoneCheck as Check } from "@/lib/field-device";

/**
 * "Phone check": what this phone can and can't do for Echo, in plain words.
 * Crews open it when something's off and screenshot it for the office.
 */
export function PhoneCheck() {
  const { snapshot } = useFieldQueue();
  const [rows, setRows] = useState<Check[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setRows(phoneChecks(await gatherPhoneCheck(snapshot.items.length)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="rounded-md border px-3 py-2 text-sm"
      data-testid="phone-check"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) void load();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground">
        <Smartphone className="h-4 w-4" aria-hidden="true" />
        Phone check
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      </summary>
      {rows ? (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex gap-2" data-ok={String(r.ok)}>
              {r.ok === true ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="OK" />
              ) : r.ok === false ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Problem" />
              ) : (
                <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="Note" />
              )}
              <span>
                <span className="font-medium">{r.label}:</span>{" "}
                <span className="text-muted-foreground">{r.detail}</span>
              </span>
            </li>
          ))}
          <li className="pt-1 text-xs text-muted-foreground">
            Something wrong? Screenshot this and send it to the office.
          </li>
        </ul>
      ) : null}
    </details>
  );
}
