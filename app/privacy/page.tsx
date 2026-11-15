import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { LEGAL, SUBPROCESSORS } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy · Echo" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Echo is a voice field-notes service for trades businesses, operated by {LEGAL.entity}. This policy explains what
        Echo stores, why, who processes it, and how a business can export or delete it.
      </p>

      <h2>Who is responsible</h2>
      <p>
        The business that uses Echo (the &ldquo;workspace owner&rdquo;) decides what its crews record and which customer details
        it enters. For that content the business is responsible for the data, and we process it on its behalf. For the
        owner and office accounts themselves, we are responsible.
      </p>

      <h2>What Echo stores</h2>
      <ul>
        <li>Owner and office accounts: name, email address, role.</li>
        <li>Workspace details: business name, trade, phone, alert and digest settings.</li>
        <li>Crew members: name and role. PINs are stored only as a one-way hash.</li>
        <li>Field notes: voice recordings, transcripts, photos, and the summaries, materials and tasks the AI extracts.</li>
        <li>Customer details the business enters: names, phone numbers, email addresses, site addresses, and job details.</li>
        <li>Drafts of customer updates, and when the business marked them as sent.</li>
        <li>A log of alerts sent to the owner (with the recipient partly hidden).</li>
        <li>Error reports, if enabled. These contain no request bodies, cookies or user details.</li>
      </ul>

      <h2>How it&rsquo;s used</h2>
      <ul>
        <li>To run the service: store notes, transcribe them, and structure them for the office.</li>
        <li>To send the alerts and digests the owner turns on.</li>
        <li>To draft customer updates when asked. The business reviews them and sends them itself; Echo does not contact customers.</li>
        <li>To keep the service secure and fix problems.</li>
      </ul>
      <p>
        We don&rsquo;t sell this data or use it for advertising. Recordings and notes are sent to our AI provider only to
        produce the transcript, summary or draft the business asked for. They are processed under the provider&rsquo;s API
        terms, which do not use API data to train its models by default.
      </p>

      <h2>Service providers</h2>
      <ul>
        {SUBPROCESSORS.map((p) => (
          <li key={p.name}>
            <span className="font-medium text-foreground">{p.name}</span>: {p.purpose}
          </li>
        ))}
      </ul>

      <h2>Recording and consent</h2>
      <p>
        Before a crew member&rsquo;s first recording, Echo shows a notice explaining what is saved and asking them to get
        permission before recording anyone else. Recording laws differ by place, and some require everyone&rsquo;s consent.
        The business is responsible for following the laws that apply to it.
      </p>

      <h2>How long data is kept, export and deletion</h2>
      <ul>
        <li>Data is kept while the workspace is active.</li>
        <li>The owner can export all workspace data at any time (Settings → Your data).</li>
        <li>The owner can permanently delete a single note, including its recording and photos.</li>
        <li>
          The owner can delete the whole workspace. Access stops immediately and the data is removed from our active
          systems shortly after. Copies may remain in our providers&rsquo; backups for a limited time before they expire.
        </li>
        <li>Deleting a workspace doesn&rsquo;t delete the sign-in account itself; that can be removed from the account settings.</li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Crew members and the business&rsquo;s customers should contact the business that uses Echo, which can view, correct,
        export or delete their information. Owners and office users can contact us at {LEGAL.contactEmail}.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit. Each workspace&rsquo;s data is kept separate and checked on every request. Crew PINs are
        hashed, and field sessions expire after a shift.
      </p>

      <h2>Children</h2>
      <p>Echo is a business tool and isn&rsquo;t intended for anyone under 16.</p>

      <h2>Changes</h2>
      <p>
        If this policy changes in a meaningful way, the version above changes and workspace owners are asked to review it.
      </p>

      <h2>Contact</h2>
      <p>{LEGAL.entity} · {LEGAL.contactEmail}</p>
    </LegalPage>
  );
}
