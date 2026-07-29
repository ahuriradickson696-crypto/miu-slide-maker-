import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { z } from "zod";

// ========== Hard-coded login gate ==========
// A single shared username/password for MIU staff so Slide Studio isn't
// wide open to the public. This is intentionally simple (one hard-coded
// pair, no per-person accounts) — rotate these two constants any time you
// want to invalidate access for everyone at once.
const APP_USERNAME = "miu-staff";
const APP_PASSWORD = "MIU-Slides-2026!";

// Private key used to encrypt + sign the session cookie. Must never be sent
// to the browser and must be at least 32 characters. Hard-coded here too —
// change it to force everyone (including anyone with a valid cookie) to log
// in again.
const SESSION_SECRET =
  "miu-slide-studio-session-secret-key-please-change-me-32chars-min";

type AuthSessionData = { authed?: boolean; username?: string };

function authSession() {
  return useSession<AuthSessionData>({
    password: SESSION_SECRET,
    name: "miu-auth",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    cookie: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
  });
}

// ========== Login ==========

const LoginInput = z.object({
  username: z.string(),
  password: z.string(),
});

export const login = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => LoginInput.parse(data))
  .handler(async ({ data }) => {
    const okUser = data.username.trim() === APP_USERNAME;
    const okPass = data.password === APP_PASSWORD;
    if (!okUser || !okPass) {
      throw new Error("Incorrect username or password.");
    }
    const session = await authSession();
    await session.update({ authed: true, username: data.username.trim() });
    return { ok: true, username: data.username.trim() };
  });

// ========== Logout ==========

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const session = await authSession();
  await session.clear();
  return { ok: true };
});

// ========== Check current status (used on page load) ==========

export const getAuthStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const session = await authSession();
    return {
      authed: session.data.authed === true,
      username: session.data.username ?? null,
    };
  },
);

// ========== Middleware ==========
// Attached to every data-touching server function below so that calling
// them directly (bypassing the UI) without a valid session still fails —
// the login gate protects the server, not just the page.
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const session = await authSession();
    if (session.data.authed !== true) {
      throw new Error("Please log in first.");
    }
    return next();
  },
);
