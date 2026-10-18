/**
 * A CONTRAST IS NOT ONE TOPIC (round 13, 2026-10-18). The same-topic pass (`markSameContext`) joined
 * Werner's set-up line, the "it is empty" contrast and the German reveal into one topic (job 408,
 * scenes 2-3; job 403 the same) and drew the reveal for all of it, so the bin stood on the floor under
 * the words saying the floor is empty. The lines are the real rows; the rule is general — lines that
 * do not compare group exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  atWork,
  contextRuns,
  contrastAcross,
  markSameContext,
  parseContextGroups,
} from "./shotList";

const pic = (
  index: number,
  scriptText: string,
  show: string,
  over: Partial<StoryboardScene> = {}
) =>
  ({
    index,
    narration: scriptText,
    scriptText,
    showSubject: show,
    visualPrompt: show,
    wordCut: true,
    ...over,
  }) as StoryboardScene;

/** Job 408's opening, as the same-topic pass saw it (scene 1 is the host). */
const SET_UP =
  "That little stretch of tile between the bowl and the wall. In most American bathrooms,";
const REVEAL =
  "it is empty. In a German bathroom, usually, a small bin stands there, with a lid.";
const BIN_SHOW =
  "a small white plastic bin with a closed hinged lid on pale beige tile floor beside the base of a white porcelain toilet, water swirling in the bowl as it flushes";
const film408 = () => [
  pic(1, "Look at the floor beside your toilet.", "the host", {
    hostPresent: true,
  }),
  pic(
    2,
    SET_UP,
    "the narrow stretch of tile floor between a white toilet and the wall"
  ),
  pic(
    3,
    REVEAL,
    "a small white plastic bin with a closed hinged lid on tile beside a toilet"
  ),
  pic(
    4,
    "It is the answer to one plain sentence the water utilities in Germany have repeated for years: the toilet is not a trash can.",
    "the host",
    { hostPresent: true }
  ),
];
const answer408 = JSON.stringify({ groups: [{ ids: [1, 2], show: BIN_SHOW }] });

beforeEach(() => mockInvoke.mockReset());

describe("contrastAcross: lines that set one side against another", () => {
  it("job 408: the American set-up and the German reveal compare", () => {
    expect(contrastAcross([SET_UP, REVEAL])).toBe(true);
    // Either half of it is enough on its own: the places compared...
    expect(
      contrastAcross([
        "In most American bathrooms the floor there is clean.",
        "In a German bathroom it is tiled.",
      ])
    ).toBe(true);
    // ...and an empty place, then the thing there, with no place named at all.
    expect(
      contrastAcross([
        "In most homes, that spot is empty.",
        "In mine, a small bin stands there, with a lid.",
      ])
    ).toBe(true);
  });

  it("the other ways a comparison is said", () => {
    expect(
      contrastAcross([
        "Most kitchens keep the soap by the sink,",
        "whereas a camper hangs it on a hook.",
      ])
    ).toBe(true);
    expect(
      contrastAcross([
        "A cotton towel holds the water.",
        "Unlike cotton, a paper towel falls apart.",
      ])
    ).toBe(true);
    expect(
      contrastAcross([
        "Most people put it in a drawer.",
        "Instead, I hang it on the wall.",
      ])
    ).toBe(true);
    expect(
      contrastAcross([
        "Most homes keep a basket there.",
        "But in plenty of flats it stays empty.",
      ])
    ).toBe(true);
    // A place carried over a line about the same place, then a different one.
    expect(
      contrastAcross([
        "In Japan, doors slide.",
        "They are made of paper.",
        "In America, doors swing.",
      ])
    ).toBe(true);
    // The thing may come one short clause after the empty place.
    expect(
      contrastAcross([
        "Most homes leave that shelf bare.",
        "Mine? A row of jam jars sits on it.",
      ])
    ).toBe(true);
  });

  it("two lines about one bin are not a comparison", () => {
    expect(
      contrastAcross([
        "In a German bathroom, usually, a small bin stands there, with a lid.",
        "It has a lid, and it is emptied once a week.",
      ])
    ).toBe(false);
  });

  it("the lines on the local films that only sound like one stay one topic (232 films, 9,530 neighbouring pictures)", () => {
    // Figures of speech, not empty places (jobs 150-247, 352, 360).
    expect(
      contrastAcross([
        "and there's nothing a farmhouse kitchen goes through faster.",
        "Mine come from worn bedsheets,",
      ])
    ).toBe(false);
    expect(
      contrastAcross([
        "and the cost is nothing at all, because it's yarn I'd already paid for.",
        "Every one comes out a little different,",
      ])
    ).toBe(false);
    expect(
      contrastAcross([
        "There's an old saying we live by, that we use a thing up, wear it out, make it do, or do without.",
        "And if the fine quilting draws you the way it draws me, why, piece a quilt anyway for your own bed.",
      ])
    ).toBe(false);
    // An empty lawn, then more of the absence and a comment — no thing is put there (job 404, 2).
    expect(
      contrastAcross([
        "The song at first light goes quiet, the grass sits empty in the mornings,",
        "and nobody sees another robin until spring. At least, that’s what just about everybody figures.",
      ])
    ).toBe(false);
    // A month and a place are not one place against another (job 404, 14).
    expect(
      contrastAcross([
        "so the robin you see in January could be a traveler from up north. And if you live",
        "along the Gulf Coast or down in Florida, winter can be when you see the most robins all year,",
      ])
    ).toBe(false);
  });

  it("the same place twice, someone's place, a bare 'but' and a comparison inside one line are not", () => {
    expect(
      contrastAcross([
        "The lattice comes from Japan.",
        "You see it in Japanese sliding doors.",
      ])
    ).toBe(false);
    expect(
      contrastAcross([
        "In Germany the utilities say it plainly.",
        "In a German home a bin stands there.",
      ])
    ).toBe(false);
    expect(
      contrastAcross([
        "Back in Ann's garage the bin stood by the door.",
        "In Germany that is normal.",
      ])
    ).toBe(false);
    expect(contrastAcross(["It looks simple.", "But it took me a week."])).toBe(
      false
    );
    expect(contrastAcross(["It took a week,", "but in the end it sold."])).toBe(
      false
    );
    expect(
      contrastAcross([
        "In America it's empty, but in Germany a bin stands there.",
        "The bin has a lid.",
      ])
    ).toBe(false);
    expect(
      contrastAcross([
        "This is my grandmother's flour bin.",
        "It sat empty in the pantry for twenty years.",
      ])
    ).toBe(false);
    expect(
      contrastAcross([
        "There's no need to buy a jig.",
        "A scrap block works just as well.",
      ])
    ).toBe(false);
  });
});

