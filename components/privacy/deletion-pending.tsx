"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { Loader2, LogOut, Trash2, Undo2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ExportSection } from "@/components/settings/data-controls";

export type PendingDeletion = {
  companyName: string;
  isOwner: boolean;
  requestedAt: number;
  requestedByName: string | null;
  scheduledFor: number | null;
  started: boolean;
};

const errorText = (err: unknown) =>
  err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Something went wrong.";

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Shown instead of the dashboard while the workspace waits to be deleted.
 * The owner can cancel or take an export; everyone else can only sign out.
 */
export function DeletionPending({ pending }: { pending: PendingDeletion }) {
  const cancel = useMutation(api.privacy.cancelDeletion);
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canCancel = pending.isOwner && !pending.started;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4" data-testid="deletion-pending">
      <div className="w-full max-w-lg space-y-5 rounded-lg border bg-background p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 text-destructive" aria-hidden="true" />
          <h1 className="text-lg font-semibold">
            {pending.started ? `${pending.companyName} is being deleted` : `${pending.companyName} is scheduled for deletion`}
          </h1>
        </div>

        {pending.started ? (
          <p className="text-sm text-muted-foreground">Its data is being removed now. This can no longer be cancelled.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {pending.requestedByName ? `${pending.requestedByName} deleted this workspace` : "This workspace was deleted"} on{" "}
            {when(pending.requestedAt)}. Nobody, including crews, can use it now.
            {pending.scheduledFor ? (
              <>
                {" "}Everything in it will be removed for good on <span className="font-medium text-foreground">{when(pending.scheduledFor)}</span>.
              </>
            ) : null}
          </p>
        )}

        {canCancel ? (
          <>
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await cancel({});
                } catch (err) {
                  setError(errorText(err));
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
              Cancel deletion and restore {pending.companyName}
            </Button>
            <div className="border-t pt-4">
              <ExportSection companyName={pending.companyName} />
            </div>
          </>
        ) : !pending.started ? (
          <p className="text-sm text-muted-foreground">Only the workspace owner can cancel this.</p>
        ) : null}

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        <Button type="button" variant="outline" className="w-full" onClick={() => void signOut({ redirectUrl: "/" })}>
          <LogOut />
          Sign out
        </Button>
      </div>
    </div>
  );
}
