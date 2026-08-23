import { describe, it, expect } from "vitest";
import {
  parseFaceCenter,
  focusCropX,
  medianFocus,
  cropWindow,
  panelFraction,
  faceInPanel,
  correctFocus,
} from "./faceAlign";

describe("medianFocus", () => {
  it("returns null when nothing was read", () => {
    expect(medianFocus([])).toBeNull();
    expect(medianFocus([null, null, null])).toBeNull();
  });

  it("takes the middle reading", () => {
    expect(medianFocus([0.3, 0.7, 0.5])).toBe(0.5);
    expect(medianFocus([0.5])).toBe(0.5);
  });

  it("averages the middle two when there is no single middle", () => {
    expect(medianFocus([0.4, 0.6])).toBeCloseTo(0.5, 10);
  });

  it("ignores the frames that read nothing", () => {
    expect(medianFocus([null, 0.62, null])).toBe(0.62);
    expect(medianFocus([0.4, null, 0.6])).toBeCloseTo(0.5, 10);
  });

  // The reason this is a median and not a mean: one blink or motion-blurred frame must not
  // drag the crop, because the result is baked into the render.
  it("is not dragged by a single wild reading", () => {
    expect(medianFocus([0.6, 0.62, 0.05])).toBe(0.6);
    expect(medianFocus([0.6, 0.62, 0.99])).toBe(0.62);
  });

  it("discards non-finite readings", () => {
    expect(medianFocus([NaN, 0.6, Infinity])).toBe(0.6);
  });
});

describe("parseFaceCenter", () => {
  it("reads the fraction out of a well-formed verdict", () => {
    expect(parseFaceCenter('{"found":true,"x":0.72}')).toBe(0.72);
    expect(parseFaceCenter('{"found":true,"x":0}')).toBe(0);
    expect(parseFaceCenter('{"found":true,"x":1}')).toBe(1);
  });

  it("returns null when no face was found", () => {
    expect(parseFaceCenter('{"found":false,"x":0.5}')).toBeNull();
    expect(
      parseFaceCenter('{"found":false,"left":0.5,"right":0.5}')
    ).toBeNull();
  });

  // The current prompt asks for the face's EDGES — a vision model reads those more honestly
  // than a centre — and the centre is their midpoint.
  it("reads the centre out of a left/right verdict", () => {
    expect(
      parseFaceCenter('{"found":true,"left":0.50,"right":0.66}')
    ).toBeCloseTo(0.58, 10);
    expect(parseFaceCenter('{"found":true,"left":0,"right":1}')).toBe(0.5);
  });

  it("rejects an inverted or out-of-range left/right pair", () => {
    expect(parseFaceCenter('{"found":true,"left":0.7,"right":0.6}')).toBeNull();
    expect(parseFaceCenter('{"found":true,"left":0.6,"right":0.6}')).toBeNull();
    expect(
      parseFaceCenter('{"found":true,"left":-0.1,"right":0.6}')
    ).toBeNull();
    expect(parseFaceCenter('{"found":true,"left":0.4,"right":1.2}')).toBeNull();
  });

  // Every one of these must reach null rather than a plausible number: a confidently wrong
  // fraction pans the face OUT of the panel, which is worse than the miscentring being fixed.
  it("returns null for anything off-shape, out of range, or unparseable", () => {
    expect(parseFaceCenter("not json at all")).toBeNull();
    expect(parseFaceCenter("")).toBeNull();
    expect(parseFaceCenter('{"found":true}')).toBeNull();
    expect(parseFaceCenter('{"found":true,"x":"0.7"}')).toBeNull();
    expect(parseFaceCenter('{"found":true,"x":1.4}')).toBeNull();
    expect(parseFaceCenter('{"found":true,"x":-0.2}')).toBeNull();
    expect(parseFaceCenter('{"found":true,"x":null}')).toBeNull();
    expect(parseFaceCenter('{"x":0.7}')).toBeNull();
  });

  it("treats a truncated response as no answer", () => {
    expect(parseFaceCenter('{"found":true,"x":0.7', "max_tokens")).toBeNull();
  });
});

describe("focusCropX", () => {
  it("returns null for a null focus, so the caller keeps ffmpeg's centred default", () => {
    expect(focusCropX(null)).toBeNull();
  });

  it("returns null for an already-centred face rather than perturbing the args", () => {
    expect(focusCropX(0.5)).toBeNull();
    expect(focusCropX(0.503)).toBeNull();
  });

  it("pans the window so the face lands mid-panel", () => {
    const expr = focusCropX(0.75);
    expect(expr).toBe("max(0\\,min(in_w-out_w\\,in_w*0.7500-out_w/2))");
  });

  // The filtergraph parser reads a bare comma as a filter separator, so an unescaped one
  // silently truncates the crop filter and ffmpeg errors on the remainder.
  it("escapes the commas inside the expression", () => {
    const expr = focusCropX(0.8)!;
    expect(expr).not.toMatch(/[^\\],/);
    expect((expr.match(/\\,/g) ?? []).length).toBe(2);
  });

  it("clamps a focus outside 0..1 instead of emitting it", () => {
    expect(focusCropX(1.5)).toBe(
      "max(0\\,min(in_w-out_w\\,in_w*1.0000-out_w/2))"
    );
    expect(focusCropX(-3)).toBe(
      "max(0\\,min(in_w-out_w\\,in_w*0.0000-out_w/2))"
    );
  });

  it("returns null for a non-finite focus", () => {
    expect(focusCropX(NaN)).toBeNull();
    expect(focusCropX(Infinity)).toBeNull();
  });
});

