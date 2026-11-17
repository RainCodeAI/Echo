import { createRoot } from "react-dom/client";
import { ConvexProvider } from "convex/react";
import { getFunctionName } from "convex/server";
import { TermsGate } from "@/components/privacy/terms-gate";
import { RecordingNotice } from "@/components/entry/recording-notice";
import { DataControls } from "@/components/settings/data-controls";
import { DeleteNote } from "@/components/notes/delete-note";
import { DeletionPending } from "@/components/privacy/deletion-pending";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

const calls: { name: string; args: any }[] = [];
(window as any).__calls = calls;
const q = new URLSearchParams(location.search);
const view = q.get("view") ?? "terms";
const owner = !q.has("member");
const status = { isOwner: owner, companyName: "Acme Roofing", termsVersion: "2026-11-15", termsAccepted: q.has("accepted"), termsAcceptedAt: q.has("renew") ? Date.UTC(2026, 0, 2) : q.has("accepted") ? Date.UTC(2026, 10, 15) : null };
const rows: Record<string, any[]> = {
  voiceNotes: [{ _id: "n1", recordedAt: Date.UTC(2026, 10, 14), aiTitle: "Rot by chimney", rawTranscript: "x", audioUrl: "/media/n1", audioMimeType: "audio/webm" }],
  voiceNotePhotos: [], leads: [], jobs: [], teamMembers: [{ _id: "m1", name: "Luis", isActive: true }], users: [], materialOrders: [], customerUpdates: [], alerts: [],
};
const fake = {
  watchQuery(ref: unknown) {
    const name = getFunctionName(ref as never);
    return { localQueryResult: () => (name === "privacy:status" ? status : undefined), onUpdate: () => () => {} };
  },
  async query(ref: unknown, args: any) {
    calls.push({ name: getFunctionName(ref as never), args });
    return { rows: rows[args.table] ?? [], isDone: true, continueCursor: "" };
  },
  async mutation(ref: unknown, args: any) {
    calls.push({ name: getFunctionName(ref as never), args });
    return null;
  },
};
const content =
  view === "terms" ? <TermsGate><p data-testid="dashboard">Dashboard content</p></TermsGate>
  : view === "notice" ? <RecordingNotice companyId={"c1" as never} companyName="Acme Roofing" member={{ id: "m1" as never, name: "Luis Garcia", verificationToken: "tok" }} onAcknowledged={() => ((window as any).__acked = true)} onSwitchUser={() => ((window as any).__switched = true)} />
  : view === "data" ? <DataControls />
  : view === "pending" ? <DeletionPending pending={{ companyName: "Acme Roofing", isOwner: owner, requestedAt: Date.UTC(2026, 10, 17, 15), requestedByName: "Dana", scheduledFor: q.has("started") ? null : Date.UTC(2026, 10, 24, 15), started: q.has("started") }} />
  : view === "delete" ? <DeleteNote noteId={"n1" as never} />
  : view === "privacy" ? <PrivacyPage />
  : <TermsPage />;
createRoot(document.getElementById("root")!).render(
  <ConvexProvider client={fake as never}><div className="mx-auto max-w-2xl p-4">{content}</div></ConvexProvider>,
);
