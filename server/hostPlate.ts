import { createHash } from "crypto";
import { nanoid } from "nanoid";
import { generateStillWithFallback } from "./providers/fallback";
import { storagePut } from "./storage";
import { ENV } from "./_core/env";
import type { StoryboardScene } from "../shared/types";

/**
 * ── Contextual host plates ───────────────────────────────────────────────────────────────
 *
 * Every audio-driven lip-sync model — HeyGen Avatar IV, fal OmniHuman, WaveSpeed InfiniteTalk
 * — animates the image it is handed. None of them relocate the subject or change the setting.
 * So feeding them the channel's studio headshot yields exactly that: a host talking against a
 * plain backdrop for the whole film, whatever the script is about.
 *
 * A plate is a 16:9 frame of the host IN the scene's setting, generated with the host photo as
 * an identity reference. Hand that to the lip-sync provider instead of the raw headshot and the
 * background comes along for free, because it is part of the frame being animated.
 *
 * Deliberately PROVIDER-INDEPENDENT — it sits in front of `LipsyncLane`, so all three lanes
 * benefit. It also fixes a WaveSpeed quirk: InfiniteTalk follows its input's aspect ratio, so a
 * 16:9 plate makes it emit 16:9 instead of the square it returns for a square headshot.
 *
 * ── Why LOOKS rather than one plate per scene ────────────────────────────────────────────
 *
 * Generated faces drift. Forty independently generated plates give forty subtly different
 * people — the exact failure that sank the EchoMimicV3 experiment — and cost forty images.
 *
 * So host beats are bucketed by narrative position into `HOST_PLATE_LOOKS` looks (default 4),
 * each sharing one plate. Visible variety, cuts that read as intentional, and identity only has
 * to hold across a handful of generated faces instead of forty.
 *
 * Off unless `HOST_PLATES=1`, so nothing changes for an existing setup.
 */

/** True when the host lane should render onto generated plates rather than the raw photo. */
export const hostPlatesEnabled = (): boolean => ENV.hostPlates === "1";

/**
 * Which look a host scene belongs to: its position among HOST scenes bucketed into
 * `HOST_PLATE_LOOKS` groups. Indexing on host position rather than absolute scene index means
 * looks divide the host beats evenly however the b-roll happens to fall. Pure.
 */
export function lookIndexFor(
  hostIndex: number,
  hostCount: number,
  looks: number = ENV.hostPlateLooks
): number {
  const n = Math.max(1, Math.floor(looks));
  if (hostCount <= 1 || n === 1) return 0;
  return Math.min(n - 1, Math.floor(hostIndex / (hostCount / n)));
}

/**
 * The image prompt for a plate. Asks for a WIDE shot with the environment legible, because the
 * setting is the entire point — a tight headshot in a new room is barely different from the
 * headshot we already have.
 *
 * "Do not crop" is load-bearing: image models will happily frame a portrait that cuts the
 * shoulders, and lip-sync models animate whatever they are given, so a bad crop becomes a bad
 * clip rather than a retry.
 */
export function hostPlatePrompt(context: string): string {
  return (
    `Cinematic 16:9 photograph of this exact person — same face, same age, same build. ` +
    `They are in this setting: ${context}. ` +
    `Shown from the waist up, facing the camera directly, calm neutral expression, mouth closed. ` +
    `The environment is clearly visible behind and around them, in focus enough to read. ` +
    `Even, soft, flattering light on the face. Photographic, not illustrated. ` +
    `Do not crop the head or shoulders; leave clear space above the head.`
  );
}

/**
 * Assign every host scene the SETTING its plate should depict, bucketing host beats into looks.
 * Runs in the planning pass beside `assignHostShots`, where the whole scene list is in hand —
 * the clip stage only ever sees one scene at a time.
 *
 * Scenes sharing a look get a byte-identical context string, and that string keys the plate
 * cache, so one image serves the whole look with no separate look id to persist.
 *
 * Context comes from the CUTAWAYS around each look, not the host scenes themselves: a host
 * scene's own `visualPrompt` describes the host ("seated host talks to camera") and says nothing
 * about where they are. The b-roll is what carries the subject matter.
 *
 * Pure apart from writing `scene.hostPlateContext`. Exported for testing.
 */
