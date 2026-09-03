# Deploying MIU Slide Studio to GitHub + Vercel

## App structure
This is a small suite of pages sharing one deployment and one database:

| Route | What it is |
|---|---|
| `/` | Home — MIU-branded hub linking to each module |
| `/slides` | Slide Studio — the AI slide-deck generator (this used to live at `/`) |
| `/notes` | Lecture Notes library — every lecture-notes document you've generated |
| `/lecture-notes/:deckId` | A single lecture-notes document, generated from a specific deck |
| `/curriculum` | Curriculum Import — upload a full program curriculum document (PDF/DOCX/TXT) to extract its academic hierarchy |
| `/curriculum/:curriculumId` | A single curriculum's outline, with per-semester detailed topic notes generated on demand |
| `/admin` | Admin control center — usage stats, user management, moderation, system/API status |
| `/reset-password` | Destination for emailed password-reset links |

Each module has its own dedicated database table(s) (`decks`/`slides` for Slide Studio, `lecture_notes` for Lecture Notes, `curricula`/`curriculum_semester_notes` for Curriculum Import) rather than sharing a generic table — as more modules are added later (quizzes, flashcards, etc.), each gets its own table too.

**Curriculum Import upload limit:** documents are capped at 4MB (a TanStack Start server function's request body size). PDF and DOCX text is extracted server-side (via `unpdf` and `mammoth`); scanned/image-only PDFs aren't supported since there's no OCR. Very large documents have their extracted text truncated at ~200,000 characters before being sent to the AI provider for structure extraction.

## 1. Get a Groq API key
1. Go to https://console.groq.com/keys
2. Sign in and click **Create API Key** (free tier, no card needed — 30 requests/minute, 14,400/day as of 2026)
3. Copy the key — you'll paste it into Vercel, not into any file

By default, each person pastes their own key into the app (stored only in their browser). If you'd rather offer the tool without requiring that, set `GROQ_API_KEY` as a Vercel environment variable (Production/Preview/Development) — the app falls back to this shared key automatically whenever someone hasn't pasted their own. Their own key, if entered, always takes priority (so it counts against their personal quota, not the shared one). The admin panel's System tab shows whether a shared key is configured, without ever displaying its value.

**Optional: DeepSeek fallback.** If Groq is rate-limited or erroring on both its models (`openai/gpt-oss-120b` then `openai/gpt-oss-20b`), generation just fails by default. Set `DEEPSEEK_API_KEY` (get one at https://platform.deepseek.com) and the app automatically retries via DeepSeek (`deepseek-chat`) before giving up — same generic error message either way if that also fails too. DeepSeek's JSON mode doesn't enforce a strict schema the way a typed schema would, so its output goes through the same validation/clamping every AI response already gets, rather than being trusted directly. This is purely a resilience fallback, not a quality upgrade — Groq is always tried first. The full chain, in order: Groq (2 models) → DeepSeek → give up.

⚠️ As with the Groq key, never commit a real DeepSeek key to Git — set it only in Vercel's Environment Variables.

⚠️ **Never commit your real key to Git.** `.env` is already in `.gitignore`.

## 2. Push to GitHub
```bash
cd slide-magic-ai-12-main
git init
git add .
git commit -m "Initial commit"
gh repo create your-repo-name --private --source=. --push
# or manually: create the repo on github.com, then
# git remote add origin https://github.com/<you>/<repo>.git
# git push -u origin main
```

## 3. Import into Vercel
1. Go to https://vercel.com/new and import your GitHub repo
2. Vercel auto-detects **TanStack Start** (via `vercel.json` + the `nitro()` Vite plugin) — no build command changes needed
3. Before deploying, open **Project Settings → Environment Variables** and add:
   | Key | Value | Environments |
   |---|---|---|
   | `GROQ_API_KEY` | *your key from step 1* | Production, Preview, Development |
   | `DATABASE_URL` | *your Neon Postgres connection string, see below* | Production, Preview, Development |
4. Click **Deploy**

## 3b. Set up the Neon database (deck history)

Saved decks (the History panel) are stored in Postgres via [Neon](https://neon.tech). This is optional — if `DATABASE_URL` isn't set, deck generation and download still work, decks just won't be saved.

1. Go to https://neon.tech and create a free project (or, easier: in Vercel, **Storage → Create Database → Neon Postgres**, which sets `DATABASE_URL` for you automatically)
2. If you created the Neon project outside Vercel, copy the connection string from the Neon dashboard (starts with `postgres://...`) and paste it as `DATABASE_URL` in step 3 above
3. No manual migration needed — the app creates its own `decks` and `slides` tables automatically the first time it runs (see `src/lib/db.ts`)

## 4. Verify
- Open the deployed URL
- Try generating a deck — this calls `generateDeck`, which reads `process.env.GROQ_API_KEY` **server-side only** (it's never sent to the browser)
- If you see "Missing GROQ_API_KEY", double check the env var is set for the right environment and redeploy
- Click **History** in the header — the deck you just generated should appear there. If it's empty and the deck generated fine, double-check `DATABASE_URL` is set

## Local development
```bash
npm install       # or bun install
cp .env.example .env
# paste your key into .env
npm run dev        # or bun run dev
```

## Troubleshooting a 404 (`NOT_FOUND`) after deploying

This almost always means Vercel's build didn't produce output in the shape Vercel Functions expects — usually because the Nitro preset wasn't pinned to `vercel`. This project's `vite.config.ts` now sets `nitro({ preset: "vercel" })` explicitly, which fixes it in the vast majority of cases.

If you already deployed before this fix, or still see a 404 after redeploying:
1. **Push the latest code and redeploy** — Vercel doesn't rebuild automatically for old commits.
2. In the Vercel dashboard → **Settings → General → Build & Development Settings**, confirm:
   - Framework Preset: **TanStack Start** (or "Other" is fine too, as long as build/output aren't manually overridden)
   - Build Command / Output Directory: leave **empty/default** — don't hardcode these, Nitro's `vercel` preset manages its own output shape
3. Check **Deployments → [latest] → Building** logs for errors during the build step (a silent 404 with a *successful* build almost always points back to the preset issue above).
4. Redeploy with **"Redeploy"** (not just revisit the old deployment URL — old deployments don't pick up new commits).

## Keeping the key safe
- The key is read via `process.env.GROQ_API_KEY` inside server functions (`src/lib/slides.functions.ts`), which only run on the server — it's never bundled into client-side JS.
- `.gitignore` excludes `.env`, `.env.local`, and `.vercel` so secrets can't be committed by accident.
- If a key is ever exposed (e.g. pasted in chat, committed by mistake, shared in a screenshot), revoke it immediately at https://console.groq.com/keys and generate a new one.

## 5. Optional: accounts (Google Sign-In + email/password, personal history)

Without this, the app works exactly as before — anyone can generate and download decks, but History is empty for everyone (decks aren't tied to an account). Setting this up enables both Google Sign-In and a standard email/password sign-in (with forgot/reset password), makes History and the Lecture Notes library personal per account, and unlocks `/admin` — a full control center with usage stats, user management (promote/revoke admins), and moderation tools for any deck or lecture-notes document.

Both sign-in methods share the same account — signing in with Google using the same email as an existing password account (or vice versa) links to the same user rather than creating a duplicate.

### 5a. Core accounts setup (required for either sign-in method)
| Key | Value | Notes |
|---|---|---|
| `SESSION_SECRET` | *random string, 32+ chars* | Generate with `openssl rand -base64 32`. Signs the session cookie — keep it secret, and don't change it once real users are signed in (it'll log everyone out) |
| `DATABASE_URL` | *see §4 above* | Required for any accounts — user rows, password hashes, and reset tokens live in Postgres |
| `ADMIN_EMAILS` | *comma-separated emails* | Optional. Additional emails to also bootstrap as admins, besides the app's built-in first admin (see below). After first login, admin status lives in the `users.is_admin` column and can be granted/revoked from the Users tab in `/admin` itself, without editing this env var or redeploying |

**A working first admin exists out of the box** — `ahuriratech@gmail.com` is the app's designated first admin. The first time that account signs in (Google or email/password), it's automatically promoted, and from there it can promote or revoke anyone else via the Users tab. `ADMIN_EMAILS` above is only needed if you want other accounts to *also* bootstrap in automatically, rather than being promoted manually afterward.

The session cookie is `httpOnly` and `sameSite: lax` always, and `secure` (HTTPS-only) whenever `NODE_ENV=production` (Vercel sets this automatically).

### 5b. Google Sign-In (optional, on top of 5a)
1. Go to https://console.cloud.google.com/apis/credentials (create a project first if you don't have one)
2. **Create Credentials → OAuth client ID → Web application**
3. Under **Authorized JavaScript origins**, add your site's origin(s), e.g. `https://your-app.vercel.app` (and `http://localhost:3000` for local dev). You do **not** need to set an Authorized redirect URI — sign-in uses Google Identity Services' token flow, which only checks the origin.
4. Copy the generated **Client ID** (looks like `1234567890-abc...apps.googleusercontent.com`) — you won't need the client secret for this flow.

| Key | Value | Notes |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | *the Client ID above* | Exposed to the browser (client IDs aren't secret) — required for the Sign-In button to render at all |
| `GOOGLE_CLIENT_ID` | *same Client ID* | Server-side copy, used to verify sign-in tokens actually came from your app |
| `GOOGLE_HOSTED_DOMAIN` | *e.g. `miu.ac.ug`* | Optional. If set, only Google Workspace accounts on that domain can sign in — personal Gmail accounts are rejected |

Google ID tokens are verified server-side via local JWT signature verification against Google's published JWKS (`https://www.googleapis.com/oauth2/v3/certs`) — Google's documented production method, not the rate-limited `/tokeninfo` debug endpoint. If `VITE_GOOGLE_CLIENT_ID` isn't set, the Google button simply doesn't render — nothing breaks.

### 5c. Email/password sign-in (optional, on top of 5a — works even without 5b)
Enabled automatically once `SESSION_SECRET` and `DATABASE_URL` are set — no extra env vars required for basic sign-up/sign-in. Passwords are hashed with scrypt (never stored in plaintext), sign-in/signup/reset are all rate-limited per email+IP, and error messages are intentionally generic (never reveal whether an email is registered).

**Forgot/reset password** works out of the box too, but without an email provider configured, the reset link is only logged to the server console (visible to you, not the user) instead of actually emailed. To make it deliver real emails:

| Key | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | *from https://resend.com* | Free tier available. Without this, reset links are logged server-side instead of sent |
| `RESEND_FROM_EMAIL` | *e.g. `MIU Slide Studio <noreply@yourdomain.com>`* | Optional — defaults to Resend's shared `onboarding@resend.dev` sender, which works for testing but you'll want your own verified domain for production |
| `APP_URL` | *e.g. `https://your-app.vercel.app`* | Required for reset links to point at the right domain — without it, emailed links will be relative and won't work from an email client |

### 5d. Verify
- Open the deployed URL — a "Sign in" button should appear in the header, opening a panel with email/password fields plus a Google button (if 5b is configured)
- Create an account with email/password, then sign out and back in
- Click "Forgot password?", submit an email, and check either your inbox (if `RESEND_API_KEY` is set) or the server logs (if not) for the reset link
- History (the drawer) should now show only decks generated while signed in as you
- Sign in as `ahuriratech@gmail.com` (or an email listed in `ADMIN_EMAILS`, if set) and visit `/admin` to see the control center

## 6. Optional: Upstash Redis (distributed rate limiting, caching, locking)

Without this, the app still works exactly as before — it just falls back to per-instance, best-effort versions of three things:
- **Rate limiting**: instead of proactively blocking a request once your key has hit 30/min or 14,400/day *across every server instance*, it only catches the limit reactively when Groq itself returns a 429 — so on a busy serverless deployment (multiple warm instances), it's possible to slightly overshoot before the limit is caught.
- **Generation cache**: falls back to the existing Postgres-backed `generation_cache` table instead of Redis (works fine, just slower and needs `DATABASE_URL` set).
- **Per-key call locking**: falls back to an in-memory lock that only protects against races within one warm instance, not across instances.

Set these two environment variables in Vercel to upgrade all three to real, cross-instance behavior via [Upstash Redis](https://upstash.com) (they have a free tier):

| Key | Value | Environments |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | *your Upstash database's REST URL* | Production, Preview, Development |
| `UPSTASH_REDIS_REST_TOKEN` | *your Upstash database's REST token* | Production, Preview, Development |

Get both from the Upstash console → your database → **REST API** tab (use the `.env` snippet it gives you). No code changes needed — `src/lib/redis.ts` reads them lazily and every call site checks whether Redis is configured before using it, so this is purely additive.

⚠️ Treat the REST token like any other secret — don't commit it to Git or paste it somewhere public. If it's ever exposed, regenerate it from the Upstash console.

## 7. Optional: R2 file storage & S3-compatible backups

Both of these use the same generic S3-compatible client (`src/lib/object-storage.ts`) pointed at different buckets — Cloudflare R2 for one, and whatever backup provider you choose for the other (Backblaze B2, AWS S3, or anything else that speaks the S3 API).

### 7a. R2 — preserves the original curriculum file
Without this, Curriculum Import still works fully — documents are parsed into their structure immediately on upload, and nothing about generation depends on R2. All you lose is the "Download original file" button on a curriculum's page.

**Important:** R2's S3-compatible API needs a proper access key ID + secret access key pair — a single Cloudflare API key (the kind used for Cloudflare's own REST API) is not sufficient for this. Generate a dedicated R2 API token:
1. Cloudflare dashboard → R2 → **Manage API Tokens** → Create API Token
2. Give it Object Read & Write permission on the bucket you want to use
3. Copy the **Access Key ID** and **Secret Access Key** it gives you (shown once)

| Key | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (dashboard sidebar) |
| `CLOUDFLARE_R2_ACCESS_KEY_ID` | From the R2 API token you just created |
| `CLOUDFLARE_R2_SECRET_ACCESS_KEY` | From the same token |
| `CLOUDFLARE_R2_BUCKET` | The bucket name |

### 7b. Backups — admin-triggered data dump
Without this, the app works the same — this only adds a manual "Backup now" button in `/admin` → System. When configured, it dumps decks, slides, lecture notes, curricula, and non-sensitive user fields (never password hashes) as one timestamped JSON file to your bucket.

| Key | Value |
|---|---|
| `BACKUP_STORAGE_ENDPOINT` | Your provider's S3-compatible endpoint hostname, e.g. `s3.eu-central-1.backblazeb2.com` |
| `BACKUP_STORAGE_ACCESS_KEY_ID` | Access key ID for that bucket |
| `BACKUP_STORAGE_SECRET_ACCESS_KEY` | Secret access key for that bucket |
| `BACKUP_STORAGE_BUCKET` | The bucket name |
| `BACKUP_STORAGE_REGION` | Optional — defaults to `us-east-1`, override if your provider needs a specific region string |

⚠️ Same rule as every other credential in this file: real values go in Vercel's Environment Variables only, never in a committed file.

## 8. Running tests
```bash
npm test
```
Runs the small `vitest` unit test suite (`src/lib/*.test.ts`) covering slide-content clamping, deck themes, and the i18n dictionary. This isn't full coverage — it's a starting point, not a guarantee.

