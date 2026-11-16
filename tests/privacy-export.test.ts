import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { csvCell, toCsv } from "../convex/lib/csv";
import { deletionConfirmationMatches, DELETION_ORDER, recordingNotice } from "../convex/lib/privacy";
import { buildExportFiles, EXPORT_TABLES, type ExportTables } from "../lib/export/format";
import { buildExportZip } from "../lib/export/build-export";

describe("privacy helpers", () => {
  it("deletion confirmation ignores case and extra spaces, never matches empty", () => {
    expect(deletionConfirmationMatches("  acme   ROOFING ", "Acme Roofing")).toBe(true);
    expect(deletionConfirmationMatches("Acme", "Acme Roofing")).toBe(false);
    expect(deletionConfirmationMatches("", "")).toBe(false);
  });
  it("the recording notice names the company and asks for consent before recording others", () => {
    const text = recordingNotice("Acme Roofing").join(" ");
    expect(text).toContain("Acme Roofing");
    expect(text).toMatch(/ask them first/);
    expect(text).toMatch(/AI service/);
  });
  it("deletes field access first and the office users last", () => {
    expect(DELETION_ORDER[0]).toBe("teamMembers");
    expect(DELETION_ORDER.at(-1)).toBe("users");
  });
});

describe("csv", () => {
  it("quotes and neutralizes formulas", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("-5 bundles")).toBe("'-5 bundles");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
    expect(toCsv([["a", 1], [true, undefined]])).toBe("a,1\r\ntrue,\r\n");
  });
});

const T = Date.UTC(2026, 10, 14, 15);
function sample(): ExportTables {
  return {
    voiceNotes: [
      {
        _id: "n1", recordedAt: T, teamMemberId: "m1", jobId: "j1", leadId: "l1", status: "reviewed", urgency: "high",
        aiTitle: "Rot by chimney", aiSummary: "Found soft decking.", rawTranscript: "decking is soft, =SUM(A1)", ownerNote: "call Maria",
        materials: [{ name: "OSB", quantity: "6", unit: "sheets" }], audioMimeType: "audio/webm", audioUrl: "https://files/n1",
        actionItems: [
          { title: "Order OSB", priority: "high", assignee: { kind: "member", id: "m1" } },
          { title: "Call Maria", assignee: { kind: "user", id: "u1" }, completed: true, completedAt: T },
        ],
      },
    ],
    voiceNotePhotos: [{ _id: "p1", voiceNoteId: "n1", url: "https://files/p1" }],
    leads: [{ _id: "l1", customerName: "Maria Ramirez", phone: "555", status: "scheduled" }],
    jobs: [{ _id: "j1", title: "Ramirez reroof", leadId: "l1", status: "in_progress" }],
    teamMembers: [{ _id: "m1", name: "Luis", isActive: true, noticeAcceptedAt: T }],
    users: [{ _id: "u1", name: "Dana", email: "d@a.com", role: "owner" }],
    materialOrders: [{ _id: "o1", jobId: "j1", createdBy: "u1", createdAt: T, lines: [{ name: "OSB", quantity: "6 sheets" }] }],
    customerUpdates: [{ _id: "c1", jobId: "j1", status: "sent", sentVia: "text", sentAt: T, createdAt: T, text: "Hi Maria" }],
    alerts: [{ _id: "a1", channel: "email", status: "sent" }],
  };
}

