import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { FieldEntryGate } from "@/components/entry/field-entry-gate";
import type { Id } from "@/convex/_generated/dataModel";

/** Minimal live-query support for useQuery: fetch once, keep last value on failure. */
const queryCache = new Map<string, unknown>();
function watchQuery(ref: unknown, args: Record<string, unknown>) {
  const name = getFunctionName(ref as never);
  const key = name + JSON.stringify(args);
  return {
    localQueryResult: () => queryCache.get(key),
    onUpdate: (cb: () => void) => {
      let alive = true;
      fetch(`/api/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      })
        .then((r) => r.json())
        .then((body) => {
          if (!alive || body.error) return;
          queryCache.set(key, body.result);
          cb();
        })
        .catch(() => {
          /* offline: keep the previous value, like the real client */
        });
      return () => {
        alive = false;
      };
    },
  };
}

/** Fake Convex client: forwards mutations to the local mock server. */
const fakeClient = {
  watchQuery,
  async mutation(ref: unknown, args: Record<string, unknown>) {
    const name = getFunctionName(ref as never);
    const res = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = await res.json();
    if (body.error) {
      // Same shape the real Convex client produces for a thrown server error.
      throw new Error(
        `[CONVEX M(${name})] [Request ID: test] Server Error\nUncaught Error: ${body.error}\n    at handler`,
      );
    }
    return body.result;
  },
};

createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fakeClient as never}>
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-md p-4">
        <FieldEntryGate
          companyId={"company1" as Id<"companies">}
          companyName="Acme Roofing"
          pinLength={Number(new URLSearchParams(location.search).get("pinlen") ?? 4)}
        />
      </div>
    </div>
  </ConvexProvider>,
);
