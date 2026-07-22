"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";

export default function SettingsPage() {
  const me = useQuery(api.users.current, {});

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Company profile</CardTitle>
          <CardDescription>
            Workspace identity for AI prompts and field entry branding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyProfileForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your signed-in identity and workspace id.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {me === undefined ? (
            <Skeleton className="h-16 w-full" />
          ) : me === null ? (
            <p className="text-muted-foreground">Provisioning workspace…</p>
          ) : (
            <>
              <div>
                <p className="text-muted-foreground">Signed in as</p>
                <p className="font-medium">
                  {me.name} ({me.email || "no email"})
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Role</p>
                <p className="font-medium capitalize">{me.role}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Company ID (field entry URL)</p>
                <p className="break-all font-mono text-xs">{me.companyId}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
