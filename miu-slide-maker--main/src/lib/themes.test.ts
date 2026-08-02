import { describe, expect, it } from "vitest";
import { DECK_THEMES, getTheme } from "./themes";

describe("themes", () => {
  it("falls back to miu-classic for an unknown/undefined theme id", () => {
    expect(getTheme(undefined).id).toBe("miu-classic");
    // @ts-expect-error deliberately testing an invalid id
    expect(getTheme("not-a-theme").id).toBe("miu-classic");
  });

  it("every theme defines a full color set as bare hex (no leading #)", () => {
    for (const theme of Object.values(DECK_THEMES)) {
      for (const key of ["primary", "accent", "dark", "muted"] as const) {
        expect(theme[key]).toMatch(/^[0-9A-Fa-f]{6}$/);
      }
    }
  });
});
