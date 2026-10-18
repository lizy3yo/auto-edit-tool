/**
 * EVERY KEY THING A PICTURE'S WORDS NAME KEEPS ITS WRITTEN LOOK WHEN IT IS DRAWN FROM WORDS (2026-10-18,
 * round 13, the review of jobs 408 and 409).
 * - Job 409 scene 3, "a man in his sixties standing still in the pharmacy aisle, holding the sympathy
 *   card", was drawn from scene 2 (the card's first picture: the props list's "plain cream greeting
 *   card with a muted gray ribbon print"), copied it twice and was drawn from words. The redraw kept
 *   only the look of its OWN key thing, the aisle, and the card came back a white card with a painted
 *   lily spray; scene 5, drawn from scene 3 as the aisle's memory, carried the lily card on.
 * - What it does NOT do: write in the look of a thing that only stood in a reference picture. Job 408's
 *   toilet panels (scenes 12 and 16), whose own words never name a bin, came back with a pedal bin where
 *   the toilet's first picture had the white lidded one; bringing such things along touched half the
 *   memory pictures of the stored films and handed job 404 scene 14's gulf coast yard the northern
 *   lawn's frost (the snow under palms `MEMORY_SETTING_CLAUSE` took out).
 * The rows are the stored ones (local jobs 404, 408 and 409); the rule names no channel's things.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  keyThingLookClause,
  keyThingLookFor,
  memoryFor,
  memoryView,
  otherThingLookFor,
  otherThingLooksClause,
} from "./pictureMemory";
import {
  buildSplitRightScene,
  buildStillPrompt,
  MEMORY_SETTING_CLAUSE,
  memoryClause,
  memoryFields,
  memoryToWords,
  promptAfterMemoryChange,
  withoutMemoryRef,
  withSplitMemory,
} from "./longformVideo";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

const count = (text: string, part: string) => text.split(part).length - 1;

// Job 409's props list as stored (the ones these scenes touch).
const CARD_LOOK = "a plain cream greeting card with a muted gray ribbon print on the front, blank inside, small and rectangular";
const AISLE_LOOK = "a narrow aisle lined with low wooden shelves holding neat rows of greeting cards";
const K409: KeyThing[] = [
  { name: "sympathy card", look: CARD_LOOK, main: true },
  {
    name: "greeting card",
    look: "a pale blue card with a simple floral print on the front, slightly smaller than the sympathy card, blank inside",
  },
  { name: "pharmacy aisle", look: `${AISLE_LOOK}, bright overhead lighting` },
];

// Job 408's props list as stored.
const TOILET_LOOK =
  "a white porcelain toilet, oval bowl, curved trapway inside its base visible as a smooth porcelain contour at the bowl's rear, closed lid often up";
const BIN_LOOK = "a small white plastic bin with a hinged lid, round shape";
const SWAB_LOOK = "short white plastic or paper sticks with cotton tufts on both ends";
const K408: KeyThing[] = [
  { name: "toilet", look: TOILET_LOOK, main: true },
  { name: "bin", look: `${BIN_LOOK}, sitting on tile floor beside the toilet base` },
  { name: "cotton swabs", look: `${SWAB_LOOK}, usually seen loose near the bin` },
  { name: "toilet paper", look: "a white paper roll with soft layered texture, mounted on a wall-fixed holder near the toilet" },
];

// Job 404's props list as stored (the robin, the northern lawn and the gulf coast yard).
const LAWN_LOOK =
  "a flat suburban backyard lawn, green fading to frost-dusted brown, bordered by a low wooden fence, viewed from the kitchen window";
const K404: KeyThing[] = [
  {
    name: "robin",
    look: "a plump songbird about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head, seen on grass, bare branches, and holly shrubs",
    main: true,
  },
  { name: "lawn", look: LAWN_LOOK },
  {
    name: "gulf coast yard",
    look: "a flat grassy winter yard in a mild southern climate, palm trees and green shrubs in the background, bright winter sunlight",
  },
];

// Job 409 scenes 2, 3 and 5 as stored, before render (scene 2 already drawn).
const job409 = () => [
  pic(2, "a man holding a sympathy card in a pharmacy aisle lined with shelves", {
    keyThing: "sympathy card",
    otherKeyThings: ["pharmacy aisle"],
    humanPresent: true,
    // As stored: its visual calls the sympathy card "a plain cream greeting card" — the words of the
    // video's OTHER card, which no picture drawn from it may be handed.
    visualPrompt:
      "Bare weathered hands holding a plain cream greeting card with muted gray ribbon print in a pharmacy aisle lined with low wooden shelves of neat card rows, bright overhead lighting.",
    pictureUrl: "https://r2/409/still-src-2.png",
  }),
  pic(3, "a man in his sixties standing still in the pharmacy aisle, holding the sympathy card, seen from the side", {
    keyThing: "pharmacy aisle",
    otherKeyThings: ["sympathy card"],
    humanPresent: true,
    visualPrompt: "Bare weathered hands holding the cream greeting card, still in the pharmacy aisle among shelves of cards, bright overhead lights.",
  }),
  pic(5, "a man in his sixties seen from behind, holding the sympathy card and gazing at the rows of cards in the pharmacy aisle", {
    keyThing: "pharmacy aisle",
    otherKeyThings: ["sympathy card"],
    humanPresent: true,
  }),
];

// Job 408 scenes 2, 11, 12 (a split about the toilet alone) and 16 (a split about a swab) as stored.
const job408 = () => [
  pic(2, "a small white plastic bin with a closed hinged lid on pale beige tile floor beside the base of a white porcelain toilet, water swirling in the bowl as it flushes", {
    keyThing: "bin",
    otherKeyThings: ["toilet"],
    pictureUrl: "https://r2/408/still-src-2.png",
  }),
  pic(11, "host crouched beside toilet in bathroom, examining items near the bin", {
    keyThing: "toilet",
    otherKeyThings: ["bin"],
    humanPresent: true,
    visualPrompt:
      "Bare weathered hands crouched beside a white porcelain toilet in a small bathroom, fingers gesturing near a small white plastic bin on the tile floor. Cotton swabs and other items visible in the bin area. No face or upper body visible.",
    pictureUrl: "https://r2/408/still-src-11.png",
  }),
  pic(12, "water flushing down in the white porcelain toilet bowl", {
    hostPresent: true,
    keyThing: "toilet",
    splitVisual:
      "White porcelain toilet bowl with water draining downward into the trapway opening, viewed from above at a settled moment as the bowl empties.",
  }),
  pic(16, "cotton swabs lying loose near the small white bin on tile floor", {
    hostPresent: true,
    keyThing: "cotton swabs",
    splitVisual:
      "close view of a single white cotton swab with cotton tufts on both ends lying on pale beige tile floor beside the base of a white porcelain toilet",
  }),
];

// Job 404 scenes 5 and 12 (the robin on the northern lawn, drawn) and 14 (the gulf coast yard) as stored.
const job404 = () => [
  pic(5, "a robin standing on a green lawn in early spring with patches of melting snow", {
    keyThing: "robin",
    visualPrompt: "A robin standing on green lawn with patches of melting snow in early spring, suburban yard with low wooden fence behind.",
    pictureUrl: "https://r2/404/still-src-5.png",
  }),
  pic(12, "a robin standing on frost dusted brown grass in winter", {
    keyThing: "robin",
    visualPrompt: "A robin standing on frost-dusted brown grass in winter, suburban backyard lawn, bare branches and low fence at edges.",
    pictureUrl: "https://r2/404/still-src-12.png",
  }),
  pic(14, "a robin standing in a mild gulf coast yard with palm trees", {
    keyThing: "robin",
    visualPrompt: "A robin standing on grassy winter yard with palm trees and green shrubs in background, bright winter sunlight, Gulf Coast setting.",
  }),
];

/** The scene as render leaves it: its memory fields set (`memoryFor` → `memoryFields`). */
const rendered = async (s: StoryboardScene) => ({ ...s, ...memoryFields(await memoryFor(s, 0), memoryView(s)) });

