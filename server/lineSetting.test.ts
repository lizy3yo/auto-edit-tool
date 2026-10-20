/**
 * A SETTING TURN ENDS A TOPIC (round 14, 2026-10-20, the review of job 412 scene 26). One 13.9 s
 * picture of a wild cat stalking through desert brush ran on under "…she inherited that schedule the
 * same way she inherited her whiskers. Indoor life softens it, but it rarely erases it, so plenty of
 * house cats keep one foot in the old rhythm." — 7.4 s of house cats and indoor life over the
 * wilderness. The same-topic pass gave scenes 23-26 one "wild landscape" topic, and the line check's
 * ONE PICTURE, ONE SUBJECT rule let the indoor sentence stay as "an idea about" the same schedule.
 * The lines and pictures are job 412's real rows (scene 24 was still a picture when the same-topic
 * pass ran; the plan gate made it a host take later); the rule is general — a line set where its
 * picture is, or one that names no setting, is read exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  SETTING_TURN_RULE,
  saidSettings,
  settingClash,
  settingNote,
  settingTurn,
  shownSettings,
} from "./lineSetting";
import {
  atWork,
  contextRuns,
  FIT_SYSTEM,
  fitPicturesToLines,
  markSameContext,
  parseContextGroups,
  SHOT_LIST_SYSTEM,
} from "./shotList";

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, wordCut: true, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string) =>
  ({ index, narration: scriptText, scriptText, hostPresent: true, showSubject: "the host" }) as StoryboardScene;

/** What the case came from — never in a rulebook (the rules must fit any channel). */
const CHANNEL_OBJECTS = /\bcats?\b|tabby|desert|mouse|whisker|prey|hunter|crepuscular|shift worker|feed sack|spray bottle|torch/i;

// Job 412, scenes 23-27, as written.
const L23 = "The honest word is crepuscular, which is just a fancy way of saying dawn and dusk.";
const L24 = "Her wild relatives do their serious hunting in the low light at the edges of the day,";
const L25 = "when small prey is out moving around";
const L26 =
  "and bigger hunters can’t see well, and she inherited that schedule the same way she inherited her whiskers. Indoor life softens it, but it rarely erases it, so plenty of house cats keep one foot in the old rhythm.";
const L27 =
  "Think of her as a shift worker who moved into your home. A lovely roommate, on very different hours. And three in the morning sits close enough to her pre-dawn window that her body starts stirring right when yours is at its deepest.";
const WILD = "a wild cat stalking low through scattered brush across the dawn-lit wild landscape toward a small mouse";
const WILD_CLOSE = `${WILD}, a close-up of one detail of it filling the frame`;
const BED =
  "the grey-and-white cat sitting up alert at the foot of the bed in pre-dawn dark while the owner sleeps deeply under the blanket";
const INDOOR_CAT = "a grey-and-white house cat stretched out awake on a living room sofa in soft early light";

beforeEach(() => mockInvoke.mockReset());

describe("what a line and a picture name as their setting", () => {
  it("reads job 412's line and picture", () => {
    expect(saidSettings(L24)).toEqual(["outdoors"]);
    expect(saidSettings("Indoor life softens it, but it rarely erases it, so plenty of house cats keep one foot in the old rhythm.")).toEqual([
      "indoors",
    ]);
    expect(shownSettings(WILD_CLOSE)).toEqual(["outdoors"]);
    expect(shownSettings(BED)).toEqual(["indoors"]);
    expect(settingClash(L26, WILD_CLOSE)).toBe("indoors");
    expect(settingClash(L26, BED)).toBeUndefined();
  });

  it("a thing named after a place is no setting", () => {
    // A kind of customer (job 162 scene 280), the picture's own frame, a colour, a stack of timber.
    expect(saidSettings("and they go for $38 to $60 to anybody with a porch, a patio, or a houseplant habit.")).toEqual([]);
    expect(saidSettings("Think outside the box on this one.")).toEqual([]);
    expect(saidSettings("Today's video is about the early wake-up.")).toEqual([]);
    expect(shownSettings("a man in a forest-green apron at a workbench, 16:9 horizontal landscape framing")).toEqual([]);
    expect(shownSettings("a stack of exotic woods leaning on the bench")).toEqual([]);
    expect(shownSettings("a vase of wildflowers and garden shears")).toEqual([]);
  });

  it("names when as well as where", () => {
    expect(saidSettings("Back then, every farmhouse kept one by the stove.")).toEqual(["long ago"]);
    expect(saidSettings("These days most people buy theirs at a hardware store.")).toEqual(["today"]);
    expect(shownSettings("a 19th-century farmhouse kitchen with a cast-iron stove")).toEqual(["indoors", "long ago"]);
  });
});

