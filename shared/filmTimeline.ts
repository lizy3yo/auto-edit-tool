/**
 * shared/filmTimeline.ts — the arithmetic that decides WHERE every frame of a film comes from.
 *
 * Two pure planners, and they live in `shared/` for one reason: the renderer and the browser's
 * live cut preview must not each hold their own idea of the timeline. `server/videoAssembly.ts`
 * runs these to build the MP4, `server/videoTimeline.ts` runs them to place the chapter marks,
 * and `client/src/components/LongformCutPreview.tsx` runs them to play the cut without rendering
 * anything. A reimplementation on either side would drift silently — the preview would show one
 * cut and Reassemble would produce another, which is the exact failure the preview exists to
 * prevent.
 *
 * Both are pure and unit-tested. Nothing here may import from `server/` or `client/`.
 */

/** Frame rate every longform film is encoded at. */
export const FPS = 30;

/**
 * The largest on-screen floor the pipeline can ask for — `HOST_MIN_HOLD_SEC`, the biggest value
 * `floorFor` returns (host 4s, b-roll 3s, fast-open less). Mirrored here because `shared/` cannot
 * import from `server/`; `videoAssembly.test.ts` asserts it still covers every floor.
 *
 * It is the DEFAULT ceiling on a scene's hold when the scene doesn't carry its own `minHoldSec`.
 * Capping by default matters more than it looks: `holdSec` is the narration length measured at
 * TTS time, but the scene ranges are afterwards snapped onto real pauses (`SNAP_TOLERANCE_SEC`,
 * 0.75s), so on an ordinary never-edited scene the measured length routinely exceeds the slice by
 * a fraction of a second. Uncapped, every one of those froze its last frame for the difference
 * and had that much silence spliced into the narration under it. Capping at the largest real
 * floor removes the phantom hold while leaving every genuine one — a sub-floor beat's
 * `audioDuration` already IS its floor, so the cap never bites there.
 */
export const MAX_SCENE_FLOOR_SEC = 4;

/**
 * The CTA QR-block release beat's default frozen tail — the QR stays up this long after the
 * release line so a viewer can still scan it. `longformVideo.ts` owns the value; mirrored here
 * because `shared/` cannot import from `server/`, and `videoTimeline.test.ts` keeps them equal.
 */
export const QR_TAIL_HOLD_SEC = 3;

/**
 * Whether the operator has set this scene's LENGTH by hand — its narration range differs from
 * the pristine one recorded before their first edit (`scene.timingOriginal`).
 *
 * It gates every automatic extension below. A floor and a default tail exist to stop the
 * PIPELINE emitting a beat that flashes past or a QR nobody can scan; neither is a reason to
 * overrule a length a person chose deliberately in the cut room, which enforces its own
 * `MIN_SLICE_SEC` minimum anyway. Before this, cutting a beat to 0.8s left it on screen for 6.3s
 * — the stale measured length floored it back up, and the tail default added three seconds on
 * top of that.
 *
 * Deliberately NOT "has any timing edit": a cut marker or a piece slip doesn't touch the length,
 * so those leave the floor and the tail exactly as they were. Pure — unit-tested.
 */
export function operatorSetLength(scene: {
  narrationStartSec?: number;
  narrationEndSec?: number;
  timingOriginal?: { narrationStartSec?: number; narrationEndSec?: number };
}): boolean {
  const o = scene.timingOriginal;
  if (!o) return false;
  const moved = (now?: number, was?: number) =>
    was !== undefined && Math.abs((now ?? 0) - was) > 1e-6;
  return (
    moved(scene.narrationStartSec, o.narrationStartSec) ||
    moved(scene.narrationEndSec, o.narrationEndSec)
  );
}

/**
 * The hold inputs `planMasterOverlayScenes` needs for one scene, in ONE place so the renderer,
 * the chapter map and the browser's live preview cannot answer differently.
 *
 * Since the freeze-pad was retired this emits only the EXPLICIT holds — the operator's own
 * head/tail holds and the CTA QR linger default — never an automatic floor pad. `floorSec` is
 * kept for signature compatibility (assembly still derives it) but no longer read. Pure —
 * unit-tested.
 */