describe("buildExportFiles", () => {
  const files = buildExportFiles(sample(), { companyName: "Acme Roofing", exportedAt: T });
  const rows = (name: string) => files[name].trim().split("\r\n");

  it("writes every expected file", () => {
    expect(Object.keys(files).sort()).toEqual([
      "README.txt", "action-items.csv", "crew.csv", "customer-updates.csv", "data.json", "jobs.csv", "leads.csv",
      "materials-orders.csv", "media-links.csv", "notes.csv", "office-users.csv",
    ]);
  });
  it("notes.csv resolves names and guards formulas", () => {
    const [header, row] = rows("notes.csv");
    expect(header.split(",").slice(0, 4)).toEqual(["recorded_at", "crew", "job", "lead"]);
    expect(row).toContain("2026-11-14T15:00:00.000Z,Luis,Ramirez reroof,Maria Ramirez,reviewed,high,Rot by chimney");
    expect(row).toContain(`"decking is soft, =SUM(A1)"`);
    expect(row).toContain("OSB 6 sheets");
    expect(row).toContain("Order OSB; Call Maria");
  });
  it("action items show who and whether done", () => {
    expect(rows("action-items.csv").slice(1)).toEqual([
      "n1,2026-11-14T15:00:00.000Z,Order OSB,high,Luis,no,",
      "n1,2026-11-14T15:00:00.000Z,Call Maria,,Dana,yes,2026-11-14T15:00:00.000Z",
    ]);
  });
  it("media links point at files inside the zip", () => {
    expect(rows("media-links.csv").slice(1)).toEqual([
      "audio,n1,audio/2026-11-14-n1.webm,https://files/n1",
      "photo,n1,photos/n1-p1.jpg,https://files/p1",
    ]);
  });
  it("data.json keeps the raw tables", () => {
    const data = JSON.parse(files["data.json"]);
    expect(data.workspace).toBe("Acme Roofing");
    expect(Object.keys(data.tables)).toEqual([...EXPORT_TABLES]);
  });
});

describe("buildExportZip", () => {
  function fakeClient(tables: ExportTables) {
    const calls: { table: string; cursor: string | null }[] = [];
    return {
      calls,
      client: {
        async query(_ref: unknown, args: { table: keyof ExportTables; cursor: string | null }) {
          calls.push(args);
          const rows = tables[args.table];
          // Two pages for notes, to exercise the cursor loop.
          if (args.table === "voiceNotes" && args.cursor === null) return { rows: [], isDone: false, continueCursor: "next" };
          return { rows, isDone: true, continueCursor: "" };
        },
      },
    };
  }

  it("pages through every table and zips the files, with media when asked", async () => {
    const { client, calls } = fakeClient(sample());
    const fetched: string[] = [];
    const stages: string[] = [];
    const out = await buildExportZip(client as never, {
      companyName: "Acme Roofing!",
      includeMedia: true,
      onProgress: (p) => stages.push(p.stage),
      fetchImpl: (async (url: string) => {
        fetched.push(url);
        if (url.endsWith("p1")) return new Response("nope", { status: 404 });
        return new Response(new Uint8Array([1, 2, 3]));
      }) as typeof fetch,
    });
    expect(calls.filter((c) => c.table === "voiceNotes").map((c) => c.cursor)).toEqual([null, "next"]);
    expect(out.filename).toMatch(/^echo-export-acme-roofing-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(out.mediaFailed).toBe(1);
    expect(fetched.sort()).toEqual(["https://files/n1", "https://files/p1"]);
    expect(stages).toContain("Zipping");

    const unzipped = unzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    expect(Array.from(unzipped["audio/2026-11-14-n1.webm"])).toEqual([1, 2, 3]);
    expect(unzipped["photos/n1-p1.jpg"]).toBeUndefined();
    expect(strFromU8(unzipped["media-errors.txt"])).toContain("photos/n1-p1.jpg");
    expect(strFromU8(unzipped["notes.csv"])).toContain("Rot by chimney");
  });

  it("skips media unless asked", async () => {
    const { client } = fakeClient(sample());
    let fetches = 0;
    const out = await buildExportZip(client as never, {
      companyName: "Acme",
      includeMedia: false,
      fetchImpl: (async () => {
        fetches++;
        return new Response("");
      }) as typeof fetch,
    });
    const unzipped = unzipSync(new Uint8Array(await out.blob.arrayBuffer()));
    expect(fetches).toBe(0);
    expect(Object.keys(unzipped).some((k) => k.startsWith("audio/"))).toBe(false);
    expect(unzipped["media-links.csv"]).toBeDefined();
  });
});
