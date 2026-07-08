import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast, Toaster } from "sonner";
import { Loader2, Sparkles, Download, FileText, Wand2, ImageIcon } from "lucide-react";
import { generateDeck, generateIllustration, type SlideDeck } from "@/lib/slides.functions";
import { exportDeckToPptx } from "@/lib/pptx-export";
import logo from "@/assets/miu-logo.jpg";

export const Route = createFileRoute("/")({
  component: StudioPage,
});

type Illus = (string | null)[];

function StudioPage() {
  const [mode, setMode] = useState<"brief" | "paste">("brief");
  const [form, setForm] = useState({
    topic: "Topic Seven: Reports",
    courseName: "Communication Skills",
    courseCode: "BEE 1101",
    courseLevel: "Undergraduate-Degree (Year One, Semester One)",
    creditUnits: "3 Credit Units | Total Contact Hours: 45",
    contactTime: "Allocated Contact Time: 3 Hours",
    slideCount: 10,
    extraNotes: "",
    pastedContent: "",
  });
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [illus, setIllus] = useState<Illus>([]);
  const [phase, setPhase] = useState<"idle" | "outline" | "images" | "done">("idle");
  const [progress, setProgress] = useState(0);

  const update = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function handleGenerate() {
    if (mode === "brief" && !form.topic.trim()) return toast.error("Please enter a topic");
    if (mode === "paste" && form.pastedContent.trim().length < 20)
      return toast.error("Paste some course material first");
    setDeck(null);
    setIllus([]);
    setProgress(0);
    setPhase("outline");
    try {
      const d = await generateDeck({ data: { ...form, mode } });
      setDeck(d);
      setIllus(new Array(d.slides.length).fill(null));
      setPhase("images");
      toast.success(`Outline ready — ${d.slides.length} slides`);

      const images: Illus = new Array(d.slides.length).fill(null);
      let failCount = 0;
      for (let i = 0; i < d.slides.length; i++) {
        try {
          const { dataUrl } = await generateIllustration({
            data: { prompt: d.slides[i].illustrationPrompt },
          });
          images[i] = dataUrl;
        } catch (e) {
          failCount++;
          console.error("illus fail", i, e);
        }
        setIllus([...images]);
        setProgress(Math.round(((i + 1) / d.slides.length) * 100));
      }
      setPhase("done");
      if (failCount === 0) {
        toast.success("All illustrations rendered");
      } else if (failCount < d.slides.length) {
        toast.warning(`${failCount} of ${d.slides.length} illustrations failed — check console for details`);
      } else {
        toast.error("All illustrations failed to generate — check console for details");
      }
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : "Generation failed");
      setPhase("idle");
    }
  }

  async function handleDownload() {
    if (!deck) return;
    try {
      await exportDeckToPptx(deck, illus);
      toast.success("Downloaded PowerPoint file");
    } catch (e) {
      console.error(e);
      toast.error("Export failed");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="miu-gradient text-primary-foreground">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center gap-4">
          <img src={logo} alt="MIU logo" className="h-14 w-14 rounded-xl bg-white p-1 shadow-lg" />
          <div className="flex-1">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Metropolitan International University
            </h1>
            <p className="text-sm opacity-90">Slide Studio — AI Lecture Deck Generator</p>
          </div>
          <div className="hidden sm:flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            Powered by Gemini
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 grid gap-8 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <section className="rounded-2xl bg-card border p-6 slide-shadow h-fit sticky top-6">
          <div className="flex items-center gap-2 mb-4">
            <Wand2 className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Deck brief</h2>
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
                  <Input value={form.courseCode} onChange={(v) => update("courseCode", v)} />
                </Field>
                <Field label="Slides">
                  <input
                    type="number"
                    min={4}
                    max={20}
                    value={form.slideCount}
                    onChange={(e) => update("slideCount", parseInt(e.target.value) || 10)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </Field>
              </div>
              <Field label="Course name">
                <Input value={form.courseName} onChange={(v) => update("courseName", v)} />
              </Field>
              <Field label="Course level">
                <Input value={form.courseLevel} onChange={(v) => update("courseLevel", v)} />
              </Field>
              <Field label="Credit units">
                <Input value={form.creditUnits} onChange={(v) => update("creditUnits", v)} />
              </Field>
              <Field label="Contact time">
                <Input value={form.contactTime} onChange={(v) => update("contactTime", v)} />
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
              <Field label="Paste everything — notes, textbook chapter, outline" required>
                <textarea
                  value={form.pastedContent}
                  onChange={(e) => update("pastedContent", e.target.value)}
                  rows={14}
                  placeholder="Drop your full lecture notes, a chapter, or a rough outline here. The AI will read it, extract the topic and course details, and design the deck for you."
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
                    onChange={(e) => update("slideCount", parseInt(e.target.value) || 10)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Course code (optional)">
                  <Input value={form.courseCode} onChange={(v) => update("courseCode", v)} />
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
                💡 The AI will extract the topic and course details from your text and structure a full MIU-branded deck with illustrations automatically.
              </p>
            </div>
          )}

          <button
            onClick={handleGenerate}
            disabled={phase === "outline" || phase === "images"}
            className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
          >
            {phase === "outline" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Writing outline…</>
            ) : phase === "images" ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Rendering illustrations {progress}%</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Generate slide deck</>
            )}
          </button>

          {deck && (
            <button
              onClick={handleDownload}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90 transition"
            >
              <Download className="h-4 w-4" /> Download .pptx
            </button>
          )}
        </section>

        {/* Preview */}
        <section>
          {!deck && phase === "idle" && <EmptyState />}
          {phase === "outline" && <SkeletonState label="Structuring your lecture…" />}
          {deck && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{deck.topic}</h2>
                  <p className="text-sm text-muted-foreground">
                    {deck.slides.length} slides • {deck.courseCode} {deck.courseName}
                  </p>
                </div>
                {phase === "images" && (
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Illustrations {progress}%
                  </div>
                )}
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                {deck.slides.map((s, i) => (
                  <SlideCard key={i} index={i} spec={s} deck={deck} illus={illus[i]} />
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-6 py-8 text-xs text-muted-foreground border-t mt-8">
        Metropolitan International University • www.miu.ac.ug • Kampala • Mbarara • Kisoro Campuses
      </footer>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {label}{required && <span className="text-accent"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Input({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border-2 border-dashed p-10 text-center text-muted-foreground">
      <FileText className="mx-auto h-10 w-10 text-primary/60" />
      <h3 className="mt-3 font-semibold text-foreground">Start with a topic on the left</h3>
      <p className="mt-1 text-sm">
        We'll write the outline, illustrate each slide, and export a MIU-branded PowerPoint you can present or edit.
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

function SlideCard({
  index, spec, deck, illus,
}: {
  index: number;
  spec: SlideDeck["slides"][number];
  deck: SlideDeck;
  illus: string | null;
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
            <img src={logo} alt="" className="h-16 w-16 rounded-lg bg-white p-1 mb-3" />
            <div className="text-[10px] font-bold tracking-wider">METROPOLITAN INTERNATIONAL UNIVERSITY</div>
            <div className="mt-1 text-lg font-semibold">{spec.title}</div>
            <div className="mt-3 flex gap-2 flex-wrap justify-center">
              {[deck.courseCode, deck.courseName].filter(Boolean).map((p) => (
                <span key={p} className="rounded-md bg-[#C8102E] px-2 py-0.5 text-[10px] font-bold">{p}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 p-4 flex flex-col">
            <div className="text-[11px] font-bold text-[#0F7A3A] uppercase tracking-wide">{spec.title}</div>
            {spec.subtitle && <div className="text-[9px] italic text-[#C8102E] mt-0.5">{spec.subtitle}</div>}
            <div className="flex-1 flex gap-3 mt-2 min-h-0">
              <div className="flex-1 text-[9px] text-slate-700 space-y-1.5 overflow-hidden">
                {spec.body && <p className="line-clamp-3">{spec.body}</p>}
                {spec.sections?.slice(0, 3).map((s, i) => (
                  <div key={i}>
                    <div className="font-bold text-[#C8102E]">{s.heading}</div>
                    <div className="line-clamp-2">{s.description}</div>
                  </div>
                ))}
                {spec.bullets && (
                  <ul className="list-disc pl-3 space-y-0.5">
                    {spec.bullets.slice(0, 5).map((b, i) => <li key={i} className="line-clamp-1">{b}</li>)}
                  </ul>
                )}
              </div>
              <div className="w-20 h-20 shrink-0 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                {illus ? (
                  <img src={illus} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="h-5 w-5 text-muted-foreground/50 animate-pulse" />
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
        <span className="font-mono text-[10px] uppercase text-primary">{spec.type}</span>
      </div>
    </div>
  );
}
