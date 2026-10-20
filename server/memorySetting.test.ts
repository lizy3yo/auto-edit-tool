/**
 * THE REFERENCES LEND THE THING, NEVER ITS WEATHER OR ITS HOUR (2026-10-18, the review of jobs
 * 401-407). Job 404 scenes 14-15, "a robin standing in a mild gulf coast yard with palm trees", were
 * drawn from the robin's first pictures on a snowy northern lawn, told to draw the SAME robin "in the
 * same place", and came back with snow and frost under the palms. Every memory clause now ends on
 * `MEMORY_SETTING_CLAUSE` — the reference images lend only how the things in them look, never their
 * season, weather, light or time of day, nor their place when this picture's words name another —
 * and "in the same place" gives way to the picture's own words for every memory picture. And a key
 * thing beside it that no reference shows is no longer called "this exact" one of the references
 * (`memoryNotShown`): 404-14 was told its two lawn pictures showed "this exact robin and gulf coast
 * yard". The cases are the stored rows of jobs 404 and 405; the rule is general, so every memory view
 * is checked.
 */
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  attachMemory,
  BACKGROUND_VIEW,
  BLUR_PRINT_VIEW,
  keyThingLookClause,
  memoryFor,
  MEMORY_VIEWS,
  pictureSettled,
  SCREEN_ITEM_VIEW,
  SET_ITEM_VIEW,
} from "./pictureMemory";
import { PART_VIEW } from "./namedLooks";
import { REDRAW_CAMERAS } from "./pictureVariety";
import {
  buildStillPrompt,
  MEMORY_SETTING_CLAUSE,
  memoryClause,
  memoryFields,
  memoryToWords,
  promptFromWords,
  rightBeforeClause,
} from "./longformVideo";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

const count = (text: string, part: string) => text.split(part).length - 1;

// Job 404 scene 14 as stored: two references, both of the robin on the snowy northern lawn
// (scenes 5 and 12), the camera from above, and no picture right before it (a split was). Neither
// reference is a picture of the gulf coast yard, which render now records (`memoryNotShown`).
const robin14 = () =>
  pic(14, "a robin standing in a mild gulf coast yard with palm trees", {
    visualPrompt:
      "A robin standing on grassy winter yard with palm trees and green shrubs in background, bright winter sunlight, Gulf Coast setting.",
    keyThing: "robin",
    otherKeyThings: ["gulf coast yard"],
    memoryView: MEMORY_VIEWS[3],
    memoryRefUrls: ["https://r2/404/still-src-5.png", "https://r2/404/still-src-12.png"],
    memoryNotShown: ["gulf coast yard"],
  });

// Job 404 scenes 5, 12, 13 (the split), 14 and 15 as stored, before render.
const job404 = () => [
  pic(5, "a robin standing on a green lawn in early spring with patches of melting snow", {
    keyThing: "robin",
    pictureUrl: "https://r2/404/still-src-5.png",
  }),
  pic(12, "a robin standing on frost dusted brown grass in winter", {
    keyThing: "robin",
    pictureUrl: "https://r2/404/still-src-12.png",
  }),
  pic(13, "a flock of robins flying south over a snowy landscape", {
    hostPresent: true,
    splitVisual: "A flock of robins in flight above a snow-covered landscape, heading south, bare trees and white ground below.",
    keyThing: "robin",
  }),
  pic(14, "a robin standing in a mild gulf coast yard with palm trees", {
    keyThing: "robin",
    otherKeyThings: ["gulf coast yard"],
  }),
  pic(15, "a robin standing in a mild gulf coast yard with palm trees, a close-up of one detail of it filling the frame", {
    keyThing: "robin",
    otherKeyThings: ["gulf coast yard"],
  }),
];

