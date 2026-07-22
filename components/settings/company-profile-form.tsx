"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
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
  const update = useMutation(api.companies.update);

  const [name, setName] = useState("");
  const [primaryTrade, setPrimaryTrade] = useState<ServiceType | "">("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

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
        notificationsEnabled,
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
          <Label htmlFor="notification-email">Notification email</Label>
          <Input
            id="notification-email"
            type="email"
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.target.value)}
            placeholder="alerts@acme.com"
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
          <span className="font-medium">Enable notifications</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Digests and urgent alerts to the notification email (delivery ships
            later).
          </span>
        </span>
      </label>

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
    </form>
  );
}
