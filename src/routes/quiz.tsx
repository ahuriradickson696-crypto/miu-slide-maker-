import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertTriangle,
  ListChecks,
  Presentation,
  BookOpen,
  GraduationCap,
  Settings,
  Trash2,
  ChevronRight,
  ChevronDown,
  FileText,
} from "lucide-react";
import { listQuizzes, deleteQuiz } from "@/lib/quiz.functions";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { streamSse, type SseEvent } from "@/lib/sse-client";
import { readStoredApiKey } from "@/lib/api-key-storage";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/quiz")({
  component: QuizHubPage,
});

const QUESTION_COUNTS = [5, 8, 10, 15, 20];

function QuizHubPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </a>
          <div className="flex-1" />
          <a href="/slides" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition">
            <Presentation className="h-3.5 w-3.5" /> Slide Studio
          </a>
          <a href="/notes" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition">
            <BookOpen className="h-3.5 w-3.5" /> Lecture Notes
          </a>
          <a href="/curriculum" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition">
            <GraduationCap className="h-3.5 w-3.5" /> Curriculum
          </a>
          <a href="/settings" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition">
            <Settings className="h-3.5 w-3.5" /> Settings
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center gap-3 mb-1">
          <img src={logo} alt="" className="h-9 w-9 object-contain" />
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Quiz Engine
            </h1>
            <p className="text-xs text-muted-foreground">{MIU_FACTS.legalName}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground max-w-xl">
          Give it a topic — with or without a slide deck behind it — and it builds a real test-taking experience:
          answer one question at a time, get instant rationale, then review your score.
        </p>

        <div className="mt-6">
          <AuthGate serviceName="the Quiz Engine">
            <QuizHubInner />
          </AuthGate>
        </div>
      </div>
    </div>
  );
}

type StandaloneQuizSummary = { id: string; topic: string; questionCount: number; createdAt: string };

function QuizHubInner() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState("");
  const [configStatus, setConfigStatus] = useState<{ sharedApiKey: boolean } | null>(null);
  const [topic, setTopic] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [questionCount, setQuestionCount] = useState(8);
  const [mix, setMix] = useState<"mcq" | "mixed" | "short_answer">("mixed");
  const [generating, setGenerating] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [quizzes, setQuizzes] = useState<StandaloneQuizSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const cancelledRef = useRef(false);

  const hasApiAccess = !!apiKey.trim() || !!configStatus?.sharedApiKey;

  useEffect(() => {
    setApiKey(readStoredApiKey());
    getPublicConfigStatus().then(setConfigStatus).catch(() => setConfigStatus(null));
    refreshList();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function refreshList() {
    setLoadingList(true);
    try {
      const result = await listQuizzes({ data: { offset: 0, limit: 25 } });
      if (!cancelledRef.current) setQuizzes(result.quizzes);
    } catch {
      // a failed library refresh shouldn't block the create form
    } finally {
      if (!cancelledRef.current) setLoadingList(false);
    }
  }

  async function handleGenerate() {
    if (!hasApiAccess) {
      toast.error("Add an API key in Settings first.");
      return;
    }
    if (!topic.trim()) {
      toast.error("Give the quiz a topic first.");
      return;
    }

    setGenerating(true);
    setGenError(null);
    setProgressMessage("Starting…");

    try {
      let finalQuizId: string | null = null;
      await streamSse(
        "/api/quiz-stream",
        { topic: topic.trim(), sourceText: sourceText.trim() || undefined, apiKey, questionCount, mix },
        (event: SseEvent) => {
          if (event.stage === "error") {
            throw new Error(event.message || "Something went wrong generating this quiz.");
          }
          if (event.stage === "done" && event.result) {
            finalQuizId = (event.result as { id: string }).id;
            return;
          }
          if (event.message) setProgressMessage(event.message);
        },
      );

      if (!finalQuizId) throw new Error("The quiz finished but didn't come back with an id. Please try again.");
      toast.success("Quiz ready");
      navigate({ to: "/quiz/take/$quizId", params: { quizId: finalQuizId } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't generate a quiz. Please try again.";
      setGenError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
      setProgressMessage(null);
    }
  }

  async function handleDelete(id: string) {
    setQuizzes((prev) => prev.filter((q) => q.id !== id));
    try {
      await deleteQuiz({ data: { id } });
    } catch {
      toast.error("Couldn't delete that quiz — refreshing the list.");
      refreshList();
    }
  }

  return (
    <div className="space-y-8">
      {!hasApiAccess && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Add an API key in{" "}
            <a href="/settings" className="underline underline-offset-2 font-medium">
              Settings
            </a>{" "}
            first — it's shared across every tool here.
          </span>
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border bg-white p-5 sm:p-6"
      >
        <label className="text-sm font-medium">Topic</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Cellular respiration, The Cold War, Big-O notation…"
          className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={generating}
        />

        <button
          type="button"
          onClick={() => setShowSource((s) => !s)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition"
        >
          {showSource ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FileText className="h-3.5 w-3.5" />
          Add source material (optional)
        </button>
        <AnimatePresence>
          {showSource && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <textarea
                value={sourceText}
                onChange={(e) => setSourceText(e.target.value)}
                placeholder="Paste lecture notes, a reading, or anything else the questions should be grounded in. Leave blank to draw on general subject knowledge instead."
                rows={5}
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                disabled={generating}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-4 flex flex-wrap gap-6">
          <div>
            <label className="text-sm font-medium">Questions</label>
            <div className="mt-1.5 flex gap-1.5">
              {QUESTION_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setQuestionCount(n)}
                  disabled={generating}
                  className={`h-8 w-8 rounded-md text-sm font-medium border transition ${
                    questionCount === n ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/50"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Question types</label>
            <div className="mt-1.5 flex gap-1.5">
              {(
                [
                  ["mcq", "Multiple choice"],
                  ["mixed", "Mixed"],
                  ["short_answer", "Short answer"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMix(value)}
                  disabled={generating}
                  className={`rounded-md px-3 h-8 text-xs font-medium border transition ${
                    mix === value ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || !topic.trim()}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? progressMessage || "Generating…" : "Generate quiz"}
        </button>

        {genError && (
          <p className="mt-3 text-sm text-destructive flex items-start gap-1.5">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {genError}
          </p>
        )}
      </motion.div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your quizzes</h2>
        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : quizzes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No quizzes yet — generate one above to get started.</p>
        ) : (
          <ul className="space-y-2">
            {quizzes.map((q) => (
              <li key={q.id} className="group flex items-center gap-3 rounded-lg border bg-white px-4 py-3 hover:border-primary/40 transition">
                <ListChecks className="h-4 w-4 text-primary shrink-0" />
                <a href={`/quiz/take/${q.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{q.topic}</p>
                  <p className="text-xs text-muted-foreground">{q.questionCount} questions</p>
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(q.id)}
                  className="opacity-0 group-hover:opacity-100 transition p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete quiz: ${q.topic}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
