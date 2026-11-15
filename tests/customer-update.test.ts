import { describe, expect, it } from "vitest";
import {
  buildCustomerUpdatePrompt,
  firstName,
  mailtoHref,
  MAX_NOTES,
  sanitizeDraft,
  selectNotes,
  smsHref,
  smsSegments,
} from "../convex/lib/customerUpdate";

const DAY = 86_400_000;

describe("firstName", () => {
  it("greets by first name, or neutrally", () => {
    expect(firstName("Maria Ramirez")).toBe("Maria");
    expect(firstName("  José  García ")).toBe("José");
    expect(firstName("The Ramirez Family")).toBeNull();
    expect(firstName("Mr. Chen")).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});

describe("selectNotes", () => {
  const notes = Array.from({ length: 12 }, (_, i) => ({ noteId: `n${i}`, recordedAt: i * DAY }));
  it("takes notes since the last update, newest kept, oldest first, always the start note", () => {
    const got = selectNotes(notes, { startNoteId: "n2", since: 8 * DAY });
    expect(got.map((n) => n.noteId)).toEqual(["n2", "n9", "n10", "n11"]);
  });
  it("caps the number of notes", () => {
    const got = selectNotes(notes, { startNoteId: "n11", since: -1 });
    expect(got).toHaveLength(MAX_NOTES);
    expect(got.at(-1)?.noteId).toBe("n11");
  });
});

describe("buildCustomerUpdatePrompt", () => {
  it("includes customer, job, site and dated notes in the company's timezone", () => {
    const p = buildCustomerUpdatePrompt({
      companyName: "Acme Roofing",
      customerName: "The Ramirez Family",
      jobTitle: "Ramirez reroof",
      address: "12 Oak St",
      timeZone: "America/Los_Angeles",
      notes: [{ noteId: "n1", recordedAt: Date.UTC(2026, 10, 15, 3), summary: "Found rot.", timelineNotes: "Back Tuesday" }],
    });
    expect(p).toContain('Customer: (no name on file: use a neutral greeting like "Hi there")');
    expect(p).toContain("Site: 12 Oak St");
    expect(p).toContain("- Sat, Nov 14: Found rot.\n  Timing: Back Tuesday");
  });
});

describe("sanitizeDraft", () => {
  it("fills placeholders with the company name and trims", () => {
    const d = sanitizeDraft(
      { text: "  Hi Maria, roof is on.\n\n\n\n– [Your Name]  ", emailSubject: "Roof\nupdate", emailBody: "Hi Maria,\nDone.\n[Company Name]" },
      "Acme Roofing",
    );
    expect(d).toEqual({
      text: "Hi Maria, roof is on.\n\n- Acme Roofing",
      emailSubject: "Roof update",
      emailBody: "Hi Maria,\nDone.\nAcme Roofing",
    });
  });
  it("fills a missing part from the other, and rejects empty output", () => {
    expect(sanitizeDraft({ emailBody: "Hi,\nAll done." }, "Acme")).toEqual({
      text: "Hi, All done.",
      emailSubject: "Update on your project",
      emailBody: "Hi,\nAll done.",
    });
    expect(() => sanitizeDraft({ text: "  " }, "Acme")).toThrow(/usable/);
    expect(() => sanitizeDraft("nope", "Acme")).toThrow(/usable/);
  });
  it("keeps the text message in the plain SMS alphabet (email keeps typography)", () => {
    const d = sanitizeDraft({ text: "We’re “done” – see you…", emailSubject: "s", emailBody: "We’re done – thanks" }, "A");
    expect(d.text).toBe(`We're "done" - see you...`);
    expect(smsSegments(d.text)).toBe(1);
    expect(d.emailBody).toBe("We’re done – thanks");
  });
  it("caps lengths", () => {
    const d = sanitizeDraft({ text: "x".repeat(5000), emailSubject: "s".repeat(500), emailBody: "b".repeat(9000) }, "A");
    expect([d.text.length, d.emailSubject.length, d.emailBody.length]).toEqual([640, 120, 4000]);
  });
});

describe("sending links", () => {
  it("sms: link works on iOS and Android, strips formatting from the number", () => {
    expect(smsHref("(555) 010-2000", "Hi & bye")).toBe("sms:5550102000?&body=Hi%20%26%20bye");
    expect(smsHref("+1 555 010 2000", "x")).toBe("sms:+15550102000?&body=x");
  });
  it("mailto: link with subject and body", () => {
    expect(mailtoHref("maria@example.com", "Roof update", "Hi Maria,\nDone.")).toBe(
      "mailto:maria@example.com?subject=Roof%20update&body=Hi%20Maria%2C%0ADone.",
    );
  });
  it("counts SMS segments", () => {
    expect(smsSegments("")).toBe(0);
    expect(smsSegments("a".repeat(160))).toBe(1);
    expect(smsSegments("a".repeat(161))).toBe(2);
    expect(smsSegments("é".repeat(10))).toBe(1);
    expect(smsSegments("✓".repeat(71))).toBe(2);
  });
});
