/**
 * server/sceneTiming.ts
 *
 * The operator's CUT ROOM: pure, unit-tested edits to WHEN a scene's picture shows, on top of
 * a narration that never moves.
 *
 * The film is one continuous master narration (its length is the film's length) with each
 * scene's picture laid over its slice of that timeline (`narrationStartSec → narrationEndSec`,
 * see `planMasterOverlayScenes`). A clip shorter than its slice freezes on its last frame; a
 * longer one is cut. That leaves exactly four honest timing edits, none of which re-voice or
 * re-render anything — assembly is the only thing that changes:
 *
 * - TRIM   `clipInSec`: how far into the rendered clip the picture starts ("cut forward").
 * - MOVE   the cut between two neighbours: one runs longer, the other starts later. The
 *          narration under them is untouched, so the film's length is unchanged.
 * - SPLIT  one scene into two at an offset: the second half keeps the same footage, continuing
 *          seamlessly (its `clipInSec` is advanced by the offset), so nothing changes until the
 *          operator regenerates it with a new prompt — the split-then-replace workflow.
 * - HOLD   `tailHoldSec`: freeze the last frame N seconds after the last word while the
 *          narration pauses. This is the CTA QR-block release beat's hard-wired 3 s tail,
 *          exposed (and made removable) for any scene.
 *
 * Every function here mutates the given `scenes` array in place and returns what changed, so
 * the caller (the job's edit session) persists one live document.
 */
import type { StoryboardScene } from "../shared/types";

/** The shortest slice a move or split may leave — below this a cut is a flash. */
export const MIN_SLICE_SEC = 0.5;
/** Upper bound on an operator hold; longer than this reads as a stall, not a beat. */
export const MAX_TAIL_HOLD_SEC = 10;

/** One timing edit on one scene. Every field optional — set only what moved. */
export interface SceneTimingEdit {
  sceneIndex: number;
  /** Seconds into the rendered clip(s) where the picture starts. ≥ 0. */
  clipInSec?: number;
  /** New start of this scene's slice on the master (seconds) — moves the cut with the previous scene. */
  startSec?: number;
  /** New end of this scene's slice on the master — moves the cut with the next scene. */
  endSec?: number;
  /** Silent frozen tail after the last word (0 removes a default hold). */
  tailHoldSec?: number;
}

export type TimingValidation = { ok: true } | { ok: false; reason: string };

const fin = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Round to milliseconds — what ffmpeg's `trim`/`-ss` actually honour; keeps stored values tidy. */
export const roundMs = (v: number): number => Math.round(v * 1000) / 1000;

/** The clip(s) a scene plays — the pair key for "same footage". */
const clipKey = (s: StoryboardScene): string =>
  (s.clipUrls?.length ? s.clipUrls.join("|") : s.clipUrl) ?? "";

/**
 * Whether `a` then `b` are the SAME footage playing CONTINUOUSLY across their shared cut — the
 * state a split leaves behind (both halves are one clip; the second starts exactly where the
 * first stops). When they are, moving the cut between them must carry the footage with it (adjust
 * the shrinking side's `clipInSec`) so the picture flows across the new cut instead of jumping —
 * CapCut's "move the split point". For two DIFFERENT shots, the cut just reallocates narration
 * time and each keeps its own footage. Pure.
 */
export function isContinuousPair(
  a: StoryboardScene,
  b: StoryboardScene
): boolean {
  if (!clipKey(a) || clipKey(a) !== clipKey(b)) return false;
  if (!fin(a.narrationStartSec) || !fin(a.narrationEndSec)) return false;
  const aCovers =
    (a.clipInSec ?? 0) + (a.narrationEndSec - a.narrationStartSec);
  return Math.abs((b.clipInSec ?? 0) - aCovers) < 0.05;
}

/**
 * Whether an edit can be applied to this storyboard as-is. Pure.
 *
 * The rules are the ones the film itself imposes: slices stay contiguous and monotonic (a move
 * shifts the shared boundary with ONE neighbour, never jumps past it), every slice keeps at
 * least `MIN_SLICE_SEC`, the first scene's start and the last scene's end are pinned (the
 * narration starts at 0 and ends where the master does), holds are 0..MAX, trims are ≥ 0.
 */
