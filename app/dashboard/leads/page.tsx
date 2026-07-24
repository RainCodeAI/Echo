"use client";

import { useQuery } from "convex/react";
import { UserPlus } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LeadDialog } from "@/components/leads/lead-dialog";
import { SERVICE_TYPE_MAP, URGENCY_MAP } from "@/lib/constants";
import type { LeadStatus } from "@/types";

const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  estimate_sent: "Estimate sent",
  scheduled: "Scheduled",
  completed: "Completed",
  archived: "Archived",
};

export default function LeadsPage() {
  const leads = useQuery(api.leads.list, {});

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Leads</h2>
          <p className="text-sm text-muted-foreground">
            Lightweight customer records to link field notes to.
          </p>
        </div>
        <LeadDialog mode="create" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All leads</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {leads === undefined ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : leads.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-12 text-center">
              <UserPlus className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">No leads yet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                Add your first lead, then link field notes to it from a note’s
                detail page.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {leads.map((lead) => {
                const urgency = URGENCY_MAP[lead.urgency];
                const service = SERVICE_TYPE_MAP[lead.serviceType];
                return (
                  <li
                    key={lead._id}
                    className="flex items-start justify-between gap-3 py-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{lead.customerName}</span>
                        <Badge variant="secondary">
                          {LEAD_STATUS_LABEL[lead.status]}
                        </Badge>
                        {urgency ? (
                          <Badge className={urgency.badgeClass}>
                            {urgency.label}
                          </Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {service?.label}
                        </span>
                      </div>
                      {lead.description ? (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {lead.description}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {[lead.phone, lead.email, lead.address]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </p>
                    </div>
                    <LeadDialog
                      mode="edit"
                      lead={{
                        _id: lead._id,
                        customerName: lead.customerName,
                        serviceType: lead.serviceType,
                        description: lead.description,
                        phone: lead.phone,
                        email: lead.email,
                        address: lead.address,
                        status: lead.status,
                        urgency: lead.urgency,
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
