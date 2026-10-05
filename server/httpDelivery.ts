import compression from "compression";
import type { Request, RequestHandler, Response } from "express";

/**
 * How the page's own bytes reach the browser — the half of "works on weak wifi" that is not
 * media. Nothing the server sent was compressed and nothing it served said how long to keep it,
 * so a page load pulled ~870 KB of script and CSS every time and each 3 s poll of a rendering
 * video sent the whole storyboard as plain JSON.
 *
 * In `server/`, not `_core/`, so the two rules are pure and tested (`httpDelivery.test.ts`).
 */

/**
 * Routes whose bodies are passed through byte for byte. Media is already compressed, and
 * `/api/download` forwards storage's Content-Length so a broken transfer FAILS in the browser
 * instead of saving a short file that looks complete — compressing would drop that header.
 */
const PASS_THROUGH = ["/api/download", "/api/narration-upload", "/api/thumb"];

export function isPassThroughPath(path: string): boolean {
  return PASS_THROUGH.some(p => path === p || path.startsWith(`${p}/`));
}

/** `compression`'s filter: never a pass-through route, else its own content-type rule. */
export function shouldCompress(req: Request, res: Response): boolean {
  if (isPassThroughPath(req.originalUrl.split("?")[0])) return false;
  return compression.filter(req, res);
}

/** gzip / brotli for pages, scripts and API answers. Tiny answers are sent as they are. */
export function compressResponses(): RequestHandler {
  return compression({ filter: shouldCompress, threshold: 1024 });
}

const ONE_YEAR_SEC = 365 * 24 * 60 * 60;

/**
 * Cache-Control for a file of the built client. Vite names everything under `/assets/` by a
 * hash of its contents, so such a file never changes and is kept for a year without asking;
 * everything else (index.html above all) is re-checked on every load, which is what makes a
 * deploy show at once.
 */
export function staticCacheControl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return /\/assets\/[^/]+-[\w-]{8,}\.[a-z0-9]+$/i.test(normalized)
    ? `public, max-age=${ONE_YEAR_SEC}, immutable`
    : "no-cache";
}