describe("409-3: a picture drawn from words keeps the look of every key thing its words name", () => {
  it("at render the card's written look is kept beside the aisle's, and the reference carries it meanwhile", async () => {
    const board = job409();
    attachMemory(board, [board[1]], K409);
    const s3 = await rendered(board[1]);
    expect(s3.memoryRefUrls).toEqual(["https://r2/409/still-src-2.png"]);
    expect(s3.memoryWordsLook).toBe(AISLE_LOOK);
    expect(s3.otherThingLooks).toEqual([{ name: "sympathy card", look: CARD_LOOK }]);
    // Drawn from memory, the reference shows the card: no written look beside it — the prompt reads
    // exactly as before.
    expect(keyThingLookClause(s3)).toBe("");
    expect(memoryClause(s3)).toMatch(/this exact pharmacy aisle and sympathy card/);
    expect(buildStillPrompt(s3)).not.toContain(CARD_LOOK);
  });

  it("after copying its memory twice it is drawn by the aisle's look AND the card's, each said once", async () => {
    const board = job409();
    attachMemory(board, [board[1]], K409);
    const s3 = await rendered(board[1]);
    const fields = memoryToWords(s3);
    expect(fields.otherThingLooks).toEqual([{ name: "sympathy card", look: CARD_LOOK }]);
    const words = { ...s3, ...fields };
    const look = keyThingLookClause(words);
    expect(look).toContain(`HOW THE PHARMACY AISLE LOOKS in every picture of this video: ${AISLE_LOOK}`);
    expect(look).toContain(
      `HOW THE OTHER THING IN IT LOOKS in every picture of this video — the sympathy card: ${CARD_LOOK}. Draw that same one, where this picture's own words put it.`
    );
    // The prompt the still loop sends next: the memory clause swapped for both looks.
    const prompt = promptAfterMemoryChange(s3, buildStillPrompt(s3), fields);
    expect(count(prompt, CARD_LOOK)).toBe(1);
    expect(count(prompt, AISLE_LOOK)).toBe(1);
    expect(prompt).not.toContain(MEMORY_SETTING_CLAUSE);
    expect(prompt).not.toContain("reference image");
    // Built again from words (a reworded memory clause), it carries the same looks.
    expect(buildStillPrompt(words)).toContain(`the sympathy card: ${CARD_LOOK}`);
  });

  it("the card's first picture, with nothing to follow, is drawn by its own look only — as before", async () => {
    const board = job409();
    board[0].pictureUrl = undefined;
    attachMemory(board, [board[0]], K409);
    const s2 = await rendered(board[0]);
    expect(s2.memoryRefUrls).toBeUndefined();
    expect(s2.keyThingLook).toBe(CARD_LOOK);
    expect(s2.otherThingLooks).toBeUndefined();
    expect(keyThingLookClause(s2)).toBe(
      ` HOW THE SYMPATHY CARD LOOKS in every picture of this video: ${CARD_LOOK}. Draw this same one — where it is, which part of it shows and how far along it is are as this picture's own words say.`
    );
  });

  it("dropping its only reference keeps the card's look too (`withoutMemoryRef` → words)", async () => {
    const board = job409();
    attachMemory(board, [board[1]], K409);
    const s3 = await rendered(board[1]);
    const dropped = withoutMemoryRef(s3, 2)!;
    expect(dropped).toEqual(memoryToWords(s3));
    expect(keyThingLookClause({ ...s3, ...dropped })).toContain(`the sympathy card: ${CARD_LOOK}`);
  });

  it("409-5: scene 2's visual words the card 'a plain cream greeting card', and the video's OTHER card never comes along", async () => {
    const board = job409();
    board[1].pictureUrl = "https://r2/409/still-src-3.png";
    attachMemory(board, [board[2]], K409);
    const s5 = await rendered(board[2]);
    expect(s5.memoryRefUrls).toEqual(["https://r2/409/still-src-3.png", "https://r2/409/still-src-2.png"]);
    expect(s5.otherThingLooks).toEqual([{ name: "sympathy card", look: CARD_LOOK }]);
    expect(buildStillPrompt({ ...s5, ...memoryToWords(s5) })).not.toContain("pale blue");
  });
});

