import { describe, it, expect, vi } from "vitest";

vi.mock("./db", () => ({ getAppSetting: vi.fn(), setAppSetting: vi.fn() }));
vi.mock("./storage", () => ({ storagePut: vi.fn(), presignOwnBucketUrl: async (u: string) => u }));
vi.mock("./providers/openai-image", () => ({ outpaintImage: vi.fn() }));

import {
  isWidescreen,
  planPlacement,
  acceptOutpaint,
  widescreenKeyFor,
  CANVAS_W,
  CANVAS_H,
} from "./ltxWidescreen";

describe("isWidescreen", () => {
  it("accepts 16:9 and the common near-misses, rejects 4:3 and portrait", () => {
    expect(isWidescreen(1920, 1080)).toBe(true);
    expect(isWidescreen(1376, 768)).toBe(true); // 1.79
    expect(isWidescreen(1200, 896)).toBe(false); // the two host photos that cut the head off
    expect(isWidescreen(1080, 1920)).toBe(false);
  });
});

describe("planPlacement", () => {
  it("fits a 4:3 photo by height and centres it, leaving equal side bands", () => {
    const p = planPlacement(1200, 896);
    expect(p.h).toBe(CANVAS_H);
    expect(p.w).toBe(Math.round(1200 * (CANVAS_H / 896)));
    expect(p.x).toBe(Math.round((CANVAS_W - p.w) / 2));
    expect(p.y).toBe(0);
    expect(p.x + p.w).toBeLessThanOrEqual(CANVAS_W);
  });
});

describe("acceptOutpaint", () => {
  const placed = planPlacement(1200, 896);
  const s = placed.h / 896;
  const face = { x: 592, y: 251, size: 205 };
  it("passes when the face is found where the photo was placed, at the same size", () => {
    const found = [{ x: placed.x + face.x * s, y: face.y * s + 10, size: face.size * s * 1.05 }];
    expect(acceptOutpaint(face, placed, 1200, 896, found).ok).toBe(true);
  });
  it("rejects a result that moved, shrank or lost the face", () => {
    expect(acceptOutpaint(face, placed, 1200, 896, []).ok).toBe(false);
    expect(acceptOutpaint(face, placed, 1200, 896, [{ x: 200, y: 200, size: face.size * s }]).ok).toBe(false);
    expect(acceptOutpaint(face, placed, 1200, 896, [{ x: placed.x + face.x * s, y: face.y * s, size: face.size * s * 0.5 }]).ok).toBe(false);
  });
  it("with no reference face, any face on the result passes", () => {
    expect(acceptOutpaint(null, placed, 1200, 896, [{ x: 1, y: 1, size: 50 }]).ok).toBe(true);
    expect(acceptOutpaint(null, placed, 1200, 896, []).ok).toBe(false);
  });
});

describe("widescreenKeyFor", () => {
  it("is a short stable key per photo", () => {
    expect(widescreenKeyFor("https://x/a.jpg")).toMatch(/^ltx_widescreen:[0-9a-f]{16}$/);
    expect(widescreenKeyFor("https://x/a.jpg")).toBe(widescreenKeyFor("https://x/a.jpg"));
  });
});
