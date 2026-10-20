/**
 * Where the big QR card starts (`shared/scanIntent.ts`): the sentence the script check reads the
 * scan window from must be the one `markCtaQrBlock` starts the card on.
 */
import { describe, expect, it } from "vitest";
import { scanWindowStart } from "./scanIntent";

describe("scanWindowStart", () => {
  it("is the first sentence that tells the viewer to scan (job 409's block)", () => {
    expect(
      scanWindowStart([
        "Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for.",
        "Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below.",
        "No timer on this — a lesson about hurry is a poor place to hurry you.",
      ])
    ).toBe(1);
  });

  it("is the fixed trigger line when the block has one, even after an earlier scan sentence", () => {
    // With the trigger, `markCtaQrBlock` starts the card ON it: an earlier "the code is on your
    // screen" still plays under the small corner card.
    expect(
      scanWindowStart([
        "The code is on your screen whenever you want it.",
        "Now go ahead and grab your phone.",
        "I'll wait right here.",
      ])
    ).toBe(1);
  });

  it("is -1 for a block that never says how to get the book", () => {
    expect(
      scanWindowStart([
        "It is a digital book, thirteen chapters long.",
        "Every chapter ends with an exercise.",
      ])
    ).toBe(-1);
  });
});
