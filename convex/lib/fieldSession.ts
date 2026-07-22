import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import { safeEqualHex } from "./pin";

/**
 * Field-entry session tokens (PIN → short-lived signed token).
 *
 * Hardened: the token is HMAC-SHA256 signed with `ENTRY_TOKEN_SECRET` so a
 * field worker cannot be impersonated by anyone who merely knows the public
 * `companyId` (printed on QR codes) and a `teamMemberId`. Without a valid
 * signature the token is rejected, so `createFromField` / upload URLs cannot
 * be called without first passing `verifyPin`.
 *
 * Set the secret on the Convex deployment before production:
 *   npx convex env set ENTRY_TOKEN_SECRET <random 32+ byte string>
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_PREFIX = "echo-entry";

/**
 * Dev-only fallback so the field flow works locally before a secret is set.
 * This is NOT secret (it lives in the repo) — production MUST set
 * ENTRY_TOKEN_SECRET so tokens are actually unforgeable.
 */
const DEV_FALLBACK_SECRET = "echo-dev-insecure-entry-secret-set-ENTRY_TOKEN_SECRET";

type AnyCtx = QueryCtx | MutationCtx;

export type FieldSession = {
  companyId: Id<"companies">;
  teamMemberId: Id<"teamMembers">;
  member: Doc<"teamMembers">;
  company: Doc<"companies">;
};

function getEntrySecret(): string {
  const secret = process.env.ENTRY_TOKEN_SECRET;
  if (secret && secret.length >= 16) return secret;
  console.warn(
    "[fieldSession] ENTRY_TOKEN_SECRET is not set (or too short). Using an " +
      "insecure dev fallback. Set it before production: " +
      "`npx convex env set ENTRY_TOKEN_SECRET <random 32+ byte string>`.",
  );
  return DEV_FALLBACK_SECRET;
}

/** HMAC-SHA256 hex signature of `message` under the entry secret. */
async function signMessage(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getEntrySecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function payload(
  companyId: Id<"companies">,
  teamMemberId: Id<"teamMembers">,
  issuedAt: number,
): string {
  return `${TOKEN_PREFIX}:${companyId}:${teamMemberId}:${issuedAt}`;
}

/** Build a signed field-entry token. Async because signing is async. */
export async function buildFieldVerificationToken(
  companyId: Id<"companies">,
  teamMemberId: Id<"teamMembers">,
  now = Date.now(),
): Promise<string> {
  const message = payload(companyId, teamMemberId, now);
  const signature = await signMessage(message);
  return `${message}:${signature}`;
}

type ParsedToken = {
  companyId: string;
  teamMemberId: string;
  issuedAt: number;
  signature: string;
};

function parseFieldVerificationToken(token: string): ParsedToken | null {
  const parts = token.split(":");
  if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) return null;
  const issuedAt = Number(parts[3]);
  if (!Number.isFinite(issuedAt)) return null;
  return {
    companyId: parts[1],
    teamMemberId: parts[2],
    issuedAt,
    signature: parts[4],
  };
}

/** Verify structure, signature, and freshness of a field token. */
async function verifyFieldToken(token: string): Promise<ParsedToken | null> {
  const parsed = parseFieldVerificationToken(token);
  if (!parsed) return null;

  const expected = await signMessage(
    payload(
      parsed.companyId as Id<"companies">,
      parsed.teamMemberId as Id<"teamMembers">,
      parsed.issuedAt,
    ),
  );
  if (!safeEqualHex(parsed.signature, expected)) return null;

  if (Date.now() - parsed.issuedAt > TOKEN_TTL_MS) return null;

  return parsed;
}

export async function requireFieldSession(
  ctx: AnyCtx,
  args: {
    companyId: Id<"companies">;
    teamMemberId: Id<"teamMembers">;
    verificationToken: string;
  },
): Promise<FieldSession> {
  const parsed = await verifyFieldToken(args.verificationToken);
  if (!parsed) {
    throw new Error("Session expired or invalid. Re-enter your PIN.");
  }

  if (
    parsed.companyId !== args.companyId ||
    parsed.teamMemberId !== args.teamMemberId
  ) {
    throw new Error("Session expired or invalid. Re-enter your PIN.");
  }

  const company = await ctx.db.get(args.companyId);
  if (!company) {
    throw new Error("Company not found.");
  }

  const member = await ctx.db.get(args.teamMemberId);
  if (!member || member.companyId !== args.companyId || !member.isActive) {
    throw new Error("Crew member is inactive or not found. Ask your owner.");
  }

  return {
    companyId: args.companyId,
    teamMemberId: args.teamMemberId,
    member,
    company,
  };
}
