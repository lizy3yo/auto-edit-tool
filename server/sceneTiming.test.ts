import { describe, it, expect } from "vitest";
import {
  validateTimingEdit,
  applyTimingEdit,
  isContinuousPair,
  validateAddCut,
  addCutPoint,
  removeCutPoint,
  cutPoints,
  nearestCut,
  validateMoveCut,
  moveCutPoint,
  pieceClipIn,
  validateSetPieceClipIn,
  setPieceClipIn,
  snapshotTiming,
  forgetTimingSnapshot,
  revertSceneTiming,
  revertAllSceneTiming,
  MIN_SLICE_SEC,
} from "./sceneTiming";
import type { StoryboardScene } from "../shared/types";

/** Three contiguous scenes on a 30 s master: [0,10) [10,20) [20,30). */
const board = (): StoryboardScene[] =>
  [0, 1, 2].map(i => ({
    index: i + 1,
    narration: `line ${i + 1}`,
    scriptText: `one two three four five six seven eight nine ten`,
    visualPrompt: `p${i + 1}`,
    hostPresent: false,
    clipUrl: `https://x/${i + 1}.mp4`,
    clipUrls: [`https://x/${i + 1}.mp4`],
    sceneStatus: "completed",
    narrationStartSec: i * 10,
    narrationEndSec: (i + 1) * 10,
    audioDuration: 10,
  })) as StoryboardScene[];

describe("validateTimingEdit", () => {
  it("accepts a trim and a hold in range", () => {
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, clipInSec: 1.5 })
    ).toEqual({ ok: true });
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, tailHoldSec: 0 })
    ).toEqual({ ok: true });
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, tailHoldSec: 10 })
    ).toEqual({ ok: true });
  });

  it("rejects a negative trim and an out-of-range hold", () => {
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, clipInSec: -1 }).ok
    ).toBe(false);
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, tailHoldSec: 11 }).ok
    ).toBe(false);
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, tailHoldSec: -0.1 }).ok
    ).toBe(false);
  });

  it("rejects an unknown scene", () => {
    expect(validateTimingEdit(board(), { sceneIndex: 9 }).ok).toBe(false);
  });

  // The cut between two scenes can move either way, but never past the neighbour's own floor.
  it("lets a boundary move within both neighbours' floors", () => {
    expect(validateTimingEdit(board(), { sceneIndex: 2, startSec: 8 })).toEqual(
      { ok: true }
    );
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, startSec: 12 })
    ).toEqual({ ok: true });
    expect(validateTimingEdit(board(), { sceneIndex: 2, endSec: 29 })).toEqual({
      ok: true,
    });
    // Scene 1 would keep < MIN_SLICE_SEC.
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, startSec: 0.2 }).ok
    ).toBe(false);
    // Scene 3 would keep < MIN_SLICE_SEC.
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, endSec: 29.8 }).ok
    ).toBe(false);
    // Scene 2 itself would keep < MIN_SLICE_SEC.
    expect(
      validateTimingEdit(board(), { sceneIndex: 2, startSec: 19.8 }).ok
    ).toBe(false);
  });

  it("pins the first start and the last end to the narration", () => {
    expect(validateTimingEdit(board(), { sceneIndex: 1, startSec: 1 }).ok).toBe(
      false
    );
    expect(validateTimingEdit(board(), { sceneIndex: 3, endSec: 29 }).ok).toBe(
      false
    );
    expect(validateTimingEdit(board(), { sceneIndex: 1, startSec: 0 })).toEqual(
      { ok: true }
    );
  });

  it("refuses a move on a scene without narration timing", () => {
    const b = board();
    delete b[1].narrationStartSec;
    expect(validateTimingEdit(b, { sceneIndex: 2, endSec: 18 }).ok).toBe(false);
    // A trim/hold is still fine — it doesn't need the timeline.
    expect(validateTimingEdit(b, { sceneIndex: 2, clipInSec: 1 })).toEqual({
      ok: true,
    });
  });
});

