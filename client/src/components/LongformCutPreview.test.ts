/**
 * client/src/components/LongformCutPreview.test.ts
 *
 * The live preview's job is to show the cut Reassemble will produce. These tests hold it to
 * that: the layout it plays must match `planMasterOverlayScenes` (scene lengths, frozen holds)
 * and the footage it shows inside a scene must match `planScenePieces` (trims, cut markers,
 * per-piece slips) — the same two functions the renderer runs, imported from `shared/`.
 *
 * The case that matters most is the operator's loop: split a scene, then shorten or slip a
 * piece. If the preview and the renderer disagree there, the preview is worse than useless.
 */
import { describe, it, expect } from "vitest";
import {
  beatAt,
  clipTimeFor,
  masterTimeFor,
  planCutBeats,
  totalFilmSec,
  QR_TAIL_HOLD_SEC,
  type CutBeat,
} from "./LongformCutPreview";
import { planScenePieces } from "@shared/filmTimeline";
import type { StoryboardScene } from "@shared/types";

const scene = (over: Partial<StoryboardScene>): StoryboardScene =>
  ({
    index: 1,
    hostPresent: false,
    narration: "",
    ...over,
  }) as StoryboardScene;

/** Three 4s scenes tiling a 12s master, each with a clip. The baseline every case edits. */
const threeScenes = (over: Partial<StoryboardScene>[] = []) =>
  [0, 1, 2].map(i =>
    scene({
      index: i + 1,
      clipUrl: `clip${i}.mp4`,
      narrationStartSec: i * 4,
      narrationEndSec: (i + 1) * 4,
      audioDuration: 4,
      ...(over[i] ?? {}),
    })
  );

const beat = (over: Partial<CutBeat>): CutBeat => ({
  index: 1,
  clipUrl: "a.mp4",
  startSec: 0,
  endSec: 10,
  masterStartSec: 0,
  headHoldSec: 0,
  tailHoldSec: 0,
  clipInSec: 0,
  cutPoints: [],
  pieceClipIns: {},
  ...over,
});

