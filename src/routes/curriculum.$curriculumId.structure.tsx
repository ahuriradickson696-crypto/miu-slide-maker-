import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  GripVertical,
  Plus,
  X,
  Save,
  Calendar,
  Table2,
  ListTree,
} from "lucide-react";
import {
  getCurriculum,
  updateCurriculumStructure,
  type CurriculumStructure,
  type CourseUnit,
} from "@/lib/curriculum.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/curriculum/$curriculumId/structure")({
  component: StructurePage,
});

function StructurePage() {
  const { curriculumId } = Route.useParams();
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a
            href={`/curriculum/${curriculumId}`}
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to curriculum</span>
          </a>
          <div className="flex-1" />
          <img
            src={logo}
            alt=""
            className="h-6 w-6 object-contain opacity-70"
          />
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-10">
        <AuthGate serviceName="Curriculum Import">
          <StructureInner curriculumId={curriculumId} />
        </AuthGate>
      </div>
    </div>
  );
}

function StructureInner({ curriculumId }: { curriculumId: string }) {
  const [structure, setStructure] = useState<CurriculumStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCurriculum({ data: { id: curriculumId } })
      .then((c) => {
        if (!cancelled) setStructure(c.structure);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Couldn't load this curriculum.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [curriculumId]);

  function updateStructure(next: CurriculumStructure) {
    setStructure(next);
    setDirty(true);
  }

  async function handleSave() {
    if (!structure) return;
    setSaving(true);
    try {
      await updateCurriculumStructure({
        data: { id: curriculumId, structure },
      });
      setDirty(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (error || !structure) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        {error}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-xl sm:text-2xl font-semibold"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {structure.programName}
          </h1>
          <p className="text-xs text-muted-foreground">{MIU_FACTS.legalName}</p>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save changes
          </button>
        )}
      </div>

      <Tabs defaultValue="builder">
        <TabsList>
          <TabsTrigger value="builder" className="gap-1.5">
            <ListTree className="h-3.5 w-3.5" /> Builder
          </TabsTrigger>
          <TabsTrigger value="matrix" className="gap-1.5">
            <Table2 className="h-3.5 w-3.5" /> Matrix
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="mt-5">
          <BuilderTab structure={structure} onChange={updateStructure} />
        </TabsContent>
        <TabsContent value="matrix" className="mt-5">
          <MatrixTab structure={structure} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-5">
          <TimelineTab structure={structure} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ========== Builder: drag-and-drop reordering + inline editing ==========

function BuilderTab({
  structure,
  onChange,
}: {
  structure: CurriculumStructure;
  onChange: (s: CurriculumStructure) => void;
}) {
  const slots = useMemo(
    () =>
      structure.years.flatMap((y) =>
        y.semesters.map((s) => ({
          year: y.year,
          semester: s.semester,
          label: `${y.year} — ${s.semester}`,
        })),
      ),
    [structure],
  );
  const [activeSlot, setActiveSlot] = useState(0);
  const slot = slots[activeSlot];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  if (!slot)
    return (
      <p className="text-sm text-muted-foreground">
        This curriculum has no semesters to organize yet.
      </p>
    );

  const yearIdx = structure.years.findIndex((y) => y.year === slot.year);
  const semIdx =
    yearIdx === -1
      ? -1
      : structure.years[yearIdx].semesters.findIndex(
          (s) => s.semester === slot.semester,
        );
  if (yearIdx === -1 || semIdx === -1) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn't find that semester — try selecting another tab.
      </p>
    );
  }
  const units = structure.years[yearIdx].semesters[semIdx].courseUnits;

  function updateUnits(nextUnits: CourseUnit[]) {
    const nextYears = structure.years.map((y, yi) =>
      yi !== yearIdx
        ? y
        : {
            ...y,
            semesters: y.semesters.map((s, si) =>
              si !== semIdx ? s : { ...s, courseUnits: nextUnits },
            ),
          },
    );
    onChange({ ...structure, years: nextYears });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = units.findIndex((u, i) => unitKey(u, i) === active.id);
    const newIndex = units.findIndex((u, i) => unitKey(u, i) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateUnits(arrayMove(units, oldIndex, newIndex));
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {slots.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveSlot(i)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium border transition ${
              i === activeSlot
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-white hover:border-primary/50"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mb-3">
        Drag to reorder course units within this semester. Click a title or
        topic to edit it.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={units.map((u, i) => unitKey(u, i))}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {units.map((unit, i) => (
              <SortableUnitCard
                key={unitKey(unit, i)}
                id={unitKey(unit, i)}
                unit={unit}
                onChange={(next) =>
                  updateUnits(units.map((u, ui) => (ui === i ? next : u)))
                }
                onRemove={() => updateUnits(units.filter((_, ui) => ui !== i))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <button
        onClick={() =>
          updateUnits([
            ...units,
            { code: "", title: "New course unit", topics: ["New topic"] },
          ])
        }
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary transition"
      >
        <Plus className="h-3.5 w-3.5" /> Add course unit
      </button>
    </div>
  );
}

function unitKey(u: CourseUnit, i: number): string {
  return `${u.code || "unit"}-${i}-${u.title.slice(0, 20)}`;
}

function SortableUnitCard({
  id,
  unit,
  onChange,
  onRemove,
}: {
  id: string;
  unit: CourseUnit;
  onChange: (u: CourseUnit) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const [newTopic, setNewTopic] = useState("");

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border bg-white p-3.5 ${isDragging ? "shadow-lg opacity-90 z-10 relative" : ""}`}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-1 text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex gap-2">
            <input
              value={unit.code}
              onChange={(e) => onChange({ ...unit, code: e.target.value })}
              placeholder="Code"
              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              value={unit.title}
              onChange={(e) => onChange({ ...unit, title: e.target.value })}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {unit.topics.map((topic, ti) => (
              <span
                key={ti}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {topic}
                <button
                  onClick={() =>
                    onChange({
                      ...unit,
                      topics: unit.topics.filter((_, i) => i !== ti),
                    })
                  }
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove topic: ${topic}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTopic.trim()) {
                  onChange({
                    ...unit,
                    topics: [...unit.topics, newTopic.trim()],
                  });
                  setNewTopic("");
                }
              }}
              placeholder="+ topic"
              className="w-24 rounded-full border border-dashed px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <button
          onClick={onRemove}
          className="text-muted-foreground/50 hover:text-destructive shrink-0"
          aria-label={`Remove ${unit.title}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ========== Matrix: course units × topics coverage grid ==========
// Built from exactly the fields the schema has (course units and their
// topics) — labeled "coverage matrix" rather than "learning outcomes"
// since the data model doesn't have a distinct learning-outcome object
// per unit yet. See this pass's notes for what a real learning-outcomes
// field would take.

function MatrixTab({ structure }: { structure: CurriculumStructure }) {
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    structure.years.forEach((y) =>
      y.semesters.forEach((s) =>
        s.courseUnits.forEach((u) => u.topics.forEach((t) => set.add(t))),
      ),
    );
    return Array.from(set);
  }, [structure]);

  const rows = useMemo(
    () =>
      structure.years.flatMap((y) =>
        y.semesters.flatMap((s) =>
          s.courseUnits.map((u) => ({
            year: y.year,
            semester: s.semester,
            unit: u,
          })),
        ),
      ),
    [structure],
  );

  if (allTopics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No topics to map yet.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="sticky left-0 bg-muted/40 px-3 py-2 text-left font-semibold whitespace-nowrap">
              Course unit
            </th>
            {allTopics.map((t) => (
              <th
                key={t}
                className="px-2 py-2 font-medium text-muted-foreground whitespace-nowrap"
                style={{ writingMode: "vertical-rl" }}
              >
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
              <td className="sticky left-0 bg-white px-3 py-2 whitespace-nowrap">
                <p className="font-medium">{r.unit.title}</p>
                <p className="text-muted-foreground">
                  {r.year} · {r.semester}
                </p>
              </td>
              {allTopics.map((t) => (
                <td key={t} className="px-2 py-2 text-center">
                  {r.unit.topics.includes(t) && (
                    <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ========== Timeline: chronological map of the whole program ==========

function TimelineTab({ structure }: { structure: CurriculumStructure }) {
  return (
    <div className="space-y-8">
      {structure.years.map((y, yi) => (
        <div key={yi} className="relative pl-6 border-l-2 border-primary/20">
          <div className="absolute -left-[9px] top-0 h-4 w-4 rounded-full bg-primary" />
          <h3
            className="text-sm font-semibold text-primary mb-3"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {y.year}
          </h3>
          <div className="space-y-4">
            {y.semesters.map((s, si) => (
              <div key={si}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  {s.semester}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {s.courseUnits.map((u, ui) => (
                    <span
                      key={ui}
                      className="rounded-md border bg-white px-2.5 py-1 text-xs"
                    >
                      {u.code ? (
                        <span className="font-mono text-muted-foreground mr-1">
                          {u.code}
                        </span>
                      ) : null}
                      {u.title}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
