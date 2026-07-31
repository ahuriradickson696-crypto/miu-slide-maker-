import { describe, expect, it } from "vitest";
import { t, LOCALE_LABELS, type TranslationKey, type Locale } from "./i18n";

const KEYS: TranslationKey[] = [
  "appTitle",
  "appSubtitle",
  "generate",
  "reviewOutline",
  "share",
  "settings",
  "history",
  "signIn",
  "signOut",
];

describe("i18n", () => {
  it("has a translation for every key in every declared locale", () => {
    const locales = Object.keys(LOCALE_LABELS) as Locale[];
    for (const key of KEYS) {
      for (const locale of locales) {
        expect(t(key, locale)).toBeTruthy();
      }
    }
  });

  it("English and French copy actually differ (sanity check against copy-paste placeholders)", () => {
    for (const key of KEYS) {
      expect(t(key, "en")).not.toBe(t(key, "fr"));
    }
  });
});
