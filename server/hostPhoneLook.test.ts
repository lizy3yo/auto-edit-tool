import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  canvasFor,
  framingFault,
  LOOK_LIMITS,
  MAX_MIRRORED_EDGE,
  measureLook,
  MIN_MATCH,
  nearestShape,
  PHONE_LOOK_PROMPT,
  planFramingLock,
  qualityFault,
} from "./hostPhoneLook";

const canvas = { width: 1920, height: 1072 };
/** A copy that sits exactly on its photo. */
const same = { scale: 1, left: 0, top: 0, score: 0.97 };
/** A copy resized by `scale` about the middle of the frame, then moved by (dx, dy) of the frame. */
const drifted = (scale: number, dx = 0, dy = 0, score = 0.97) => ({
  scale,
  left: (1 - scale) / 2 + dx,
  top: (1 - scale) / 2 + dy,
  score,
});

describe("the phone-look recipe", () => {
  it("keeps the host where the photo puts them — the first phone look re-shot them", () => {
    expect(PHONE_LOOK_PROMPT).toMatch(/exactly the same position and exactly the same size/);
    expect(PHONE_LOOK_PROMPT).toMatch(/do not make the person bigger or smaller/);
    expect(PHONE_LOOK_PROMPT).toMatch(/Do not move, zoom, reframe, add or remove anything/);
    // The 2026-09-28 recipe's framing words, which moved Frederick 4% and shrank him 13%.
    expect(PHONE_LOOK_PROMPT).not.toMatch(/off-centre|chest up|below eye level|plenty of the/i);
  });
  it("keeps the person: same age and make-up (a draft aged Scarlett and took her lipstick)", () => {
    expect(PHONE_LOOK_PROMPT).toMatch(/SAME AGE — not older, not younger, no added wrinkles/);
    expect(PHONE_LOOK_PROMPT).toMatch(/the same make-up if they wear any/);
  });
  it("asks for the competitors' quality: flat light, weak colour, soft detail, room in focus", () => {
    expect(PHONE_LOOK_PROMPT).toMatch(/flat, dull indoor light/);
    expect(PHONE_LOOK_PROMPT).toMatch(/Muted, slightly washed-out/);
    expect(PHONE_LOOK_PROMPT).toMatch(/Moderately soft like 720p phone video/);
    expect(PHONE_LOOK_PROMPT).toMatch(/whole room is in focus/);
    expect(PHONE_LOOK_PROMPT).toMatch(/no airbrushing, no glow, no beauty smoothing/);
  });
  it("names no channel, person or room — it must work on any host photo", () => {
    expect(PHONE_LOOK_PROMPT).not.toMatch(/frederick|scarlett|garage|workshop|pegboard|woodshop/i);
  });
});

describe("the shape a copy is drawn in", () => {
  it("asks the image model for the shape nearest the photo's own", () => {
    expect(nearestShape(1376, 768)).toBe("16:9"); // 21 of the 23 library photos
    expect(nearestShape(1200, 896)).toBe("4:3");
    expect(nearestShape(900, 900)).toBe("1:1");
    expect(nearestShape(768, 1376)).toBe("9:16");
  });
  it("works on the photo's own shape, so nothing is cropped to fit another", () => {
    expect(canvasFor(1376, 768)).toEqual({ width: 1920, height: 1072 });
    expect(canvasFor(1200, 896)).toEqual({ width: 1920, height: 1434 });
    expect(canvasFor(768, 1376)).toEqual({ width: 1072, height: 1920 });
  });
});

describe("lining a copy up to the original", () => {
  it("leaves a copy that already matches alone", () => {
    expect(planFramingLock(same, canvas)).toMatchObject({ scale: 1, left: 0, top: 0, edge: 0 });
  });
  it("enlarges a copy that came back smaller, with nothing left uncovered", () => {
    // Frederick's chosen sample as drawn: 1.25% small and 1.4% low.
    const lock = planFramingLock(drifted(1.0125, 0, -0.004), canvas);
    expect(lock.scale).toBe(1.0125);
    expect(lock.left).toBeLessThan(0);
    expect(lock.top).toBeLessThan(0);
    expect(lock.edge).toBe(0);
  });
  it("shrinks a copy that came back bigger, mirroring a thin strip at the edge", () => {
    const lock = planFramingLock(drifted(0.9775), canvas);
    expect(lock.pad.left).toBeGreaterThan(0);
    expect(lock.pad.right).toBeGreaterThan(0);
    expect(lock.edge).toBeGreaterThan(0);
    expect(lock.edge).toBeLessThanOrEqual(MAX_MIRRORED_EDGE);
  });
  it("refuses a copy so far out that the strip would repeat the room", () => {
    expect(planFramingLock(drifted(0.93), canvas).edge).toBeGreaterThan(MAX_MIRRORED_EDGE);
    expect(planFramingLock(drifted(1, 0.05, 0.04), canvas).edge).toBeGreaterThan(MAX_MIRRORED_EDGE);
  });
});

