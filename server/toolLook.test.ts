/**
 * A TOOL MADE FOR ONE JOB IS DRAWN BY ITS PARTS (2026-10-18, job 408 scenes 23-24). "A toilet auger,
 * the short kind made for toilets, can sometimes hook it out" was drawn as a plain bent steel rod on
 * a red screwdriver handle, under an on-screen label naming the tool, and scene 24 copied that rod
 * lying on the tile. The props list wrote "a slim metal rod with a curved tip and plastic handle,
 * short household size", the shot list took a "hooked tip" from the verb, and the named-things step
 * wrote exact looks only for varieties and left out "everyday things" — so a specialised tool fell
 * between the two steps and nothing put its real build back. The cases are the real rows of job 408;
 * the rules are general.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  applyNamedLooks,
  describeNamedLooks,
  NAMED_LOOKS_SYSTEM,
  namedLookCandidates,
  namedLookClause,
  parseNamedLooks,
  SUBJECT_OVER_LOOK,
} from "./namedLooks";
import { keyThingLookClause, keyThingLookFor, pictureLook } from "./pictureMemory";
import {
  CONTINUITY_SYSTEM,
  EXACT_KIND_RULE,
  parseKeyThings,
  SPECIALISED_TOOL_RULE,
  TOOL_SHAPE_NOT_VERB,
} from "./shotList";
import { exactLookQuestion } from "./overlayTextScan";

const pic = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText, showSubject, visualPrompt: showSubject, ...over }) as StoryboardScene;

/** Job 408's stored props list, as `deriveContinuitySheet` wrote it. */
const SHEET_408 = [
  "German bathroom: small white-tiled room, pale ceramic toilet beside a wall, a small lidded bin on the floor between bowl and wall",
  "MAIN toilet: a white porcelain toilet, oval bowl, curved trapway inside its base visible as a smooth porcelain contour at the bowl's rear, closed lid often up",
  "toilet auger: a slim metal rod with a curved tip and plastic handle, short household size, kept near the toilet",
  "plunger: a wooden-handled rubber plunger with a black rubber cup, standing upright beside the toilet",
].join("\n");

/** A look written by the rule: the one kind, then the parts that make it that tool. */
const AUGER_LOOK =
  "a closet auger about 1 m long, a steel tube bent into a J at its lower end, a black rubber sleeve over the bend, " +
  "a coiled steel cable running through the tube to a small spring tip, a crank handle with a wooden grip at the top of the tube";

/** Job 408's scenes 22-24 as stored (pack index 22-24). */
const scenes408 = () => [
  pic(
    22,
    "If you think one is already in there, the plunger is the wrong tool. It can push the stick deeper into the curve.",
    "a wooden-handled plunger standing upright beside the toilet, unused",
    { keyThing: "plunger" }
  ),
  pic(
    23,
    "A toilet auger, the short kind made for toilets, can sometimes hook it out.",
    "toilet auger hooked tip inserted into toilet bowl trapway opening",
    {
      keyThing: "toilet auger",
      humanPresent: true,
      visualPrompt:
        "Close view of a toilet bowl. A slim metal toilet auger with a curved hook tip and plastic handle is inserted into the dark drain opening at the bowl's rear, a pair of bare hands gripping the handle from above.",
    }
  ),
  pic(
    24,
    "If it will not come, the toilet has to come up off the floor, and that is a fair place to stop and call someone.",
    "the white porcelain toilet standing on the pale beige tile floor with a toilet auger resting idle beside its base",
    { keyThing: "toilet", otherKeyThings: ["toilet auger"] }
  ),
];

const CHANNEL_WORDS = /\b(?:toilets?|augers?|plungers?|drains?|closet|bathroom|trapway|knife|knives|sharpen\w*)\b/i;

