"use client";

import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";

export type AssigneeRef = { kind: "member" | "user"; id: string };

const keyOf = (r: AssigneeRef | null | undefined) => (r ? `${r.kind}:${r.id}` : "");

/**
 * Compact assignee picker: crew (PIN) and office users. When nothing is
 * assigned, the AI's free-text hint is shown as the placeholder.
 */
export function AssigneeSelect({
  value,
  hint,
  onChange,
  disabled,
  label,
}: {
  value: AssigneeRef | null | undefined;
  hint?: string | null;
  onChange: (next: AssigneeRef | null) => void;
  disabled?: boolean;
  label: string;
}) {
  const people = useQuery(api.tasks.people, {});
  const crew = (people ?? []).filter((p) => p.kind === "member");
  const office = (people ?? []).filter((p) => p.kind === "user");
  const current = keyOf(value);
  const known = !value || (people ?? []).some((p) => keyOf(p) === current);

  return (
    <select
      aria-label={label}
      value={current}
      disabled={disabled || people === undefined}
      onChange={(e) => {
        const [kind, id] = e.target.value.split(":");
        onChange(e.target.value ? { kind: kind as AssigneeRef["kind"], id } : null);
      }}
      className={`h-8 max-w-[11rem] rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${
        value ? "" : "text-muted-foreground"
      }`}
    >
      <option value="">{hint ? `Unassigned (“${hint}”)` : "Unassigned"}</option>
      {!known ? <option value={current}>Former crew member</option> : null}
      {crew.length ? (
        <optgroup label="Crew">
          {crew.map((p) => (
            <option key={keyOf(p)} value={keyOf(p)}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {office.length ? (
        <optgroup label="Office">
          {office.map((p) => (
            <option key={keyOf(p)} value={keyOf(p)}>
              {p.name}
            </option>
          ))}
        </optgroup>
      ) : null}
    </select>
  );
}
