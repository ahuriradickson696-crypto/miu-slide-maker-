import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Timer,
  RotateCcw,
  Sparkles,
  ListChecks,
} from "lucide-react";
import {
  getQuizById,
  type Quiz,
  type QuizQuestion,
} from "@/lib/quiz.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/quiz/take/$quizId")({
  component: QuizTakePage,
});

function QuizTakePage() {
  const { quizId } = Route.useParams();
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a
            href="/quiz"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Quiz Engine</span>
          </a>
          <div className="flex-1" />
          <img
            src={logo}
            alt=""
            className="h-6 w-6 object-contain opacity-70"
          />
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 sm:py-10">
        <AuthGate serviceName="the Quiz Engine">
          <QuizTakeInner quizId={quizId} />
        </AuthGate>
      </div>
    </div>
  );
}

type Phase = "loading" | "error" | "intro" | "taking" | "results";

type AnswerState = {
  selectedIndex?: number; // mcq
  selfMarkedCorrect?: boolean; // short_answer, self-graded against the sample answer
  revealed: boolean;
};

function isCorrect(
  q: QuizQuestion,
  a: AnswerState | undefined,
): boolean | null {
  if (!a?.revealed) return null;
  if (q.type === "mcq") return a.selectedIndex === q.correctIndex;
  return a.selfMarkedCorrect ?? false;
}

