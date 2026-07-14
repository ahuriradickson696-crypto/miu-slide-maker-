# Deploying MIU Slide Studio to GitHub + Vercel

## 1. Get a Gemini API key
1. Go to https://aistudio.google.com/apikey
2. Sign in and click **Create API Key** (free tier, no card needed)
3. Copy the key — you'll paste it into Vercel, not into any file

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
   | `GEMINI_API_KEY` | *your key from step 1* | Production, Preview, Development |
   | `DATABASE_URL` | *your Neon Postgres connection string, see below* | Production, Preview, Development |
4. Click **Deploy**

## 3b. Set up the Neon database (deck history)

Saved decks (the History panel) are stored in Postgres via [Neon](https://neon.tech). This is optional — if `DATABASE_URL` isn't set, deck generation and download still work, decks just won't be saved.

1. Go to https://neon.tech and create a free project (or, easier: in Vercel, **Storage → Create Database → Neon Postgres**, which sets `DATABASE_URL` for you automatically)
2. If you created the Neon project outside Vercel, copy the connection string from the Neon dashboard (starts with `postgres://...`) and paste it as `DATABASE_URL` in step 3 above
3. No manual migration needed — the app creates its own `decks` and `slides` tables automatically the first time it runs (see `src/lib/db.ts`)

## 4. Verify
- Open the deployed URL
- Try generating a deck — this calls `generateDeck` (text) and `generateIllustration` (images), both of which read `process.env.GEMINI_API_KEY` **server-side only** (it's never sent to the browser)
- If you see "Missing GEMINI_API_KEY", double check the env var is set for the right environment and redeploy
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
- The key is read via `process.env.GEMINI_API_KEY` inside server functions (`src/lib/slides.functions.ts`), which only run on the server — it's never bundled into client-side JS.
- `.gitignore` excludes `.env`, `.env.local`, and `.vercel` so secrets can't be committed by accident.
- If a key is ever exposed (e.g. pasted in chat, committed by mistake, shared in a screenshot), revoke it immediately at https://aistudio.google.com/apikey and generate a new one.
