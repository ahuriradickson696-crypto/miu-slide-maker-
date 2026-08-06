import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  BarChart3,
  Users,
  FileStack,
  BookOpen,
  TrendingUp,
  AlertTriangle,
  ArrowLeft,
  Search,
  ShieldCheck,
  Shield,
  Trash2,
  Loader2,
  KeyRound,
  Zap,
  Check,
  X,
  Database,
} from "lucide-react";
import {
  getUsageStats,
  getSystemStatus,
  adminListUsers,
  adminSetUserAdmin,
  adminListDecks,
  adminDeleteDeck,
  adminListLectureNotes,
  adminDeleteLectureNotes,
  adminTriggerBackup,
} from "@/lib/admin.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import logo from "@/assets/miu-logo.jpg";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type Tab = "overview" | "users" | "decks" | "notes" | "system";

function AdminPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    getUsageStats()
      .then(() => setAuthorized(true))
      .catch((e) => {
        setAuthorized(false);
        setAuthError(e instanceof Error ? e.message : "Not authorized.");
      });
  }, []);

  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />

      <header className="miu-gradient text-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-4 flex items-center gap-3">
          <img src={logo} alt="" className="h-9 w-9 rounded-lg bg-white p-1" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{MIU_FACTS.legalName}</p>
            <p className="text-[11px] opacity-80">Admin Control Center</p>
          </div>
          <a href="/" className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline shrink-0">
            <ArrowLeft className="h-3.5 w-3.5" /> Home
          </a>
        </div>
      </header>

      {authorized === null && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {authorized === false && (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive/70 mb-3" />
          <p className="font-medium">Can't show this dashboard</p>
          <p className="mt-1 text-sm text-muted-foreground">{authError}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            This page is restricted to admins. The designated first admin account is promoted
            automatically on sign-in, and can then add or remove other admins from the Users tab.
          </p>
          <a href="/" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Back to Home
          </a>
        </div>
      )}

      {authorized && (
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
          <nav className="flex gap-1 overflow-x-auto border-b mb-6 pb-px">
            <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<BarChart3 className="h-3.5 w-3.5" />}>
              Overview
            </TabButton>
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="h-3.5 w-3.5" />}>
              Users
            </TabButton>
            <TabButton active={tab === "decks"} onClick={() => setTab("decks")} icon={<FileStack className="h-3.5 w-3.5" />}>
              Slide Decks
            </TabButton>
            <TabButton active={tab === "notes"} onClick={() => setTab("notes")} icon={<BookOpen className="h-3.5 w-3.5" />}>
              Lecture Notes
            </TabButton>
            <TabButton active={tab === "system"} onClick={() => setTab("system")} icon={<Zap className="h-3.5 w-3.5" />}>
              System
            </TabButton>
          </nav>

          {tab === "overview" && <OverviewTab />}
          {tab === "users" && <UsersTab />}
          {tab === "decks" && <DecksTab />}
          {tab === "notes" && <NotesTab />}
          {tab === "system" && <SystemTab />}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition ${
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({ icon, label, value }: { icon?: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
    </div>
  );
}

// ========== Overview ==========

type Stats = Awaited<ReturnType<typeof getUsageStats>>;

function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUsageStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (!stats) return <p className="text-sm text-muted-foreground">Couldn't load stats.</p>;

  const maxDay = Math.max(...stats.byDay.map((x) => x.count), 1);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={<FileStack className="h-4 w-4" />} label="Total decks" value={stats.totalDecks} />
        <StatCard icon={<BookOpen className="h-4 w-4" />} label="Lecture notes" value={stats.totalNotes} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Decks today" value={stats.decksToday} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Total users" value={stats.totalUsers} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="This week" value={stats.decksThisWeek} />
        <StatCard label="Total slides generated" value={stats.totalSlides} />
        <StatCard label="Avg slides / deck" value={stats.avgSlides} />
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-3">Decks per day (last 14 days)</h2>
        <div className="rounded-xl border bg-card p-4">
          {stats.byDay.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decks generated in this window yet.</p>
          ) : (
            <div className="flex items-end gap-1.5 h-32">
              {stats.byDay.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${(d.count / maxDay) * 100}%` }}
                    transition={{ duration: 0.4 }}
                    className="w-full rounded-t bg-primary/70 min-h-[2px]"
                  />
                  <span className="text-[9px] text-muted-foreground">{d.day.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ========== Shared paginated list scaffolding ==========

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-4 max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-background py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="mt-3 w-full rounded-lg border border-dashed py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto" /> : "Load more"}
    </button>
  );
}

// ========== Users ==========

type AdminUser = Awaited<ReturnType<typeof adminListUsers>>["users"][number];

function UsersTab() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function load(reset: boolean) {
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const result = await adminListUsers({ data: { offset: reset ? 0 : users.length, limit: 25, query } });
      setUsers((prev) => (reset ? result.users : [...prev, ...result.users]));
      setHasMore(result.hasMore);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load users");
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

  async function toggleAdmin(u: AdminUser) {
    setTogglingId(u.id);
    try {
      await adminSetUserAdmin({ data: { userId: u.id, isAdmin: !u.isAdmin } });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, isAdmin: !x.isAdmin } : x)));
      toast.success(!u.isAdmin ? `${u.email} is now an admin` : `${u.email} is no longer an admin`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update admin status");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <SearchBar value={query} onChange={setQuery} placeholder="Search by name or email…" />
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No users found.</p>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3">
              {u.picture ? (
                <img src={u.picture} alt="" className="h-8 w-8 rounded-full shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                  {u.email[0]?.toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{u.name || u.email}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {u.email} • {u.deckCount} deck{u.deckCount === 1 ? "" : "s"} •{" "}
                  {[u.hasGoogle && "Google", u.hasPassword && "Password"].filter(Boolean).join(" + ") || "—"}
                </p>
              </div>
              {u.isAdmin && (
                <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0">
                  <ShieldCheck className="h-3 w-3" /> Admin
                </span>
              )}
              <button
                type="button"
                onClick={() => toggleAdmin(u)}
                disabled={togglingId === u.id}
                className={`shrink-0 inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                  u.isAdmin ? "text-destructive hover:bg-destructive/10" : "text-primary hover:bg-primary/10"
                }`}
              >
                {togglingId === u.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : u.isAdmin ? (
                  <Shield className="h-3 w-3" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                {u.isAdmin ? "Revoke" : "Promote"}
              </button>
            </div>
          ))}
        </div>
      )}
      {hasMore && !loading && <LoadMoreButton onClick={() => load(false)} loading={loadingMore} />}
    </div>
  );
}

// ========== Decks ==========

type AdminDeck = Awaited<ReturnType<typeof adminListDecks>>["decks"][number];

function DecksTab() {
  const [decks, setDecks] = useState<AdminDeck[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load(reset: boolean) {
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const result = await adminListDecks({ data: { offset: reset ? 0 : decks.length, limit: 25, query } });
      setDecks((prev) => (reset ? result.decks : [...prev, ...result.decks]));
      setHasMore(result.hasMore);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load decks");
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

  async function handleDelete(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 3000);
      return;
    }
    setDeletingId(id);
    try {
      await adminDeleteDeck({ data: { id } });
      setDecks((prev) => prev.filter((d) => d.id !== id));
      toast.success("Deck deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete deck");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  return (
    <div>
      <SearchBar value={query} onChange={setQuery} placeholder="Search by topic or owner email…" />
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : decks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No decks found.</p>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {decks.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{d.topic || "Untitled deck"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[d.courseCode, d.courseName].filter(Boolean).join(" • ") || "—"} • {d.slideCount} slides •{" "}
                  {d.ownerEmail || "no owner"} • {new Date(d.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(d.id)}
                disabled={deletingId === d.id}
                className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                  confirmId === d.id
                    ? "bg-destructive text-destructive-foreground"
                    : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                }`}
              >
                {deletingId === d.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {confirmId === d.id ? "Confirm?" : ""}
              </button>
            </div>
          ))}
        </div>
      )}
      {hasMore && !loading && <LoadMoreButton onClick={() => load(false)} loading={loadingMore} />}
    </div>
  );
}

