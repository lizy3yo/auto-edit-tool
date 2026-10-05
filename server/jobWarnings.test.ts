import { describe, expect, it } from "vitest";
import { groupJobWarnings, warningScenesLabel } from "../shared/jobWarnings";

// The card of 2026-10-05, word for word: one cause, one warning per scene, each with HeyGen's JSON.
const needed = (scene: number, asset: string) =>
  `Scene ${scene}: the host could not be rendered (HeyGen avatar registration failed (404): {"error":{"code":"asset_not_found","doc_url":"https://developers.heygen.com/docs/error-codes#asset-not-found","message":"Asset ${asset} not found"}}). It is the start, a CTA or the end, so it was not made b-roll — Regenerate it or make it b-roll yourself.`;
const broll = (scene: number, asset: string) =>
  `Scene ${scene}: the host lane could not render this beat (HeyGen avatar registration failed (404): {"error":{"code":"asset_not_found","doc_url":"https://developers.heygen.com/docs/error-codes#asset-not-found","message":"Asset ${asset} not found"}}) — made it b-roll automatically. Regenerate renders a different still; returning the host needs a fresh host render.`;
const QR =
  "Scene 226: the big QR is only on screen for 5.4s of narration — add a line after the scan instruction (before ===END CTA===) so viewers have time to scan.";

describe("groupJobWarnings", () => {
  it("makes one row per cause, listing its scenes in order", () => {
    const groups = groupJobWarnings([
      QR,
      "Plan check 7 could not be fixed: flash shot 0.82s",
      needed(22, "cf47"),
      needed(16, "cf47"),
      needed(1, "cf47"),
      needed(219, "682e"),
      broll(25, "682e"),
      broll(48, "4719"),
    ]);
    expect(groups).toHaveLength(4);
    const [host, auto, qr, plan] = groups; // the biggest first, ties as first seen
    expect(warningScenesLabel(qr)).toBe("Scene 226");
    expect(plan.scenes).toEqual([]);
    expect(warningScenesLabel(plan)).toBe("");
    expect(warningScenesLabel(host)).toBe("Scenes 1, 16, 22, 219");
    expect(host.count).toBe(4);
    expect(warningScenesLabel(auto)).toBe("Scenes 25, 48");
  });

  it("takes the provider's raw error out of the sentence and keeps it as details", () => {
    const [host] = groupJobWarnings([needed(22, "cf47"), needed(219, "682e")]);
    expect(host.text).toBe(
      "the host could not be rendered. It is the start, a CTA or the end, so it was not made b-roll — Regenerate it or make it b-roll yourself."
    );
    expect(host.text).not.toMatch(/asset_not_found|\{/);
    // One entry per distinct error, so nothing a debugger needs is lost.
    expect(host.details).toHaveLength(2);
    expect(host.details[0]).toContain("Asset cf47 not found");
    expect(host.details[1]).toContain("Asset 682e not found");
  });

  it("leaves an ordinary parenthesis in the sentence", () => {
    const [qr] = groupJobWarnings([QR]);
    expect(qr.text).toContain("(before ===END CTA===)");
    expect(qr.details).toEqual([]);
  });

  it("drops nothing: every warning is counted in exactly one row", () => {
    const all = [
      QR,
      needed(1, "a"),
      needed(2, "b"),
      broll(3, "c"),
      "Plan check 11 could not be fixed: only 1% of cutaway time is moving",
      "Plan check 11 could not be fixed: only 1% of cutaway time is moving",
      "an unclosed (parenthesis stays as it is",
    ];
    const groups = groupJobWarnings(all);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(all.length);
    expect(groups.at(-1)!.text).toBe("an unclosed (parenthesis stays as it is");
  });

  it("keeps a film-wide warning apart from a per-scene one with the same words", () => {
    expect(groupJobWarnings(["Scene 4: no clip", "no clip"])).toHaveLength(2);
  });

  it("is empty for no warnings", () => {
    expect(groupJobWarnings(undefined)).toEqual([]);
    expect(groupJobWarnings([" "])).toEqual([]);
  });
});
