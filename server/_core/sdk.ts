import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { ForbiddenError } from "@shared/_core/errors";
import type { AccountStatus, Role } from "@shared/roles";
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import { getPublicUserById, getRootAdmin } from "../db";
import { ENV } from "./env";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * The authenticated account, resolved fresh from the `users` table on every request.
 *
 * It is deliberately NOT read off the JWT: a role change, a disabled account or a deletion has
 * to take effect on the next request, not whenever a year-long cookie happens to expire. The
 * cookie carries an id; the database carries the truth.
 */
export type SessionUser = {
  id: number;
  openId: string;
  name: string;
  email: string;
  role: Role;
  status: AccountStatus;
};

/**
 * The pre-accounts session marker.
 *
 * Sessions signed before the `users` table existed carry `openId: "admin"` and no `uid`. They
 * are honoured — resolved to the bootstrap admin — so shipping accounts does not sign everyone
 * out mid-render.
 */
export const ADMIN_OPEN_ID = "admin";

export const openIdFor = (userId: number) => `user:${userId}`;

export type SessionPayload = {
  openId: string;
  name: string;
  /** Account id. Absent only on pre-accounts cookies. */
  uid?: number;
};

/**
 * Resolved accounts, briefly.
 *
 * The client sends tRPC in batches and each procedure builds its own context, so an uncached
 * lookup is several identical `SELECT ... WHERE id = ?` per click. Two seconds is short enough
 * that "disable this account" still reads as immediate and long enough to collapse a batch.
 */
const USER_CACHE_TTL_MS = 2_000;
const userCache = new Map<number, { at: number; user: SessionUser | null }>();

/** Called whenever an account is written, so an admin's change is never masked by the cache. */
export function invalidateUserCache(userId?: number) {
  if (userId === undefined) userCache.clear();
  else userCache.delete(userId);
}

function toSessionUser(row: {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
}): SessionUser {
  return {
    id: row.id,
    openId: openIdFor(row.id),
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
  };
}

async function loadUser(userId: number): Promise<SessionUser | null> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_CACHE_TTL_MS) return hit.user;

  const row = await getPublicUserById(userId);
  const user = row ? toSessionUser(row) : null;
  userCache.set(userId, { at: Date.now(), user });
  return user;
}

class SDKServer {
  private parseCookies(cookieHeader: string | undefined) {
    if (!cookieHeader) {
      return new Map<string, string>();
    }

    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }

  private getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }

  async signSession(
    payload: SessionPayload,
    options: { expiresInMs?: number } = {}
  ): Promise<string> {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1000);
    const secretKey = this.getSessionSecret();

    return new SignJWT({
      openId: payload.openId,
      name: payload.name,
      ...(payload.uid !== undefined ? { uid: payload.uid } : {}),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime(expirationSeconds)
      .sign(secretKey);
  }

  async verifySession(
    cookieValue: string | undefined | null
  ): Promise<{ openId: string; name: string; uid: number | null } | null> {
    if (!cookieValue) {
      return null;
    }

    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"],
      });
      const { openId, name, uid } = payload as Record<string, unknown>;

      if (!isNonEmptyString(openId)) {
        console.warn("[Auth] Session payload missing openId");
        return null;
      }

      return {
        openId,
        name: typeof name === "string" ? name : "",
        uid: typeof uid === "number" && Number.isSafeInteger(uid) ? uid : null,
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }

  async authenticateRequest(req: Request): Promise<SessionUser> {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);

    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }

    // Pre-accounts cookie: no uid, `openId: "admin"`. Resolve it to the bootstrap admin so an
    // in-flight session survives the upgrade instead of being dropped at the login screen.
    const user =
      session.uid !== null
        ? await loadUser(session.uid)
        : session.openId === ADMIN_OPEN_ID
          ? await getRootAdmin().then(row => (row ? toSessionUser(row) : null))
          : null;

    if (!user) {
      throw ForbiddenError("Account no longer exists");
    }
    // Disabling an account ends its sessions here, on the very next request — there is no
    // server-side session store to evict from, and this is the moment the cookie is exchanged
    // for an identity.
    if (user.status !== "active") {
      throw ForbiddenError("Account is disabled");
    }

    return user;
  }
}

export const sdk = new SDKServer();
