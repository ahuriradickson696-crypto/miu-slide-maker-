import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  Presentation,
  BookOpen,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  ListChecks,
  Layers,
  GraduationCap,
  UploadCloud,
} from "lucide-react";
import { checkIsAdmin, type SessionUser } from "@/lib/auth.functions";
import { AuthGate } from "@/components/AuthGate";
import { MIU_FACTS } from "@/lib/miu-facts";
import logo from "@/assets/miu-logo.jpg";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  function handleAuthChange(u: SessionUser | null) {
    setUser(u);
    setChecked(true);
    if (u) checkIsAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
    else setIsAdmin(false);
  }

  return (
    <div className="min-h-screen bg-[#F7F8F5] flex flex-col">
      {/* Top bar */}
      <div className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <img src={logo} alt="MIU logo" className="h-8 w-8 rounded-lg" />
          <span className="text-sm font-bold text-primary truncate">{MIU_FACTS.shortName} Studio</span>
          <div className="flex-1" />
          {checked && (
            <div className="flex items-center gap-3 text-xs">
              {isAdmin && (
                <a href="/admin" className="font-medium text-muted-foreground hover:text-primary transition">
                  Admin
                </a>
              )}
              <a
                href="/slides"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                {user ? (
                  <>
                    {user.picture ? (
                      <img src={user.picture} alt="" className="h-5 w-5 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold">
                        {user.email[0]?.toUpperCase()}
                      </span>
                    )}
                    <span className="hidden sm:inline max-w-[8rem] truncate">{user.name || user.email}</span>
                  </>
                ) : (
                  "Sign in"
                )}
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Hero */}
      <div className="miu-gradient text-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-14 sm:pt-20 pb-16 sm:pb-24 text-center">
          <motion.img
            src={logo}
            alt="Metropolitan International University"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="mx-auto h-20 w-20 sm:h-24 sm:w-24 rounded-2xl bg-white p-2 shadow-lg mb-6"
          />
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-2xl sm:text-4xl font-semibold leading-tight px-2"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {MIU_FACTS.legalName}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className="mt-2 text-sm sm:text-base italic opacity-90"
          >
            "{MIU_FACTS.motto}"
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="mt-5 text-xs sm:text-sm uppercase tracking-[0.2em] opacity-75"
          >
            Digital Learning Studio
          </motion.p>
        </div>
      </div>

      {/* Feature grid — locked behind sign-in; nothing here is usable as a guest */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 -mt-10 sm:-mt-14 pb-16 flex-1">
        <AuthGate serviceName="MIU Studio" onAuthChange={handleAuthChange}>
          <div className="grid sm:grid-cols-2 gap-5">
            <FeatureCard
              href="/slides"
              icon={<Presentation className="h-6 w-6" />}
              title="Slide Decks"
              description="Generate branded, well-structured lecture slide decks from a topic or your own notes — with AI outlines, editing, themes, and PowerPoint/PDF export."
              cta="Open Slide Studio"
            />
            <FeatureCard
              href="/notes"
              icon={<BookOpen className="h-6 w-6" />}
              title="Lecture Notes"
              description="Turn any generated deck into a polished, printable lecture-notes document — full prose, key terms, learning outcomes, and takeaways."
              cta="Open Lecture Notes"
            />
            <FeatureCard
              href="/curriculum"
              icon={<UploadCloud className="h-6 w-6" />}
              title="Curriculum Import"
              description="Upload a full program curriculum (PDF, Word, or text) — it's parsed into its academic hierarchy, then generates complete, rigorous lecture notes for every topic, one semester at a time."
              cta="Open Curriculum Import"
            />
            <ComingSoonCard
              icon={<ListChecks className="h-6 w-6" />}
              title="Quiz Generator"
              description="Turn a deck into multiple-choice or short-answer assessments, ready to export."
            />
            <ComingSoonCard
              icon={<Layers className="h-6 w-6" />}
              title="Flashcards"
              description="Study-ready flashcard sets generated from key terms across a lecture."
            />
          </div>

          {user && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-6 rounded-xl border bg-white p-4 flex items-center gap-3"
            >
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground">
                Signed in as <span className="font-medium text-foreground">{user.email}</span> — your decks and
                notes are saved to your account and searchable from each module's History/Library.
              </p>
            </motion.div>
          )}
        </AuthGate>
      </div>

      {/* Footer */}
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <GraduationCap className="h-3.5 w-3.5" />
            {MIU_FACTS.accreditation}
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            {MIU_FACTS.website} • {MIU_FACTS.campusesShort}
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  href,
  icon,
  title,
  description,
  cta,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
}) {
  return (
    <motion.a
      href={href}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      transition={{ duration: 0.3 }}
      className="group flex flex-col rounded-2xl border bg-white p-6 shadow-lg hover:shadow-xl transition-shadow"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white mb-4">
        {icon}
      </span>
      <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed flex-1">{description}</p>
      <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </span>
    </motion.a>
  );
}

function ComingSoonCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-dashed bg-white/60 p-6 opacity-70">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground mb-4">
        {icon}
      </span>
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-muted-foreground" style={{ fontFamily: "var(--font-display)" }}>
          {title}
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coming soon
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
