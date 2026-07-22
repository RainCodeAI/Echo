"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PinKeypad } from "@/components/entry/pin-keypad";
import {
  FieldRecorder,
  type VerifiedFieldMember,
} from "@/components/entry/field-recorder";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

type FieldEntryGateProps = {
  companyId: Id<"companies">;
  companyName: string;
};

export function FieldEntryGate({ companyId, companyName }: FieldEntryGateProps) {
  const verifyPin = useMutation(api.teamMembers.verifyPin);

  const [member, setMember] = useState<VerifiedFieldMember | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinPending, setPinPending] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isLocked = lockedUntil !== null && lockedUntil > now;
  const remainingSeconds = lockedUntil
    ? Math.max(0, Math.ceil((lockedUntil - now) / 1000))
    : 0;

  useEffect(() => {
    if (!lockedUntil) return;
    const interval = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (lockedUntil <= t) {
        setLockedUntil(null);
        setFailedAttempts(0);
        setPinError(null);
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [lockedUntil]);

  // Auto-submit when 4 digits entered.
  useEffect(() => {
    if (pin.length !== 4 || pinPending || isLocked || member) return;
    void handleVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional on pin complete
  }, [pin]);

  async function handleVerify() {
    if (isLocked) {
      setPinError("Too many attempts. Wait before trying again.");
      return;
    }
    if (pin.length !== 4) return;

    setPinPending(true);
    setPinError(null);

    try {
      const result = await verifyPin({ companyId, pin });
      if (!result.ok) {
        const nextFails = failedAttempts + 1;
        setFailedAttempts(nextFails);
        setPin("");
        if (nextFails >= MAX_FAILED_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_MS);
          setPinError("Too many attempts. Wait 1 minute, then try again.");
        } else {
          setPinError(result.error || "Incorrect PIN — try again.");
        }
        return;
      }

      setMember({
        id: result.member.id,
        name: result.member.name,
        verificationToken: result.verificationToken,
      });
      setPin("");
      setFailedAttempts(0);
      setLockedUntil(null);
      setPinError(null);
    } catch {
      setPin("");
      setPinError("Something went wrong. Please try again.");
    } finally {
      setPinPending(false);
    }
  }

  function handleDigit(digit: string) {
    if (isLocked || pinPending) return;
    setPinError(null);
    setPin((current) => (current.length >= 4 ? current : `${current}${digit}`));
  }

  if (member) {
    return (
      <Card className="border-none shadow-lg">
        <CardContent className="px-5 py-8 sm:px-8">
          <FieldRecorder
            companyId={companyId}
            companyName={companyName}
            member={member}
            onSwitchUser={() => {
              setMember(null);
              setPin("");
              setPinError(null);
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-lg">
      <CardHeader className="space-y-3 text-center">
        <CardTitle className="text-2xl">{companyName}</CardTitle>
        <CardDescription>
          Enter your 4-digit crew PIN to record a field note.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLocked ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-center text-sm text-amber-900">
            Locked for {remainingSeconds}s after failed attempts.
          </p>
        ) : null}

        <PinKeypad
          pin={pin}
          disabled={pinPending || isLocked}
          onDigit={handleDigit}
          onClear={() => {
            setPin("");
            setPinError(null);
          }}
          onBackspace={() => {
            setPinError(null);
            setPin((c) => c.slice(0, -1));
          }}
        />

        {pinPending ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking PIN…
          </div>
        ) : null}

        {pinError ? (
          <p className="text-center text-sm text-destructive">{pinError}</p>
        ) : null}

        {pin.length === 4 && !pinPending ? (
          <Button
            type="button"
            className="w-full"
            disabled={isLocked}
            onClick={() => void handleVerify()}
          >
            Continue
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
