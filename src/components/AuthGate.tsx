import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import { Loader2, Mail, KeyRound, User as UserIcon, AlertTriangle, CheckCircle2, ArrowLeft } from "lucide-react";
import {
  getCurrentUser,
  googleSignIn,
  signInWithPassword,
  signUpWithPassword,
  requestPasswordReset,
  type SessionUser,
} from "@/lib/auth.functions";
import { MIU_FACTS } from "@/lib/miu-facts";
import logo from "@/assets/miu-logo.png";

type Mode = "signin" | "signup" | "forgot";

export function AuthGate({
  children,
  serviceName,
  onAuthChange,
}: {
  children: ReactNode;
  /** e.g. "Slide Studio", "the Notes library" — used in the gate copy. */
  serviceName: string;
  /** Fires once on initial load, and again whenever sign-in succeeds — lets a parent page (e.g. a header showing the signed-in avatar) stay in sync without its own separate fetch. */
  onAuthChange?: (user: SessionUser | null) => void;
}) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        onAuthChange?.(u);
      })
      .catch(() => {
        setUser(null);
        onAuthChange?.(null);
      })
      .finally(() => setChecked(true));
    // Only run once on mount — onAuthChange is a callback, not a dependency we want to re-trigger on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSignedIn(u: SessionUser) {
    setUser(u);
    onAuthChange?.(u);
  }

  if (!checked) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <SignInRequired serviceName={serviceName} onSignedIn={handleSignedIn} />;
  }

  return <>{children}</>;
}

function SignInRequired({
  serviceName,
  onSignedIn,
}: {
  serviceName: string;
  onSignedIn: (user: SessionUser) => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);

  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  async function handleGoogleCredential(response: { credential: string }) {
    try {
      const user = await googleSignIn({ data: { credential: response.credential } });
      toast.success(`Signed in as ${user.email}`);
      onSignedIn(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    }
  }

  useEffect(() => {
    if (!googleClientId) return;
    const w = window as any;

    function render() {
      if (!w.google?.accounts?.id || !googleButtonRef.current) return;
      w.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCredential });
      w.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "filled_white",
        size: "large",
        shape: "pill",
        text: "signin_with",
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
  }, [googleClientId]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setForgotSent(false);
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await signInWithPassword({ data: { email, password } });
      toast.success(`Signed in as ${user.email}`);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!consentChecked) {
      setError("Please agree to the Privacy Policy and Terms of Use to create an account.");
      return;
    }
    setSubmitting(true);
    try {
      const user = await signUpWithPassword({ data: { name, email, password } });
      toast.success(`Account created — welcome, ${user.name || user.email}`);
      onSignedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create account");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await requestPasswordReset({ data: { email } });
      setForgotSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-10">
      <Toaster richColors position="top-center" />
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm rounded-2xl border bg-white p-6 shadow-lg"
      >
        <div className="flex flex-col items-center text-center mb-5">
          <img src={logo} alt="" className="h-12 w-12 object-contain mb-3" />
          <h1 className="text-lg font-semibold">Sign in to continue</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {MIU_FACTS.legalName} — {serviceName} requires an account.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {mode === "forgot" ? (
            <motion.div key="forgot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {forgotSent ? (
                <div className="rounded-lg border bg-primary/5 p-4 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-primary mb-2" />
                  <p className="text-sm font-medium">Check your email</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    If an account exists for that address, a reset link is on its way.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleForgot} className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Mail className="h-3.5 w-3.5 text-primary/70" /> Email
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                  {error && <ErrorNote message={error} />}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 transition"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
                  </button>
                </form>
              )}
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
              </button>
            </motion.div>
          ) : (
            <motion.div key={mode} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <form onSubmit={mode === "signup" ? handleSignUp : handleSignIn} className="space-y-3">
                {mode === "signup" && (
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <UserIcon className="h-3.5 w-3.5 text-primary/70" /> Name
                    </span>
                    <input
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                )}
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Mail className="h-3.5 w-3.5 text-primary/70" /> Email
                  </span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5 text-primary/70" /> Password
                  </span>
                  <input
                    type="password"
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                {mode === "signup" && (
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <KeyRound className="h-3.5 w-3.5 text-primary/70" /> Confirm password
                    </span>
                    <input
                      type="password"
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                )}

                {mode === "signup" && (
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      required
                      checked={consentChecked}
                      onChange={(e) => setConsentChecked(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-muted-foreground/40"
                    />
                    <span>
                      I agree to MIU Studio's{" "}
                      <a href="/privacy-policy" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Privacy Policy
                      </a>{" "}
                      and{" "}
                      <a href="/terms" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                        Terms of Use
                      </a>
                      .
                    </span>
                  </label>
                )}

                {mode === "signin" && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                {error && <ErrorNote message={error} />}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md hover:shadow-lg disabled:opacity-60 transition-shadow"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "signup" ? (
                    "Create account"
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>

              {googleClientId && (
                <>
                  <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                  </div>
                  <div className="flex justify-center">
                    <div ref={googleButtonRef} />
                  </div>
                  <p className="mt-2 text-center text-[10px] text-muted-foreground">
                    Continuing with Google means you agree to our{" "}
                    <a href="/privacy-policy" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      Privacy Policy
                    </a>{" "}
                    and{" "}
                    <a href="/terms" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      Terms of Use
                    </a>
                    .
                  </p>
                </>
              )}

              <p className="mt-4 text-center text-xs text-muted-foreground">
                {mode === "signup" ? (
                  <>
                    Already have an account?{" "}
                    <button type="button" onClick={() => switchMode("signin")} className="font-medium text-primary hover:underline">
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    New here?{" "}
                    <button type="button" onClick={() => switchMode("signup")} className="font-medium text-primary hover:underline">
                      Create an account
                    </button>
                  </>
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive leading-relaxed">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      {message}
    </p>
  );
}