describe("settingTurn: where a line moves away from its picture's setting", () => {
  it("job 412 scene 26 turns indoors at 'Indoor life softens it' (and job 405 scene 25, the same script)", () => {
    expect(settingTurn(L26, WILD_CLOSE)).toEqual({ from: "Indoor life softens it", setting: "indoors" });
    expect(
      settingTurn(
        "she inherited her whiskers. Indoor life softens it, but it rarely erases it, so plenty of house cats keep one foot in the old rhythm. Think of her as a shift worker who moved into your home.",
        "an open grassy wild landscape at dusk, low golden light over scattered brush and distant hills, a close-up of one detail of it filling the frame"
      )
    ).toEqual({ from: "Indoor life softens it", setting: "indoors" });
  });

  it("works for any setting pair: outdoors to indoors, long ago to today", () => {
    expect(
      settingTurn(
        "The seedlings spend the whole summer out in the garden. Indoors, they need a sunny window and half the water.",
        "rows of young tomato seedlings out in the garden in morning light"
      )
    ).toEqual({ from: "Indoors, they need a", setting: "indoors" });
    expect(
      settingTurn(
        "Back then, every farmhouse kept a crock of it by the stove. These days most people buy theirs at a hardware store.",
        "a 19th-century farmhouse kitchen with a stoneware crock beside a cast-iron stove"
      )
    ).toEqual({ from: "These days most people", setting: "today" });
  });

  it("leaves a line set where its picture is, and one that names no setting", () => {
    // Scene 26's line over an indoor picture, scene 27's over the bed: nothing turns away.
    expect(settingTurn(L26, INDOOR_CAT)).toBeUndefined();
    expect(settingTurn(L27, BED)).toBeUndefined();
    expect(settingTurn("It took me a week. It sold in a day.", WILD)).toBeUndefined();
    // A picture whose words name no setting: nothing to turn away from.
    expect(settingTurn(L26, "a grey-and-white cat with green eyes, a close-up of its face")).toBeUndefined();
    // One sentence: a whole line set elsewhere is a rewrite, never a split.
    expect(settingTurn("Indoor life softens it, but it rarely erases it.", WILD)).toBeUndefined();
  });

  it("is no turn when the setting comes late in a sentence about something else, or the sentence holds both", () => {
    // Jobs 114-143: the dog is shut in the house while the line stays on the spray bottle outside.
    expect(
      settingTurn(
        "and keep that torch pointed away from you and your feet. I keep a spray bottle of water right next to the torch for flare-ups, and Biscuit gets shut in the house,",
        "Weathered bare hands holding a trigger spray bottle, misting water toward a charred cedar planter box with glowing hot spots, outdoors under overcast daylight."
      )
    ).toBeUndefined();
    // A comparison inside one sentence is that sentence's own.
    expect(
      settingTurn("She hunts at the edges of the day. Indoors it fades, but out in the wild it stays sharp.", WILD)
    ).toBeUndefined();
    // A line already set there from its first sentence is not a turn.
    expect(
      settingTurn("Indoor cats sleep through most of the day. Indoor life softens the habit a little more each year.", WILD)
    ).toBeUndefined();
  });

  it("needs four words on each side", () => {
    expect(settingTurn("Out it goes. Indoors it fades.", WILD)).toBeUndefined();
  });

  it("settingNote tells the line check only where a line turns", () => {
    expect(settingNote(L26, WILD_CLOSE)).toBe(' (its words turn to another setting at "Indoor life softens it": indoors)');
    expect(settingNote(L27, BED)).toBe("");
    // A whole line set elsewhere by its words alone was a thing's place every time on the local films
    // (the feed sacks the same line goes on to name, by the burn barrel): left to the check's reading.
    expect(
      settingNote(
        "cloth that was already sitting in our house, the one that paid me best for my time came from a stack of feed sacks my husband set aside for the burn barrel.",
        "a stack of printed feed sacks piled beside the rusty burn barrel outside"
      )
    ).toBe("");
  });
});