export function sceneHoldPlan(
  scene: {
    narrationStartSec?: number;
    narrationEndSec?: number;
    audioDuration?: number;
    minHoldSec?: number;
    tailHoldSec?: number;
    headHoldSec?: number;
    qrTail?: boolean;
    coverHero?: boolean;
    timingOriginal?: { narrationStartSec?: number; narrationEndSec?: number };
  },
  floorSec?: number
): {
  holdSec?: number;
  minHoldSec?: number;
  tailHoldSec?: number;
  headHoldSec?: number;
} {
  // A cover reveal ends with its narration and was always exempt; an operator-set length is
  // exempt for the reason above. Both mean: this scene is exactly as long as its slice.
  const exempt = !!scene.coverHero || operatorSetLength(scene);
  return {
    // The automatic freeze-pad is retired: no scene is held past its narration slice, so a beat
    // voiced shorter than its floor cuts when its words end instead of freezing with silence
    // spliced under it. The floors still shape the STORYBOARD (merge/split at scripting time);
    // they no longer stretch the finished film. `holdSec`/`minHoldSec` stay in the return type
    // so the callers' spreads keep compiling, but nothing emits them any more.
    holdSec: undefined,
    minHoldSec: undefined,
    // An explicit hold is the operator's own number and always wins — including 0, which is how
    // they remove the CTA pause. The DEFAULT only applies to a beat they have not re-timed.
    tailHoldSec:
      scene.tailHoldSec ??
      (!exempt && scene.qrTail ? QR_TAIL_HOLD_SEC : undefined),
    headHoldSec: scene.headHoldSec,
  };
}

/**
 * Plan the master-overlay frame timeline: give every scene an exact whole-frame length so the
 * concatenated video reproduces the MASTER narration timeline (each scene's start lands within
 * half a frame of its slice's start — keeps lip-synced host scenes in sync with the untouched
 * master), and collect the silence inserts (hold-floor pads, qrTail holds) the overlay audio
 * must carry where the video intentionally freezes past its narration. Cumulative rounding
 * against the ideal timeline, so error never accumulates. Pure — unit-tested.
 */
export function planMasterOverlayScenes(opts: {
  scenes: {
    /** This scene's slice of the master narration, seconds on the master timeline. */
    sliceStartSec: number;
    sliceEndSec: number;
    /** On-screen hold floor (the scene's floored `audioDurationSec`), if any. */
    holdSec?: number;
    /**
     * The shortest this scene may be on screen (`scene.minHoldSec`). Caps `holdSec`, because
     * `holdSec` carries the narration length MEASURED AT VOICING and that stops describing the
     * scene the moment an operator shortens it: without the cap the stale value out-votes the
     * new slice, the scene holds its old length, silence is spliced into the narration to cover
     * the difference and the film gets LONGER when it was asked to get shorter.
     *
     * Omitted ⇒ capped at `MAX_SCENE_FLOOR_SEC` instead, which is the largest floor the pipeline
     * can ask for. Storyboards written before `minHoldSec` existed land there, and still lose the
     * phantom hold that pause-snapping gives an ordinary scene.
     */
    minHoldSec?: number;
    /** Extra silent frozen tail (the CTA QR release beat). */
    tailHoldSec?: number;
    /** Extra silent frozen hold BEFORE this slice starts — only meaningful on the first scene
     *  (see `sceneTiming.ts`'s `headHoldSec`); an insert at this scene's OWN sliceStartSec. */
    headHoldSec?: number;
  }[];
  fps?: number;
}): {
  scenes: { frames: number; muxDurationSec: number }[];
  /** Silence gaps to insert into the master at `atSec` (master time), ascending. */
  inserts: { atSec: number; durSec: number }[];
  totalSec: number;
} {
  const fps = opts.fps ?? FPS;
  const planned: { frames: number; muxDurationSec: number }[] = [];
  const inserts: { atSec: number; durSec: number }[] = [];
  let idealCum = 0;
  let framesCum = 0;
  for (const s of opts.scenes) {
    const sliceLen = Math.max(0, s.sliceEndSec - s.sliceStartSec);
    const headExtra = s.headHoldSec ?? 0;
    if (headExtra > 1e-3)
      inserts.push({ atSec: s.sliceStartSec, durSec: headExtra });
    // The hold may raise a scene to its FLOOR; it may not pin it to whatever length it happened
    // to be voiced at (see `minHoldSec`).
    const hold = Math.min(s.holdSec ?? 0, s.minHoldSec ?? MAX_SCENE_FLOOR_SEC);
    const target = headExtra + Math.max(sliceLen, hold) + (s.tailHoldSec ?? 0);
    const tailExtra = target - headExtra - sliceLen;
    if (tailExtra > 1e-3)
      inserts.push({ atSec: s.sliceEndSec, durSec: tailExtra });
    idealCum += target;
    const frames = Math.max(1, Math.round(idealCum * fps) - framesCum);
    framesCum += frames;
    // Half-frame midpoint: `-t frames/fps` through decimal rounding can emit frames±1 (the
    // sub-frame drift the old encodedSec re-probe papered over); the midpoint cutoff always
    // emits exactly `frames` frames.
    planned.push({ frames, muxDurationSec: (frames - 0.5) / fps });
  }
  return { scenes: planned, inserts, totalSec: framesCum / fps };
}

