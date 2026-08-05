import { describe, it, expect } from "vitest";
import { fixClauseOnset } from "./longformVideo";

describe("fixClauseOnset", () => {
  it("capitalizes a lowercase mid-clause onset", () => {
    // The scene-22 (job 59) case that made ElevenLabs invent an "uhm".
    expect(
      fixClauseOnset("and buried utility trenches keep settling for ten.")
    ).toBe("And buried utility trenches keep settling for ten.");
  });

  it("leaves an already-capitalized onset unchanged", () => {
    expect(fixClauseOnset("Nightcrawlers pile up little mounds.")).toBe(
      "Nightcrawlers pile up little mounds."
    );
  });

  it("capitalizes the first letter, not leading punctuation/quote", () => {
    expect(fixClauseOnset('"and then it settles."')).toBe(
      '"And then it settles."'
    );
  });

  it("no-ops when there is no alphabetic character", () => {
    expect(fixClauseOnset("123 — 456")).toBe("123 — 456");
  });
});
