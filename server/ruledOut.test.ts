/**
 * WHAT A LINE RULES OUT IS NEVER DRAWN (R5, the audit, 2026-10-18). Only a danger warning had a
 * rule; a sentence that says NOT to do something, what something is NOT, what to use INSTEAD or what
 * to keep AWAY was drawn as the thing it ruled out — production 203-143 "and away from the furnace"
 * with the stack beside the furnace, 224-22 "I don't mean a steel vault" as a steel vault door. The
 * line check (Opus, every picture beside its neighbouring lines) is the gate: it says what each such
 * picture must not show (`forbids`), and the picture check asks only those pictures. The cases are
 * real rows; the rule is general — a picture whose sentence rules nothing out is exactly as before.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  applyPictureFixes,
  applyPictureJoins,
  applyPictureSplits,
  FIT_SYSTEM,
  fitPicturesToLines,
  forbidsOf,
  markSameContext,
  parsePictureFixes,
  planShotList,
} from "./shotList";

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

/** What the cases below came from — never in a rulebook (the rules must fit any channel). */
const CHANNEL_OBJECTS =
  /furnace|rip fence|crosscut|dry shampoo|steel vault|portable generator|belly|tummy|tabby|risers?\b|stickered|kumiko|incense|smoke alarm|acrylic|pickets/i;

/** Real rows the audit labelled "shows what the line rules out", and what the check would say. */
const RULED_OUT: { id: string; line: string; show: string; forbids: string }[] = [
  {
    id: "prod 203-143",
    line: "and away from the furnace.",
    show: "a gas furnace with its burner flame glowing in a basement, a stickered board stack standing far across the room",
    forbids: "the board stack near the furnace",
  },
  {
    id: "practice 352 #154",
    line: "And never use the rip fence as a stop when you crosscut.",
    show: "the table saw's rip fence set away from the blade path, unused as a stop",
    forbids: "the rip fence used as a stop for a crosscut",
  },
  {
    id: "practice 241 #22",
    line: "For the days in between, dry shampoo. Not on the hair.",
    show: "A bottle of dry shampoo spray being applied directly to the scalp (not the hair lengths)",
    forbids: "dry shampoo sprayed onto the hair lengths",
  },
  {
    id: "prod 179-169",
    line: "And one display rule. Never lay these out in a flat row on your table.",
    show: "a pair of wood risers laid out in a flat row on the craft fair table",
    forbids: "the risers laid out in a flat row",
  },
  {
    id: "prod 224-22",
    line: "Number two. A safe room, and no, I don't mean a steel vault like in the movies.",
    show: "a thick round steel vault door standing open",
    forbids: "a steel vault door",
  },
  {
    id: "prod 205-292",
    line: "A belly on display isn't an invitation to rub it.",
    show: "The host's hand hovering near the belly-up tabby cat's tummy without touching it",
    forbids: "a hand rubbing or touching the cat's belly",
  },
];