// ========== Lecture notes ==========

type AdminNotes = Awaited<ReturnType<typeof adminListLectureNotes>>["notes"][number];

function NotesTab() {
  const [notes, setNotes] = useState<AdminNotes[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load(reset: boolean) {
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const result = await adminListLectureNotes({ data: { offset: reset ? 0 : notes.length, limit: 25, query } });
      setNotes((prev) => (reset ? result.notes : [...prev, ...result.notes]));
      setHasMore(result.hasMore);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load lecture notes");
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

  async function handleDelete(deckId: string) {
    if (confirmId !== deckId) {
      setConfirmId(deckId);
      setTimeout(() => setConfirmId((c) => (c === deckId ? null : c)), 3000);
      return;
    }
    setDeletingId(deckId);
    try {
      await adminDeleteLectureNotes({ data: { deckId } });
      setNotes((prev) => prev.filter((n) => n.deckId !== deckId));
      toast.success("Lecture notes deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete notes");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  return (
    <div>
      <SearchBar value={query} onChange={setQuery} placeholder="Search by topic or owner email…" />
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No lecture notes found.</p>
      ) : (
        <div className="rounded-xl border bg-card divide-y">
          {notes.map((n) => (
            <div key={n.deckId} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{n.topic || "Untitled"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {n.courseCode || "—"} • {n.ownerEmail || "no owner"} • updated{" "}
                  {new Date(n.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <a
                href={`/lecture-notes/${n.deckId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] font-medium text-primary hover:underline"
              >
                View
              </a>
              <button
                type="button"
                onClick={() => handleDelete(n.deckId)}
                disabled={deletingId === n.deckId}
                className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition disabled:opacity-50 ${
                  confirmId === n.deckId
                    ? "bg-destructive text-destructive-foreground"
                    : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                }`}
              >
                {deletingId === n.deckId ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                {confirmId === n.deckId ? "Confirm?" : ""}
              </button>
            </div>
          ))}
        </div>
      )}
      {hasMore && !loading && <LoadMoreButton onClick={() => load(false)} loading={loadingMore} />}
    </div>
  );
}

// ========== System ==========

function ConfigRow({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <div className="flex items-start gap-3 p-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          ok ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
        }`}
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function SystemTab() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getSystemStatus>> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSystemStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
  if (!status) return <p className="text-sm text-muted-foreground">Couldn't load system status.</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <KeyRound className="h-4 w-4 text-primary" /> Gemini API key
        </h2>
        <div className="rounded-xl border bg-card divide-y">
          <ConfigRow
            ok={status.sharedApiKey}
            label={status.sharedApiKey ? "A shared API key is configured" : "No shared API key configured"}
            hint={
              status.sharedApiKey
                ? "Set via GEMINI_API_KEY — anyone using this app without pasting their own key uses this one automatically."
                : "Set GEMINI_API_KEY in Vercel's Environment Variables so people don't each need their own key. Until then, everyone must paste their own (get one free at aistudio.google.com/apikey)."
            }
          />
          <ConfigRow
            ok={status.groqFallback}
            label={status.groqFallback ? "Groq fallback is configured" : "No fallback provider configured"}
            hint={
              status.groqFallback
                ? "Set via GROQ_API_KEY — automatically used as a last resort if Gemini is rate-limited or erroring on both models."
                : "Set GROQ_API_KEY (free tier at console.groq.com) so generation doesn't just fail outright if Gemini is down or rate-limited."
            }
          />
          <ConfigRow
            ok={status.deepseekFallback}
            label={status.deepseekFallback ? "DeepSeek fallback is configured" : "No second-tier fallback configured"}
            hint={
              status.deepseekFallback
                ? "Set via DEEPSEEK_API_KEY — tried after Groq, if Groq also fails or isn't configured."
                : "Set DEEPSEEK_API_KEY for a second fallback tier, tried after Groq."
            }
          />
        </div>
      </div>

      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <Zap className="h-4 w-4 text-primary" /> Integrations
        </h2>
        <div className="rounded-xl border bg-card divide-y">
          <ConfigRow
            ok={status.database}
            label="Database (Neon Postgres)"
            hint={status.database ? "DATABASE_URL is set — decks, notes, and accounts persist." : "Set DATABASE_URL — without it, nothing is saved."}
          />
          <ConfigRow
            ok={status.redis}
            label="Redis (Upstash)"
            hint={status.redis ? "Distributed rate limiting, caching, and locking are active." : "Set UPSTASH_REDIS_REST_URL/TOKEN for cross-instance rate limiting."}
          />
          <ConfigRow
            ok={status.session}
            label="Sessions / accounts"
            hint={status.session ? "SESSION_SECRET is set — sign-in is available." : "Set SESSION_SECRET (32+ chars) to enable accounts."}
          />
          <ConfigRow
            ok={status.googleAuth}
            label="Google Sign-In"
            hint={status.googleAuth ? "Configured." : "Set VITE_GOOGLE_CLIENT_ID + GOOGLE_CLIENT_ID to enable."}
          />
          <ConfigRow
            ok={status.passwordAuth}
            label="Email/password sign-in"
            hint={status.passwordAuth ? "Available." : "Needs sessions + database configured."}
          />
          <ConfigRow
            ok={status.email}
            label="Transactional email (Resend)"
            hint={status.email ? "Password-reset emails are actually delivered." : "Set RESEND_API_KEY — until then, reset links are only logged server-side."}
          />
        </div>
      </div>

      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold mb-3">
          <Database className="h-4 w-4 text-primary" /> Storage &amp; backups
        </h2>
        <div className="rounded-xl border bg-card divide-y">
          <ConfigRow
            ok={status.r2Storage}
            label={status.r2Storage ? "R2 file storage is configured" : "R2 file storage not configured"}
            hint={
              status.r2Storage
                ? "Original uploaded curriculum documents are preserved and downloadable from the curriculum page."
                : "Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_BUCKET — note R2 needs a proper access key ID + secret pair (generate one from the R2 dashboard's 'Manage API Tokens'), a single Cloudflare API key alone won't authenticate S3-compatible requests."
            }
          />
          <ConfigRow
            ok={status.backupStorage}
            label={status.backupStorage ? "Backup storage is configured" : "Backup storage not configured"}
            hint={
              status.backupStorage
                ? "Decks, notes, curricula, and non-sensitive user fields (never password hashes) can be backed up on demand below."
                : "Set BACKUP_STORAGE_ENDPOINT, BACKUP_STORAGE_ACCESS_KEY_ID, BACKUP_STORAGE_SECRET_ACCESS_KEY, and BACKUP_STORAGE_BUCKET (works with Backblaze B2, AWS S3, or any S3-compatible provider)."
            }
          />
          {status.backupStorage && <BackupNowRow />}
        </div>
      </div>
    </div>
  );
}

function BackupNowRow() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function handleBackup() {
    setRunning(true);
    setLastResult(null);
    try {
      const result = await adminTriggerBackup();
      toast.success(`Backup saved (${result.counts.decks} decks, ${result.counts.curricula} curricula)`);
      setLastResult(`Last backup: ${result.key}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3 p-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Database className="h-3 w-3" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Manual backup</p>
        <p className="text-xs text-muted-foreground">{lastResult ?? "Dumps all data to your configured backup storage."}</p>
      </div>
      <button
        type="button"
        onClick={handleBackup}
        disabled={running}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition disabled:opacity-50"
      >
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Database className="h-3 w-3" />}
        Backup now
      </button>
    </div>
  );
}
