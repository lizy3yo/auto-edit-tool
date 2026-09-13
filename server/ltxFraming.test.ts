import { describe, it, expect, vi } from "vitest";

vi.mock("./storage", () => ({ presignOwnBucketUrl: async (u: string) => u }));
vi.mock("./claude", () => ({ invokeClaude: vi.fn() }));

import {
  planLtxCrop,
  planLtxBase,
  parseFaceBox,
  parsePersonBox,
  planLtxPersonCrop,
  personFromFace,
  PERSON_FILLS_PHOTO,
  FACE_MIN_PX,
  TARGET_FACE_FRAC,
  SKIP_ABOVE_FACE_FRAC,
  MIN_CROP_H,
  ASPECT,
} from "./ltxFraming";

const face = (x: number, y: number, size: number) => ({ x, y, size, q: 50 });
const aspect = (c: { w: number; h: number }) => c.w / c.h;

describe("planLtxCrop", () => {
  it("leaves a 16:9 close-up alone (Granny Mae: face 39% of height)", () => {
    const f = planLtxCrop(1376, 768, face(688, 261, 298));
    expect(f.crop).toBeNull();
    expect(f.faceFrac).toBeCloseTo(0.39, 2);
    expect(f.reason).toContain("rendered as is");
  });

  it("crops a 16:9 wide shot so the face reaches the target proportion (the workshop: 24%)", () => {
    const f = planLtxCrop(1376, 768, face(715, 192, 188));
    expect(f.crop).not.toBeNull();
    const c = f.crop!;
    // 16:9, even pixels, inside the photo.
    expect(aspect(c)).toBeCloseTo(ASPECT, 1);
    expect(c.w % 2).toBe(0);
    expect(c.h % 2).toBe(0);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(1376);
    expect(c.y + c.h).toBeLessThanOrEqual(768);
    // The window is the larger of "face at 38%" and the 544 px floor — here the floor wins.
    expect(c.h).toBe(MIN_CROP_H);
    expect(f.cropFaceFrac).toBeCloseTo(188 / MIN_CROP_H, 2);
    expect(f.cropFaceFrac!).toBeGreaterThan(SKIP_ABOVE_FACE_FRAC);
    // Face centred horizontally.
    expect(Math.abs(c.x + c.w / 2 - 715)).toBeLessThanOrEqual(2);
  });

  it("puts the face at the target proportion when the photo is big enough to allow it", () => {
    // 4K photo, face 500 px (23%): the window is sized by the face, not the floor.
    const f = planLtxCrop(3840, 2160, face(1900, 700, 500));
    expect(f.crop!.h).toBeCloseTo(500 / TARGET_FACE_FRAC, -1);
    expect(f.cropFaceFrac).toBeCloseTo(TARGET_FACE_FRAC, 2);
    // Eye line at the upper third: eyes (centre - 0.1 size) sit ~h/3 below the top.
    const c = f.crop!;
    expect(700 - 50 - c.y).toBeCloseTo(c.h / 3, -1);
  });

  it("clamps a face at the edge to a valid, off-centre window instead of leaving the photo", () => {
    const f = planLtxCrop(1376, 768, face(60, 120, 188));
    const c = f.crop!;
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.x + c.w).toBeLessThanOrEqual(1376);
  });

  it("takes the full width of a portrait phone photo and accepts a tighter face", () => {
    // 9:16 photo, face 30% of height: a 16:9 window cannot be wider than the photo.
    const f = planLtxCrop(1080, 1920, face(540, 600, 576));
    const c = f.crop!;
    expect(c.w).toBe(1080);
    expect(aspect(c)).toBeCloseTo(ASPECT, 1);
    expect(f.reason).toContain("full width");
    expect(f.cropFaceFrac!).toBeGreaterThan(TARGET_FACE_FRAC);
  });

  it("crops a portrait photo even when the face is large — the model must never get a 9:16", () => {
    const f = planLtxCrop(1080, 1920, face(540, 500, 800));
    expect(f.crop).not.toBeNull();
    expect(aspect(f.crop!)).toBeCloseTo(ASPECT, 1);
  });

  it("leaves a tiny avatar alone — a crop of a 160x160 photo is a thumbnail the model would upscale", () => {
    const f = planLtxCrop(160, 160, face(80, 70, 72));
    expect(f.crop).toBeNull();
    expect(f.reason).toContain("too small");
  });

  it("renders as is when no face is found, and says so", () => {
    const f = planLtxCrop(1376, 768, null);
    expect(f.crop).toBeNull();
    expect(f.faceFrac).toBeNull();
    expect(f.reason).toContain("no face");
  });

  it("renders as is when the photo is already the tightest window it allows", () => {
    // A 16:9 photo only 544 px tall with a small face: the floor is the whole photo.
    const f = planLtxCrop(968, 544, face(484, 200, 100));
    expect(f.crop).toBeNull();
    expect(f.reason).toContain("tightest");
  });

  it("records how many faces were seen so a second person is visible in the job", () => {
    const f = planLtxCrop(1376, 768, face(715, 192, 188), 2);
    expect(f.faces).toBe(2);
  });
});

