import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { PinLengthSetting } from "@/components/team/pin-length-setting";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const q = new URLSearchParams(location.search);
const six = q.has("six");
const me = { _id: "u1", role: q.has("member") ? "member" : "owner" };
const company = { _id: "c1", name: "Acme", pinLength: six ? 6 : undefined };
const members = [
  { _id: "m1", name: "Luis", isActive: true, pinLength: six ? 6 : undefined, needsNewPin: false },
  { _id: "m2", name: "Ana", isActive: true, pinLength: undefined, needsNewPin: six },
  { _id: "m3", name: "Old", isActive: false, pinLength: undefined, needsNewPin: six },
];
const fake = {
  watchQuery(ref: unknown) {
    const n = getFunctionName(ref as never);
    const v = n === "users:current" ? me : n === "companies:current" ? company : n === "teamMembers:list" ? members : undefined;
    return { localQueryResult: () => v, onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: any) { calls.push({ name: getFunctionName(ref as never), args }); return { needNewPin: 2 }; },
};
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}><div className="mx-auto max-w-2xl p-4"><PinLengthSetting /></div></ConvexProvider>,
);