describe("the same-topic groups never join lines that compare (job 408, scenes 2-3)", () => {
  it("parseContextGroups drops a group spanning the comparison; each line keeps its own picture", () => {
    const scenes = film408();
    const runs = contextRuns(scenes);
    expect(runs).toEqual([[1, 2]]);
    const show = (i: number) => scenes[i].showSubject;
    const said = (i: number) => scenes[i].scriptText;
    // Before: only the pictures were read, and the reveal's bin took the set-up line too.
    expect(
      parseContextGroups(answer408, runs, show, i => atWork(scenes[i]))
    ).toEqual([{ ids: [1, 2], show: BIN_SHOW }]);
    expect(
      parseContextGroups(answer408, runs, show, i => atWork(scenes[i]), said)
    ).toEqual([]);
  });

  it("two lines about one bin still join", () => {
    const scenes = [
      pic(
        0,
        "In a German bathroom, usually, a small bin stands there, with a lid.",
        "a small white bin with a lid beside a toilet"
      ),
      pic(
        1,
        "It has a lid, and it is emptied once a week.",
        "a small white bin with a lid beside a toilet"
      ),
    ];
    const g = parseContextGroups(
      JSON.stringify({
        groups: [
          { ids: [0, 1], show: "a small white bin with a lid beside a toilet" },
        ],
      }),
      [[0, 1]],
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(g).toEqual([
      { ids: [0, 1], show: "a small white bin with a lid beside a toilet" },
    ]);
  });

  it("only the part across the comparison goes: a group cut for another reason keeps its other part", () => {
    // The first picture names something else, so the model's group is cut after it; the part left
    // holds no comparison and still joins.
    const scenes = [
      pic(
        0,
        "In most American bathrooms, it is empty.",
        "an empty stretch of tile beside a toilet"
      ),
      pic(
        1,
        "In a German bathroom, a small bin stands there.",
        "a small white bin with a lid beside a toilet"
      ),
      pic(
        2,
        "It has a lid, and it is emptied once a week.",
        "a small white bin with a lid beside a toilet"
      ),
    ];
    const g = parseContextGroups(
      JSON.stringify({
        groups: [
          {
            ids: [0, 1, 2],
            show: "a small white bin with a lid beside a toilet",
          },
        ],
      }),
      [[0, 1, 2]],
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(g).toEqual([
      { ids: [1, 2], show: "a small white bin with a lid beside a toilet" },
    ]);
  });

  it("markSameContext hands the lines over: the set-up keeps its own picture and stays a separate picture", async () => {
    mockInvoke.mockResolvedValue({ text: answer408 });
    const scenes = film408();
    const marked = await markSameContext(scenes, { sec: () => 5 });
    expect(marked).toBe(0);
    expect(scenes[1].showSubject).toBe(
      "the narrow stretch of tile floor between a white toilet and the wall"
    );
    expect(scenes[1].showSubject).not.toMatch(/bin/);
    expect(scenes[2].sameShot).toBeUndefined();
    // The model is told too, in words that fit any channel.
    const system: string = mockInvoke.mock.calls[0][0].systemPrompt;
    expect(system).toMatch(/Lines that COMPARE are never one group/);
    expect(system).toMatch(
      /empty or has none next to a line where the thing is there/
    );
    expect(system).not.toMatch(/toilet|bathroom|German|American|\bbin\b/i);
  });

  it("markSameContext still joins a run of lines about one thing", async () => {
    const scarf = "a striped scarf on a chair";
    mockInvoke.mockResolvedValue({
      text: JSON.stringify({ groups: [{ ids: [0, 1], show: scarf }] }),
    });
    const scenes = [
      pic(1, "This striped scarf took me two evenings.", scarf),
      pic(2, "It sold for twenty-five dollars at the fair.", scarf),
    ];
    expect(await markSameContext(scenes, { sec: () => 3 })).toBe(1);
    expect(scenes[1].sameShot).toBe(true);
  });
});
