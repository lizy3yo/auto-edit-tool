import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findSubject, footprint, onSubject, subjectMap } from "./legibility";
import { CHAPTER_PLATE, chapterBox } from "./overlays";
import { MYTH_STAMP_BAND, MYTH_STAMP_PLACES } from "./more";
import { templateById } from "./registry";
import { CORNERS, SUBJECT_MIN_GAIN, SUBJECT_MOVE_RATIO, clearSpot, numberLabelAnchor, numberLabelBox, placeBox, type Spots } from "./spots";
import type { Place } from "./components";

/**
 * A graphic that sits at a FIXED spot on the picture goes where it is clear of the picture's subject
 * (round 14, the verification films on the round-12 code). Job 413 (2:02-2:05): "From $25 / To $75"
 * sat bottom-left on the phone screen whose listing it priced, over the listing's title and the thumb
 * holding the phone. Job 412: the MYTH stamp sat top-right on the sleeper's head (0:36), and the
 * nocturnal-myth stamp and its line, the same spot for both shots, crossed the cat's eye after the cut
 * (1:44). NumberLabel and ChapterLabel could not move at all, and the MYTH stamp only for contrast.
 * The maps are the real frames' (`subjectMap`), stored in __fixtures__/subject-maps.json.
 */
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "__fixtures__", "subject-maps.json"), "utf8")) as { maps: Record<string, number[]> };
const maps = (...names: string[]) => names.map(n => fixture.maps[n]);
const FRAME = { w: 1920, h: 1080 };
const spotsOf = (id: string) => templateById(id).spots!;
const name = (p: Place) => `${p.v} ${p.h}`;
// Drawings as they shipped, measured off the films' frames (px at 1920x1080).
const STAMP = { w: 534, h: 254 }; // "MYTH" alone
const STAMP_LINE = { w: 728, h: 410 }; // "MYTH" over a two-line myth
const PRICE_PAIR = { w: 540, h: 220 }; // kicker over two value pills
const PLATE = { w: CHAPTER_PLATE.w, h: CHAPTER_PLATE.h };