export function validateTimingEdit(
  scenes: StoryboardScene[],
  edit: SceneTimingEdit
): TimingValidation {
  const at = scenes.findIndex(s => s.index === edit.sceneIndex);
  if (at < 0)
    return { ok: false, reason: `Scene ${edit.sceneIndex} not found` };
  const scene = scenes[at];
  if (edit.clipInSec !== undefined) {
    if (!fin(edit.clipInSec) || edit.clipInSec < 0)
      return { ok: false, reason: "Clip trim must be 0 or more seconds" };
  }
  if (edit.tailHoldSec !== undefined) {
    if (
      !fin(edit.tailHoldSec) ||
      edit.tailHoldSec < 0 ||
      edit.tailHoldSec > MAX_TAIL_HOLD_SEC
    )
      return {
        ok: false,
        reason: `Hold must be between 0 and ${MAX_TAIL_HOLD_SEC} seconds`,
      };
  }
  const wantsMove = edit.startSec !== undefined || edit.endSec !== undefined;
  if (!wantsMove) return { ok: true };
  if (!fin(scene.narrationStartSec) || !fin(scene.narrationEndSec))
    return {
      ok: false,
      reason: `Scene ${edit.sceneIndex} has no narration timing yet — render the film first`,
    };
  const start = edit.startSec ?? scene.narrationStartSec;
  const end = edit.endSec ?? scene.narrationEndSec;
  if (!fin(start) || !fin(end))
    return { ok: false, reason: "Start and end must be numbers" };
  if (end - start < MIN_SLICE_SEC)
    return {
      ok: false,
      reason: `A scene must keep at least ${MIN_SLICE_SEC}s of picture`,
    };
  if (edit.startSec !== undefined) {
    const prev = scenes[at - 1];
    if (!prev) {
      if (Math.abs(edit.startSec - scene.narrationStartSec) > 1e-6)
        return {
          ok: false,
          reason: "The first scene starts where the narration starts",
        };
    } else {
      if (!fin(prev.narrationStartSec))
        return {
          ok: false,
          reason: `Scene ${prev.index} has no narration timing`,
        };
      if (edit.startSec - prev.narrationStartSec < MIN_SLICE_SEC)
        return {
          ok: false,
          reason: `Scene ${prev.index} must keep at least ${MIN_SLICE_SEC}s of picture`,
        };
    }
  }
  if (edit.endSec !== undefined) {
    const next = scenes[at + 1];
    if (!next) {
      if (Math.abs(edit.endSec - scene.narrationEndSec) > 1e-6)
        return {
          ok: false,
          reason: "The last scene ends where the narration ends",
        };
    } else {
      if (!fin(next.narrationEndSec))
        return {
          ok: false,
          reason: `Scene ${next.index} has no narration timing`,
        };
      if (next.narrationEndSec - edit.endSec < MIN_SLICE_SEC)
        return {
          ok: false,
          reason: `Scene ${next.index} must keep at least ${MIN_SLICE_SEC}s of picture`,
        };
    }
  }
  return { ok: true };
}

/**
 * Apply a validated edit in place. Returns the indices of every scene touched (the scene and
 * any neighbour whose boundary moved) so the caller can mark them pending re-assembly.
 *
 * `keepsLipSync`: a lip-synced host clip's frame 0 is the first word of ITS slice, so moving
 * that slice's START by d seconds would play the mouth d seconds out of step with the master
 * narration — the trim is advanced by the same d to keep them locked (moving it earlier than
 * the clip allows clamps at 0; the UI warns). Extending the END freezes the host past their
 * last word — the operator's call, not prevented here.
 */
