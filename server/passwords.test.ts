import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  burnVerify,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./passwords";

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const digest = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", digest)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const digest = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse batterY", digest)).toBe(false);
    expect(await verifyPassword("", digest)).toBe(false);
  });

  it("salts every hash — the same password never stores the same digest", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
    // ...and both still verify, so the salt is being read back, not just written.
    expect(await verifyPassword("same password", a)).toBe(true);
    expect(await verifyPassword("same password", b)).toBe(true);
  });

  it("encodes the cost parameters into the digest", async () => {
    const digest = await hashPassword("whatever");
    const [scheme, n, r, p, salt, hash] = digest.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThanOrEqual(16_384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(hash, "base64")).toHaveLength(32);
  });

  it("returns false rather than throwing on a corrupted digest", async () => {
    // A truncated, empty or foreign-scheme column must be a failed login, never a 500 on the
    // login route — that would be a denial of service one bad row wide.
    for (const bad of [
      "",
      "not-a-digest",
      "scrypt$16384$8$1$onlyfiveparts",
      "bcrypt$2b$10$abcdefghijklmnop$hash",
      "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$",
    ]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });

  it("burnVerify always fails, whatever it is handed", async () => {
    // The point is that it does the WORK, so an unknown email costs the same wall-clock as a
    // wrong password. Its answer is never anything but false.
    expect(await burnVerify("")).toBe(false);
    expect(await burnVerify("hunter2")).toBe(false);
  });
});

describe("password policy", () => {
  it("accepts anything at or above the minimum length", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    // No composition rules, per NIST SP 800-63B — length is the only gate.
    expect(passwordProblem("all lowercase and spaces")).toBeNull();
  });

  it("rejects short and absurdly long passwords", () => {
    expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(
      /at least/
    );
    expect(passwordProblem("a".repeat(1000))).toMatch(/at most/);
  });
});
