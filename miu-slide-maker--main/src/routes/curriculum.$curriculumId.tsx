import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  AlertTriangle,
  Sparkles,
  BookOpen,
  Target,
  Lightbulb,
  CheckCircle2,
  Layers,
  ListTree,
  RefreshCw,
  Printer,
  Download,
  FileDown,
} from "lucide-react";
import {
  getCurriculum,
  generateSemesterNotes,
  getSemesterNotes,
  type CurriculumStructure,
  type SemesterNotes,
} from "@/lib/curriculum.functions";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { exportCurriculumSemesterToPdf } from "@/lib/curriculum-pdf";
import { downloadCurriculumSemesterMarkdown } from "@/lib/curriculum-markdown";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.jpg";

export const Route = createFileRoute("/curriculum/$curriculumId")({
  component: CurriculumDetailPage,
});

const API_KEY_STORAGE_KEY = "miu-slide-studio:gemini-api-key";

type Slot = { year: string; semester: string; label: string };

function flattenSlots(structure: CurriculumStructure): Slot[] {
  const slots: Slot[] = [];
  for (const y of structure.years) {
    for (const s of y.semesters) {
      slots.push({ year: y.year, semester: s.semester, label: `${y.year} — ${s.semester}` });
    }
  }
  return slots;
}

function CurriculumDetailPage() {
  return (
    <AuthGate serviceName="Curriculum Import">
      <CurriculumDetailInner />
    </AuthGate>
  );
}

