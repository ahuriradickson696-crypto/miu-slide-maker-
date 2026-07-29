import { createServerFn, createMiddleware } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ensureSchema, sql } from "@/lib/db";

// ========== Real, database-backed login ==========
// Every account is its own row in the `users` table (see src/lib/db.ts).
// Passwords are never stored in plain text — each one is salted with a
// random 16-byte value and hashed with scrypt (Node's built-in, no extra
// dependency needed) before it ever touches the database. Logging in
// re-hashes the submitted password with the stored salt and compares the
// two hashes with a timing-safe check.
//
// Sign-up is open — anyone can create their own account, no invite code
// needed.

// Private key used to encrypt + sign the session cookie. Must never be sent
// to the browser and must be at least 32 characters.
//
// Not hardcoded: read from the SESSION_SECRET environment variable (set it
// in Vercel: Project Settings -> Environment Variables -> SESSION_SECRET,
// same place as DATABASE_URL — see DEPLOYMENT.md). Changing that value logs
// everyone out at once, including anyone with a valid cookie.
//
// If it isn't set, a random one is generated in memory automatically so the
// app still works with zero setup — the only trade-off is that everyone
// gets logged out whenever the server restarts/redeploys, since a fresh
// random secret is generated each time. Set the env var to avoid that.
let generatedSessionSecret: string | null = null;

function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (!generatedSessionSecret) {
    generatedSessionSecret = randomBytes(32).toString("hex");
  }
  return generatedSessionSecret;
}

const SCRYPT_KEYLEN = 64;

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

type AuthSessionData = { authed?: boolean; username?: string };

function authSession() {
  return useSession<AuthSessionData>({
    password: getSessionSecret(),
    name: "miu-auth",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    cookie: { httpOnly: true, sameSite: "lax", secure: true, path: "/" },
  });
}

// ========== Sign up (create a real account, open to anyone) ==========

const SignupInput = z.object({
  username: z
    .string()
    .trim()
    .min(3, "Username must be at least 3 characters.")
    .max(40, "Username must be under 40 characters.")
    .regex(/^[a-zA-Z0-9._-]+$/, "Use only letters, numbers, dots, dashes, or underscores."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export const signup = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SignupInput.parse(data))
  .handler(async ({ data }) => {
    await ensureSchema();
    const db = sql();

    const existing = await db`
      SELECT id FROM users WHERE username = ${data.username}
    `;
    if (existing.length > 0) {
      throw new Error("That username is already taken.");
    }

    const salt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(data.password, salt);

    await db`
      INSERT INTO users (username, password_hash, password_salt)
      VALUES (${data.username}, ${passwordHash}, ${salt})
    `;

    const session = await authSession();
    await session.update({ authed: true, username: data.username });
    return { ok: true, username: data.username };
  });

// ========== Login ==========

const LoginInput = z.object({
  username: z.string(),
  password: z.string(),
});

export const login = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => LoginInput.parse(data))
  .handler(async ({ data }) => {
    const username = data.username.trim();

    await ensureSchema();
    const db = sql();
    const rows = await db`
      SELECT username, password_hash, password_salt FROM users WHERE username = ${username}
    `;

    // Same generic error whether the username doesn't exist or the password
    // is wrong — never reveal which one it was.
    if (rows.length === 0) {
      throw new Error("Incorrect username or password.");
    }
    const user = rows[0] as { username: string; password_hash: string; password_salt: string };
    const ok = verifyPassword(data.password, user.password_salt, user.password_hash);
    if (!ok) {
      throw new Error("Incorrect username or password.");
    }

    const session = await authSession();
    await session.update({ authed: true, username: user.username });
    return { ok: true, username: user.username };
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
// Attached to every data-touching server function so that calling them
// directly (bypassing the UI) without a valid session still fails — the
// login gate protects the server, not just the page. No service (deck
// generation, saving, history, export data) is reachable without a real,
// logged-in account.
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const session = await authSession();
    if (session.data.authed !== true) {
      throw new Error("Please log in first.");
    }
    return next();
  },
);
