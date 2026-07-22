import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";

/**
 * Lightweight field-entry session check (PIN → short-lived token).
 * Not HMAC yet — good enough for MVP walkthrough; harden before production.
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_PREFIX = "echo-entry";

type AnyCtx = QueryCtx | MutationCtx;

export type FieldSession = {
  companyId: Id<"companies">;
  teamMemberId: Id<"teamMembers">;
  member: Doc<"teamMembers">;
  company: Doc<"companies">;
};

export function buildFieldVerificationToken(
  companyId: Id<"companies">,
  teamMemberId: Id<"teamMembers">,
  now = Date.now(),
): string {
  return `${TOKEN_PREFIX}:${companyId}:${teamMemberId}:${now}`;
}

export function parseFieldVerificationToken(token: string): {
  companyId: string;
  teamMemberId: string;
  issuedAt: number;
} | null {
  const parts = token.split(":");
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const issuedAt = Number(parts[3]);
  if (!Number.isFinite(issuedAt)) return null;
  return {
    companyId: parts[1],
    teamMemberId: parts[2],
    issuedAt,
  };
}

export async function requireFieldSession(
  ctx: AnyCtx,
  args: {
    companyId: Id<"companies">;
    teamMemberId: Id<"teamMembers">;
    verificationToken: string;
  },
): Promise<FieldSession> {
  const parsed = parseFieldVerificationToken(args.verificationToken);
  if (!parsed) {
    throw new Error("Session expired or invalid. Re-enter your PIN.");
  }

  if (
    parsed.companyId !== args.companyId ||
    parsed.teamMemberId !== args.teamMemberId
  ) {
    throw new Error("Session expired or invalid. Re-enter your PIN.");
  }

  if (Date.now() - parsed.issuedAt > TOKEN_TTL_MS) {
    throw new Error("Session expired. Re-enter your PIN.");
  }

  const company = await ctx.db.get(args.companyId);
  if (!company) {
    throw new Error("Company not found.");
  }

  const member = await ctx.db.get(args.teamMemberId);
  if (
    !member ||
    member.companyId !== args.companyId ||
    !member.isActive
  ) {
    throw new Error("Crew member is inactive or not found. Ask your owner.");
  }

  return {
    companyId: args.companyId,
    teamMemberId: args.teamMemberId,
    member,
    company,
  };
}