describe("planCutBeats", () => {
  it("keeps only scenes with a clip AND a narration range, in index order", () => {
    const beats = planCutBeats([
      scene({
        index: 2,
        clipUrl: "b.mp4",
        narrationStartSec: 5,
        narrationEndSec: 9,
      }),
      scene({
        index: 1,
        clipUrl: "a.mp4",
        narrationStartSec: 0,
        narrationEndSec: 5,
      }),
      scene({ index: 3, narrationStartSec: 9, narrationEndSec: 12 }), // no clip
      scene({ index: 4, clipUrl: "d.mp4" }), // no range
    ]);
    expect(beats.map(b => b.index)).toEqual([1, 2]);
    expect(beats[0].clipUrl).toBe("a.mp4");
  });

  it("drops a zero-length or inverted range rather than emitting a flash frame", () => {
    expect(
      planCutBeats([
        scene({
          index: 1,
          clipUrl: "a.mp4",
          narrationStartSec: 4,
          narrationEndSec: 4,
        }),
        scene({
          index: 2,
          clipUrl: "b.mp4",
          narrationStartSec: 9,
          narrationEndSec: 8,
        }),
      ])
    ).toEqual([]);
  });

  it("prefers clipUrls over the back-compat clipUrl mirror", () => {
    const beats = planCutBeats([
      scene({
        index: 1,
        clipUrl: "stale.mp4",
        clipUrls: ["fresh.mp4"],
        narrationStartSec: 0,
        narrationEndSec: 5,
      }),
    ]);
    expect(beats[0].clipUrl).toBe("fresh.mp4");
  });

  it("lays scenes end to end on the FILM timeline, not the master timeline", () => {
    const beats = planCutBeats(threeScenes());
    expect(
      beats.map(b => [+b.startSec.toFixed(3), +b.endSec.toFixed(3)])
    ).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ]);
    expect(totalFilmSec(beats)).toBeCloseTo(12, 3);
  });

  it("makes room for a tail hold and pushes every later scene back by it", () => {
    const held = planCutBeats(threeScenes([{}, { tailHoldSec: 2 }]));
    const plain = planCutBeats(threeScenes());
    expect(held[1].tailHoldSec).toBeCloseTo(2, 2);
    // Scene 2 is 2s longer, and scene 3 starts 2s later than it otherwise would.
    expect(held[1].endSec - held[1].startSec).toBeCloseTo(6, 2);
    expect(held[2].startSec - plain[2].startSec).toBeCloseTo(2, 2);
    // Its narration still sits where it always did on the master.
    expect(held[2].masterStartSec).toBe(8);
  });

  it("defaults a qrTail beat to the pipeline's own hold, and lets an override replace it", () => {
    const auto = planCutBeats(threeScenes([{}, { qrTail: true }]));
    expect(auto[1].tailHoldSec).toBeCloseTo(QR_TAIL_HOLD_SEC, 2);
    // 0 is a real value, not "unset" — the operator removing the pause must remove it.
    const off = planCutBeats(
      threeScenes([{}, { qrTail: true, tailHoldSec: 0 }])
    );
    expect(off[1].tailHoldSec).toBeCloseTo(0, 2);
  });

  it("puts a head hold at the front of the first scene and delays its narration", () => {
    const beats = planCutBeats(threeScenes([{ headHoldSec: 1.5 }]));
    expect(beats[0].headHoldSec).toBeCloseTo(1.5, 3);
    expect(beats[0].endSec - beats[0].startSec).toBeCloseTo(5.5, 2);
    expect(masterTimeFor(beats[0], 0)).toBeNull(); // frozen
    expect(masterTimeFor(beats[0], 1.6)).toBeCloseTo(0.1, 2); // words start after the hold
  });

  it("does NOT hold when the measured narration merely drifted past the slice", () => {
    // The bug the HOLD badge was showing across a whole film: scene ranges are snapped onto real
    // pauses AFTER the per-scene audio is measured, so an ordinary untouched scene routinely
    // carries an `audioDuration` a fraction of a second longer than its slice. That is snapping
    // drift, not a hold — the floor caps it, in the preview exactly as in the render.
    const drifted = planCutBeats(
      [0, 1, 2].map(i =>
        scene({
          index: i + 1,
          clipUrl: `c${i}.mp4`,
          narrationStartSec: i * 6,
          narrationEndSec: (i + 1) * 6,
          audioDuration: 6.4,
          minHoldSec: 3,
        })
      )
    );
    expect(drifted.every(b => b.tailHoldSec === 0)).toBe(true);
    expect(drifted.map(b => +(b.endSec - b.startSec).toFixed(3))).toEqual([
      6, 6, 6,
    ]);
    for (const b of drifted)
      expect(masterTimeFor(b, b.endSec - 0.01)).not.toBeNull();
  });

  it("treats a sub-frame remainder as no hold at all", () => {
    // The frame plan quantizes to whole frames, so a beat's arithmetic tail can come out a
    // fraction of a frame long. Calling that a hold would pause the narration at every cut.
    const beats = planCutBeats([
      scene({
        index: 1,
        clipUrl: "a.mp4",
        narrationStartSec: 0,
        narrationEndSec: 4.017,
        audioDuration: 4.017,
        minHoldSec: 3,
      }),
    ]);
    expect(beats[0].tailHoldSec).toBe(0);
  });

  it("holds a scene to its floored duration when the narration is shorter", () => {
    // A sub-floor beat: 1s of words, floored to 3s on screen. The extra 2s is frozen tail.
    const beats = planCutBeats([
      scene({
        index: 1,
        clipUrl: "a.mp4",
        narrationStartSec: 0,
        narrationEndSec: 1,
        audioDuration: 3,
        minHoldSec: 3,
      }),
    ]);
    expect(beats[0].endSec - beats[0].startSec).toBeCloseTo(3, 2);
    expect(beats[0].tailHoldSec).toBeCloseTo(2, 2);
  });

  it("splits a multi-clip scene across the SPOKEN middle, bracketing it with the holds", () => {
    const beats = planCutBeats([
      scene({
        index: 1,
        clipUrls: ["a.mp4", "b.mp4"],
        narrationStartSec: 0,
        narrationEndSec: 4,
        audioDuration: 4,
        headHoldSec: 1,
        tailHoldSec: 1,
        clipInSec: 2,
        cutPoints: [3],
      }),
    ]);
    expect(beats).toHaveLength(2);
    // 1s lead-in + 2s of chunk A, then 2s of chunk B + 1s frozen tail.
    expect([
      +beats[0].startSec.toFixed(2),
      +beats[0].endSec.toFixed(2),
    ]).toEqual([0, 3]);
    expect(beats[0].headHoldSec).toBeCloseTo(1, 2);
    expect(beats[0].tailHoldSec).toBe(0);
    expect(beats[1].tailHoldSec).toBeCloseTo(1, 2);
    // Neither hold can exceed the sub-beat that carries it.
    for (const b of beats)
      expect(b.headHoldSec + b.tailHoldSec).toBeLessThanOrEqual(
        b.endSec - b.startSec + 1e-6
      );
    // Only the first chunk carries the scene's trim/cuts — the renderer applies those to the
    // concatenated whole, which the preview cannot reconstruct.
    expect(beats[0].clipInSec).toBe(2);
    expect(beats[0].cutPoints).toEqual([3]);
    expect(beats[1].clipInSec).toBe(0);
    expect(beats[1].cutPoints).toEqual([]);
  });

  it("sorts cut markers, so a marker added out of order still reads left to right", () => {
    const beats = planCutBeats(threeScenes([{ cutPoints: [6, 2] }]));
    expect(beats[0].cutPoints).toEqual([2, 6]);
  });
});

