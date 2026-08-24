import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { openIdFor, sdk } from "./_core/sdk";
import {
  countActiveAdmins,
  createUser,
  getUserByEmail,
  normalizeEmail,
  touchUserLogin,
  updateUser,
} from "./db";
import { burnVerify, hashPassword, verifyPassword } from "./passwords";

/**
 * Seed the bootstrap admin, once, from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
 *
 * Those two env vars used to BE the login — `server/adminAuth.ts` compared against them on
 * every request and `sdk.ts` hard-coded the resulting user as `id: 1`. They are now a bootstrap
 * only: they create the first admin if the `users` table has none, and are ignored forever
 * after. In particular they never overwrite a password changed in the Admin UI — otherwise a
 * stale value in the deploy's environment would silently reset it on every restart.
 *
 * The row is pinned at `id = 1` because every job, slot and library entry rendered before
 * accounts existed carries `userId = 1`. Seeding anywhere else would orphan all of it.
 */
export async function ensureRootAdmin(): Promise<void> {
  try {
    if ((await countActiveAdmins()) > 0) return;

    if (!ENV.adminEmail || !ENV.adminPassword) {
      console.error(
        [
          "",
          "═".repeat(72),
          "  NO ADMIN ACCOUNT — and no ADMIN_EMAIL / ADMIN_PASSWORD to create one.",
          "",
          "  Nobody can sign in. Set both in the environment and restart; they seed",
          "  the first admin, after which accounts are managed in Admin → Users.",
          "═".repeat(72),
          "",
        ].join("\n")
      );
      return;
    }

    const email = normalizeEmail(ENV.adminEmail);
    const existing = await getUserByEmail(email);

    if (existing) {
      // The address is taken by a non-admin (or a disabled admin) — promote it rather than
      // colliding with the unique index and leaving the deploy with no way in. The stored
      // password is left alone; only the tier and the off switch are corrected.
      await updateUser(existing.id, { role: "admin", status: "active" });
      console.log(`[Accounts] promoted ${email} to active admin`);
      return;
    }

    // id 1 explicitly: pre-accounts jobs, slots and library rows are all stamped userId = 1.
    const id = await createUser({
      id: 1,
      email,
      name: "Admin",
      passwordHash: await hashPassword(ENV.adminPassword),
      role: "admin",
      status: "active",
    });
    console.log(`[Accounts] seeded bootstrap admin ${email} (id ${id})`);
  } catch (err) {
    // Never fatal: a boot loop is worse than a loud log, and `checkSchema()` names an
    // unmigrated `users` table right after this runs.
    console.error("[Accounts] could not seed bootstrap admin:", err);
  }
}

/**
 * Failed-sign-in throttle.
 *
 * Password auth over the public internet gets credential-stuffed; without a brake, a year-long
 * session cookie is one unlimited guessing loop away. Held in memory on purpose — the app is
 * single-process by design (see the semaphores and poll loops in `longformVideo.ts`), so there
 * is no second instance for an attacker to bounce off, and a restart clearing the counters is
 * an acceptable trade for having no new dependency.
 *
 * Keyed by email AND client IP so one attacker cannot lock a real user out by guessing at their
 * address from elsewhere.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

type Attempts = { count: number; firstAt: number; lockedUntil: number };
const attempts = new Map<string, Attempts>();

function throttleKey(email: string, req: Request): string {
  return `${normalizeEmail(email)}|${req.ip ?? "unknown"}`;
}

/** Remaining lockout in ms, or 0 when the caller may try. Also expires stale windows. */
function lockoutRemaining(key: string): number {
  const rec = attempts.get(key);
  if (!rec) return 0;
  const now = Date.now();
  if (rec.lockedUntil > now) return rec.lockedUntil - now;
  if (now - rec.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.delete(key);
    return 0;
  }
  return 0;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const rec = attempts.get(key) ?? { count: 0, firstAt: now, lockedUntil: 0 };
  if (now - rec.firstAt > ATTEMPT_WINDOW_MS) {
    rec.count = 0;
    rec.firstAt = now;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = now + LOCKOUT_MS;
    rec.count = 0;
    rec.firstAt = now;
  }
  attempts.set(key, rec);
}

/**
 * Email + password sign-in against the `users` table.
 *
 * Every failure — unknown address, wrong password, disabled account — answers with the SAME
 * message and, thanks to `burnVerify`, roughly the same latency. Telling the two apart is a
 * free account-enumeration oracle, and the operator gains nothing from the distinction.
 */
export function registerAdminAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const GENERIC = "Invalid email or password";
    try {
      const { email, password } = req.body ?? {};

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        !email ||
        !password
      ) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const key = throttleKey(email, req);
      const locked = lockoutRemaining(key);
      if (locked > 0) {
        res.status(429).json({
          error: `Too many failed attempts. Try again in ${Math.ceil(locked / 60_000)} minute(s).`,
        });
        return;
      }

      const user = await getUserByEmail(email);
      const ok = user
        ? await verifyPassword(password, user.passwordHash)
        : await burnVerify(password);

      if (!user || !ok || user.status !== "active") {
        recordFailure(key);
        console.warn(
          `[Auth] failed sign-in for ${normalizeEmail(email)} from ${req.ip ?? "unknown"}`
        );
        res.status(401).json({ error: GENERIC });
        return;
      }

      attempts.delete(key);
      void touchUserLogin(user.id);

      const sessionToken = await sdk.signSession(
        { openId: openIdFor(user.id), name: user.name, uid: user.id },
        { expiresInMs: ONE_YEAR_MS }
      );

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
        },
      });
    } catch (error) {
      console.error("[AdminAuth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
}