describe("applyTimingEdit", () => {
  it("moves the shared boundary on BOTH neighbours and marks both pending", () => {
    const b = board();
    const touched = applyTimingEdit(b, { sceneIndex: 2, startSec: 8 });
    expect(touched.sort()).toEqual([1, 2]);
    expect(b[0].narrationEndSec).toBe(8);
    expect(b[1].narrationStartSec).toBe(8);
    expect(b[0].timingEdited).toBe(true);
    expect(b[1].timingEdited).toBe(true);
    expect(b[2].timingEdited).toBeUndefined();
  });

  it("moves the end boundary with the next scene", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, endSec: 23.25 });
    expect(b[1].narrationEndSec).toBe(23.25);
    expect(b[2].narrationStartSec).toBe(23.25);
  });

  it("sets trim and hold, and drops a zero trim rather than persisting noise", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 2.5, tailHoldSec: 0 });
    expect(b[1].clipInSec).toBe(2.5);
    expect(b[1].tailHoldSec).toBe(0); // 0 is meaningful: "remove the default hold"
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 0 });
    expect(b[1].clipInSec).toBeUndefined();
  });

  // A lip-synced host's frame 0 is the first word of ITS slice: moving the start later by d
  // without trimming d would play the mouth d seconds early against the master narration.
  it("keeps a lip-synced host in sync by advancing the trim with a later start", () => {
    const b = board();
    applyTimingEdit(
      b,
      { sceneIndex: 2, startSec: 11.5 },
      { keepsLipSync: true }
    );
    expect(b[1].narrationStartSec).toBe(11.5);
    expect(b[1].clipInSec).toBe(1.5);
    // Moving it back earlier than the clip allows clamps at 0 (can't invent footage).
    applyTimingEdit(b, { sceneIndex: 2, startSec: 9 }, { keepsLipSync: true });
    expect(b[1].clipInSec).toBeUndefined(); // 1.5 - 2.5 → clamped to 0 → dropped
  });

  it("does not touch the trim of a b-roll scene on a start move", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, startSec: 11.5 });
    expect(b[1].clipInSec).toBeUndefined();
  });

  it("rounds to milliseconds", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 1.23456789 });
    expect(b[1].clipInSec).toBe(1.235);
  });
});

describe("continuous-pair cuts (CapCut split-then-move)", () => {
  // A split leaves two halves of one clip playing continuously: [10,15) clipIn 0 and
  // [15,20) clipIn 5. board() has 3 SEPARATE clips, so build the split pair explicitly.
  const splitPair = (): StoryboardScene[] => {
    const b = board();
    b[1].clipUrl = b[0].clipUrl; // scenes 1 & 2 are the SAME footage…
    b[1].clipUrls = [...(b[0].clipUrls as string[])];
    b[0].clipInSec = 0; // …playing continuously: 0→10 then 10→20
    b[1].clipInSec = 10;
    return b;
  };

  it("recognises a continuous same-footage pair and rejects unrelated shots", () => {
    const b = splitPair();
    expect(isContinuousPair(b[0], b[1])).toBe(true);
    // Scene 3 is a different clip.
    expect(isContinuousPair(b[1], b[2])).toBe(false);
    // Same clip but NOT continuous (a gap in footage) ⇒ not a pair.
    b[1].clipInSec = 3;
    expect(isContinuousPair(b[0], b[1])).toBe(false);
  });

  it("carries the second half's footage when the shared cut moves later (end drag)", () => {
    const b = splitPair();
    applyTimingEdit(b, { sceneIndex: 1, endSec: 12 });
    expect(b[0].narrationEndSec).toBe(12);
    expect(b[1].narrationStartSec).toBe(12);
    // Second half now starts 2s later in the FOOTAGE too → still continuous, no jump.
    expect(b[1].clipInSec).toBe(12);
    expect(isContinuousPair(b[0], b[1])).toBe(true);
  });

  it("carries the footage when the cut moves earlier from the second half (start drag)", () => {
    const b = splitPair(); // scene 2 is [10,20), clipIn 10
    applyTimingEdit(b, { sceneIndex: 2, startSec: 8 });
    expect(b[0].narrationEndSec).toBe(8);
    expect(b[1].narrationStartSec).toBe(8);
    expect(b[1].clipInSec).toBe(8); // 10 + (8 - 10)
    expect(isContinuousPair(b[0], b[1])).toBe(true);
  });

  it("does NOT touch clipIn when the cut is between two DIFFERENT shots", () => {
    const b = board(); // 3 separate clips
    applyTimingEdit(b, { sceneIndex: 2, endSec: 22 });
    expect(b[1].narrationEndSec).toBe(22);
    expect(b[2].narrationStartSec).toBe(22);
    expect(b[2].clipInSec).toBeUndefined(); // each shot keeps its own footage
  });
});

