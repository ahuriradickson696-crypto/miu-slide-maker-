import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, OpenItems } from "@/components/PolicyLayout";
import { MIU_FACTS } from "@/lib/miu-facts";

export const Route = createFileRoute("/privacy-policy")({
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <PolicyLayout title="Privacy Policy" lastUpdated="August 2026">
      <p>
        {MIU_FACTS.legalName} ("MIU", "we", "us") operates MIU Studio — the
        slide deck, curriculum, and lecture notes generation platform. This
        policy explains what personal data we collect, why, and the rights you
        have over it, in line with Uganda's{" "}
        <strong>Data Protection and Privacy Act, 2019</strong> ("DPPA") and its
        2021 Regulations.
      </p>

      <h2>What we collect and why</h2>
      <p>We collect only what's needed to run the service:</p>
      <ul>
        <li>
          <strong>Account information</strong> — name, email address, and (if
          you sign in with Google) your Google profile picture. Used to create
          and secure your account.
        </li>
        <li>
          <strong>Content you create</strong> — slide decks, lecture notes, and
          curriculum documents you upload or generate. Used to provide the
          service to you and let you retrieve your own work later.
        </li>
        <li>
          <strong>Uploaded curriculum files</strong> — the original document you
          upload is processed to extract its structure, and may be stored so you
          can re-download it.
        </li>
        <li>
          <strong>Usage and security data</strong> — sign-in timestamps, and
          rate-limit counters tied to your account or IP address, used to
          prevent abuse.
        </li>
      </ul>
      <p>
        We do not collect more than this, and we do not sell personal data to
        anyone.
      </p>

      <h2>Lawful basis and consent</h2>
      <p>
        Under the DPPA, personal data should not be collected or processed
        without a data subject's prior consent, unless a specific legal
        exception applies. Creating an account requires you to affirmatively
        agree to this policy at signup — we don't collect account data before
        that consent is given.
      </p>

      <h2>How your data is used</h2>
      <ul>
        <li>
          To provide the core service — generating, saving, and letting you
          retrieve your decks, notes, and curricula.
        </li>
        <li>
          To secure your account — rate limiting, fraud/abuse prevention, and
          session management.
        </li>
        <li>
          To operate optional AI providers you or MIU's administrators configure
          (see below).
        </li>
      </ul>
      <p>
        Content you submit for AI generation (topics, pasted material, uploaded
        documents) is sent to the configured AI provider (Groq, and optionally
        DeepSeek as a fallback) solely to generate your requested content. It is
        not used by us to train any model.
      </p>

      <h2>Transparency and your rights</h2>
      <p>
        In line with the DPPA's transparency and participation principle, you
        can access, correct, export, or delete your own data at any time from
        your account settings:
      </p>
      <ul>
        <li>
          <strong>Download my data</strong> — exports your profile, decks,
          lecture notes, and curricula as a single file.
        </li>
        <li>
          <strong>Delete my account</strong> — permanently deletes your account
          and all associated content, including uploaded files in object
          storage. This is irreversible.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Passwords are hashed (never stored in plain text) using scrypt. Data in
        transit is encrypted (HTTPS). Access to the database and file storage is
        credential-protected and not publicly readable. Administrator access to
        account and usage data is restricted to designated admin accounts.
      </p>

      <h2>Data retention</h2>
      <p>
        Your content is retained for as long as your account exists. Temporary
        AI-response caches used to avoid duplicate generation requests are
        automatically purged after a short window (minutes to a day). If you
        delete your account, your data is removed from our database and object
        storage — not just hidden.
      </p>

      <h2>Registration with the Personal Data Protection Office (PDPO)</h2>
      <p>
        Section 29 of the DPPA and Regulation 15(1) of the Data Protection and
        Privacy Regulations require institutions that collect and process
        personal data to register with Uganda's Personal Data Protection Office,
        and to designate a Data Protection Officer. Registration is renewed
        annually.
      </p>
      <p>
        <strong>MIU's Data Protection Officer:</strong>{" "}
        {MIU_FACTS.compliance.dataProtectionOfficerName ?? (
          <em>to be confirmed by MIU's registrar/legal office</em>
        )}
        {MIU_FACTS.compliance.dataProtectionOfficerEmail &&
          ` — ${MIU_FACTS.compliance.dataProtectionOfficerEmail}`}
      </p>

      <h2>Contact us</h2>
      <p>
        For privacy questions or to exercise your rights beyond the self-service
        options above, contact{" "}
        <a href={`mailto:${MIU_FACTS.email}`}>{MIU_FACTS.email}</a>.
      </p>

      <OpenItems
        items={[
          "Name and contact details of MIU's designated Data Protection Officer.",
          "Confirm MIU's PDPO registration status and registration number.",
          "Legal review of this policy's language before it goes live as binding policy.",
        ]}
      />
    </PolicyLayout>
  );
}
