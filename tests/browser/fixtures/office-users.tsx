import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { OfficeTeamManager } from "@/components/team/office-team-manager";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const asOwner = !new URLSearchParams(location.search).has("member");
const failRemove = new URLSearchParams(location.search).has("fail");
const users = [
  { id: "u1", name: "Dana Owner", email: "dana@acme.com", role: "owner", isSelf: asOwner },
  { id: "u2", name: "Pat Office", email: "pat@acme.com", role: "member", isSelf: !asOwner },
  { id: "u3", name: "Sam Estimator", email: "sam@acme.com", role: "member", isSelf: false },
];
const me = asOwner ? { _id: "u1", role: "owner", name: "Dana Owner" } : { _id: "u2", role: "member", name: "Pat Office" };
const fake = {
  watchQuery(ref: unknown) {
    const n = getFunctionName(ref as never);
    const v = n === "users:current" ? me : n === "users:listForCompany" ? users : n === "invites:list" ? [] : undefined;
    return { localQueryResult: () => v, onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: any) {
    const name = getFunctionName(ref as never);
    calls.push({ name, args });
    if (failRemove && name === "officeUsers:removeMember") {
      throw new Error("[CONVEX M(officeUsers:removeMember)] Server Error\nUncaught Error: The owner can't be removed.\n    at h");
    }
    return null;
  },
};
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}><div className="mx-auto max-w-2xl p-4"><OfficeTeamManager /></div></ConvexProvider>,
);