describe("cut markers (CapCut-style split)", () => {
  it("accepts a cut clear of the edges", () => {
    expect(validateAddCut(board(), 2, 5)).toEqual({ ok: true });
    expect(validateAddCut(board(), 2, MIN_SLICE_SEC)).toEqual({ ok: true });
    expect(validateAddCut(board(), 2, 0.2).ok).toBe(false);
    expect(validateAddCut(board(), 2, 9.8).ok).toBe(false);
    expect(validateAddCut(board(), 9, 5).ok).toBe(false);
  });

  it("refuses a cut too close to an existing one", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(validateAddCut(b, 2, 5.3).ok).toBe(false); // within MIN_SLICE_SEC
    expect(validateAddCut(b, 2, 6).ok).toBe(true);
  });

  it("adds cuts sorted and de-duplicated, without creating a scene or renumbering", () => {
    const b = board();
    const before = b.length;
    addCutPoint(b, 2, 6);
    addCutPoint(b, 2, 3);
    addCutPoint(b, 2, 3); // dupe
    expect(b).toHaveLength(before); // no new scene
    expect(b.map(s => s.index)).toEqual([1, 2, 3]); // no renumber
    expect(b[1].cutPoints).toEqual([3, 6]);
    // The clip is untouched — output-neutral, so no reassemble flag.
    expect(b[1].timingEdited).toBeUndefined();
    expect(b[1].clipUrl).toBe("https://x/2.mp4");
  });

  it("reads a scene's cut points sorted", () => {
    const b = board();
    b[1].cutPoints = [6, 3];
    expect(cutPoints(b[1])).toEqual([3, 6]);
    expect(cutPoints(b[0])).toEqual([]);
  });

  it("removes the nearest cut, and clears all when no offset is given", () => {
    const b = board();
    addCutPoint(b, 2, 3);
    addCutPoint(b, 2, 6);
    removeCutPoint(b, 2, 3.1); // nearest to 3
    expect(b[1].cutPoints).toEqual([6]);
    removeCutPoint(b, 2); // clear the rest
    expect(b[1].cutPoints).toBeUndefined();
  });

  it("nearestCut finds a cut within tolerance only", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(nearestCut(b[1], 5.2)).toBe(5);
    expect(nearestCut(b[1], 8)).toBeNull();
  });

  it("returns null removing from a scene with no cuts", () => {
    expect(removeCutPoint(board(), 2, 5)).toBeNull();
  });
});

describe("moving a cut (CapCut's drag-the-split-point)", () => {
  it("slides a cut to a new position", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(validateMoveCut(b, 2, 5, 7)).toEqual({ ok: true });
    const cuts = moveCutPoint(b, 2, 5, 7);
    expect(cuts).toEqual([7]);
    expect(b[1].cutPoints).toEqual([7]);
  });

  it("finds the cut nearest the drag start, not an exact match", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    moveCutPoint(b, 2, 5.2, 8); // 5.2 is within tolerance of the cut at 5
    expect(b[1].cutPoints).toEqual([8]);
  });

  it("refuses to move past the slice edges", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(validateMoveCut(b, 2, 5, 0.2).ok).toBe(false);
    expect(validateMoveCut(b, 2, 5, 9.8).ok).toBe(false);
  });

  it("refuses to move on top of ANOTHER cut, but allows passing through its own start", () => {
    const b = board();
    addCutPoint(b, 2, 3);
    addCutPoint(b, 2, 7);
    // Moving the cut at 3 close to the OTHER cut at 7 is refused.
    expect(validateMoveCut(b, 2, 3, 6.8).ok).toBe(false);
    // Moving it to exactly where it already is (its own position) is fine.
    expect(validateMoveCut(b, 2, 3, 3)).toEqual({ ok: true });
    // And it can cross freely as long as it lands clear of the other cut.
    expect(validateMoveCut(b, 2, 3, 4.5)).toEqual({ ok: true });
  });

  it("returns null when there is no cut near the given start", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(moveCutPoint(b, 2, 1, 8)).toBeNull();
    expect(b[1].cutPoints).toEqual([5]); // untouched
  });

  it("stays output-neutral while nothing is slipped: no timingEdited flag", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    moveCutPoint(b, 2, 5, 7);
    expect(b[1].timingEdited).toBeUndefined();
  });

  it("DOES need a reassemble once it drags a slipped piece with it", () => {
    // Dragging a cut that starts a slipped piece changes where that piece begins on screen and
    // how long it runs, and re-derives the next piece's continuous default from the new
    // position. Both reach the rendered film, so the operator has to be told.
    const b = board();
    addCutPoint(b, 2, 5);
    setPieceClipIn(b, 2, 5, 12);
    delete b[1].timingEdited; // pretend the slip was already reassembled
    moveCutPoint(b, 2, 5, 7);
    expect(b[1].pieceClipIns).toEqual({ "7": 12 }); // the slip followed its piece
    expect(b[1].timingEdited).toBe(true);
  });

  it("de-duplicates if moved exactly onto a position already vacated in the same call", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    addCutPoint(b, 2, 8);
    // Move 5 -> 8 is refused by validation (too close), but moveCutPoint itself is defensive:
    // exercise it directly to confirm it de-dupes rather than producing [8, 8].
    moveCutPoint(b, 2, 5, 8);
    expect(b[1].cutPoints).toEqual([8]);
  });
});