export function applyTimingEdit(
  scenes: StoryboardScene[],
  edit: SceneTimingEdit,
  opts: { keepsLipSync?: boolean } = {}
): number[] {
  const at = scenes.findIndex(s => s.index === edit.sceneIndex);
  if (at < 0) return [];
  const scene = scenes[at];
  const touched = new Set<number>([scene.index]);
  if (edit.clipInSec !== undefined) scene.clipInSec = roundMs(edit.clipInSec);
  if (edit.tailHoldSec !== undefined)
    scene.tailHoldSec = roundMs(edit.tailHoldSec);
  if (edit.startSec !== undefined && fin(scene.narrationStartSec)) {
    const delta = edit.startSec - scene.narrationStartSec;
    if (Math.abs(delta) > 1e-6) {
      const prev = scenes[at - 1];
      // A continuous pair (a split's two halves) keeps its footage flowing across the moved
      // cut; a lip-synced host keeps its mouth on the words the same way — both mean THIS
      // scene now starts `delta` later/earlier in its own footage.
      const carryFootage =
        edit.clipInSec === undefined &&
        (opts.keepsLipSync || (prev ? isContinuousPair(prev, scene) : false));
      scene.narrationStartSec = roundMs(edit.startSec);
      if (prev) {
        prev.narrationEndSec = scene.narrationStartSec;
        touched.add(prev.index);
      }
      if (carryFootage)
        scene.clipInSec = roundMs(Math.max(0, (scene.clipInSec ?? 0) + delta));
    }
  }
  if (edit.endSec !== undefined && fin(scene.narrationEndSec)) {
    const delta = edit.endSec - scene.narrationEndSec;
    if (Math.abs(delta) > 1e-6) {
      const next = scenes[at + 1];
      const continuous = next ? isContinuousPair(scene, next) : false;
      scene.narrationEndSec = roundMs(edit.endSec);
      if (next) {
        next.narrationStartSec = scene.narrationEndSec;
        // Split pair (or any continuous same-footage pair): the second half starts later/earlier
        // in the FOOTAGE too, so the picture stays continuous across the moved cut.
        if (continuous)
          next.clipInSec = roundMs(Math.max(0, (next.clipInSec ?? 0) + delta));
        touched.add(next.index);
      }
    }
  }
  // Tidy: a trim of 0 / an unset hold are the defaults — don't persist noise.
  if (scene.clipInSec !== undefined && scene.clipInSec <= 0)
    delete scene.clipInSec;
  const touchedList = Array.from(touched);
  for (const i of touchedList) {
    const s = scenes.find(x => x.index === i);
    if (s) s.timingEdited = true;
  }
  return touchedList;
}

/** A scene's operator cut markers, sorted ascending. Offsets in seconds into its slice. */
export function cutPoints(scene: StoryboardScene): number[] {
  return [...(scene.cutPoints ?? [])].sort((a, b) => a - b);
}

/**
 * Whether a cut may be placed at `atOffsetSec` into the scene's slice. A cut is a marker on the
 * ONE clip (CapCut-style) — it doesn't create a scene or change the output — but it must sit
 * clear of both edges and of any existing cut by `MIN_SLICE_SEC`, so the pieces it marks are
 * real. Pure.
 */
export function validateAddCut(
  scenes: StoryboardScene[],
  sceneIndex: number,
  atOffsetSec: number
): TimingValidation {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return { ok: false, reason: `Scene ${sceneIndex} not found` };
  if (!fin(scene.narrationStartSec) || !fin(scene.narrationEndSec))
    return {
      ok: false,
      reason: `Scene ${sceneIndex} has no narration timing yet — render the film first`,
    };
  if (!fin(atOffsetSec))
    return { ok: false, reason: "Cut point must be a number" };
  const len = scene.narrationEndSec - scene.narrationStartSec;
  if (atOffsetSec < MIN_SLICE_SEC || len - atOffsetSec < MIN_SLICE_SEC)
    return {
      ok: false,
      reason: `A cut needs ${MIN_SLICE_SEC}s of clip on each side — cut between ${MIN_SLICE_SEC}s and ${(len - MIN_SLICE_SEC).toFixed(1)}s`,
    };
  if (cutPoints(scene).some(c => Math.abs(c - atOffsetSec) < MIN_SLICE_SEC))
    return {
      ok: false,
      reason: `Too close to an existing cut — keep cuts ${MIN_SLICE_SEC}s apart`,
    };
  return { ok: true };
}

