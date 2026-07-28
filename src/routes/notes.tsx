import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  Search,
  Loader2,
  Presentation,
  LogIn,
} from "lucide-react";
import { listLectureNotes } from "@/lib/lecture-notes.functions";
import { getCurrentUser, type SessionUser } from "@/lib/auth.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import logo from "@/assets/miu-logo.jpg";

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
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  async function load(reset: boolean) {
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const result = await listLectureNotes({ data: { offset: reset ? 0 : notes.length, limit: 20, query } });
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
    if (!authChecked) return;
    const t = setTimeout(() => load(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, authChecked]);

  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </a>
          <div className="flex-1" />
          <a href="/slides" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Presentation className="h-3.5 w-3.5" /> Slide Studio
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center gap-3 mb-1">
          <img src={logo} alt="" className="h-9 w-9 rounded-lg" />
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Lecture Notes Library
            </h1>
            <p className="text-xs text-muted-foreground">{MIU_FACTS.legalName}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground max-w-xl">
          Every lecture-notes document you've generated from a slide deck, in one place. Generate new notes from
          the "Lecture Notes" button on any deck in Slide Studio.
        </p>

        {!authChecked ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : !user ? (
          <div className="mt-8 rounded-2xl border bg-white p-8 text-center">
            <LogIn className="mx-auto h-8 w-8 text-primary/60 mb-3" />
            <p className="font-medium">Sign in to see your lecture notes</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Notes are saved per account, the same way decks are.
            </p>
            <a
              href="/slides"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
            >
              Go sign in
            </a>
          </div>
        ) : (
          <>
            <div className="relative mt-6 mb-4 max-w-sm">
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
                      <p className="text-sm font-medium truncate">{n.topic || "Untitled lecture"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[n.courseCode, n.courseName].filter(Boolean).join(" • ") || "—"} • updated{" "}
                        {new Date(n.updatedAt).toLocaleDateString()}
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
                    {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : "Load more"}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
