import { describe, expect, it } from "vitest";
import { parseClipGlitchVerdict } from "./clipGlitchScan";

describe("parseClipGlitchVerdict", () => {
  it("calls any change with no hands in the shot a glitch (Hank's creeping kumiko strips)", () => {
    const raw =
      '{"changes":["lattice piece on the left rotated","strip in front shifted"],"hands_visible":false,"untouched_moved":false,"morph":false}';
    expect(parseClipGlitchVerdict(raw)).toEqual({ glitch: true, what: "lattice piece on the left rotated" });
  });
  it("lets fire, water, a car or a door change — that is the point of the shot", () => {
    const raw = '{"changes":["flame spread along the logs"],"hands_visible":false,"untouched_moved":false,"morph":false}';
    expect(parseClipGlitchVerdict(raw, true).glitch).toBe(false);
    const car = '{"changes":["the truck moved to the right"],"hands_visible":false,"untouched_moved":false,"morph":false}';
    expect(parseClipGlitchVerdict(car, true).glitch).toBe(false);
  });
  it("passes anything off-shape", () => {
    expect(parseClipGlitchVerdict("not json")).toEqual({ glitch: false, what: "" });
  });
});

describe("no video shows hands (2026-09-30)", () => {
  it("fails a clip where hands appear, whatever it is of", () => {
    const raw =
      '{"changes":["hands repositioned lower on the paper"],"hands_visible":true,"untouched_moved":false,"morph":false}';
    expect(parseClipGlitchVerdict(raw)).toEqual({ glitch: true, what: "hands appear in the video" });
    expect(parseClipGlitchVerdict(raw, true).glitch).toBe(true);
    expect(parseClipGlitchVerdict(raw, false, undefined, true).glitch).toBe(true);
  });
  it("still fails a thing that disappears or changes size (Ruth's shrinking quilt, job 233)", () => {
    const raw = JSON.stringify({
      changes: ["quilt fabric repositioned"],
      cover: ["left: quilt hangs over the table front / right: table front bare, quilt smaller"],
      hands_visible: false,
      untouched_moved: false,
      morph: false,
      vanished: true,
    });
    expect(parseClipGlitchVerdict(raw)).toEqual({
      glitch: true,
      what: "something disappears or changes size",
    });
  });
});

describe("a shot of something that moves by itself (2026-09-30)", () => {
  it("passes the smoke drifting and the fire spreading", () => {
    const raw = JSON.stringify({ changes: ["smoke drifted to the left", "flame grew"], hands_visible: false, untouched_moved: false, morph: true, vanished: true });
    expect(parseClipGlitchVerdict(raw, true).glitch).toBe(false);
  });
  it("fails anything ELSE moving on its own — the holder sliding while its smoke rises", () => {
    const raw = JSON.stringify({ changes: ["the incense holder slid toward the can"], hands_visible: false, untouched_moved: true, morph: false });
    expect(parseClipGlitchVerdict(raw, true)).toEqual({ glitch: true, what: "the incense holder slid toward the can" });
  });
});