describe("a graphic at a fixed spot goes where it is clear of the picture's subject", () => {
  it("job 413: the price pair leaves the phone it prices for the shirt beside it (bottom-left → bottom-right)", () => {
    const c = clearSpot(spotsOf("NumberLabel"), PRICE_PAIR, maps("phone"), FRAME);
    expect(c.moved).toBe(true);
    expect([name(c.from), name(c.place)]).toEqual(["bottom left", "bottom right"]);
    const on = (p: string) => c.scores.find(s => name(s.place) === p)!.on;
    expect(on("bottom right")).toBeLessThanOrEqual(SUBJECT_MOVE_RATIO * on("bottom left"));
  });

  it("job 412: the MYTH stamp leaves the sleeper's head for the wall and door (top-right → top-left)", () => {
    const c = clearSpot(spotsOf("MythStamp"), STAMP, maps("revenge"), FRAME);
    expect([c.moved, name(c.place)]).toEqual([true, "top left"]);
  });

  it("job 412: one place for both shots a stamp crosses — off the cat's face on the second", () => {
    const c = clearSpot(spotsOf("MythStamp"), STAMP_LINE, maps("noct21", "noct22"), FRAME);
    expect([c.moved, name(c.place)]).toEqual([true, "top left"]);
    // each place is held to the most it covers on either picture
    const tr = c.scores.find(s => name(s.place) === "top right")!.on;
    const box = spotsOf("MythStamp").box({ h: "right", v: "top" }, STAMP_LINE);
    expect(tr).toBeCloseTo(Math.max(...maps("noct21", "noct22").map(m => onSubject(m, box, FRAME.w, FRAME.h))), 9);
  });

  it("job 397: the chapter plate leaves the stack of boards its chapter is about (bottom-left → bottom-right)", () => {
    const c = clearSpot(spotsOf("ChapterLabel"), PLATE, maps("fairs"), FRAME);
    expect([c.moved, name(c.place)]).toEqual([true, "bottom right"]);
  });

  // Placements the reviews passed as clear stay where they were designed.
  it.each([
    ["job 413, the knife table: the price pair on the asphalt", "NumberLabel", PRICE_PAIR, ["knives"]],
    ["job 413, the fixed mower: the price pair on the driveway", "NumberLabel", PRICE_PAIR, ["fixedmower"]],
    ["job 401, the card rack, over two shots", "NumberLabel", PRICE_PAIR, ["age3", "age4"]],
    ["job 397, the bookcase: the price pair on the boards leaning by it", "NumberLabel", PRICE_PAIR, ["furniture"]],
    ["job 406, the belt sander: the price pair on his jeans", "NumberLabel", PRICE_PAIR, ["sharp406"]],
    ["job 411, frosted grass: the stamp", "MythStamp", STAMP, ["robins"]],
    ["job 414, the broadaxe: the chapter plate on his sleeve", "ChapterLabel", PLATE, ["walls"]],
    ["job 397, the board by the garage door: the chapter plate on the bench", "ChapterLabel", PLATE, ["adfee"]],
    ["job 410, the can poured: the chapter plate under the cup", "ChapterLabel", PLATE, ["wholecan"]],
  ] as const)("%s — stays", (_what, template, size, frames) => {
    const c = clearSpot(spotsOf(template), size, maps(...frames), FRAME);
    expect(c.moved).toBe(false);
    expect(c.place).toEqual(spotsOf(template).places[0]);
  });

  it("the place it was put in is the one kept (a place already set on the graphic)", () => {
    const c = clearSpot(spotsOf("MythStamp"), STAMP, maps("revenge"), FRAME, { h: "left", v: "top" });
    expect([c.moved, name(c.from), name(c.place)]).toEqual([false, "top left", "top left"]);
  });

  it("moves only for a clear gain: a little less of the subject, or a shade of it, is not worth a new place", () => {
    const spots: Spots = { places: CORNERS, box: numberLabelBox };
    const flat = (byCorner: Record<string, number>) => {
      // a 16 x 9 map whose quarters carry the given values
      const m: number[] = [];
      for (let y = 0; y < 9; y++) for (let x = 0; x < 16; x++) m.push(byCorner[`${y < 4.5 ? "top" : "bottom"} ${x < 8 ? "left" : "right"}`]);
      return m;
    };
    // 0.5 → 0.35 is 70% of it: stays
    expect(clearSpot(spots, PRICE_PAIR, [flat({ "bottom left": 0.5, "bottom right": 0.35, "top left": 0.6, "top right": 0.6 })], FRAME).moved).toBe(false);
    // 0.06 → 0.02 is a third of it, but only 0.04 less: stays
    expect(clearSpot(spots, PRICE_PAIR, [flat({ "bottom left": 0.06, "bottom right": 0.02, "top left": 0.6, "top right": 0.6 })], FRAME).moved).toBe(false);
    expect(0.06 - 0.02).toBeLessThan(SUBJECT_MIN_GAIN);
    // 0.5 → 0.2: moves, to the earliest of the best on a tie
    const c = clearSpot(spots, PRICE_PAIR, [flat({ "bottom left": 0.5, "bottom right": 0.2, "top left": 0.2, "top right": 0.2 })], FRAME);
    expect([c.moved, name(c.place)]).toEqual([true, "bottom right"]);
  });
});

