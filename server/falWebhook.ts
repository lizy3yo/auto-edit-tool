import type { Express } from "express";
import { falWebhookToken, notifyFalRequest } from "./providers/fal-lipsync";

/**
 * fal render-completion callback, requested per-request by `submitLipsync` via the
 * `fal_webhook` query param. It only WAKES the host scene's poll loop — the payload is treated
 * as untrusted (the URL token is the gate; fal's Ed25519 `X-Fal-Webhook-Signature` is
 * deliberately not verified because nothing is READ out of the body) and `pollVideo` still does
 * the authoritative status GET + result download.
 *
 * Same contract, same shape, same trust model as `registerHeygenWebhook` — only the id field
 * differs (`request_id` instead of `event_data.video_id`).
 */
export function registerFalWebhook(app: Express) {
  app.post("/api/webhooks/fal/:token", (req, res) => {
    if (req.params.token !== falWebhookToken()) return res.sendStatus(404);
    const body = (req.body ?? {}) as {
      request_id?: string;
      gateway_request_id?: string;
      status?: string;
    };
    const requestId = body.request_id ?? body.gateway_request_id;
    if (requestId) {
      console.log(`[fal] callback ${body.status ?? "unknown"} → ${requestId}`);
      notifyFalRequest(requestId);
    }
    // Always 2xx — a request id with no live poll loop (restart, other instance, already
    // downloaded) is normal, not an error. A `status: "ERROR"` callback also just wakes the
    // loop; the poll re-reads the real terminal state from the queue.
    res.sendStatus(200);
  });
}
