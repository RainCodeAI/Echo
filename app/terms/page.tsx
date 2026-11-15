import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service · Echo" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are an agreement between {LEGAL.entity} (&ldquo;we&rdquo;) and the business that creates an Echo
        workspace (&ldquo;you&rdquo;). The person who accepts them confirms they can do so for the business.
      </p>

      <h2>The service</h2>
      <p>
        Echo lets your crews record job-site voice notes and turns them into transcripts, summaries, materials lists,
        tasks, alerts and draft customer updates. We may improve or change features over time.
      </p>

      <h2>Your account and your crews</h2>
      <ul>
        <li>Keep sign-in details and crew PINs private. You&rsquo;re responsible for activity in your workspace.</li>
        <li>Deactivate crew members who leave. Their access stops right away.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Use Echo lawfully, including the recording, privacy and messaging laws that apply to you.</li>
        <li>Get any consent needed before recording people, and before texting or emailing your customers.</li>
        <li>Don&rsquo;t upload content you have no right to share, or use Echo to harass, spam or harm anyone.</li>
        <li>Don&rsquo;t try to access other workspaces, disrupt the service, or get around its limits.</li>
      </ul>

      <h2>AI output</h2>
      <p>
        Transcripts, summaries, materials lists, suggested job updates and customer drafts are produced automatically and
        can be wrong or incomplete. Check them before you rely on them, order from them, or send them to anyone.
      </p>

      <h2>Your data</h2>
      <p>
        Your workspace content belongs to you. You let us store and process it only to provide the service, as described
        in the <Link href="/privacy" className="underline">Privacy Policy</Link>. You can export it or delete it at any time.
      </p>

      <h2>Fees</h2>
      <p>
        Pilot access is free unless agreed otherwise in writing. If paid plans are introduced, we&rsquo;ll tell you the
        price in advance, and nothing is charged without your agreement.
      </p>

      <h2>Ending the service</h2>
      <p>
        You can stop using Echo and delete your workspace at any time. We may suspend a workspace that breaks these terms
        or puts the service or others at risk. Where we reasonably can, we&rsquo;ll give notice and a chance to export
        your data first.
      </p>

      <h2>Disclaimers and liability</h2>
      <p>
        Echo is provided &ldquo;as is&rdquo;. To the extent the law allows, we disclaim implied warranties. We aren&rsquo;t
        liable for indirect or consequential losses, and our total liability is limited to the amount you paid us in the
        12 months before the claim.
      </p>

      <h2>Changes and governing law</h2>
      <p>
        If these terms change in a meaningful way, the version above changes and the workspace owner is asked to accept
        the new version. These terms are governed by the laws of {LEGAL.governingLaw}.
      </p>

      <h2>Contact</h2>
      <p>{LEGAL.entity} · {LEGAL.contactEmail}</p>
    </LegalPage>
  );
}
