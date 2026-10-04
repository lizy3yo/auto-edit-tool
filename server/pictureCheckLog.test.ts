import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  checkFlags,
  pictureKindOf,
  recordPictureCheck,
  tallyPictureChecks,
} from "./pictureCheckLog";

const scene = (over: Partial<StoryboardScene> = {}): StoryboardScene =>
  ({ index: 1, visualPrompt: "a walnut board on a bench", ...over }) as StoryboardScene;

describe("what kind of picture was checked", () => {
  it("names the most failure-prone thing a picture is", () => {
    expect(pictureKindOf(scene(), "a walnut board on a bench")).toBe("plain");
    expect(pictureKindOf(scene({ keyThing: "the board" }), "the board")).toBe("key thing");
    expect(pictureKindOf(scene({ humanPresent: true, keyThing: "the board" }), "x")).toBe(
      "person or hands"
    );
    expect(pictureKindOf(scene({ namedLook: "herringbone", humanPresent: true }), "x")).toBe(
      "named kind"
    );
    expect(pictureKindOf(scene({ blurPrint: true, namedLook: "herringbone" }), "x")).toBe(
      "writing"
    );
    // A screen wins over everything: it is where writing and wrong items come from.
    expect(pictureKindOf(scene({ keyThing: "the board" }), "a phone screen showing a listing")).toBe(
      "screen"
    );
  });

  it("lists every defect a verdict names, and nothing for a pass", () => {
    expect(checkFlags({})).toEqual([]);
    expect(checkFlags({ writing: true, staged: true })).toEqual(["writing", "staged"]);
  });
});

describe("reading a film's checks", () => {
  it("counts first-try passes per kind, with a panel as its own picture", () => {
    const a = scene({ index: 1 });
    recordPictureCheck(a, "a walnut board", false, {});
    const b = scene({ index: 2, keyThing: "the bookcase" });
    recordPictureCheck(b, "the bookcase", false, { missing: true });
    recordPictureCheck(b, "the bookcase", false, {});
    recordPictureCheck(b, "a market table", true, { staged: true });

    const rows = tallyPictureChecks([a, b]);
    const key = rows.find(r => r.kind === "key thing")!;
    // The full-frame picture and its panel are two pictures; neither passed first time.
    expect(key).toMatchObject({ pictures: 2, passedFirst: 0, checks: 3 });
    expect(key.flags).toEqual({ missing: 1, staged: 1 });
    expect(rows.find(r => r.kind === "plain")).toMatchObject({ pictures: 1, passedFirst: 1 });
  });

  it("reads a film made before the record as nothing, not as all passes", () => {
    expect(tallyPictureChecks([scene()])).toEqual([]);
  });
});
