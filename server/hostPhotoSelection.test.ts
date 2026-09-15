import { describe, it, expect } from "vitest";
import { selectedHostPhotos, canDeselectHostPhoto } from "./hostPhotoSelection";

const lib = (ticks: boolean[]) =>
  ticks.map((isSelected, i) => ({
    id: i + 1,
    imageUrl: `https://r2/host-${i + 1}.jpg`,
    isSelected,
  }));

describe("selectedHostPhotos", () => {
  it("defaults to the channel's saved ticks, in library order", () => {
    const rows = selectedHostPhotos(lib([true, false, true, true]));
    expect(rows.map(r => r.id)).toEqual([1, 3, 4]);
  });

  it("lets an explicit list from the form win over the saved ticks", () => {
    const rows = selectedHostPhotos(lib([true, false, true, true]), [2, 4]);
    expect(rows.map(r => r.id)).toEqual([2, 4]);
  });

  it("ignores unknown ids rather than rejecting the render", () => {
    const rows = selectedHostPhotos(lib([true, true]), [2, 99]);
    expect(rows.map(r => r.id)).toEqual([2]);
  });

  it("falls back to the saved ticks when the explicit list names nothing known", () => {
    const rows = selectedHostPhotos(lib([true, false]), [99]);
    expect(rows.map(r => r.id)).toEqual([1]);
  });

  it("uses every photo on a channel with nothing ticked (rows predating the column)", () => {
    const rows = selectedHostPhotos(lib([false, false]));
    expect(rows.map(r => r.id)).toEqual([1, 2]);
  });
});

describe("canDeselectHostPhoto", () => {
  it("refuses to untick the channel's last ticked photo", () => {
    expect(canDeselectHostPhoto(lib([true, false, false]), 1)).toBe(false);
  });

  it("allows unticking while another photo stays ticked", () => {
    expect(canDeselectHostPhoto(lib([true, true, false]), 1)).toBe(true);
  });

  it("treats unticking an already-unticked photo as harmless", () => {
    expect(canDeselectHostPhoto(lib([true, false]), 2)).toBe(true);
  });
});
