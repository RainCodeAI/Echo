import { sendEmail } from "./alertProviders";

/**
 * Digest delivery shared by the hourly runner ("use node") and the
 * "Send digest now" action, kept free of Convex function definitions so both
 * runtimes can import it.
 */

export type DigestPayload = {
  companyName: string;
  recipient: string | null;
  quiet: boolean;
  email: { subject: string; text: string; html: string };
};

/** Send one company's digest (shared by the cron runner and "Send digest now"). */
export async function deliverDigest(
  p: DigestPayload,
  opts: { force: boolean },
): Promise<string> {
  if (p.quiet && !opts.force) return "quiet";
  if (!p.recipient) return "no_recipient";
  const result = await sendEmail({ to: p.recipient, ...p.email }, process.env);
  if (result.status === "sent") return "sent";
  if (result.status === "not_configured") return "not_configured";
  return `failed: ${result.detail}`;
}
