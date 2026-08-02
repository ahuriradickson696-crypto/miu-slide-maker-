export type ThemeId = "miu-classic" | "miu-slate" | "minimal";

export type DeckTheme = {
  id: ThemeId;
  label: string;
  /** Hex without '#', for pptxgenjs. */
  primary: string;
  accent: string;
  dark: string;
  muted: string;
};

export const DECK_THEMES: Record<ThemeId, DeckTheme> = {
  "miu-classic": {
    id: "miu-classic",
    label: "MIU Classic",
    primary: "0F7A3A",
    accent: "C8102E",
    dark: "1F2937",
    muted: "6B7280",
  },
  "miu-slate": {
    id: "miu-slate",
    label: "MIU Slate",
    primary: "1E3A5F",
    accent: "D4A017",
    dark: "1F2937",
    muted: "64748B",
  },
  minimal: {
    id: "minimal",
    label: "Minimal Mono",
    primary: "111827",
    accent: "6B7280",
    dark: "1F2937",
    muted: "9CA3AF",
  },
};

export function getTheme(id: ThemeId | undefined): DeckTheme {
  return DECK_THEMES[id ?? "miu-classic"] ?? DECK_THEMES["miu-classic"];
}
