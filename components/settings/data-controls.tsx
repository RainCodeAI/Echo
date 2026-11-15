"use client";

import Link from "next/link";
import { useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useClerk } from "@clerk/nextjs";
import { Download, Loader2, Trash2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deletionConfirmationMatches } from "@/convex/lib/privacy";
import { buildExportZip, type ExportProgress } from "@/lib/export/build-export";

const errorText = (err: unknown) =>
  err instanceof Error ? (err.message.match(/Uncaught Error: ([^\n]+)/)?.[1] ?? err.message) : "Something went wrong.";

/** Settings → Your data: export everything, or delete the workspace. */
export function DataControls() {
  const status = useQuery(api.privacy.status, {});
  const convex = useConvex();
  const deleteWorkspace = useMutation(api.privacy.deleteWorkspace);
  const { signOut } = useClerk();

  const [includeMedia, setIncludeMedia] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === undefined) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="data-controls">
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>
          Export everything Echo holds for {status.companyName}, or delete the workspace.{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link> ·{" "}
          <Link href="/terms" className="underline">Terms</Link>
          {status.termsAcceptedAt ? ` · accepted ${new Date(status.termsAcceptedAt).toLocaleDateString()}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!status.isOwner ? (
          <p className="text-sm text-muted-foreground">Only the workspace owner can export or delete data.</p>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Export</h3>
              <p className="text-sm text-muted-foreground">
                A zip of spreadsheets (notes, action items, leads, jobs, crew, orders, customer updates) plus all the raw
                data. Crew PINs are never included.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={includeMedia}
                  onChange={(e) => setIncludeMedia(e.target.checked)}
                />
                Include recordings and photos (much larger download)
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  setError(null);
                  setExportResult(null);
                  try {
                    const { blob, filename, mediaFailed } = await buildExportZip(convex, {
                      companyName: status.companyName,
                      includeMedia,
                      onProgress: setProgress,
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = filename;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
                    setExportResult(
                      `Downloaded ${filename}.` +
                        (mediaFailed ? ` ${mediaFailed} file(s) couldn't be downloaded; their links are in media-links.csv.` : ""),
                    );
                  } catch (err) {
                    setError(errorText(err));
                  } finally {
                    setExporting(false);
                    setProgress(null);
                  }
                }}
              >
                {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                Export data
              </Button>
              {progress ? (
                <p className="text-xs text-muted-foreground" role="status">
                  {progress.stage}
                  {progress.total ? ` (${progress.done ?? 0} of ${progress.total})` : "…"}
                </p>
              ) : null}
              {exportResult ? <p className="text-xs text-primary" role="status">{exportResult}</p> : null}
            </section>

            <section className="space-y-2 rounded-lg border border-destructive/40 p-4">
              <h3 className="text-sm font-medium text-destructive">Delete workspace</h3>
              <p className="text-sm text-muted-foreground">
                Permanently deletes every note, recording, photo, lead, job, crew member and office user in{" "}
                {status.companyName}. Everyone loses access right away, and this can&rsquo;t be undone. Export first if you
                want a copy.
              </p>
              <label className="block text-sm">
                Type <span className="font-medium">{status.companyName}</span> to confirm
                <input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  aria-label="Workspace name to confirm deletion"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </label>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={deleting || !deletionConfirmationMatches(confirmName, status.companyName)}
                onClick={async () => {
                  setDeleting(true);
                  setError(null);
                  try {
                    await deleteWorkspace({ confirmName });
                    await signOut({ redirectUrl: "/" });
                  } catch (err) {
                    setError(errorText(err));
                    setDeleting(false);
                  }
                }}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Delete workspace permanently
              </Button>
            </section>
          </>
        )}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
