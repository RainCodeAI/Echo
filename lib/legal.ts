import { TERMS_VERSION } from "@/convex/lib/privacy";

/**
 * Legal page settings. The policy text in app/privacy and app/terms is a
 * starting draft: fill these in and have counsel review it before launch,
 * then set NEXT_PUBLIC_LEGAL_REVIEWED=1 to drop the draft banner.
 */
export const LEGAL = {
  version: TERMS_VERSION,
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY || "[Company legal name]",
  contactEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || "[privacy contact email]",
  governingLaw: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION || "[State / country]",
  reviewed: process.env.NEXT_PUBLIC_LEGAL_REVIEWED === "1",
};

/** Services that process workspace data (keep in sync with DEPLOY.md). */
export const SUBPROCESSORS = [
  { name: "Convex", purpose: "Database and file storage (recordings, photos, notes)", always: true },
  { name: "Clerk", purpose: "Sign-in for owners and office staff", always: true },
  { name: "OpenAI", purpose: "Transcription, note structuring and draft writing (API)", always: true },
  { name: "Vercel", purpose: "Web hosting", always: true },
  { name: "Resend", purpose: "Email alerts and daily digests, if you turn them on", always: false },
  { name: "Twilio", purpose: "Text-message alerts to the owner, if you turn them on", always: false },
  { name: "Sentry", purpose: "Error monitoring (no request bodies or personal details)", always: false },
];
