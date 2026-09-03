import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Download,
  FileDown,
  RefreshCw,
  ListChecks,
  Printer,
} from "lucide-react";
import { generateQuiz, getQuiz, type Quiz } from "@/lib/quiz.functions";
import { getDeck } from "@/lib/deck-storage.functions";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { readStoredApiKey } from "@/lib/api-key-storage";
import { downloadQuizAsQti } from "@/lib/quiz-qti-export";
import { downloadQuizMarkdown } from "@/lib/quiz-markdown";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/quiz/$deckId")({
  component: QuizPage,
});

function QuizPage() {
  return (
    <AuthGate serviceName="the Quiz Generator">
      <QuizPageInner />
    </AuthGate>
  );
}

function QuizPageInner() {
  const { deckId } = Route.useParams();
  const [topic, setTopic] = useState("");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [configStatus, setConfigStatus] = useState<{
    sharedApiKey: boolean;
  } | null>(null);
  const [questionCount, setQuestionCount] = useState(8);
  const [mix, setMix] = useState<"mcq" | "mixed" | "short_answer">("mixed");

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
    Promise.all([
      getDeck({ data: { id: deckId } }),
      getQuiz({ data: { deckId } }),
    ])
      .then(([d, q]) => {
        if (cancelled) return;
        setTopic(d.topic);
        setQuiz(q);
      })
      .catch(
        (e) =>
          !cancelled &&
          setLoadError(
            e instanceof Error ? e.message : "Couldn't load this deck.",
          ),
      )
      .finally(() => !cancelled && setLoading(false));
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
      const result = await generateQuiz({
        data: { deckId, apiKey, questionCount, mix },
      });
      setQuiz(result);
      toast.success("Quiz ready");
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't generate a quiz.";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      setGenError(rateLimitMatch ? rateLimitMatch[2] : message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="print-hide border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a
            href="/slides"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Slide Studio</span>
          </a>
          <div className="flex-1" />
          {quiz && (
            <>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 sm:px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
              >
                <Printer className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>
              <button
                type="button"
                onClick={() => downloadQuizMarkdown(quiz)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
              >
                <FileDown className="h-3.5 w-3.5" /> Markdown
              </button>
              <button
                type="button"
                onClick={() => downloadQuizAsQti(quiz)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition"
                title="QTI 1.2 — importable into Moodle, Canvas, Blackboard"
              >
                <Download className="h-3.5 w-3.5" /> Export for LMS
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
          <a
            href="/slides"
            className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
          >
            Back to Slide Studio
          </a>
        </div>
      )}

      {!loading && !loadError && (
        <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
          <div className="flex items-center gap-3 mb-6">
            <img src={logo} alt="" className="h-9 w-9 object-contain" />
            <div>
              <h1
                className="text-lg sm:text-xl font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Quiz — {topic}
              </h1>
              <p className="text-xs text-muted-foreground">
                {MIU_FACTS.legalName}
              </p>
            </div>
          </div>

          {!quiz ? (
            <div className="print-hide rounded-2xl border bg-white p-6 sm:p-8">
              <div className="flex items-center gap-2 mb-4">
                <ListChecks className="h-5 w-5 text-primary" />
                <p className="text-sm font-medium">
                  Generate a quiz from this deck
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Question count
                  </span>
                  <input
                    type="number"
                    min={3}
                    max={20}
                    value={questionCount}
                    onChange={(e) =>
                      setQuestionCount(
                        Math.max(3, Math.min(20, Number(e.target.value) || 8)),
                      )
                    }
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Question types
                  </span>
                  <select
                    value={mix}
                    onChange={(e) => setMix(e.target.value as typeof mix)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="mixed">Mixed (MCQ + short answer)</option>
                    <option value="mcq">Multiple choice only</option>
                    <option value="short_answer">Short answer only</option>
                  </select>
                </label>
              </div>

              {genError && (
                <p className="mb-4 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive leading-relaxed">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  {genError}
                </p>
              )}

              {!hasApiAccess && !genError && (
                <p className="mb-4 text-[11px] text-muted-foreground leading-relaxed">
                  Uses the same API key as every other tool here —{" "}
                  <a href="/settings" className="underline underline-offset-2">
                    add one in Settings
                  </a>
                  .
                </p>
              )}

              <motion.button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                whileTap={{ scale: 0.97 }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-60 transition-shadow"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Writing
                    questions…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Generate quiz
                  </>
                )}
              </motion.button>
            </div>
          ) : (
            <div id="quiz-doc" className="space-y-4">
              {quiz.questions.map((q, i) => (
                <div key={i} className="rounded-xl border bg-white p-5">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    Question {i + 1}
                  </p>
                  <p className="text-sm font-medium mb-3">{q.question}</p>
                  {q.type === "mcq" && q.options ? (
                    <div className="space-y-1.5">
                      {q.options.map((opt, oi) => (
                        <div
                          key={oi}
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                            oi === q.correctIndex
                              ? "border-primary bg-primary/5"
                              : ""
                          }`}
                        >
                          {oi === q.correctIndex && (
                            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                          )}
                          <span>
                            {String.fromCharCode(65 + oi)}. {opt}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                      <p className="text-xs font-semibold text-primary mb-1">
                        Model answer
                      </p>
                      <p className="text-sm text-slate-700">{q.sampleAnswer}</p>
                    </div>
                  )}
                </div>
              ))}

              <div className="print-hide flex justify-center pt-2">
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
                  Regenerate quiz
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