export interface ScenePiecePlan {
  /** Footage-seconds where this piece's trim starts (already clamped to the source's length). */
  startSec: number;
  /** This piece's on-screen duration, seconds. */
  durationSec: number;
}

/**
 * The pure math behind a cut scene's per-piece render: where each piece's footage starts and
 * how long it stays on screen. Split out from `buildPiecedSceneVideo` (which just runs ffmpeg
 * per plan entry) so the arithmetic — bounds, override lookup, last-piece absorption, clamping
 * — is unit-testable without IO. See `shared/types.ts` `pieceClipIns` for the semantics. Pure.
 */
/** A piece below this on-screen length is not worth its own encode — merged into its neighbour. */
const MIN_PIECE_SEC = 0.05;

export function planScenePieces(opts: {
  cuts: number[];
  totalDurationSec: number;
  /** The source video's real length, seconds — every start clamps inside it. */
  videoDurationSec: number;
  clipInSec?: number;
  pieceClipIns?: Record<string, number>;
}): ScenePiecePlan[] {
  const { cuts, totalDurationSec, videoDurationSec, clipInSec, pieceClipIns } =
    opts;
  // `totalDurationSec` can exceed the last cut only by a hold-floor/tail (bounds is otherwise
  // in slice-seconds); clamp so a stale cut past a since-shortened slice can't sit beyond it.
  // Then MERGE any bound that doesn't leave the previous one a real (MIN_PIECE_SEC) piece —
  // a stale cut collapsed onto (or past) the end folds into the piece before it instead of
  // producing a near-zero flash frame.
  const raw = [
    0,
    ...cuts.map(c => Math.min(c, totalDurationSec)),
    totalDurationSec,
  ];
  const bounds: number[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] - bounds[bounds.length - 1] >= MIN_PIECE_SEC)
      bounds.push(raw[i]);
  }
  const plan: ScenePiecePlan[] = [];
  let consumed = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const isLast = i === bounds.length - 2;
    // The last piece gets whatever's left, so the pieces always sum to EXACTLY
    // totalDurationSec regardless of float drift or a hold beyond the last cut.
    const durationSec = isLast
      ? Math.max(MIN_PIECE_SEC, totalDurationSec - consumed)
      : bounds[i + 1] - bounds[i];
    consumed += durationSec;
    // Piece 0 has no cut to key an override by — it's governed by the scene's own slip.
    // Later pieces default to CONTINUING the footage (clipIn + how far into the slice this
    // piece starts), unless the operator slipped this specific piece.
    const cutKey = i === 0 ? undefined : String(bounds[i]);
    const override = cutKey ? pieceClipIns?.[cutKey] : undefined;
    const defaultStart = (clipInSec ?? 0) + bounds[i];
    const startSec = Math.max(
      0,
      Math.min(
        override ?? defaultStart,
        Math.max(0, videoDurationSec - MIN_PIECE_SEC)
      )
    );
    plan.push({ startSec, durationSec });
  }
  return plan;
}