describe("the props list writes a tool made for one job by its parts", () => {
  it("asks for the one exact kind, then the 2-4 parts as the tool is really built", () => {
    expect(CONTINUITY_SYSTEM).toContain(SPECIALISED_TOOL_RULE);
    // After the living-thing rule, so both are read before the list's length and marks rules.
    expect(CONTINUITY_SYSTEM.indexOf(SPECIALISED_TOOL_RULE)).toBeGreaterThan(CONTINUITY_SYSTEM.indexOf(EXACT_KIND_RULE));
    expect(SPECIALISED_TOOL_RULE).toMatch(/A TOOL OR PIECE OF EQUIPMENT MADE FOR ONE JOB/);
    expect(SPECIALISED_TOOL_RULE).toMatch(/would draw from its name alone as a plain rod, handle or box/);
    expect(SPECIALISED_TOOL_RULE).toMatch(/its look STARTS with its one exact kind/);
    // Job 413's "metal clamp guide and angled slots" was two kinds of sharpener in one look.
    expect(SPECIALISED_TOOL_RULE).toMatch(/never two kinds mixed into one look/);
    expect(SPECIALISED_TOOL_RULE).toMatch(/the 2-4 PARTS that make it that tool, each with its shape, material and what it is joined to/);
    expect(SPECIALISED_TOOL_RULE).toMatch(/as the tool is really built/);
  });

  it("never takes a tool's shape from what the line says it does (job 408: 'hook it out' became a hook)", () => {
    expect(SPECIALISED_TOOL_RULE).toContain(TOOL_SHAPE_NOT_VERB);
    expect(TOOL_SHAPE_NOT_VERB).toMatch(/says what it does, never what shape it is/);
  });

  it("gives a neutral example, and the example survives the cut its own looks go through", () => {
    expect(SPECIALISED_TOOL_RULE).not.toMatch(CHANNEL_WORDS);
    const example = /`(pipe wrench: [^`]+)`/.exec(SPECIALISED_TOOL_RULE)![1];
    const [wrench] = parseKeyThings(`home garage: a single-car garage, a wooden workbench\n${example}`);
    expect(wrench.name).toBe("pipe wrench");
    expect(wrench.look.startsWith("a heavy steel pipe wrench")).toBe(true);
    expect(pictureLook(wrench.look)).toBe(wrench.look);
  });

  it("a look by parts reaches the first picture whole — 'over the bend', 'through the tube', 'at the top' are parts, not places", () => {
    const things = parseKeyThings(SHEET_408.replace(/toilet auger: [^\n]+/, `toilet auger: ${AUGER_LOOK}`));
    const auger = things.find(t => t.name === "toilet auger")!;
    expect(auger.look).toBe(AUGER_LOOK);
    const first = scenes408()[1];
    expect(keyThingLookFor(first, things)).toBe(AUGER_LOOK);
  });

  it("the stored generic look still loses only its place (the clean cut is unchanged)", () => {
    const things = parseKeyThings(SHEET_408);
    expect(keyThingLookFor(scenes408()[1], things)).toBe("a slim metal rod with a curved tip and plastic handle, short household size");
    expect(keyThingLookFor(scenes408()[0], things)).toBe("a wooden-handled rubber plunger with a black rubber cup");
  });
});

describe("the named-things step gives a specialised tool its real look", () => {
  it("counts a tool made for one job as a named kind, and keeps everyday tools out", () => {
    expect(NAMED_LOOKS_SYSTEM).toMatch(/A SPECIALISED TOOL OR PIECE OF EQUIPMENT a picture is about/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/a picture\s+maker given only its name draws as a plain rod, handle or box/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/\(a pipe wrench, a seam ripper, a grease\s+gun\)/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/not an everyday one it knows \(a hammer, a screwdriver, a broom\)/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/Not everyday things any picture maker knows \(a saw, a bowl, a chair\)/);
  });

  it("writes it as really built, by its parts, and corrects a look or plan built from the verb", () => {
    expect(NAMED_LOOKS_SYSTEM).toMatch(/Its LOOK\s+is the tool as it is really built: its one exact kind \(never two kinds mixed into one\)/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/each\s+PART that makes it that tool — its shape, material and size, and what it is joined to/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/Correct a\s+planned description or a key thing's look that gives it another build/);
    expect(NAMED_LOOKS_SYSTEM.replace(/\s+/g, " ")).toContain(TOOL_SHAPE_NOT_VERB);
  });

  it("keeps the hands on a tool in use, and gives the look only to a picture about the tool", () => {
    expect(NAMED_LOOKS_SYSTEM).toMatch(/in use keeps the hands and shows its parts working the way the tool really works/);
    expect(NAMED_LOOKS_SYSTEM).toMatch(/never to one where it only\s+lies beside what the picture is about/);
  });

  it("names no channel's tool or fixture", () => {
    // "in a drain" was already the body-part rule's example of a strand that really falls.
    const tool = NAMED_LOOKS_SYSTEM.slice(
      NAMED_LOOKS_SYSTEM.indexOf("A SPECIALISED TOOL"),
      NAMED_LOOKS_SYSTEM.indexOf("A REAL, RECOGNISABLE")
    );
    expect(tool).not.toMatch(CHANNEL_WORDS);
  });

  it("job 408 scene 23: the auger's look by its parts lands on the picture, the hands kept", () => {
    const scenes = scenes408();
    expect(namedLookCandidates(scenes)).toEqual([0, 1, 2]);
    const answer = parseNamedLooks(
      JSON.stringify({
        kinds: [{ name: "toilet auger", look: AUGER_LOOK }],
        pictures: [
          {
            id: "#1",
            kind: "toilet auger",
            show: "hands turning the crank handle of a closet auger, its J-bent steel tube with a black rubber sleeve resting in the toilet bowl's drain opening",
          },
        ],
      })
    )!;
    expect(answer.kinds).toEqual([{ name: "toilet auger", look: AUGER_LOOK }]);
    expect(applyNamedLooks(scenes, [0, 1, 2], answer, parseKeyThings(SHEET_408))).toBe(1);
    const auger = scenes[1];
    expect(auger.namedLook).toBe(`toilet auger: ${AUGER_LOOK}`);
    expect(auger.showSubject).toMatch(/^hands turning the crank handle of a closet auger/);
    expect(auger.visualPrompt).toBe(auger.showSubject);
    expect(auger.humanPresent).toBe(true);
    expect(auger.keyThing).toBe("toilet auger");
    expect(auger.partOf).toBeUndefined();
    // The exact look wins over the props list's rod: the key thing's look is not added beside it.
    auger.keyThingLook = "a slim metal rod with a curved tip and plastic handle, short household size";
    expect(keyThingLookClause(auger)).toBe("");
    const clause = namedLookClause(auger);
    expect(clause).toContain("EXACT LOOK — toilet auger: a closet auger about 1 m long");
    expect(clause).toContain("a crank handle with a wooden grip");
    expect(clause).toContain("whatever any other words say about its pattern, shape or build");
    // The plunger picture and the toilet with the tool beside it are not touched.
    expect(scenes[0]).toEqual(scenes408()[0]);
    expect(scenes[2]).toEqual(scenes408()[2]);
  });

  it("a rewrite that drops the hands is not used — the look still is", () => {
    const scenes = scenes408();
    applyNamedLooks(
      scenes,
      [1],
      {
        kinds: [{ name: "toilet auger", look: AUGER_LOOK }],
        pictures: [{ id: 1, kind: "toilet auger", show: "a closet auger's rubber-sleeved bend set in a toilet bowl's drain opening" }],
      },
      parseKeyThings(SHEET_408)
    );
    expect(scenes[1].showSubject).toBe("toilet auger hooked tip inserted into toilet bowl trapway opening");
    expect(scenes[1].humanPresent).toBe(true);
    expect(scenes[1].namedLook).toBe(`toilet auger: ${AUGER_LOOK}`);
  });

  it("a tool named with no look to draw it by changes nothing (the props look stays)", () => {
    const scenes = scenes408();
    const answer = parseNamedLooks('{"kinds":[{"name":"toilet auger","look":"a toilet auger"}],"pictures":[{"id":1,"kind":"toilet auger"}]}')!;
    expect(answer.kinds).toEqual([]);
    expect(applyNamedLooks(scenes, [1], answer, parseKeyThings(SHEET_408))).toBe(0);
    expect(scenes[1]).toEqual(scenes408()[1]);
  });

  it("the step is shown the props list's look, so a wrong build can be corrected", async () => {
    const scenes = scenes408();
    let user = "";
    const r = await describeNamedLooks(scenes, {
      keyThings: parseKeyThings(SHEET_408),
      ask: async (system, message) => {
        expect(system).toBe(NAMED_LOOKS_SYSTEM);
        user = message;
        return JSON.stringify({
          kinds: [{ name: "toilet auger", look: AUGER_LOOK }],
          pictures: [{ id: 1, kind: "toilet auger", show: "hands turning the crank handle of a closet auger set in the toilet bowl's drain" }],
        });
      },
    });
    expect(user).toContain("KEY THINGS: ");
    expect(user).toContain("toilet auger: a slim metal rod with a curved tip and plastic handle");
    expect(user).toContain('#1: said "A toilet auger, the short kind made for toilets, can sometimes hook it out." | shows: toilet auger hooked tip');
    expect(r).toEqual({ kinds: 1, pictures: 1, parts: 0 });
    expect(scenes[1].namedLook).toBe(`toilet auger: ${AUGER_LOOK}`);
  });
});

describe("the checker holds a tool to its parts", () => {
  it("counts other parts or a generic tool as a miss, and lets a tool in use hide what is inside its work", () => {
    const q = exactLookQuestion(`toilet auger: ${AUGER_LOOK}`);
    expect(q).toMatch(/other shapes or a different build/);
    expect(q).toMatch(/a generic or different pattern or tool/);
    expect(q).toMatch(/A tool in use may hide the part of it that is inside what it works on/);
    expect(q).toContain("a crank handle with a wooden grip");
  });
});

describe("the look settles the build; the picture still says which part is shown", () => {
  it("never tells the picture maker to ignore other words about the parts (specific beats general, job 344)", () => {
    const s = pic(1, "First, the jaw.", "close-up of the toothed upper jaw of a pipe wrench", {
      namedLook: "pipe wrench: a heavy steel pipe wrench, a red handle, a fixed lower jaw, an adjustable upper jaw",
    });
    const clause = namedLookClause(s);
    // "whatever any other words say about its parts" sat one sentence before "when they name a
    // particular part … show exactly that": the two said opposite things about a close-up.
    expect(clause).not.toMatch(/about its [^.]*\bparts\b/);
    expect(clause).toContain("whatever any other words say about its pattern, shape or build");
    expect(SUBJECT_OVER_LOOK).toMatch(/its pattern, shapes, build, colours and style/);
    expect(SUBJECT_OVER_LOOK).toMatch(/when they name a\s+particular part/);
    const q = exactLookQuestion(s.namedLook!);
    expect(q).not.toMatch(/other shapes or parts/);
    expect(q).toMatch(/never answer true only because the frame is/);
  });

  it("asks what each part is joined to, never where (the place cut reads 'where' as a place)", () => {
    expect(SPECIALISED_TOOL_RULE).not.toMatch(/\bwhere\b/);
    const tool = NAMED_LOOKS_SYSTEM.slice(
      NAMED_LOOKS_SYSTEM.indexOf("A SPECIALISED TOOL"),
      NAMED_LOOKS_SYSTEM.indexOf("A REAL, RECOGNISABLE")
    );
    expect(tool).toMatch(/what it is joined to/);
    expect(tool).not.toMatch(/where it joins/);
  });
});

describe("a part is kept when 'where' says how it sits on the thing", () => {
  it("keeps the part a tool is told apart by", () => {
    // Both clauses went whole: "where" read as a place.
    expect(
      pictureLook(
        "a closet auger, a steel tube bent into a J, a black rubber sleeve where the tube bends, a crank handle at the top of the tube"
      )
    ).toBe("a closet auger, a steel tube bent into a J, a black rubber sleeve, a crank handle at the top of the tube");
    expect(pictureLook("a pipe wrench, a red steel handle, a fixed lower jaw where it meets the handle, an adjustable upper jaw")).toBe(
      "a pipe wrench, a red steel handle, a fixed lower jaw, an adjustable upper jaw"
    );
  });

  it("job 376's stored smoke alarm keeps its test button and seam", () => {
    const look =
      "a round white plastic disc about 5 inches across, slightly domed, flush against the ceiling, with a small center test button and a thin seam where the cover separates from the base";
    expect(pictureLook(look)).toBe(
      "a round white plastic disc about 5 inches across, slightly domed, flush, with a small center test button and a thin seam"
    );
  });

  it("a 'where' that says where the thing is still goes, as every stored look did before", () => {
    // Real stored props-list looks (jobs 337, 300, 395, 274, 375, 370), each cut exactly as before —
    // but for the frost, which is the weather and goes with it since round 14 (`lookWithoutLight`).
    expect(pictureLook("paved slope in front of the garage, dusted with light frost, where furniture waits before pickup")).toBe(
      "paved slope in front of the garage"
    );
    expect(pictureLook("warm wood table in a bright kitchen corner, where knitting talk and lessons happen between people")).toBe(
      "warm wood table"
    );
    expect(pictureLook("pale wooden table beside the mirror where necklaces are laid out and picked up one at a time")).toBe("");
    expect(pictureLook("exposed wooden ceiling beam in the basement where a second alarm is mounted.")).toBe("");
    expect(
      pictureLook(
        "a plain unfinished basement space with concrete walls, a single hanging bulb, and a low ceiling where a second alarm is mounted."
      )
    ).toBe("a plain unfinished basement space with concrete walls, a single hanging bulb");
    expect(
      pictureLook("dark denim jeans, cuffs slightly faded, a light dusting of outdoor residue near the ankle where the dog's nose reaches")
    ).toBe("dark denim jeans, cuffs slightly faded");
    // A part whose "where" names a place goes whole.
    expect(pictureLook("a wall rack of pale pine, a row of brass hooks where the coats hang by the door")).toBe("a wall rack of pale pine");
  });
});
