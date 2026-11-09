"use client";

import { AlertTriangle, CloudOff, KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { QueuedNote } from "@/lib/offline/queue";
import { useFieldQueue } from "@/components/entry/field-queue-provider";

function describe(item: QueuedNote, running: boolean) {
  switch (item.status) {
    case "needs_pin":
      return {
        icon: <KeyRound className="h-3.5 w-3.5" />,
        text: `Waiting for ${item.memberName} to enter their PIN (Switch user → PIN)`,
        tone: "text-amber-800",
      };
    case "failed":
      return {
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        text: item.lastError ?? "The server rejected this note.",
        tone: "text-destructive",
      };
    case "sending":
      return {
        icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
        text: "Sending…",
        tone: "text-muted-foreground",
      };
    default:
      return item.attempts > 0
        ? {
            icon: <CloudOff className="h-3.5 w-3.5" />,
            text: "No signal — will send automatically",
            tone: "text-muted-foreground",
          }
        : {
            icon: running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudOff className="h-3.5 w-3.5" />
            ),
            text: running ? "Sending…" : "Waiting to send",
            tone: "text-muted-foreground",
          };
  }
}

/**
 * Notes saved on this phone that haven't reached the office yet. Shown on
 * both the PIN screen and the recorder so a worker always knows a note is
 * safe — and why it hasn't gone through.
 */
export function FieldQueueStatus() {
  const { runner, snapshot } = useFieldQueue();
  const { items, running, durable } = snapshot;

  if (items.length === 0 && durable) return null;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm" data-testid="field-queue">
      {!durable ? (
        <p className="flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This browser can&apos;t store notes offline (private browsing?). Keep
          this page open until your notes finish sending.
        </p>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium" data-testid="field-queue-count">
              {items.length} {items.length === 1 ? "note" : "notes"} saved on this
              phone, not sent yet
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={running}
              onClick={() => void runner.run({ force: true })}
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Send now
            </Button>
          </div>
          <ul className="space-y-1.5">
            {items.map((item) => {
              const d = describe(item, running);
              return (
                <li
                  key={item.clientUploadId}
                  className="flex items-start justify-between gap-2 rounded-md bg-background px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">
                      {item.memberName}
                      {item.jobTitle ? ` · ${item.jobTitle}` : ""} ·{" "}
                      {new Date(item.recordedAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {item.transcript ? ` · “${item.transcript.slice(0, 40)}${item.transcript.length > 40 ? "…" : ""}”` : ""}
                    </p>
                    <p className={`mt-0.5 flex items-center gap-1 text-xs ${d.tone}`}>
                      {d.icon}
                      <span>{d.text}</span>
                    </p>
                  </div>
                  {item.status === "failed" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="Discard this note"
                      onClick={() => {
                        if (
                          window.confirm(
                            "Discard this note? It hasn't reached the office and can't be recovered.",
                          )
                        ) {
                          void runner.discard(item.clientUploadId);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
