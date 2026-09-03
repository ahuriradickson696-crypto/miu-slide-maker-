import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertTriangle, BookOpen, GraduationCap, Presentation } from "lucide-react";
import { resolveSharedContent } from "@/lib/share.functions";
import type { SlideDeck, SlideSpec } from "@/lib/slides.functions";
import type { LectureNotes } from "@/lib/lecture-notes.functions";
import { getTheme } from "@/lib/themes";
import { MIU_FACTS } from "@/lib/miu-facts";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/shared/$token")({
  component: SharedViewPage,
});

function SharedViewPage() {
  const { token } = Route.useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [notes, setNotes] = useState<LectureNotes | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveSharedContent({ data: { token } })
      .then((result) => {
        if (cancelled) return;
        setDeck(result.deck);
        setNotes(result.notes);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load this shared link."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-3 flex items-center gap-2">
          <img src={logo} alt="" className="h-7 w-7 object-contain" />
          <span className="text-xs font-semibold text-primary">{MIU_FACTS.shortName} Studio — Shared view</span>
          <div className="flex-1" />
          <a href="/" className="text-xs font-medium text-primary hover:underline">
            Open MIU Studio
          </a>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {error && !loading && (
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive/70 mb-3" />
          <p className="font-medium">{error}</p>
          <a href="/" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
            Go to MIU Studio
          </a>
        </div>
      )}

      {deck && !loading && !error && <SharedDeckView deck={deck} />}
      {notes && !loading && !error && <SharedNotesView notes={notes} />}
    </div>
  );
}

function SharedDeckView({ deck }: { deck: SlideDeck }) {
  const theme = getTheme(undefined);
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <Presentation className="h-3.5 w-3.5" /> Shared slide deck • read-only
      </div>
      <h1 className="text-xl sm:text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-display)" }}>
        {deck.topic}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {[deck.courseCode, deck.courseName, deck.courseLevel].filter(Boolean).join(" • ")}
      </p>

      <div className="space-y-4">
        {deck.slides.map((slide, i) => (
          <SharedSlideCard key={i} slide={slide} index={i} accent={theme.primary} />
        ))}
      </div>
    </div>
  );
}

function SharedSlideCard({ slide, index, accent }: { slide: SlideSpec; index: number; accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.3) }}
      className="rounded-xl border bg-white p-5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        Slide {index + 1}
      </p>
      <h2 className="text-base font-semibold mb-2" style={{ color: accent }}>
        {slide.title}
      </h2>
      {slide.subtitle && <p className="text-sm text-muted-foreground mb-2">{slide.subtitle}</p>}
      {slide.body && <p className="text-sm text-slate-700 leading-relaxed mb-2">{slide.body}</p>}
      {slide.bullets && slide.bullets.length > 0 && (
        <ul className="space-y-1 mt-2">
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
              {b}
            </li>
          ))}
        </ul>
      )}
      {slide.sections && slide.sections.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-3 mt-2">
          {slide.sections.map((s, i) => (
            <div key={i} className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-semibold mb-1">{s.heading}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function SharedNotesView({ notes }: { notes: LectureNotes }) {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <BookOpen className="h-3.5 w-3.5" /> Shared lecture notes • read-only
      </div>
      <h1 className="text-xl sm:text-2xl font-semibold mb-1" style={{ fontFamily: "var(--font-display)" }}>
        {notes.topic}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {[notes.courseCode, notes.courseName, notes.courseLevel].filter(Boolean).join(" • ")}
      </p>

      <div className="rounded-xl border bg-white p-6 space-y-6">
        {notes.overview && (
          <section>
            <h2 className="text-sm font-semibold text-primary mb-1">Overview</h2>
            <p className="text-sm text-slate-700 leading-relaxed">{notes.overview}</p>
          </section>
        )}
        {notes.sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-sm font-semibold text-primary mb-1">
              {i + 1}. {s.heading}
            </h2>
            {s.paragraphs.map((p, pi) => (
              <p key={pi} className="text-sm text-slate-700 leading-relaxed mb-2">
                {p}
              </p>
            ))}
          </section>
        ))}
        {notes.keyTakeaways.length > 0 && (
          <section className="rounded-lg bg-primary/5 border border-primary/20 p-4">
            <h2 className="text-sm font-semibold text-primary mb-2">Key Takeaways</h2>
            <ul className="space-y-1">
              {notes.keyTakeaways.map((k, i) => (
                <li key={i} className="text-sm text-slate-700">• {k}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <GraduationCap className="h-3.5 w-3.5" />
        {MIU_FACTS.legalName} • {MIU_FACTS.website}
      </div>
    </div>
  );
}
