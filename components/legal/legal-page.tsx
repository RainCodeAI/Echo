import Link from "next/link";
import { LEGAL } from "@/lib/legal";

/** Shared layout for the privacy policy and terms pages. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground [&_li]:text-muted-foreground">
        <nav className="flex gap-4 text-xs text-muted-foreground">
          <Link href="/" className="hover:underline">Echo</Link>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          <Link href="/terms" className="hover:underline">Terms</Link>
        </nav>
        {!LEGAL.reviewed ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="note">
            Draft. This text is a starting point and has not been reviewed by a lawyer yet.
          </p>
        ) : null}
        <header>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground">Version {LEGAL.version}</p>
        </header>
        {children}
      </article>
    </main>
  );
}
