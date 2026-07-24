"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Plus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_STATUSES, SERVICE_TYPES, URGENCIES } from "@/lib/constants";
import type { LeadStatus, ServiceType, Urgency } from "@/types";

export type LeadRow = {
  _id: Id<"leads">;
  customerName: string;
  serviceType: ServiceType;
  description: string;
  phone?: string;
  email?: string;
  address?: string;
  status: LeadStatus;
  urgency: Urgency;
};

type LeadDialogProps = {
  mode: "create" | "edit";
  lead?: LeadRow;
};

export function LeadDialog({ mode, lead }: LeadDialogProps) {
  const createLead = useMutation(api.leads.create);
  const updateLead = useMutation(api.leads.update);

  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState(lead?.customerName ?? "");
  const [serviceType, setServiceType] = useState<ServiceType>(
    lead?.serviceType ?? "general_contracting",
  );
  const [description, setDescription] = useState(lead?.description ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [address, setAddress] = useState(lead?.address ?? "");
  const [status, setStatus] = useState<LeadStatus>(lead?.status ?? "new");
  const [urgency, setUrgency] = useState<Urgency>(lead?.urgency ?? "medium");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(nextOpen: boolean) {
    setOpen(nextOpen);
    setError(null);
    setPending(false);
    if (nextOpen) {
      setCustomerName(lead?.customerName ?? "");
      setServiceType(lead?.serviceType ?? "general_contracting");
      setDescription(lead?.description ?? "");
      setPhone(lead?.phone ?? "");
      setEmail(lead?.email ?? "");
      setAddress(lead?.address ?? "");
      setStatus(lead?.status ?? "new");
      setUrgency(lead?.urgency ?? "medium");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!customerName.trim()) {
      setError("Customer name is required.");
      return;
    }
    setPending(true);
    try {
      if (mode === "create") {
        await createLead({
          customerName,
          serviceType,
          description,
          phone,
          email,
          address,
          status,
          urgency,
        });
      } else if (lead) {
        await updateLead({
          leadId: lead._id,
          customerName,
          serviceType,
          description,
          phone,
          email,
          address,
          status,
          urgency,
        });
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {mode === "create" ? (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New lead
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New lead" : "Edit lead"}
          </DialogTitle>
          <DialogDescription>
            Lightweight customer record you can link field notes to.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lead-name">Customer name</Label>
              <Input
                id="lead-name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Jane Homeowner"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-service">Service type</Label>
              <select
                id="lead-service"
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value as ServiceType)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone">Phone</Label>
              <Input
                id="lead-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-email">Email</Label>
              <Input
                id="lead-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="lead-address">Address</Label>
              <Input
                id="lead-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 Main St"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-status">Status</Label>
              <select
                id="lead-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-urgency">Urgency</Label>
              <select
                id="lead-urgency"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as Urgency)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {URGENCIES.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="lead-description">Description</Label>
            <textarea
              id="lead-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What the customer needs…"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>

          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : mode === "create" ? (
                "Create lead"
              ) : (
                "Save changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
