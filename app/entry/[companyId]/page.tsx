"use client";

import { use } from "react";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { EchoLogo } from "@/components/brand/echo-logo";
import { FieldEntryGate } from "@/components/entry/field-entry-gate";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Public field entry: PIN gate → record → submit (Relay-style, no Clerk).
 */
export default function FieldEntryPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId: rawId } = use(params);
  const companyId = rawId as Id<"companies">;
  const company = useQuery(api.companies.publicProfile, { companyId });

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="border-b bg-background px-4 py-4">
        <EchoLogo />
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-4 pb-10">
        {company === undefined ? (
          <div className="flex justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : company === null ? (
          <Card>
            <CardHeader>
              <CardTitle>Company not found</CardTitle>
              <CardDescription>
                This field entry link is invalid or the workspace was removed.
                Ask your owner for a fresh link from the Echo dashboard (Crew).
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <FieldEntryGate companyId={companyId} companyName={company.name} />
        )}
      </main>
    </div>
  );
}