/**
 * Place a cut marker at `atOffsetSec` into the scene's slice, in place (validate first). The
 * clip is unchanged — this only records where the operator cut it, so the timeline shows the
 * division (like CapCut's split). Output is identical until they act on a piece; so this does
 * NOT set `timingEdited` (no reassemble needed). Returns the scene's cut points, or null when
 * the scene is missing. Pure.
 */
export function addCutPoint(
  scenes: StoryboardScene[],
  sceneIndex: number,
  atOffsetSec: number
): number[] | null {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return null;
  const next = Array.from(
    new Set([...cutPoints(scene), roundMs(atOffsetSec)])
  ).sort((a, b) => a - b);
  scene.cutPoints = next;
  return next;
}

/**
 * Whether the cut nearest `fromOffsetSec` may slide to `toOffsetSec` — CapCut's drag-the-cut.
 * Same edge rule as `validateAddCut`, but the cut being dragged is excluded from the
 * too-close-to-another-cut check (it's allowed to pass through its own old position). Pure.
 */
export function validateMoveCut(
  scenes: StoryboardScene[],
  sceneIndex: number,
  fromOffsetSec: number,
  toOffsetSec: number
): TimingValidation {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return { ok: false, reason: `Scene ${sceneIndex} not found` };
  if (!fin(scene.narrationStartSec) || !fin(scene.narrationEndSec))
    return {
      ok: false,
      reason: `Scene ${sceneIndex} has no narration timing yet — render the film first`,
    };
  if (!fin(toOffsetSec))
    return { ok: false, reason: "Cut point must be a number" };
  const moving = nearestCut(scene, fromOffsetSec);
  if (moving === null) return { ok: false, reason: "No cut there to move" };
  const len = scene.narrationEndSec - scene.narrationStartSec;
  if (toOffsetSec < MIN_SLICE_SEC || len - toOffsetSec < MIN_SLICE_SEC)
    return {
      ok: false,
      reason: `A cut needs ${MIN_SLICE_SEC}s of clip on each side — keep it between ${MIN_SLICE_SEC}s and ${(len - MIN_SLICE_SEC).toFixed(1)}s`,
    };
  if (
    cutPoints(scene).some(
      c => c !== moving && Math.abs(c - toOffsetSec) < MIN_SLICE_SEC
    )
  )
    return {
      ok: false,
      reason: `Too close to another cut — keep cuts ${MIN_SLICE_SEC}s apart`,
    };
  return { ok: true };
}

/**
 * Slide the cut nearest `fromOffsetSec` to `toOffsetSec`, in place (validate first). Still just
 * a marker on the one clip — output-neutral, no reassemble. Returns the scene's cut points, or
 * null when the scene or the cut is missing. Pure.
 */
export function moveCutPoint(
  scenes: StoryboardScene[],
  sceneIndex: number,
  fromOffsetSec: number,
  toOffsetSec: number
): number[] | null {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return null;
  const moving = nearestCut(scene, fromOffsetSec);
  if (moving === null) return null;
  const landed = roundMs(toOffsetSec);
  const next = Array.from(
    new Set([...cutPoints(scene).filter(c => c !== moving), landed])
  ).sort((a, b) => a - b);
  scene.cutPoints = next;
  // The piece that starts at this cut keeps its own footage offset — moving the cut re-keys
  // the override rather than losing it (the piece is still "the same piece", just starting at
  // a new on-screen position).
  if (scene.pieceClipIns && String(moving) in scene.pieceClipIns) {
    const rest = { ...scene.pieceClipIns };
    const val = rest[String(moving)];
    delete rest[String(moving)];
    rest[String(landed)] = val;
    scene.pieceClipIns = rest;
  }
  return next;
}

