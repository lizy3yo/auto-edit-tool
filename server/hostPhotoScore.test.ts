import { describe, it, expect } from "vitest";
import {
  parsePhotoJudgement,
  scoreHostPhoto,
  type HostPhotoMeasure,
} from "./hostPhotoScore";
import { needsScore } from "./hostPhotoChoice";
import { skinFault, PHONE_LOOK_MIN_SKIN } from "./hostPhoneLook";

/** A good, ordinary host photo: one clear face, centred, lit, sharp. */
const good: HostPhotoMeasure = {
  width: 1376, height: 768, faces: 1, faceQ: 90, faceWidth: 0.22, faceX: 0.5, faceY: 0.4,
  faceLuma: 130, faceDetail: 14, skinTexture: 10, mouthContrast: 40,
};

describe("scoreHostPhoto — one photo per channel, the best one", () => {
  it("scores a clean photo with real skin and clear lips at the top", () => {
    const r = scoreHostPhoto(good, { skin: 5, mouth: 5 });
    expect(r.score).toBe(100);
    expect(r.notes).toEqual([]);
  });

  it("an airbrushed face loses to real skin (Scarlett's original judged 2, Brenda's 5)", () => {
    const airbrushed = scoreHostPhoto(good, { skin: 2, mouth: 5 });
    const real = scoreHostPhoto(good, { skin: 5, mouth: 5 });
    expect(real.score).toBeGreaterThan(airbrushed.score);
    expect(airbrushed.notes).toContain("skin looks airbrushed");
  });

  it("lips lost in a beard cost points (the review's Frederick lower-mouth smear)", () => {
    const r = scoreHostPhoto(good, { skin: 5, mouth: 3 });
    expect(r.score).toBeLessThan(100);
    expect(r.notes[0]).toMatch(/lips hard to see/);
  });

  it("a photo with no face scores 0", () => {
    expect(scoreHostPhoto({ ...good, faces: 0 }).score).toBe(0);
  });

  it("a second face, a tiny photo and an off-centre host all lose points, with reasons", () => {
    const r = scoreHostPhoto({ ...good, faces: 2, width: 160, height: 160, faceX: 0.85 }, { skin: 5, mouth: 5 });
    expect(r.score).toBeLessThan(75);
    expect(r.notes).toEqual(expect.arrayContaining(["more than one face", "small photo (160×160)", "host off centre"]));
  });

  it("falls back to the pixel readings when the judge has no answer", () => {
    expect(scoreHostPhoto(good, { skin: null, mouth: null }).score).toBeGreaterThan(80);
  });
});

describe("parsePhotoJudgement", () => {
  it("reads the two grades", () => {
    expect(parsePhotoJudgement('{"skin":2,"mouth":4}')).toEqual({ skin: 2, mouth: 4 });
  });
  it("ignores anything out of range or unreadable", () => {
    expect(parsePhotoJudgement('{"skin":9,"mouth":"x"}')).toEqual({ skin: null, mouth: null });
    expect(parsePhotoJudgement("no json")).toEqual({ skin: null, mouth: null });
  });
  it("reads whether the mouth is open, and leaves it out when the judge does not say", () => {
    expect(parsePhotoJudgement('{"skin":4,"mouth":5,"open":true}')).toEqual({ skin: 4, mouth: 5, open: true });
    expect(parsePhotoJudgement('{"skin":4,"mouth":5,"open":false}').open).toBe(false);
    expect(parsePhotoJudgement('{"skin":4,"mouth":5,"open":"yes"}')).not.toHaveProperty("open");
  });
});

describe("the phone look must have real skin", () => {
  it("refuses a copy judged retouched, passes real skin and a judge with no answer", () => {
    expect(skinFault(2)).toMatch(/retouched/);
    expect(skinFault(PHONE_LOOK_MIN_SKIN)).toBeNull();
    expect(skinFault(null)).toBeNull();
  });
});

describe("needsScore", () => {
  it("scores a photo never scored, or one whose picture changed", () => {
    expect(needsScore({ imageUrl: "a", qualityScore: null, qualityOf: null })).toBe(true);
    expect(needsScore({ imageUrl: "b", qualityScore: 80, qualityOf: "a" })).toBe(true);
    expect(needsScore({ imageUrl: "a", qualityScore: 80, qualityOf: "a" })).toBe(false);
  });
});

describe("the phone look gives a hard-to-see mouth a lip-sync-ready one (any channel)", () => {
  it("adds the mouth clause only when the lips are judged under 4", async () => {
    const { mouthReadyExtra, MOUTH_READY_CLAUSE } = await import("./hostPhoneLook");
    expect(mouthReadyExtra(3)).toBe(MOUTH_READY_CLAUSE);
    expect(mouthReadyExtra(4)).toBeUndefined();
    expect(mouthReadyExtra(null)).toBeUndefined();
    expect(MOUTH_READY_CLAUSE).not.toMatch(/Frederick|Dale|Hank|Scarlett/);
  });
});

describe("an open mouth in the photo is rested closed (any channel)", () => {
  it("asks for closed lips and nothing else changed, and names no person", async () => {
    const { REST_MOUTH_PROMPT, REST_MOUTH_DRAWS } = await import("./hostPhoneLook");
    expect(REST_MOUTH_PROMPT).toMatch(/NO teeth visible/);
    expect(REST_MOUTH_PROMPT).toMatch(/Change NOTHING else/);
    expect(REST_MOUTH_PROMPT).not.toMatch(/Frederick|Dale|Hank|Scarlett|Ruth/);
    expect(REST_MOUTH_DRAWS).toBe(2);
  });
});