describe("per-piece footage offset (independent trim after a cut)", () => {
  it("reads undefined for a piece with no override — the continuous default", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(pieceClipIn(b[1], 5)).toBeUndefined();
  });

  it("refuses to set a piece offset where there is no cut", () => {
    const b = board();
    expect(validateSetPieceClipIn(b, 2, 5, 3).ok).toBe(false);
    // The FIRST piece (offset 0, no cut) is governed by clipInSec, not this — refused too.
    addCutPoint(b, 2, 5);
    expect(validateSetPieceClipIn(b, 2, 0, 3).ok).toBe(false);
  });

  it("rejects a negative or non-finite offset; null (clear) always passes", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(validateSetPieceClipIn(b, 2, 5, -1).ok).toBe(false);
    expect(validateSetPieceClipIn(b, 2, 5, NaN).ok).toBe(false);
    expect(validateSetPieceClipIn(b, 2, 5, null)).toEqual({ ok: true });
  });

  it("sets an override, reads it back by the cut's offset, and marks timingEdited", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    expect(b[1].timingEdited).toBeUndefined(); // the bare cut alone is output-neutral
    const ok = setPieceClipIn(b, 2, 5, 12);
    expect(ok).toBe(true);
    expect(pieceClipIn(b[1], 5)).toBe(12);
    expect(b[1].cutPoints).toEqual([5]); // the cut itself is untouched
    expect(b[1].timingEdited).toBe(true); // but THIS is a real output change
  });

  it("clearing (null) removes the override and cleans up an empty map", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    setPieceClipIn(b, 2, 5, 12);
    setPieceClipIn(b, 2, 5, null);
    expect(pieceClipIn(b[1], 5)).toBeUndefined();
    expect(b[1].pieceClipIns).toBeUndefined();
  });

  it("multiple pieces keep independent overrides", () => {
    const b = board();
    addCutPoint(b, 2, 3);
    addCutPoint(b, 2, 6);
    setPieceClipIn(b, 2, 3, 10);
    setPieceClipIn(b, 2, 6, 20);
    expect(pieceClipIn(b[1], 3)).toBe(10);
    expect(pieceClipIn(b[1], 6)).toBe(20);
    setPieceClipIn(b, 2, 3, null);
    expect(pieceClipIn(b[1], 3)).toBeUndefined();
    expect(pieceClipIn(b[1], 6)).toBe(20); // the other survives
  });

  it("moving a cut carries its piece's override to the new position", () => {
    const b = board();
    addCutPoint(b, 2, 5);
    setPieceClipIn(b, 2, 5, 12);
    moveCutPoint(b, 2, 5, 7);
    expect(pieceClipIn(b[1], 7)).toBe(12); // followed the cut
    expect(pieceClipIn(b[1], 5)).toBeUndefined(); // old key is gone
    expect(b[1].pieceClipIns).toEqual({ "7": 12 });
  });

  it("removing a cut drops its piece's override", () => {
    const b = board();
    addCutPoint(b, 2, 3);
    addCutPoint(b, 2, 6);
    setPieceClipIn(b, 2, 3, 10);
    setPieceClipIn(b, 2, 6, 20);
    removeCutPoint(b, 2, 3); // removes the cut at 3 — its override goes with it
    expect(b[1].cutPoints).toEqual([6]);
    expect(pieceClipIn(b[1], 6)).toBe(20); // untouched
    expect(b[1].pieceClipIns).toEqual({ "6": 20 });
  });

  it("removing ALL cuts (undo) drops every override", () => {
    const b = board();
    addCutPoint(b, 2, 3);
    addCutPoint(b, 2, 6);
    setPieceClipIn(b, 2, 3, 10);
    setPieceClipIn(b, 2, 6, 20);
    removeCutPoint(b, 2); // no offset ⇒ clear everything
    expect(b[1].cutPoints).toBeUndefined();
    expect(b[1].pieceClipIns).toBeUndefined();
  });

  it("removing a SLIPPED piece's cut needs a reassemble; a bare one does not", () => {
    // Dropping a slip reverts that region to the continuous footage it was slipped away from —
    // a real change to the rendered film, and the mirror of moveCutPoint carrying one across.
    const bare = board();
    addCutPoint(bare, 2, 3);
    removeCutPoint(bare, 2, 3);
    expect(bare[1].timingEdited).toBeUndefined();

    const slipped = board();
    addCutPoint(slipped, 2, 3);
    setPieceClipIn(slipped, 2, 3, 10);
    delete slipped[1].timingEdited; // pretend the slip was already reassembled
    removeCutPoint(slipped, 2, 3);
    expect(slipped[1].pieceClipIns).toBeUndefined();
    expect(slipped[1].timingEdited).toBe(true);
  });
});

