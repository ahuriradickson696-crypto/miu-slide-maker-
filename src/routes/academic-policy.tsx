import { createFileRoute } from "@tanstack/react-router";
import { PolicyLayout } from "@/components/PolicyLayout";

export const Route = createFileRoute("/academic-policy")({
  component: AcademicPolicyPage,
});

function AcademicPolicyPage() {
  return (
    <PolicyLayout title="Academic & AI-Use Policy" lastUpdated="August 2026">
      <p>
        MIU Studio is built to align with Uganda's National Council for Higher Education (NCHE) guidance for
        online and distance e-learning (ODeL) tools. This page explains how AI-generated content fits into
        teaching and learning at MIU — as a drafting aid, not a replacement for instructor judgment or classroom
        teaching.
      </p>

      <h2>What this platform is for</h2>
      <p>
        MIU Studio helps lecturers draft slide decks, lecture notes, and curriculum breakdowns faster using AI.
        It is a starting point for lecture preparation, not a finished, authoritative teaching resource on its
        own.
      </p>

      <h2>AI-assisted content disclosure</h2>
      <p>
        Every AI-generated deck, note set, or curriculum breakdown is exactly that — AI-assisted. Lecturers
        should review generated content for accuracy before using it in class, the same way they would review
        any drafted teaching material. Students using AI-generated lecture notes or study material should treat
        it as a study aid that supplements, not replaces, attending lectures and consulting assigned readings.
      </p>

      <h2>Academic integrity</h2>
      <p>
        Using this platform to generate study material for your own learning is expected and encouraged.
        Submitting AI-generated content as original coursework, without disclosure where required, is subject to
        MIU's standard academic integrity policies — this platform does not change those rules.
      </p>

      <h2>Accessibility and low-bandwidth support</h2>
      <p>
        NCHE's ODeL guidance emphasizes that institutions should account for students who face gadget, data, or
        network constraints. MIU Studio is built mobile-responsive and aims to keep page weight reasonable so it
        remains usable on slower connections. See our <a href="/accessibility">Accessibility Statement</a> for
        more.
      </p>

      <h2>Assessment</h2>
      <p>
        Where this platform offers AI-generated quiz or assessment content, it is intended as a starting point
        for an instructor's own continuous-assessment process — not a substitute for an instructor's evaluation
        of student understanding.
      </p>

      <h2>Multi-program courses</h2>
      <p>
        Where a course is shared across multiple programs or departments, decks generated for it can be
        contextualized to reflect each program's audience without changing the core teaching content — this
        supports courses like shared foundational mathematics or communication skills modules taught across
        several faculties.
      </p>
    </PolicyLayout>
  );
}
