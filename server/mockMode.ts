/**
 * server/mockMode.ts — credit-free rehearsal of the whole longform pipeline.
 *
 * When mock mode is ON, every PAID provider lane is replaced by a locally generated stand-in:
 *
 *   TTS (69Labs/ElevenLabs) → an mp3 tone sized to the word count
 *   stills + keyframes (gpt-image-2 / Gemini image) → a labelled PNG
 *   b-roll video (APIMART / 69Labs) → an mp4 built from that PNG
 *   host lip-sync (HeyGen) → the same mp4, from the host photo
 *
 * Everything else is the REAL pipeline: CTA parsing, scene segmentation, narration slicing,
 * R2 upload, ffmpeg assembly, music beds. So a mock run exercises the same code path and
 * produces a real, playable MP4 — it just never spends a credit.
 *
 * NOT mocked: the LLM authoring lane (Gemini/Anthropic). Those are free-tier or negligible,
 * and every one of them already fails open — a mock run with no LLM quota simply produces the
 * same degraded b-roll prompts a quota-exhausted real run would.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { getAppSetting, setAppSetting } from "./db";
import { runFfmpeg } from "./videoAssembly";
import { storagePut } from "./storage";
import type { GenerationResult } from "../shared/types";
import type {
  ProviderAdapter,
  VideoGenerationParams,
  ImageGenerationParams,
} from "./providers/base";

/** app_settings key. Persisted so the toggle survives a restart, like every other setting. */
export const MOCK_MODE_KEY = "mock_mode";

/**
 * Cached for a few seconds: the pipeline asks per scene, and a DB round trip per image on a
 * 200-scene render is pure waste. Short enough that toggling in Admin takes effect on the
 * next job rather than the next restart.
 */
let cache: { value: boolean; at: number } | null = null;
const CACHE_MS = 5_000;

export async function isMockMode(): Promise<boolean> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const raw = await getAppSetting(MOCK_MODE_KEY).catch(() => null);
  const value = raw === "1";
  cache = { value, at: Date.now() };
  return value;
}

export async function setMockMode(enabled: boolean): Promise<void> {
  await setAppSetting(MOCK_MODE_KEY, enabled ? "1" : "0");
  cache = { value: enabled, at: Date.now() };
}

/** Test-only: drop the cache so a test can flip the setting without waiting out CACHE_MS. */
export function __resetMockCache(): void {
  cache = null;
}

// ─── Asset generators ────────────────────────────────────────────────────────

/** Conversational pace used across the pipeline (see `narrationWordBudget`). */
const WORDS_PER_SEC = 2.5;

/** Seconds of audio a mock read of `text` should occupy. Pure — unit-tested. */
export function mockAudioDurationSec(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / WORDS_PER_SEC) * 10) / 10);
}

function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "mock-"));
  return fn(dir).finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
}

