// @vitest-environment edge-runtime
/**
 * Structural audits: these fail when someone adds a public function or a
 * company-data table without deciding how it's protected / deleted / exported.
 */
import { describe, expect, it } from "vitest";
import schema from "../../convex/schema";
import { DELETION_ORDER } from "../../convex/lib/privacy";
import { EXPORT_TABLES } from "../../lib/export/format";

const modules = import.meta.glob("../../convex/*.ts", { eager: true }) as Record<string, Record<string, unknown>>;

type Access =
  | "member" // signed-in office user; company-scoped (requireCurrentUser + same-company checks)
  | "owner" // requireOwner (or owner rule checked in a helper)
  | "field" // crew field session token (requireFieldSession)
  | "public" // deliberately unauthenticated; returns only non-sensitive data
  | "self"; // acts on the caller's own identity only

/** Every public Convex function, reviewed. Add new ones here on purpose. */
const REVIEWED: Record<string, Access> = {
  "aiUsage.summary": "member",
  "alerts.sendTestAlert": "owner",
  "alerts.listForNote": "member",
  "companies.publicProfile": "public",
  "companies.current": "member",
  "companies.update": "owner",
  "companies.setPinLength": "owner",
  "customerUpdates.requestDraft": "member",
  "customerUpdates.forNote": "member",
  "customerUpdates.updateDraft": "member",
  "customerUpdates.markSent": "member",
  "customerUpdates.undoSent": "member",
  "customerUpdates.discard": "member",
  "digest.sendNow": "owner",
  "invites.list": "member",
  "invites.create": "owner",
  "invites.revoke": "owner",
  "jobUpdates.apply": "member",
  "jobUpdates.undo": "member",
  "jobUpdates.dismiss": "member",
  "jobs.list": "member",
  "jobs.listForLink": "member",
  "jobs.create": "member",
  "jobs.update": "member",
  "jobs.listForField": "field",
  "leads.list": "member",
  "leads.listForLink": "member",
  "leads.create": "member",
  "leads.update": "member",
  "materials.overview": "member",
  "materials.forJob": "member",
  "materials.markOrdered": "member",
  "materials.undoOrder": "member",
  "officeUsers.removeMember": "owner",
  "officeUsers.leave": "self",
  "officeUsers.transferOwnership": "owner",
  "onboarding.status": "member",
  "onboarding.markShared": "owner",
  "onboarding.setDismissed": "owner",
  "onboarding.createSampleNote": "owner",
  "privacy.status": "member",
  "privacy.acceptTerms": "owner",
  "privacy.deleteNote": "owner",
  "privacy.exportPage": "owner",
  "privacy.deleteWorkspace": "owner",
  "tasks.list": "member",
  "tasks.people": "member",
  "tasks.summary": "member",
  "teamMembers.list": "member",
  "teamMembers.create": "member",
  "teamMembers.update": "member",
  "teamMembers.verifyPin": "public",
  "teamMembers.acknowledgeNotice": "field",
  "teamMembers.noticeStatus": "field",
  "users.current": "self",
  "users.store": "self",
  "users.listForCompany": "member",
  "voiceNotes.generateFieldUploadUrl": "field",
  "voiceNotes.createFromField": "field",
  "voiceNotes.listForCompany": "member",
  "voiceNotes.get": "member",
  "voiceNotes.dashboardStats": "member",
  "voiceNotes.markReviewed": "member",
  "voiceNotes.markReady": "member",
  "voiceNotes.archive": "member",
  "voiceNotes.unarchive": "member",
  "voiceNotes.setOwnerNote": "member",
  "voiceNotes.setUrgency": "member",
  "voiceNotes.setWorkerFlaggedUrgent": "member",
  "voiceNotes.updateReview": "member",
  "voiceNotes.setLinks": "member",
  "voiceNotes.setStatus": "member",
  "voiceNotes.requestAiRetry": "member",
  "voiceNotes.updateTranscript": "member",
  "voiceNotes.updateAiFields": "member",
  "voiceNotes.setActionItemCompleted": "member",
  "voiceNotes.setActionItemAssignee": "member",
};

function publicFunctions(): string[] {
  const found: string[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const name = path.split("/").pop()!.replace(/\.ts$/, "");
    for (const [exp, fn] of Object.entries(mod)) {
      if (fn && typeof fn === "function" && (fn as { isPublic?: boolean }).isPublic) found.push(`${name}.${exp}`);
    }
  }
  return found.sort();
}

describe("public API surface", () => {
  it("every public function has a reviewed access rule (and nothing reviewed has vanished)", () => {
    expect(publicFunctions()).toEqual(Object.keys(REVIEWED).sort());
  });
});

/** Tables with a companyId field, read from the schema itself. */
function companyTables(): string[] {
  return Object.entries(schema.tables)
    .filter(([, t]) => "companyId" in ((t as { validator: { fields?: Record<string, unknown> } }).validator.fields ?? {}))
    .map(([name]) => name)
    .sort();
}

describe("data lifecycle coverage", () => {
  it("workspace deletion covers every table holding company data", () => {
    // fieldUploadQuota has no companyId; it's deleted with each crew member.
    expect(companyTables()).toEqual([...DELETION_ORDER].sort());
  });

  it("the export covers every company table, except deliberate exclusions", () => {
    const NOT_EXPORTED: Record<string, string> = {
      invites: "pending invite emails; internal workspace admin, not business data",
      pinAttempts: "security throttle counters",
      aiUsage: "billing-style meter; shown in Settings",
    };
    const covered = new Set<string>([...EXPORT_TABLES, ...Object.keys(NOT_EXPORTED)]);
    expect(companyTables().filter((t) => !covered.has(t))).toEqual([]);
  });
});
