import { describe, expect, it } from "vitest";
import { CLIP_GLITCH_SYSTEM, clipGlitchMessage, parseClipGlitchVerdict } from "./clipGlitchScan";

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

// The audit's thrown-away videos (2026-10-18): every glitch on record was judged on a self-moving
// shot, six of the seven reasons logged on Frederick's renders named the moving thing itself, and
// the fixed "fire, water, smoke, steam, traffic" list disagreed with `judgeSelfMoving`.
describe("the thing meant to move is named, and only something else moving counts (2026-10-18)", () => {
  // Local job 262 scene 16 / job 329 scene 13 — two paid videos and three images for one still.
  const ALARM = "main smoke alarm mounted on hallway ceiling with a thin curl of smoke rising beneath it";
  const answer = (changes: unknown[], over: Record<string, unknown> = {}) =>
    JSON.stringify({ changes, cover: [], hands_visible: false, untouched_moved: false, morph: false, vanished: false, ...over });

  it("the system prompt carries no fixed list of what may move", () => {
    expect(CLIP_GLITCH_SYSTEM).not.toMatch(/fire, water, smoke, steam, traffic/);
    expect(CLIP_GLITCH_SYSTEM).toContain('"meant":true|false');
  });

  it("a self-moving shot's message names its description as what is meant to move", () => {
    const m = clipGlitchMessage(ALARM, true);
    expect(m).toContain(`The clip should show: ${ALARM}.`);
    expect(m).toContain("Whatever moves by itself in that description is MEANT to move");
    // Production job 182 #40 — what moves comes from the description, not a list.
    expect(clipGlitchMessage("both open windows in the house with curtains stirring from moving air", true)).toContain(
      "curtains stirring from moving air. Whatever moves by itself"
    );
  });

  it("a shot not of something self-moving names nothing meant to move", () => {
    const m = clipGlitchMessage(ALARM, false);
    expect(m).toContain(`The clip should show: ${ALARM}.`);
    expect(m).not.toMatch(/meant/i);
  });

  it("with no description, the model is told one thing is meant to move and to find it", () => {
    expect(clipGlitchMessage(undefined, true)).toMatch(/ONE thing in it is meant to move by itself/);
    expect(clipGlitchMessage("  ", false)).toBe("First frame on the left, last frame on the right. What changed?");
  });

  it("passes the logged reasons that were the smoke or flame itself", () => {
    expect(parseClipGlitchVerdict(answer([{ what: "smoke slightly denser/shifted on right", meant: true }]), true)).toEqual({
      glitch: false,
      what: "",
    });
    // A flat morph/vanished flag on the flame meant to move is not trusted on its own.
    expect(
      parseClipGlitchVerdict(answer([{ what: "flames height decreased", meant: true }], { morph: true, vanished: true }), true)
        .glitch
    ).toBe(false);
  });

  it("fails the camera moving closer, and an object sliding beside the smoke", () => {
    expect(parseClipGlitchVerdict(answer([{ what: "camera moved closer", meant: false }]), true)).toEqual({
      glitch: true,
      what: "camera moved closer",
    });
    expect(
      parseClipGlitchVerdict(
        answer([
          { what: "smoke drifted left", meant: true },
          { what: "the smoke alarm slid along the ceiling", meant: false },
        ]),
        true
      )
    ).toEqual({ glitch: true, what: "the smoke alarm slid along the ceiling" });
  });

  it("still fails hands, whatever is meant to move", () => {
    expect(
      parseClipGlitchVerdict(answer([{ what: "smoke rose", meant: true }], { hands_visible: true }), true)
    ).toEqual({ glitch: true, what: "hands appear in the video" });
  });

  it("an answer that ignored the shape falls back to the model's own untouched call", () => {
    expect(parseClipGlitchVerdict(answer(["smoke rose higher"]), true).glitch).toBe(false);
    expect(parseClipGlitchVerdict(answer(["the table slid left"], { untouched_moved: true }), true)).toEqual({
      glitch: true,
      what: "the table slid left",
    });
  });

  it("a shot not of something self-moving still fails any change, in either shape", () => {
    expect(parseClipGlitchVerdict(answer([{ what: "strip in front shifted", meant: false }]))).toEqual({
      glitch: true,
      what: "strip in front shifted",
    });
    // `meant` is only read on a self-moving shot: nothing is meant to move here.
    expect(parseClipGlitchVerdict(answer([{ what: "strip in front shifted", meant: true }])).glitch).toBe(true);
    expect(parseClipGlitchVerdict(answer([]))).toEqual({ glitch: false, what: "" });
  });
});
