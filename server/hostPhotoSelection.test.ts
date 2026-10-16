import { describe, it, expect } from "vitest";
import { oneTickChanges, pickHostPhoto, selectedHostPhotos } from "./hostPhotoSelection";

const lib = (ticks: boolean[], scores: (number | null)[] = []) =>
  ticks.map((isSelected, i) => ({
    id: i + 1,
    imageUrl: `https://r2/host-${i + 1}.jpg`,
    isSelected,
    qualityScore: scores[i] ?? null,
    pickedByHand: false,
  }));

describe("selectedHostPhotos — one photo per channel", () => {
  it("returns the channel's one ticked photo", () => {
    expect(selectedHostPhotos(lib([false, true, false])).map(r => r.id)).toEqual([2]);
  });

  it("never returns more than one photo, even when several are ticked (rows from before the rule)", () => {
    const rows = selectedHostPhotos(lib([true, true, true], [70, 92, 85]));
    expect(rows.map(r => r.id)).toEqual([2]); // the best of the ticked ones
  });

  it("lets the form's id win over the saved tick", () => {
    expect(selectedHostPhotos(lib([true, false, false]), [3]).map(r => r.id)).toEqual([3]);
  });

  it("takes the first KNOWN id when an older client sends several", () => {
    expect(selectedHostPhotos(lib([true, true]), [99, 2, 1]).map(r => r.id)).toEqual([2]);
  });

  it("falls back to the saved tick when the form names nothing known", () => {
    expect(selectedHostPhotos(lib([false, true]), [99]).map(r => r.id)).toEqual([2]);
  });

  it("picks the best photo on a channel with nothing ticked", () => {
    expect(selectedHostPhotos(lib([false, false], [60, 88])).map(r => r.id)).toEqual([2]);
  });

  it("is empty for an empty library", () => {
    expect(selectedHostPhotos([])).toEqual([]);
  });
});

describe("pickHostPhoto", () => {
  it("picks the highest score", () => {
    expect(pickHostPhoto(lib([true, false, false], [80, 95, 90]))?.id).toBe(2);
  });

  it("keeps library order on a tie, so a re-score never flips the choice", () => {
    expect(pickHostPhoto(lib([false, false], [90, 90]))?.id).toBe(1);
  });

  it("prefers any scored photo over one not measured yet", () => {
    expect(pickHostPhoto(lib([false, false], [null, 40]))?.id).toBe(2);
  });

  it("uses the operator's own pick whatever the scores say", () => {
    const rows = lib([false, false, false], [99, 50, 70]);
    rows[1].pickedByHand = true;
    expect(pickHostPhoto(rows)?.id).toBe(2);
  });

  it("falls back to the primary (first in order) when nothing is scored", () => {
    expect(pickHostPhoto(lib([false, false]))?.id).toBe(1);
  });
});

describe("oneTickChanges", () => {
  it("moves the tick to the chosen photo and unticks the rest", () => {
    expect(oneTickChanges(lib([true, false, true]), 2)).toEqual([
      { id: 1, isSelected: false },
      { id: 2, isSelected: true },
      { id: 3, isSelected: false },
    ]);
  });

  it("writes nothing when the chosen photo is already the only tick", () => {
    expect(oneTickChanges(lib([false, true]), 2)).toEqual([]);
  });
});
