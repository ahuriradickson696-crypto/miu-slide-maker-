import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Search,
  Loader2,
  Presentation,
  Sparkles,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  FileText,
  Trash2,
  GraduationCap,
  Settings,
} from "lucide-react";
import { readStoredApiKey } from "@/lib/api-key-storage";
import {
  listLectureNotes,
  listStandaloneNotes,
  deleteStandaloneNotes,
} from "@/lib/lecture-notes.functions";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { streamSse, type SseEvent } from "@/lib/sse-client";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/notes")({
  component: NotesHubPage,
});

type NoteSummary = {
  deckId: string;
  topic: string;
  courseName: string;
  courseCode: string;
  updatedAt: string;
};

function NotesHubPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </a>
          <div className="flex-1" />
          <a
            href="/slides"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition"
          >
            <Presentation className="h-3.5 w-3.5" /> Slide Studio
          </a>
          <a
            href="/curriculum"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition"
          >
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
            <h1
              className="text-xl sm:text-2xl font-semibold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Lecture Notes
            </h1>
            <p className="text-xs text-muted-foreground">
              {MIU_FACTS.legalName}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground max-w-xl">
          Write a full study guide from a topic alone, or generate notes from
          any deck in Slide Studio — either way, everything lands in the same
          library below.
        </p>

        <div className="mt-6">
          <AuthGate serviceName="Lecture Notes">
            <StandaloneNotesCreator />
            <div className="mt-10">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Standalone notes
              </h2>
              <StandaloneNotesLibrary />
            </div>
            <div className="mt-10">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                From your slide decks
              </h2>
              <NotesLibrary />
            </div>
          </AuthGate>
        </div>
      </div>
    </div>
  );
}

type StandaloneNoteSummary = {
  id: string;
  topic: string;
  courseName: string;
  updatedAt: string;
};

function StandaloneNotesCreator() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState("");
  const [configStatus, setConfigStatus] = useState<{
    sharedApiKey: boolean;
  } | null>(null);
  const [topic, setTopic] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const hasApiAccess = !!apiKey.trim() || !!configStatus?.sharedApiKey;

  useEffect(() => {
    setApiKey(readStoredApiKey());
    getPublicConfigStatus()
      .then(setConfigStatus)
      .catch(() => setConfigStatus(null));
  }, []);

  async function handleGenerate() {
    if (!hasApiAccess) {
      toast.error("Add an API key in Settings first.");
      return;
    }
    if (!topic.trim()) {
      toast.error("Give the notes a topic first.");
      return;
    }

    setGenerating(true);
    setGenError(null);
    setProgressMessage("Starting…");

    try {
      let finalId: string | null = null;
      await streamSse(
        "/api/lecture-notes-stream",
        {
          topic: topic.trim(),
          sourceText: sourceText.trim() || undefined,
          courseName: courseName.trim() || undefined,
          courseCode: courseCode.trim() || undefined,
          apiKey,
        },
        (event: SseEvent) => {
          if (event.stage === "error") {
            throw new Error(
              event.message || "Something went wrong generating these notes.",
            );
          }
          if (event.stage === "done" && event.result) {
            finalId = (event.result as { id: string }).id;
            return;
          }
          if (event.message) setProgressMessage(event.message);
        },
      );

      if (!finalId)
        throw new Error(
          "The notes finished but didn't come back with an id. Please try again.",
        );
      toast.success("Notes ready");
      navigate({ to: "/notes/read/$notesId", params: { notesId: finalId } });
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Couldn't generate notes. Please try again.";
      setGenError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
      setProgressMessage(null);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border bg-white p-5 sm:p-6"
    >
      {!hasApiAccess && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
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

      <label className="text-sm font-medium">Topic</label>
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="e.g. The French Revolution, Object-oriented design, Enzyme kinetics…"
        className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        disabled={generating}
      />

      <button
        type="button"
        onClick={() => setShowMore((s) => !s)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition"
      >
        {showMore ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <FileText className="h-3.5 w-3.5" />
        Add source material or course details (optional)
      </button>
      <AnimatePresence>
        {showMore && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Paste a reading, transcript, or anything else the notes should be grounded in. Leave blank to draw on general subject knowledge instead."
              rows={5}
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              disabled={generating}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="Course name (optional)"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={generating}
              />
              <input
                value={courseCode}
                onChange={(e) => setCourseCode(e.target.value)}
                placeholder="Course code (optional)"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={generating}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={generating || !topic.trim()}
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {generating ? progressMessage || "Generating…" : "Generate notes"}
      </button>

      {genError && (
        <p className="mt-3 text-sm text-destructive flex items-start gap-1.5">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {genError}
        </p>
      )}
    </motion.div>
  );
}

function StandaloneNotesLibrary() {
  const [notes, setNotes] = useState<StandaloneNoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  async function load() {
    setLoading(true);
    try {
      const result = await listStandaloneNotes({
        data: { offset: 0, limit: 25 },
      });
      if (!cancelledRef.current) setNotes(result.notes);
    } catch {
      if (!cancelledRef.current) setNotes([]);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  async function handleDelete(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    try {
      await deleteStandaloneNotes({ data: { id } });
    } catch {
      toast.error("Couldn't delete those notes — refreshing the list.");
      load();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No standalone notes yet — generate some above.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li
          key={n.id}
          className="group flex items-center gap-3 rounded-lg border bg-white px-4 py-3 hover:border-primary/40 transition"
        >
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <a href={`/notes/read/${n.id}`} className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{n.topic}</p>
            {n.courseName && (
              <p className="text-xs text-muted-foreground truncate">
                {n.courseName}
              </p>
            )}
          </a>
          <button
            type="button"
            onClick={() => handleDelete(n.id)}
            className="opacity-0 group-hover:opacity-100 transition p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
            aria-label={`Delete notes: ${n.topic}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function NotesLibrary() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  async function load(reset: boolean) {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const result = await listLectureNotes({
        data: { offset: reset ? 0 : notes.length, limit: 20, query },
      });
      setNotes((prev) => (reset ? result.notes : [...prev, ...result.notes]));
      setHasMore(result.hasMore);
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => load(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your lecture notes…"
          className="w-full rounded-lg border bg-white py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : notes.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-white/60 p-8 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">
            {query ? `No notes match "${query}"` : "No lecture notes yet"}
          </p>
          {!query && (
            <p className="mt-1 text-xs text-muted-foreground">
              Generate a slide deck first, then click "Lecture Notes" on it.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((n, i) => (
            <motion.a
              key={n.deckId}
              href={`/lecture-notes/${n.deckId}`}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
              className="flex items-center gap-3 rounded-xl border bg-white p-4 hover:border-primary transition"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BookOpen className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {n.topic || "Untitled lecture"}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {[n.courseCode, n.courseName].filter(Boolean).join(" • ") ||
                    "—"}{" "}
                  • updated {new Date(n.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </motion.a>
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => load(false)}
              disabled={loadingMore}
              className="w-full rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition disabled:opacity-50"
            >
              {loadingMore ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" />
              ) : (
                "Load more"
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}
