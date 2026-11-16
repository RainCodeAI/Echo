"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SERVICE_TYPES } from "@/lib/constants";
import type { ServiceType } from "@/types";

/**
 * Editable company profile. `primaryTrade` here feeds the AI structuring
 * prompt, so setting it improves extraction quality for the workspace.
 */
export function CompanyProfileForm() {
  const company = useQuery(api.companies.current, {});
  const me = useQuery(api.users.current, {});
  const isOwner = me?.role === "owner";
  const update = useMutation(api.companies.update);

  const [name, setName] = useState("");
  const [primaryTrade, setPrimaryTrade] = useState<ServiceType | "">("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [alertPhone, setAlertPhone] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState(7);
  const sendDigestNow = useAction(api.digest.sendNow);
  const [digestPending, setDigestPending] = useState(false);
  const [digestResult, setDigestResult] = useState<string | null>(null);
  const sendTestAlert = useAction(api.alerts.sendTestAlert);
  const [testPending, setTestPending] = useState(false);
  const [testResults, setTestResults] = useState<
    { channel: string; recipient: string; status: string; detail: string | null }[] | null
  >(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the form once the company loads (or changes reactively).
  useEffect(() => {
    if (!company) return;
    setName(company.name ?? "");
    setPrimaryTrade((company.primaryTrade as ServiceType | undefined) ?? "");
    setPhone(company.phone ?? "");
    setEmail(company.email ?? "");
    setTimezone(company.timezone ?? "");
    setNotificationEmail(company.notificationEmail ?? "");
    setNotificationsEnabled(company.notificationsEnabled ?? false);
    setAlertPhone(company.alertPhone ?? "");
    setDigestEnabled(company.digestEnabled ?? false);
    setDigestHour(company.digestHour ?? 7);
  }, [company]);

  if (company === undefined) {
    return <Skeleton className="h-72 w-full" />;
  }
  if (company === null) {
    return (
      <p className="text-sm text-muted-foreground">Provisioning workspace…</p>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await update({
        name: name.trim() || undefined,
        primaryTrade: primaryTrade || undefined,
        phone: phone.trim(),
        email: email.trim(),
        timezone: timezone.trim(),
        notificationEmail: notificationEmail.trim(),
        alertPhone: alertPhone.trim(),
        notificationsEnabled,
        digestEnabled,
        digestHour,
      });
      setMessage("Saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {me && !isOwner ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
          Only the workspace owner can change company settings.
        </p>
      ) : null}
      <fieldset disabled={!isOwner} className="space-y-5 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Landscaping"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="primary-trade">Primary trade</Label>
            <select
              id="primary-trade"
              value={primaryTrade}
              onChange={(e) =>
                setPrimaryTrade(e.target.value as ServiceType | "")
              }
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Not set</option>
              {SERVICE_TYPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Used as trade context in AI note structuring.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-phone">Phone</Label>
            <Input
              id="company-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-email">Email</Label>
            <Input
              id="company-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="office@acme.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-timezone">Timezone</Label>
            <Input
              id="company-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/New_York"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notification-email">Alert email</Label>
            <Input
              id="notification-email"
              type="email"
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.target.value)}
              placeholder="alerts@acme.com"
            />
            <p className="text-xs text-muted-foreground">
              Blank = the owner&apos;s sign-in email.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="alert-phone">Alert mobile (texts)</Label>
            <Input
              id="alert-phone"
              type="tel"
              inputMode="tel"
              value={alertPhone}
              onChange={(e) => setAlertPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-lg border bg-muted/30 px-3 py-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            checked={notificationsEnabled}
            onChange={(e) => setNotificationsEnabled(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">Urgent alerts</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Text and/or email you within a minute when a crew member flags a
              note urgent, or the AI rates it high or emergency. One alert per
              note, at most 20 an hour.
            </span>
          </span>
        </label>

        <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              checked={digestEnabled}
              onChange={(e) => {
                setDigestEnabled(e.target.checked);
                // The digest goes out at a local hour: default the timezone
                // to this browser's if none is set yet.
                if (e.target.checked && !timezone.trim()) {
                  try {
                    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
                  } catch {
                    /* leave blank */
                  }
                }
              }}
            />
            <span className="text-sm">
              <span className="font-medium">Daily digest email</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                One email each morning: notes from the last 24 hours, what needs
                you, urgent items and materials requested. Skipped on quiet days.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-2 pl-7 text-sm">
            <Label htmlFor="digest-hour" className="font-normal">
              Send at
            </Label>
            <select
              id="digest-hour"
              value={digestHour}
              disabled={!digestEnabled}
              onChange={(e) => setDigestHour(Number(e.target.value))}
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              {[4, 5, 6, 7, 8, 9, 10, 17, 18, 19].map((h) => (
                <option key={h} value={h}>
                  {h === 12 ? "12 pm" : h > 12 ? `${h - 12} pm` : `${h} am`}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              {timezone.trim() ? `(${timezone.trim()})` : "(set a timezone above)"}
            </span>
          </div>
          {company.lastDigestStatus ? (
            <p className="pl-7 text-xs text-muted-foreground" data-testid="digest-last">
              Last digest
              {company.lastDigestAt
                ? ` ${new Date(company.lastDigestAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                : ""}
              : {company.lastDigestStatus === "quiet" ? "skipped (quiet day)" : company.lastDigestStatus}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save profile"
            )}
          </Button>
          {message ? (
            <span className="text-sm text-primary">{message}</span>
          ) : null}
          {error ? (
            <span className="text-sm text-destructive">{error}</span>
          ) : null}
        </div>

        <div className="space-y-2 rounded-lg border px-3 py-3" data-testid="test-alert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-medium">Check your alerts and digest</span>
              <span className="block text-xs text-muted-foreground">
                Sends a test to the saved email and mobile. Save changes first.
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testPending}
              onClick={async () => {
                setTestPending(true);
                setTestError(null);
                setTestResults(null);
                try {
                  setTestResults(await sendTestAlert({}));
                } catch (err) {
                  setTestError(err instanceof Error ? err.message : "Test failed.");
                } finally {
                  setTestPending(false);
                }
              }}
            >
              {testPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send test alert
            </Button>
          </div>
          {testError ? <p className="text-sm text-destructive">{testError}</p> : null}
          {testResults ? (
            <ul className="space-y-1 text-sm">
              {testResults.map((r) => (
                <li key={r.channel} className="flex flex-wrap gap-x-2">
                  <span className="font-medium">
                    {r.channel === "sms" ? "Text" : "Email"} to {r.recipient}:
                  </span>
                  <span
                    className={
                      r.status === "sent"
                        ? "text-primary"
                        : r.status === "not_configured"
                          ? "text-amber-700"
                          : "text-destructive"
                    }
                  >
                    {r.status === "sent"
                      ? "sent ✓"
                      : r.status === "not_configured"
                        ? "not set up on the server yet"
                        : `failed — ${r.detail ?? "unknown error"}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <p className="text-xs text-muted-foreground">
              Preview today&apos;s digest in your inbox.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={digestPending}
              onClick={async () => {
                setDigestPending(true);
                setDigestResult(null);
                try {
                  const r = await sendDigestNow({});
                  setDigestResult(
                    r.status === "sent"
                      ? `Sent: "${r.subject}"`
                      : r.status === "not_configured"
                        ? "Email isn't set up on the server yet."
                        : r.status === "no_recipient"
                          ? "Add an alert email first."
                          : r.status,
                  );
                } catch (err) {
                  setDigestResult(err instanceof Error ? err.message : "Could not send.");
                } finally {
                  setDigestPending(false);
                }
              }}
            >
              {digestPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send digest now
            </Button>
          </div>
          {digestResult ? (
            <p className="text-sm" data-testid="digest-result">
              {digestResult}
            </p>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
