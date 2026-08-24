import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

/**
 * Password hashing for the `users` table.
 *
 * scrypt rather than bcrypt/argon2 for one deliberate reason: it ships in `node:crypto`, so
 * account passwords cost this project no native dependency and no node-gyp build step on the
 * deploy host. It is a memory-hard KDF on OWASP's approved list, and `server/encryption.ts`
 * already leans on the same primitive for provider keys — one less thing in the codebase to
 * reason about separately.
 *
 * Parameters are OWASP's scrypt minimum (N=2^15, r=8, p=1 ≈ 32 MB per hash). They are encoded
 * INTO the stored string, so raising them later re-hashes on next sign-in rather than
 * invalidating every existing password.
 *
 * Format: `scrypt$N$r$p$<salt b64>$<hash b64>` — self-describing, one column, no schema change
 * when the cost changes.
 */
const SCHEME = "scrypt";
const N = 32_768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
/** scrypt needs ~128·N·r bytes; Node's default 32 MB cap is exactly at the limit for N=2^15. */
const MAXMEM = 64 * 1024 * 1024;

/** OWASP's floor, and NIST SP 800-63B's: length only, no composition rules. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await scrypt(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return [
    SCHEME,
    N,
    R,
    P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verify. Returns false — never throws — on a malformed or unknown-scheme digest,
 * so a corrupted row is a failed login rather than a 500 on the login route.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== SCHEME) return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (
      !Number.isSafeInteger(n) ||
      !Number.isSafeInteger(r) ||
      !Number.isSafeInteger(p)
    ) {
      return false;
    }

    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Burn the same work as a real verify against a throwaway digest.
 *
 * Called on the login path when no user matches the submitted email. Without it, "unknown
 * email" returns in microseconds while "known email, wrong password" takes ~100 ms — which is
 * a user-enumeration oracle readable over the network, whatever the response body says.
 */
let decoyDigest: string | null = null;
export async function burnVerify(password: string): Promise<false> {
  decoyDigest ??= await hashPassword(crypto.randomBytes(24).toString("hex"));
  await verifyPassword(password, decoyDigest);
  return false;
}

/** Validation shared by account creation and password changes. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
}
