import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout, OpenItems } from "@/components/PolicyLayout";
import { MIU_FACTS } from "@/lib/miu-facts";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  return (
    <PolicyLayout title="Terms of Use" lastUpdated="August 2026">
      <p>
        These terms govern use of MIU Studio, operated by {MIU_FACTS.legalName}. By creating an account, you
        agree to these terms.
      </p>

      <h2>All users</h2>
      <ul>
        <li>Keep your account credentials private — don't share your login.</li>
        <li>Content you generate is yours to use for your academic work at MIU.</li>
        <li>Don't use the platform to generate content that is illegal, harmful, or violates MIU's code of conduct.</li>
        <li>The service is provided as-is; AI-generated content may contain errors and should be reviewed before use — see our <a href="/academic-policy">Academic & AI-Use Policy</a>.</li>
      </ul>

      <h2>Students</h2>
      <ul>
        <li>Use AI-generated notes and study material as a supplement to, not a replacement for, lectures and assigned readings.</li>
        <li>Academic honesty rules apply to any use of AI-generated content in coursework — see the Academic & AI-Use Policy.</li>
        <li>If collaboration or sharing features are enabled, respect other students' shared work.</li>
      </ul>

      <h2>Lecturers</h2>
      <ul>
        <li>Review AI-generated slide decks, lecture notes, and curriculum content before classroom use.</li>
        <li>You retain ownership of curriculum documents you upload.</li>
        <li>If you upload material containing student data (e.g. class lists), you're responsible for having a lawful basis to do so under the DPPA — see our <a href="/privacy-policy">Privacy Policy</a>.</li>
      </ul>

      <h2>University administration</h2>
      <ul>
        <li>Admin dashboard access (usage stats, user management, moderation) is restricted to designated admin accounts.</li>
        <li>Backups, when configured, are retained according to MIU's internal retention schedule and exclude sensitive credentials such as password hashes.</li>
      </ul>

      <h2>Account termination</h2>
      <p>
        You may delete your account at any time from your account settings — this permanently removes your data
        (see our Privacy Policy). MIU may suspend accounts that violate these terms.
      </p>

      <OpenItems items={["Legal review of this Terms of Use language before it's published as binding."]} />
    </PolicyLayout>
  );
}
