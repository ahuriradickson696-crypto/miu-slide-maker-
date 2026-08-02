import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

// scrypt is one of the KDFs OWASP's Password Storage Cheat Sheet lists as
// acceptable (alongside argon2id and bcrypt) — chosen here because it's
// built into Node with no extra dependency or native bindings, which
// matters on serverless (no bcrypt native compile step needed).
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scrypt(password, salt, expected.length);
    if (actual.length !== expected.length) return false;
    // Constant-time comparison — a plain === on the derived hash would let
    // an attacker time how many leading bytes matched.
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A handful of the most commonly breached passwords — not exhaustive (a
// full breached-password check needs an external service like the
// HaveIBeenPwned API), but blocks the most obvious/lazy choices for free.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein1",
  "welcome1",
  "iloveyou",
  "admin123",
  "changeme",
]);

export function validatePasswordPolicy(password: string): string | null {
  // Length over composition rules, per current OWASP/NIST guidance — long
  // passphrases are both more secure and less user-hostile than forced
  // "1 uppercase, 1 symbol" rules.
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 128) return "Password is too long.";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "That password is too common — please choose another.";
  }
  return null;
}
