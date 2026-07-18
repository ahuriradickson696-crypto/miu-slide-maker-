import { createFileRoute } from "@tanstack/react-router";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { toast, Toaster } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
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
  Share2,
  Settings2,
  Sun,
  Moon,
  Monitor,
  Twitter,
  Facebook,
  Linkedin,
  MessageCircle,
  Send,
  Mail,
  Link2,
  Copy,
  Check,
  Rows3,
  LayoutGrid,
  Hash,
  Layers,
  BookOpen,
  GraduationCap,
  Award,
  Clock,
  Lightbulb,
  ClipboardPaste,
  Search,
  GripVertical,
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
const SETTINGS_STORAGE_KEY = "miu-slide-studio:settings";

type ThemePref = "light" | "dark" | "system";
type FontScale = "sm" | "md" | "lg";
type Density = "comfortable" | "compact";

type AppSettings = {
  theme: ThemePref;
  fontScale: FontScale;
  density: Density;
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  fontScale: "md",
  density: "comfortable",
};

function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applySettingsToDocument(settings: AppSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const resolvedDark =
    settings.theme === "dark" || (settings.theme === "system" && prefersDark);
  root.classList.toggle("dark", !!resolvedDark);
  root.setAttribute("data-font-scale", settings.fontScale);
}

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
  const [historyQuery, setHistoryQuery] = useState("");
  const pendingDeletes = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const filteredHistory = historyQuery.trim()
    ? history.filter((item) => {
        const q = historyQuery.trim().toLowerCase();
        return (
          item.topic?.toLowerCase().includes(q) ||
          item.suggestedFilename?.toLowerCase().includes(q) ||
          item.courseCode?.toLowerCase().includes(q) ||
          item.courseName?.toLowerCase().includes(q)
        );
      })
    : history;

  // Session usage — a lightweight local counter, not a substitute for Google's real quota.
  const [decksThisSession, setDecksThisSession] = useState(0);

  // Drag-to-reorder for the generated slide preview grid.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function reorderSlides(from: number, to: number) {
    if (from === to) return;
    setDeck((d) => {
      if (!d) return d;
      const slides = [...d.slides];
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      return { ...d, slides };
    });
  }

  // Personalization: theme, font size, and layout density, persisted locally.
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const loaded = loadSettings();
    setSettings(loaded);
    applySettingsToDocument(loaded);
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl+Enter to generate, Esc to close whichever panel is open.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === "Enter") {
        e.preventDefault();
        if (phase !== "outline" && apiKey.trim() && !cooldown) {
          handleGenerate();
        }
      } else if (e.key === "Escape") {
        setHistoryOpen(false);
        setSettingsOpen(false);
        setShareOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, apiKey, cooldown]);

  function updateSettings(patch: Partial<AppSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      applySettingsToDocument(next);
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage failures (private browsing, quota, etc.)
      }
      return next;
    });
  }

  function toggleSettings() {
    setSettingsOpen((v) => !v);
    setShareOpen(false);
    setHistoryOpen(false);
  }

  function toggleShare() {
    setShareOpen((v) => !v);
    setSettingsOpen(false);
    setHistoryOpen(false);
  }

  const shareUrl =
    typeof window !== "undefined" ? window.location.href : "https://miu.ac.ug";
  const shareText = deck
    ? `I just generated "${deck.topic}" as a MIU-branded lecture deck with MIU Slide Studio 🎓`
    : "MIU Slide Studio — turn a topic into a branded lecture deck in minutes.";

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  async function handleNativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "MIU Slide Studio", text: shareText, url: shareUrl });
      } catch {
        // user cancelled — no-op
      }
    }
  }

  useEffect(() => {
    return () => {
      Object.values(pendingDeletes.current).forEach((t) => clearTimeout(t));
    };
  }, []);

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
    setSettingsOpen(false);
    setShareOpen(false);
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
    const removed = history.find((item) => item.id === id);
    if (!removed) return;

    // Optimistically remove from the list right away.
    setHistory((h) => h.filter((item) => item.id !== id));

    toast(`Deleted "${removed.topic || removed.suggestedFilename || "Untitled deck"}"`, {
      action: {
        label: "Undo",
        onClick: () => {
          const timer = pendingDeletes.current[id];
          if (timer) {
            clearTimeout(timer);
            delete pendingDeletes.current[id];
          }
          setHistory((h) =>
            h.some((item) => item.id === id) ? h : [removed, ...h],
          );
        },
      },
      duration: 4500,
    });

    // Give the user a few seconds to undo before actually deleting server-side.
    pendingDeletes.current[id] = setTimeout(async () => {
      delete pendingDeletes.current[id];
      setDeletingDeckId(id);
      try {
        await deleteDeck({ data: { id } });
      } catch (err) {
        console.error(err);
        toast.error("Couldn't delete that deck");
        setHistory((h) => (h.some((item) => item.id === id) ? h : [removed, ...h]));
      } finally {
        setDeletingDeckId(null);
      }
    }, 4500);
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
      setDecksThisSession((n) => n + 1);
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
      <Toaster richColors position="top-center" closeButton />

      {/* Announces generation status changes to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        {phase === "outline"
          ? "Generating your slide deck"
          : phase === "done" && deck
            ? `Deck ready with ${deck.slides.length} slides`
            : ""}
      </div>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="miu-gradient text-primary-foreground"
      >
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center gap-4">
          <motion.img
            src={logo}
            alt="MIU logo"
            className="h-14 w-14 rounded-xl bg-white p-1 shadow-lg"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
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
            {decksThisSession > 0
              ? `${decksThisSession} deck${decksThisSession === 1 ? "" : "s"} this session`
              : "Powered by Gemini • Free tier"}
          </div>
          <motion.button
            type="button"
            onClick={toggleShare}
            aria-label="Share"
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Share</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={toggleSettings}
            aria-label="Settings"
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={toggleHistory}
            aria-label="History"
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">History</span>
          </motion.button>
        </div>
      </motion.header>

      <AnimatePresence>
        {historyOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end"
            initial="closed"
            animate="open"
            exit="closed"
          >
            <motion.div
              className="absolute inset-0 bg-black/40"
              variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }}
              transition={{ duration: 0.2 }}
              onClick={() => setHistoryOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Saved decks"
              className="relative h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col"
              variants={{ open: { x: 0 }, closed: { x: "100%" } }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-semibold text-sm">Saved decks</h3>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="Close saved decks"
                  className="rounded-md p-1 hover:bg-muted transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {history.length > 0 && (
                <div className="border-b px-3 py-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={historyQuery}
                      onChange={(e) => setHistoryQuery(e.target.value)}
                      placeholder="Search saved decks…"
                      aria-label="Search saved decks"
                      className="w-full rounded-lg border bg-background py-1.5 pl-8 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {historyLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : history.length === 0 ? (
                  <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                    No saved decks yet — generate one and it'll show up here.
                  </p>
                ) : filteredHistory.length === 0 ? (
                  <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                    No decks match "{historyQuery}".
                  </p>
                ) : (
                  filteredHistory.map((item, i) => (
                    <motion.div
                      key={item.id}
                      onClick={() => handleLoadDeck(item.id)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
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
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Share panel — post to every major platform, or copy/native-share */}
      <AnimatePresence>
        {shareOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end"
            initial="closed"
            animate="open"
            exit="closed"
          >
            <motion.div
              className="absolute inset-0 bg-black/40"
              variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }}
              transition={{ duration: 0.2 }}
              onClick={() => setShareOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Share"
              className="relative h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col"
              variants={{ open: { x: 0 }, closed: { x: "100%" } }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-semibold text-sm">Share</h3>
                <button
                  type="button"
                  onClick={() => setShareOpen(false)}
                  aria-label="Close share panel"
                  className="rounded-md p-1 hover:bg-muted transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {deck
                    ? `Share "${deck.topic}" or invite others to build their own MIU deck.`
                    : "Invite colleagues and students to MIU Slide Studio."}
                </p>

                {typeof navigator !== "undefined" && "share" in navigator && (
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleNativeShare}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
                  >
                    <Share2 className="h-4 w-4" /> Share via device…
                  </motion.button>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <ShareTile
                    label="X"
                    icon={<Twitter className="h-5 w-5" />}
                    color="#000000"
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
                  />
                  <ShareTile
                    label="Facebook"
                    icon={<Facebook className="h-5 w-5" />}
                    color="#1877F2"
                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}
                  />
                  <ShareTile
                    label="LinkedIn"
                    icon={<Linkedin className="h-5 w-5" />}
                    color="#0A66C2"
                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                  />
                  <ShareTile
                    label="WhatsApp"
                    icon={<MessageCircle className="h-5 w-5" />}
                    color="#25D366"
                    href={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
                  />
                  <ShareTile
                    label="Telegram"
                    icon={<Send className="h-5 w-5" />}
                    color="#26A5E4"
                    href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`}
                  />
                  <ShareTile
                    label="Email"
                    icon={<Mail className="h-5 w-5" />}
                    color="#0F7A3A"
                    href={`mailto:?subject=${encodeURIComponent("MIU Slide Studio")}&body=${encodeURIComponent(`${shareText}\n\n${shareUrl}`)}`}
                  />
                </div>

                <div className="rounded-lg border bg-muted/40 p-2 flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 min-w-0 truncate bg-transparent text-xs outline-none"
                  />
                  <motion.button
                    whileTap={{ scale: 0.92 }}
                    onClick={handleCopyLink}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings panel — personalization: theme, font size, layout density */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-end"
            initial="closed"
            animate="open"
            exit="closed"
          >
            <motion.div
              className="absolute inset-0 bg-black/40"
              variants={{ open: { opacity: 1 }, closed: { opacity: 0 } }}
              transition={{ duration: 0.2 }}
              onClick={() => setSettingsOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              className="relative h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col"
              variants={{ open: { x: 0 }, closed: { x: "100%" } }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-semibold text-sm">Settings</h3>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close settings"
                  className="rounded-md p-1 hover:bg-muted transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Theme</p>
                  <div className="grid grid-cols-3 gap-2">
                    <SettingOption
                      active={settings.theme === "light"}
                      onClick={() => updateSettings({ theme: "light" })}
                      icon={<Sun className="h-4 w-4" />}
                      label="Light"
                    />
                    <SettingOption
                      active={settings.theme === "dark"}
                      onClick={() => updateSettings({ theme: "dark" })}
                      icon={<Moon className="h-4 w-4" />}
                      label="Dark"
                    />
                    <SettingOption
                      active={settings.theme === "system"}
                      onClick={() => updateSettings({ theme: "system" })}
                      icon={<Monitor className="h-4 w-4" />}
                      label="System"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Text size</p>
                  <div className="grid grid-cols-3 gap-2">
                    <SettingOption
                      active={settings.fontScale === "sm"}
                      onClick={() => updateSettings({ fontScale: "sm" })}
                      label="Small"
                    />
                    <SettingOption
                      active={settings.fontScale === "md"}
                      onClick={() => updateSettings({ fontScale: "md" })}
                      label="Default"
                    />
                    <SettingOption
                      active={settings.fontScale === "lg"}
                      onClick={() => updateSettings({ fontScale: "lg" })}
                      label="Large"
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Slide preview layout</p>
                  <div className="grid grid-cols-2 gap-2">
                    <SettingOption
                      active={settings.density === "comfortable"}
                      onClick={() => updateSettings({ density: "comfortable" })}
                      icon={<Rows3 className="h-4 w-4" />}
                      label="Comfortable"
                    />
                    <SettingOption
                      active={settings.density === "compact"}
                      onClick={() => updateSettings({ density: "compact" })}
                      icon={<LayoutGrid className="h-4 w-4" />}
                      label="Compact"
                    />
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Preferences are saved on this device and applied automatically next time you visit.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-7xl px-6 py-8 grid gap-8 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="rounded-2xl bg-card border p-6 slide-shadow h-fit sticky top-6"
        >
          <div className="flex items-center gap-3 mb-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Wand2 className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="font-semibold leading-tight">Deck brief</h2>
              <p className="text-[11px] text-muted-foreground">
                Tell us the topic — we'll design the deck
              </p>
            </div>
          </div>

          {/* Gemini API key */}
          <div className="mb-5 rounded-xl border bg-gradient-to-br from-muted/60 to-muted/20 p-3.5">
            <Field label="Gemini API key" required icon={<KeyRound className="h-3.5 w-3.5" />}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => updateApiKey(e.target.value)}
                placeholder="Paste your free Gemini API key"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                autoComplete="off"
              />
            </Field>
            <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
              Free at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-dotted underline-offset-2 hover:text-primary"
              >
                aistudio.google.com/apikey
              </a>
              . Stored only in your browser — never sent anywhere but Google.
            </p>
          </div>

          {/* Mode tabs */}
          <div className="relative mb-5 grid grid-cols-2 rounded-lg bg-muted p-1 text-xs font-medium">
            {(["brief", "paste"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`relative z-10 flex items-center justify-center gap-1.5 rounded-md py-2 transition-colors ${
                  mode === m ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === m && (
                  <motion.span
                    layoutId="mode-pill"
                    className="absolute inset-0 -z-10 rounded-md bg-card shadow"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                {m === "brief" ? (
                  <Wand2 className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
                {m === "brief" ? "Guided brief" : "Paste & Go"}
              </button>
            ))}
          </div>

          {mode === "brief" ? (
            <div className="space-y-3">
              <Field label="Topic / lecture prompt" required icon={<Lightbulb className="h-3.5 w-3.5" />}>
                <textarea
                  value={form.topic}
                  onChange={(e) => update("topic", e.target.value)}
                  rows={3}
                  placeholder="e.g. Topic Seven: Reports — types, structure, and language"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 hover:border-primary/30"
                />
                <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                  {form.topic.length} characters
                </span>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Course code" icon={<Hash className="h-3.5 w-3.5" />}>
                  <Input
                    value={form.courseCode}
                    onChange={(v) => update("courseCode", v)}
                    placeholder="e.g. BEE 1101"
                  />
                </Field>
                <Field label="Slides" icon={<Layers className="h-3.5 w-3.5" />}>
                  <Stepper
                    value={form.slideCount}
                    onChange={(v) => update("slideCount", v)}
                    min={4}
                    max={20}
                  />
                </Field>
              </div>
              <Field label="Course name" icon={<BookOpen className="h-3.5 w-3.5" />}>
                <Input
                  value={form.courseName}
                  onChange={(v) => update("courseName", v)}
                  placeholder="e.g. Communication Skills"
                />
              </Field>
              <Field label="Course level" icon={<GraduationCap className="h-3.5 w-3.5" />}>
                <Input
                  value={form.courseLevel}
                  onChange={(v) => update("courseLevel", v)}
                  placeholder="e.g. Undergraduate-Degree (Year One, Semester One)"
                />
              </Field>
              <Field label="Credit units" icon={<Award className="h-3.5 w-3.5" />}>
                <Input
                  value={form.creditUnits}
                  onChange={(v) => update("creditUnits", v)}
                  placeholder="e.g. 3 Credit Units | Total Contact Hours: 45"
                />
              </Field>
              <Field label="Contact time" icon={<Clock className="h-3.5 w-3.5" />}>
                <Input
                  value={form.contactTime}
                  onChange={(v) => update("contactTime", v)}
                  placeholder="e.g. Allocated Contact Time: 3 Hours"
                />
              </Field>
              <Field label="Extra guidance (optional)" icon={<Sparkles className="h-3.5 w-3.5" />}>
                <textarea
                  value={form.extraNotes}
                  onChange={(e) => update("extraNotes", e.target.value)}
                  rows={2}
                  placeholder="Focus areas, learning outcomes, tone…"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 hover:border-primary/30"
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <Field
                label="Paste everything — notes, textbook chapter, outline"
                required
                icon={<ClipboardPaste className="h-3.5 w-3.5" />}
              >
                <textarea
                  value={form.pastedContent}
                  onChange={(e) => update("pastedContent", e.target.value)}
                  rows={14}
                  placeholder="Drop your full lecture notes, a chapter, or a rough outline here. Use headings (or ALL CAPS lines / lines ending in ':') to mark section breaks — each becomes a slide."
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 hover:border-primary/30"
                />
                <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                  {form.pastedContent.length.toLocaleString()} characters
                </span>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Slides" icon={<Layers className="h-3.5 w-3.5" />}>
                  <Stepper
                    value={form.slideCount}
                    onChange={(v) => update("slideCount", v)}
                    min={4}
                    max={24}
                  />
                </Field>
                <Field label="Course code (override)" icon={<Hash className="h-3.5 w-3.5" />}>
                  <Input
                    value={form.courseCode}
                    onChange={(v) => update("courseCode", v)}
                    placeholder="Leave blank to auto-detect"
                  />
                </Field>
              </div>
              <Field label="Extra guidance (optional)" icon={<Sparkles className="h-3.5 w-3.5" />}>
                <textarea
                  value={form.extraNotes}
                  onChange={(e) => update("extraNotes", e.target.value)}
                  rows={2}
                  placeholder="Tone, audience, learning outcomes…"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 hover:border-primary/30"
                />
              </Field>
              <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary/70" />
                Labeled lines like "Course Code:" or "Credit Units:" are
                detected automatically and won't show up as slide content.
              </p>
            </div>
          )}

          <motion.button
            onClick={handleGenerate}
            disabled={phase === "outline" || !apiKey.trim() || !!cooldown}
            whileTap={{ scale: 0.97 }}
            whileHover={{ scale: phase === "outline" ? 1 : 1.01 }}
            className="relative mt-5 w-full overflow-hidden inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-60 disabled:shadow-none transition-shadow"
          >
            {phase === "outline" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <GeneratingLabel />
              </>
            ) : cooldown ? (
              <>Wait {formatCooldown(cooldown.secondsLeft)}</>
            ) : (
              <>
                <motion.span
                  animate={{ rotate: [0, 12, 0, -12, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  className="flex"
                >
                  <Sparkles className="h-4 w-4" />
                </motion.span>
                Generate slide deck
              </>
            )}
          </motion.button>

          {cooldown && (
            <div className="mt-2 space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between text-xs text-amber-900">
                <span>Free-tier rate limit (10 req/min, 250/day)</span>
                <span className="font-mono font-semibold">
                  {formatCooldown(cooldown.secondsLeft)}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-amber-200">
                <motion.div
                  className="h-full rounded-full bg-amber-500"
                  animate={{ width: `${(cooldown.secondsLeft / cooldown.total) * 100}%` }}
                  transition={{ duration: 1, ease: "linear" }}
                />
              </div>
              <p className="text-[11px] text-amber-700">
                The button unlocks itself automatically — no need to keep checking.
              </p>
            </div>
          )}

          {deck && (
            <motion.button
              onClick={handleDownload}
              disabled={downloading}
              whileTap={{ scale: 0.97 }}
              whileHover={{ scale: downloading ? 1 : 1.01 }}
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
            </motion.button>
          )}
        </motion.section>

        {/* Preview */}
        <section>
          <AnimatePresence mode="wait">
            {!deck && phase === "idle" && (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <EmptyState />
              </motion.div>
            )}
            {phase === "outline" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <SkeletonState label="Structuring your deck…" />
              </motion.div>
            )}
            {deck && (
              <motion.div
                key="deck"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{deck.topic}</h2>
                    <p className="text-sm text-muted-foreground">
                      {deck.slides.length} slides • {deck.courseCode}{" "}
                      {deck.courseName} • drag <GripVertical className="inline h-3 w-3 -mt-0.5" /> to reorder
                    </p>
                  </div>
                  <motion.button
                    type="button"
                    onClick={toggleShare}
                    whileTap={{ scale: 0.94 }}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
                  >
                    <Share2 className="h-3.5 w-3.5" /> Share deck
                  </motion.button>
                </div>
                <div
                  className={`grid gap-5 ${settings.density === "compact" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
                >
                  {Array.isArray(deck.slides) &&
                    deck.slides.map((s, i) => (
                      <motion.div
                        key={i}
                        layout
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: Math.min(i * 0.05, 0.5) }}
                        style={{ opacity: dragIndex === i ? 0.4 : 1 }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragIndex !== null) reorderSlides(dragIndex, i);
                          setDragIndex(null);
                        }}
                      >
                        <SlideCard
                          index={i}
                          spec={s}
                          deck={deck}
                          onDragStart={() => setDragIndex(i)}
                          onDragEnd={() => setDragIndex(null)}
                        />
                      </motion.div>
                    ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
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
  icon,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon && <span className="text-primary/70">{icon}</span>}
        {label}
        {required && <span className="text-accent">*</span>}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[10px] text-muted-foreground">
          {hint}
        </span>
      )}
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
      className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40 hover:border-primary/30"
    />
  );
}

function Stepper({
  value,
  onChange,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="flex items-center rounded-lg border bg-background overflow-hidden">
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition"
      >
        −
      </motion.button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-full min-w-0 flex-1 border-x bg-transparent px-1 py-2 text-center text-sm font-semibold tabular-nums focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="px-3 py-2 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 transition"
      >
        +
      </motion.button>
    </div>
  );
}

const GENERATING_STAGES = [
  "Reading your brief…",
  "Structuring the outline…",
  "Writing slide content…",
  "Applying MIU branding…",
];

function GeneratingLabel() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % GENERATING_STAGES.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={i}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2 }}
      >
        {GENERATING_STAGES[i]}
      </motion.span>
    </AnimatePresence>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed p-10 text-center text-muted-foreground">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <FileText className="mx-auto h-10 w-10 text-primary/60" />
      </motion.div>
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

function ShareTile({
  label,
  icon,
  color,
  href,
}: {
  label: string;
  icon: ReactNode;
  color: string;
  href: string;
}) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      whileTap={{ scale: 0.94 }}
      whileHover={{ y: -2 }}
      className="flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center hover:border-primary transition"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: color }}
      >
        {icon}
      </span>
      <span className="text-[11px] font-medium">{label}</span>
    </motion.a>
  );
}

function SettingOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={`flex flex-col items-center justify-center gap-1 rounded-lg border py-2.5 text-xs font-medium transition ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "text-muted-foreground hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </motion.button>
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

function slideToPlainText(spec: SlideDeck["slides"][number]): string {
  const lines = [spec.title];
  if (spec.subtitle) lines.push(spec.subtitle);
  if (spec.body) lines.push(spec.body);
  if (spec.sections?.length) {
    for (const s of spec.sections) lines.push(`${s.heading}: ${s.description}`);
  }
  if (spec.bullets?.length) {
    for (const b of spec.bullets) lines.push(`• ${b}`);
  }
  return lines.join("\n");
}

function SlideCard({
  index,
  spec,
  deck,
  onDragStart,
  onDragEnd,
}: {
  index: number;
  spec: SlideDeck["slides"][number];
  deck: SlideDeck;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const isTitle = spec.type === "title";
  const [copied, setCopied] = useState(false);

  async function handleCopySlide() {
    try {
      await navigator.clipboard.writeText(slideToPlainText(spec));
      setCopied(true);
      toast.success("Slide text copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy slide");
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group rounded-xl overflow-hidden border bg-card slide-shadow"
    >
      <div
        className={`aspect-video relative overflow-hidden ${isTitle ? "text-white" : ""}`}
        style={{ background: isTitle ? "#0F7A3A" : "#ffffff" }}
      >
        <div
          className="absolute left-1.5 top-1.5 z-10 cursor-grab active:cursor-grabbing rounded-md bg-black/20 p-1 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden="true"
        >
          <GripVertical className={`h-3.5 w-3.5 ${isTitle ? "text-white/90" : "text-slate-500"}`} />
        </div>
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopySlide}
            aria-label={`Copy text from slide ${index + 1}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition"
          >
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          </button>
          <span className="font-mono text-[10px] uppercase text-primary">
            {spec.type}
          </span>
        </div>
      </div>
    </div>
  );
}
