import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  UploadCloud,
  FileText,
  Loader2,
  GraduationCap,
  ChevronRight,
  AlertTriangle,
  Presentation,
  BookOpen,
} from "lucide-react";
import { uploadCurriculum, listCurricula, type CurriculumSummary } from "@/lib/curriculum.functions";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.jpg";

export const Route = createFileRoute("/curriculum")({
  component: CurriculumPage,
});

const API_KEY_STORAGE_KEY = "miu-slide-studio:gemini-api-key";
const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"];
const MAX_UPLOAD_MB = 4;

function CurriculumPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a href="/" className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </a>
          <div className="flex-1" />
          <a href="/slides" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition">
            <Presentation className="h-3.5 w-3.5" /> Slide Studio
          </a>
          <a href="/notes" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition">
            <BookOpen className="h-3.5 w-3.5" /> Lecture Notes
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center gap-3 mb-1">
          <img src={logo} alt="" className="h-9 w-9 rounded-lg" />
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              Curriculum Import
            </h1>
            <p className="text-xs text-muted-foreground">{MIU_FACTS.legalName}</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground max-w-xl">
          Upload a full program curriculum document — it gets analyzed into its academic hierarchy (program →
          year → semester → course units → topics), then you can generate rigorous, complete lecture notes for
          every topic, one semester at a time.
        </p>

        <div className="mt-6">
          <AuthGate serviceName="Curriculum Import">
            <CurriculumLibrary />
          </AuthGate>
        </div>
      </div>
    </div>
  );
}

function CurriculumLibrary() {
  const [apiKey, setApiKey] = useState("");
  const [configStatus, setConfigStatus] = useState<{ sharedApiKey: boolean } | null>(null);
  const [curricula, setCurricula] = useState<CurriculumSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasApiAccess = !!apiKey.trim() || !!configStatus?.sharedApiKey;

  useEffect(() => {
    try {
      setApiKey(localStorage.getItem(API_KEY_STORAGE_KEY) || "");
    } catch {
      // ignore
    }
    getPublicConfigStatus()
      .then(setConfigStatus)
      .catch(() => setConfigStatus(null));
    refreshList();
  }, []);

  async function refreshList() {
    setLoadingList(true);
    try {
      const result = await listCurricula({ data: { offset: 0, limit: 25 } });
      setCurricula(result.curricula);
    } catch {
      setCurricula([]);
    } finally {
      setLoadingList(false);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // strip the "data:...;base64," prefix
        resolve(result.split(",")[1] ?? "");
      };
      reader.onerror = () => reject(new Error("Couldn't read that file"));
      reader.readAsDataURL(file);
    });
  }

  async function handleFile(file: File) {
    setUploadError(null);

    const ext = "." + (file.name.split(".").pop()?.toLowerCase() ?? "");
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setUploadError("Unsupported file type — please upload a PDF, Word (.docx), or text document.");
      return;
    }
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadError(`That file is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB) — please keep it under ${MAX_UPLOAD_MB}MB.`);
      return;
    }
    if (!hasApiAccess) {
      setUploadError("Add your Gemini API key in Slide Studio first, then come back here.");
      return;
    }

    setUploading(true);
    try {
      const fileBase64 = await fileToBase64(file);
      const result = await uploadCurriculum({
        data: { apiKey, filename: file.name, mimeType: file.type, fileBase64 },
      });
      toast.success(`Extracted "${result.programName}"`);
      window.location.href = `/curriculum/${result.id}`;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't process that document";
      const rateLimitMatch = /^RATE_LIMITED::(\d+)::(.*)$/s.exec(message);
      setUploadError(rateLimitMatch ? rateLimitMatch[2] : message);
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition ${
          dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30 bg-white hover:border-primary/50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        {uploading ? (
          <>
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary mb-3" />
            <p className="text-sm font-medium">Reading and analyzing your document…</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Extracting the program → year → semester → course structure. This can take a moment for large
              documents.
            </p>
          </>
        ) : (
          <>
            <UploadCloud className="mx-auto h-9 w-9 text-primary/60 mb-3" />
            <p className="text-sm font-medium">Drag &amp; drop your curriculum document here</p>
            <p className="mt-1 text-xs text-muted-foreground">or click to browse — PDF, Word (.docx), or text, up to {MAX_UPLOAD_MB}MB</p>
          </>
        )}
      </motion.div>

      {uploadError && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive leading-relaxed">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          {uploadError}
        </p>
      )}

      {!hasApiAccess && !uploadError && (
        <p className="mt-3 text-[11px] text-muted-foreground leading-relaxed">
          Uses the same Gemini API key as Slide Studio — add one there (Settings → API key) and it'll work here
          automatically.
        </p>
      )}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your curricula</h2>
        {loadingList ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : curricula.length === 0 ? (
          <p className="text-sm text-muted-foreground">None uploaded yet — drop a document above to get started.</p>
        ) : (
          <div className="space-y-2">
            {curricula.map((c, i) => (
              <motion.a
                key={c.id}
                href={`/curriculum/${c.id}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3) }}
                className="flex items-center gap-3 rounded-xl border bg-white p-4 hover:border-primary transition"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <GraduationCap className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.programName}</p>
                  <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <FileText className="h-3 w-3" /> {c.sourceFilename} • {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </motion.a>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
