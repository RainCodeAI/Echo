/**
 * Alert delivery providers — plain HTTP calls, no SDKs (works in the default
 * Convex runtime). `fetch` is injectable for tests.
 *
 * Email: Resend   (RESEND_API_KEY, ALERT_FROM_EMAIL)
 * SMS:   Twilio   (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER)
 *
 * A channel without its keys reports "not_configured" instead of failing, so
 * the app works before accounts exist. Swapping providers means replacing one
 * function here.
 */

type Env = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export type SendResult =
  | { status: "sent"; providerId?: string }
  | { status: "not_configured"; detail: string }
  | { status: "failed"; detail: string };

async function errorDetail(res: Response): Promise<string> {
  let text = "";
  try {
    text = (await res.text()).slice(0, 300);
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}${text ? `: ${text}` : ""}`;
}

export function emailConfigured(env: Env) {
  return !!(env.RESEND_API_KEY && env.ALERT_FROM_EMAIL);
}

export function smsConfigured(env: Env) {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

export async function sendEmail(
  msg: { to: string; subject: string; text: string; html: string },
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!emailConfigured(env)) {
    return { status: "not_configured", detail: "Set RESEND_API_KEY and ALERT_FROM_EMAIL." };
  }
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.ALERT_FROM_EMAIL,
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
    });
    if (!res.ok) return { status: "failed", detail: await errorDetail(res) };
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: "sent", providerId: json.id };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendSms(
  msg: { to: string; body: string },
  env: Env,
  fetchImpl: FetchLike = fetch,
): Promise<SendResult> {
  if (!smsConfigured(env)) {
    return {
      status: "not_configured",
      detail: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.",
    };
  }
  const sid = env.TWILIO_ACCOUNT_SID as string;
  try {
    const res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${sid}:${env.TWILIO_AUTH_TOKEN}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: msg.to,
          From: env.TWILIO_FROM_NUMBER as string,
          Body: msg.body,
        }).toString(),
      },
    );
    if (!res.ok) return { status: "failed", detail: await errorDetail(res) };
    const json = (await res.json().catch(() => ({}))) as { sid?: string };
    return { status: "sent", providerId: json.sid };
  } catch (err) {
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
