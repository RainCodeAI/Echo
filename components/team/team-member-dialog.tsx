"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";

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
import { generatePin, isValidPin, normalizePin } from "@/lib/pin";

export type TeamMemberRow = {
  _id: Id<"teamMembers">;
  name: string;
  role?: string;
  isActive: boolean;
};

type TeamMemberDialogProps = {
  mode: "create" | "edit";
  member?: TeamMemberRow;
  trigger?: React.ReactNode;
};

export function TeamMemberDialog({
  mode,
  member,
  trigger,
}: TeamMemberDialogProps) {
  const createMember = useMutation(api.teamMembers.create);
  const updateMember = useMutation(api.teamMembers.update);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(member?.name ?? "");
  const [role, setRole] = useState(member?.role ?? "");
  const [pin, setPin] = useState(mode === "create" ? generatePin() : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPinReveal, setCreatedPinReveal] = useState<string | null>(null);

  function resetForm(nextOpen: boolean) {
    setOpen(nextOpen);
    setError(null);
    setPending(false);
    if (!nextOpen) {
      setCreatedPinReveal(null);
      setName(member?.name ?? "");
      setRole(member?.role ?? "");
      setPin(mode === "create" ? generatePin() : "");
    } else if (mode === "create") {
      setName("");
      setRole("");
      setPin(generatePin());
      setCreatedPinReveal(null);
    } else {
      setName(member?.name ?? "");
      setRole(member?.role ?? "");
      setPin("");
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    if (mode === "create" && !isValidPin(pin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }

    if (mode === "edit" && pin && !isValidPin(pin)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }

    setPending(true);
    try {
      if (mode === "create") {
        await createMember({
          name: trimmedName,
          pin,
          role: role.trim() || undefined,
        });
        setCreatedPinReveal(pin);
      } else if (member) {
        await updateMember({
          memberId: member._id,
          name: trimmedName,
          role: role.trim() || undefined,
          pin: pin ? pin : undefined,
        });
        if (pin) {
          setCreatedPinReveal(pin);
        } else {
          setOpen(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const title = mode === "create" ? "Add crew member" : "Edit crew member";
  const description =
    mode === "create"
      ? "Create a PIN for field entry. Share the PIN privately with this worker."
      : "Update name, role, or set a new PIN. Existing PINs cannot be viewed.";

  return (
    <Dialog open={open} onOpenChange={resetForm}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={mode === "create" ? "default" : "outline"} size="sm">
            {mode === "create" ? "Add member" : "Edit"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {createdPinReveal ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {mode === "create" ? "Member added" : "PIN updated"}
              </DialogTitle>
              <DialogDescription>
                Copy this PIN now — Echo stores only a hash and cannot show it
                again.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-6 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                4-digit PIN
              </p>
              <p className="mt-2 font-mono text-4xl font-semibold tracking-[0.35em] text-primary">
                {createdPinReveal}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                For: <span className="font-medium text-foreground">{name.trim()}</span>
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdPinReveal);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Copy PIN
              </Button>
              <Button type="button" onClick={() => resetForm(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${mode}-name`}>Name</Label>
                  <Input
                    id={`${mode}-name`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jordan Lee"
                    required
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${mode}-role`}>Role (optional)</Label>
                  <Input
                    id={`${mode}-role`}
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder="Foreman"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor={`${mode}-pin`}>
                    {mode === "create" ? "4-digit PIN" : "New 4-digit PIN"}
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPin(generatePin())}
                  >
                    {mode === "create" ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                <Input
                  id={`${mode}-pin`}
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  value={pin}
                  onChange={(e) => setPin(normalizePin(e.target.value))}
                  className="font-mono tracking-[0.35em]"
                  placeholder={
                    mode === "create" ? "1234" : "Leave blank to keep current"
                  }
                  required={mode === "create"}
                  autoComplete="off"
                />
                {mode === "edit" ? (
                  <p className="text-xs text-muted-foreground">
                    Leave blank to keep the current PIN. Stored PINs are never
                    shown after save.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Each active crew member needs a unique PIN on this company.
                  </p>
                )}
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
                    "Add member"
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
