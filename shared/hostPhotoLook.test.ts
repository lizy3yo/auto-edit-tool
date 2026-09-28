import { describe, expect, it } from "vitest";
import { hostPhotoLookState, hostPhotoUrl, testPhotoState, testPhotoUrl } from "./hostPhotoLook";

const photo = { imageUrl: "orig.jpg", phoneImageUrl: "phone.png", useOriginal: false, phoneLookError: null };

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
  it("applies the same rule to a HeyGen test photo", () => {
    expect(testPhotoUrl({ original: "o.jpg", phone: "p.png", useOriginal: false })).toBe("p.png");
    expect(testPhotoUrl({ original: "o.jpg", phone: "p.png", useOriginal: true })).toBe("o.jpg");
    expect(testPhotoState({ original: "o.jpg", useOriginal: false })).toBe("making");
  });
});