describe("the same-topic groups end where the talk moves to another setting (job 412 scenes 23-26)", () => {
  /** The run as the same-topic pass saw it: 26's own words were already the wild picture's. */
  const film412 = () => [
    host(22, "creatures of the deep night, and that’s mostly a costume they wear in cartoons."),
    pic(23, L23, WILD),
    pic(24, L24, WILD),
    pic(25, L25, WILD),
    pic(26, L26, WILD),
    host(28, "Freeze that picture for a minute,"),
  ];
  const answer = JSON.stringify({ groups: [{ ids: [1, 2, 3, 4], show: WILD }] });
  const groups = (scenes: StoryboardScene[], said = true) =>
    parseContextGroups(
      answer,
      contextRuns(scenes),
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      said ? i => scenes[i].scriptText : undefined
    );

  it("the line that turns indoors keeps its own picture; the wild lines before it stay one topic", () => {
    const scenes = film412();
    // Before: the lines were read only for comparisons, and the indoor sentence took the wild picture.
    expect(groups(scenes, false)).toEqual([{ ids: [1, 2, 3, 4], show: WILD }]);
    expect(groups(scenes)).toEqual([{ ids: [1, 2, 3], show: WILD }]);
  });

  it("no line after the turn takes the old setting's picture, even one that names no setting", () => {
    const scenes = [
      pic(23, L23, WILD),
      pic(26, L26, WILD),
      pic(27, "And that is why she starts pacing long before your alarm goes off.", WILD),
    ];
    const g = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1, 2], show: WILD }] }),
      contextRuns(scenes),
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(g).toEqual([]);
  });

  it("a first line set elsewhere keeps its own picture and the rest still join", () => {
    const sacks = "a stack of printed feed sacks piled beside the rusty burn barrel outside";
    const scenes = [
      pic(1, "cloth that was already sitting in our house, the one that paid me best", sacks),
      pic(2, "came from a stack of feed sacks my husband set aside for the burn barrel.", sacks),
      pic(3, "Every one of them had a print on it.", sacks),
    ];
    const g = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1, 2], show: sacks }] }),
      contextRuns(scenes),
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(g).toEqual([{ ids: [1, 2], show: sacks }]);
  });

  it("lines set where the group's picture is still join", () => {
    const scenes = [pic(24, L24, WILD), pic(25, L25, WILD)];
    const g = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1], show: WILD }] }),
      contextRuns(scenes),
      i => scenes[i].showSubject,
      i => atWork(scenes[i]),
      i => scenes[i].scriptText
    );
    expect(g).toEqual([{ ids: [0, 1], show: WILD }]);
  });

  it("markSameContext leaves the turning line its own picture, and tells the model in general words", async () => {
    mockInvoke.mockResolvedValue({ text: answer });
    const scenes = film412();
    expect(await markSameContext(scenes, { sec: () => 4 })).toBe(2);
    expect(scenes[2].sameShot).toBe(true);
    expect(scenes[3].sameShot).toBe(true);
    expect(scenes[4].sameShot).toBeUndefined();
    const system: string = mockInvoke.mock.calls[0][0].systemPrompt;
    expect(system).toContain(SETTING_TURN_RULE);
    expect(system).toMatch(/A line that moves to another setting is never in a group with the lines before\s+it/);
    expect(system).not.toMatch(CHANNEL_OBJECTS);
  });
});

