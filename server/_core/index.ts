import "dotenv/config";
import { ensureFontConfig } from "../fontConfig";
import { resolveFFmpegPath } from "../ffmpegPath";

// Register bundled Inter with fontconfig before sharp renders any cover text.
ensureFontConfig();

// Probe FFmpeg at startup so logs immediately show which binary was selected
// and whether drawtext (video text overlays) is available.
resolveFFmpegPath().then(({ path, drawtext }) => {
  console.log(`[FFmpeg] resolved → ${path} | drawtext=${drawtext}`);
  if (!drawtext)
    console.error(
      "[FFmpeg] drawtext unavailable — video text overlays will be DISABLED"
    );
});

import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAdminAuthRoutes } from "../adminAuth";
import { runMigrations } from "../migrate";
import { checkSchema } from "../schemaCheck";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startTimeoutChecker } from "../generationTimeout";
import { registerHeygenWebhook } from "../heygenWebhook";
import { registerSalesWebhook } from "../salesWebhook";
import { downloadRouter } from "../download";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  // Raise the request-line + header limit above Node's 16 KB default. `book.detectCtaBlocks`
  // sends the script as a GET query param, so a long script (or a batch of them) can push the
  // URL past 16 KB — Node then rejects it with 431 before any handler runs. The client also caps
  // batch URL length (`maxURLLength`); this is the server-side headroom. A managed proxy in front
  // (e.g. Railway) may impose its own lower limit — that's out of this process's control.
  const server = createServer({ maxHeaderSize: 64 * 1024 }, app);
  // Trust proxy headers so req.protocol and cookies work correctly behind HTTPS proxy
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Bring the database up to `drizzle/schema.ts` BEFORE serving. Nothing else in the deploy
  // does: the host runs `build` then `start`, so without this a deploy happily ships code
  // selecting columns the database has never heard of. Awaited so no request lands mid-way.
  await runMigrations();
  // Warn loudly (but don't die) if the DB is still behind `drizzle/schema.ts` — an unapplied
  // migration otherwise surfaces as dead buttons rather than an error.
  void checkSchema();
  // Single-admin email/password auth
  registerAdminAuthRoutes(app);
  // HeyGen render-completion callback (wakes host-scene poll loops).
  registerHeygenWebhook(app);
  // Webstore sales callback — records a paid order against the video whose link brought it.
  registerSalesWebhook(app);
  // Download proxy (bypasses CORS for R2/CDN URLs)
  app.use("/api/download", downloadRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      // Client sets `methodOverride: "POST"` (main.tsx) so a long-input query (a full script)
      // isn't URL-length-limited on GET. tRPC requires the server to opt in to accepting POST
      // for query procedures too — without this every query 405s ("Unsupported POST-request to
      // query procedure"), which is exactly what broke `auth.me` and locked everyone out.
      allowMethodOverride: true,
      // Without this a 500 leaves NO server-side trace, and the only thing the browser gets
      // is Drizzle's `Failed query: select ...` — which reads identically whether a column is
      // missing, the table is missing, or the database is unreachable. The distinguishing
      // detail (`ER_BAD_FIELD_ERROR`, `ER_NO_SUCH_TABLE`, `ETIMEDOUT`) is on `cause`.
      onError({ error, path, type }) {
        const cause = error.cause as
          { code?: string; errno?: number } | undefined;
        console.error(
          `[tRPC] ${type} ${path ?? "<unknown>"} → ${error.code}` +
            (cause?.code || cause?.errno
              ? ` (${cause.code ?? cause.errno})`
              : ""),
          error.message
        );
      },
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`
  \x1b[32m\x1b[1m  ➜  Longform Studio is running!\x1b[0m
  \x1b[36m\x1b[1m  ➜  Local:   \x1b[4mhttp://localhost:${port}/\x1b[0m
  \x1b[36m\x1b[1m  ➜  Network: \x1b[4mhttp://127.0.0.1:${port}/\x1b[0m
`);
    // Start the stale-job watchdog (marks stuck jobs failed, resumes orphaned renders)
    startTimeoutChecker();
  });
}

startServer().catch(console.error);
