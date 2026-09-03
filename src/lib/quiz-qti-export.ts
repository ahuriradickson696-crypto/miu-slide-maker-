import type { Quiz } from "./quiz.functions";

// QTI (Question & Test Interoperability) 1.2 is the widest-supported
// version for import across Moodle, Canvas, and Blackboard — QTI 2.x has
// better tooling in theory but much spottier real-world import support.
// This exports a single <questestinterop> XML document per quiz, which
// is what most LMS "import QTI" flows expect for a single quiz/test.

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderMcqItem(id: string, q: { question: string; options?: string[]; correctIndex?: number }): string {
  const options = q.options ?? [];
  const correctIdent = `choice_${(q.correctIndex ?? 0) + 1}`;
  const responseLabels = options
    .map((opt, i) => `          <response_label ident="choice_${i + 1}"><material><mattext texttype="text/plain">${escapeXml(opt)}</mattext></material></response_label>`)
    .join("\n");

  return `  <item ident="${id}" title="${escapeXml(q.question.slice(0, 60))}">
    <presentation>
      <material><mattext texttype="text/plain">${escapeXml(q.question)}</mattext></material>
      <response_lid ident="response1" rcardinality="Single">
        <render_choice>
${responseLabels}
        </render_choice>
      </response_lid>
    </presentation>
    <resprocessing>
      <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
      <respcondition continue="No">
        <conditionvar><varequal respident="response1">${correctIdent}</varequal></conditionvar>
        <setvar action="Set" varname="SCORE">100</setvar>
      </respcondition>
    </resprocessing>
  </item>`;
}

function renderShortAnswerItem(id: string, q: { question: string; sampleAnswer?: string }): string {
  return `  <item ident="${id}" title="${escapeXml(q.question.slice(0, 60))}">
    <presentation>
      <material><mattext texttype="text/plain">${escapeXml(q.question)}</mattext></material>
      <response_str ident="response1" rcardinality="Single">
        <render_fib><response_label ident="answer1"/></render_fib>
      </response_str>
    </presentation>
    <resprocessing>
      <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
      <respcondition continue="No">
        <conditionvar><other/></conditionvar>
      </respcondition>
    </resprocessing>
    <itemfeedback ident="model_answer">
      <material><mattext texttype="text/plain">Model answer: ${escapeXml(q.sampleAnswer ?? "")}</mattext></material>
    </itemfeedback>
  </item>`;
}

export function quizToQti(quiz: Quiz): string {
  const items = quiz.questions
    .map((q, i) => {
      const id = `q${i + 1}`;
      return q.type === "mcq" ? renderMcqItem(id, q) : renderShortAnswerItem(id, q);
    })
    .join("\n");

  const title = escapeXml(`${quiz.topic} — Quiz`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/ims_qtiasiv1p2 http://www.imsglobal.org/xsd/ims_qtiasiv1p2p1.xsd">
<assessment ident="assessment_1" title="${title}">
  <section ident="section_1">
${items}
  </section>
</assessment>
</questestinterop>
`;
}

export function downloadQuizAsQti(quiz: Quiz): void {
  const xml = quizToQti(quiz);
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safe = quiz.topic.replace(/[^a-z0-9]+/gi, "_").slice(0, 50);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safe || "quiz"}_qti.xml`;
  link.click();
  URL.revokeObjectURL(url);
}
