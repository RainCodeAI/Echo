"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Users } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TeamMemberDialog,
  type TeamMemberRow,
} from "@/components/team/team-member-dialog";

export function TeamMembersManager() {
  const members = useQuery(api.teamMembers.list, {});
  const updateMember = useMutation(api.teamMembers.update);

  const activeCount = members?.filter((m) => m.isActive).length ?? 0;

  async function toggleActive(member: TeamMemberRow) {
    await updateMember({
      memberId: member._id,
      isActive: !member.isActive,
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">Crew roster</CardTitle>
          <CardDescription>
            PIN-based field workers for{" "}
            <code className="text-xs">/entry/[companyId]</code>. No Clerk
            accounts required.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          {members !== undefined ? (
            <Badge variant="secondary">
              {activeCount} active
              {members.length !== activeCount
                ? ` · ${members.length} total`
                : null}
            </Badge>
          ) : null}
          <TeamMemberDialog mode="create" />
        </div>
      </CardHeader>
      <CardContent>
        {members === undefined ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold">No crew members yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Add your first field worker with a 4-digit PIN, then share the
              entry link or QR code above.
            </p>
            <div className="mt-4 flex justify-center">
              <TeamMemberDialog mode="create" />
            </div>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Name</th>
                    <th className="pb-3 pr-4 font-medium">Role</th>
                    <th className="pb-3 pr-4 font-medium">PIN</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member._id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{member.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {member.role || "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        •••• (hidden)
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant={member.isActive ? "default" : "secondary"}
                        >
                          {member.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="py-3">
                        <div className="flex justify-end gap-2">
                          <TeamMemberDialog
                            mode="edit"
                            member={{
                              _id: member._id,
                              name: member.name,
                              role: member.role,
                              isActive: member.isActive,
                            }}
                          />
                          <ToggleActiveButton
                            isActive={member.isActive}
                            onToggle={() =>
                              toggleActive({
                                _id: member._id,
                                name: member.name,
                                role: member.role,
                                isActive: member.isActive,
                              })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 md:hidden">
              {members.map((member) => (
                <div
                  key={member._id}
                  className="rounded-xl border bg-background p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{member.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {member.role || "No role"}
                      </p>
                    </div>
                    <Badge variant={member.isActive ? "default" : "secondary"}>
                      {member.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    PIN: •••• (hidden)
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <TeamMemberDialog
                      mode="edit"
                      member={{
                        _id: member._id,
                        name: member.name,
                        role: member.role,
                        isActive: member.isActive,
                      }}
                    />
                    <ToggleActiveButton
                      isActive={member.isActive}
                      onToggle={() =>
                        toggleActive({
                          _id: member._id,
                          name: member.name,
                          role: member.role,
                          isActive: member.isActive,
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleActiveButton({
  isActive,
  onToggle,
}: {
  isActive: boolean;
  onToggle: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await onToggle();
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isActive ? (
        "Deactivate"
      ) : (
        "Reactivate"
      )}
    </Button>
  );
}