function escapeXml(s: string): string {
  return s.replace(
    /[<>&"']/g,
    c =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!
  );
}

/**
 * A labelled placeholder frame. Deliberately obvious — a mock render must never be mistaken
 * for a real one when someone scrubs the output.
 */
export async function mockImage(
  label: string,
  square = false
): Promise<{ buffer: Buffer; mimeType: string }> {
  const w = square ? 1024 : 1920;
  const h = square ? 1024 : 1080;
  const words = escapeXml(label).slice(0, 180);
  // Wrap by hand — SVG has no flow text.
  const lines: string[] = [];
  let line = "";
  for (const word of words.split(/\s+/)) {
    if ((line + " " + word).trim().length > 42) {
      lines.push(line.trim());
      line = word;
    } else line += ` ${word}`;
  }
  if (line.trim()) lines.push(line.trim());

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#14181f"/>
    <rect x="0" y="0" width="100%" height="8" fill="#d97706"/>
    <text x="${w / 2}" y="${h * 0.18}" font-family="sans-serif" font-size="${square ? 44 : 52}"
          fill="#d97706" text-anchor="middle" font-weight="bold">MOCK MODE — NO CREDITS SPENT</text>
    ${lines
      .slice(0, 8)
      .map(
        (l, i) =>
          `<text x="${w / 2}" y="${h * 0.36 + i * (square ? 52 : 62)}" font-family="sans-serif" ` +
          `font-size="${square ? 34 : 42}" fill="#e5e7eb" text-anchor="middle">${l}</text>`
      )
      .join("\n")}
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return { buffer, mimeType: "image/png" };
}

/**
 * An mp3 of `durationSec` standing in for narration.
 *
 * The level and frequency are load-bearing, not cosmetic. `detectSilencesFromBuffer` runs
 * `silencedetect=noise=-38dB`, and the whole pipeline treats detected silence as a place to
 * move a scene cut (`snapBoundariesToSilence`, `rescueSilentQrTails`, `capDeadAirPauses`).
 * A quiet low tone is discarded by libmp3lame's psychoacoustic model as inaudible, so the
 * decoded track reads as 100% silence and scene boundaries collapse — the first mock render
 * gave scene 1 the entire master and left scenes 2-3 at ~0s, producing an unreadable slice.
 * 440 Hz at 0.3 survives encoding and sits ~28 dB above the silence gate.
 */
export async function mockAudioBuffer(durationSec: number): Promise<Buffer> {
  return withTemp(async dir => {
    const out = join(dir, "vo.mp3");
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${durationSec.toFixed(2)}`,
      "-af",
      "volume=0.3",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-y",
      out,
    ]);
    return readFileSync(out);
  });
}

/** An mp4 of `durationSec` built from a still — the stand-in for any paid video render. */
export async function mockVideoBuffer(
  durationSec: number,
  label: string
): Promise<Buffer> {
  const { buffer: png } = await mockImage(label);
  return withTemp(async dir => {
    const img = join(dir, "frame.png");
    const out = join(dir, "clip.mp4");
    writeFileSync(img, png);
    await runFfmpeg([
      "-loop",
      "1",
      "-i",
      img,
      "-t",
      Math.max(1, durationSec).toFixed(2),
      "-r",
      "24",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
      "-y",
      out,
    ]);
    return readFileSync(out);
  });
}

// ─── Uploaded variants (what the pipeline actually consumes) ─────────────────

export async function mockStill(
  prompt: string,
  square = false
): Promise<GenerationResult> {
  const { buffer, mimeType } = await mockImage(prompt, square);
  return { success: true, fileData: buffer, mimeType };
}

export async function mockVoiceoverUrl(text: string): Promise<string> {
  const buf = await mockAudioBuffer(mockAudioDurationSec(text));
  const { url } = await storagePut(
    `mock/vo-${Date.now()}-${Math.round(performance.now())}.mp3`,
    buf,
    "audio/mpeg"
  );
  return url;
}

export async function mockClipResult(
  durationSec: number,
  label: string
): Promise<GenerationResult> {
  const buf = await mockVideoBuffer(durationSec, label);
  return { success: true, fileData: buf, mimeType: "video/mp4" };
}

// ─── LLM stand-in ────────────────────────────────────────────────────────────

/**
 * The one shape worth faking: `parseVisualDirection` accepts
 * `{ styleBible: string, beats: [{from,to,beat}] }`. Returning a valid payload here is what
 * keeps a mock render's b-roll coherent — without it the style bible and visual direction both
 * fail open and every scene falls back to an isolated per-scene prompt, which is exactly the
 * degraded output a quota-exhausted real render produces.
 *
 * Empty `beats` is valid and deliberate: inventing beat ranges for a script the mock has not
 * read would misrepresent what the real model does.
 */
const MOCK_STYLE_BIBLE =
  "A lived-in older suburban home in warm, slightly desaturated domestic light — " +
  "worn fixtures, dated tile, honest surfaces. Macro, hands-first framing on real " +
  "materials. No showroom gloss, no stock-photo sheen.";

/**
 * Canned LLM reply for mock mode. Deliberately NOT prompt-aware beyond the direction schema:
 * synthesising a full storyboard would fabricate creative decisions and make a mock render look
 * more representative than it is. Anything else returns empty text, which every caller in this
 * pipeline already treats as "unavailable" and handles by failing open.
 */
export function mockLlmResponse(
  systemPrompt: string | undefined,
  _userMessage: string
): {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
} {
  const sys = systemPrompt ?? "";
  const wantsDirection = /styleBible/i.test(sys);
  const text = wantsDirection
    ? JSON.stringify({ styleBible: MOCK_STYLE_BIBLE, beats: [] })
    : "";
  return { text, inputTokens: 0, outputTokens: 0, stopReason: "stop" };
}

// ─── Adapters ────────────────────────────────────────────────────────────────

/**
 * Stands in for any `ProviderAdapter` (69Labs today). Implements the resumable video seam too,
 * so the pipeline takes the SAME submit/poll path it takes in production rather than the
 * legacy no-resume branch — a mock run should rehearse the real control flow.
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly supportsImageGeneration = true;

  async generateVideo(
    params: VideoGenerationParams
  ): Promise<GenerationResult[]> {
    const count = params.count ?? 1;
    return Promise.all(
      Array.from({ length: count }, () =>
        mockClipResult(params.duration ?? 6, params.prompt)
      )
    );
  }

  async generateImage(
    params: ImageGenerationParams
  ): Promise<GenerationResult[]> {
    const count = params.count ?? 1;
    return Promise.all(
      Array.from({ length: count }, () => mockStill(params.prompt))
    );
  }

  async testConnection() {
    return { success: true, message: "mock mode — no provider contacted" };
  }

  async submitVideo(params: VideoGenerationParams) {
    // The duration is encoded in the id: pollVideo gets only the id back, and a mock clip
    // whose length ignored the scene would desync every downstream duration assertion.
    const dur = Math.max(1, Math.round(params.duration ?? 6));
    return {
      success: true,
      taskId: `mock-${dur}-${Math.random().toString(36).slice(2, 10)}`,
    } as any;
  }

  async pollVideo(taskId: string): Promise<GenerationResult> {
    const dur = Number(taskId.split("-")[1]) || 6;
    return mockClipResult(dur, `mock clip ${taskId}`);
  }
}
