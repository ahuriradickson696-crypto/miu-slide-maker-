import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Target,
  Lightbulb,
  CheckCircle2,
  ListChecks,
  Library,
  Download,
  Printer,
  FileDown,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Menu,
  X,
  GraduationCap,
} from "lucide-react";
import { getDeck } from "@/lib/deck-storage.functions";
import {
  generateLectureNotes,
  getLectureNotes,
  type LectureNotes,
} from "@/lib/lecture-notes.functions";
import type { SlideDeck } from "@/lib/slides.functions";
import { exportLectureNotesToPdf } from "@/lib/lecture-notes-pdf";
import { downloadLectureNotesMarkdown } from "@/lib/lecture-notes-markdown";
import { MIU_FACTS } from "@/lib/miu-facts";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { readStoredApiKey } from "@/lib/api-key-storage";
import { AuthGate } from "@/components/AuthGate";
import { ChatWidget } from "@/components/ChatWidget";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/lecture-notes/$deckId")({
  component: LectureNotesPage,
});

function slugify(text: string, i: number): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || `section-${i}`
  );
}

function LectureNotesPage() {
  return (
    <AuthGate serviceName="Lecture Notes">
      <LectureNotesPageInner />
    </AuthGate>
  );
}

function LectureNotesPageInner() {
  const { deckId } = Route.useParams();

  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [notes, setNotes] = useState<LectureNotes | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [configStatus, setConfigStatus] = useState<{
    sharedApiKey: boolean;
  } | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // Same key story as Slide Studio — a personal key saved there (localStorage,
  // shared key name) takes priority, otherwise fall back to whatever the
  // admin has configured server-side. Notes never asks for its own key.
  const hasApiAccess = !!apiKey.trim() || !!configStatus?.sharedApiKey;

  useEffect(() => {
    setApiKey(readStoredApiKey());
    getPublicConfigStatus()
      .then(setConfigStatus)
      .catch(() => setConfigStatus(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      getDeck({ data: { id: deckId } }),
      getLectureNotes({ data: { deckId } }),
    ])
      .then(([d, n]) => {
        if (cancelled) return;
        setDeck(d);
        setNotes(n);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Couldn't load this deck.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  async function handleGenerate() {
    if (!hasApiAccess) {
      toast.error("Add an API key in Settings first, then come back here.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generateLectureNotes({ data: { deckId, apiKey } });
      setNotes(result);
      toast.success("Lecture notes ready");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't generate lecture notes.";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      setGenError(rateLimitMatch ? rateLimitMatch[2] : message);
    } finally {
      setGenerating(false);
    }
  }

  function handlePrint() {
    // The global stylesheet's @page defaults to landscape (for slide
    // printing). This document wants portrait — override it just for this
    // print pass via a temporary <style> tag, which wins the cascade by
    // coming later in source order, then clean it up afterward so it
    // doesn't leak into printing the slide deck later in the same tab.
    const style = document.createElement("style");
    style.textContent =
      "@media print { @page { size: A4 portrait; margin: 0.5in; } }";
    document.head.appendChild(style);
    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  async function handleDownloadPdf() {
    if (!notes) return;
    setDownloadingPdf(true);
    try {
      await exportLectureNotesToPdf(notes);
      toast.success("Downloaded PDF");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setDownloadingPdf(false);
    }
  }

  function handleDownloadMarkdown() {
    if (!notes) return;
    downloadLectureNotesMarkdown(notes);
  }

  const toc = useMemo(() => {
    if (!notes) return [];
    const items = [
      { id: "overview", label: "Overview" },
      { id: "outcomes", label: "Learning Outcomes" },
      ...notes.sections.map((s, i) => ({
        id: slugify(s.heading, i),
        label: `${i + 1}. ${s.heading}`,
      })),
      { id: "takeaways", label: "Key Takeaways" },
    ];
    if (notes.furtherReading.length)
      items.push({ id: "reading", label: "Further Reading" });
    return items;
  }, [notes]);

  function jumpTo(id: string) {
    setTocOpen(false);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />

      {/* App chrome — hidden on print */}
      <div className="print-hide sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-3 sm:px-6 py-3 flex items-center gap-2 sm:gap-3">
          <a
            href="/slides"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Slide Studio</span>
          </a>
          <div className="flex-1" />
          {notes && (
            <>
              {toc.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTocOpen((v) => !v)}
                  aria-label="Table of contents"
                  className="lg:hidden inline-flex items-center gap-1.5 rounded-full border px-2.5 sm:px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
                >
                  <Menu className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Contents</span>
                </button>
              )}
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 sm:px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadMarkdown}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
              >
                <FileDown className="h-3.5 w-3.5" />
                Markdown
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
              >
                {downloadingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                PDF
              </button>
            </>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {loadError && !loading && (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive/70 mb-3" />
          <p className="font-medium">{loadError}</p>
          <a
            href="/slides"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            Back to Slide Studio
          </a>
        </div>
      )}

      {deck && !loading && !loadError && (
        <div className="mx-auto max-w-5xl px-3 sm:px-6 py-6 sm:py-10">
          {!notes ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="print-hide mx-auto max-w-lg rounded-2xl border bg-white p-8 text-center slide-shadow"
            >
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground mb-4">
                <BookOpen className="h-6 w-6" />
              </span>
              <h1 className="text-lg font-semibold">
                Generate lecture notes for
              </h1>
              <p className="mt-1 text-sm font-medium text-primary">
                {deck.topic}
              </p>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Turns this {deck.slides.length}-slide deck into a formal,
                MIU-branded lecture-notes document — full prose explanations, a
                glossary of key terms, learning outcomes, and a summary — ready
                to print, hand out, or post for students to study from.
              </p>

              {genError && (
                <p className="mt-4 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-left text-[11px] text-destructive leading-relaxed">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {genError}
                </p>
              )}

              {!hasApiAccess && !genError && (
                <p className="mt-4 text-left text-[11px] text-muted-foreground leading-relaxed">
                  Uses the same API key as every other tool here —{" "}
                  <a href="/settings" className="underline underline-offset-2">
                    add one in Settings
                  </a>{" "}
                  and it'll work here automatically.
                </p>
              )}

              <motion.button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                whileTap={{ scale: 0.97 }}
                className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-60 transition-shadow"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Writing lecture
                    notes…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Generate lecture notes
                  </>
                )}
              </motion.button>
            </motion.div>
          ) : (
            <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-10">
              {/* Table of contents — desktop sidebar */}
              <nav className="print-hide hidden lg:block">
                <div className="sticky top-20 space-y-1">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Contents
                  </p>
                  {toc.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => jumpTo(item.id)}
                      className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-primary transition"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </nav>

              {/* Mobile TOC drawer */}
              <AnimatePresence>
                {tocOpen && (
                  <motion.div
                    className="print-hide fixed inset-0 z-40 lg:hidden"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <div
                      className="absolute inset-0 bg-black/40"
                      onClick={() => setTocOpen(false)}
                    />
                    <motion.div
                      initial={{ x: "100%" }}
                      animate={{ x: 0 }}
                      exit={{ x: "100%" }}
                      transition={{ duration: 0.2 }}
                      className="absolute right-0 top-0 h-full w-72 max-w-[85vw] bg-white shadow-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold">Contents</p>
                        <button
                          type="button"
                          onClick={() => setTocOpen(false)}
                          aria-label="Close"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="space-y-1">
                        {toc.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => jumpTo(item.id)}
                            className="block w-full rounded-md px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-primary transition"
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Document */}
              <motion.article
                id="lecture-notes-doc"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="rounded-2xl border bg-white slide-shadow overflow-hidden"
              >
                {/* Letterhead */}
                <div className="miu-gradient px-5 sm:px-10 pt-6 sm:pt-8 pb-6 text-white relative overflow-hidden">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <img
                        src={logo}
                        alt=""
                        className="h-11 w-11 sm:h-14 sm:w-14 object-contain shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-[10px] sm:text-xs font-bold tracking-wider uppercase truncate">
                          {MIU_FACTS.legalName}
                        </p>
                        <p className="text-[9px] sm:text-[11px] italic opacity-90 truncate">
                          "{MIU_FACTS.motto}"
                        </p>
                      </div>
                    </div>
                    <span className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide">
                      <GraduationCap className="h-3.5 w-3.5" /> Lecture Notes
                    </span>
                  </div>
                  <h1
                    className="mt-5 sm:mt-6 text-2xl sm:text-3xl font-semibold leading-tight"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {notes.topic}
                  </h1>
                  <p className="mt-2 text-xs sm:text-sm opacity-90">
                    {[notes.courseCode, notes.courseName, notes.courseLevel]
                      .filter(Boolean)
                      .join("  •  ")}
                  </p>
                  <p className="mt-1 text-[10px] sm:text-[11px] opacity-70">
                    Generated{" "}
                    {new Date(notes.generatedAt).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>

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
                        By the end of this lecture, students will be able to:
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
                        <span className="text-accent">{i + 1}.</span>{" "}
                        {section.heading}
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

                {/* Document footer */}
                <div className="border-t bg-slate-50 px-5 sm:px-10 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-[10px] sm:text-[11px] text-muted-foreground">
                  <span>
                    {MIU_FACTS.legalName} • {MIU_FACTS.accreditation}
                  </span>
                  <span>
                    {MIU_FACTS.website} • {MIU_FACTS.campusesShort}
                  </span>
                </div>
              </motion.article>

              <div className="print-hide mt-6 lg:col-start-2 flex justify-center">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition disabled:opacity-50"
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Regenerate notes
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ChatWidget
        contextLabel={
          notes ? `Lecture notes: ${notes.topic}` : "MIU Lecture Notes"
        }
        contextSummary={
          notes
            ? [
                notes.overview,
                ...notes.sections.map(
                  (s) => `${s.heading}: ${s.paragraphs.join(" ")}`,
                ),
              ]
                .join("\n\n")
                .slice(0, 6000)
            : ""
        }
      />
    </div>
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
    <h2
      className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary mb-3 pb-2 ${
        noBorder ? "" : "border-b border-primary/15"
      }`}
    >
      {icon}
      {label}
    </h2>
  );
}