describe("each template's places are where it draws itself", () => {
  it("NumberLabel: bottom-left as designed (120 px in, 120 px up), the other corners mirrored", () => {
    expect(numberLabelAnchor()).toMatchObject({ left: 120, bottom: 120, alignItems: "flex-start" });
    expect(numberLabelAnchor({ h: "right", v: "top" })).toMatchObject({ right: 120, top: 150, alignItems: "flex-end" });
    expect(numberLabelBox({ h: "left", v: "bottom" }, PRICE_PAIR)).toEqual({ x0: 120, y0: 740, x1: 660, y1: 960 });
    expect(numberLabelBox({ h: "right", v: "top" }, PRICE_PAIR)).toEqual({ x0: 1260, y0: 150, x1: 1800, y1: 370 });
    expect(spotsOf("NumberLabel").places[0]).toEqual({ h: "left", v: "bottom" });
  });

  it("ChapterLabel over b-roll: the designed band bottom-left, and the plate the same size in every corner", () => {
    expect(chapterBox({ place: { h: "left", v: "bottom" } })).toEqual(chapterBox({}));
    expect(spotsOf("ChapterLabel").box({ h: "left", v: "bottom" }, PLATE)).toEqual({ x0: 100, y0: 660, x1: 1060, y1: 925 });
    expect(spotsOf("ChapterLabel").box({ h: "right", v: "top" }, PLATE)).toEqual({ x0: 860, y0: 150, x1: 1820, y1: 415 });
    // over a host take the layout places it; a place is not read
    expect(chapterBox({ low: true, place: { h: "right", v: "top" } })).toEqual(chapterBox({ low: true }));
  });

  it("MythStamp: top-right as designed, in the bands `placeStyle` draws it in", () => {
    expect(MYTH_STAMP_PLACES[0]).toEqual({ h: "right", v: "top" });
    expect(spotsOf("MythStamp").places).toEqual(MYTH_STAMP_PLACES);
    expect(placeBox({ h: "right", v: "top" }, STAMP, MYTH_STAMP_BAND)).toEqual({ x0: 1226, y0: 150, x1: 1760, y1: 404 });
    expect(placeBox({ h: "left", v: "bottom" }, STAMP, MYTH_STAMP_BAND)).toEqual({ x0: 160, y0: 610, x1: 694, y1: 864 });
  });

  it("only the graphics that sat at a fixed spot have places of their own", () => {
    expect(["NumberLabel", "MythStamp", "ChapterLabel"].every(id => !!templateById(id).spots)).toBe(true);
    expect(templateById("SmallLabel").spots).toBeUndefined();
    expect(templateById("HostCaption").spots).toBeUndefined();
  });
});

describe("the subject map: what stands out, not what is busy", () => {
  // A frame of repeated texture (a fleece, asphalt, a planked wall) with one plain thing on it.
  const W = 640, H = 360;
  const frame = (thing: { x: number; y: number; r: number } | undefined, textured = true) => {
    const f = new Uint8Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = textured ? ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 150 : 60) : 100;
      if (thing && (x - thing.x) ** 2 + (y - thing.y) ** 2 < thing.r ** 2) v = 235;
      f.set([v, v, v], (y * W + x) * 3);
    }
    return f;
  };

  it("the one thing on a busy texture is the subject, and the texture far from it is not", () => {
    const film = frame({ x: 480, y: 120, r: 44 });
    const m = subjectMap(film, W, H);
    const at = (x: number, y: number) => m[Math.floor((y / H) * 9) * 16 + Math.floor((x / W) * 16)];
    expect(at(480, 120)).toBe(1);
    expect(at(100, 300)).toBeLessThan(0.1);
    // so a graphic over the thing covers more of the subject than one over the texture
    const box = (x: number, y: number) => ({ x0: x - 60, y0: y - 40, x1: x + 60, y1: y + 40 });
    expect(onSubject(m, box(480, 120), W, H)).toBeGreaterThan(4 * onSubject(m, box(120, 280), W, H));
    // the detail energy `findSubject` reads finds the texture, and spreads over the whole frame
    expect(findSubject(film, W, H).box).toEqual({ x0: 0, y0: 0, x1: W - 1, y1: H - 1 });
  });

  it("a frame with nothing in it has no subject (no NaN)", () => {
    const m = subjectMap(frame(undefined, false), W, H);
    expect(m.every(v => Number.isFinite(v))).toBe(true);
  });

  it("a drawing's footprint is its plate and letters, not its faint shadow", () => {
    const ov = new Uint8Array(W * H * 4);
    for (let y = 100; y < 150; y++) for (let x = 20; x < 120; x++) ov[(y * W + x) * 4 + 3] = 190; // a plate
    for (let x = 10; x < 130; x++) ov[(95 * W + x) * 4 + 3] = 30; // shadow
    expect(footprint(ov, W, H)).toEqual({ x0: 20, y0: 100, x1: 120, y1: 150 });
    expect(footprint(new Uint8Array(W * H * 4), W, H)).toBeUndefined();
  });
});
