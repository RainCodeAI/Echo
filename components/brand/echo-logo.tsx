import { AudioLines } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";

export function EchoLogo({
  className,
  showWordmark = true,
}: {
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <AudioLines className="h-5 w-5" aria-hidden="true" />
      </span>
      {showWordmark ? <span>{APP_NAME}</span> : null}
    </div>
  );
}
