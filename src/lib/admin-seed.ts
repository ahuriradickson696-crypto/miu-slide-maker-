// Bootstrap admin logic — used once per account, on first successful
// sign-in, to decide whether to promote that account to admin in the
// database. After that first promotion, admin status lives entirely in
// `users.is_admin` and is managed from the Users tab in /admin — this
// module is never consulted again for that account.

// The permanent, hardcoded first admin. Always honored regardless of
// environment configuration, so the app has a working admin out of the
// box without requiring ADMIN_EMAILS to be set in Vercel first.
const HARDCODED_ADMIN_EMAIL = "ahuriratech@gmail.com";

export function isSeedAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized === HARDCODED_ADMIN_EMAIL) return true;

  // ADMIN_EMAILS is optional and additive — lets an operator seed further
  // admins (besides the hardcoded one) without needing an existing admin
  // to promote them through the Users tab first.
  const extra = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return extra.includes(normalized);
}
