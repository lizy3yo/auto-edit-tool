import { describe, expect, it } from "vitest";
import {
  hostPhotoLookState,
  hostPhotoUrl,
  isPhoneLookUrl,
  PHONE_LOOK_UPGRADES_FROM,
  PHONE_LOOK_VERSION,
  usablePhoneLook,
  testPhotoState,
  testPhotoUrl,
  testPhotoUrls,
} from "./hostPhotoLook";

const photo = { imageUrl: "orig.jpg", phoneImageUrl: "phone.png", useOriginal: false, phoneLookError: null, phoneLookVersion: PHONE_LOOK_VERSION };

describe("which picture a host photo renders from", () => {
  it("uses the phone look by default", () => {
    expect(hostPhotoUrl(photo)).toBe("phone.png");
    expect(hostPhotoLookState(photo)).toBe("phone");
  });
  it("uses the original when switched to it", () => {
    const p = { ...photo, useOriginal: true };
    expect(hostPhotoUrl(p)).toBe("orig.jpg");
    expect(hostPhotoLookState(p)).toBe("original");
  });
  it("uses the original while the phone look is being made, and says so", () => {
    const p = { ...photo, phoneImageUrl: null };
    expect(hostPhotoUrl(p)).toBe("orig.jpg");
    expect(hostPhotoLookState(p)).toBe("making");
  });
  it("uses the original when the phone look failed, and says so", () => {
    const p = { ...photo, phoneImageUrl: null, phoneLookError: "no face" };
    expect(hostPhotoUrl(p)).toBe("orig.jpg");
    expect(hostPhotoLookState(p)).toBe("failed");
  });
  it("never renders a copy made by an older recipe — it reads as still being made", () => {
    // The 2026-09-28 copies moved the host off-centre and zoomed out; they are still on the rows.
    for (const phoneLookVersion of [0, undefined, null, PHONE_LOOK_VERSION - 1]) {
      const p = { ...photo, phoneLookVersion };
      expect(hostPhotoUrl(p)).toBe("orig.jpg");
      expect(hostPhotoLookState(p)).toBe("making");
    }
  });
  it("ignores an older recipe's failure, so today's recipe gets its own try", () => {
    const p = { ...photo, phoneImageUrl: null, phoneLookError: "no face", phoneLookVersion: 0 };
    expect(hostPhotoLookState(p)).toBe("making");
  });
  it("keeps a copy out of use once the current recipe failed on a remake", () => {
    const p = { ...photo, phoneLookError: "came back a different size" };
    expect(hostPhotoUrl(p)).toBe("orig.jpg");
    expect(hostPhotoLookState(p)).toBe("failed");
  });
  it("applies the same rule to a HeyGen test photo", () => {
    expect(testPhotoUrl({ original: "o.jpg", phone: "p.png", useOriginal: false })).toBe("p.png");
    expect(testPhotoUrl({ original: "o.jpg", phone: "p.png", useOriginal: true })).toBe("o.jpg");
    expect(testPhotoState({ original: "o.jpg", useOriginal: false })).toBe("making");
  });

  it("puts both looks of one photo in a run when asked — the original, then the phone look", () => {
    const p = { original: "o.jpg", phone: "p.png", useOriginal: false };
    expect(testPhotoUrls(p)).toEqual(["p.png"]);
    expect(testPhotoUrls({ ...p, useOriginal: true })).toEqual(["o.jpg"]);
    expect(testPhotoUrls({ ...p, both: true })).toEqual(["o.jpg", "p.png"]);
    // Whatever the switch says: both means both.
    expect(testPhotoUrls({ ...p, both: true, useOriginal: true })).toEqual(["o.jpg", "p.png"]);
  });
  it("tests one look only while the phone look is missing or failed", () => {
    expect(testPhotoUrls({ original: "o.jpg", useOriginal: false, both: true })).toEqual(["o.jpg"]);
    expect(
      testPhotoUrls({ original: "o.jpg", phone: "p.png", failed: "no face", useOriginal: false, both: true })
    ).toEqual(["o.jpg"]);
  });
  it("tells a phone-look copy from a photo as uploaded by where it is stored", () => {
    expect(isPhoneLookUrl("https://cdn.example/host-photos/phone-v2-abc.jpg")).toBe(true);
    expect(isPhoneLookUrl("https://cdn.example/style-references/1/JO5iVn.jpg")).toBe(false);
  });
});

describe("v4 brings a v3 copy up to date instead of drawing it again", () => {
  it("never renders the v3 copy as it was, and names v3 as the one it upgrades", () => {
    expect(PHONE_LOOK_VERSION).toBe(4);
    expect(PHONE_LOOK_UPGRADES_FROM).toBe(3);
    expect(usablePhoneLook({ ...photo, phoneLookVersion: 3 })).toBeNull();
    expect(usablePhoneLook(photo)).toBe("phone.png");
  });
});