describe("head hold (a pause before the FIRST scene's first word — tailHoldSec's mirror)", () => {
  it("sets a hold on the first scene", () => {
    const b = board();
    const v = validateTimingEdit(b, { sceneIndex: 1, headHoldSec: 2 });
    expect(v).toEqual({ ok: true });
    applyTimingEdit(b, { sceneIndex: 1, headHoldSec: 2 });
    expect(b[0].headHoldSec).toBe(2);
    // Untouched: the narration itself never moves.
    expect(b[0].narrationStartSec).toBe(0);
  });

  it("refuses a hold on any scene but the first", () => {
    const b = board();
    const v = validateTimingEdit(b, { sceneIndex: 2, headHoldSec: 2 });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/Only the first scene/);
  });

  it("refuses an out-of-range or non-finite hold", () => {
    const b = board();
    expect(validateTimingEdit(b, { sceneIndex: 1, headHoldSec: -1 }).ok).toBe(
      false
    );
    expect(validateTimingEdit(b, { sceneIndex: 1, headHoldSec: 11 }).ok).toBe(
      false
    );
    expect(validateTimingEdit(b, { sceneIndex: 1, headHoldSec: NaN }).ok).toBe(
      false
    );
  });

  it("0 removes an existing hold", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 1, headHoldSec: 3 });
    expect(b[0].headHoldSec).toBe(3);
    applyTimingEdit(b, { sceneIndex: 1, headHoldSec: 0 });
    expect(b[0].headHoldSec).toBe(0);
  });
});

/**
 * "Revert to original". Nothing else in the system keeps a scene's pristine timing — the
 * narration ranges come from whisperx at voicing time and are overwritten in place — so the
 * snapshot these tests guard IS the original. Miss it and the cut is unrecoverable.
 */
describe("timing snapshots", () => {
  it("records the pristine state on the first edit and never overwrites it", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 3 });
    expect(b[1].timingOriginal).toEqual({
      narrationStartSec: 10,
      narrationEndSec: 20,
      clipInSec: undefined,
      tailHoldSec: undefined,
      headHoldSec: undefined,
      cutPoints: undefined,
      pieceClipIns: undefined,
    });
    // A second edit must not move the goalposts — the target is the ORIGINAL, not one undo step.
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 7 });
    expect(b[1].timingOriginal?.clipInSec).toBeUndefined();
  });

  it("snapshots the NEIGHBOUR too when a shared boundary moves", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, startSec: 12 });
    expect(b[0].timingOriginal?.narrationEndSec).toBe(10); // scene 1's end was rewritten
    expect(b[1].timingOriginal?.narrationStartSec).toBe(10);
    // The far neighbour was untouched, so it has nothing to revert.
    expect(b[2].timingOriginal).toBeUndefined();
  });

  it("is taken by every cut-room mutation, not just the boundary ones", () => {
    for (const edit of [
      (b: StoryboardScene[]) => addCutPoint(b, 2, 5),
      (b: StoryboardScene[]) => {
        addCutPoint(b, 2, 5);
        delete b[1].timingOriginal;
        moveCutPoint(b, 2, 5, 6);
      },
      (b: StoryboardScene[]) => {
        addCutPoint(b, 2, 5);
        delete b[1].timingOriginal;
        removeCutPoint(b, 2, 5);
      },
      (b: StoryboardScene[]) => {
        addCutPoint(b, 2, 5);
        delete b[1].timingOriginal;
        setPieceClipIn(b, 2, 5, 12);
      },
    ]) {
      const b = board();
      edit(b);
      expect(b[1].timingOriginal).toBeDefined();
    }
  });

  it("forgets the snapshot when a scene is re-voiced off-master", () => {
    const b = board();
    snapshotTiming(b[1]);
    forgetTimingSnapshot(b[1]);
    expect(b[1].timingOriginal).toBeUndefined();
  });
});

