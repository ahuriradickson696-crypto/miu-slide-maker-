import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getSession, updateSession, clearSession, getRequestIP } from "@tanstack/react-start/server";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { randomBytes, createHash } from "node:crypto";
import { ensureSchema, sql } from "@/lib/db";
import { redis } from "@/lib/redis";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "@/lib/password";
import { sendEmail } from "@/lib/email";
import { isSeedAdminEmail } from "@/lib/admin-seed";

// ========== Session config ==========
// TanStack Start's built-in sealed-cookie session (h3/iron-session style).
// SESSION_SECRET must be >= 32 chars — generate one with e.g.
// `openssl rand -base64 32` and set it in Vercel's Environment Variables.
//
// Cookie flags are set explicitly rather than relying on framework
// defaults: httpOnly (no client-side JS access — mitigates XSS token
// theft), secure in production (cookie only sent over HTTPS), sameSite
// "lax" (sent on top-level navigation but not cross-site subrequests —
// standard CSRF mitigation for session cookies). `secure` is relaxed to
// false outside production so local `http://localhost` dev still works;
// Vercel's Production/Preview environments are always HTTPS.
function sessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error(
      "SESSION_SECRET is not set (or is shorter than 32 characters). Add one in Vercel's Environment Variables — generate with `openssl rand -base64 32`.",
    );
  }
  return {
    password,
    name: "miu_session",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  picture: string;
};

export const readSessionUser = createServerOnlyFn(async (): Promise<SessionUser | null> => {
  const session = await getSession<SessionUser>(sessionConfig());
  if (!session.data?.id) return null;
  return {
    id: session.data.id,
    email: session.data.email ?? "",
    name: session.data.name ?? "",
    picture: session.data.picture ?? "",
  };
});

// ========== Google Sign-In ==========
// Client-side flow (Google Identity Services "Sign In With Google" button)
// hands us a signed ID token JWT. Verified server-side by checking the
// JWT's signature locally against Google's published JWKS — this is
// Google's documented production-grade verification method (the
// alternative, hitting the /tokeninfo endpoint, is explicitly marked
// "for debugging only" in Google's own docs and is rate-limited).
// createRemoteJWKSet caches the JWKS and handles key rotation
// automatically, so this is also a local, fast check with no per-request
// round trip to Google after the first fetch.

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const GoogleSignInInput = z.object({ credential: z.string().min(10) });

export const googleSignIn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GoogleSignInInput.parse(data))
  .handler(async ({ data }) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "GOOGLE_CLIENT_ID is not set on the server. Add it in Vercel's Environment Variables (see DEPLOYMENT.md).",
      );
    }

    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(data.credential, GOOGLE_JWKS, {
        issuer: GOOGLE_ISSUERS,
        audience: clientId,
      });
      payload = result.payload;
    } catch (err) {
      // Covers: bad signature, expired token, wrong audience/issuer, or
      // malformed JWT — all treated the same way client-side (try again).
      throw new Error("Google rejected that sign-in token. Please try again.");
    }

    const sub = payload.sub as string | undefined;
    const email = payload.email as string | undefined;
    const emailVerified = payload.email_verified as boolean | undefined;
    const name = (payload.name as string | undefined) ?? "";
    const picture = (payload.picture as string | undefined) ?? "";
    const hd = payload.hd as string | undefined;

    if (!sub || !email || !emailVerified) {
      throw new Error("Your Google email isn't verified — sign in with a verified Google account.");
    }
    const allowedDomain = process.env.GOOGLE_HOSTED_DOMAIN;
    if (allowedDomain && hd !== allowedDomain) {
      throw new Error(`Sign-in is restricted to @${allowedDomain} accounts.`);
    }

    await ensureSchema();
    const db = sql();
    // Match by google_sub first, then by email — a person may already have
    // a password-based account under this email; Google sign-in should
    // link to that same row rather than creating a duplicate account.
    const [existing] = await db`
      SELECT id FROM users WHERE google_sub = ${sub} OR lower(email) = lower(${email}) LIMIT 1
    `;
    let row: any;
    if (existing) {
      [row] = await db`
        UPDATE users SET
          google_sub = ${sub},
          email = ${email},
          name = ${name || ""},
          picture = ${picture || ""},
          email_verified = true,
          last_login_at = now()
        WHERE id = ${existing.id}
        RETURNING id, email, name, picture
      `;
    } else {
      [row] = await db`
        INSERT INTO users (google_sub, email, name, picture, email_verified, last_login_at)
        VALUES (${sub}, ${email}, ${name || ""}, ${picture || ""}, true, now())
        RETURNING id, email, name, picture
      `;
    }

    const user: SessionUser = {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      picture: row.picture as string,
    };

    await updateSession(sessionConfig(), user);
    await seedAdminFromEnv(user.id, user.email);
    return user;
  });