describe("the line check judges a picture's setting against its line's (job 412 scene 26)", () => {
  it("its rulebook: a setting turn is a split even on the same idea, and a picture set elsewhere is WRONG", () => {
    expect(FIT_SYSTEM).toMatch(/THE LINE'S SETTING\. A SETTING IS PART OF THE PICTURE/);
    expect(FIT_SYSTEM).toMatch(/Never split\s+sentences that stay on the same thing in the same setting/);
    expect(FIT_SYSTEM).toMatch(/A later sentence that moves to ANOTHER SETTING is split all the same,\s+however much it stays on the same thing or idea/);
    expect(FIT_SYSTEM).toMatch(/A picture is WRONG when it is set where or when its line is\s+not/);
    expect(FIT_SYSTEM).toMatch(/A picture marked "its\s+words turn to another setting at …" has such a sentence: split it there/);
    expect(FIT_SYSTEM).not.toMatch(CHANNEL_OBJECTS);
    // The shot list starts a shot there too.
    expect(SHOT_LIST_SYSTEM).toContain(`2b. ${SETTING_TURN_RULE} A shot starts there.`);
    expect(SHOT_LIST_SYSTEM).not.toMatch(CHANNEL_OBJECTS);
  });

  const film = () => [
    host(24, L24),
    pic(25, L25, WILD, { audioDuration: 2.15 }),
    pic(26, L26, WILD_CLOSE, { audioDuration: 13.88, sameShot: true }),
    pic(27, L27, BED, { audioDuration: 14.47 }),
  ];

  it("marks the turning line, and the split lands: the wild part keeps its picture, the indoor part gets its own", async () => {
    mockInvoke.mockResolvedValue({
      text: JSON.stringify({
        pictures: [
          { id: 1, about: "small prey moving at dawn", shows_it: true },
          {
            id: 2,
            about: "the wild hunters' schedule she inherited",
            shows_it: true,
            split: [{ from: "Indoor life softens it", show: INDOOR_CAT, thing: "cat", stage: null, other: null }],
          },
          { id: 3, about: "her as a shift worker at the foot of the bed", shows_it: true },
        ],
      }),
    });
    const r = await fitPicturesToLines(film(), { keyThings: [{ main: true, name: "cat", look: "a grey-and-white cat" }] });
    const sent = String(mockInvoke.mock.calls[0][0].userMessage);
    expect(sent).toContain(
      '#2 PICTURE (13.9 s) (continues) (same sentence) (its words turn to another setting at "Indoor life softens it": indoors): said'
    );
    // Only the turning line is marked.
    expect(sent.match(/turn to another setting/g)).toHaveLength(1);
    expect(r.split).toBe(1);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      L24,
      L25,
      "and bigger hunters can’t see well, and she inherited that schedule the same way she inherited her whiskers.",
      "Indoor life softens it, but it rarely erases it, so plenty of house cats keep one foot in the old rhythm.",
      L27,
    ]);
    expect(r.scenes[2].showSubject).toBe(WILD_CLOSE);
    expect(r.scenes[3].showSubject).toBe(INDOOR_CAT);
    expect(r.scenes[3].keyThing).toBe("cat");
    expect(r.scenes[3].sameShot).toBeUndefined();
  });

  it("a film with no setting turn reads exactly as before: no mark", async () => {
    mockInvoke.mockResolvedValue({ text: JSON.stringify({ pictures: [] }) });
    const scenes = [host(24, L24), pic(25, L25, WILD, { audioDuration: 2.15 }), pic(27, L27, BED, { audioDuration: 14.47 })];
    const r = await fitPicturesToLines(scenes, {});
    expect(String(mockInvoke.mock.calls[0][0].userMessage)).not.toMatch(/another setting/);
    expect(r.scenes).toEqual(scenes);
  });
});
