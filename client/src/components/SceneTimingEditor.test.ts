/**
 * client/src/components/SceneTimingEditor.test.ts
 *
 * The cut room's footage bounds: how far a slip may go, and where a piece's picture runs out.
 *
 * One rule underneath both — an edit may address the clip's last frame and nothing past it. The
 * previous bound reserved `MIN_SLICE_SEC` (0.5s) of footage instead, which was the wrong shape
 * twice over: too strict at the top, and on a clip shorter than half a second it collapsed to
 * zero and made that clip un-slippable.
 */
import { describe, it, expect } from "vitest";
import { boundaryLimits, maxSlipSec, pieceLiveEnd } from "./SceneTimingEditor";

const FRAME = 1 / 30;

describe("maxSlipSec", () => {
  it("stops on the clip's last frame, not before it", () => {
    expect(maxSlipSec(6)).toBeCloseTo(6 - FRAME, 6);
    expect(maxSlipSec(1)).toBeCloseTo(1 - FRAME, 6);
  });

  it("still allows a clip shorter than the old 0.5s reserve to be slipped", () => {
    // The whole point of dropping MIN_SLICE_SEC: `max(0, 0.3 - 0.5)` was 0, so a 0.3s clip's
    // handle was dead. It now has 0.27s of travel.
    expect(maxSlipSec(0.3)).toBeCloseTo(0.3 - FRAME, 6);
    expect(maxSlipSec(0.3) as number).toBeGreaterThan(0);
  });

  it("never returns a negative bound, however short the clip", () => {
    expect(maxSlipSec(FRAME)).toBe(0);
    expect(maxSlipSec(0.01)).toBe(0);
    expect(maxSlipSec(0)).toBe(0);
  });

  it("reports UNKNOWN rather than a bound while the duration is still loading", () => {
    // Previously `Infinity` — a drag started before the video's metadata arrived was bounded by
    // nothing at all and could park the footage past the end of the file.
    expect(maxSlipSec(undefined)).toBeUndefined();
    expect(maxSlipSec(NaN)).toBeUndefined();
    expect(maxSlipSec(Infinity)).toBeUndefined();
  });
});

describe("pieceLiveEnd", () => {
  it("is where the footage runs out, measured on the slice", () => {
    // A piece opening at the top of a 4s clip, starting 2s into the scene: picture to 6s.
    expect(pieceLiveEnd(2, 0, 4)).toBeCloseTo(6, 6);
  });

  it("moves in when the piece is slipped further into the footage", () => {
    // Same piece slipped to 3s in: only 1s of clip left, so the picture ends a second later.
    expect(pieceLiveEnd(2, 3, 4)).toBeCloseTo(3, 6);
  });

  it("collapses onto the piece's own start once the slip is at the very end", () => {
    expect(pieceLiveEnd(2, 4, 4)).toBeCloseTo(2, 6);
    // ...and cannot go BACKWARDS past it, even with a slip beyond the clip (a stored value from
    // before this bound existed).
    expect(pieceLiveEnd(2, 9, 4)).toBeCloseTo(2, 6);
  });

  it("handles the first piece, which starts at the top of the slice", () => {
    expect(pieceLiveEnd(0, 0, 5)).toBeCloseTo(5, 6);
    expect(pieceLiveEnd(0, 1.5, 5)).toBeCloseTo(3.5, 6);
  });

  it("reports UNKNOWN while the duration is still loading", () => {
    expect(pieceLiveEnd(2, 0, undefined)).toBeUndefined();
    expect(pieceLiveEnd(2, 0, NaN)).toBeUndefined();
  });
});

/**
 * The scene-boundary handles. The rule is one-directional: a handle only ever makes the scene it
 * belongs to shorter. The bounds these replace were measured from the NEIGHBOUR's far edge, so a
 * scene could be dragged clean out of its own range and into the scene either side of it.
 */
describe("boundaryLimits", () => {
  /** The harness board: scene 1 (5–11), scene 2 (11–17), scene 3 (17–24). */
  const middle = {
    startSec: 11,
    endSec: 17,
    draftStart: 11,
    draftEnd: 17,
    hasPrev: true,
    hasNext: true,
  };

  it("keeps a middle scene inside its OWN range — the reported bug", () => {
    // Was: minStart 5.5, maxEnd 23 — scene 2 could swallow most of scenes 1 and 3.
    const l = boundaryLimits(middle);
    expect(l.minStart).toBe(11);
    expect(l.maxEnd).toBe(17);
  });

  it("lets each handle shorten the scene, down to the MIN_SLICE_SEC floor", () => {
    const l = boundaryLimits(middle);
    expect(l.maxStart).toBe(16.5); // start may move later, keeping 0.5s of picture
    expect(l.minEnd).toBe(11.5); // end may move earlier, same floor
  });

  it("keeps the two handles from crossing as the draft moves", () => {
    // Start already dragged to 15: the end may now only come back to 15.5, not 11.5.
    expect(boundaryLimits({ ...middle, draftStart: 15 }).minEnd).toBe(15.5);
    // ...and symmetrically.
    expect(boundaryLimits({ ...middle, draftEnd: 13 }).maxStart).toBe(12.5);
  });

  it("pins both handles on a scene already shorter than the floor", () => {
    const tiny = {
      startSec: 11,
      endSec: 11.3,
      draftStart: 11,
      draftEnd: 11.3,
      hasPrev: true,
      hasNext: true,
    };
    const l = boundaryLimits(tiny);
    expect(l.minStart).toBe(11);
    expect(l.maxStart).toBe(11); // can't shrink further
    expect(l.minEnd).toBe(11.3);
    expect(l.maxEnd).toBe(11.3);
  });

  it("fixes the first scene's start and the last scene's end to the narration", () => {
    // Scene 1 has no previous: its start is where the narration starts, and cannot move.
    const first = boundaryLimits({
      startSec: 5,
      endSec: 11,
      draftStart: 5,
      draftEnd: 11,
      hasPrev: false,
      hasNext: true,
    });
    expect(first.minStart).toBe(5);
    expect(first.maxStart).toBe(5);
    expect(first.maxEnd).toBe(11); // was 16.5 — into scene 2

    // Scene 3 has no next: its end is where the narration ends.
    const last = boundaryLimits({
      startSec: 17,
      endSec: 24,
      draftStart: 17,
      draftEnd: 24,
      hasPrev: true,
      hasNext: false,
    });
    expect(last.minStart).toBe(17); // was 11.5 — into scene 2
    expect(last.minEnd).toBe(24);
    expect(last.maxEnd).toBe(24);
  });
});
