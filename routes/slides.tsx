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
  RefreshCw,
  Pencil,
  FileDown,
  FileImage,
  AlertTriangle,
  ChevronDown,
  LogOut,
  Palette,
  ListChecks,
  CheckSquare,
  Square,
  MessageSquarePlus,
  Undo2,
  Plus,
  Trash,
  Printer,
  Smartphone,
  MoreVertical,
  User as UserIcon,
} from "lucide-react";
import { generateDeck, generateOutline, regenerateSlide, type SlideDeck, type SlideSpec } from "@/lib/slides.functions";
import { exportDeckToPptx } from "@/lib/pptx-export";
import { exportDeckToPdf } from "@/lib/pdf-export";
import { toPng } from "html-to-image";
import { DECK_THEMES, type ThemeId } from "@/lib/themes";
import {
  googleSignIn,
  getCurrentUser,
  signOut,
  checkIsAdmin,
  signUpWithPassword,
  signInWithPassword,
  requestPasswordReset,
  changePassword,
  type SessionUser,
} from "@/lib/auth.functions";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { t, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { AuthGate } from "@/components/AuthGate";
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

export const Route = createFileRoute("/slides")({
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
  deckTheme: ThemeId;
  locale: Locale;
};

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  fontScale: "md",
  density: "comfortable",
  deckTheme: "miu-classic",
  locale: "en",
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

// Traps Tab focus inside an open drawer/dialog and returns it to the trigger on close.
function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);

    const toFocus = getFocusable()[0];
    toFocus?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [active, ref]);
}