describe("parseFaceBox (the LLM fallback's verdict)", () => {
  it("turns a box in fractions into pico's centre + size, in photo pixels", () => {
    const f = parseFaceBox(
      'Sure: {"found":true,"left":0.40,"top":0.20,"right":0.60,"bottom":0.50}',
      1000,
      800
    )!;
    expect(f.x).toBe(500);
    expect(f.y).toBeCloseTo(280);
    expect(f.size).toBeCloseTo(240); // the face's height, like pico's square side
    expect(f.source).toBe("haiku");
  });

  it("returns null for not-found, junk, or a degenerate box", () => {
    expect(
      parseFaceBox(
        '{"found":false,"left":0,"top":0,"right":0,"bottom":0}',
        1000,
        800
      )
    ).toBeNull();
    expect(parseFaceBox("no idea", 1000, 800)).toBeNull();
    expect(
      parseFaceBox(
        '{"found":true,"left":0.5,"top":0.5,"right":0.5,"bottom":0.5}',
        1000,
        800
      )
    ).toBeNull();
    expect(
      parseFaceBox(
        '{"found":true,"left":-1,"top":0.2,"right":0.6,"bottom":0.5}',
        1000,
        800
      )
    ).toBeNull();
  });
});

describe("planLtxBase (the smallest base pass where the face articulates)", () => {
  it("leaves a close-up on the graph's own 544p and sends no size", () => {
    const b = planLtxBase(0.39);
    expect(b.name).toBe("544p");
    expect(b.sizeToSend).toBeNull();
    expect(b.facePx).toBeGreaterThanOrEqual(FACE_MIN_PX);
  });

  it("raises a wide shot to the first base that reaches the floor", () => {
    // 25% of 544 = 136 (dead); of 736 = 184.
    const b = planLtxBase(0.25);
    expect(b.name).toBe("720p");
    expect(b.sizeToSend).toEqual({ width: 2560, height: 1440 });
    expect(b.capped).toBe(false);
  });

  it("goes to 1080p for a very wide shot, and flags it when capped at 720p", () => {
    expect(planLtxBase(0.16).name).toBe("1080p");
    const capped = planLtxBase(0.16, "720p");
    expect(capped.name).toBe("720p");
    expect(capped.capped).toBe(true);
  });

  it("stays at 544p with nothing sent when no face was found", () => {
    expect(planLtxBase(null)).toMatchObject({ name: "544p", sizeToSend: null });
  });
});

