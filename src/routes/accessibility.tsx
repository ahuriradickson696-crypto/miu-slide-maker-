import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout } from "@/components/PolicyLayout";

export const Route = createFileRoute("/accessibility")({
  component: AccessibilityPage,
});

function AccessibilityPage() {
  return (
    <PolicyLayout title="Accessibility & Inclusion Statement" lastUpdated="August 2026">
      <p>
        MIU Studio aims to be usable by students and lecturers regardless of device, connection quality, or
        disability, in line with NCHE's guidance that institutions provide assurance of mainstreaming disability
        and gender considerations in e-learning tools.
      </p>

      <h2>Current state</h2>
      <p>
        The platform is built mobile-responsive across its core pages. We're working toward WCAG 2.1 AA
        conformance — this is an ongoing effort, not yet a completed certification.
      </p>

      <h2>What we're actively improving</h2>
      <ul>
        <li>Keyboard navigation throughout the slide editor, not just form fields.</li>
        <li>aria-labels on icon-only controls.</li>
        <li>Verified color contrast across all deck theme presets.</li>
        <li>Visible focus indicators on every interactive element.</li>
      </ul>

      <h2>Low-bandwidth and device access</h2>
      <p>
        We keep page weight reasonable so the platform remains usable on slower connections and older devices,
        consistent with NCHE's ODeL guidance that institutions account for students who face gadget, data, or
        network constraints.
      </p>

      <h2>Feedback</h2>
      <p>
        If you encounter an accessibility barrier using MIU Studio, please let us know so we can prioritize a
        fix — contact details are on our <a href="/privacy-policy">Privacy Policy</a> page.
      </p>
    </PolicyLayout>
  );
}