describe("beatAt", () => {
  const beats = [
    beat({ index: 1, startSec: 0, endSec: 4 }),
    beat({ index: 2, startSec: 4, endSec: 9 }),
  ];

  it("picks the beat covering the moment, boundary-exclusive at its end", () => {
    expect(beatAt(beats, 0)).toBe(0);
    expect(beatAt(beats, 3.999)).toBe(0);
    expect(beatAt(beats, 4)).toBe(1);
    expect(beatAt(beats, 8.9)).toBe(1);
  });

  it("reports -1 past the last beat and on an empty timeline", () => {
    expect(beatAt(beats, 9)).toBe(-1);
    expect(beatAt(beats, 99)).toBe(-1);
    expect(beatAt([], 0)).toBe(-1);
  });
});

describe("masterTimeFor", () => {
  it("maps film time to master time one-for-one on an unheld beat", () => {
    const b = beat({ startSec: 10, endSec: 14, masterStartSec: 30 });
    expect(masterTimeFor(b, 10)).toBe(30);
    expect(masterTimeFor(b, 12.5)).toBe(32.5);
  });

  it("reports null inside a frozen lead-in or tail — where assembly splices silence", () => {
    const b = beat({
      startSec: 0,
      endSec: 8,
      masterStartSec: 20,
      headHoldSec: 2,
      tailHoldSec: 3,
    });
    expect(masterTimeFor(b, 0)).toBeNull();
    expect(masterTimeFor(b, 1.9)).toBeNull();
    expect(masterTimeFor(b, 2)).toBe(20); // first word
    expect(masterTimeFor(b, 4)).toBe(22);
    expect(masterTimeFor(b, 5.1)).toBeNull(); // into the tail
    expect(masterTimeFor(b, 7.9)).toBeNull();
  });
});

