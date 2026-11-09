/**
 * Field-session persistence on the device (localStorage).
 *
 * Two separate things are stored per company:
 *  - `active`: who is recording right now. Survives a reload so a worker isn't
 *    asked for their PIN again mid-shift. "Switch user" clears it.
 *  - `tokens`: the latest verification token per crew member. Kept even after
 *    "Switch user" so notes that member already queued can still be sent
 *    (a token only lets the queue submit notes *as that member*, and the
 *    server re-checks the member is active on every call).
 *
 * The server is authoritative for expiry; the client-side check below only
 * avoids sending requests that are certain to fail.
 */

/** Mirrors TOKEN_TTL_MS in convex/lib/fieldSession.ts. */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** Treat tokens as expired slightly early to avoid racing the server. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export type StoredMember = {
  id: string;
  name: string;
  verificationToken: string;
};

type CompanySessions = {
  active: string | null;
  members: Record<string, StoredMember>;
};

/** Minimal Storage interface so tests can pass an in-memory implementation. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function key(companyId: string) {
  return `echo.field.${companyId}`;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // Storage blocked (privacy settings).
  }
}

/** Issue time encoded in `echo-entry:<company>:<member>:<issuedAt>:<sig>`. */
export function tokenIssuedAt(token: string): number | null {
  const parts = token.split(":");
  if (parts.length !== 5 || parts[0] !== "echo-entry") return null;
  const issuedAt = Number(parts[3]);
  return Number.isFinite(issuedAt) ? issuedAt : null;
}

export function isTokenFresh(token: string, now = Date.now()): boolean {
  const issuedAt = tokenIssuedAt(token);
  if (issuedAt === null) return false;
  return now - issuedAt < TOKEN_TTL_MS - EXPIRY_MARGIN_MS;
}

function read(
  companyId: string,
  storage: KeyValueStorage | null,
): CompanySessions {
  const empty: CompanySessions = { active: null, members: {} };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(key(companyId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<CompanySessions>;
    return {
      active: typeof parsed.active === "string" ? parsed.active : null,
      members:
        parsed.members && typeof parsed.members === "object"
          ? parsed.members
          : {},
    };
  } catch {
    return empty;
  }
}

function write(
  companyId: string,
  data: CompanySessions,
  storage: KeyValueStorage | null,
) {
  if (!storage) return;
  try {
    storage.setItem(key(companyId), JSON.stringify(data));
  } catch {
    /* Quota or privacy mode — in-memory session still works for this page. */
  }
}

/** Drop expired tokens so the store doesn't grow with old shifts. */
function prune(data: CompanySessions, now: number): CompanySessions {
  const members: Record<string, StoredMember> = {};
  for (const [id, m] of Object.entries(data.members)) {
    if (isTokenFresh(m.verificationToken, now)) members[id] = m;
  }
  const active = data.active && members[data.active] ? data.active : null;
  return { active, members };
}

/** Remember a successful PIN entry and make that member the active one. */
export function saveSession(
  companyId: string,
  member: StoredMember,
  storage = defaultStorage(),
  now = Date.now(),
) {
  const data = prune(read(companyId, storage), now);
  data.members[member.id] = member;
  data.active = member.id;
  write(companyId, data, storage);
}

/** The member who was recording before a reload, if their token is still good. */
export function loadActiveSession(
  companyId: string,
  storage = defaultStorage(),
  now = Date.now(),
): StoredMember | null {
  const data = prune(read(companyId, storage), now);
  return data.active ? (data.members[data.active] ?? null) : null;
}

/** "Switch user": stop auto-resuming this member, but keep their token for the queue. */
export function clearActiveSession(companyId: string, storage = defaultStorage()) {
  const data = read(companyId, storage);
  write(companyId, { ...data, active: null }, storage);
}

/** Token for a specific member (used by the queue), or null if missing/expired. */
export function getMemberToken(
  companyId: string,
  teamMemberId: string,
  storage = defaultStorage(),
  now = Date.now(),
): string | null {
  const m = read(companyId, storage).members[teamMemberId];
  return m && isTokenFresh(m.verificationToken, now) ? m.verificationToken : null;
}