// ========== Rate limiting ==========
// Shared by every auth endpoint below — signup, sign-in, and password
// reset requests are all classic brute-force/abuse targets. Uses Redis
// (shared across serverless instances) when configured; falls back to an
// in-memory, best-effort, single-instance limiter otherwise, so brute-force
// protection still exists even without Redis set up, just weaker.
const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  const rdb = redis();
  if (rdb) {
    try {
      const bucketKey = `ratelimit:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
      const count = await rdb.incr(bucketKey);
      if (count === 1) await rdb.expire(bucketKey, windowSeconds);
      return { limited: count > max, retryAfterSeconds: windowSeconds };
    } catch {
      // fall through to in-memory below on Redis hiccups
    }
  }
  const now = Date.now();
  const entry = memoryRateLimits.get(key);
  if (!entry || entry.resetAt < now) {
    memoryRateLimits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { limited: false, retryAfterSeconds: windowSeconds };
  }
  entry.count++;
  return {
    limited: entry.count > max,
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ========== Email/password authentication ==========
// A standard signup/sign-in/forgot-password flow alongside Google Sign-In.
// Security choices, explicitly:
// - Passwords hashed with scrypt (src/lib/password.ts), never stored or
//   logged in plaintext.
// - Sign-in and password-reset-request responses are intentionally
//   generic ("invalid email or password", "if an account exists...") so
//   neither endpoint can be used to enumerate registered emails.
// - Reset tokens are cryptographically random, single-use, short-lived
//   (1 hour), and stored as a SHA-256 hash (not the raw token) — even a
//   full database read can't be used to reset someone's password.
// - Every endpoint here is rate-limited per email+IP (or IP alone for
//   signup) to slow down brute-force and email-bombing attempts.
// - Requires both DATABASE_URL and SESSION_SECRET — password accounts
//   can't exist without persistent storage and a session mechanism.

function requirePasswordAuthConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Email/password sign-in isn't configured on this deployment yet.");
  }
}

const SignUpInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().trim().max(200).optional().default(""),
});

export const signUpWithPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SignUpInput.parse(data))
  .handler(async ({ data }) => {
    requirePasswordAuthConfigured();
    const email = normalizeEmail(data.email);
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";

    const limit = await rateLimit(`signup:${ip}`, 8, 60 * 15);
    if (limit.limited) {
      throw new Error(`Too many attempts. Please wait a few minutes and try again.`);
    }

    const policyError = validatePasswordPolicy(data.password);
    if (policyError) throw new Error(policyError);

    await ensureSchema();
    const db = sql();
    const [existing] = await db`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
    if (existing) {
      throw new Error(
        "An account with this email already exists. Try signing in, or use \"Forgot password\" if you don't remember your password.",
      );
    }

    const passwordHash = await hashPassword(data.password);
    const [row] = await db`
      INSERT INTO users (email, name, password_hash, email_verified, last_login_at)
      VALUES (${email}, ${data.name}, ${passwordHash}, false, now())
      RETURNING id, email, name, picture
    `;

    const user: SessionUser = {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      picture: row.picture as string,
    };
    await updateSession(sessionConfig(), user);
    await seedAdminFromEnv(user.id, user.email);
    return user;
  });

const SignInInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signInWithPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SignInInput.parse(data))
  .handler(async ({ data }) => {
    requirePasswordAuthConfigured();
    const email = normalizeEmail(data.email);
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";

    const limit = await rateLimit(`signin:${email}:${ip}`, 8, 60 * 15);
    if (limit.limited) {
      throw new Error("Too many attempts. Please wait a few minutes and try again.");
    }

    await ensureSchema();
    const db = sql();
    const [row] = await db`
      SELECT id, email, name, picture, password_hash FROM users WHERE lower(email) = ${email} LIMIT 1
    `;

    // Same generic error whether the email doesn't exist, the account has
    // no password (Google-only), or the password is simply wrong — never
    // reveal which case it was.
    const genericError = "Invalid email or password.";
    if (!row || !row.password_hash) {
      throw new Error(genericError);
    }
    const valid = await verifyPassword(data.password, row.password_hash as string);
    if (!valid) {
      throw new Error(genericError);
    }

    await db`UPDATE users SET last_login_at = now() WHERE id = ${row.id}`;

    const user: SessionUser = {
      id: row.id as string,
      email: row.email as string,
      name: row.name as string,
      picture: row.picture as string,
    };
    await updateSession(sessionConfig(), user);
    await seedAdminFromEnv(user.id, user.email);
    return user;
  });

