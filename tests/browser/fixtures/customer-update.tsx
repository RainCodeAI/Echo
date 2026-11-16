import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { CustomerUpdate } from "@/components/notes/customer-update";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const q = new URLSearchParams(location.search);
const state = q.get("state") ?? "draft";
const noPhone = q.has("nophone");
const base = {
  job: { id: "j1", title: "Ramirez reroof" },
  customer: { name: "Maria Ramirez", phone: noPhone ? null : "(555) 010-2000", email: "maria@example.com" },
  lastSentAt: state === "none" ? Date.UTC(2026, 10, 13, 17) : null,
};
const cur = (status: string, extra: any = {}) => ({
  id: "u1", status, noteCount: 3, createdAt: Date.now(), error: null, sentVia: null, sentAt: null,
  text: "Hi Maria, quick update from Acme Roofing: tear-off is done on the north slope. We found some soft decking near the chimney; Dana will call you about next steps. - Acme Roofing",
  emailSubject: "Roof update: tear-off done",
  emailBody: "Hi Maria,\n\nTear-off is done on the north slope. We found some soft decking near the chimney, and Dana will call you about next steps.\n\nThanks,\nAcme Roofing",
  ...extra,
});
const value =
  state === "nojob" ? { job: null, customer: null, current: null, lastSentAt: null }
  : state === "none" ? { ...base, current: null }
  : state === "failed" ? { ...base, current: cur("failed", { error: "AI isn't set up on this workspace (OPENAI_API_KEY is missing)." }) }
  : state === "generating" ? { ...base, current: cur("generating") }
  : state === "sent" ? { ...base, current: cur("sent", { sentVia: "text", sentAt: Date.UTC(2026, 10, 15, 21, 4) }) }
  : { ...base, current: cur("draft") };
const fake = {
  watchQuery() { return { localQueryResult: () => value, onUpdate: () => () => {} }; },
  async mutation(ref: unknown, args: any) { calls.push({ name: getFunctionName(ref as never), args }); return "u2"; },
};
document.addEventListener("click", (e) => {
  if ((e.target as Element).closest?.('a[href^="sms:"],a[href^="mailto:"]')) { (window as any).__opened = (e.target as Element).closest("a")!.getAttribute("href"); e.preventDefault(); }
}, true);
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}>
    <div className="mx-auto max-w-3xl p-4"><CustomerUpdate noteId={"n1" as never} /></div>
  </ConvexProvider>,
);
