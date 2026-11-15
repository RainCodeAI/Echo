"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation } from "convex/react";
import { Printer } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CrewPoster, type PosterFormat } from "@/components/onboarding/crew-poster";
import { useEntryUrl } from "@/hooks/use-entry-url";

/** Print the crew link as a poster for the shop wall or a sticker for the truck. */
export default function PosterPage() {
  const { companyName, entryUrl, isLoading } = useEntryUrl();
  const markShared = useMutation(api.onboarding.markShared);
  const [format, setFormat] = useState<PosterFormat>("poster");

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`@media print { @page { size: ${format === "sticker" ? "4in 4in" : "letter"}; margin: 0; } }`}</style>
      <div className="space-y-3 print:hidden">
        <div>
          <Link href="/dashboard/team" className="text-xs text-muted-foreground hover:underline">
            ← Crew
          </Link>
          <h2 className="text-xl font-semibold">Crew poster</h2>
          <p className="text-sm text-muted-foreground">
            Put it on the shop wall or the truck dash. Crews scan it, enter their PIN and record. No app to install.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="Format">
            {(["poster", "sticker"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={format === f}
                onClick={() => setFormat(f)}
                className={`rounded px-3 py-1 text-xs font-medium ${format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {f === "poster" ? "Poster (Letter)" : "Truck sticker (4×4 in)"}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!entryUrl}
            onClick={() => {
              void markShared({}).catch(() => undefined);
              window.print();
            }}
          >
            <Printer /> Print
          </Button>
        </div>
      </div>
      {isLoading || !entryUrl ? (
        <Skeleton className="mx-auto aspect-[8.5/11] w-full max-w-[8.5in]" />
      ) : (
        <CrewPoster companyName={companyName} entryUrl={entryUrl} format={format} />
      )}
    </div>
  );
}
