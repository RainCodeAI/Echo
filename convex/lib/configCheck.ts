/**
 * Deployment configuration check (pure, testable). Reports presence/strength
 * of required settings — never their values.
 *
 * Run against a deployment:
 *   npx convex run ops:checkConfig          (dev)
 *   npx convex run ops:checkConfig --prod   (production)
 */

export type ConfigCheck = {
  name: string;
  ok: boolean;
  /** "required" failures block launch; "recommended" are warnings. */
  level: "required" | "recommended";
  detail: string;
};

type Env = Record<string, string | undefined>;

export function evaluateConfig(env: Env): {
  ready: boolean;
  checks: ConfigCheck[];
} {
  const checks: ConfigCheck[] = [];
  const add = (
    name: string,
    ok: boolean,
    level: ConfigCheck["level"],
    detail: string,
  ) => checks.push({ name, ok, level, detail });

  const entrySecret = env.ENTRY_TOKEN_SECRET ?? "";
  add(
    "ENTRY_TOKEN_SECRET",
    entrySecret.length >= 32,
    "required",
    entrySecret.length === 0
      ? "Missing — field tokens fall back to a public dev secret and are forgeable."
      : entrySecret.length < 32
        ? `Too short (${entrySecret.length} chars); use 32+ random bytes.`
        : "Set.",
  );

  const issuer = env.CLERK_JWT_ISSUER_DOMAIN ?? "";
  add(
    "CLERK_JWT_ISSUER_DOMAIN",
    /^https:\/\/\S+$/.test(issuer),
    "required",
    issuer ? (issuer.startsWith("https://") ? "Set." : "Must be an https:// URL.") : "Missing — owner sign-in will fail.",
  );

  const openaiKey = env.OPENAI_API_KEY ?? "";
  add(
    "OPENAI_API_KEY",
    openaiKey.startsWith("sk-"),
    "required",
    openaiKey ? (openaiKey.startsWith("sk-") ? "Set." : "Does not look like an OpenAI key (expected sk-…).") : "Missing — every note will fail AI processing.",
  );

  const killSwitch = env.OPENAI_KILL_SWITCH === "1" || env.OPENAI_KILL_SWITCH === "true";
  add(
    "OPENAI_KILL_SWITCH",
    !killSwitch,
    "recommended",
    killSwitch ? "ON — AI is disabled for all notes." : "Off.",
  );

  add(
    "OPENAI_MODEL",
    true,
    "recommended",
    env.OPENAI_MODEL ? `Override: ${env.OPENAI_MODEL}` : "Default (gpt-4o-mini).",
  );
  add(
    "OPENAI_TRANSCRIBE_MODEL",
    true,
    "recommended",
    env.OPENAI_TRANSCRIBE_MODEL
      ? `Override: ${env.OPENAI_TRANSCRIBE_MODEL}`
      : "Default (whisper-1).",
  );

  const ready = checks.every((c) => c.ok || c.level !== "required");
  return { ready, checks };
}
