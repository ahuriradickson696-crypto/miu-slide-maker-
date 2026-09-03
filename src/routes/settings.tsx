import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  KeyRound,
  CheckCircle2,
  ExternalLink,
  Trash2,
  Loader2,
} from "lucide-react";
import { readStoredApiKey, writeStoredApiKey } from "@/lib/api-key-storage";
import { getPublicConfigStatus } from "@/lib/config-status.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import { AuthGate } from "@/components/AuthGate";
import logo from "@/assets/miu-logo.png";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="min-h-screen bg-[#F7F8F5]">
      <Toaster richColors position="top-center" />
      <div className="border-b bg-white/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-3 flex items-center gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-muted-foreground hover:text-primary transition"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Home</span>
          </a>
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-center gap-3 mb-1">
          <img src={logo} alt="" className="h-9 w-9 object-contain" />
          <div>
            <h1
              className="text-xl sm:text-2xl font-semibold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Settings
            </h1>
            <p className="text-xs text-muted-foreground">
              {MIU_FACTS.legalName}
            </p>
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground max-w-lg">
          Manage the API key that powers AI generation across every tool here —
          Slide Studio, Quiz, Notes, and Curriculum. Set it once and it applies
          everywhere.
        </p>
        <div className="mt-6">
          <AuthGate serviceName="Settings">
            <ApiKeySection />
          </AuthGate>
        </div>
      </div>
    </div>
  );
}

function ApiKeySection() {
  const [key, setKey] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [sharedKeyAvailable, setSharedKeyAvailable] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    const existing = readStoredApiKey();
    setKey(existing);
    setSavedKey(existing);
    getPublicConfigStatus()
      .then((s) => setSharedKeyAvailable(s.sharedApiKey))
      .catch(() => setSharedKeyAvailable(null));
  }, []);

  function handleSave() {
    writeStoredApiKey(key);
    setSavedKey(key.trim());
    toast.success(key.trim() ? "API key saved" : "API key cleared");
  }

  function handleClear() {
    setKey("");
    writeStoredApiKey("");
    setSavedKey("");
    toast.success("API key cleared");
  }

  const dirty = key.trim() !== savedKey;

  return (
    <div className="rounded-xl border bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="h-4 w-4 text-primary" />
        <label className="text-sm font-medium">Your API key</label>
        {savedKey && !dirty && (
          <span className="inline-flex items-center gap-1 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved on this device
          </span>
        )}
      </div>

      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Paste your API key here"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        autoComplete="off"
        spellCheck={false}
      />

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty}
          className="rounded-md bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          Save
        </button>
        {savedKey && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-destructive/50 hover:text-destructive transition"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="mt-5 pt-4 border-t space-y-2 text-xs text-muted-foreground">
        <p>
          Your key is stored only in this browser — it's never saved on our
          servers.
        </p>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2 font-medium"
        >
          Get a free API key <ExternalLink className="h-3 w-3" />
        </a>
        {sharedKeyAvailable === null ? (
          <p className="flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking for a shared
            key…
          </p>
        ) : sharedKeyAvailable ? (
          <p>
            A shared key is also available for this deployment, so generation
            works even without one of your own.
          </p>
        ) : null}
      </div>
    </div>
  );
}