function CurriculumDetailInner() {
  const { curriculumId } = Route.useParams();

  const [structure, setStructure] = useState<CurriculumStructure | null>(null);
  const [programName, setProgramName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [configStatus, setConfigStatus] = useState<{ sharedApiKey: boolean } | null>(null);

  const [activeSlotIndex, setActiveSlotIndex] = useState(0);
  const [notes, setNotes] = useState<SemesterNotes | null>(null);
  const [notesLoading, setNotesLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);

  const hasApiAccess = !!apiKey.trim() || !!configStatus?.sharedApiKey;
  const slots = useMemo(() => (structure ? flattenSlots(structure) : []), [structure]);
  const activeSlot = slots[activeSlotIndex] ?? null;

  useEffect(() => {
    try {
      setApiKey(localStorage.getItem(API_KEY_STORAGE_KEY) || "");
    } catch {
      // ignore
    }
    getPublicConfigStatus().then(setConfigStatus).catch(() => setConfigStatus(null));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCurriculum({ data: { id: curriculumId } })
      .then((c) => {
        if (cancelled) return;
        setStructure(c.structure);
        setProgramName(c.programName);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Couldn't load this curriculum."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [curriculumId]);

  // Load (or clear) notes whenever the active slot changes.
  useEffect(() => {
    if (!activeSlot) return;
    let cancelled = false;
    setNotesLoading(true);
    setNotes(null);
    setGenError(null);
    getSemesterNotes({ data: { curriculumId, yearLabel: activeSlot.year, semesterLabel: activeSlot.semester } })
      .then((n) => !cancelled && setNotes(n))
      .catch(() => !cancelled && setNotes(null))
      .finally(() => !cancelled && setNotesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeSlot?.year, activeSlot?.semester, curriculumId]);

  async function handleGenerate() {
    if (!activeSlot) return;
    if (!hasApiAccess) {
      toast.error("Add your Gemini API key in Slide Studio first, then come back here.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generateSemesterNotes({
        data: { curriculumId, yearLabel: activeSlot.year, semesterLabel: activeSlot.semester, apiKey },
      });
      setNotes(result);
      toast.success(`${activeSlot.label} notes ready`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't generate notes for this semester.";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      setGenError(rateLimitMatch ? rateLimitMatch[2] : message);
    } finally {
      setGenerating(false);
    }
  }

  function handlePrint() {
    // Global stylesheet defaults @page to landscape (for slide printing).
    // This document wants portrait — override just for this print pass.
    const style = document.createElement("style");
    style.textContent = "@media print { @page { size: A4 portrait; margin: 0.5in; } }";
    document.head.appendChild(style);
    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  async function handleDownloadPdf() {
    if (!notes || !activeSlot) return;
    setDownloadingPdf(true);
    try {
      await exportCurriculumSemesterToPdf(programName, notes);
      toast.success("Downloaded PDF");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setDownloadingPdf(false);
    }
  }

  const isLastSlot = activeSlotIndex >= slots.length - 1;

  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="print-hide border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a href="/curriculum" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Curriculum Import</span>
          </a>
          <div className="flex-1" />
          {notes && (
            <>
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
                onClick={() => downloadCurriculumSemesterMarkdown(programName, notes)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
              >
                <FileDown className="h-3.5 w-3.5" /> Markdown
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
              >
                {downloadingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                PDF
              </button>
            </>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {loadError && !loading && (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive/70 mb-3" />
          <p className="font-medium">{loadError}</p>
          <a href="/curriculum" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Back to Curriculum Import
          </a>
        </div>
      )}

      {structure && !loading && !loadError && (
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
          {/* Program header + Step 1: structural outline */}
          <div className="flex items-center gap-3 mb-4">
            <img src={logo} alt="" className="h-10 w-10 rounded-lg" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold truncate" style={{ fontFamily: "var(--font-display)" }}>
                {programName}
              </h1>
              <p className="text-xs text-muted-foreground">{MIU_FACTS.legalName}</p>
            </div>
          </div>

          <div className="print-hide rounded-xl border bg-white mb-6 overflow-hidden">
            <button
              type="button"
              onClick={() => setOutlineOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50 transition"
            >
              <ListTree className="h-4 w-4 text-primary shrink-0" />
              Program outline
              <span className="ml-auto text-xs text-muted-foreground">{slots.length} semester{slots.length === 1 ? "" : "s"}</span>
            </button>
            <AnimatePresence>
              {outlineOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden border-t"
                >
                  <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
                    {structure.years.map((y) => (
                      <div key={y.year}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1.5">{y.year}</p>
                        {y.semesters.map((s) => {
                          const idx = slots.findIndex((sl) => sl.year === y.year && sl.semester === s.semester);
                          return (
                            <button
                              key={s.semester}
                              type="button"
                              onClick={() => setActiveSlotIndex(idx)}
                              className={`block w-full text-left rounded-md px-2 py-1.5 mb-1 text-xs transition ${
                                idx === activeSlotIndex ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                              }`}
                            >
                              <span className="font-medium">{s.semester}</span>
                              <span className="text-muted-foreground">
                                {" "}
                                — {s.courseUnits.length} unit{s.courseUnits.length === 1 ? "" : "s"} (
                                {s.courseUnits.reduce((n, u) => n + u.topics.length, 0)} topics)
                              </span>
                              <div className="ml-3 mt-0.5 text-muted-foreground">
                                {s.courseUnits.map((u) => (
                                  <div key={u.title} className="truncate">
                                    {u.code ? `${u.code} — ` : ""}
                                    {u.title}
                                  </div>
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Step 2: active semester generation */}
          {activeSlot && (
            <div id="curriculum-semester-doc" className="rounded-2xl border bg-white slide-shadow overflow-hidden">
              <div className="miu-gradient px-5 sm:px-8 py-6 text-white">
                <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider opacity-90">
                  {MIU_FACTS.legalName}
                </p>
                <h2 className="mt-1 text-xl sm:text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  {activeSlot.label}
                </h2>
                <p className="mt-1 text-xs sm:text-sm opacity-90">{programName}</p>
              </div>

              <div className="px-5 sm:px-8 py-6 space-y-6">
                {notesLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : !notes ? (
                  <div className="print-hide text-center py-8">
                    <Layers className="mx-auto h-8 w-8 text-primary/50 mb-3" />
                    <p className="text-sm font-medium">Notes for {activeSlot.label} haven't been generated yet</p>
                    <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                      Every topic in this semester gets a full definition, key principles, a real-world
                      application, and a takeaway — nothing skipped, no placeholders.
                    </p>
                    {genError && (
                      <p className="mt-4 mx-auto max-w-md flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-left text-[11px] text-destructive leading-relaxed">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        {genError}
                      </p>
                    )}
                    <motion.button
                      type="button"
                      onClick={handleGenerate}
                      disabled={generating}
                      whileTap={{ scale: 0.97 }}
                      className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-60 transition-shadow"
                    >
                      {generating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Writing notes for every topic…
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" /> Generate notes for {activeSlot.label}
                        </>
                      )}
                    </motion.button>
                  </div>
                ) : (
                  <>
                    {notes.topics.map((t, i) => (
                      <TopicBlock key={i} topic={t} index={i} />
                    ))}

                    <div className="print-hide border-t pt-5 flex flex-col items-center gap-3 text-center">
                      <p className="text-sm text-muted-foreground">
                        <CheckCircle2 className="inline h-4 w-4 text-primary -mt-0.5 mr-1" />
                        Completed {activeSlot.label}
                        {!isLastSlot && " — shall I proceed to the next semester?"}
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleGenerate}
                          disabled={generating}
                          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium hover:border-primary hover:text-primary transition disabled:opacity-50"
                        >
                          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                          Regenerate this semester
                        </button>
                        {!isLastSlot && (
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.97 }}
                            onClick={() => setActiveSlotIndex((i) => i + 1)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg transition-shadow"
                          >
                            Proceed to {slots[activeSlotIndex + 1].label}
                            <ArrowRight className="h-4 w-4" />
                          </motion.button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t bg-slate-50 px-5 sm:px-8 py-4 text-[10px] sm:text-[11px] text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <span>{MIU_FACTS.legalName} • {MIU_FACTS.accreditation}</span>
                <span>{MIU_FACTS.website} • {MIU_FACTS.campusesShort}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TopicBlock({ topic, index }: { topic: SemesterNotes["topics"][number]; index: number }) {
  return (
    <section className="pb-5 border-b last:border-b-0 last:pb-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent mb-1">
        {[topic.courseUnitCode, topic.courseUnitTitle].filter(Boolean).join(" — ")}
      </p>
      <h3 className="text-base sm:text-lg font-semibold text-primary mb-3" style={{ fontFamily: "var(--font-display)" }}>
        {index + 1}. {topic.topicTitle}
      </h3>

      <div className="space-y-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            <BookOpen className="h-3.5 w-3.5" /> Definition &amp; Core Concepts
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{topic.definition}</p>
        </div>

        {topic.keyPrinciples.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              <Target className="h-3.5 w-3.5" /> Key Principles
            </p>
            <ul className="space-y-1">
              {topic.keyPrinciples.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            <Lightbulb className="h-3.5 w-3.5" /> Real-World Application
          </p>
          <p className="text-sm leading-relaxed text-slate-700">{topic.application}</p>
        </div>

        <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary mb-1">Takeaway</p>
          <p className="text-sm text-slate-700">{topic.summary}</p>
        </div>
      </div>
    </section>
  );
}
