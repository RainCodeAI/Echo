"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";

/**
 * Ensures the signed-in Clerk user has a corresponding Convex `users` record
 * (and a company). Call once near the top of the authenticated app.
 */
export function useStoreUser() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { isLoaded: isUserLoaded, user } = useUser();
  const storeUser = useMutation(api.users.store);
  const [isStored, setIsStored] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsStored(false);
      setError(null);
      return;
    }
    if (!isUserLoaded) return;

    let cancelled = false;
    setIsStored(false);
    setError(null);
    void (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await storeUser({
            name: user?.fullName ?? undefined,
            email: user?.primaryEmailAddress?.emailAddress ?? undefined,
          });
          if (!cancelled) setIsStored(true);
          return;
        } catch {
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
          }
        }
      }
      if (!cancelled) {
        setError(
          new Error(
            "Workspace setup could not be completed. Check Clerk ↔ Convex configuration or try again.",
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isUserLoaded, retryNonce, storeUser, user?.id]);

  return {
    error,
    isLoading: isLoading || !isUserLoaded,
    isAuthenticated,
    isReady: isAuthenticated && isStored && !error,
    retry: () => setRetryNonce((value) => value + 1),
  };
}
