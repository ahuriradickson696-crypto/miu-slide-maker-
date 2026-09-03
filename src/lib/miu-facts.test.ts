import { describe, expect, it } from "vitest";
import { MIU_FACTS } from "./miu-facts";

describe("MIU_FACTS", () => {
  it("has the three known campuses", () => {
    const names = MIU_FACTS.campuses.map((c) => c.name.toLowerCase());
    expect(names.some((n) => n.includes("kisoro"))).toBe(true);
    expect(names.some((n) => n.includes("mbarara"))).toBe(true);
    expect(names.some((n) => n.includes("kampala"))).toBe(true);
  });

  it("has non-empty core identity fields", () => {
    expect(MIU_FACTS.legalName).toBeTruthy();
    expect(MIU_FACTS.motto).toBeTruthy();
    expect(MIU_FACTS.vision).toBeTruthy();
    expect(MIU_FACTS.mission).toBeTruthy();
    expect(MIU_FACTS.accreditation).toBeTruthy();
  });

  it("campusesShort summarizes all three campuses", () => {
    expect(MIU_FACTS.campusesShort).toContain("Kisoro");
    expect(MIU_FACTS.campusesShort).toContain("Mbarara");
    expect(MIU_FACTS.campusesShort).toContain("Kampala");
  });

  it("marks unconfirmed compliance fields as explicitly null, not a fabricated placeholder", () => {
    expect(MIU_FACTS.compliance.dataProtectionOfficerName).toBeNull();
    expect(MIU_FACTS.compliance.dataProtectionOfficerEmail).toBeNull();
    expect(MIU_FACTS.compliance.pdpoRegistrationNumber).toBeNull();
  });

  it("has the already-known NCHE accreditation number", () => {
    expect(MIU_FACTS.compliance.ncheAccreditationNumber).toBe("UIPL022");
  });
});
