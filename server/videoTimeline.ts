/**
 * server/videoTimeline.ts — where each kind of shot lands in the finished film.
 *
 * The storyboard already records what every scene IS (host, split, still, asset, QR, cover) and
 * where its narration sits on the master timeline. What it has never done is say where a scene
 * lands in the finished MP4 — which is what an operator needs to check "did the split screen come
 * out right?" without scrubbing.
 *
 * Timestamps are derived with `planMasterOverlayScenes`, the SAME function assembly uses to lay
 * scenes onto the timeline, so they are frame-accurate against the actual file rather than a
 * plausible re-derivation. Scenes freeze-hold past their narration (the sub-floor pad, the QR
 * release tail); summing narration lengths alone would drift late by exactly those pads.
 *
 * Pure — no IO, unit-tested.
 */
import type { StoryboardScene } from "../shared/types";
import { planMasterOverlayScenes } from "./videoAssembly";

/** What a viewer sees during a stretch of the film. Ordered roughly by how much it stands out. */
export type ShotKind =
  | "host" // full-frame talking head
  | "split" // host + a still beside them
  | "splitMotion" // host + a MOVING clip beside them
  | "video" // full-frame moving b-roll
  | "still" // full-frame still with a pan/zoom
  | "asset" // an operator-uploaded image, shown as-is
  | "cover" // the book cover reveal
  | "qrHero"; // the big centred QR

export interface TimelineEntry {
  /** 1-based scene index, so a row maps back to the storyboard row the operator can edit. */
  index: number;
  startSec: number;
  endSec: number;
  kind: ShotKind;
  /** `m:ss` of `startSec` — YouTube chapter format, and what the UI shows. */
  timecode: string;
  /** True while this beat carries the small corner QR (independent of `kind`). */
  qrCorner: boolean;
  /** True while this beat is inside a CTA pitch. */
  cta: boolean;
  /** Set on an asset beat: which upload, and its burned-in caption. */
  assetImageUrl?: string;
  assetCaption?: string;
  /** First words of the narration, so a row is recognisable at a glance. */
  narration: string;
}

/**
 * Classify one scene. Order matters: the specific, deliberately-placed beats (asset, cover, big
 * QR) win over the register they are technically rendered on, because that is what the operator
 * is looking for when they scan the list.
 */
export function classifyShot(scene: StoryboardScene): ShotKind {
  if (scene.assetImageUrl) return "asset";
  if (scene.coverHero) return "cover";
  if (scene.qrHero) return "qrHero";
  if (scene.hostPresent) {
    if (!scene.splitVisual) return "host";
    return scene.splitMotion ? "splitMotion" : "split";
  }
  return scene.stillImage ? "still" : "video";
}

/** `m:ss` (or `h:mm:ss` past an hour) — the format YouTube parses as a chapter marker. */
export function formatTimecode(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Seconds a scene occupies on the FINISHED timeline, for the per-scene concat path (no master
 * overlay). Mirrors `assemblePerSceneFilm`'s own `durationSec`: the held length plus any tail.
 */
const fallbackDurationSec = (s: StoryboardScene): number =>
  Math.max(0, s.audioDuration ?? 0) + (s.qrTail ? QR_TAIL_HOLD_SEC : 0);

/**
 * `QR_TAIL_HOLD_SEC` lives in longformVideo.ts, which imports this file's sibling — importing it
 * here would close a cycle. It is a fixed constant, so it is mirrored with a test asserting the
 * two stay equal.
 */
export const QR_TAIL_HOLD_SEC = 3;

/**
 * Build the timeline for a finished (or partly finished) render.
 *
 * Uses the master-overlay plan when every scene carries its narration slice — that is the mode
 * production renders use, and it is frame-exact. Falls back to summing held durations for a job
 * that was re-voiced off-master, which is the same thing assembly does in that case.
 *
 * Scenes with no measured duration are skipped rather than emitted at zero length: they never
 * reached the file either.
 */
export function buildVideoTimeline(scenes: StoryboardScene[]): TimelineEntry[] {
  const usable = scenes
    .filter(s => (s.audioDuration ?? 0) > 0)
    .sort((a, b) => a.index - b.index);
  if (usable.length === 0) return [];

  const overlayReady = usable.every(
    s =>
      Number.isFinite(s.narrationStartSec as number) &&
      Number.isFinite(s.narrationEndSec as number)
  );

  const durations: number[] = overlayReady
    ? planMasterOverlayScenes({
        scenes: usable.map(s => ({
          sliceStartSec: s.narrationStartSec as number,
          sliceEndSec: s.narrationEndSec as number,
          holdSec: s.coverHero ? undefined : s.audioDuration,
          tailHoldSec: s.qrTail ? QR_TAIL_HOLD_SEC : undefined,
        })),
      }).scenes.map(p => p.muxDurationSec)
    : usable.map(fallbackDurationSec);

  const out: TimelineEntry[] = [];
  let cursor = 0;
  usable.forEach((s, i) => {
    const startSec = cursor;
    cursor += durations[i] ?? 0;
    out.push({
      index: s.index,
      startSec: Math.round(startSec * 100) / 100,
      endSec: Math.round(cursor * 100) / 100,
      kind: classifyShot(s),
      timecode: formatTimecode(startSec),
      qrCorner: !!s.qrCorner,
      cta: !!s.cta,
      assetImageUrl: s.assetImageUrl,
      assetCaption: s.assetCaption,
      narration: (s.scriptText ?? s.narration ?? "").slice(0, 90),
    });
  });
  return out;
}

/** Human label for a shot kind, shared by the UI and the generated description. */
export const SHOT_LABELS: Record<ShotKind, string> = {
  host: "Host",
  split: "Split screen — host + still",
  splitMotion: "Split screen — host + video",
  video: "B-roll video",
  still: "Still image",
  asset: "Your asset",
  cover: "Book cover",
  qrHero: "Big QR",
};

/**
 * Collapse the timeline into consecutive runs of the same kind.
 *
 * A 12-minute film is ~90 scenes, and a 90-row list is not something anyone reads. Runs are what
 * an operator actually looks for — "the split screen at 2:14", not each of the four scenes that
 * make it up. The per-scene detail stays available underneath.
 */
export function summarizeTimeline(entries: TimelineEntry[]): {
  startSec: number;
  endSec: number;
  kind: ShotKind;
  timecode: string;
  scenes: number[];
}[] {
  const runs: {
    startSec: number;
    endSec: number;
    kind: ShotKind;
    timecode: string;
    scenes: number[];
  }[] = [];
  for (const e of entries) {
    const last = runs[runs.length - 1];
    if (last && last.kind === e.kind) {
      last.endSec = e.endSec;
      last.scenes.push(e.index);
    } else {
      runs.push({
        startSec: e.startSec,
        endSec: e.endSec,
        kind: e.kind,
        timecode: e.timecode,
        scenes: [e.index],
      });
    }
  }
  return runs;
}
