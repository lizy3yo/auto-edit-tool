import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { sdk, ADMIN_OPEN_ID } from "./_core/sdk";

/** Constant-time string comparison over hashes (avoids length leaks). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Single-admin login. Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD env
 * vars; a successful login sets the same JWT session cookie the tRPC context
 * verifies.
 */
export function registerAdminAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body ?? {};

      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      if (!ENV.adminEmail || !ENV.adminPassword) {
        res
          .status(500)
          .json({ error: "ADMIN_EMAIL / ADMIN_PASSWORD not configured" });
        return;
      }

      const ok =
        safeEqual(String(email), ENV.adminEmail) &&
        safeEqual(String(password), ENV.adminPassword);
      if (!ok) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const sessionToken = await sdk.signSession(
        { openId: ADMIN_OPEN_ID, name: "Admin" },
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
          id: 1,
          name: "Admin",
          email: ENV.adminEmail,
          role: "admin",
          status: "approved",
        },
      });
    } catch (error) {
      console.error("[AdminAuth] Login failed:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
}
