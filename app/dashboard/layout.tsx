"use client";

import { ReactNode } from "react";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { RedirectToSignIn } from "@clerk/nextjs";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { MobileNav } from "@/components/dashboard/mobile-nav";
import { useStoreUser } from "@/hooks/use-store-user";

/**
 * Authenticated dashboard shell (owners / office).
 * Field workers do not use this layout — they use `/entry/[companyId]`.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthLoading>
        <FullScreenLoader />
      </AuthLoading>

      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>

      <Authenticated>
        <DashboardShell>{children}</DashboardShell>
      </Authenticated>
    </>
  );
}

function DashboardShell({ children }: { children: ReactNode }) {
  const { error, isReady, retry } = useStoreUser();

  if (error) {
    return <WorkspaceSetupError error={error} onRetry={retry} />;
  }

  if (!isReady) {
    return <FullScreenLoader label="Setting up your workspace..." />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-muted/30">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}

function WorkspaceSetupError({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-xl rounded-lg border bg-background p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <h1 className="text-lg font-semibold">Workspace setup failed</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Your Clerk sign-in worked, but Echo could not connect that
                session to the Convex workspace.
              </p>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Checks</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  <code className="text-xs">NEXT_PUBLIC_CONVEX_URL</code> is set
                </li>
                <li>
                  Convex has{" "}
                  <code className="text-xs">CLERK_JWT_ISSUER_DOMAIN</code>
                </li>
                <li>
                  Clerk JWT template named <code className="text-xs">convex</code>{" "}
                  exists
                </li>
              </ul>
            </div>

            <p className="break-words rounded-md bg-destructive/5 p-3 text-xs text-destructive">
              {error.message}
            </p>

            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