function StudioPage() {
  return (
    <ErrorBoundary>
      <AuthGate serviceName="Slide Studio">
        <StudioPageInner />
      </AuthGate>
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
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "outline-loading" | "outline-review" | "generating" | "done" | "error"
  >("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [outlineReview, setOutlineReview] = useState<{
    detectedTopic: string;
    outline: { title: string; type: string }[];
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);

  // Auth — Google Sign-In via Google Identity Services (client-side token),
  // verified server-side in auth.functions.ts. `authChecked` avoids a
  // flash of "signed out" UI while the initial session lookup is in flight.
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMenuOpen, setAuthMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const authMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCurrentUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    checkIsAdmin()
      .then(setIsAdmin)
      .catch(() => setIsAdmin(false));
  }, [user]);

  // Close the account menu on outside click or Escape — it's a real
  // dropdown menu, so it should behave like one.
  useEffect(() => {
    if (!authMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (authMenuRef.current && !authMenuRef.current.contains(e.target as Node)) {
        setAuthMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAuthMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [authMenuOpen]);

  // Surfaces a small dismissible banner when optional server-side
  // integrations (DB / Redis / auth) aren't configured, so it's obvious
  // *why* History is empty or Sign-In is missing instead of it just being
  // silently absent. Dismissal is per-tab only (sessionStorage) — it
  // reappears next visit as a nudge until someone actually configures it.
  const [configStatus, setConfigStatus] = useState<{
    database: boolean;
    redis: boolean;
    session: boolean;
    googleAuth: boolean;
    passwordAuth: boolean;
    email: boolean;
    adminDashboard: boolean;
    sharedApiKey: boolean;
  } | null>(null);
  const [configBannerDismissed, setConfigBannerDismissed] = useState(false);

  // True if the person has pasted their own key, OR the admin has
  // configured a shared GEMINI_API_KEY server-side — either way, a
  // generate/regenerate call has a key to actually use.
  const hasApiAccess = !!apiKey.trim() || !!configStatus?.sharedApiKey;

  useEffect(() => {
    getPublicConfigStatus()
      .then(setConfigStatus)
      .catch(() => setConfigStatus(null));
    try {
      setConfigBannerDismissed(sessionStorage.getItem("miu-config-banner-dismissed") === "1");
    } catch {
      // ignore — private browsing etc.
    }
  }, []);

  function dismissConfigBanner() {
    setConfigBannerDismissed(true);
    try {
      sessionStorage.setItem("miu-config-banner-dismissed", "1");
    } catch {
      // ignore
    }
  }

  // "Install app" (Add to Home Screen). Android/Chrome fires
  // `beforeinstallprompt` and lets us trigger the native install dialog
  // programmatically. iOS Safari never fires that event — there's no
  // programmatic install there, only the manual Share -> Add to Home
  // Screen flow — so we detect iOS separately and show instructions
  // instead of a button that would silently do nothing.
  const [installPromptEvent, setInstallPromptEvent] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsStandalone(
      window.matchMedia?.("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true,
    );
    setIsIOS(/iphone|ipad|ipod/i.test(window.navigator.userAgent) && !(window as any).MSStream);

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setInstallPromptEvent(e);
    }
    function onInstalled() {
      setInstallPromptEvent(null);
      setIsStandalone(true);
      toast.success("MIU Slide Studio installed");
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function handleInstallApp() {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === "accepted") setInstallPromptEvent(null);
  }

  // Bulk selection over the generated slide grid.
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedSlides, setSelectedSlides] = useState<Set<number>>(new Set());

  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  // Email/password sign-in panel — a standard login form (sign in / sign
  // up / forgot password) alongside the Google button, rather than only
  // offering Google Sign-In.
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [authForm, setAuthForm] = useState({ email: "", password: "", confirmPassword: "", name: "" });
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const authPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(authPanelOpen, authPanelRef);

  function openAuthPanel(mode: "signin" | "signup" | "forgot" = "signin") {
    setAuthMode(mode);
    setAuthError(null);
    setForgotSent(false);
    setAuthForm({ email: "", password: "", confirmPassword: "", name: "" });
    setSettingsOpen(false);
    setShareOpen(false);
    setHistoryOpen(false);
    setAuthPanelOpen(true);
  }

  function updateAuthForm<K extends keyof typeof authForm>(key: K, value: (typeof authForm)[K]) {
    setAuthForm((f) => ({ ...f, [key]: value }));
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);

    if (authMode === "signup" && authForm.password !== authForm.confirmPassword) {
      setAuthError("Passwords don't match.");
      return;
    }

    setAuthSubmitting(true);
    try {
      if (authMode === "signin") {
        const signedIn = await signInWithPassword({
          data: { email: authForm.email, password: authForm.password },
        });
        setUser(signedIn);
        setAuthPanelOpen(false);
        toast.success(`Signed in as ${signedIn.email}`);
        refreshHistory();
      } else if (authMode === "signup") {
        const signedUp = await signUpWithPassword({
          data: { email: authForm.email, password: authForm.password, name: authForm.name },
        });
        setUser(signedUp);
        setAuthPanelOpen(false);
        toast.success(`Welcome, ${signedUp.name || signedUp.email}`);
        refreshHistory();
      } else {
        await requestPasswordReset({ data: { email: authForm.email } });
        setForgotSent(true);
      }
    } catch (e) {
      console.error(e);
      setAuthError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  // Change password (for a signed-in user; also doubles as "add a
  // password" for a Google-only account, since changePassword doesn't
  // require a currentPassword when the account has none yet).
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePasswordForm, setChangePasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [changePasswordSubmitting, setChangePasswordSubmitting] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);

  async function handleChangePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChangePasswordError(null);
    if (changePasswordForm.newPassword !== changePasswordForm.confirmPassword) {
      setChangePasswordError("Passwords don't match.");
      return;
    }
    setChangePasswordSubmitting(true);
    try {
      await changePassword({
        data: {
          currentPassword: changePasswordForm.currentPassword,
          newPassword: changePasswordForm.newPassword,
        },
      });
      toast.success("Password updated");
      setChangePasswordOpen(false);
      setChangePasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (e) {
      console.error(e);
      setChangePasswordError(e instanceof Error ? e.message : "Couldn't update your password.");
    } finally {
      setChangePasswordSubmitting(false);
    }
  }

  async function handleGoogleCredential(response: { credential: string }) {
    try {
      const signedIn = await googleSignIn({ data: { credential: response.credential } });
      setUser(signedIn);
      toast.success(`Signed in as ${signedIn.email}`);
      refreshHistory();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
    }
  }

  // Load the Google Identity Services script once, then render the
  // official "Sign in with Google" button into our ref whenever the sign-in
  // panel is open and we're signed out (its origin — not a specific
  // redirect URI — is what's registered in Google Cloud Console, so this
  // works across environments without per-deployment reconfiguration).
  useEffect(() => {
    if (!googleClientId || user || !authChecked || !authPanelOpen) return;
    const w = window as any;

    function render() {
      if (!w.google?.accounts?.id || !googleButtonRef.current) return;
      w.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });
      w.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 280,
      });
    }

    if (w.google?.accounts?.id) {
      render();
      return;
    }
    const existing = document.getElementById("google-identity-script");
    if (existing) {
      existing.addEventListener("load", render);
      return () => existing.removeEventListener("load", render);
    }
    const script = document.createElement("script");
    script.id = "google-identity-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = render;
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleClientId, user, authChecked, authPanelOpen]);

  async function handleSignOut() {
    try {
      await signOut();
    } catch (e) {
      console.error(e);
    }
    toast.success("Signed out");
    // Slide Studio is gated by <AuthGate>, which only checks auth state on
    // mount — clearing local state here wouldn't re-lock the page, since
    // AuthGate itself wouldn't know. A full reload forces it to re-check.
    window.location.href = "/";
  }

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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  function updateSlide(index: number, next: SlideSpec) {
    setDeck((d) => {
      if (!d) return d;
      const slides = [...d.slides];
      slides[index] = next;
      return { ...d, slides };
    });
  }

  const [bulkBusy, setBulkBusy] = useState(false);

  function handleBulkDelete() {
    if (!deck) return;
    const count = selectedSlides.size;
    setDeck((d) => {
      if (!d) return d;
      const slides = d.slides.filter((_, i) => !selectedSlides.has(i));
      return { ...d, slides };
    });
    setSelectedSlides(new Set());
    setBulkMode(false);
    toast.success(`Deleted ${count} slide${count === 1 ? "" : "s"}`);
  }

  async function handleBulkRegenerate() {
    if (!deck || !hasApiAccess) {
      toast.error("Add your Gemini API key first");
      return;
    }
    setBulkBusy(true);
    const indices = Array.from(selectedSlides).sort((a, b) => a - b);
    let failures = 0;
    // Sequential, not parallel — respects the same free-tier rate limit as
    // everything else instead of firing a burst of simultaneous calls.
    for (const i of indices) {
      const spec = deck.slides[i];
      if (!spec) continue;
      try {
        const next = await regenerateSlide({
          data: {
            apiKey,
            topic: deck.topic,
            courseName: deck.courseName,
            courseCode: deck.courseCode,
            slideType: spec.type,
            currentTitle: spec.title,
            slidePosition: i + 1,
            totalSlides: deck.slides.length,
          },
        });
        updateSlide(i, next as SlideSpec);
      } catch (e) {
        console.error(e);
        failures++;
      }
    }
    setBulkBusy(false);
    setSelectedSlides(new Set());
    setBulkMode(false);
    if (failures === 0) toast.success(`Regenerated ${indices.length} slides`);
    else toast.error(`Regenerated ${indices.length - failures} of ${indices.length} slides — some failed`);
  }

  // Personalization: theme, font size, and layout density, persisted locally.
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const historyPanelRef = useRef<HTMLDivElement>(null);
  const sharePanelRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(historyOpen, historyPanelRef);
  useFocusTrap(shareOpen, sharePanelRef);
  useFocusTrap(settingsOpen, settingsPanelRef);

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
        if (phase !== "generating" && hasApiAccess && !cooldown) {
          handleGenerate();
        }
      } else if (e.key === "Escape") {
        setHistoryOpen(false);
        setSettingsOpen(false);
        setShareOpen(false);
        setAuthPanelOpen(false);
        setChangePasswordOpen(false);
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
    setAuthPanelOpen(false);
    setChangePasswordOpen(false);
  }

  function toggleShare() {
    setShareOpen((v) => !v);
    setSettingsOpen(false);
    setHistoryOpen(false);
    setAuthPanelOpen(false);
    setChangePasswordOpen(false);
  }

  function handlePrint() {
    if (!deck) return;
    // Close any open drawers first — they're position:fixed overlays that
    // would otherwise print on top of (or instead of) the slides.
    setHistoryOpen(false);
    setSettingsOpen(false);
    setShareOpen(false);
    // Let the drawer-close re-render land before the browser snapshots the
    // page for printing.
    requestAnimationFrame(() => window.print());
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
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    };
  }, []);

  const HISTORY_PAGE_SIZE = 25;
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  async function refreshHistory() {
    setHistoryLoading(true);
    try {
      const result = await listDecks({ data: { offset: 0, limit: HISTORY_PAGE_SIZE } });
      setHistory(result.decks);
      setHistoryHasMore(result.hasMore);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load deck history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadMoreHistory() {
    if (historyLoadingMore || !historyHasMore) return;
    setHistoryLoadingMore(true);
    try {
      const result = await listDecks({ data: { offset: history.length, limit: HISTORY_PAGE_SIZE } });
      setHistory((h) => [...h, ...result.decks]);
      setHistoryHasMore(result.hasMore);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't load more decks");
    } finally {
      setHistoryLoadingMore(false);
    }
  }

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    setSettingsOpen(false);
    setShareOpen(false);
    setAuthPanelOpen(false);
    setChangePasswordOpen(false);
    if (next) refreshHistory();
  }

  async function handleLoadDeck(id: string) {
    setLoadingDeckId(id);
    try {
      const d = await getDeck({ data: { id } });
      setDeck(d);
      setSavedDeckId(id);
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

  function handleDeleteClick(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
      confirmDeleteTimer.current = setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    if (confirmDeleteTimer.current) clearTimeout(confirmDeleteTimer.current);
    setConfirmDeleteId(null);
    handleDeleteDeck(id, e);
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

  function fillExample() {
    setMode("brief");
    setForm((f) => ({
      ...f,
      topic: "Topic Seven: Reports — types, structure, and language",
      courseCode: "BEE 1101",
      courseName: "Communication Skills",
      courseLevel: "Undergraduate-Degree (Year One, Semester One)",
      creditUnits: "3 Credit Units | Total Contact Hours: 45",
      contactTime: "Allocated Contact Time: 3 Hours",
      slideCount: 10,
      extraNotes: "Keep the tone practical, with real workplace examples.",
    }));
    toast.success("Example brief loaded — tweak it or hit Generate");
  }

  function buildGeneratePayload(outline?: { title: string; type: string }[]) {
    // In "paste" mode, Gemini extracts topic/course identification
    // details directly from the pasted text. Any leftover values from the
    // "brief" tab (or earlier edits) must NOT be sent here, or they'd
    // silently override what was correctly detected — only the explicit,
    // visible "Course code (optional override)" field is allowed through.
    return mode === "paste"
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
          outline,
        }
      : { ...form, mode, apiKey, outline };
  }

  // Ref-based guard (not just the `phase` state check below) against a fast
  // double-click firing two requests before React re-renders the disabled
  // button — state updates are async, a ref read/write is synchronous.
  const submittingRef = useRef(false);

  async function handleReviewOutline() {
    if (submittingRef.current || phase === "outline-loading" || phase === "generating") return;
    if (!hasApiAccess)
      return toast.error(
        "Add your free Gemini API key first (get one at aistudio.google.com/apikey)",
      );
    if (mode === "brief" && !form.topic.trim())
      return toast.error("Please enter a topic");
    if (mode === "paste" && form.pastedContent.trim().length < 20)
      return toast.error("Paste some course material first");

    submittingRef.current = true;
    setDeck(null);
    setSavedDeckId(null);
    setLastError(null);
    setOutlineReview(null);
    setPhase("outline-loading");
    try {
      const result = await generateOutline({ data: buildGeneratePayload() });
      setOutlineReview(result);
      setPhase("outline-review");
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Couldn't build an outline";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      if (rateLimitMatch) {
        const seconds = parseInt(rateLimitMatch[1], 10);
        setCooldown({ secondsLeft: seconds, total: seconds });
        toast.error(`Rate limited — wait ${formatCooldown(seconds)}`);
        setPhase("idle");
      } else {
        toast.error(message);
        setLastError(message);
        setPhase("error");
      }
    } finally {
      submittingRef.current = false;
    }
  }

  async function handleGenerate(pinnedOutline?: { title: string; type: string }[]) {
    if (submittingRef.current || phase === "generating") return; // already generating
    if (!hasApiAccess)
      return toast.error(
        "Add your free Gemini API key first (get one at aistudio.google.com/apikey)",
      );
    if (mode === "brief" && !form.topic.trim())
      return toast.error("Please enter a topic");
    if (mode === "paste" && form.pastedContent.trim().length < 20)
      return toast.error("Paste some course material first");
    submittingRef.current = true;
    setDeck(null);
    setSavedDeckId(null);
    setLastError(null);
    setPhase("generating");
    try {
      const payload = buildGeneratePayload(pinnedOutline);

      const d = await generateDeck({ data: payload });
      setDeck(d);
      setPhase("done");
      setOutlineReview(null);
      setDecksThisSession((n) => n + 1);
      toast.success(`Deck ready — ${d.slides.length} slides`);

      // Persist to Postgres so it shows up in History. Best-effort: a save
      // failure (e.g. DATABASE_URL not configured yet) shouldn't block the
      // user from seeing/downloading the deck they just generated.
      try {
        const saved = await saveDeck({
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
        setSavedDeckId(saved.id);
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
        setPhase("idle");
      } else {
        toast.error(message);
        setLastError(message);
        setPhase("error");
      }
    } finally {
      submittingRef.current = false;
    }
  }

  function updateOutlineTitle(i: number, title: string) {
    setOutlineReview((r) => {
      if (!r) return r;
      const outline = [...r.outline];
      outline[i] = { ...outline[i], title };
      return { ...r, outline };
    });
  }

  function removeOutlineSlide(i: number) {
    setOutlineReview((r) => {
      if (!r || r.outline.length <= 2) return r;
      return { ...r, outline: r.outline.filter((_, idx) => idx !== i) };
    });
  }

  function addOutlineSlide(afterIndex: number) {
    setOutlineReview((r) => {
      if (!r) return r;
      const outline = [...r.outline];
      outline.splice(afterIndex + 1, 0, { title: "New slide", type: "content" });
      return { ...r, outline };
    });
  }

  function moveOutlineSlide(from: number, to: number) {
    setOutlineReview((r) => {
      if (!r || to < 0 || to >= r.outline.length) return r;
      const outline = [...r.outline];
      const [moved] = outline.splice(from, 1);
      outline.splice(to, 0, moved);
      return { ...r, outline };
    });
  }

  async function handleDownload() {
    if (!deck || downloading) return;
    setDownloading(true);
    try {
      await exportDeckToPptx(deck, { density: settings.density, theme: settings.deckTheme });
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

  async function handleDownloadPdf() {
    if (!deck || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await exportDeckToPdf(deck, { theme: settings.deckTheme });
      toast.success("Downloaded PDF file");
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error && e.message ? e.message : "PDF export failed");
    } finally {
      setDownloadingPdf(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" closeButton />

      {/* Announces generation status changes to screen readers */}
      <div className="sr-only" role="status" aria-live="polite">
        {phase === "generating"
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
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-5 flex items-center gap-2 sm:gap-4">
          <a href="/" aria-label="Back to Home" className="shrink-0">
            <motion.img
              src={logo}
              alt="MIU logo"
              className="h-11 w-11 sm:h-14 sm:w-14 rounded-xl bg-white p-1 shadow-lg shrink-0"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            />
          </a>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
              {t("appTitle", settings.locale)}
            </h1>
            <p className="text-sm opacity-90 truncate">
              {t("appSubtitle", settings.locale)}
            </p>
          </div>
          <a
            href="/notes"
            className="hidden md:flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <BookOpen className="h-3.5 w-3.5" /> Lecture Notes
          </a>
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            {decksThisSession > 0
              ? `${decksThisSession} deck${decksThisSession === 1 ? "" : "s"} this session`
              : "Powered by Gemini • Free tier"}
          </div>

          {/* Desktop/tablet: individual pill buttons */}
          <motion.button
            type="button"
            onClick={toggleShare}
            aria-label={t("share", settings.locale)}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            className="hidden sm:flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>{t("share", settings.locale)}</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={toggleSettings}
            aria-label={t("settings", settings.locale)}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            className="hidden sm:flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{t("settings", settings.locale)}</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={toggleHistory}
            aria-label={t("history", settings.locale)}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            className="hidden sm:flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
          >
            <History className="h-3.5 w-3.5" />
            <span>{t("history", settings.locale)}</span>
          </motion.button>

          {/* Phone-width: everything grouped behind one "More" button so
              the header never overflows or wraps awkwardly. */}
          <div className="relative sm:hidden shrink-0">
            <motion.button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="More options"
              whileTap={{ scale: 0.92 }}
              className="flex items-center justify-center rounded-full bg-white/15 p-2 hover:bg-white/25 transition"
            >
              <MoreVertical className="h-4 w-4" />
            </motion.button>
            <AnimatePresence>
              {mobileMenuOpen && (
                <>
                  <motion.div
                    className="fixed inset-0 z-40"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setMobileMenuOpen(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-48 rounded-lg border bg-card text-foreground shadow-lg overflow-hidden z-50"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        toggleShare();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition"
                    >
                      <Share2 className="h-4 w-4" /> {t("share", settings.locale)}
                    </button>
                    <a
                      href="/notes"
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition"
                    >
                      <BookOpen className="h-4 w-4" /> Lecture Notes
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        toggleSettings();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition"
                    >
                      <Settings2 className="h-4 w-4" /> {t("settings", settings.locale)}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMobileMenuOpen(false);
                        toggleHistory();
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition"
                    >
                      <History className="h-4 w-4" /> {t("history", settings.locale)}
                    </button>
                    {deck && (
                      <button
                        type="button"
                        onClick={() => {
                          setMobileMenuOpen(false);
                          handlePrint();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted transition"
                      >
                        <Printer className="h-4 w-4" /> Print
                      </button>
                    )}
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* Auth: "Sign in" opens a standard email/password + Google
              panel; avatar menu when signed in. Hidden entirely if neither
              Google nor password auth is configured, so the app still
              works without any auth set up. */}
          {authChecked && (googleClientId || configStatus?.passwordAuth) && (
            <div className="relative shrink-0" ref={authMenuRef}>
              {user ? (
                <>
                  <motion.button
                    type="button"
                    onClick={() => setAuthMenuOpen((v) => !v)}
                    whileTap={{ scale: 0.92 }}
                    aria-label="Account menu"
                    aria-haspopup="menu"
                    aria-expanded={authMenuOpen}
                    className="flex items-center gap-1.5 rounded-full bg-white/15 pl-1 pr-2.5 py-1 hover:bg-white/25 transition"
                  >
                    {user.picture ? (
                      <img src={user.picture} alt="" className="h-6 w-6 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/30 text-[10px] font-bold">
                        {user.email[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="hidden sm:inline text-xs font-medium max-w-[9rem] truncate">
                      {user.name || user.email}
                    </span>
                  </motion.button>
                  <AnimatePresence>
                    {authMenuOpen && (
                      <motion.div
                        role="menu"
                        aria-label="Account"
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 top-full mt-2 w-52 rounded-lg border bg-card text-foreground shadow-lg overflow-hidden z-10"
                      >
                        <div className="px-3 py-2 border-b">
                          <p className="text-xs font-medium truncate">{user.name}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {isAdmin && (
                          <a
                            href="/admin"
                            role="menuitem"
                            className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition"
                          >
                            <ListChecks className="h-3.5 w-3.5" /> Usage dashboard
                          </a>
                        )}
                        {configStatus?.passwordAuth && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setAuthMenuOpen(false);
                              setChangePasswordOpen(true);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted transition"
                          >
                            <KeyRound className="h-3.5 w-3.5" /> Change password
                          </button>
                        )}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleSignOut}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted transition"
                        >
                          <LogOut className="h-3.5 w-3.5" /> {t("signOut", settings.locale)}
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <motion.button
                  type="button"
                  onClick={() => openAuthPanel("signin")}
                  whileTap={{ scale: 0.94 }}
                  whileHover={{ scale: 1.04 }}
                  className="flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25 transition"
                >
                  <UserIcon className="h-3.5 w-3.5" />
                  {t("signIn", settings.locale)}
                </motion.button>
              )}
            </div>
          )}
        </div>
      </motion.header>

      <AnimatePresence>
        {configStatus &&
          !configBannerDismissed &&
          (!configStatus.database || !configStatus.redis || !configStatus.session) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="border-b bg-amber-50 text-amber-900"
            >
              <div className="mx-auto max-w-7xl px-3 sm:px-6 py-2 flex items-start gap-2 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium">Some optional features aren't configured yet: </span>
                  {[
                    !configStatus.database && "deck History (needs DATABASE_URL)",
                    !configStatus.session && "sign-in / accounts (needs SESSION_SECRET)",
                    configStatus.session &&
                      configStatus.passwordAuth &&
                      !configStatus.email &&
                      "password-reset emails (needs a Resend API key — reset links are logged server-side for now)",
                    !configStatus.redis && "distributed rate limiting (needs Upstash Redis)",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  . Generating and downloading decks still works fine. See DEPLOYMENT.md.
                </div>
                <button
                  type="button"
                  onClick={dismissConfigBanner}
                  aria-label="Dismiss"
                  className="shrink-0 rounded p-0.5 hover:bg-amber-100 transition"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          )}
      </AnimatePresence>

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
              ref={historyPanelRef}
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
                  <div className="space-y-2" aria-hidden="true">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="animate-pulse rounded-lg border p-3">
                        <div className="h-3.5 w-3/5 rounded bg-muted" />
                        <div className="mt-2 h-2.5 w-2/5 rounded bg-muted" />
                        <div className="mt-2 h-2.5 w-1/3 rounded bg-muted" />
                      </div>
                    ))}
                  </div>
                ) : history.length === 0 ? (
                  <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                    {!user && googleClientId
                      ? "Sign in with Google (top right) to save decks and sync your history across devices."
                      : "No saved decks yet — generate one and it'll show up here."}
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
                          onClick={(e) => handleDeleteClick(item.id, e)}
                          disabled={deletingDeckId === item.id}
                          aria-label={
                            confirmDeleteId === item.id
                              ? "Click again to confirm delete"
                              : "Delete this deck"
                          }
                          className={`flex items-center gap-1 rounded-md px-1.5 py-1.5 text-[10px] font-medium transition disabled:opacity-50 ${
                            confirmDeleteId === item.id
                              ? "bg-destructive text-destructive-foreground"
                              : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          }`}
                        >
                          {deletingDeckId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : confirmDeleteId === item.id ? (
                            <>
                              <Trash2 className="h-3.5 w-3.5" /> Confirm?
                            </>
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
                {!historyQuery.trim() && historyHasMore && !historyLoading && (
                  <button
                    type="button"
                    onClick={loadMoreHistory}
                    disabled={historyLoadingMore}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition disabled:opacity-50"
                  >
                    {historyLoadingMore ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Load more decks"
                    )}
                  </button>
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
              ref={sharePanelRef}
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
              ref={settingsPanelRef}
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
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Also nudges font sizes in your exported PowerPoint.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Deck color theme</p>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.values(DECK_THEMES).map((th) => (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => updateSettings({ deckTheme: th.id })}
                        className={`flex flex-col items-center gap-1.5 rounded-lg border py-2.5 text-[10px] font-medium transition ${
                          settings.deckTheme === th.id
                            ? "border-primary bg-primary/10 text-primary"
                            : "text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        }`}
                      >
                        <span className="flex gap-1">
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `#${th.primary}` }} />
                          <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `#${th.accent}` }} />
                        </span>
                        {th.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Applies to the slide preview and both PowerPoint/PDF exports.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Language</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(LOCALE_LABELS) as Locale[]).map((loc) => (
                      <SettingOption
                        key={loc}
                        active={settings.locale === loc}
                        onClick={() => updateSettings({ locale: loc })}
                        label={LOCALE_LABELS[loc]}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Translates key labels only — this is an early preview, not full coverage yet.
                  </p>
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Get the app</p>
                  {isStandalone ? (
                    <p className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">
                      <Check className="h-3.5 w-3.5" /> Installed on this device
                    </p>
                  ) : installPromptEvent ? (
                    <motion.button
                      type="button"
                      onClick={handleInstallApp}
                      whileTap={{ scale: 0.97 }}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
                    >
                      <Smartphone className="h-4 w-4" /> Install app on this device
                    </motion.button>
                  ) : isIOS ? (
                    <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground leading-relaxed">
                      <Smartphone className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      Tap the <Share2 className="inline h-3 w-3 -mt-0.5" /> Share button in Safari, then{" "}
                      <strong>"Add to Home Screen"</strong> — it'll open full-screen like an app.
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Open this site in Chrome on your phone to install it as an app.
                    </p>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Preferences are saved on this device and applied automatically next time you visit.
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Auth panel — standard email/password sign in / sign up / forgot password, plus Google */}
      <AnimatePresence>
        {authPanelOpen && (
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
              onClick={() => setAuthPanelOpen(false)}
            />
            <motion.div
              ref={authPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label={authMode === "signin" ? "Sign in" : authMode === "signup" ? "Create account" : "Reset password"}
              className="relative h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col"
              variants={{ open: { x: 0 }, closed: { x: "100%" } }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-semibold text-sm">
                  {authMode === "signin" ? "Sign in" : authMode === "signup" ? "Create account" : "Reset password"}
                </h3>
                <button
                  type="button"
                  onClick={() => setAuthPanelOpen(false)}
                  aria-label="Close"
                  className="rounded-md p-1 hover:bg-muted transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {authMode === "forgot" && forgotSent ? (
                  <div className="rounded-lg border bg-primary/5 p-4 text-center">
                    <Check className="mx-auto h-6 w-6 text-primary mb-2" />
                    <p className="text-sm font-medium">Check your email</p>
                    <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                      If an account exists for {authForm.email || "that address"}, we've sent a link to
                      reset your password. It expires in an hour.
                    </p>
                    <button
                      type="button"
                      onClick={() => openAuthPanel("signin")}
                      className="mt-4 text-xs font-medium text-primary hover:underline"
                    >
                      Back to sign in
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleAuthSubmit} className="space-y-3">
                    {authMode === "signup" && (
                      <Field label="Name" icon={<UserIcon className="h-3.5 w-3.5" />}>
                        <Input
                          value={authForm.name}
                          onChange={(v) => updateAuthForm("name", v)}
                          placeholder="Your name"
                        />
                      </Field>
                    )}
                    <Field label="Email" required icon={<Mail className="h-3.5 w-3.5" />}>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={authForm.email}
                        onChange={(e) => updateAuthForm("email", e.target.value)}
                        placeholder="you@example.com"
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                      />
                    </Field>

                    {authMode !== "forgot" && (
                      <Field
                        label="Password"
                        required
                        icon={<KeyRound className="h-3.5 w-3.5" />}
                        hint={authMode === "signup" ? "At least 8 characters." : undefined}
                      >
                        <input
                          type="password"
                          required
                          autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                          value={authForm.password}
                          onChange={(e) => updateAuthForm("password", e.target.value)}
                          placeholder="••••••••"
                          className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                        />
                      </Field>
                    )}

                    {authMode === "signup" && (
                      <Field label="Confirm password" required icon={<KeyRound className="h-3.5 w-3.5" />}>
                        <input
                          type="password"
                          required
                          autoComplete="new-password"
                          value={authForm.confirmPassword}
                          onChange={(e) => updateAuthForm("confirmPassword", e.target.value)}
                          placeholder="••••••••"
                          className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                        />
                      </Field>
                    )}

                    {authMode === "signin" && (
                      <div className="text-right -mt-1">
                        <button
                          type="button"
                          onClick={() => openAuthPanel("forgot")}
                          className="text-[11px] font-medium text-muted-foreground hover:text-primary transition"
                        >
                          Forgot password?
                        </button>
                      </div>
                    )}

                    {authError && (
                      <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive leading-relaxed">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        {authError}
                      </p>
                    )}

                    <motion.button
                      type="submit"
                      disabled={authSubmitting}
                      whileTap={{ scale: 0.97 }}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
                    >
                      {authSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : authMode === "signin" ? (
                        "Sign in"
                      ) : authMode === "signup" ? (
                        "Create account"
                      ) : (
                        "Send reset link"
                      )}
                    </motion.button>

                    <p className="text-center text-xs text-muted-foreground">
                      {authMode === "signin" ? (
                        <>
                          Don't have an account?{" "}
                          <button
                            type="button"
                            onClick={() => openAuthPanel("signup")}
                            className="font-medium text-primary hover:underline"
                          >
                            Sign up
                          </button>
                        </>
                      ) : authMode === "signup" ? (
                        <>
                          Already have an account?{" "}
                          <button
                            type="button"
                            onClick={() => openAuthPanel("signin")}
                            className="font-medium text-primary hover:underline"
                          >
                            Sign in
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openAuthPanel("signin")}
                          className="font-medium text-primary hover:underline"
                        >
                          Back to sign in
                        </button>
                      )}
                    </p>
                  </form>
                )}

                {googleClientId && authMode !== "forgot" && (
                  <>
                    <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                    </div>
                    <div className="flex justify-center">
                      <div ref={googleButtonRef} />
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Change password — for a signed-in user; also how a Google-only account adds a password */}
      <AnimatePresence>
        {changePasswordOpen && (
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
              onClick={() => setChangePasswordOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Change password"
              className="relative h-full w-full max-w-sm bg-background border-l shadow-xl flex flex-col"
              variants={{ open: { x: 0 }, closed: { x: "100%" } }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h3 className="font-semibold text-sm">Change password</h3>
                <button
                  type="button"
                  onClick={() => setChangePasswordOpen(false)}
                  aria-label="Close"
                  className="rounded-md p-1 hover:bg-muted transition"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <form onSubmit={handleChangePasswordSubmit} className="space-y-3">
                  <Field label="Current password" icon={<KeyRound className="h-3.5 w-3.5" />} hint="Leave blank if you signed up with Google and haven't set a password yet.">
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={changePasswordForm.currentPassword}
                      onChange={(e) =>
                        setChangePasswordForm((f) => ({ ...f, currentPassword: e.target.value }))
                      }
                      placeholder="••••••••"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                    />
                  </Field>
                  <Field label="New password" required icon={<KeyRound className="h-3.5 w-3.5" />} hint="At least 8 characters.">
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={changePasswordForm.newPassword}
                      onChange={(e) => setChangePasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                      placeholder="••••••••"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                    />
                  </Field>
                  <Field label="Confirm new password" required icon={<KeyRound className="h-3.5 w-3.5" />}>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={changePasswordForm.confirmPassword}
                      onChange={(e) =>
                        setChangePasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))
                      }
                      placeholder="••••••••"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                    />
                  </Field>
                  {changePasswordError && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive leading-relaxed">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {changePasswordError}
                    </p>
                  )}
                  <motion.button
                    type="submit"
                    disabled={changePasswordSubmitting}
                    whileTap={{ scale: 0.97 }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
                  >
                    {changePasswordSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update password"}
                  </motion.button>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-5 sm:py-8 grid gap-6 sm:gap-8 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="rounded-2xl bg-card border p-4 sm:p-6 slide-shadow h-fit lg:sticky lg:top-6"
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
            <Field
              label="Gemini API key"
              required={!configStatus?.sharedApiKey}
              icon={<KeyRound className="h-3.5 w-3.5" />}
            >
              <input
                type="password"
                value={apiKey}
                onChange={(e) => updateApiKey(e.target.value)}
                placeholder={
                  configStatus?.sharedApiKey
                    ? "Optional — using MIU's shared key by default"
                    : "Paste your free Gemini API key"
                }
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
                autoComplete="off"
              />
            </Field>
            {configStatus?.sharedApiKey ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-primary">
                <Sparkles className="h-3 w-3 shrink-0" />
                {apiKey.trim()
                  ? "Using your own key — your personal quota, not the shared one."
                  : "Using MIU's shared key. Paste your own above to use your personal quota instead."}
              </p>
            ) : (
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
            )}
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
              {!form.topic.trim() && !deck && (
                <button
                  type="button"
                  onClick={fillExample}
                  className="w-full flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground hover:border-primary/50 hover:text-primary transition"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> New here? Try a filled-in example
                  </span>
                  <span className="font-medium">Load it →</span>
                </button>
              )}
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
              <SlideCountPreview count={form.slideCount} />
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
              <SlideCountPreview count={form.slideCount} />
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

          <div className="mt-5 flex gap-2">
            <motion.button
              type="button"
              onClick={handleReviewOutline}
              disabled={phase === "generating" || phase === "outline-loading" || !hasApiAccess || !!cooldown}
              whileTap={{ scale: 0.97 }}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 sm:px-3 py-2.5 text-xs font-semibold text-foreground hover:border-primary hover:text-primary disabled:opacity-50 transition whitespace-nowrap"
            >
              {phase === "outline-loading" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ListChecks className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Review outline first</span>
              <span className="sm:hidden">Outline</span>
            </motion.button>
            <motion.button
              onClick={() => handleGenerate()}
              disabled={phase === "generating" || phase === "outline-loading" || !hasApiAccess || !!cooldown}
              whileTap={{ scale: 0.97 }}
              whileHover={{ scale: phase === "generating" ? 1 : 1.01 }}
              className="relative flex-1 min-w-0 overflow-hidden inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-3 sm:px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-60 disabled:shadow-none transition-shadow whitespace-nowrap"
            >
              {phase === "generating" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span className="truncate"><GeneratingLabel /></span>
                </>
              ) : cooldown ? (
                <>Wait {formatCooldown(cooldown.secondsLeft)}</>
              ) : (
                <>
                  <motion.span
                    animate={{ rotate: [0, 12, 0, -12, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    className="flex shrink-0"
                  >
                    <Sparkles className="h-4 w-4" />
                  </motion.span>
                  <span className="hidden sm:inline">Generate slide deck</span>
                  <span className="sm:hidden">Generate</span>
                </>
              )}
            </motion.button>
          </div>

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
            <div className="relative mt-2 flex">
              <motion.button
                onClick={handleDownload}
                disabled={downloading}
                whileTap={{ scale: 0.97 }}
                whileHover={{ scale: downloading ? 1 : 1.01 }}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-l-lg border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60 transition"
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
              <motion.button
                type="button"
                onClick={() => setDownloadMenuOpen((v) => !v)}
                whileTap={{ scale: 0.94 }}
                aria-label="More download formats"
                className="inline-flex items-center justify-center rounded-r-lg border border-l-0 border-accent bg-accent px-2.5 text-accent-foreground hover:opacity-90 transition"
              >
                <ChevronDown className="h-4 w-4" />
              </motion.button>
              <AnimatePresence>
                {downloadMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                    className="absolute bottom-full mb-2 right-0 z-10 w-44 rounded-lg border bg-card shadow-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDownloadMenuOpen(false);
                        handleDownloadPdf();
                      }}
                      disabled={downloadingPdf}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted transition disabled:opacity-50"
                    >
                      {downloadingPdf ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileDown className="h-3.5 w-3.5" />
                      )}
                      Download as .pdf
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
            {phase === "generating" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <SkeletonState label="Structuring your deck…" />
              </motion.div>
            )}
            {phase === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <ErrorState message={lastError} onRetry={handleGenerate} />
              </motion.div>
            )}
            {phase === "outline-loading" && (
              <motion.div
                key="outline-loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <SkeletonState label="Sketching an outline…" />
              </motion.div>
            )}
            {phase === "outline-review" && outlineReview && (
              <motion.div
                key="outline-review"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl border bg-card p-5 slide-shadow"
              >
                <div className="flex items-center justify-between gap-3 mb-1">
                  <h2 className="text-lg font-semibold truncate">{outlineReview.detectedTopic}</h2>
                  <span className="shrink-0 text-xs text-muted-foreground">{outlineReview.outline.length} slides</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">
                  Edit titles, reorder, add, or remove slides — then build the full deck from this plan.
                </p>
                <div className="space-y-1.5 max-h-[28rem] overflow-y-auto pr-1">
                  {outlineReview.outline.map((o, i) => (
                    <motion.div
                      key={i}
                      layout
                      className="group flex items-center gap-2 rounded-lg border bg-background px-2 py-1.5"
                    >
                      <span className="w-5 shrink-0 text-center text-[10px] font-mono text-muted-foreground">
                        {i + 1}
                      </span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono uppercase text-primary">
                        {o.type}
                      </span>
                      <input
                        value={o.title}
                        onChange={(e) => updateOutlineTitle(i, e.target.value)}
                        className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none"
                      />
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => moveOutlineSlide(i, i - 1)}
                          disabled={i === 0}
                          aria-label="Move up"
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-20"
                        >
                          <ChevronDown className="h-3 w-3 rotate-180" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveOutlineSlide(i, i + 1)}
                          disabled={i === outlineReview.outline.length - 1}
                          aria-label="Move down"
                          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-20"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => addOutlineSlide(i)}
                          aria-label="Add slide after this one"
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeOutlineSlide(i)}
                          disabled={outlineReview.outline.length <= 2}
                          aria-label="Remove slide"
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-20"
                        >
                          <Trash className="h-3 w-3" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOutlineReview(null);
                      setPhase("idle");
                    }}
                    className="rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted transition"
                  >
                    Start over
                  </button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() => handleGenerate(outlineReview.outline)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg transition-shadow"
                  >
                    <Sparkles className="h-4 w-4" /> Build full deck from this outline
                  </motion.button>
                </div>
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
                <div className="print-hide flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{deck.topic}</h2>
                    <p className="text-sm text-muted-foreground">
                      {deck.slides.length} slides • {deck.courseCode}{" "}
                      {deck.courseName}
                      {!bulkMode && (
                        <>
                          {" "}• drag <GripVertical className="inline h-3 w-3 -mt-0.5" /> to reorder
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <motion.button
                      type="button"
                      onClick={() => {
                        setBulkMode((v) => !v);
                        setSelectedSlides(new Set());
                      }}
                      whileTap={{ scale: 0.94 }}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        bulkMode ? "border-primary bg-primary/10 text-primary" : "hover:border-primary hover:text-primary"
                      }`}
                    >
                      <ListChecks className="h-3.5 w-3.5" /> {bulkMode ? "Done selecting" : "Select"}
                    </motion.button>
                    {savedDeckId ? (
                      <motion.a
                        href={`/lecture-notes/${savedDeckId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        whileTap={{ scale: 0.94 }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition"
                      >
                        <BookOpen className="h-3.5 w-3.5" /> Lecture Notes
                      </motion.a>
                    ) : (
                      <span
                        title="Lecture notes need this deck saved first — check DATABASE_URL is configured"
                        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-50 cursor-not-allowed"
                      >
                        <BookOpen className="h-3.5 w-3.5" /> Lecture Notes
                      </span>
                    )}
                    <motion.button
                      type="button"
                      onClick={handlePrint}
                      whileTap={{ scale: 0.94 }}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
                    >
                      <Printer className="h-3.5 w-3.5" /> Print
                    </motion.button>
                    <motion.button
                      type="button"
                      onClick={toggleShare}
                      whileTap={{ scale: 0.94 }}
                      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share deck
                    </motion.button>
                  </div>
                </div>

                <AnimatePresence>
                  {bulkMode && selectedSlides.size > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="print-hide flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs overflow-hidden"
                    >
                      <span className="font-medium">{selectedSlides.size} selected</span>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={() => handleBulkRegenerate()}
                        disabled={bulkBusy}
                        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium hover:border-primary hover:text-primary transition disabled:opacity-50"
                      >
                        {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={handleBulkDelete}
                        disabled={bulkBusy || deck.slides.length - selectedSlides.size < 2}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 font-medium text-destructive hover:bg-destructive/10 transition disabled:opacity-50"
                      >
                        <Trash className="h-3 w-3" /> Delete
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div
                  id="printable-deck"
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
                        className="relative"
                      >
                        {bulkMode && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedSlides((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i);
                                else next.add(i);
                                return next;
                              })
                            }
                            aria-label={selectedSlides.has(i) ? `Deselect slide ${i + 1}` : `Select slide ${i + 1}`}
                            className="print-hide absolute -left-2 -top-2 z-30 rounded-full bg-card shadow"
                          >
                            {selectedSlides.has(i) ? (
                              <CheckSquare className="h-5 w-5 text-primary" />
                            ) : (
                              <Square className="h-5 w-5 text-muted-foreground" />
                            )}
                          </button>
                        )}
                        <SlideCard
                          index={i}
                          spec={s}
                          deck={deck}
                          apiKey={apiKey}
                          hasApiAccess={hasApiAccess}
                          totalSlides={deck.slides.length}
                          theme={settings.deckTheme}
                          disabled={bulkMode}
                          onDragStart={() => setDragIndex(i)}
                          onDragEnd={() => setDragIndex(null)}
                          onUpdate={(next) => updateSlide(i, next)}
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

function SlideCountPreview({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const role = i === 0 ? "title" : i === count - 1 ? "takeaway" : "content";
        return (
          <motion.div
            key={i}
            layout
            className={`h-6 w-9 shrink-0 rounded border ${
              role === "title"
                ? "bg-primary/70 border-primary"
                : role === "takeaway"
                  ? "bg-accent/60 border-accent"
                  : "bg-muted border-border"
            }`}
            title={role === "title" ? "Title slide" : role === "takeaway" ? "Takeaway slide" : `Slide ${i + 1}`}
          />
        );
      })}
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

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-destructive/40 bg-destructive/5 p-10 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-destructive/70" />
      <h3 className="mt-3 font-semibold text-foreground">Generation didn't finish</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        {message || "Something went wrong talking to Gemini. Your brief is still filled in — try again."}
      </p>
      <motion.button
        type="button"
        onClick={onRetry}
        whileTap={{ scale: 0.96 }}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
      >
        <RefreshCw className="h-4 w-4" /> Try again
      </motion.button>
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
  apiKey,
  hasApiAccess,
  totalSlides,
  theme,
  disabled,
  onDragStart,
  onDragEnd,
  onUpdate,
}: {
  index: number;
  spec: SlideDeck["slides"][number];
  deck: SlideDeck;
  apiKey: string;
  hasApiAccess: boolean;
  totalSlides: number;
  theme: ThemeId;
  disabled?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onUpdate: (next: SlideSpec) => void;
}) {
  const isTitle = spec.type === "title";
  const colors = DECK_THEMES[theme];
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineText, setRefineText] = useState("");
  const [draft, setDraft] = useState({
    title: spec.title ?? "",
    subtitle: spec.subtitle ?? "",
    body: spec.body ?? "",
    bulletsText: (spec.bullets ?? []).join("\n"),
  });
  const visualRef = useRef<HTMLDivElement>(null);

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

  async function handleRegenerate(instructions?: string) {
    if (!hasApiAccess) {
      toast.error("Add your Gemini API key first");
      return;
    }
    const previous = spec;
    setRegenerating(true);
    setRefining(false);
    try {
      const next = await regenerateSlide({
        data: {
          apiKey,
          topic: deck.topic,
          courseName: deck.courseName,
          courseCode: deck.courseCode,
          slideType: spec.type,
          currentTitle: spec.title,
          slidePosition: index + 1,
          totalSlides,
          instructions: instructions ?? "",
        },
      });
      onUpdate(next as SlideSpec);
      toast(`Slide ${index + 1} regenerated`, {
        action: { label: "Undo", onClick: () => onUpdate(previous) },
        duration: 5000,
      });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : "Regeneration failed";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      toast.error(rateLimitMatch ? rateLimitMatch[2] : message);
    } finally {
      setRegenerating(false);
      setRefineText("");
    }
  }

  function startEditing() {
    setDraft({
      title: spec.title ?? "",
      subtitle: spec.subtitle ?? "",
      body: spec.body ?? "",
      bulletsText: (spec.bullets ?? []).join("\n"),
    });
    setEditing(true);
  }

  function saveEdits() {
    onUpdate({
      ...spec,
      title: draft.title.trim() || spec.title,
      subtitle: draft.subtitle.trim() || undefined,
      body: draft.body.trim() || undefined,
      bullets: draft.bulletsText
        .split("\n")
        .map((b) => b.trim())
        .filter(Boolean),
    });
    setEditing(false);
    toast.success("Slide updated");
  }

  async function handleExportImage() {
    if (!visualRef.current) return;
    setExportingImage(true);
    try {
      const dataUrl = await toPng(visualRef.current, { pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `MIU_Slide_${index + 1}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Slide image downloaded");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't export this slide as an image");
    } finally {
      setExportingImage(false);
    }
  }

  const busy = regenerating || exportingImage;

  return (
    <div className="print-slide group rounded-xl overflow-hidden border bg-card slide-shadow">
      <div
        ref={visualRef}
        draggable={!editing && !disabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className={`print-slide-visual aspect-video relative overflow-hidden ${isTitle ? "text-white" : ""}`}
        style={{ background: isTitle ? `#${colors.primary}` : "#ffffff" }}
      >
        {!editing && (
          <div
            className="print-hide absolute left-1.5 top-1.5 z-10 cursor-grab active:cursor-grabbing rounded-md bg-black/20 p-1 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          >
            <GripVertical className={`h-3.5 w-3.5 ${isTitle ? "text-white/90" : "text-slate-500"}`} />
          </div>
        )}
        <div
          className={`print-hide absolute right-1.5 top-1.5 z-10 rounded bg-black/20 px-1.5 py-0.5 font-mono text-[9px] uppercase ${isTitle ? "text-white/90" : "text-slate-600"}`}
        >
          {spec.type}
        </div>

        <AnimatePresence>
          {(regenerating || exportingImage) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-[1px]"
            >
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </motion.div>
          )}
        </AnimatePresence>

        {editing ? (
          <div className="absolute inset-0 flex flex-col gap-1.5 bg-white p-3 text-slate-800">
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Title"
              className="w-full rounded border px-1.5 py-1 text-[11px] font-bold focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {!isTitle && (
              <>
                <input
                  value={draft.subtitle}
                  onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))}
                  placeholder="Subtitle (optional)"
                  className="w-full rounded border px-1.5 py-1 text-[10px] italic focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder="Body paragraph (optional)"
                  rows={2}
                  className="w-full flex-shrink-0 rounded border px-1.5 py-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <textarea
                  value={draft.bulletsText}
                  onChange={(e) => setDraft((d) => ({ ...d, bulletsText: e.target.value }))}
                  placeholder="One bullet per line"
                  rows={3}
                  className="w-full flex-1 min-h-0 rounded border px-1.5 py-1 text-[9px] focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </>
            )}
            <div className="flex gap-1.5 mt-auto">
              <button
                type="button"
                onClick={saveEdits}
                className="flex-1 rounded bg-primary py-1 text-[10px] font-semibold text-primary-foreground hover:opacity-90 transition"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="flex-1 rounded border py-1 text-[10px] font-medium hover:bg-muted transition"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : isTitle ? (
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
                  className="rounded-md px-2 py-0.5 text-[10px] font-bold"
                  style={{ backgroundColor: `#${colors.accent}` }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 p-4 flex flex-col">
            <div
              className="text-[11px] font-bold uppercase tracking-wide"
              style={{ color: `#${colors.primary}` }}
            >
              {spec.title}
            </div>
            {spec.subtitle && (
              <div className="text-[9px] italic mt-0.5" style={{ color: `#${colors.accent}` }}>
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
                      <div className="font-bold" style={{ color: `#${colors.accent}` }}>{s.heading}</div>
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
      <div className="print-hide px-3 py-2 flex items-center justify-between text-xs bg-muted/40">
        <span className="text-muted-foreground">Slide {index + 1}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopySlide}
            disabled={editing || disabled}
            aria-label={`Copy text from slide ${index + 1}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30"
          >
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={editing ? saveEdits : startEditing}
            disabled={disabled}
            aria-label={editing ? `Save slide ${index + 1}` : `Edit slide ${index + 1}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setRefining((v) => !v)}
            disabled={busy || editing || disabled}
            aria-label={`Regenerate slide ${index + 1} with instructions`}
            className={`rounded p-1 transition disabled:opacity-30 ${refining ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <MessageSquarePlus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => handleRegenerate()}
            disabled={busy || editing || disabled}
            aria-label={`Regenerate slide ${index + 1}`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30"
          >
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={handleExportImage}
            disabled={busy || editing || disabled}
            aria-label={`Download slide ${index + 1} as an image`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition disabled:opacity-30"
          >
            <FileImage className="h-3 w-3" />
          </button>
        </div>
      </div>
      <AnimatePresence>
        {refining && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && refineText.trim()) handleRegenerate(refineText.trim());
                }}
                placeholder="e.g. 'make this more technical' or 'shorten it'"
                className="flex-1 rounded border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <button
                type="button"
                onClick={() => refineText.trim() && handleRegenerate(refineText.trim())}
                disabled={!refineText.trim() || regenerating}
                className="shrink-0 rounded bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 transition disabled:opacity-40"
              >
                Go
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