describe("clipTimeFor", () => {
  it("plays from the top of the footage on an untrimmed beat", () => {
    const b = beat({ startSec: 10, endSec: 20 });
    expect(clipTimeFor(b, 10)).toBe(0);
    expect(clipTimeFor(b, 13.5)).toBe(3.5);
  });

  it("offsets by the operator's trim", () => {
    const b = beat({ startSec: 10, endSec: 20, clipInSec: 4 });
    expect(clipTimeFor(b, 10)).toBe(4);
    expect(clipTimeFor(b, 12)).toBe(6);
  });

  it("CONTINUES the footage across an un-slipped cut — a bare marker changes nothing", () => {
    const plain = beat({ startSec: 0, endSec: 10 });
    const cut = beat({ startSec: 0, endSec: 10, cutPoints: [4] });
    for (const t of [0, 2, 4, 6, 9.5])
      expect(clipTimeFor(cut, t)).toBeCloseTo(clipTimeFor(plain, t), 6);
  });

  it("shows a slipped piece its OWN footage, leaving its neighbours alone", () => {
    const b = beat({
      startSec: 0,
      endSec: 12,
      clipInSec: 1,
      cutPoints: [4, 8],
      pieceClipIns: { "4": 20 },
    });
    expect(clipTimeFor(b, 2)).toBeCloseTo(3, 6); // piece 0: clipIn + 2
    expect(clipTimeFor(b, 4)).toBeCloseTo(20, 6); // piece 1: slipped to 20
    expect(clipTimeFor(b, 6)).toBeCloseTo(22, 6); // ...and runs on from there
    expect(clipTimeFor(b, 8)).toBeCloseTo(9, 6); // piece 2: un-slipped, continues
  });

  it("never returns a negative time, whatever the clock says", () => {
    const b = beat({ startSec: 10, endSec: 20 });
    expect(clipTimeFor(b, 0)).toBe(0);
    expect(clipTimeFor(b, -5)).toBe(0);
  });

  it("runs past the footage so the caller freezes — the renderer's per-piece tpad", () => {
    // An 8s clip, second piece slipped to 7s: it has 1s of footage for 4s on screen.
    const b = beat({
      startSec: 0,
      endSec: 8,
      cutPoints: [4],
      pieceClipIns: { "4": 7 },
    });
    expect(clipTimeFor(b, 4, 8)).toBeCloseTo(7, 6);
    expect(clipTimeFor(b, 5, 8)).toBeCloseTo(8, 6); // exactly out of footage
    expect(clipTimeFor(b, 7, 8)).toBeGreaterThan(8); // freeze territory
    // ...and the NEXT piece is unaffected — that is what "independent trim" means.
    const b2 = beat({
      startSec: 0,
      endSec: 12,
      cutPoints: [4, 8],
      pieceClipIns: { "4": 7 },
    });
    expect(clipTimeFor(b2, 8, 8)).toBeCloseTo(7.95, 2); // clamped inside the footage
  });
});

/**
 * The whole point of moving the planners into `shared/`: the preview must agree with the
 * renderer frame for frame. These assert equality against `planScenePieces` directly rather
 * than against hand-written numbers, so a change to the renderer's arithmetic fails here too.
 */
describe("agreement with the renderer", () => {
  const cases: { name: string; b: CutBeat; videoSec: number }[] = [
    {
      name: "split, second piece slipped back (the cut-room loop)",
      b: beat({
        startSec: 0,
        endSec: 6,
        clipInSec: 1.9,
        cutPoints: [2.5],
        pieceClipIns: { "2.5": 0.4 },
      }),
      videoSec: 8,
    },
    {
      name: "two cuts, only the middle piece slipped",
      b: beat({
        startSec: 3,
        endSec: 12,
        clipInSec: 0,
        cutPoints: [3, 6],
        pieceClipIns: { "3": 5 },
      }),
      videoSec: 8,
    },
    {
      name: "trim with no cuts at all",
      b: beat({ startSec: 0, endSec: 5, clipInSec: 2.2 }),
      videoSec: 8,
    },
    {
      name: "a cut sitting past the scene's on-screen length (stale marker)",
      b: beat({ startSec: 0, endSec: 4, cutPoints: [9] }),
      videoSec: 8,
    },
  ];

  for (const { name, b, videoSec } of cases) {
    it(`matches planScenePieces — ${name}`, () => {
      const span = b.endSec - b.startSec;
      const pieces = planScenePieces({
        cuts: b.cutPoints,
        totalDurationSec: span,
        videoDurationSec: videoSec,
        clipInSec: b.clipInSec,
        pieceClipIns: b.pieceClipIns,
      });
      // Walk the renderer's plan and check the preview reports the same footage moment at the
      // start of, and part-way through, every piece.
      let at = 0;
      for (const piece of pieces) {
        for (const frac of [0, 0.5, 0.99]) {
          const into = at + piece.durationSec * frac;
          expect(clipTimeFor(b, b.startSec + into, videoSec)).toBeCloseTo(
            piece.startSec + piece.durationSec * frac,
            6
          );
        }
        at += piece.durationSec;
      }
      // And the pieces cover the beat exactly, so nothing is left unaccounted for.
      expect(at).toBeCloseTo(span, 6);
    });
  }
});