describe("a thing that only stood in a reference picture is never written in", () => {
  it("404-14: the gulf coast yard drawn from the robin's lawn pictures is never handed the northern lawn's frost", async () => {
    const board = job404();
    attachMemory(board, [board[2]], K404);
    expect(board[0].otherKeyThings).toEqual(["lawn"]);
    expect(board[2].otherKeyThings).toEqual(["gulf coast yard"]);
    const s14 = await rendered(board[2]);
    expect(s14.memoryRefUrls).toEqual(["https://r2/404/still-src-5.png", "https://r2/404/still-src-12.png"]);
    // Only the yard its words name keeps a written look — never the lawn its references stand on.
    expect(s14.otherThingLooks?.map(t => t.name)).toEqual(["gulf coast yard"]);
    expect(buildStillPrompt(s14)).not.toContain("frost");
    const words = promptAfterMemoryChange(s14, buildStillPrompt(s14), memoryToWords(s14));
    expect(words).not.toContain(LAWN_LOOK);
    expect(words).not.toContain("frost");
    expect(words).toContain("the gulf coast yard: a flat grassy winter yard in a mild southern climate");
  });

  it("408-12: the toilet's panel names no bin — its references show one, and no bin's look is written in, from memory or from words", async () => {
    const board = job408();
    attachMemory(board, [], K408);
    const host = board[2];
    expect(host.otherKeyThings).toBeUndefined();
    const panel = await withSplitMemory(host, buildSplitRightScene(host), 0);
    expect(panel.memoryRefUrls).toEqual(["https://r2/408/still-src-2.png", "https://r2/408/still-src-11.png"]);
    expect(panel.otherThingLooks).toBeUndefined();
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).not.toContain(BIN_LOOK);
    expect(memoryClause(panel).endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
    const words = promptAfterMemoryChange(panel, prompt, memoryToWords(panel), { square: true });
    expect(words).toContain(`HOW THE TOILET LOOKS in every picture of this video: ${TOILET_LOOK}`);
    expect(words).not.toContain(BIN_LOOK);
    expect(words).not.toContain("OTHER THING");
  });

  it("408-16: the swab's panel keeps the toilet its words name after the redraw drops its memory, and only that", async () => {
    const board = job408();
    attachMemory(board, [], K408);
    const host = board[3];
    expect(host.otherKeyThings).toEqual(["toilet"]);
    const panel = await withSplitMemory(host, buildSplitRightScene(host), 0);
    // Its first swab picture: the references are the toilet's, so it is drawn by the swab's look.
    expect(panel.memoryOthersOnly).toBe(true);
    expect(panel.keyThingLook).toBe(SWAB_LOOK);
    expect(panel.otherThingLooks).toEqual([{ name: "toilet", look: TOILET_LOOK }]);
    const words = { ...panel, ...memoryToWords(panel) };
    expect(otherThingLooksClause(words)).toBe(
      ` HOW THE OTHER THING IN IT LOOKS in every picture of this video — the toilet: ${TOILET_LOOK}. Draw that same one, where this picture's own words put it.`
    );
    expect(keyThingLookClause(words)).toContain(`HOW THE COTTON SWABS LOOKS in every picture of this video: ${SWAB_LOOK}`);
    expect(keyThingLookClause(words)).not.toContain(BIN_LOOK);
  });
});