// Job 405 scene 28 as stored: the clock under "three in the morning", drawn from scene 11's clock
// in a dark bedroom at night, its own words with no hour in them.
const clock28 = () =>
  pic(28, "the round analog clock on the nightstand pointing near three", {
    visualPrompt:
      "Round analog clock on a wooden nightstand, white face and black hands pointing near three o'clock, cream lamp beside it glowing softly.",
    keyThing: "clock",
    otherKeyThings: ["nightstand"],
    memoryView: MEMORY_VIEWS[0],
    memoryRefUrls: ["https://r2/405/still-src-11.png"],
  });

describe("the setting clause says the references lend only the look", () => {
  it("names the thing's look as all a reference lends, and the season, weather, light, time of day and a named place as the words'", () => {
    expect(MEMORY_SETTING_CLAUSE).toMatch(/^ Every reference image lends ONLY how the things in it look/);
    expect(MEMORY_SETTING_CLAUSE).toMatch(/never its season, weather, light or time of day/);
    expect(MEMORY_SETTING_CLAUSE).toMatch(/never its place when THIS picture's words name another/);
    expect(MEMORY_SETTING_CLAUSE).toMatch(/those are what this picture's own words say, even where a reference shows otherwise\.$/);
  });

  it("never sends a thing away from its place when the words name none: the place yields only to a place named", () => {
    // A stove drawn again with no place in its words stays in its room — "never its place" alone
    // would move it.
    expect(MEMORY_SETTING_CLAUSE).not.toMatch(/never its place[,:.—]/);
    const stove = pic(7, "the wood stove's door open with the fire inside", {
      keyThing: "wood stove",
      memoryView: MEMORY_VIEWS[1],
      memoryRefUrls: ["https://r2/stove-1.png"],
    });
    expect(memoryClause(stove)).toContain("in the same place unless this picture's own words put it somewhere else");
  });

  it("names no weather, season or hour of its own: the clause is a rule, never a picture to draw", () => {
    expect(MEMORY_SETTING_CLAUSE).not.toMatch(/\b(?:snow|frost|rain|sun|night|dawn|dusk|winter|summer|spring|autumn)\b/i);
  });
});

describe("every memory view ends on the setting clause, once", () => {
  const base = () =>
    pic(9, "the cast iron kettle on the stove top", {
      keyThing: "cast iron kettle",
      memoryRefUrls: ["https://r2/kettle-1.png", "https://r2/kettle-4.png"],
    });

  const views: [string, Partial<StoryboardScene>][] = [
    ...MEMORY_VIEWS.map((v, i): [string, Partial<StoryboardScene>] => [`the memory camera ${i + 1}: ${v}`, { memoryView: v }]),
    ["a part close-up (PART_VIEW)", { memoryView: PART_VIEW, partOf: "cast iron kettle" }],
    ["a part with unread print (BLUR_PRINT_VIEW)", { memoryView: BLUR_PRINT_VIEW, partOf: "cast iron kettle", blurPrint: true }],
    ["a remembered thing beside the subject (BACKGROUND_VIEW)", { memoryView: BACKGROUND_VIEW }],
    ["the thing on a screen (SCREEN_ITEM_VIEW)", { memoryView: SCREEN_ITEM_VIEW }],
    ["a list item cut from its group picture (SET_ITEM_VIEW)", { memoryView: SET_ITEM_VIEW, listCut: true }],
    ["a continuation's concrete camera (REDRAW_CAMERAS)", { memoryView: REDRAW_CAMERAS[1], memoryRightBefore: 1, memoryContinues: true }],
    ["the picture right before it", { memoryView: MEMORY_VIEWS[2], memoryRightBefore: 1 }],
    ["references of the other things only", { memoryView: MEMORY_VIEWS[0], otherKeyThings: ["stove top"], memoryOthersOnly: true }],
    ["while it is being made", { memoryView: MEMORY_VIEWS[4], buildStage: "making" }],
    ["with the host in the shot", { memoryView: MEMORY_VIEWS[1], humanPresent: true, brollHostRef: "https://r2/host.jpg" }],
  ];

  for (const [name, over] of views)
    it(name, () => {
      const s = { ...base(), ...over } as StoryboardScene;
      const clause = memoryClause(s);
      expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
      expect(count(clause, MEMORY_SETTING_CLAUSE)).toBe(1);
      // A bare "in the same place —" holds the thing to its reference's place over its own words.
      expect(clause).not.toContain("in the same place —");
      expect(count(buildStillPrompt(s), MEMORY_SETTING_CLAUSE)).toBe(1);
    });

  it("no references, no clause — and none on a picture drawn from words after copying its memory", () => {
    expect(memoryClause({ ...base(), memoryRefUrls: undefined })).toBe("");
    expect(memoryClause({ ...base(), memoryRefUrls: [] })).toBe("");
    expect(memoryClause({ ...base(), keyThing: undefined })).toBe("");
    expect(buildStillPrompt({ ...base(), memoryRefUrls: undefined })).not.toContain(MEMORY_SETTING_CLAUSE);
    const words = { ...base(), ...memoryToWords(base()) };
    expect(memoryClause(words)).toBe("");
    expect(buildStillPrompt(words)).not.toContain(MEMORY_SETTING_CLAUSE);
  });

  it("the swap to words takes the setting clause out with the rest of the memory clause", () => {
    const s = { ...base(), memoryView: MEMORY_VIEWS[0], memoryWordsLook: "black cast iron, a short spout, a wire handle" };
    const memory = memoryClause(s);
    const look = keyThingLookClause({ ...s, ...memoryToWords(s) });
    const next = promptFromWords(buildStillPrompt(s), memory, look)!;
    expect(next).toBeDefined();
    expect(next).not.toContain(MEMORY_SETTING_CLAUSE);
    expect(next).toContain(look);
  });
});

describe("a key thing no reference shows is never called 'this exact' one of them", () => {
  it("404-14 at render: its two references are the robin's lawn pictures, so the gulf coast yard is not one they show", async () => {
    const board = job404();
    attachMemory(board, [board[3]]);
    const m = await memoryFor(board[3], 0);
    expect(m.urls).toEqual(["https://r2/404/still-src-5.png", "https://r2/404/still-src-12.png"]);
    expect(m.notShown).toEqual(["gulf coast yard"]);
    const s = { ...board[3], ...memoryFields(m, MEMORY_VIEWS[3]) } as StoryboardScene;
    expect(s.memoryNotShown).toEqual(["gulf coast yard"]);
    const clause = memoryClause(s);
    expect(clause).toMatch(/The first 2 reference images show this exact robin. Draw the SAME robin — /);
    expect(clause).not.toMatch(/this exact robin and gulf coast yard|SAME robin and gulf coast yard/);
    expect(clause).toContain(" The gulf coast yard is drawn as this picture's own words describe it.");
    expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
  });

  it("404-15 at render: drawn from scene 14 for the robin — a yard is a place, never 'this exact' one of the references (round 14)", async () => {
    // Scene 14 IS a picture of the yard, and was once named for it too. A place lends no reference
    // picture: job 411's robin references stood on the northern lawn, and "the SAME robin and lawn"
    // copied the whole yard. The yard is the picture's own words' (and its written look's).
    const board = job404();
    board[3].pictureUrl = "https://r2/404/still-src-14.png";
    attachMemory(board, [board[4]]);
    pictureSettled(board[3]);
    const m = await memoryFor(board[4], 0);
    expect(m.urls).toEqual(["https://r2/404/still-src-5.png", "https://r2/404/still-src-14.png"]);
    expect(m.notShown).toEqual(["gulf coast yard"]);
    expect(m.refs?.some(r => r.shows?.includes("gulf coast yard"))).toBe(false);
    const s = { ...board[4], ...memoryFields(m, MEMORY_VIEWS[0]) } as StoryboardScene;
    expect(memoryClause(s)).toMatch(/show this exact robin\. Draw the SAME robin — /);
    expect(memoryClause(s)).toContain(" The gulf coast yard is drawn as this picture's own words describe it.");
  });

  it("a picture drawn before the field names every key thing, as it always did", () => {
    const old = { ...robin14(), memoryNotShown: undefined };
    expect(memoryClause(old)).toMatch(/this exact robin and gulf coast yard/);
    expect(memoryClause(old)).not.toContain("drawn as this picture's own words describe");
  });

  it("references of the other things only: the ones they show are named, the rest said apart; the picture right before names the same", () => {
    const s = pic(30, "the new mattress on the floor beside the space heater and the rag rug", {
      keyThing: "mattress",
      otherKeyThings: ["space heater", "rag rug"],
      memoryOthersOnly: true,
      memoryNotShown: ["rag rug"],
      memoryRefUrls: ["https://r2/heater-12.png"],
      memoryRightBefore: 0,
      memoryView: MEMORY_VIEWS[1],
    });
    const clause = memoryClause(s);
    expect(clause).toContain("shows this exact space heater, seen earlier in this video: draw the SAME space heater — ");
    expect(clause).toContain("It does NOT show the mattress: draw it from this picture's own words.");
    expect(clause).toContain(" The rag rug is drawn as this picture's own words describe it.");
    expect(clause).not.toMatch(/space heater and rag rug/);
    expect(rightBeforeClause(s)).toContain("take ONLY how the space heater looks from it");
    expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
  });

  it("a redraw from words drops the mark with the rest of the memory, and the sentence leaves with the clause", () => {
    const s = robin14();
    expect("memoryNotShown" in memoryToWords(s)).toBe(true);
    expect(memoryToWords(s).memoryNotShown).toBeUndefined();
    const memory = memoryClause(s);
    const next = promptFromWords(buildStillPrompt(s), memory, " LOOK.")!;
    expect(next).toBeDefined();
    expect(next).not.toContain("drawn as this picture's own words describe");
    expect(next).not.toContain(MEMORY_SETTING_CLAUSE);
  });
});

describe("the review's cases (jobs 404 and 405)", () => {
  it("404-14: the robin in the gulf coast yard takes only the robin's look from the snowy lawn", () => {
    const clause = memoryClause(robin14());
    expect(clause).toMatch(/The first 2 reference images show this exact robin./);
    expect(clause).toContain("in the same place unless this picture's own words put it somewhere else");
    expect(clause).not.toContain("in the same place —");
    expect(clause).toContain(MEMORY_SETTING_CLAUSE);
    const prompt = buildStillPrompt(robin14());
    expect(prompt).toContain(clause);
    // The picture's own words, which now decide the place and the season, are in the same prompt.
    expect(prompt).toMatch(/Gulf Coast setting/);
  });

  it("404-15: its close-up drawn from scene 14 is told the same", () => {
    const s = pic(15, "a robin standing in a mild gulf coast yard with palm trees, a close-up of one detail of it filling the frame", {
      keyThing: "robin",
      otherKeyThings: ["gulf coast yard"],
      memoryView: PART_VIEW,
      memoryRefUrls: ["https://r2/404/still-src-5.png", "https://r2/404/still-src-14.png"],
    });
    const clause = memoryClause(s);
    expect(clause).toContain(`Camera position for THIS picture: ${PART_VIEW}`);
    expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
  });

  it("405-28: the clock takes its hour from its own words, never its reference's — and its words name none", () => {
    const clause = memoryClause(clock28());
    expect(clause).toMatch(/The first reference image shows this exact clock and nightstand/);
    expect(clause.endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
    // Nothing tells it to keep its reference's light: the night-time reference cannot make it night.
    // Its stored words lost "at night", which is what drew it in daylight (left to the words).
    expect(clock28().visualPrompt).not.toMatch(/\bnight\b|\bdark\b/i);
    const atNight = { ...clock28(), visualPrompt: `${clock28().visualPrompt} In a dark bedroom at night.` };
    const prompt = buildStillPrompt(atNight);
    expect(prompt).toContain("In a dark bedroom at night.");
    expect(prompt).toContain(MEMORY_SETTING_CLAUSE);
  });
});
