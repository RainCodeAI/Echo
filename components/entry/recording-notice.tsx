"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Mic } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { RECORDING_NOTICE_VERSION, recordingNotice } from "@/convex/lib/privacy";

/** Shown once per crew member (and again if the notice changes) before recording. */
export function RecordingNotice({
  companyId,
  companyName,
  member,
  onAcknowledged,
  onSwitchUser,
}: {
  companyId: Id<"companies">;
  companyName: string;
  member: { id: Id<"teamMembers">; name: string; verificationToken: string };
  onAcknowledged: () => void;
  onSwitchUser: () => void;
}) {
  const acknowledge = useMutation(api.teamMembers.acknowledgeNotice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-5" data-testid="recording-notice">
      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Before your first note, {member.name.split(" ")[0]}</h2>
      </div>
      <div className="space-y-3 text-sm text-muted-foreground">
        {recordingNotice(companyName).map((p) => (
          <p key={p}>{p}</p>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      <Button
        type="button"
        className="h-12 w-full text-base"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await acknowledge({
              companyId,
              teamMemberId: member.id,
              verificationToken: member.verificationToken,
              version: RECORDING_NOTICE_VERSION,
            });
            onAcknowledged();
          } catch {
            setError("Couldn't save that. Check your signal and try again.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        I understand
      </Button>
      <button type="button" onClick={onSwitchUser} className="block w-full text-center text-xs text-muted-foreground underline">
        Not {member.name}? Switch user
      </button>
    </div>
  );
}
