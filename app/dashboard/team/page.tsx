"use client";

import { EntryShareCard } from "@/components/team/entry-share-card";
import { OfficeTeamManager } from "@/components/team/office-team-manager";
import { TeamMembersManager } from "@/components/team/team-members-manager";
import { PinLengthSetting } from "@/components/team/pin-length-setting";
import { useEntryUrl } from "@/hooks/use-entry-url";

/**
 * Crew management: PIN roster + field entry link/QR (Relay-style).
 */
export default function TeamPage() {
  const { companyName, entryUrl, entryPath, isLoading } = useEntryUrl();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Crew &amp; field access</h2>
        <p className="text-sm text-muted-foreground">
          Add field workers with PINs and share the public entry link.
          Workers never need a Clerk account.
        </p>
      </div>

      <OfficeTeamManager />

      <EntryShareCard
        companyName={companyName}
        entryUrl={entryUrl}
        entryPath={entryPath}
        isLoading={isLoading}
      />

      <PinLengthSetting />
      <TeamMembersManager />
    </div>
  );
}
