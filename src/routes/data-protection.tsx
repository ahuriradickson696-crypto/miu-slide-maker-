import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout } from "@/components/PolicyLayout";

export const Route = createFileRoute("/data-protection")({
  component: DataProtectionPage,
});

function DataProtectionPage() {
  return (
    <PolicyLayout title="Data Protection Principles" lastUpdated="August 2026">
      <p>
        Uganda's Data Protection and Privacy Act, 2019 sets out core principles that govern how any
        organization — including MIU — handles personal data. Here's what they mean in plain language for how
        MIU Studio actually works. This is a summary for students and lecturers; the full legal detail is in
        our <a href="/privacy-policy">Privacy Policy</a>.
      </p>

      <h2>1. We only collect data with your consent</h2>
      <p>You choose to create an account and agree to our privacy policy before any account data is collected.</p>

      <h2>2. We only collect what we actually need</h2>
      <p>
        Your name, email, and the content you create — nothing more. We don't ask for data unrelated to running
        the platform.
      </p>

      <h2>3. You can see and control your own data</h2>
      <p>
        Your account settings let you download everything tied to your account, and permanently delete your
        account (and all its data) whenever you choose.
      </p>

      <h2>4. Your data is protected</h2>
      <p>
        Passwords are hashed, not stored as plain text. Traffic between your browser and our servers is
        encrypted. Access to the underlying database and file storage requires credentials — it isn't publicly
        accessible.
      </p>

      <h2>5. We're accountable for how data is handled</h2>
      <p>
        MIU, as the institution operating this platform, is responsible for how personal data collected here is
        handled, and for registering with Uganda's Personal Data Protection Office as required by law. See our{" "}
        <a href="/privacy-policy">Privacy Policy</a> for registration details.
      </p>
    </PolicyLayout>
  );
}
