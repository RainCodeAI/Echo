import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Sign up" };

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/40 p-6">
      <SignUp />
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        By creating a workspace you agree to the <Link href="/terms" className="underline">Terms of Service</Link> and{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>. You&rsquo;ll confirm this once you&rsquo;re in.
      </p>
    </div>
  );
}
