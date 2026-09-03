import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  Target,
  Lightbulb,
  CheckCircle2,
  ListChecks,
  Library,
  Download,
  FileDown,
  Loader2,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import {
  getLectureNotesById,
  type LectureNotes,
} from "@/lib/lecture-notes.functions";
import { exportLectureNotesToPdf } from "@/lib/lecture-notes-pdf";
import { downloadLectureNotesMarkdown } from "@/lib/lecture-notes-markdown";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/notes/read/$notesId")({
  component: NotesReadPage,
});

function slugify(text: string, i: number): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `section-${i}`
  );
}

function SectionHeading({
  icon,
  label,
  noBorder,
}: {
  icon: React.ReactNode;
  label: string;
  noBorder?: boolean;
}) {
  return (
    <p
      className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary mb-2 ${
        noBorder ? "" : "pb-1.5 border-b border-primary/10"
      }`}
    >
      {icon} {label}
    </p>
  );
}

function NotesReadPage() {
  const { notesId } = Route.useParams();
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a
            href="/notes"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Lecture Notes</span>
          </a>
          <div className="flex-1" />
          <img
            src={logo}
            alt=""
            className="h-6 w-6 object-contain opacity-70"
          />
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
        <AuthGate serviceName="Lecture Notes">
          <NotesReadInner notesId={notesId} />
        </AuthGate>
      </div>
    </div>
  );
}

function NotesReadInner({ notesId }: { notesId: string }) {
  const [notes, setNotes] = useState<LectureNotes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLectureNotesById({ data: { id: notesId } })
      .then((n) => {
        if (cancelled) return;
        if (!n) {
          setError("These notes don't exist, or were deleted.");
        } else {
          setNotes(n);
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Couldn't load these notes.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notesId]);

  async function handlePdfExport() {
    if (!notes) return;
    setExportingPdf(true);
    try {
      await exportLectureNotesToPdf(notes);
    } catch {
      toast.error("Couldn't export a PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading notes…
      </div>
    );
  }

  if (error || !notes) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1
            className="text-xl sm:text-2xl font-semibold"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {notes.topic}
          </h1>
          {(notes.courseCode || notes.courseName) && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {[notes.courseCode, notes.courseName].filter(Boolean).join(" • ")}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => downloadLectureNotesMarkdown(notes)}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:border-primary/50 transition"
          >
            <Download className="h-3.5 w-3.5" /> Markdown
          </button>
          <button
            onClick={handlePdfExport}
            disabled={exportingPdf}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {exportingPdf ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileDown className="h-3.5 w-3.5" />
            )}
            PDF
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="px-5 sm:px-10 py-6 sm:py-8 space-y-8">
          {notes.overview && (
            <section id="overview" className="scroll-mt-24">
              <SectionHeading
                icon={<Target className="h-4 w-4" />}
                label="Overview"
              />
              <p className="text-sm sm:text-[15px] leading-relaxed text-slate-700">
                {notes.overview}
              </p>
            </section>
          )}

          {notes.learningOutcomes.length > 0 && (
            <section id="outcomes" className="scroll-mt-24">
              <SectionHeading
                icon={<ListChecks className="h-4 w-4" />}
                label="Learning Outcomes"
              />
              <p className="text-xs text-muted-foreground italic mb-2">
                By the end, you'll be able to:
              </p>
              <ul className="space-y-1.5">
                {notes.learningOutcomes.map((o, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-slate-700"
                  >
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {notes.sections.map((section, i) => (
            <section
              key={i}
              id={slugify(section.heading, i)}
              className="scroll-mt-24"
            >
              <h2
                className="text-lg sm:text-xl font-semibold text-primary mb-3"
                style={{ fontFamily: "var(--font-display)" }}
              >
                <span className="text-accent">{i + 1}.</span> {section.heading}
              </h2>
              <div className="space-y-3">
                {section.paragraphs.map((p, pi) => (
                  <p
                    key={pi}
                    className="text-sm sm:text-[15px] leading-relaxed text-slate-700"
                  >
                    {p}
                  </p>
                ))}
              </div>
              {section.keyTerms && section.keyTerms.length > 0 && (
                <div className="mt-4 rounded-lg border-l-4 border-accent bg-accent/5 p-3 sm:p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent mb-2">
                    <Lightbulb className="h-3.5 w-3.5" /> Key Terms
                  </p>
                  <dl className="space-y-1.5">
                    {section.keyTerms.map((t, ti) => (
                      <div key={ti} className="text-xs sm:text-sm">
                        <dt className="inline font-semibold text-slate-800">
                          {t.term}
                        </dt>
                        <dd className="inline text-slate-600">
                          {" "}
                          — {t.definition}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </section>
          ))}

          {notes.keyTakeaways.length > 0 && (
            <section id="takeaways" className="scroll-mt-24">
              <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 sm:p-5">
                <SectionHeading
                  icon={<Sparkles className="h-4 w-4" />}
                  label="Key Takeaways"
                  noBorder
                />
                <ul className="space-y-1.5 mt-1">
                  {notes.keyTakeaways.map((k, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-slate-700"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span>{k}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {notes.furtherReading.length > 0 && (
            <section id="reading" className="scroll-mt-24">
              <SectionHeading
                icon={<Library className="h-4 w-4" />}
                label="Further Reading"
              />
              <ul className="space-y-1">
                {notes.furtherReading.map((r, i) => (
                  <li key={i} className="text-sm text-slate-600">
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className="border-t bg-slate-50 px-5 sm:px-10 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[10px] sm:text-[11px] text-muted-foreground">
          <span>
            {MIU_FACTS.legalName} • {MIU_FACTS.accreditation}
          </span>
          <span>
            Generated{" "}
            {new Date(notes.generatedAt).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
