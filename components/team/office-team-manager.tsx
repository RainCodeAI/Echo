"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Mail, ShieldCheck, X } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Office (Clerk) team: current members + email invites. An invited person
 * joins automatically the first time they sign up with that email.
 */
export function OfficeTeamManager() {
  const me = useQuery(api.users.current, {});
  const members = useQuery(api.users.listForCompany, {});
  const invites = useQuery(api.invites.list, {});
  const createInvite = useMutation(api.invites.create);
  const revokeInvite = useMutation(api.invites.revoke);

  const isOwner = me?.role === "owner";

  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Id<"invites"> | null>(null);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setPending(true);
    try {
      await createInvite({ email });
      setMessage(
        `Invite created for ${email.trim().toLowerCase()}. They join automatically when they sign up with that email.`,
      );
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invite.");
    } finally {
      setPending(false);
    }
  }

  async function handleRevoke(inviteId: Id<"invites">) {
    setRevoking(inviteId);
    setError(null);
    try {
      await revokeInvite({ inviteId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke invite.");
    } finally {
      setRevoking(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Office team
        </CardTitle>
        <CardDescription>
          People who sign in with Clerk to review notes. Invite office staff by
          email — field crew use PINs below instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Roster */}
        {members === undefined ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {m.name}
                    {m.isSelf ? (
                      <span className="text-muted-foreground"> (you)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {m.email || "no email"}
                  </p>
                </div>
                <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                  {m.role === "owner" ? "Owner" : "Member"}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {/* Invite form (owner only) */}
        {isOwner ? (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <form
              onSubmit={handleInvite}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">Invite by email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={pending || !email.trim()}>
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Send invite
              </Button>
            </form>
            {message ? <p className="text-sm text-primary">{message}</p> : null}
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}

            {invites === undefined ? null : invites.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pending invites
                </p>
                <ul className="divide-y rounded-md border bg-background">
                  {invites.map((invite) => (
                    <li
                      key={invite.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {invite.email}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={revoking === invite.id}
                        onClick={() => void handleRevoke(invite.id)}
                      >
                        {revoking === invite.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the workspace owner can invite office users.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
