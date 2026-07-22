"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Resolves the public field-entry URL for the signed-in owner's company.
 */
export function useEntryUrl() {
  const me = useQuery(api.users.current, {});

  const companyId = me?.companyId ?? null;
  const companyName = me?.company?.name ?? "Company";

  const entryPath = companyId ? `/entry/${companyId}` : null;

  const entryUrl = useMemo(() => {
    if (!entryPath) return null;
    if (typeof window !== "undefined") {
      return `${window.location.origin}${entryPath}`;
    }
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
    return base ? `${base}${entryPath}` : entryPath;
  }, [entryPath]);

  return {
    me,
    companyId,
    companyName,
    entryPath,
    entryUrl,
    isLoading: me === undefined,
  };
}