describe("planLtxPersonCrop (the window around the whole avatar)", () => {
  it("cuts the room away on a wide shot: the face grows, the body and hands stay inside", () => {
    // The workshop wide shot: 1376x768, face 188 px (24%), Haiku's person box mid-frame.
    const person = { x: 540, y: 100, w: 300, h: 500 };
    const f = planLtxPersonCrop(1376, 768, face(715, 192, 188), person);
    expect(f.personCrop).not.toBeNull();
    const c = f.personCrop!;
    expect(aspect(c)).toBeCloseTo(ASPECT, 2);
    // Holds the person box plus its margin (to the even-pixel grid the window snaps to).
    expect(c.x).toBeLessThanOrEqual(540 - 300 * 0.05 + 2);
    expect(c.x + c.w).toBeGreaterThanOrEqual(840 + 300 * 0.05 - 2);
    expect(c.y).toBeLessThanOrEqual(100 - 500 * 0.05 + 2);
    expect(c.y + c.h).toBeGreaterThanOrEqual(600 + 500 * 0.05 - 2);
    // And the face is a bigger share of the window than of the photo.
    expect(f.personFaceFrac!).toBeGreaterThan(188 / 768);
  });

  it("renders whole when the avatar already fills the photo — or spans its full height on a 16:9 photo", () => {
    // A standing host top to bottom of a 16:9 photo: the 16:9 window at that height IS the photo.
    expect(planLtxPersonCrop(1376, 768, face(715, 192, 188), { x: 480, y: 20, w: 470, h: 740 }).personCrop).toBeNull();
    const person = { x: 40, y: 20, w: 1300, h: 740 };
    const f = planLtxPersonCrop(1376, 768, face(688, 261, 298), person);
    expect(f.personCrop).toBeNull();
    expect(f.personReason).toMatch(/rendered whole/);
    expect(PERSON_FILLS_PHOTO).toBeLessThan(1);
  });

  it("guesses the avatar from the face when Haiku has no box", () => {
    const g = personFromFace(1376, 768, face(715, 192, 188));
    expect(g.source).toBe("proportional");
    expect(g.y).toBeLessThan(192); // hair above the face centre
    expect(g.y + g.h).toBe(768); // clamped at the photo's bottom (lap is below it)
    const f = planLtxPersonCrop(1376, 768, face(715, 192, 188), null);
    expect(f.personReason).toMatch(/guessed from the face/);
  });

  it("never goes below the model's own 544 px, and stays inside the photo", () => {
    const f = planLtxPersonCrop(1376, 768, face(300, 200, 150), { x: 200, y: 80, w: 220, h: 300 });
    const c = f.personCrop!;
    expect(c.h).toBeGreaterThanOrEqual(544);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.w).toBeLessThanOrEqual(1376);
    expect(c.y + c.h).toBeLessThanOrEqual(768);
  });

  it("says so when even the person window leaves the face small", () => {
    const f = planLtxPersonCrop(3840, 2160, face(1900, 500, 300), { x: 1400, y: 300, w: 1000, h: 1200 });
    expect(f.personFaceFrac!).toBeLessThan(0.33);
    expect(f.personReason).toMatch(/mouth may be soft/);
  });

  it("renders as is with no face or a tiny photo", () => {
    expect(planLtxPersonCrop(1376, 768, null, null).personCrop).toBeNull();
    expect(planLtxPersonCrop(160, 160, face(80, 70, 72), null).personCrop).toBeNull();
  });
});

describe("parsePersonBox", () => {
  it("reads the person box beside the face box, in photo pixels", () => {
    const p = parsePersonBox(
      '{"found":true,"left":0.40,"top":0.20,"right":0.60,"bottom":0.50,"person":{"left":0.30,"top":0.10,"right":0.70,"bottom":1.00}}',
      1000,
      800
    )!;
    expect(p).toEqual({ x: 300, y: 80, w: 400, h: 720, source: "haiku" });
  });

  it("returns null when there is no person box, not found, or a degenerate box", () => {
    expect(parsePersonBox('{"found":true,"left":0.4,"top":0.2,"right":0.6,"bottom":0.5}', 1000, 800)).toBeNull();
    expect(parsePersonBox('{"found":false,"person":{"left":0,"top":0,"right":0,"bottom":0}}', 1000, 800)).toBeNull();
    expect(parsePersonBox('{"found":true,"person":{"left":0.5,"top":0.5,"right":0.52,"bottom":0.9}}', 1000, 800)).toBeNull();
  });
});
