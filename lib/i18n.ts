// Minimal i18n scaffold. This is intentionally NOT full coverage — translating
// every string in the app is a larger, ongoing content task. What's here
// demonstrates the mechanism (a typed dictionary + t() lookup with English
// fallback) on the highest-visibility strings, so adding more locales or
// more keys later is a matter of extending DICTIONARY, not re-architecting.

export type Locale = "en" | "fr";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  fr: "Français",
};

const DICTIONARY = {
  appTitle: {
    en: "Metropolitan International University",
    fr: "Université Internationale Métropolitaine",
  },
  appSubtitle: {
    en: "Slide Studio — Lecture Deck Generator",
    fr: "Slide Studio — Générateur de diaporamas",
  },
  generate: {
    en: "Generate slide deck",
    fr: "Générer le diaporama",
  },
  reviewOutline: {
    en: "Review outline",
    fr: "Vérifier le plan",
  },
  share: { en: "Share", fr: "Partager" },
  settings: { en: "Settings", fr: "Paramètres" },
  history: { en: "History", fr: "Historique" },
  signIn: { en: "Sign in with Google", fr: "Se connecter avec Google" },
  signOut: { en: "Sign out", fr: "Se déconnecter" },
} satisfies Record<string, Record<Locale, string>>;

export type TranslationKey = keyof typeof DICTIONARY;

export function t(key: TranslationKey, locale: Locale): string {
  return DICTIONARY[key][locale] ?? DICTIONARY[key].en;
}
