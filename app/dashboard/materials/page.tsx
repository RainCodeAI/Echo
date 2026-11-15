"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Package } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { JobOrderList } from "@/components/materials/order-list";

/**
 * Materials → order list. Without `?job=`: jobs whose notes mention
 * materials. With it: that job's merged order list.
 */
export default function MaterialsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <MaterialsView />
      </Suspense>
    </div>
  );
}

function MaterialsView() {
  const jobId = useSearchParams().get("job");
  return jobId ? <JobOrderList jobId={jobId as Id<"jobs">} /> : <JobsWithMaterials />;
}

function JobsWithMaterials() {
  const data = useQuery(api.materials.overview, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Materials</h2>
        <p className="text-sm text-muted-foreground">
          What crews said they need, merged per job into an order list for the supply house.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jobs</CardTitle>
          <CardDescription>Jobs with something left to order come first.</CardDescription>
        </CardHeader>
        <CardContent>
          {data === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : data.jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
              <Package className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">No materials yet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                When a crew mentions materials in a note linked to a job, they collect here.
              </p>
            </div>
          ) : (
            <ul className="divide-y" data-testid="materials-jobs">
              {data.jobs.map((j) => (
                <li key={j.jobId}>
                  <Link
                    href={`/dashboard/materials?job=${j.jobId}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{j.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {j.address ?? "No site address"} · from {j.noteCount === 1 ? "1 note" : `${j.noteCount} notes`}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        j.toOrder ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {j.toOrder ? `${j.toOrder} to order` : "All ordered"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {data && data.unlinkedNotes > 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              {data.unlinkedNotes === 1 ? "1 note mentions" : `${data.unlinkedNotes} notes mention`} materials but
              {data.unlinkedNotes === 1 ? " isn't" : " aren't"} linked to a job.{" "}
              <Link href="/dashboard/notes" className="text-foreground underline">
                Link them
              </Link>{" "}
              to include those materials.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
