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
 * - HEAD HOLD `headHoldSec`: the mirror of `tailHoldSec`, at the front instead of the back —
 *          freeze the FIRST scene's own first frame for N seconds before its first word. Only
 *          the first scene qualifies: every other scene's start is a shared boundary with a
 *          neighbour (MOVE, above); the first scene has no neighbour before it, so a pause
 *          there can only come from holding on its own opening frame. Extends the film's total
 *          runtime at the front; the master narration itself never moves.
 *
 * Every function here mutates the given `scenes` array in place and returns what changed, so
 * the caller (the job's edit session) persists one live document.
 */
import type { StoryboardScene } from "../shared/types";

/** The shortest slice a move or split may leave — below this a cut is a flash. */
export const MIN_SLICE_SEC = 0.5;
/** Upper bound on an operator hold; longer than this reads as a stall, not a beat. */
export const MAX_TAIL_HOLD_SEC = 10;
/** Same ceiling, for the head hold — kept as a separate constant since the two are independent. */
export const MAX_HEAD_HOLD_SEC = 10;

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
  /** Silent frozen hold before the FIRST scene's own first word (0 removes it). First scene only. */
  headHoldSec?: number;
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
  if (edit.headHoldSec !== undefined) {
    if (
      !fin(edit.headHoldSec) ||
      edit.headHoldSec < 0 ||
      edit.headHoldSec > MAX_HEAD_HOLD_SEC
    )
      return {
        ok: false,
        reason: `Hold must be between 0 and ${MAX_HEAD_HOLD_SEC} seconds`,
      };
    if (scenes[at - 1])
      return {
        ok: false,
        reason: "Only the first scene can hold before it starts",
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
  // Preserve the pristine cut before the first edit lands on it. Both neighbours too: a boundary
  // is shared, so a move here rewrites one of theirs, and a scene whose stored timing changed
  // without a snapshot could never be reverted.
  snapshotTiming(scene);
  if (edit.startSec !== undefined && scenes[at - 1])
    snapshotTiming(scenes[at - 1]);
  if (edit.endSec !== undefined && scenes[at + 1])
    snapshotTiming(scenes[at + 1]);
  const touched = new Set<number>([scene.index]);
  if (edit.clipInSec !== undefined) scene.clipInSec = roundMs(edit.clipInSec);
  if (edit.tailHoldSec !== undefined)
    scene.tailHoldSec = roundMs(edit.tailHoldSec);
  if (edit.headHoldSec !== undefined)
    scene.headHoldSec = roundMs(edit.headHoldSec);
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
  snapshotTiming(scene);
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
 * Slide the cut nearest `fromOffsetSec` to `toOffsetSec`, in place (validate first).
 *
 * A cut with nothing slipped on either side is a pure marker: every piece continues the same
 * footage, so dragging it changes where the timeline draws a line and nothing else — no
 * `timingEdited`, no reassemble.
 *
 * The moment a piece HAS been slipped, that stops being true. The slipped piece now starts at a
 * different on-screen moment and runs for a different length, and the piece after it re-derives
 * its own continuous default (`clipInSec + bounds[i]`) from the new position — both real changes
 * to the rendered film. So a move that carries a slip across DOES mark `timingEdited`, and the
 * operator gets the "Reassemble to apply" notice instead of a film that quietly no longer
 * matches its own timeline.
 *
 * Returns the scene's cut points, or null when the scene or the cut is missing. Pure.
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
  snapshotTiming(scene);
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
    scene.timingEdited = true;
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
  snapshotTiming(scene);
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
    const before = Object.keys(rest).length;
    for (const d of dropped) delete rest[String(d)];
    scene.pieceClipIns = Object.keys(rest).length ? rest : undefined;
    // Dropping a slip is an output change in the other direction: the region reverts to the
    // continuous footage it was slipped away from. Same reasoning as `moveCutPoint` — removing
    // a bare marker stays free, removing a slipped one needs a reassemble.
    if (Object.keys(rest).length !== before) scene.timingEdited = true;
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
  snapshotTiming(scene);
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

/**
 * Record a scene's cut-room state before it is first changed — what "Revert to original" puts
 * back. A no-op once a snapshot exists: the point is the PRISTINE cut, not one step of undo, so
 * the second edit must not overwrite what the first one preserved.
 *
 * Every mutating function below calls this before it touches anything. `applyTimingEdit` calls
 * it for the neighbour too, because moving a cut moves both sides of that boundary.
 *
 * Nothing else keeps these values: the narration ranges come from whisperx at voicing time and
 * are written straight onto the scene, and the word timings behind them are not persisted. Miss
 * the snapshot and the original is gone for good. Pure.
 */
export function snapshotTiming(scene: StoryboardScene): void {
  if (scene.timingOriginal) return;
  scene.timingOriginal = {
    narrationStartSec: scene.narrationStartSec,
    narrationEndSec: scene.narrationEndSec,
    clipInSec: scene.clipInSec,
    tailHoldSec: scene.tailHoldSec,
    headHoldSec: scene.headHoldSec,
    cutPoints: scene.cutPoints ? [...scene.cutPoints] : undefined,
    pieceClipIns: scene.pieceClipIns ? { ...scene.pieceClipIns } : undefined,
  };
}

/** Drop a scene's snapshot — its edges no longer describe anything real (a re-voice). Pure. */
export function forgetTimingSnapshot(scene: StoryboardScene): void {
  delete scene.timingOriginal;
}

/** Assign `v` to `scene[key]`, deleting the field when the original had nothing there. */
function restore<K extends keyof StoryboardScene>(
  scene: StoryboardScene,
  key: K,
  v: StoryboardScene[K] | undefined
): void {
  if (v === undefined) delete scene[key];
  else scene[key] = v;
}

/** What a revert actually managed to put back. */
export interface TimingRevert {
  ok: boolean;
  /** Why it was refused (`ok` false), or — on success — a note about what moved with it. */
  reason?: string;
  /** Indices whose stored timing changed — the caller marks these for re-assembly. */
  touched: number[];
}

/**
 * Revert ONE scene to its snapshot.
 *
 * The scene's own settings — trim, cut markers, per-piece slips, both holds — come back and
 * nothing else moves.
 *
 * Its START and END are different: each is a boundary SHARED with a neighbour, one line both
 * scenes sit against, so putting it back necessarily moves that neighbour's opposite edge too.
 * That is safe, and provably so rather than by luck: a boundary is only ever moved by
 * `applyTimingEdit`, which snapshots BOTH scenes before it moves anything, and the board is
 * tiled at that moment — so the neighbour's recorded edge and this scene's recorded edge are the
 * same number. Restoring it puts each of the two back to its OWN original; it cannot destroy
 * anything except the edge move itself, which is the thing being reverted. The neighbour keeps
 * its own snapshot, so it can still be reverted in full afterwards.
 *
 * (An earlier draft refused the edge whenever the neighbour had a snapshot of its own. That
 * turned out to be useless: the very edit that moves a boundary snapshots the neighbour, so the
 * ordinary case — move one cut, take it back — would never have restored anything.)
 *
 * `touched` names every scene whose stored timing changed, so the caller can tell the operator a
 * neighbour moved with it. Mutates in place. Pure.
 */
export function revertSceneTiming(
  scenes: StoryboardScene[],
  sceneIndex: number
): TimingRevert {
  const at = scenes.findIndex(s => s.index === sceneIndex);
  if (at < 0)
    return { ok: false, reason: `Scene ${sceneIndex} not found`, touched: [] };
  const scene = scenes[at];
  const original = scene.timingOriginal;
  if (!original)
    return {
      ok: false,
      reason: `Scene ${sceneIndex} has no timing edits to revert`,
      touched: [],
    };

  const touched = new Set<number>([sceneIndex]);

  // 1. This scene's own settings.
  restore(scene, "clipInSec", original.clipInSec);
  restore(scene, "tailHoldSec", original.tailHoldSec);
  restore(scene, "headHoldSec", original.headHoldSec);
  restore(
    scene,
    "cutPoints",
    original.cutPoints ? [...original.cutPoints] : undefined
  );
  restore(
    scene,
    "pieceClipIns",
    original.pieceClipIns ? { ...original.pieceClipIns } : undefined
  );

  // 2. The shared edges, each carrying its neighbour's opposite edge so the board stays tiled.
  const moved: number[] = [];
  const prev = scenes[at - 1];
  if (
    fin(original.narrationStartSec) &&
    Math.abs((scene.narrationStartSec ?? 0) - original.narrationStartSec) > 1e-6
  ) {
    scene.narrationStartSec = original.narrationStartSec;
    if (prev) {
      prev.narrationEndSec = original.narrationStartSec;
      touched.add(prev.index);
      moved.push(prev.index);
    }
  }
  const next = scenes[at + 1];
  if (
    fin(original.narrationEndSec) &&
    Math.abs((scene.narrationEndSec ?? 0) - original.narrationEndSec) > 1e-6
  ) {
    scene.narrationEndSec = original.narrationEndSec;
    if (next) {
      next.narrationStartSec = original.narrationEndSec;
      touched.add(next.index);
      moved.push(next.index);
    }
  }

  delete scene.timingOriginal;
  const list = Array.from(touched);
  for (const i of list) {
    const t = scenes.find(x => x.index === i);
    if (t) t.timingEdited = true;
  }
  return {
    ok: true,
    reason: moved.length
      ? `Scene ${moved.join(" and ")} moved with it — the cut between them is one boundary.`
      : undefined,
    touched: list,
  };
}

/**
 * Revert EVERY snapshotted scene at once — the whole job back to its pristine cut.
 *
 * Safe where the per-scene revert has to be careful: this restores a board state that was
 * already consistent, so every shared edge moves on both sides at the same time and the
 * narration cannot end up with a gap or an overlap. Mutates in place. Pure.
 */
export function revertAllSceneTiming(scenes: StoryboardScene[]): TimingRevert {
  const edited = scenes.filter(s => s.timingOriginal);
  if (!edited.length)
    return { ok: false, reason: "No timing edits to revert", touched: [] };
  for (const scene of edited) {
    const o = scene.timingOriginal!;
    restore(scene, "narrationStartSec", o.narrationStartSec);
    restore(scene, "narrationEndSec", o.narrationEndSec);
    restore(scene, "clipInSec", o.clipInSec);
    restore(scene, "tailHoldSec", o.tailHoldSec);
    restore(scene, "headHoldSec", o.headHoldSec);
    restore(scene, "cutPoints", o.cutPoints ? [...o.cutPoints] : undefined);
    restore(
      scene,
      "pieceClipIns",
      o.pieceClipIns ? { ...o.pieceClipIns } : undefined
    );
    delete scene.timingOriginal;
    scene.timingEdited = true;
  }
  return { ok: true, touched: edited.map(s => s.index) };
}
