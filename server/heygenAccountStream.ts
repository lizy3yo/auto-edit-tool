/**
 * Live HeyGen account availability for the HeyGen test page — Server-Sent Events.
 *
 * `GET /api/heygen-test/accounts/stream` holds one connection per open page and pushes the free
 * account list (`getHeygenAccountAvailability`) whenever `heygenAccountEvents` says it may have
 * changed: a film starting or settling, a test starting or settling. Changes are coalesced
 * (`DEBOUNCE_MS`) and computed ONCE per burst for every open page, so a pipeline writing status
 * in a loop costs one query, not one per viewer.
 *
 * Every `HEARTBEAT_MS` the list is recomputed and sent anyway. That keeps the connection alive
 * through Railway's proxy (an idle stream is closed) and catches the one change nothing signals
 * — a HeyGen key added or removed in Admin. The browser's EventSource reconnects on its own after
 * a drop; the page falls back to polling the tRPC query until it does.
 *
 * Gated like the page: signed in, and admin or operations manager (`canManageChannels`, the
 * predicate behind `managerProcedure`).
 */
import type { Express, Response } from "express";
import { canManageChannels } from "../shared/roles";
import { sdk } from "./_core/sdk";
import { onHeygenAccountsChanged } from "./heygenAccountEvents";
import {
  getHeygenAccountAvailability,
  type HeygenAccountAvailability,
} from "./heygenTest";

const DEBOUNCE_MS = 250;
const HEARTBEAT_MS = 25_000;

const clients = new Set<Response>();
let unsubscribe: (() => void) | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

function send(res: Response, data: HeygenAccountAvailability): void {
  res.write(`event: accounts\ndata: ${JSON.stringify(data)}\n\n`);
}

async function broadcast(): Promise<void> {
  if (clients.size === 0) return;
  try {
    const data = await getHeygenAccountAvailability();
    for (const res of Array.from(clients)) send(res, data);
  } catch (err: any) {
    console.warn(`[HeyGen accounts] stream refresh failed: ${err?.message}`);
  }
}

function scheduleBroadcast(): void {
  if (debounce) return;
  debounce = setTimeout(() => {
    debounce = null;
    void broadcast();
  }, DEBOUNCE_MS);
}

function start(): void {
  unsubscribe ??= onHeygenAccountsChanged(scheduleBroadcast);
  heartbeat ??= setInterval(() => void broadcast(), HEARTBEAT_MS);
}

function stopIfIdle(): void {
  if (clients.size > 0) return;
  unsubscribe?.();
  unsubscribe = null;
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = null;
}

export function registerHeygenAccountStream(app: Express): void {
  app.get("/api/heygen-test/accounts/stream", async (req, res) => {
    let role;
    try {
      ({ role } = await sdk.authenticateRequest(req));
    } catch {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    if (!canManageChannels(role)) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells nginx-style proxies not to buffer the stream into one late chunk.
      "X-Accel-Buffering": "no",
    });
    // Reconnect delay the browser uses after a drop.
    res.write("retry: 3000\n\n");

    clients.add(res);
    start();
    req.on("close", () => {
      clients.delete(res);
      stopIfIdle();
    });

    // First paint for this page, without waiting for the next change.
    try {
      send(res, await getHeygenAccountAvailability());
    } catch (err: any) {
      console.warn(`[HeyGen accounts] stream open failed: ${err?.message}`);
    }
  });
}
