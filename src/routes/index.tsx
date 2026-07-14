import { createFileRoute } from "@tanstack/react-router";
import { Component, useEffect, useState, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import {
  Loader2,
  Sparkles,
  Download,
  FileText,
  Wand2,
  KeyRound,
  History,
  Trash2,
  X,
} from "lucide-react";
import { generateDeck, type SlideDeck } from "@/lib/slides.functions";
import { exportDeckToPptx } from "@/lib/pptx-export";
import {
  saveDeck,
  listDecks,
  getDeck,
  deleteDeck,
} from "@/lib/deck-storage.functions";
import logo from "@/assets/miu-logo.jpg";

type HistoryItem = {
  id: string;
  topic: string;
  courseName: string;
  courseCode: string;
  suggestedFilename: string;
  slideCount: number;
  createdAt: string;
};

export const Route = createFileRoute("/")({
  component: StudioPage,
});

const API_KEY_STORAGE_KEY = "miu-slide-studio:gemini-api-key";

function StudioPage() {
  return (
    <ErrorBoundary>
      <StudioPageInner />
    </ErrorBoundary>
  );
}

function StudioPageInner() {
  const [mode, setMode] = useState<"brief" | "paste">("brief");
  const [apiKey, setApiKey] = useState("");
  const [form, setForm] = useState({
    topic: "",
    courseName: "",
    courseCode: "",
    courseLevel: "",
    creditUnits: "",
    contactTime: "",
    slideCount: 10,
    extraNotes: "",
    pastedContent: "",
  });
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [phase, setPhase] = useState<"idle" | "outline" | "done">("idle");
  const [downloading, setDownloading] = useState(false);

  // Live rate-limit countdown. When Gemini's free tier (10 req/min, 250/day)
  // returns a 429, the server tells us exactly how many seconds to wait via
  // a "RATE_LIMITED::<seconds>::message" error string. We count that down
  // visibly instead of silently retrying, so it's always obvious what's
  // happening and the button re-enables itself the moment it hits zero.
  const [cooldown, setCooldown] = useState<{ secondsLeft: number; total: number } | null>(null);

  // Saved-deck history, backed by Postgres via deck-storage.functions.
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingDeckId, setLoadingDeckId] = useState<string | null>(null);
  const [deletingDeckId, setDeletingDeckId] = useState<string | null>(null);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const rows = await listDecks();
      setHistory(rows);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load deck history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) refreshHistory();
  }

  async function handleLoadDeck(id: string) {
    setLoadingDeckId(id);
    try {
      const d = await getDeck({ data: { id } });
      setDeck(d);
      setPhase("done");
      setHistoryOpen(false);
      toast.success("Deck loaded");
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error ? e.message : "Couldn't load that deck",
      );
    } finally {
      setLoadingDeckId(null);
    }
  }

  async function handleDeleteDeck(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setDeletingDeckId(id);
    try {
      await deleteDeck({ data: { id } });
      setHistory((h) => h.filter((item) => item.id !== id));
    } catch (e) {
      console.error(e);
      toast.error("Couldn't delete that deck");
    } finally {
      setDeletingDeckId(null);
    }
  }

  useEffect(() => {
    if (!cooldown) return;
    if (cooldown.secondsLeft <= 0) {
      setCooldown(null);
      return;
    }
    const id = setTimeout(() => {
      setCooldown((c) => (c ? { ...c, secondsLeft: c.secondsLeft - 1 } : c));
    }, 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  function formatCooldown(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // The key never touches a server other than Google's — it's kept in the
  // browser only, so returning users don't have to paste it every time.
  // (Wrapped in try/catch: some browsers throw on localStorage access in
  // private/incognito mode instead of just returning null.)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(API_KEY_STORAGE_KEY);
      if (saved) setApiKey(saved);
    } catch {
      // Ignore — key entry will just not persist this session.
    }
  }, []);

  function updateApiKey(v: string) {
    setApiKey(v);
    try {
      if (v.trim()) window.localStorage.setItem(API_KEY_STORAGE_KEY, v.trim());
      else window.localStorage.removeItem(API_KEY_STORAGE_KEY);
    } catch {
      // Ignore — non-fatal if storage is unavailable.
    }
  }

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleGenerate() {
    if (phase === "outline") return; // already generating
    if (!apiKey.trim())
      return toast.error(
        "Add your free Gemini API key first (get one at aistudio.google.com/apikey)",
      );
    if (mode === "brief" && !form.topic.trim())
      return toast.error("Please enter a topic");
    if (mode === "paste" && form.pastedContent.trim().length < 20)
      return toast.error("Paste some course material first");
    setDeck(null);
    setPhase("outline");
    try {
      // In "paste" mode, Gemini extracts topic/course identification
      // details directly from the pasted text. Any leftover values from the
      // "brief" tab (or earlier edits) must NOT be sent here, or they'd
      // silently override what was correctly detected — only the explicit,
      // visible "Course code (optional override)" field is allowed through.
      const payload =
        mode === "paste"
          ? {
              mode,
              apiKey,
              pastedContent: form.pastedContent,
              extraNotes: form.extraNotes,
              slideCount: form.slideCount,
              courseCode: form.courseCode,
              topic: "",
              courseName: "",
              courseLevel: "",
              creditUnits: "",
              contactTime: "",
            }
          : { ...form, mode, apiKey };

      const d = await generateDeck({ data: payload });
      setDeck(d);
      setPhase("done");
      toast.success(`Deck ready — ${d.slides.length} slides`);

      // Persist to Postgres so it shows up in History. Best-effort: a save
      // failure (e.g. DATABASE_URL not configured yet) shouldn't block the
      // user from seeing/downloading the deck they just generated.
      try {
        await saveDeck({
          data: {
            courseName: d.courseName,
            courseCode: d.courseCode,
            courseLevel: d.courseLevel,
            creditUnits: d.creditUnits,
            contactTime: d.contactTime,
            topic: d.topic,
            suggestedFilename: d.suggestedFilename ?? "",
            slides: d.slides,
          },
        });
        if (historyOpen) refreshHistory();
      } catch (saveErr) {
        console.error("Deck save failed:", saveErr);
      }
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Generation failed";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      if (rateLimitMatch) {
        const seconds = parseInt(rateLimitMatch[1], 10);
        setCooldown({ secondsLeft: seconds, total: seconds });
        toast.error(
          `Rate limited — wait ${formatCooldown(seconds)} (shown on the button)`,
        );
      } else {
        toast.error(message);
      }
      setPhase("idle");
    }
  }

  async function handleDownload() {
    if (!deck || downloading) return;
    setDownloading(true);
    try {
      await exportDeckToPptx(deck);
      toast.success("Downloaded PowerPoint file");
    } catch (e) {
      console.error(e);
      toast.error(
        e instanceof Error && e.message ? e.message : "Export failed",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="miu-gradient text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center gap-4">
          <img
            src={logo}
            alt="MIU logo"
            className="h-14 w-14 rounded-xl bg-white p-1 shadow-lg"
          />
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Metropolitan International University
            </h1>
            <p className="text-sm opacity-90">
              Slide Studio — Lecture Deck Generator
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            Powered by Gemini • Free tier
          </div>
          <button
            type="button"
            onClick={toggleHistory}
            className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
        </div>
      </header>

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="relative h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h3 className="font-semibold text-sm">Saved decks</h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                className="rounded-md p-1 hover:bg-muted transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {historyLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : history.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  No saved decks yet — generate one and it'll show up here.
                </p>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleLoadDeck(item.id)}
                    className="cursor-pointer rounded-lg border p-3 hover:border-primary transition flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {item.topic || item.suggestedFilename || "Untitled deck"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[item.courseCode, item.courseName]
                          .filter(Boolean)
                          .join(" • ") || "—"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {item.slideCount} slides •{" "}
                        {new Date(item.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                      {loadingDeckId === item.id && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteDeck(item.id, e)}
                        disabled={deletingDeckId === item.id}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition disabled:opacity-50"
                      >
                        {deletingDeckId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-7xl px-6 py-8 grid gap-8 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <section className="rounded-2xl bg-card border p-6 slide-shadow h-fit sticky top-6">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Deck brief</h2>
          </div>

          {/* Gemini API key */}
          <div className="mb-4 rounded-lg border bg-muted/40 p-3">
            <Field label="Gemini API key" required>
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => updateApiKey(e.target.value)}
                  placeholder="Paste your free Gemini API key"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  autoComplete="off"
                />
              </div>
            </Field>
            <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
              Free at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-primary"
              >
                aistudio.google.com/apikey
              </a>
              . Stored only in your browser — never sent anywhere but Google.
            </p>
          </div>

          {/* Mode tabs */}
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-muted p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setMode("brief")}
              className={`rounded-md py-2 transition ${mode === "brief" ? "bg-card shadow text-primary" : "text-muted-foreground"}`}
            >
              Guided brief
            </button>
            <button
              type="button"
              onClick={() => setMode("paste")}
              className={`rounded-md py-2 transition ${mode === "paste" ? "bg-card shadow text-primary" : "text-muted-foreground"}`}
            >
              Paste & Go
            </button>
          </div>

          {mode === "brief" ? (
            <div className="space-y-3">
              <Field label="Topic / lecture prompt" required>
                <textarea
                  value={form.topic}
                  onChange={(e) => update("topic", e.target.value)}
                  rows={3}
                  placeholder="e.g. Topic Seven: Reports — types, structure, and language"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Course code">
                  <Input
                    value={form.courseCode}
                    onChange={(v) => update("courseCode", v)}
                    placeholder="e.g. BEE 1101"
                  />
                </Field>
                <Field label="Slides">
                  <input
                    type="number"
                    min={4}
                    max={20}
                    value={form.slideCount}
                    onChange={(e) =>
                      update("slideCount", parseInt(e.target.value) || 10)
                    }
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </div>
              <Field label="Course name">
                <Input
                  value={form.courseName}
                  onChange={(v) => update("courseName", v)}
                  placeholder="e.g. Communication Skills"
                />
              </Field>
              <Field label="Course level">
                <Input
                  value={form.courseLevel}
                  onChange={(v) => update("courseLevel", v)}
                  placeholder="e.g. Undergraduate-Degree (Year One, Semester One)"
                />
              </Field>
              <Field label="Credit units">
                <Input
                  value={form.creditUnits}
                  onChange={(v) => update("creditUnits", v)}
                  placeholder="e.g. 3 Credit Units | Total Contact Hours: 45"
                />
              </Field>
              <Field label="Contact time">
                <Input
                  value={form.contactTime}
                  onChange={(v) => update("contactTime", v)}
                  placeholder="e.g. Allocated Contact Time: 3 Hours"
                />
              </Field>
              <Field label="Extra guidance (optional)">
                <textarea
                  value={form.extraNotes}
                  onChange={(e) => update("extraNotes", e.target.value)}
                  rows={2}
                  placeholder="Focus areas, learning outcomes, tone…"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <Field
                label="Paste everything — notes, textbook chapter, outline"
                required
              >
                <textarea
                  value={form.pastedContent}
                  onChange={(e) => update("pastedContent", e.target.value)}
                  rows={14}
                  placeholder="Drop your full lecture notes, a chapter, or a rough outline here. Use headings (or ALL CAPS lines / lines ending in ':') to mark section breaks — each becomes a slide."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Slides">
                  <input
                    type="number"
                    min={4}
                    max={24}
                    value={form.slideCount}
                    onChange={(e) =>
                      update("slideCount", parseInt(e.target.value) || 10)
                    }
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Course code (optional override)">
                  <Input
                    value={form.courseCode}
                    onChange={(v) => update("courseCode", v)}
                    placeholder="Leave blank to auto-detect from your text"
                  />
                </Field>
              </div>
              <Field label="Extra guidance (optional)">
                <textarea
                  value={form.extraNotes}
                  onChange={(e) => update("extraNotes", e.target.value)}
                  rows={2}
                  placeholder="Tone, audience, learning outcomes…"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </Field>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                💡 Labeled lines like "Course Code:" or "Credit Units:" are
                detected automatically and won't show up as slide content.
              </p>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={phase === "outline" || !apiKey.trim() || !!cooldown}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
          >
            {phase === "outline" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Building deck…
              </>
            ) : cooldown ? (
              <>Wait {formatCooldown(cooldown.secondsLeft)}</>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate slide deck
              </>
            )}
          </button>

          {cooldown && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between text-xs text-amber-900">
                <span>Free-tier rate limit (10 req/min, 250/day)</span>
                <span className="font-mono font-semibold">
                  {formatCooldown(cooldown.secondsLeft)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-1000 ease-linear"
                  style={{
                    width: `${(cooldown.secondsLeft / cooldown.total) * 100}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-amber-700">
                The button unlocks itself automatically — no need to keep checking.
              </p>
            </div>
          )}

          {deck && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60 transition"
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Preparing file…
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" /> Download .pptx
                </>
              )}
            </button>
          )}
        </section>

        {/* Preview */}
        <section>
          {!deck && phase === "idle" && <EmptyState />}
          {phase === "outline" && (
            <SkeletonState label="Structuring your deck…" />
          )}
          {deck && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{deck.topic}</h2>
                  <p className="text-sm text-muted-foreground">
                    {deck.slides.length} slides • {deck.courseCode}{" "}
                    {deck.courseName}
                  </p>
                </div>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {Array.isArray(deck.slides) &&
                  deck.slides.map((s, i) => (
                    <SlideCard key={i} index={i} spec={s} deck={deck} />
                  ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-6 py-8 text-xs text-muted-foreground border-t mt-8">
        Metropolitan International University • www.miu.ac.ug • Kampala •
        Mbarara • Kisoro Campuses
      </footer>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed p-10 text-center text-muted-foreground">
      <FileText className="mx-auto h-10 w-10 text-primary/60" />
      <h3 className="mt-3 font-semibold text-foreground">
        Start with a topic on the left
      </h3>
      <p className="mt-1 text-sm">
        We'll write the outline and export a MIU-branded PowerPoint you can
        present or edit.
      </p>
    </div>
  );
}

function SkeletonState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border p-10 text-center">
      <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
      <p className="mt-3 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function ErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundaryClass>{children}</ErrorBoundaryClass>;
}

class ErrorBoundaryClass extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("Slide Studio crashed:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background px-6">
          <div className="max-w-md rounded-2xl border p-8 text-center slide-shadow">
            <h2 className="font-semibold text-lg">Something went wrong</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The page hit an unexpected error and couldn't continue. Your
              Gemini key is still saved — reloading should get you back to a
              clean state.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function SlideCard({
  index,
  spec,
  deck,
}: {
  index: number;
  spec: SlideDeck["slides"][number];
  deck: SlideDeck;
}) {
  const isTitle = spec.type === "title";
  return (
    <div className="rounded-xl overflow-hidden border bg-card slide-shadow">
      <div
        className={`aspect-video relative overflow-hidden ${isTitle ? "text-white" : ""}`}
        style={{ background: isTitle ? "#0F7A3A" : "#ffffff" }}
      >
        {isTitle ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <img
              src={logo}
              alt=""
              className="h-16 w-16 rounded-lg bg-white p-1 mb-3"
            />
            <div className="text-[10px] font-bold tracking-wider">
              METROPOLITAN INTERNATIONAL UNIVERSITY
            </div>
            <div className="mt-1 text-lg font-semibold">{spec.title}</div>
            <div className="mt-3 flex gap-2 flex-wrap justify-center">
              {[deck.courseCode, deck.courseName].filter(Boolean).map((p) => (
                <span
                  key={p}
                  className="rounded-md bg-[#C8102E] px-2 py-0.5 text-[10px] font-bold"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 p-4 flex flex-col">
            <div className="text-[11px] font-bold text-[#0F7A3A] uppercase tracking-wide">
              {spec.title}
            </div>
            {spec.subtitle && (
              <div className="text-[9px] italic text-[#C8102E] mt-0.5">
                {spec.subtitle}
              </div>
            )}
            <div className="flex-1 mt-2 min-h-0">
              <div className="text-[9px] text-slate-700 space-y-1.5 overflow-hidden">
                {spec.body && <p className="line-clamp-3">{spec.body}</p>}
                {spec.sections &&
                  Array.isArray(spec.sections) &&
                  spec.sections.slice(0, 3).map((s, i) => (
                    <div key={i}>
                      <div className="font-bold text-[#C8102E]">{s.heading}</div>
                      <div className="line-clamp-2">{s.description}</div>
                    </div>
                  ))}
                {spec.bullets && Array.isArray(spec.bullets) && (
                  <ul className="list-disc pl-3 space-y-0.5">
                    {spec.bullets.slice(0, 5).map((b, i) => (
                      <li key={i} className="line-clamp-1">
                        {b}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="text-[7px] text-slate-500 border-t pt-1 mt-1 truncate">
              MIU • www.miu.ac.ug • Kampala • Mbarara • Kisoro
            </div>
          </div>
        )}
      </div>
      <div className="px-3 py-2 flex items-center justify-between text-xs bg-muted/40">
        <span className="text-muted-foreground">Slide {index + 1}</span>
        <span className="font-mono text-[10px] uppercase text-primary">
          {spec.type}
        </span>
      </div>
    </div>
  );
}
