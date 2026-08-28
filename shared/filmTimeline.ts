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
    const target =
      headExtra + Math.max(sliceLen, s.holdSec ?? 0) + (s.tailHoldSec ?? 0);
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
