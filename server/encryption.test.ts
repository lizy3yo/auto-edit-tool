import { describe, expect, it } from "vitest";
import { encrypt, decrypt, maskApiKey } from "./encryption";

describe("encryption", () => {
  it("encrypts and decrypts a string correctly", () => {
    const original = "sk-test-api-key-12345";
    const encrypted = encrypt(original);

    // Encrypted should not equal the original
    expect(encrypted).not.toBe(original);
    // Encrypted should contain the IV separator
    expect(encrypted).toContain(":");

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const original = "same-key-value";
    const encrypted1 = encrypt(original);
    const encrypted2 = encrypt(original);

    // Different IVs should produce different ciphertexts
    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same value
    expect(decrypt(encrypted1)).toBe(original);
    expect(decrypt(encrypted2)).toBe(original);
  });

  it("handles empty strings", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("handles long strings", () => {
    const longKey = "a".repeat(500);
    const encrypted = encrypt(longKey);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(longKey);
  });
});

describe("maskApiKey", () => {
  it("masks a normal API key showing last 4 chars", () => {
    const key = "sk-1234567890abcdef";
    const masked = maskApiKey(key);
    // key.length = 18, so 14 dots + last 4 chars
    const expectedDots = Math.min(key.length - 4, 20);
    expect(masked).toBe("•".repeat(expectedDots) + key.slice(-4));
    expect(masked).toContain("cdef");
    expect(masked.endsWith("cdef")).toBe(true);
  });

  it("handles short keys (< 4 chars) with mask", () => {
    const masked = maskApiKey("abc");
    expect(masked).toBe("****");
  });

  it("handles exactly 4 char keys", () => {
    const masked = maskApiKey("abcd");
    expect(masked).toBe("abcd");
  });

  it("handles 5 char keys", () => {
    const masked = maskApiKey("abcde");
    expect(masked).toBe("•bcde");
  });
});
