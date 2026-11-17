import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { CompanyProfileForm } from "@/components/settings/company-profile-form";

const role = new URLSearchParams(location.search).get("role") ?? "owner";
const calls: { name: string; args: unknown }[] = [];
(window as unknown as { __calls: typeof calls }).__calls = calls;
const data: Record<string, unknown> = {
  "companies:current": { _id: "c1", name: "Acme Roofing", primaryTrade: "roofing", notificationEmail: "alerts@acme.com", notificationsEnabled: true, createdAt: 0, lastDigestStatus: "quiet", lastDigestAt: Date.UTC(2026, 10, 8, 12, 7) },
  "users:current": { _id: "u1", role, companyId: "c1", name: "Owner", email: "o@a.com", company: null },
};
const fake = {
  watchQuery(ref: unknown) {
    const name = getFunctionName(ref as never);
    return { localQueryResult: () => data[name], onUpdate: () => () => {} };
  },
  async mutation(ref: unknown, args: unknown) {
    calls.push({ name: getFunctionName(ref as never), args });
    return "c1";
  },
  async action(ref: unknown, args: unknown) {
    const name = getFunctionName(ref as never);
    calls.push({ name, args });
    if (name === "digest:sendNow") {
      return { status: "sent", subject: "Acme Roofing — Mon, Nov 9: 7 notes, from 3 crew members, 2 need you" };
    }
    return [
      { channel: "email", recipient: "a•••@acme.com", status: "sent", detail: null },
      { channel: "sms", recipient: "•••• 4567", status: "not_configured", detail: "Set TWILIO_…" },
    ];
  },
};
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}>
    <div className="mx-auto max-w-2xl p-4"><CompanyProfileForm /></div>
  </ConvexProvider>,
);