describe("revertSceneTiming", () => {
  it("puts the scene's OWN settings back and clears the snapshot", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 4, tailHoldSec: 2 });
    addCutPoint(b, 2, 5);
    setPieceClipIn(b, 2, 5, 12);

    const r = revertSceneTiming(b, 2);
    expect(r.ok).toBe(true);
    expect(b[1].clipInSec).toBeUndefined();
    expect(b[1].tailHoldSec).toBeUndefined();
    expect(b[1].cutPoints).toBeUndefined();
    expect(b[1].pieceClipIns).toBeUndefined();
    expect(b[1].timingOriginal).toBeUndefined();
    // A revert changes the cut, so the film needs re-stitching like any other timing edit.
    expect(b[1].timingEdited).toBe(true);
  });

  it("takes a moved boundary back on BOTH sides, keeping the board tiled", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, startSec: 13 });
    expect(b[0].narrationEndSec).toBe(13);

    const r = revertSceneTiming(b, 2);
    expect(r.ok).toBe(true);
    expect(b[1].narrationStartSec).toBe(10);
    expect(b[0].narrationEndSec).toBe(10); // the neighbour came with it
    expect(r.touched.sort()).toEqual([1, 2]);
  });

  it("says which neighbour moved with it", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, startSec: 13 });
    const r = revertSceneTiming(b, 2);
    expect(r.reason).toMatch(/Scene 1 moved with it/);
  });

  it("leaves a neighbour's OTHER settings alone, and its own snapshot intact", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, startSec: 13 }); // snapshots scenes 1 and 2
    applyTimingEdit(b, { sceneIndex: 1, clipInSec: 2 }); // scene 1 gains edits of its own

    const r = revertSceneTiming(b, 2);
    expect(r.ok).toBe(true);
    // The shared edge went back — and 10 is scene 1's OWN original end, so this restores it
    // rather than overwriting it with something foreign.
    expect(b[1].narrationStartSec).toBe(10);
    expect(b[0].narrationEndSec).toBe(10);
    expect(b[0].timingOriginal?.narrationEndSec).toBe(10);
    // Scene 1's own trim is untouched, and it can still be reverted in full afterwards.
    expect(b[0].clipInSec).toBe(2);
    expect(b[0].timingOriginal).toBeDefined();
    revertSceneTiming(b, 1);
    expect(b[0].clipInSec).toBeUndefined();
    // Still tiled throughout.
    expect(b[0].narrationEndSec).toBe(b[1].narrationStartSec);
  });

  it("refuses a scene that was never edited", () => {
    const b = board();
    const r = revertSceneTiming(b, 2);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no timing edits/);
    expect(r.touched).toEqual([]);
  });

  it("refuses a scene that isn't there", () => {
    expect(revertSceneTiming(board(), 99).ok).toBe(false);
  });
});

describe("revertAllSceneTiming", () => {
  it("puts the whole board back, tiled, however tangled the edits were", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, startSec: 13, clipInSec: 4 });
    applyTimingEdit(b, { sceneIndex: 3, startSec: 22 });
    addCutPoint(b, 2, 3);
    setPieceClipIn(b, 2, 3, 9);
    applyTimingEdit(b, { sceneIndex: 1, tailHoldSec: 4 });

    const r = revertAllSceneTiming(b);
    expect(r.ok).toBe(true);
    expect(b.map(s => [s.narrationStartSec, s.narrationEndSec])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(b[1].clipInSec).toBeUndefined();
    expect(b[1].cutPoints).toBeUndefined();
    expect(b[1].pieceClipIns).toBeUndefined();
    expect(b[0].tailHoldSec).toBeUndefined();
    expect(b.every(s => s.timingOriginal === undefined)).toBe(true);
    expect(b.every(s => s.timingEdited === true)).toBe(true);
  });

  it("leaves an un-edited scene alone", () => {
    const b = board();
    applyTimingEdit(b, { sceneIndex: 2, clipInSec: 4 });
    const r = revertAllSceneTiming(b);
    expect(r.touched).toEqual([2]);
    expect(b[2].timingEdited).toBeUndefined();
  });

  it("refuses a board with nothing to revert", () => {
    const r = revertAllSceneTiming(board());
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No timing edits/);
  });
});