/** The nearest cut to `atOffsetSec` within `MIN_SLICE_SEC`, or null. Pure. */
export function nearestCut(
  scene: StoryboardScene,
  atOffsetSec: number
): number | null {
  let best: number | null = null;
  let bestD = MIN_SLICE_SEC;
  for (const c of cutPoints(scene)) {
    const d = Math.abs(c - atOffsetSec);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/**
 * Remove a cut marker, in place. With `atOffsetSec` given, removes the nearest cut to it;
 * without, clears every cut on the scene ("undo all splits"). Returns the remaining cut points,
 * or null when the scene is missing or there was nothing to remove. Pure.
 */
export function removeCutPoint(
  scenes: StoryboardScene[],
  sceneIndex: number,
  atOffsetSec?: number
): number[] | null {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return null;
  const cuts = cutPoints(scene);
  if (!cuts.length) return null;
  let dropped: number[];
  let next: number[];
  if (atOffsetSec === undefined) {
    dropped = cuts;
    next = [];
  } else {
    const target = nearestCut(scene, atOffsetSec);
    if (target === null) return null;
    dropped = [target];
    next = cuts.filter(c => c !== target);
  }
  scene.cutPoints = next.length ? next : undefined;
  // The piece that started at a removed cut merges back into the piece before it — its own
  // footage offset no longer means anything, so drop it (the merged region just continues
  // whatever the earlier piece was already showing).
  if (scene.pieceClipIns) {
    const rest = { ...scene.pieceClipIns };
    for (const d of dropped) delete rest[String(d)];
    scene.pieceClipIns = Object.keys(rest).length ? rest : undefined;
  }
  return next;
}

/** A piece's own footage offset (its independent "⇄ slip"), or undefined if it follows the
 *  continuous default. Keyed by the cut that starts it. Pure. */
export function pieceClipIn(
  scene: StoryboardScene,
  cutOffsetSec: number
): number | undefined {
  const cut = nearestCut(scene, cutOffsetSec);
  if (cut === null) return undefined;
  return scene.pieceClipIns?.[String(cut)];
}

/**
 * Whether a piece's footage offset may be set. The piece must actually exist — i.e. there is a
 * cut at `cutOffsetSec` that starts it (the FIRST piece, before any cut, has no cut to key by
 * and is governed by the scene's own `clipInSec` instead). `null` clears the override back to
 * the continuous default. Pure.
 */
export function validateSetPieceClipIn(
  scenes: StoryboardScene[],
  sceneIndex: number,
  cutOffsetSec: number,
  clipInSec: number | null
): TimingValidation {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return { ok: false, reason: `Scene ${sceneIndex} not found` };
  if (nearestCut(scene, cutOffsetSec) === null)
    return {
      ok: false,
      reason: "No cut there — split the clip first, then slip the piece",
    };
  if (clipInSec !== null && (!fin(clipInSec) || clipInSec < 0))
    return { ok: false, reason: "Clip position must be 0 or more seconds" };
  return { ok: true };
}

/**
 * Set (or, with `null`, clear) the footage offset for the piece that starts at the cut nearest
 * `cutOffsetSec`, in place (validate first). Unlike a bare cut marker this IS a real output
 * change — the piece may now show different footage than its neighbour — so it marks
 * `timingEdited` (needs Reassemble). Returns whether a piece was found to edit. Pure.
 */
export function setPieceClipIn(
  scenes: StoryboardScene[],
  sceneIndex: number,
  cutOffsetSec: number,
  clipInSec: number | null
): boolean {
  const scene = scenes.find(s => s.index === sceneIndex);
  if (!scene) return false;
  const cut = nearestCut(scene, cutOffsetSec);
  if (cut === null) return false;
  const key = String(cut);
  if (clipInSec === null) {
    if (!scene.pieceClipIns || !(key in scene.pieceClipIns)) return true; // nothing to clear
    const rest = { ...scene.pieceClipIns };
    delete rest[key];
    scene.pieceClipIns = Object.keys(rest).length ? rest : undefined;
  } else {
    scene.pieceClipIns = {
      ...(scene.pieceClipIns ?? {}),
      [key]: roundMs(clipInSec),
    };
  }
  scene.timingEdited = true;
  return true;
}
