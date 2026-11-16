"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { Crown, Loader2, LogOut, UserMinus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

type Member = { id: Id<"users">; name: string; role: "owner" | "member"; isSelf: boolean };
type Pending = "remove" | "transfer" | "leave";

const CONFIRM: Record<Pending, (name: string) => string> = {
  remove: (n) => `Remove ${n}? They lose access right away, and their open action items become unassigned.`,
  transfer: (n) =>
    `Make ${n} the owner? You'll become a member: company settings, invites, data export and deleting the workspace move to them.`,
  leave: () => "Leave this workspace? You'll lose access right away. The owner can invite you back.",
};

/** Per-row actions on the office roster (owner: remove / make owner; member: leave). */
export function OfficeMemberActions({ member, viewerIsOwner }: { member: Member; viewerIsOwner: boolean }) {
  const removeMember = useMutation(api.officeUsers.removeMember);
  const transferOwnership = useMutation(api.officeUsers.transferOwnership);
  const leave = useMutation(api.officeUsers.leave);
  const { signOut } = useClerk();
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const available: Pending[] = viewerIsOwner
    ? member.isSelf || member.role === "owner"
      ? []
      : ["transfer", "remove"]
    : member.isSelf
      ? ["leave"]
      : [];
  if (available.length === 0) return null;

  async function run(action: Pending) {
    setBusy(true);
    setError(null);
    try {
      if (action === "remove") await removeMember({ userId: member.id });
      if (action === "transfer") await transferOwnership({ userId: member.id });
      if (action === "leave") {
        await leave({});
        await signOut({ redirectUrl: "/" });
        return;
      }
      setConfirming(null);
    } catch (err) {
      setError(err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="w-full space-y-2 rounded-md border bg-muted/30 p-3 text-sm" data-testid={`confirm-${confirming}`}>
        <p>{CONFIRM[confirming](member.name)}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={confirming === "transfer" ? "default" : "destructive"}
            disabled={busy}
            onClick={() => void run(confirming)}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            {confirming === "remove" ? `Remove ${member.name}` : confirming === "transfer" ? "Make owner" : "Leave workspace"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
        {error ? <p className="text-xs text-destructive" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-wrap gap-1 sm:w-auto">
      {available.includes("transfer") ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming("transfer")} aria-label={`Make ${member.name} the owner`}>
          <Crown /> Make owner
        </Button>
      ) : null}
      {available.includes("remove") ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirming("remove")}
          aria-label={`Remove ${member.name}`}
        >
          <UserMinus /> Remove
        </Button>
      ) : null}
      {available.includes("leave") ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming("leave")}>
          <LogOut /> Leave
        </Button>
      ) : null}
    </div>
  );
}