export function assignHostPlateContexts(
  scenes: StoryboardScene[],
  videoSubject?: string
): void {
  const hosts = scenes.filter(s => s.hostPresent);
  if (!hosts.length) return;

  const fallback = videoSubject?.trim()
    ? `a real working environment relevant to ${videoSubject.trim()}`
    : "a clean, softly lit interior";

  const byLook = new Map<number, StoryboardScene[]>();
  hosts.forEach((s, i) => {
    const look = lookIndexFor(i, hosts.length);
    const bucket = byLook.get(look);
    if (bucket) bucket.push(s);
    else byLook.set(look, [s]);
  });

  for (const lookScenes of Array.from(byLook.values())) {
    const from = lookScenes[0].index;
    const to = lookScenes[lookScenes.length - 1].index;
    // Look one beat past the span too: a host usually introduces the cutaway that follows.
    const cutaway = scenes.find(
      s =>
        !s.hostPresent &&
        s.index >= from &&
        s.index <= to + 2 &&
        (s.visualPrompt ?? "").trim()
    );
    // First clause only — a full enhanced b-roll prompt is ~60 words of camera direction that
    // would fight this prompt's own framing instructions.
    const context = cutaway
      ? cutaway.visualPrompt.trim().split(/[.;]/)[0].slice(0, 160)
      : fallback;
    for (const s of lookScenes) s.hostPlateContext = context;
  }
}

/**
 * In-flight plate generations. Host scenes in a look render concurrently, so without this every
 * scene in a look would generate its own plate — defeating the point and paying N times for one
 * image. Caching the PROMISE means the first scene generates and the rest await that result.
 * ponytail: in-memory. A restart re-generates one plate per look; `scene.hostPlateUrl` is what
 * makes a resumed job reuse the plate it already had.
 */
const _plates = new Map<string, Promise<string>>();

/** Test seam — the cache is process-global, so suites must be able to reset it. */
export function __resetPlateCache(): void {
  _plates.clear();
}

/**
 * Cache key for one plate. The host photo is part of it because a scene pinned to the alt-angle
 * photo (`hostShot === 1`) must plate FROM that photo — otherwise the two-angle cut rhythm the
 * storyboard planned collapses to a single face.
 */
export const plateKey = (
  jobId: number,
  context: string,
  hostShot: 0 | 1
): string =>
  `${jobId}:${createHash("sha1").update(context).digest("hex").slice(0, 12)}:${hostShot}`;

/**
 * Resolve the image a host scene should be lip-synced FROM.
 *
 * Returns `hostPhotoUrl` untouched when plates are off, when the planning pass assigned no
 * context, or when generation fails — a plate is an enhancement, and losing the background is
 * far better than failing the scene over it.
 */
export async function resolveHostPlate(opts: {
  jobId: number;
  scene: StoryboardScene;
  /** The photo this scene is pinned to (primary or alt) — the identity reference. */
  hostPhotoUrl: string;
  apimartKey?: string | null;
}): Promise<string> {
  if (!hostPlatesEnabled()) return opts.hostPhotoUrl;

  // Already plated (including a resumed job) — reuse, never regenerate. A second generation
  // would give this scene a subtly different face from its neighbours in the same look.
  if (opts.scene.hostPlateUrl) return opts.scene.hostPlateUrl;

  const context = opts.scene.hostPlateContext?.trim();
  if (!context) return opts.hostPhotoUrl; // planning pass didn't run (older storyboard)

  const shot = (opts.scene.hostShot === 1 ? 1 : 0) as 0 | 1;
  const key = plateKey(opts.jobId, context, shot);

  let pending = _plates.get(key);
  if (!pending) {
    pending = (async () => {
      const img = await generateStillWithFallback({
        prompt: hostPlatePrompt(context),
        referenceImageUrl: opts.hostPhotoUrl,
        apimartKey: opts.apimartKey,
      });
      if (!img.success || !img.fileData)
        throw new Error(img.error || "plate generation returned no image");
      const { url } = await storagePut(
        `longform/${opts.jobId}/host-plate-${shot}-${nanoid(8)}.png`,
        Buffer.from(img.fileData as Buffer),
        "image/png"
      );
      console.log(
        `[HostPlate] job ${opts.jobId} shot ${shot}: ${context.slice(0, 70)}`
      );
      return url;
    })();
    // Drop a failed generation so the next scene retries rather than caching the rejection.
    pending.catch(() => _plates.delete(key));
    _plates.set(key, pending);
  }

  try {
    const url = await pending;
    opts.scene.hostPlateUrl = url;
    return url;
  } catch (err: any) {
    console.warn(
      `[HostPlate] job ${opts.jobId} scene ${opts.scene.index} falling back to the raw host photo: ${err?.message ?? err}`
    );
    return opts.hostPhotoUrl;
  }
}
