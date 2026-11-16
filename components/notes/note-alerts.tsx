"use client";

import { useQuery } from "convex/react";
import { BellRing } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const STATUS_TEXT: Record<string, string> = {
  sent: "sent",
  failed: "failed",
  not_configured: "not set up on the server",
  skipped: "skipped",
};

/** "Alerted by text to •••• 4567 at 10:42" — the note's urgent-alert history. */
export function NoteAlerts({ noteId }: { noteId: Id<"voiceNotes"> }) {
  const alerts = useQuery(api.alerts.listForNote, { noteId });
  if (!alerts || alerts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <ul className="space-y-0.5">
        {alerts.map((a) => (
          <li key={a.id}>
            Urgent alert {a.status === "skipped" ? "" : `by ${a.channel === "sms" ? "text" : "email"} to ${a.recipient} `}
            {STATUS_TEXT[a.status] ?? a.status}
            {" · "}
            {new Date(a.createdAt).toLocaleString([], { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
            {a.detail ? ` — ${a.detail}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
