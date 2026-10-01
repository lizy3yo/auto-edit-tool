import { describe, it, expect } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  applyNamedLooks,
  describeNamedLooks,
  namedLookCandidates,
  namedLookClause,
  parseNamedLooks,
  PART_VIEW,
} from "./namedLooks";
import { memoryViewFor } from "./pictureMemory";
import { exactLookQuestion } from "./overlayTextScan";

const pic = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText, showSubject, visualPrompt: showSubject, ...over }) as StoryboardScene;
const QUILT: KeyThing[] = [{ name: "sampler quilt", look: "a lap-sized quilt of twelve different blocks", main: false }];
const CHURN =
  "a square block in a 3 by 3 grid: a plain light centre square, a two-strip rectangle at the middle of each side, " +
  "and four corner squares each split diagonally into a dark and a light triangle, the dark triangles pointing outward";

describe("named things are drawn exactly (Granny Ruth's job 281)", () => {
  const film = () => [
    pic(1, "A sampler quilt is where you make a bunch of different blocks,", "a sampler quilt laid flat", { keyThing: "sampler quilt" }),
    pic(2, "a churn dash here,", "a churn dash block, pinwheel of triangles, on the quilt", { keyThing: "sampler quilt" }),
    pic(3, "and the coasters were done,", "a stack of coasters"),
    { index: 4, scriptText: "Hi", hostPresent: true } as StoryboardScene,
  ];

  it("reads the answer, with ids written any way", () => {
    const a = parseNamedLooks(
      JSON.stringify({ kinds: [{ name: "churn dash block", look: CHURN }], pictures: [{ id: "#1", kind: "churn dash block", part_of: "sampler quilt", show: "a close-up of one churn dash block" }] })
    );
    expect(a?.pictures[0]).toEqual({ id: 1, kind: "churn dash block", partOf: "sampler quilt", show: "a close-up of one churn dash block" });
    expect(parseNamedLooks("no")).toBeNull();
    // A look too short to draw from is dropped.
    expect(parseNamedLooks('{"kinds":[{"name":"x","look":"a block"}],"pictures":[]}')?.kinds).toEqual([]);
  });

  it("puts the exact look and the part on the picture, and leaves the rest alone", () => {
    const scenes = film();
    const asked = namedLookCandidates(scenes);
    expect(asked).toEqual([0, 1, 2]);
    const n = applyNamedLooks(
      scenes,
      asked,
      {
        kinds: [{ name: "churn dash block", look: CHURN }],
        pictures: [
          { id: 1, kind: "churn dash block", partOf: "sampler quilt", show: "a close-up of one churn dash block on the quilt" },
          { id: 2, kind: "unknown kind" },
          { id: 3, kind: "churn dash block" },
        ],
      },
      QUILT
    );
    expect(n).toBe(1);
    expect(scenes[1].namedLook).toBe(`churn dash block: ${CHURN}`);
    expect(scenes[1].partOf).toBe("sampler quilt");
    expect(scenes[1].showSubject).toBe("a close-up of one churn dash block on the quilt");
    expect(scenes[2].namedLook).toBeUndefined();
    expect(scenes[3].namedLook).toBeUndefined();
    expect(namedLookClause(scenes[1])).toContain("EXACT LOOK — churn dash block:");
    expect(namedLookClause(scenes[2])).toBe("");
  });

  it("never takes the person out of a picture of someone at work", () => {
    const scenes = [
      pic(1, "quilted with straight lines on my little machine", "hands guiding the sampler quilt under the sewing machine", { humanPresent: true }),
    ];
    const n = applyNamedLooks(
      scenes,
      [0],
      {
        kinds: [{ name: "zigzag stitch", look: "a line of thread running back and forth in tight even points" }],
        pictures: [{ id: 0, kind: "zigzag stitch", partOf: "sampler quilt", show: "a close-up of straight stitching lines" }],
      },
      QUILT
    );
    expect(n).toBe(1);
    expect(scenes[0].showSubject).toBe("hands guiding the sampler quilt under the sewing machine");
    expect(scenes[0].partOf).toBeUndefined();
    expect(scenes[0].namedLook).toContain("zigzag stitch:");
  });

  it("draws a part as a close-up of that part, never another view of the whole", () => {
    const scenes = film();
    scenes[1].partOf = "sampler quilt";
    expect(memoryViewFor(scenes, scenes[1])).toBe(PART_VIEW);
    scenes[1].partOf = undefined;
    expect(memoryViewFor(scenes, scenes[1])).not.toBe(PART_VIEW);
  });

  it("holds the picture to the exact look in the checker", () => {
    expect(exactLookQuestion(`churn dash block: ${CHURN}`)).toMatch(/does not match that look/);
    expect(exactLookQuestion("x")).toMatch(/something bigger it belongs to/);
  });

  it("changes nothing when the call fails", async () => {
    const scenes = film();
    const before = JSON.stringify(scenes);
    const r = await describeNamedLooks(scenes, {
      keyThings: QUILT,
      ask: async () => {
        throw new Error("down");
      },
    });
    expect(r.pictures).toBe(0);
    expect(JSON.stringify(scenes)).toBe(before);
  });
});
