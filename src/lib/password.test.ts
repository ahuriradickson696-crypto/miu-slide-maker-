import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("produces a hash that verifies against the original password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    // ...but both still verify correctly.
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("never stores the password in plaintext within the hash string", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toContain("hunter2");
  });

  it("gracefully rejects malformed stored hashes instead of throwing", async () => {
    await expect(verifyPassword("anything", "not-a-real-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });
});

describe("validatePasswordPolicy", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePasswordPolicy("short1")).toBeTruthy();
  });

  it("accepts a reasonable 8+ character password", () => {
    expect(validatePasswordPolicy("a-decent-passphrase")).toBeNull();
  });

  it("rejects extremely long input", () => {
    expect(validatePasswordPolicy("a".repeat(200))).toBeTruthy();
  });

  it("rejects common breached passwords", () => {
    expect(validatePasswordPolicy("password1")).toBeTruthy();
    expect(validatePasswordPolicy("Password1")).toBeTruthy(); // case-insensitive
  });
});
