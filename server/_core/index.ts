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
import { checkSchema } from "../schemaCheck";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startTimeoutChecker } from "../generationTimeout";
import { registerHeygenWebhook } from "../heygenWebhook";
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
  const server = createServer(app);
  // Trust proxy headers so req.protocol and cookies work correctly behind HTTPS proxy
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Warn loudly (but don't die) if the DB is behind `drizzle/schema.ts` — an unapplied
  // migration otherwise surfaces as dead buttons rather than an error.
  void checkSchema();
  // Single-admin email/password auth
  registerAdminAuthRoutes(app);
  // HeyGen render-completion callback (wakes host-scene poll loops).
  registerHeygenWebhook(app);
  // Download proxy (bypasses CORS for R2/CDN URLs)
  app.use("/api/download", downloadRouter);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
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