const RESET_TOKEN_TTL_MINUTES = 60;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const RequestPasswordResetInput = z.object({ email: z.string().email() });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => RequestPasswordResetInput.parse(data))
  .handler(async ({ data }) => {
    requirePasswordAuthConfigured();
    const email = normalizeEmail(data.email);
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";

    // Rate limit by email (stops bombing one inbox with reset emails) AND
    // by IP (stops one client from spraying requests across many emails).
    const [byEmail, byIp] = await Promise.all([
      rateLimit(`reset:email:${email}`, 3, 60 * 15),
      rateLimit(`reset:ip:${ip}`, 15, 60 * 15),
    ]);

    // Always the same response — this function must not reveal whether
    // the email is registered, rate-limited, or anything else.
    const genericResponse = {
      message: "If an account exists for that email, we've sent a password reset link.",
    };
    if (byEmail.limited || byIp.limited) {
      return genericResponse;
    }

    await ensureSchema();
    const db = sql();
    const [row] = await db`SELECT id, name FROM users WHERE lower(email) = ${email} LIMIT 1`;
    if (!row) {
      return genericResponse; // don't reveal non-existence
    }

    // Invalidate any still-live tokens before issuing a new one — keeps at
    // most one valid reset link outstanding per account at a time.
    await db`
      UPDATE password_reset_tokens SET used_at = now()
      WHERE user_id = ${row.id} AND used_at IS NULL AND expires_at > now()
    `;

    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await db`
      INSERT INTO password_reset_tokens (user_id, token_hash, purpose, expires_at)
      VALUES (${row.id}, ${tokenHash}, 'reset', ${expiresAt.toISOString()})
    `;

    // APP_URL should be the deployment's canonical origin (e.g.
    // https://your-app.vercel.app) — see DEPLOYMENT.md. Falls back to a
    // relative link if unset, which won't work from an email client but
    // at least won't crash the request.
    const origin = (process.env.APP_URL || "").replace(/\/$/, "");
    const resetLink = `${origin}/reset-password?token=${rawToken}`;

    await sendEmail({
      to: email,
      subject: "Reset your MIU Slide Studio password",
      text: `Hi${row.name ? ` ${row.name}` : ""},\n\nSomeone (hopefully you) requested a password reset for your MIU Slide Studio account.\n\nReset your password: ${resetLink}\n\nThis link expires in ${RESET_TOKEN_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore this email — your password won't change.`,
      html: `<p>Hi${row.name ? ` ${row.name}` : ""},</p><p>Someone (hopefully you) requested a password reset for your MIU Slide Studio account.</p><p><a href="${resetLink}">Reset your password</a></p><p>This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
    });

    return genericResponse;
  });

const ResetPasswordInput = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(1),
});

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ResetPasswordInput.parse(data))
  .handler(async ({ data }) => {
    requirePasswordAuthConfigured();
    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const limit = await rateLimit(`reset-confirm:${ip}`, 10, 60 * 15);
    if (limit.limited) {
      throw new Error("Too many attempts. Please wait a few minutes and try again.");
    }

    const policyError = validatePasswordPolicy(data.newPassword);
    if (policyError) throw new Error(policyError);

    await ensureSchema();
    const db = sql();
    const tokenHash = hashToken(data.token);
    const [row] = await db`
      SELECT user_id FROM password_reset_tokens
      WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > now()
      LIMIT 1
    `;
    if (!row) {
      throw new Error("This reset link is invalid or has expired. Please request a new one.");
    }

    const passwordHash = await hashPassword(data.newPassword);
    await db`UPDATE users SET password_hash = ${passwordHash}, email_verified = true WHERE id = ${row.user_id}`;
    await db`UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = ${tokenHash}`;

    const [userRow] = await db`SELECT id, email, name, picture FROM users WHERE id = ${row.user_id}`;
    const user: SessionUser = {
      id: userRow.id as string,
      email: userRow.email as string,
      name: userRow.name as string,
      picture: userRow.picture as string,
    };
    // Sign them in immediately — standard UX for a successful reset, and
    // saves an extra manual sign-in step right after they just proved
    // control of the account via the emailed link.
    await updateSession(sessionConfig(), user);
    await seedAdminFromEnv(user.id, user.email);
    return user;
  });

const ChangePasswordInput = z.object({
  currentPassword: z.string().optional().default(""),
  newPassword: z.string().min(1),
});

// For a signed-in user to set/change their password — including a
// Google-only account adding a password for the first time (no
// currentPassword required in that case, since there isn't one yet).
export const changePassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ChangePasswordInput.parse(data))
  .handler(async ({ data }) => {
    requirePasswordAuthConfigured();
    const sessionUser = await readSessionUser();
    if (!sessionUser) throw new Error("You need to be signed in to do that.");

    const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
    const limit = await rateLimit(`changepw:${sessionUser.id}:${ip}`, 8, 60 * 15);
    if (limit.limited) {
      throw new Error("Too many attempts. Please wait a few minutes and try again.");
    }

    const policyError = validatePasswordPolicy(data.newPassword);
    if (policyError) throw new Error(policyError);

    await ensureSchema();
    const db = sql();
    const [row] = await db`SELECT password_hash FROM users WHERE id = ${sessionUser.id}`;
    if (row?.password_hash) {
      const valid = await verifyPassword(data.currentPassword, row.password_hash as string);
      if (!valid) throw new Error("Current password is incorrect.");
    }

    const passwordHash = await hashPassword(data.newPassword);
    await db`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${sessionUser.id}`;
    return { ok: true };
  });

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return await readSessionUser();
  } catch {
    // SESSION_SECRET missing, etc. — treat as signed out rather than
    // breaking every page load that checks auth state.
    return null;
  }
});

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await clearSession(sessionConfig());
  return { ok: true };
});

// (imported isSeedAdminEmail used directly below)

// Called after every successful sign-in. If this email is the hardcoded
// admin or listed in ADMIN_EMAILS, promotes them in the database
// (idempotent — a no-op once already true). This makes seeding purely a
// bootstrap mechanism: after someone's first login, admin status lives in
// the database and can be managed from the admin panel without redeploying.
async function seedAdminFromEnv(userId: string, email: string): Promise<void> {
  if (!isSeedAdminEmail(email)) return;
  try {
    const db = sql();
    await db`UPDATE users SET is_admin = true WHERE id = ${userId} AND is_admin = false`;
  } catch {
    // best-effort — a failed seed shouldn't break sign-in
  }
}

// Boolean-only check so the client can decide whether to show the admin
// link at all — never exposes the admin email list itself to the client.
export const checkIsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const user = await readSessionUser();
  if (!user) return false;
  try {
    await ensureSchema();
    const db = sql();
    const [row] = await db`SELECT is_admin FROM users WHERE id = ${user.id}`;
    if (row?.is_admin) return true;
  } catch {
    // fall through to the seed check below
  }
  // Covers accounts that predate the is_admin column/seeding, or a
  // misconfigured deployment where the seed update above failed silently.
  return isSeedAdminEmail(user.email);
});