describe("what keeps the looks as they were", () => {
  it("a picture with no other key thing keeps nothing more", async () => {
    const board = [
      pic(3, "a straight-stitch machine at a kitchen table", { keyThing: "machine", pictureUrl: "https://r2/m3.png" }),
      pic(5, "a straight-stitch machine on the wooden work table", { keyThing: "machine" }),
    ];
    attachMemory(board, [board[1]], [{ name: "machine", look: "small black and chrome sewing machine, compact size" }]);
    const s = await rendered(board[1]);
    expect(s.otherThingLooks).toBeUndefined();
    expect(memoryToWords(s).otherThingLooks).toBeUndefined();
    expect(keyThingLookClause({ ...s, ...memoryToWords(s) })).toBe(
      " HOW THE MACHINE LOOKS in every picture of this video: small black and chrome sewing machine, compact size. Draw this same one — where it is, which part of it shows and how far along it is are as this picture's own words say."
    );
  });

  it("no reference picture, no looks kept: a first picture is drawn as it always was", () => {
    const memory = { urls: ["https://r2/408/still-src-2.png"], own: true, otherLooks: [{ name: "toilet", look: TOILET_LOOK }] };
    expect(memoryFields(memory, undefined).otherThingLooks).toEqual([{ name: "toilet", look: TOILET_LOOK }]);
    expect(memoryFields({ ...memory, urls: [] }, undefined).otherThingLooks).toBeUndefined();
  });

  it("a thing with no written look, or an inside no camera sees, is left out", () => {
    const s = pic(4, "a bin beside the toilet", { keyThing: "bin", otherKeyThings: ["toilet"] });
    expect(otherThingLookFor(s, "toilet", [{ name: "toilet", look: "  " }])).toBeUndefined();
    expect(
      otherThingLookFor(s, "toilet", [{ name: "toilet", look: "the toilet's internal porcelain passage behind the bowl, a smooth curved S-shaped channel" }])
    ).toBeUndefined();
    expect(otherThingLookFor(s, "toilet", undefined)).toBeUndefined();
  });

  it("only the thing being made is cut by the picture's stage; the bench beside it keeps its whole look", () => {
    const things: KeyThing[] = [
      { name: "incense holder", look: "a charred cedar block, dark black surface, finished and oiled, a round felt dot on its base", main: true },
      { name: "workbench", look: "a sturdy pine workbench with a worn top, a metal vise at one end" },
    ];
    const step = pic(7, "hands drilling a hole into a charred cedar block on the workbench", {
      keyThing: "workbench",
      otherKeyThings: ["incense holder"],
      buildStage: "making",
    });
    expect(otherThingLookFor(step, "incense holder", things)).not.toMatch(/finished|felt dot/);
    // Cut exactly as the holder's own look is on a step about the holder (`keyThingLookFor`).
    expect(otherThingLookFor(step, "incense holder", things)).toBe(
      keyThingLookFor({ ...step, keyThing: "incense holder", otherKeyThings: undefined }, things)
    );
    const holderStep = { ...step, keyThing: "incense holder", otherKeyThings: ["workbench"] };
    expect(otherThingLookFor(holderStep, "workbench", things)).toBe("a sturdy pine workbench with a worn top, a metal vise at one end");
    // A video that makes nothing keeps the main thing's look whole.
    expect(otherThingLookFor({ ...step, buildStage: undefined }, "incense holder", things, false)).toMatch(/felt dot/);
  });

  it("a named kind's exact look wins over the written look of the thing it is a kind of", () => {
    const s = pic(27, "a man reading an aged papyrus scroll at a desk", {
      keyThing: "reading lamp",
      otherKeyThings: ["essay scroll", "desk"],
      namedLook: "papyrus scroll: rolled into a cylinder, a thin brown cord tied around its middle",
      otherThingLooks: [
        { name: "essay scroll", look: "a long rolled scroll of pale papyrus" },
        { name: "desk", look: "a heavy carved dark wooden desk" },
      ],
    });
    expect(otherThingLooksClause(s)).not.toContain("pale papyrus");
    expect(otherThingLooksClause(s)).toBe(
      " HOW THE OTHER THING IN IT LOOKS in every picture of this video — the desk: a heavy carved dark wooden desk. Draw that same one, where this picture's own words put it."
    );
  });

  it("several named things share one sentence, the picture's words still placing them", () => {
    const s = pic(12, "a cotton swab beside the toilet and the bin", {
      keyThing: "cotton swabs",
      otherThingLooks: [
        { name: "toilet", look: TOILET_LOOK },
        { name: "bin", look: BIN_LOOK },
      ],
    });
    expect(otherThingLooksClause(s)).toBe(
      ` HOW THE OTHER THINGS IN IT LOOK in every picture of this video — the toilet: ${TOILET_LOOK}; the bin: ${BIN_LOOK}. ` +
        "Draw those same ones, where this picture's own words put them."
    );
    // With references they carry the things they show: nothing is written in.
    expect(otherThingLooksClause({ ...s, memoryRefUrls: ["https://r2/2.png"] })).toBe("");
  });
});
