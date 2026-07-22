"use client";

import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

const TITLES: { prefix: string; title: string; exact?: boolean }[] = [
  { prefix: "/dashboard", title: "Overview", exact: true },
  { prefix: "/dashboard/notes/", title: "Note detail" },
  { prefix: "/dashboard/notes", title: "Voice notes" },
  { prefix: "/dashboard/leads", title: "Leads" },
  { prefix: "/dashboard/jobs", title: "Jobs" },
  { prefix: "/dashboard/team", title: "Crew" },
  { prefix: "/dashboard/settings", title: "Settings" },
];

function titleFor(pathname: string): string {
  const match = [...TITLES]
    .reverse()
    .find((t) => (t.exact ? pathname === t.prefix : pathname.startsWith(t.prefix)));
  return match?.title ?? "Dashboard";
}

export function Topbar() {
  const pathname = usePathname();
  const me = useQuery(api.users.current, {});

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-4 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold leading-tight">
          {titleFor(pathname)}
        </h1>
        {me?.company?.name ? (
          <p className="text-xs text-muted-foreground">{me.company.name}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        {me?.name ? (
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {me.name}
          </span>
        ) : null}
        <UserButton afterSignOutUrl="/" />
      </div>
    </header>
  );
}
