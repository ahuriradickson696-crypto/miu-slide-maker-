import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isSeedAdminEmail } from "./admin-seed";

const originalAdminEmails = process.env.ADMIN_EMAILS;

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
});

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = originalAdminEmails;
});

describe("isSeedAdminEmail", () => {
  it("always treats the hardcoded first admin as a seed admin, even with no ADMIN_EMAILS set", () => {
    expect(isSeedAdminEmail("ahuriratech@gmail.com")).toBe(true);
  });

  it("is case-insensitive for the hardcoded admin", () => {
    expect(isSeedAdminEmail("AhuriraTech@Gmail.com")).toBe(true);
  });

  it("trims whitespace", () => {
    expect(isSeedAdminEmail("  ahuriratech@gmail.com  ")).toBe(true);
  });

  it("rejects an unrelated email when ADMIN_EMAILS is unset", () => {
    expect(isSeedAdminEmail("random@example.com")).toBe(false);
  });

  it("also honors ADMIN_EMAILS as an additive bootstrap list", () => {
    process.env.ADMIN_EMAILS = "second-admin@miu.ac.ug, third-admin@miu.ac.ug";
    expect(isSeedAdminEmail("second-admin@miu.ac.ug")).toBe(true);
    expect(isSeedAdminEmail("third-admin@miu.ac.ug")).toBe(true);
    expect(isSeedAdminEmail("not-listed@miu.ac.ug")).toBe(false);
  });

  it("the hardcoded admin still works even when ADMIN_EMAILS is set to other emails", () => {
    process.env.ADMIN_EMAILS = "someone-else@miu.ac.ug";
    expect(isSeedAdminEmail("ahuriratech@gmail.com")).toBe(true);
  });
});