describe("checking the copy sits on the photo", () => {
  it("passes the same place and size, within the measurement's own grain", () => {
    expect(framingFault(same)).toBeNull();
    expect(framingFault(drifted(1.0025, 0.002, -0.002))).toBeNull();
  });
  it("names a host who moved — the first phone look sat 4% to the side", () => {
    expect(framingFault(drifted(1, -0.04, 0))).toContain("moved in the frame (4.0% off)");
  });
  it("names a host who changed size — the first phone look was 13% smaller", () => {
    expect(framingFault(drifted(1.13))).toMatch(/different size/);
  });
  it("refuses a picture that is not the photo's — measured on real pairs", () => {
    // Every copy that visibly matched read 0.95-0.98.
    for (const score of [0.954, 0.963, 0.97, 0.976]) expect(framingFault({ ...same, score })).toBeNull();
    // The first phone look's re-shot copies, the draft that aged Scarlett, two different hosts.
    for (const score of [0.778, 0.767, 0.787, 0.508])
      expect(framingFault({ ...same, score })).toMatch(/does not match the photo/);
    expect(MIN_MATCH).toBeGreaterThan(0.787);
    expect(MIN_MATCH).toBeLessThan(0.954);
  });
});

describe("holding a copy to the competitors' quality", () => {
  // Measured 2026-10-11: competitor hosts read colour 20 / 24 / 23 and detail 360 / 318 / 115.
  const frederick = { colour: 38, detail: 349, room: 10 };
  const scarlett = { colour: 30, detail: 849, room: 13 };

  it("passes every competitor frame against either of our originals", () => {
    for (const c of [
      { colour: 20, detail: 360, room: 88 },
      { colour: 24, detail: 318, room: 179 },
      { colour: 23, detail: 115, room: 71 },
    ]) {
      expect(qualityFault(c, frederick)).toBeNull();
      expect(qualityFault(c, scarlett)).toBeNull();
    }
  });
  it("passes the two samples the operator chose", () => {
    expect(qualityFault({ colour: 30, detail: 190, room: 22 }, frederick)).toBeNull();
    expect(qualityFault({ colour: 15, detail: 556, room: 24 }, scarlett)).toBeNull();
  });
  it("refuses a photo that came back as it went in", () => {
    expect(qualityFault(frederick, frederick)).toMatch(/colours are still too strong/);
    expect(qualityFault(scarlett, scarlett)).toMatch(/colours are still too strong/);
  });
  it("refuses the first draft, which un-blurred the room and came back SHARPER", () => {
    expect(qualityFault({ colour: 25, detail: 929, room: 40 }, scarlett)).toMatch(/still too sharp/);
    expect(qualityFault({ colour: 26, detail: 819, room: 238 }, frederick)).toMatch(/still too sharp/);
  });
  it("refuses a smear and a grey frame — the draft that returned Frederick at detail 37", () => {
    expect(qualityFault({ colour: 22, detail: 37, room: 21 }, frederick)).toMatch(/too blurry/);
    expect(
      qualityFault({ colour: LOOK_LIMITS.colourMin - 1, detail: 200, room: 22 }, frederick)
    ).toMatch(/washed out/);
  });
  it("refuses a copy whose room is still blurred — a phone has no portrait lens", () => {
    // The first real run: every other check passed, the garage as soft as it went in.
    expect(qualityFault({ colour: 29, detail: 165, room: 11 }, frederick)).toMatch(
      /room behind the host is still blurred/
    );
  });
  it("does not ask a photo whose room is already in focus to sharpen it", () => {
    const inFocus = { colour: 34, detail: 400, room: 120 };
    expect(qualityFault({ colour: 22, detail: 240, room: 80 }, inFocus)).toBeNull();
    // Dale: a barn wall at 25 beside a bearded face at 1146. The softer finish takes the wall to
    // 16, and that is right — a first rule that judged the room against the face refused it.
    const dale = { colour: 46, detail: 1146, room: 25 };
    expect(qualityFault({ colour: 22, detail: 439, room: 16 }, dale)).toBeNull();
  });
  it("passes Brenda's copy: a blurred barn that came back in focus", () => {
    expect(qualityFault({ colour: 15, detail: 332, room: 10 }, { colour: 22, detail: 327, room: 7 })).toBeNull();
  });
});

describe("measuring a frame", () => {
  const flat = (r: number, g: number, b: number) =>
    sharp({ create: { width: 960, height: 540, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();

  it("reads no colour and no detail off a flat grey frame", async () => {
    expect(await measureLook(await flat(128, 128, 128))).toEqual({ colour: 0, detail: 0, room: 0 });
  });
  it("reads strong colour off a saturated frame", async () => {
    expect((await measureLook(await flat(200, 40, 40))).colour).toBe(80);
  });
  it("reads more detail off a sharp frame than off the same frame blurred", async () => {
    const noise = Buffer.alloc(960 * 540 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 2654435761) % 256;
    const sharpFrame = await sharp(noise, { raw: { width: 960, height: 540, channels: 3 } })
      .png()
      .toBuffer();
    const soft = await sharp(sharpFrame).blur(3).png().toBuffer();
    expect((await measureLook(sharpFrame)).detail).toBeGreaterThan(
      (await measureLook(soft)).detail * 5
    );
  });
});
