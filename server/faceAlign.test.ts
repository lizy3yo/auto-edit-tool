import { describe, it, expect } from "vitest";
import { parseFaceCenter, focusCropX } from "./faceAlign";

describe("parseFaceCenter", () => {
  it("reads the fraction out of a well-formed verdict", () => {
    expect(parseFaceCenter('{"found":true,"x":0.72}')).toBe(0.72);
    expect(parseFaceCenter('{"found":true,"x":0}')).toBe(0);
    expect(parseFaceCenter('{"found":true,"x":1}')).toBe(1);
  });

  it("returns null when no face was found", () => {
    expect(parseFaceCenter('{"found":false,"x":0.5}')).toBeNull();
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
