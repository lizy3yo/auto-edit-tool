import type { Express } from "express";
import {
  heygenWebhookToken,
  notifyHeygenVideo,
} from "./providers/heygen-lipsync";

/**
 * HeyGen render-completion callback (`avatar_video.success` / `.fail`), requested per-video by
 * `submitLipsync` via `callback_url`. It only WAKES the host scene's poll loop — the payload is
 * untrusted (per-request callbacks are unsigned; the URL token is the gate) and `pollVideo` still
 * does the authoritative GET /videos/{id} + download.
 */
export function registerHeygenWebhook(app: Express) {
  app.post("/api/webhooks/heygen/:token", (req, res) => {
    if (req.params.token !== heygenWebhookToken()) return res.sendStatus(404);
    const body = (req.body ?? {}) as {
      event_type?: string;
      event_data?: { video_id?: string };
      video_id?: string;
    };
    const videoId = body.event_data?.video_id ?? body.video_id;
    if (videoId) {
      console.log(
        `[HeyGen] callback ${body.event_type ?? "unknown"} → ${videoId}`
      );
      notifyHeygenVideo(videoId);
    }
    // Always 2xx — HeyGen retries a non-2xx for 24h, and an id with no live poll loop (restart,
    // other instance, already downloaded) is normal, not an error.
    res.sendStatus(200);
  });
}
