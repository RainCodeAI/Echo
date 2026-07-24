import { beforeEach, describe, expect, it } from "vitest";
import {
  buildFieldVerificationToken,
  parseFieldVerificationToken,
  verifyFieldToken,
} from "../convex/lib/fieldSession";
import type { Id } from "../convex/_generated/dataModel";

const companyId = "company_123" as Id<"companies">;
const teamMemberId = "member_456" as Id<"teamMembers">;
const SECRET = "test-entry-secret-please-32-bytes-long!!";

beforeEach(() => {
  process.env.ENTRY_TOKEN_SECRET = SECRET;
});

describe("field verification token", () => {
  it("round-trips a valid token", async () => {
    const token = await buildFieldVerificationToken(companyId, teamMemberId);
    const parsed = await verifyFieldToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed?.companyId).toBe(companyId);
    expect(parsed?.teamMemberId).toBe(teamMemberId);
  });

  it("rejects a tampered signature", async () => {
    const token = await buildFieldVerificationToken(companyId, teamMemberId);
    const flipped = token.at(-1) === "0" ? "1" : "0";
    const tampered = token.slice(0, -1) + flipped;
    expect(await verifyFieldToken(tampered)).toBeNull();
  });

  it("rejects a tampered payload (swapped team member)", async () => {
    const token = await buildFieldVerificationToken(companyId, teamMemberId);
    const parts = token.split(":");
    parts[2] = "member_evil";
    expect(await verifyFieldToken(parts.join(":"))).toBeNull();
  });

  it("rejects an expired token (older than the TTL)", async () => {
    const issuedAt = Date.now() - 16 * 60 * 1000;
    const token = await buildFieldVerificationToken(
      companyId,
      teamMemberId,
      issuedAt,
    );
    expect(await verifyFieldToken(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await buildFieldVerificationToken(companyId, teamMemberId);
    process.env.ENTRY_TOKEN_SECRET = "a-totally-different-secret-value-32b!!";
    expect(await verifyFieldToken(token)).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyFieldToken("garbage")).toBeNull();
    expect(await verifyFieldToken("echo-entry:only:three:parts")).toBeNull();
    expect(parseFieldVerificationToken("wrongprefix:a:b:1:sig")).toBeNull();
    expect(parseFieldVerificationToken("echo-entry:a:b:notanumber:sig")).toBeNull();
  });
});
