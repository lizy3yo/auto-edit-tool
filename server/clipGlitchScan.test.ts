import { describe, expect, it } from "vitest";
import { parseClipGlitchVerdict } from "./clipGlitchScan";

describe("parseClipGlitchVerdict", () => {
  it("calls any change with no hands in the shot a glitch (Hank's creeping kumiko strips)", () => {
    const raw =
      '{"changes":["lattice piece on the left rotated","strip in front shifted"],"hands_visible":false,"untouched_moved":false,"morph":false}';
    expect(parseClipGlitchVerdict(raw)).toEqual({ glitch: true, what: "lattice piece on the left rotated" });
  });
  it("lets fire or water change — that is the point of the shot", () => {
    const raw = '{"changes":["flame spread along the board"],"hands_visible":false,"untouched_moved":false,"morph":false}';
    expect(parseClipGlitchVerdict(raw, true).glitch).toBe(false);
  });
  it("passes hands doing their task, flags a morph", () => {
    expect(
      parseClipGlitchVerdict('{"changes":["the hand pressed the seam"],"hands_visible":true,"untouched_moved":false,"morph":false}').glitch
    ).toBe(false);
    expect(
      parseClipGlitchVerdict('{"changes":["stack of bills grew thicker"],"hands_visible":true,"untouched_moved":false,"morph":true}').glitch
    ).toBe(true);
  });
  it("passes anything off-shape", () => {
    expect(parseClipGlitchVerdict("not json")).toEqual({ glitch: false, what: "" });
  });
});

describe("hands in the shot", () => {
  it("does not flag hands moving as untouched motion (job 175)", () => {
    const raw =
      '{"changes":["hands repositioned lower on the paper"],"hands_visible":true,"untouched_moved":true,"morph":false}';
    expect(parseClipGlitchVerdict(raw).glitch).toBe(false);
  });
});
