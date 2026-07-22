"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "backspace"],
] as const;

type PinKeypadProps = {
  pin: string;
  disabled?: boolean;
  onDigit: (digit: string) => void;
  onClear: () => void;
  onBackspace: () => void;
};

export function PinKeypad({
  pin,
  disabled,
  onDigit,
  onClear,
  onBackspace,
}: PinKeypadProps) {
  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex h-3.5 w-3.5 rounded-full border-2 transition-colors",
              i < pin.length
                ? "border-primary bg-primary"
                : "border-muted-foreground/40 bg-transparent",
            )}
            aria-hidden
          />
        ))}
      </div>
      <span className="sr-only">PIN length {pin.length} of 4</span>

      <div className="mx-auto grid w-full max-w-[280px] gap-3">
        {KEYPAD_ROWS.map((row) => (
          <div key={row.join("-")} className="grid grid-cols-3 gap-3">
            {row.map((key) => {
              if (key === "clear") {
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="ghost"
                    className="h-14 text-sm font-medium"
                    disabled={disabled || pin.length === 0}
                    onClick={onClear}
                  >
                    Clear
                  </Button>
                );
              }
              if (key === "backspace") {
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="ghost"
                    className="h-14"
                    disabled={disabled || pin.length === 0}
                    onClick={onBackspace}
                    aria-label="Backspace"
                  >
                    <Delete className="h-5 w-5" />
                  </Button>
                );
              }
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  className="h-14 text-xl font-semibold tabular-nums"
                  disabled={disabled || pin.length >= 4}
                  onClick={() => onDigit(key)}
                >
                  {key}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