/** Real lines a word list flagged that rule nothing visible out (the skeptic's gate check). */
const RULES_NOTHING_OUT = [
  "build it anyway for your own wall, just don't count on it to buy next month's pickets.",
  "Then skip one and make a tip, skip one and make a tip, all the way around.",
  "Wider boards, so a tabletop takes three boards instead of six.",
  "Finish the last few turns by hand, and quit the moment it snugs up.",
];

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("the rule, in the three steps that read every line beside its picture", () => {
  it("the shot list: what not to do, the right way of the same task, and never named with 'away from'", async () => {
    mockInvoke.mockResolvedValue({ text: JSON.stringify({ beats: [] }) });
    await planShotList([pic(1, "And never leave the brush soaking in the jar overnight.", "a brush")]);
    const system: string = mockInvoke.mock.calls[0][0].systemPrompt;
    expect(system).toMatch(/6b\. WHAT NOT TO DO/);
    expect(system).toMatch(/says what something is NOT/);
    expect(system).toMatch(/what to use INSTEAD/);
    expect(system).toMatch(/that a job is for someone else/);
    // The safe way is the same task done right — a push stick is the right way, not the danger.
    expect(system).toMatch(/the same task done the RIGHT way \(the guard in place, a push stick/);
    expect(system).toMatch(/the subject on its own and idle/);
    expect(system).toMatch(/never the ruled-out thing, not even with "without", "no", "not", "away from" or "across the room from"/);
    expect(system).toMatch(/Every shot of that sentence follows it/);
    expect(system).toMatch(/never the new shot of rules 1c and 1d/);
    expect(system).toMatch(/A figure of speech that rules out nothing/);
    expect(system).not.toMatch(CHANNEL_OBJECTS);
  });

  it("the line check: WRONG when it shows or names it, and a forbids for every such picture, right or wrong", () => {
    expect(FIT_SYSTEM).toMatch(/WHAT NOT TO DO/);
    expect(FIT_SYSTEM).toMatch(/WRONG when it shows OR NAMES the ruled-out act, the denied thing or the\s+forbidden placement/);
    expect(FIT_SYSTEM).toMatch(/"without", "no", "not", "away from" or "across the room from"/);
    expect(FIT_SYSTEM).toMatch(/Read the\s+whole sentence/);
    expect(FIT_SYSTEM).toMatch(/every picture of that sentence\s+follows them/);
    expect(FIT_SYSTEM).toMatch(/set forbids to what must NOT be\s+seen in it/);
    expect(FIT_SYSTEM).toMatch(/right or wrong/);
    expect(FIT_SYSTEM).toMatch(/"forbids":"\.\.\."/);
    // A consequence or someone else's job counts, with no "never" in it.
    expect(FIT_SYSTEM).toMatch(/a job for a licensed electrician/);
    expect(FIT_SYSTEM).toMatch(/only sets things back/);
    // A comparison the sentence rules out is never split off (224-22's "like in the movies").
    expect(FIT_SYSTEM).toMatch(/A comparison\s+the sentence rules out[\s\S]*is never split off or\s+drawn/);
    expect(FIT_SYSTEM).not.toMatch(CHANNEL_OBJECTS);
  });

  it("the line check leaves forbids out for an idiom, a skip-or-stop step and a count", () => {
    expect(FIT_SYSTEM).toMatch(/Leave forbids out when nothing\s+you could see is ruled out/);
    expect(FIT_SYSTEM).toMatch(/a figure of speech \("just don't count on it/);
    expect(FIT_SYSTEM).toMatch(/a step that says what to skip or when to stop/);
    expect(FIT_SYSTEM).toMatch(/a count \("two coats instead of three" is the\s+COUNT/);
    // A thing only kept away from something may still be shown on its own.
    expect(FIT_SYSTEM).toMatch(/forbids then names it WITH that place or act, never the thing alone/);
  });

  it("the same-topic groups: a ruled-out line never makes the group's picture show it", async () => {
    mockInvoke.mockResolvedValue({ text: JSON.stringify({ groups: [] }) });
    await markSameContext(
      [
        pic(1, "Keep the paint tins in a cool cupboard,", "paint tins on a cupboard shelf"),
        pic(2, "never beside the stove.", "paint tins on a cupboard shelf"),
      ],
      { sec: () => 3 }
    );
    const system: string = mockInvoke.mock.calls[0][0].systemPrompt;
    expect(system).toMatch(/A line that rules something out/);
    expect(system).toMatch(/never shows or names what any of its lines rules out/);
    expect(system).not.toMatch(CHANNEL_OBJECTS);
  });
});

describe("forbids, from the check's answer to the picture check", () => {
  it("rides a RIGHT picture with no rewrite, and a wrong one with its rewrite (the real rows)", () => {
    const scenes = RULED_OUT.map((r, k) => pic(k + 1, r.line, r.show));
    const answer = {
      pictures: RULED_OUT.map((r, id) =>
        // The first two rewritten, the rest judged right but still marked.
        id < 2
          ? { id, about: "x", shows_it: false, show: id === 0 ? "a stickered board stack on a dry garage floor" : "a stop block clamped to a crosscut sled", forbids: r.forbids }
          : { id, about: "x", shows_it: true, forbids: r.forbids }
      ),
    };
    const fixes = parsePictureFixes(JSON.stringify(answer), scenes);
    expect(fixes.map(f => f.forbids)).toEqual(RULED_OUT.map(r => r.forbids));
    expect(fixes.filter(f => f.show).map(f => f.id)).toEqual([0, 1]);
    const fixed = applyPictureFixes(scenes, fixes, undefined);
    // A mark alone is not a rewrite: only the two rewrites count, and the rest keep their picture.
    expect(fixed).toBe(2);
    expect(scenes.map(s => s.forbids)).toEqual(RULED_OUT.map(r => r.forbids));
    expect(scenes[0].showSubject).toBe("a stickered board stack on a dry garage floor");
    expect(scenes[4].showSubject).toBe(RULED_OUT[4].show);
  });

  it("stays null on lines that rule nothing visible out — an empty or 'none' answer marks nothing", () => {
    const scenes = RULES_NOTHING_OUT.map((line, k) => pic(k + 1, line, "a picture"));
    const answer = {
      pictures: [
        { id: 0, about: "x", shows_it: true },
        { id: 1, about: "x", shows_it: true, forbids: null },
        { id: 2, about: "x", shows_it: true, forbids: "none" },
        { id: 3, about: "x", shows_it: true, forbids: "  " },
      ],
    };
    expect(parsePictureFixes(JSON.stringify(answer), scenes)).toEqual([]);
    applyPictureFixes(scenes, parsePictureFixes(JSON.stringify(answer), scenes), undefined);
    expect(scenes.every(s => s.forbids === undefined)).toBe(true);
    // A rewrite with no forbids leaves none behind either.
    const one = [pic(1, RULES_NOTHING_OUT[2], "six boards")];
    applyPictureFixes(one, parsePictureFixes(JSON.stringify({ pictures: [{ id: 0, about: "x", shows_it: false, show: "three wide boards side by side" }] }), one), undefined);
    expect(one[0].forbids).toBeUndefined();
  });

  it("is never kept on a picture the check does not judge (a split panel, the host)", () => {
    const scenes = [
      pic(1, "and away from the furnace.", "a host", { hostPresent: true }),
      pic(2, "and away from the furnace.", "a host", { hostPresent: true, splitVisual: "a furnace" }),
    ];
    const fixes = parsePictureFixes(
      JSON.stringify({ pictures: [{ id: 0, forbids: "x near y" }, { id: 1, forbids: "x near y" }] }),
      scenes
    );
    expect(fixes).toEqual([]);
  });

  it("cleans the phrase", () => {
    expect(forbidsOf('  "the board stack near the furnace."  ')).toBe("the board stack near the furnace");
    expect(forbidsOf("a   steel\nvault door")).toBe("a steel vault door");
    for (const empty of [null, undefined, 3, "", "none", "None", "null", "N/A", "nothing", "-", '""']) expect(forbidsOf(empty)).toBeUndefined();
    expect(forbidsOf("x".repeat(400))!.length).toBe(160);
  });

  it("every piece of the sentence keeps it: a split's new part, and one picture for a joined sentence", () => {
    // prod 225-79..83: "Never in | the garage, | … | or on the porch" — the line check reads the
    // pieces as one sentence (the "same sentence" mark) and marks each.
    const split = applyPictureSplits(
      [pic(1, "I don't mean the kind of vault you see in the old bank movies", "a small interior room", { forbids: "a steel vault door" })],
      [{ id: 0, split: [{ from: "you see in the", show: "an interior room with a solid door" }] }],
      []
    );
    expect(split.split).toBe(1);
    expect(split.scenes.map(s => s.forbids)).toEqual(["a steel vault door", "a steel vault door"]);
    const joined = applyPictureJoins(
      [
        pic(1, "Keep any flame,", "a closed room", { forbids: "a lit candle in the room" }),
        pic(2, "a candle or a cigarette, out of that room while you work.", "a closed room", { forbids: "a lit cigarette in the room" }),
      ],
      [{ id: 1, join: true, show: "a closed room with the window open, the bottle capped on the table" }],
      undefined,
      () => 2
    );
    expect(joined.joined).toBe(1);
    expect(joined.scenes[0].forbids).toBe("a lit candle in the room; a lit cigarette in the room");
  });
});

describe("the check end to end (canned answer — the plumbing, not the model)", () => {
  it("prod 225-79..83: the pieces of one sentence are shown to the check as one sentence, and each is marked", async () => {
    const pieces = ["Never in", "the garage,", "the basement,", "the shed,", "or on the porch,"];
    const scenes = pieces.map((t, k) => pic(k + 1, t, "portable generator sitting inside a garage on the concrete floor"));
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: pieces.map((_, id) => ({ id, about: "where never to run it", shows_it: true, forbids: "the generator running inside a closed space" })),
      }),
    });
    const r = await fitPicturesToLines(scenes);
    const sent: string = mockInvoke.mock.calls[0][0].userMessage;
    // The check sees every piece after the first marked as continuing the sentence, so it reads
    // "Never in" with each place.
    expect(sent.match(/\(same sentence\)/g)?.length).toBe(4);
    expect(r.fixed).toBe(0);
    expect(r.scenes.every(s => s.forbids === "the generator running inside a closed space")).toBe(true);
    // No rewrite: the pictures are unchanged, only marked for the picture check.
    expect(r.scenes.map(s => s.showSubject)).toEqual(scenes.map(s => s.showSubject));
  });

  it("a failed check marks nothing", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("529"));
    const scenes = [pic(1, "and away from the furnace.", "a board stack")];
    const r = await fitPicturesToLines(scenes);
    expect(r.scenes[0].forbids).toBeUndefined();
  });
});
