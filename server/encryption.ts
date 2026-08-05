import crypto from "crypto";
import { ENV } from "./_core/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

// No dev fallback: a hardcoded secret would encrypt production provider keys under a
// value published in this repo. Fail loudly instead.
// The salt is load-bearing — changing it orphans every key already stored in
// provider_configs / app_settings (they must be re-entered in Admin).
function getKey(): Buffer {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET is required to encrypt/decrypt provider keys");
  }
  return crypto.scryptSync(ENV.cookieSecret, "longform-studio", 32);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  // Format: iv:tag:encrypted
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 4) return "****";
  return "•".repeat(Math.min(key.length - 4, 20)) + key.slice(-4);
}
