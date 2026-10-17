import { describe, expect, it } from "vitest";
import {
  pictureFlawWarning,
  pictureFlawWarningPrefix,
  pictureFlawWords,
  sceneShippedFlaws,
  shippedFlaws,
} from "./pictureFlaws";
import { groupJobWarnings } from "./jobWarnings";

describe("what a shipped picture still carries (the audit, 2026-10-18)", () => {
  it("is every flag the checks named but 'unchecked' — a check that could not run says nothing", () => {
    expect(shippedFlaws(["writing", "staged"])).toEqual(["writing", "staged"]);
    expect(shippedFlaws(["unchecked"])).toEqual([]);
    expect(shippedFlaws(undefined)).toEqual([]);
  });

  it("is said in plain words, joined like a sentence", () => {
    expect(pictureFlawWords(["writing"])).toBe("readable writing");
    expect(pictureFlawWords(["writing", "staged"])).toBe("readable writing and a staged look");
    expect(pictureFlawWords(["broken", "missing", "near copy"])).toBe(
      "broken geometry, its subject missing and a near copy of another picture"
    );
    expect(pictureFlawWords(["something new"])).toBe("something new"); // an unknown flag passes through
  });

  it("reads the same sentence on every scene, so the card groups them into one row (jobs 343, 383)", () => {
    const warnings = [
      pictureFlawWarning(17, ["writing"], false),
      pictureFlawWarning(33, ["writing"], false),
      pictureFlawWarning(30, ["missing"], false),
      pictureFlawWarning(10, ["missing", "staged"], true),
    ];
    const groups = groupJobWarnings(warnings);
    expect(groups[0]).toMatchObject({
      scenes: [17, 33],
      text: "picture shipped with readable writing — its redraws did not clear it",
      count: 2,
    });
    expect(groups).toHaveLength(3);
    expect(groups.some(g => g.text.startsWith("split panel shipped with"))).toBe(true);
    for (const [i, w] of warnings.entries())
      expect(w.startsWith(pictureFlawWarningPrefix([17, 33, 30, 10][i], i === 3))).toBe(true);
    // "Scene 1: …" is never taken for "Scene 17: …"
    expect(warnings[0].startsWith(pictureFlawWarningPrefix(1, false))).toBe(false);
  });

  it("shows on a cutaway's picture and a split's panel, never on a host take, a cover or an operator's image", () => {
    expect(sceneShippedFlaws({ pictureFlaws: ["writing"] })).toEqual({ flaws: ["writing"], panel: false });
    expect(sceneShippedFlaws({ hostPresent: true, splitVisual: "three piles", panelFlaws: ["missing"] })).toEqual({
      flaws: ["missing"],
      panel: true,
    });
    // made host later: the old picture is not what shows
    expect(sceneShippedFlaws({ hostPresent: true, pictureFlaws: ["writing"] })).toBeNull();
    expect(sceneShippedFlaws({ hostPresent: true, splitVisual: "three piles", pictureFlaws: ["writing"] })).toBeNull();
    expect(sceneShippedFlaws({ coverHero: true, pictureFlaws: ["writing"] })).toBeNull();
    expect(sceneShippedFlaws({ assetImageUrl: "https://r2/a.png", pictureFlaws: ["writing"] })).toBeNull();
    expect(sceneShippedFlaws({ pictureFlaws: [] })).toBeNull();
    expect(sceneShippedFlaws({})).toBeNull();
  });
});
