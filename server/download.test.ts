import { describe, expect, it } from "vitest";
import { sanitizeFilename } from "./download";

describe("sanitizeFilename", () => {
  it("strips non-ASCII chars so Content-Disposition stays Latin-1 safe", () => {
    const name = sanitizeFilename(
      "From Worst Lawn on the Block to Greenest — The Beginner Plan Anyone Can Follow This Weekend"
    );
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/^[\x20-\x7E]+$/);
    expect(() =>
      new Headers().set(
        "Content-Disposition",
        `attachment; filename="${name}.mp3"`
      )
    ).not.toThrow();
  });

  it("returns empty string when nothing usable remains", () => {
    expect(sanitizeFilename("🌱🌿—“”")).toBe("");
  });
});