describe("panelFraction", () => {
  // Stock layout: 16:9 host clip, 840px panel on a 1080-tall canvas ⇒ the middle 43.75%.
  it("is the panel's share of the cover-scaled source width", () => {
    expect(panelFraction(1920, 1080, 840, 1080)).toBeCloseTo(0.4375, 10);
    // Resolution-independent: a 1280x720 host clip in the same panel shows the same share.
    expect(panelFraction(1280, 720, 840, 1080)).toBeCloseTo(0.4375, 10);
    // A dragged seam (host at 60% of 1920) shows more of the source.
    expect(panelFraction(1920, 1080, 1152, 1080)).toBeCloseTo(0.6, 10);
  });

  it("is ≥ 1 when the source is no wider than the panel (nothing to pan)", () => {
    expect(panelFraction(840, 1080, 840, 1080)).toBe(1);
    expect(panelFraction(1080, 1080, 1152, 1080)).toBeGreaterThan(1);
  });

  it("degrades to 1 on nonsense dimensions rather than NaN", () => {
    expect(panelFraction(0, 1080, 840, 1080)).toBe(1);
    expect(panelFraction(1920, 1080, 840, 0)).toBe(1);
  });
});

describe("cropWindow", () => {
  const FRAC = 0.4375;

  it("centres the window on the focus", () => {
    const w = cropWindow(0.5, FRAC);
    expect(w.left).toBeCloseTo(0.5 - FRAC / 2, 10);
    expect(w.width).toBe(FRAC);
    expect(cropWindow(0.6, FRAC).left).toBeCloseTo(0.6 - FRAC / 2, 10);
  });

  // Same clamp as `focusCropX`'s ffmpeg expression: an edge face gives an edge-aligned panel,
  // never black bars.
  it("clamps to the frame edges", () => {
    expect(cropWindow(0.05, FRAC).left).toBe(0);
    expect(cropWindow(0.95, FRAC).left).toBeCloseTo(1 - FRAC, 10);
    expect(cropWindow(1.5, FRAC).left).toBeCloseTo(1 - FRAC, 10);
  });

  it("treats a null focus as centred, like ffmpeg's default", () => {
    expect(cropWindow(null, FRAC)).toEqual(cropWindow(0.5, FRAC));
  });

  it("is the whole frame when there is no horizontal slack", () => {
    expect(cropWindow(0.8, 1)).toEqual({ left: 0, width: 1 });
    expect(cropWindow(0.8, 1.3)).toEqual({ left: 0, width: 1 });
  });
});

describe("faceInPanel / correctFocus", () => {
  const FRAC = 0.4375;

  // The bug this module exists for: a host at 0.58 of the frame under a centred crop lands at
  // 0.68 of the panel — against the divider.
  it("shows how far a centred crop pushes an off-centre face", () => {
    expect(faceInPanel(0.58, null, FRAC)).toBeCloseTo(0.5 + 0.08 / FRAC, 6);
  });

  it("puts the face mid-panel when the focus is on it", () => {
    expect(faceInPanel(0.58, 0.58, FRAC)).toBeCloseTo(0.5, 10);
    expect(faceInPanel(0.3, 0.3, FRAC)).toBeCloseTo(0.5, 10);
  });

  // The verify loop: a biased first read (detector said 0.5 for a face at 0.58) is observed
  // off-centre in the panel and corrected to the true position in ONE round.
  it("converges to the true face position from a biased estimate", () => {
    const truth = 0.58;
    let focus = 0.5;
    const seen = faceInPanel(truth, focus, FRAC);
    expect(Math.abs(seen - 0.5)).toBeGreaterThan(0.03);
    focus = correctFocus(focus, seen, FRAC);
    expect(focus).toBeCloseTo(truth, 10);
    expect(faceInPanel(truth, focus, FRAC)).toBeCloseTo(0.5, 10);
  });

  it("converges from the other side too", () => {
    const truth = 0.31;
    const focus = correctFocus(0.5, faceInPanel(truth, 0.5, FRAC), FRAC);
    expect(focus).toBeCloseTo(truth, 10);
  });

  // A face pressed against the frame edge can't be centred — the window is already clamped.
  // correctFocus must not blow past 0..1, and the window must not move.
  it("clamps at the frame edge instead of running away", () => {
    const truth = 0.97;
    let focus = 0.9;
    const before = cropWindow(focus, FRAC).left;
    const seen = faceInPanel(truth, focus, FRAC);
    focus = correctFocus(focus, seen, FRAC);
    expect(focus).toBeLessThanOrEqual(1);
    expect(cropWindow(focus, FRAC).left).toBeCloseTo(before, 10);
  });
});
