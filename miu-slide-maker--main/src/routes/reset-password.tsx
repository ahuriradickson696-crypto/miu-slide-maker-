import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { z } from "zod";
import { CheckCircle2, KeyRound, Loader2, AlertTriangle, ArrowLeft } from "lucide-react";
import { resetPassword } from "@/lib/auth.functions";
import logo from "@/assets/miu-logo.jpg";

const searchSchema = z.object({
  token: z.string().optional().default(""),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search) => searchSchema.parse(search),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("This reset link is missing its token — please use the exact link from your email.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword({ data: { token, newPassword: password } });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-2xl border bg-card p-6 slide-shadow"
      >
        <div className="flex flex-col items-center text-center mb-5">
          <img src={logo} alt="" className="h-12 w-12 rounded-xl mb-3" />
          <h1 className="text-lg font-semibold">Reset your password</h1>
          <p className="text-xs text-muted-foreground mt-1">Metropolitan International University — Slide Studio</p>
        </div>

        {!token ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-destructive mb-2" />
            <p className="text-sm font-medium">Invalid reset link</p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              This link is missing its token. Please open the exact link from your password reset email, or
              request a new one.
            </p>
            <a href="/" className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Home
            </a>
          </div>
        ) : done ? (
          <div className="rounded-lg border bg-primary/5 p-4 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-primary mb-2" />
            <p className="text-sm font-medium">Password updated</p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              You're signed in with your new password.
            </p>
            <a
              href="/"
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
            >
              Go to MIU Studio
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5 text-primary/70" /> New password
              </span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
              />
              <span className="mt-1 block text-[10px] text-muted-foreground">At least 8 characters.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5 text-primary/70" /> Confirm new password
              </span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary/40"
              />
            </label>

            {error && (
              <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive leading-relaxed">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {error}
              </p>
            )}

            <motion.button
              type="submit"
              disabled={submitting}
              whileTap={{ scale: 0.97 }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set new password"}
            </motion.button>

            <p className="text-center text-xs text-muted-foreground">
              <a href="/" className="font-medium text-primary hover:underline">
                Back to Home
              </a>
            </p>
          </form>
        )}
      </motion.div>
    </div>
  );
}
