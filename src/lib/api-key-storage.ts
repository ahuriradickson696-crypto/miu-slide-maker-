// Single source of truth for the API key's localStorage key name and
// read/write logic — was previously copy-pasted verbatim across seven
// route files. The storage key name changed from the old "gemini-api-key"
// to "groq-api-key" as part of migrating off Gemini entirely — a
// previously-saved Gemini key wouldn't work against Groq's API anyway, so
// there's nothing worth preserving under the old name.

const API_KEY_STORAGE_KEY = "miu-slide-studio:groq-api-key";

export function readStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || "";
  } catch {
    return ""; // private browsing, storage disabled, etc.
  }
}

export function writeStoredApiKey(key: string): void {
  try {
    const trimmed = key.trim();
    if (trimmed) localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
    else localStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // ignore — nothing useful to do if storage is unavailable
  }
}