function QuizTakeInner({ quizId }: { quizId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [timedMode, setTimedMode] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedMs, setFinishedMs] = useState<number | null>(null);

  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, AnswerState>>({});
  const [shortAnswerDraft, setShortAnswerDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    getQuizById({ data: { id: quizId } })
      .then((q) => {
        if (cancelled) return;
        if (!q) {
          setError("This quiz doesn't exist, or was deleted.");
          setPhase("error");
          return;
        }
        setQuiz(q);
        setPhase("intro");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load this quiz.");
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  // Countdown timer for timed mode — auto-locks in whatever's answered and jumps to results at zero.
  useEffect(() => {
    if (phase !== "taking" || secondsLeft === null) return;
    if (secondsLeft <= 0) {
      setFinishedMs(startedAt ? Date.now() - startedAt : null);
      setPhase("results");
      return;
    }
    const t = setTimeout(
      () => setSecondsLeft((s) => (s === null ? null : s - 1)),
      1000,
    );
    return () => clearTimeout(t);
  }, [phase, secondsLeft, startedAt]);

  function startQuiz(timed: boolean) {
    if (!quiz) return;
    setTimedMode(timed);
    setSecondsLeft(timed ? Math.round(quiz.questions.length * 90) : null);
    setStartedAt(Date.now());
    setCurrent(0);
    setAnswers({});
    setShortAnswerDraft("");
    setPhase("taking");
  }

  function selectMcqOption(qIndex: number, optionIndex: number) {
    setAnswers((prev) =>
      prev[qIndex]?.revealed
        ? prev
        : {
            ...prev,
            [qIndex]: { selectedIndex: optionIndex, revealed: false },
          },
    );
  }

  function revealCurrent() {
    const q = quiz!.questions[current];
    if (!q) return;
    setAnswers((prev) => {
      const existing = prev[current] ?? { revealed: false };
      if (q.type === "mcq" && existing.selectedIndex === undefined) {
        toast.error("Pick an answer first.");
        return prev;
      }
      return { ...prev, [current]: { ...existing, revealed: true } };
    });
  }

  function selfMark(correct: boolean) {
    setAnswers((prev) => ({
      ...prev,
      [current]: {
        ...(prev[current] ?? { revealed: false }),
        selfMarkedCorrect: correct,
        revealed: true,
      },
    }));
  }

  function goNext() {
    if (!quiz) return;
    setShortAnswerDraft("");
    if (current + 1 >= quiz.questions.length) {
      setFinishedMs(startedAt ? Date.now() - startedAt : null);
      setPhase("results");
    } else {
      setCurrent((c) => c + 1);
    }
  }

  function goTo(index: number) {
    // Free navigation to anything already answered (review); no skipping ahead into the unknown.
    if (index === current || answers[index]?.revealed || index < current) {
      setShortAnswerDraft("");
      setCurrent(index);
    }
  }

  const score = useMemo(() => {
    if (!quiz) return { correct: 0, total: 0 };
    let correct = 0;
    quiz.questions.forEach((q, i) => {
      if (isCorrect(q, answers[i])) correct++;
    });
    return { correct, total: quiz.questions.length };
  }, [quiz, answers]);

  if (phase === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading quiz…
      </div>
    );
  }

  if (phase === "error" || !quiz) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        {error}
      </div>
    );
  }

  if (phase === "intro") {
    const empty = quiz.questions.length === 0;
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border bg-white p-6 text-center"
      >
        <ListChecks className="h-8 w-8 text-primary mx-auto" />
        <h1
          className="mt-3 text-lg font-semibold"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {quiz.topic}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {quiz.questions.length} questions
        </p>

        {empty ? (
          <p className="mt-6 text-sm text-destructive">
            This quiz has no questions to take. Try generating a new one.
          </p>
        ) : (
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => startQuiz(false)}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:border-primary/50 transition"
            >
              Untimed
            </button>
            <button
              onClick={() => startQuiz(true)}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition"
            >
              <Timer className="h-4 w-4" />
              Timed — {Math.round(quiz.questions.length * 1.5)} min
            </button>
          </div>
        )}
      </motion.div>
    );
  }

  if (phase === "results") {
    const pct = score.total
      ? Math.round((score.correct / score.total) * 100)
      : 0;
    return (
      <div className="space-y-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border bg-white p-6 text-center"
        >
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Score
          </p>
          <p
            className="mt-1 text-4xl font-semibold"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {score.correct}/{score.total}
          </p>
          <p className="text-sm text-muted-foreground">
            {pct}% correct
            {finishedMs ? ` · ${Math.round(finishedMs / 1000)}s` : ""}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              onClick={() => setPhase("intro")}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:border-primary/50 transition"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retake
            </button>
            <a
              href="/quiz"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 transition"
            >
              <Sparkles className="h-3.5 w-3.5" /> New quiz
            </a>
          </div>
        </motion.div>

        <div className="space-y-3">
          {quiz.questions.map((q, i) => (
            <ReviewCard key={i} index={i} question={q} answer={answers[i]} />
          ))}
        </div>
      </div>
    );
  }

  // phase === "taking"
  const q = quiz.questions[current];
  if (!q) {
    // Defensive: shouldn't happen (generation refuses to save a
    // 0-question quiz), but a render crash here is worse than a clear
    // message, so guard it explicitly rather than trust that invariant forever.
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        This quiz doesn't have a question at position {current + 1}. Try
        starting over.
      </div>
    );
  }
  const answer = answers[current];
  const revealed = answer?.revealed ?? false;
  const correct = isCorrect(q, answer);

  return (
    <div>
      {/* Segmented progress bar: doubles as a map back to anything already answered. */}
      <div className="flex gap-1 mb-2">
        {quiz.questions.map((_, i) => {
          const a = answers[i];
          const state =
            i === current
              ? "current"
              : a?.revealed
                ? isCorrect(quiz.questions[i], a)
                  ? "correct"
                  : "incorrect"
                : "future";
          return (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Question ${i + 1}`}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                state === "current"
                  ? "bg-primary"
                  : state === "correct"
                    ? "bg-primary/60"
                    : state === "incorrect"
                      ? "bg-destructive/60"
                      : "bg-muted"
              }`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
        <span>
          Question {current + 1} of {quiz.questions.length}
        </span>
        {timedMode && secondsLeft !== null && (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Timer className="h-3.5 w-3.5" /> {Math.floor(secondsLeft / 60)}:
            {String(secondsLeft % 60).padStart(2, "0")}
          </span>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={current}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.2 }}
          className="rounded-xl border bg-white p-5 sm:p-6"
        >
          <p className="text-base font-medium">{q.question}</p>

          {q.type === "mcq" ? (
            <div className="mt-4 space-y-2">
              {q.options?.map((opt, oi) => {
                const isSelected = answer?.selectedIndex === oi;
                const isRight = oi === q.correctIndex;
                let style = "border-input hover:border-primary/50";
                if (revealed) {
                  if (isRight) style = "border-primary bg-primary/5";
                  else if (isSelected && !isRight)
                    style = "border-destructive bg-destructive/5";
                } else if (isSelected) {
                  style = "border-primary bg-primary/5";
                }
                return (
                  <button
                    key={oi}
                    onClick={() => selectMcqOption(current, oi)}
                    disabled={revealed}
                    className={`w-full text-left rounded-lg border px-3.5 py-2.5 text-sm transition flex items-center gap-2 ${style}`}
                  >
                    {revealed && isRight && (
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                    )}
                    {revealed && isSelected && !isRight && (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-4">
              <textarea
                value={shortAnswerDraft}
                onChange={(e) => setShortAnswerDraft(e.target.value)}
                disabled={revealed}
                placeholder="Type your answer…"
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
              {revealed && (
                <div className="mt-3 rounded-lg bg-muted px-3.5 py-2.5 text-sm">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                    Model answer
                  </p>
                  {q.sampleAnswer}
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center gap-2">
            {!revealed ? (
              q.type === "mcq" ? (
                <button
                  onClick={revealCurrent}
                  className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                >
                  Check answer
                </button>
              ) : (
                <>
                  <button
                    onClick={() => selfMark(true)}
                    disabled={!shortAnswerDraft.trim()}
                    className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
                  >
                    Reveal model answer
                  </button>
                </>
              )
            ) : (
              <>
                {q.type === "mcq" && (
                  <span
                    className={`text-sm font-medium ${correct ? "text-primary" : "text-destructive"}`}
                  >
                    {correct ? "Correct" : "Not quite"}
                  </span>
                )}
                {q.type === "short_answer" &&
                  answer?.selfMarkedCorrect === undefined && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Mark yourself:
                      </span>
                      <button
                        onClick={() => selfMark(true)}
                        className="rounded-md border px-2.5 py-1 text-xs font-medium hover:border-primary/50 transition"
                      >
                        Got it
                      </button>
                      <button
                        onClick={() => selfMark(false)}
                        className="rounded-md border px-2.5 py-1 text-xs font-medium hover:border-destructive/50 transition"
                      >
                        Missed it
                      </button>
                    </div>
                  )}
                <div className="flex-1" />
                <button
                  onClick={goNext}
                  className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition"
                >
                  {current + 1 >= quiz.questions.length
                    ? "See results"
                    : "Next question"}
                </button>
              </>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ReviewCard({
  index,
  question,
  answer,
}: {
  index: number;
  question: QuizQuestion;
  answer: AnswerState | undefined;
}) {
  const [open, setOpen] = useState(false);
  const correct = isCorrect(question, answer);

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {correct ? (
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive shrink-0" />
        )}
        <span className="text-xs text-muted-foreground shrink-0">
          Q{index + 1}
        </span>
        <span className="text-sm truncate flex-1">{question.question}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            className="overflow-hidden border-t"
          >
            <div className="px-4 py-3 text-sm space-y-2">
              {question.type === "mcq" ? (
                question.options?.map((opt, oi) => (
                  <div
                    key={oi}
                    className={`rounded-md px-3 py-1.5 border ${
                      oi === question.correctIndex
                        ? "border-primary bg-primary/5"
                        : oi === answer?.selectedIndex
                          ? "border-destructive bg-destructive/5"
                          : "border-transparent"
                    }`}
                  >
                    {opt}
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">{question.sampleAnswer}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
