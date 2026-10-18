/**
 * A CONTINUATION IS A NEW PHOTO OF THE SAME THING (2026-10-18, the review of practice jobs 401-405:
 * 15 near-copies). A topic past its limit, a split picture's later part or the planner repeating its
 * own words was drawn as "the same words + a view" from the picture it continued, and the reference
 * pinned the composition: job 405 scene 8 came back at scene 7's distance, scene 22 as scene 21 a
 * little tighter, job 401 scene 3 as scene 2 with other cards in the hands, job 403 scene 14 as scene
 * 10 a little closer. Now the picture it continues lends only the look, the camera is a concrete one
 * (`REDRAW_CAMERAS`), the same-thing check lays it beside THAT picture, the near-copy check always
 * looks at the pair, and a host take placed inside a topic ends it (job 405 scenes 22-24). The cases
 * are those films' rows; the rules are general.
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  attachMemory,
  BLUR_PRINT_VIEW,
  continuationCameraIndex,
  continuedPicture,
  lastPictureBefore,
  memoryFor,
  memorySourcesFor,
  memoryView,
  memoryViewFor,
  MEMORY_VIEWS,
  nearCopyPartner,
  nearCopyPartnerFor,
  recomposeFrom,
  repeatedPicture,
  rightBeforeToRecompose,
  SET_ITEM_VIEW,
} from "./pictureMemory";
import { PART_VIEW } from "./namedLooks";
import {
  buildStillPrompt,
  continuationCameraClause,
  memoryClause,
  memoryFields,
  memoryToWords,
  rightBeforeClause,
  sameThingReference,
} from "./longformVideo";
import { breakTopicsAtHostTakes, OTHER_VIEWS, repeatsTopic, topicWords } from "./shotList";
import {
  hashDistance,
  NEAR_COPY_BITS,
  nearCopyCandidates,
  pictureHash,
  pictureThumb,
  REDRAW_CAMERAS,
  REDRAW_VIEWS,
  rememberPicture,
} from "./pictureVariety";
import { JUST_SHOWN_COPY_NOTE, sameThingQuestion } from "./overlayTextScan";
import { enforcePlanRules } from "./planGate";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const host = (index: number, over: Partial<StoryboardScene> = {}) =>
  pic(index, "", { showSubject: undefined, visualPrompt: "the host talking to the camera", hostPresent: true, ...over });

// Job 405's rows as stored.
const CHEST =
  "a small tabby cat standing on a sleeping person's chest in the dark bedroom, head lowered close to their face, waiting";
const WINDOW = "a small tabby cat sitting alert on a windowsill, dim dawn light glowing through the bedroom window";
const job405 = () => [
  pic(3, "a small tabby cat padding across a rumpled grey bed at night", { keyThing: "cat" }),
  pic(7, CHEST, { keyThing: "cat", humanPresent: true, otherPerson: "a sleeping person" }),
  // A split picture's later part: the same words + the first view, no `sameShot`.
  pic(8, `${CHEST}${OTHER_VIEWS[0]}`, { keyThing: "cat", humanPresent: true, otherPerson: "a sleeping person" }),
];
const windowRun = () => [
  pic(7, CHEST, { keyThing: "cat" }),
  pic(21, WINDOW, { keyThing: "cat", otherKeyThings: ["window"] }),
  pic(22, `${WINDOW}${OTHER_VIEWS[0]}`, { keyThing: "cat", otherKeyThings: ["window"] }),
  // The plan gate's glimpse: a host take cut out of the middle of 22, which kept 22's words.
  host(23, { showSubject: `${WINDOW}${OTHER_VIEWS[0]}`, keyThing: "cat", scriptText: "The honest word is crepuscular," }),
  pic(24, `${WINDOW}${OTHER_VIEWS[0]}`, { keyThing: "cat", otherKeyThings: ["window"] }),
  pic(25, "an open grassy wild landscape at dusk, low golden light over scattered brush and distant hills", {
    keyThing: "wild landscape",
  }),
];

// Job 401 scenes 2-5 as stored.
const AISLE = "man standing in pharmacy card aisle holding a sympathy and birthday card together";
const job401 = () => [
  pic(2, AISLE, {
    keyThing: "sympathy card",
    otherKeyThings: ["pharmacy card aisle", "birthday card"],
    humanPresent: true,
    visualPrompt:
      "Pharmacy card aisle with white display racks. Bare weathered hands holding a plain cream sympathy card and a pale birthday card together, fingers gripping both cards in front of rows of cards on the rack.",
  }),
  pic(3, `${AISLE}${OTHER_VIEWS[0]}`, {
    sameShot: true,
    keyThing: "sympathy card",
    otherKeyThings: ["pharmacy card aisle", "birthday card"],
    humanPresent: true,
    visualPrompt: "Close detail of a plain cream sympathy card and pale birthday card held together, filling the frame.",
  }),
  pic(4, "a man's hand hovering between a row of cream sympathy cards and a row of pastel new-baby cards on a white pharmacy rack", {
    keyThing: "pharmacy card aisle",
    otherKeyThings: ["sympathy card"],
    humanPresent: true,
  }),
  pic(5, `${AISLE}${OTHER_VIEWS[2]}`, {
    sameShot: true,
    keyThing: "sympathy card",
    otherKeyThings: ["pharmacy card aisle", "birthday card"],
    humanPresent: true,
  }),
];

// Job 403 scenes 10-14: the pipe run under the house, then the toilet's trapway, then the pipes again.
const job403 = () => [
  pic(10, "grey PVC pipe network running beneath a house toward the street", { keyThing: "pipe network" }),
  pic(11, "close view of the toilet's internal porcelain S-shaped trapway channel with water rushing through it", {
    keyThing: "toilet trapway",
  }),
  pic(13, "close-up of the smooth white curved S-shaped porcelain channel, water flowing up and over its curve", {
    keyThing: "toilet trapway",
    partOf: "toilet trapway",
    listCut: true,
    scriptText: "and follow.",
  }),
  pic(14, "grey PVC pipe network running beneath the house toward the street", { keyThing: "pipe network" }),
];

// Job 404 scenes 2-7: a robin, a split with a robin panel, the robin on the lawn, the host's
// introduction, the robin on the lawn again.
const job404 = () => [
  pic(2, "a robin perched on a bare branch in a snowy backyard", { keyThing: "robin" }),
  host(4, {
    splitVisual: "A robin perched on a holly bush, its branches laden with bright red berries, snow on the ground nearby in winter.",
    keyThing: "robin",
  }),
  pic(5, "a robin standing on a green lawn in early spring with patches of melting snow", {
    keyThing: "robin",
    otherKeyThings: ["lawn"],
  }),
  host(6, { scriptText: "I'm Walter, and if you keep an eye on the yard from the kitchen window, this one's for you." }),
  pic(7, "a robin standing on the snowy lawn near the fence", { keyThing: "robin", otherKeyThings: ["lawn"] }),
];

describe("which picture a later view continues (continuedPicture)", () => {
  it("405-8 and 405-22: a split picture's later part and a topic past its limit continue the picture before", () => {
    const a = job405();
    expect(continuedPicture(a, a[2])).toBe(a[1]);
    const w = windowRun();
    expect(continuedPicture(w, w[2])).toBe(w[1]);
    // The first picture of the window topic continues nothing: its memory is a different moment.
    expect(continuedPicture(w, w[1])).toBeUndefined();
    expect(continuedPicture(w, w[5])).toBeUndefined();
  });

  it("401-5: it continues the picture whose words it repeats, not the different picture right before it", () => {
    const b = job401();
    expect(continuedPicture(b, b[1])).toBe(b[0]);
    expect(memorySourcesFor(b, b[3])).toEqual([b[0], b[2]]);
    expect(continuedPicture(b, b[3])).toBe(b[0]);
    // 4 has words of its own: drawn from 3's memory as the picture right before it, not a continuation.
    expect(continuedPicture(b, b[2])).toBeUndefined();
  });

  it("403-14: the same words again three pictures later still continue scene 10", () => {
    const c = job403();
    expect(continuedPicture(c, c[3])).toBe(c[0]);
    expect(recomposeFrom(c, c[3])).toEqual({ from: c[0], continues: true });
  });

  it("a marked continuation whose words were rewritten continues the picture right before it", () => {
    const board = [
      pic(1, "a walnut cutting board on the bench", { keyThing: "cutting board" }),
      pic(2, "the board's end grain up close", { keyThing: "cutting board", sameShot: true }),
    ];
    expect(continuedPicture(board, board[1])).toBe(board[0]);
    expect(continuedPicture(board, { ...board[1] } as StoryboardScene)).toBeUndefined(); // not on the board
  });

  it("399-17 and 397-29 are not continuations: different words keep the right-before rule", () => {
    const pour = pic(16, "hands pouring soda into an ice-filled plastic cup at the cart", { keyThing: "plastic cup" });
    const cup = pic(17, "a small plastic cup barely filled with ginger ale on a tray table", { keyThing: "plastic cup" });
    expect(continuedPicture([pour, cup], cup)).toBeUndefined();
    expect(recomposeFrom([pour, cup], cup)).toEqual({ from: pour, continues: false });
  });

  it("a list item cut from its group picture and a screen keep their own framing", () => {
    const set = pic(1, "a straight-stitch machine, a rotary cutter and a pile of scraps together on a kitchen table", {
      keyThing: "straight-stitch machine",
      listSet: true,
    });
    const item = pic(2, "a straight-stitch machine, a rotary cutter and a pile of scraps together on a kitchen table", {
      keyThing: "straight-stitch machine",
      listCut: true,
      scriptText: "a straight-stitch machine,",
    });
    expect(continuedPicture([set, item], item)).toBeUndefined();
    expect(memoryViewFor([set, item], item)).toBe(SET_ITEM_VIEW);
    const listing = pic(1, "a phone screen showing the cutting board listing", { keyThing: "cutting board" });
    const again = pic(2, "a phone screen showing the cutting board listing", { keyThing: "cutting board" });
    expect(continuedPicture([listing, again], again)).toBeUndefined();
  });

  it("the topic words of a description drop any view; nearly the same words are one topic", () => {
    expect(topicWords(`${WINDOW}${OTHER_VIEWS[0]}`)).toBe(WINDOW);
    expect(topicWords(`${WINDOW}${OTHER_VIEWS[1]}.`)).toBe(WINDOW);
    expect(repeatsTopic(WINDOW, `${WINDOW}${OTHER_VIEWS[2]}`)).toBe(true);
    expect(repeatsTopic(job403()[0].showSubject, job403()[3].showSubject)).toBe(true);
    expect(repeatsTopic(job404()[2].showSubject, job404()[4].showSubject)).toBe(false);
    expect(repeatsTopic("", WINDOW)).toBe(false);
  });
});

describe("the camera a continuation is drawn from (REDRAW_CAMERAS)", () => {
  it("405-22: the close-up its words name, the concrete one — never the stock part view", () => {
    const w = windowRun();
    expect(memoryViewFor(w, w[2])).toBe(REDRAW_CAMERAS[0]);
    // The first picture of the topic is still drawn from the cat's memory by the stock rotation.
    expect(memoryViewFor(w, w[1])).toBe(MEMORY_VIEWS[0]);
  });

  it("405-24 as stored (the same close-up words as 22): never 22's camera", () => {
    const w = windowRun();
    expect(continuedPicture(w, w[4])).toBe(w[2]);
    expect(continuationCameraIndex(w, w[2])).toBe(0);
    expect(memoryViewFor(w, w[4])).toBe(REDRAW_CAMERAS[1]);
  });

  it("401-3 and 401-5: each continuation of scene 2 takes the camera its own view names", () => {
    const b = job401();
    expect(memoryViewFor(b, b[1])).toBe(REDRAW_CAMERAS[0]);
    expect(memoryViewFor(b, b[3])).toBe(REDRAW_CAMERAS[2]);
  });

  it("403-14: a repeat with no view of its own gets the camera after its source's", () => {
    const c = job403();
    expect(memoryViewFor(c, c[3])).toBe(REDRAW_CAMERAS[0]);
    // A third repeat of the same words moves on again, never the second's camera.
    const third = pic(15, "grey PVC pipe network running beneath the house toward the street", { keyThing: "pipe network" });
    expect(memoryViewFor([...c, third], third)).toBe(REDRAW_CAMERAS[1]);
  });

  it("398-10: marked to continue with words of its own, it keeps the close view they ask for", () => {
    // Job 398 as stored: scene 9 repeats scene 3's lattice (a continuation by words), scene 10 is
    // marked to continue scene 9 but its words show hands fitting a strip, close up.
    const LATTICE = "a one-foot-square kumiko lattice of thin pale pine strips in an even square grid, lying flat on a pale wooden workbench";
    const k = [
      pic(3, LATTICE.replace("strips in", "strips crossing in"), { keyThing: "lattice panel" }),
      pic(9, LATTICE, { keyThing: "lattice panel" }),
      pic(10, "close view of hands pressing a thin pale pine strip into the half-depth notches of a crossing strip, building a square kumiko grid on a workbench", {
        keyThing: "lattice panel",
        sameShot: true,
      }),
    ];
    // Scene 9 repeats scene 3's words: a concrete camera.
    expect(repeatedPicture(k, k[1])).toBe(k[0]);
    expect(memoryViewFor(k, k[1])).toBe(REDRAW_CAMERAS[0]);
    // Scene 10 still continues scene 9 (drawn from it as one, compared with it)…
    expect(continuedPicture(k, k[2])).toBe(k[1]);
    expect(recomposeFrom(k, k[2])).toEqual({ from: k[1], continues: true });
    // …but its words set it apart: never "seen from much further back, the subject small in it".
    expect(repeatedPicture(k, k[2])).toBeUndefined();
    expect(continuationCameraIndex(k, k[2])).toBe(-1);
    expect(memoryViewFor(k, k[2])).toBe(PART_VIEW);
  });

  it("printing that must stay unreadable is never a close-up, a continuation included", () => {
    const b = job401();
    b[1].blurPrint = true;
    expect(memoryViewFor(b, b[1])).toBe(BLUR_PRINT_VIEW);
  });

  it("the redraw cameras are the near-copy redraw's views, in the shot list's view order", () => {
    expect(REDRAW_VIEWS).toEqual(REDRAW_CAMERAS.map(c => `Camera for THIS picture: ${c}.`));
    expect(REDRAW_CAMERAS[0]).toMatch(/close-up/);
    expect(OTHER_VIEWS[0]).toMatch(/close-up/);
    expect(REDRAW_CAMERAS[1]).toMatch(/much further back/);
    expect(OTHER_VIEWS[1]).toMatch(/much further back/);
    expect(REDRAW_CAMERAS[2]).toMatch(/other side/);
    expect(OTHER_VIEWS[2]).toMatch(/other side/);
  });
});

describe("the picture just shown, across a host take (lastPictureBefore)", () => {
  it("404-7: the robin after the host's introduction is drawn from the robin before it, a new photo", () => {
    const r = job404();
    expect(lastPictureBefore(r, r[4])).toBe(r[2]);
    expect(rightBeforeToRecompose(r, r[4])).toBe(r[2]);
    expect(recomposeFrom(r, r[4])).toEqual({ from: r[2], continues: false });
  });

  it("a split screen stops the walk: its panel is a picture the viewer sees", () => {
    const r = job404();
    expect(lastPictureBefore(r, r[2])).toBeUndefined();
    expect(rightBeforeToRecompose(r, r[2])).toBeUndefined();
  });
});

describe("at render: the continuation's memory, clause and the picture it is compared with", () => {
  it("405-22: drawn from 21 as the picture it continues — position 1, the concrete close-up", async () => {
    const w = windowRun();
    w[0].pictureUrl = "https://r2/still-src-7.png";
    w[1].pictureUrl = "https://r2/still-src-21.png";
    attachMemory(w, [w[2]]);
    const m = await memoryFor(w[2], 0);
    expect(m).toMatchObject({ urls: ["https://r2/still-src-7.png", "https://r2/still-src-21.png"], before: 1, continues: true });
    const fields = memoryFields(m, memoryView(w[2]));
    expect(fields).toMatchObject({ memoryRightBefore: 1, memoryContinues: true, memoryView: REDRAW_CAMERAS[0] });
    const s = { ...w[2], ...fields };
    // The check lays it beside scene 21, not scene 7 (the cat on the sleeper's chest), where it passed.
    expect(sameThingReference(s)).toBe("https://r2/still-src-21.png");
    expect(nearCopyPartner(w[2])).toBe(w[1]);
    const clause = memoryClause(s);
    expect(clause).toMatch(/Reference image 2 is the earlier picture this one CONTINUES/);
    expect(clause).toMatch(/take ONLY how the cat and window look from it, never the picture itself/);
    expect(clause).toMatch(/never that picture's angle with the subject only a little closer or further away/);
    expect(clause).toContain(`Camera position for THIS picture: ${REDRAW_CAMERAS[0]} — clearly different from the reference's.`);
    expect(clause).not.toMatch(/RIGHT BEFORE/);
    expect(buildStillPrompt(s)).toContain(clause);
  });

  it("399-17 keeps its right-before wording; a picture that only shares a memory says neither", () => {
    const right = pic(17, "a small plastic cup barely filled with ginger ale on a tray table", {
      keyThing: "plastic cup",
      memoryRefUrls: ["https://r2/still-src-16.png"],
      memoryView: MEMORY_VIEWS[0],
      memoryRightBefore: 0,
    });
    expect(rightBeforeClause(right)).toMatch(/RIGHT BEFORE this one in the video/);
    expect(rightBeforeClause(right)).not.toMatch(/CONTINUES/);
    expect(rightBeforeClause({ ...right, memoryRightBefore: undefined, memoryContinues: true })).toBe("");
    // `continues` without a position among the references sets nothing.
    expect(memoryFields({ urls: ["https://r2/a.png"], own: true, continues: true }, REDRAW_CAMERAS[0]).memoryContinues).toBeUndefined();
  });

  it("405-8 and 401-3: a continuation that copies twice is drawn from words, keeping its camera", () => {
    const s = pic(8, `${CHEST}${OTHER_VIEWS[0]}`, {
      keyThing: "cat",
      memoryRefUrls: ["https://r2/still-src-3.png", "https://r2/still-src-7.png"],
      memoryView: REDRAW_CAMERAS[0],
      memoryRightBefore: 1,
      memoryContinues: true,
    });
    expect(continuationCameraClause(s)).toBe(` Camera for THIS picture: ${REDRAW_CAMERAS[0]}.`);
    const words = { ...s, ...memoryToWords(s) };
    expect(words).toMatchObject({ memoryRefUrls: undefined, memoryView: undefined, memoryRightBefore: undefined, memoryContinues: undefined });
    expect(continuationCameraClause(words)).toBe("");
    // A picture drawn from the one right before it, about something else, keeps no camera: as before.
    expect(continuationCameraClause({ ...s, memoryContinues: undefined })).toBe("");
  });

  it("the same-thing check is told a slightly tighter frame of the picture just shown is a copy", () => {
    expect(sameThingQuestion("cat", true)).toContain(JUST_SHOWN_COPY_NOTE);
    // Round 13: any tighter or looser crop of the same layout, not only "a little" (`SAME_LAYOUT_RULE`).
    expect(JUST_SHOWN_COPY_NOTE).toMatch(/only closer or further back .* is a copy/);
    expect(sameThingQuestion("cat")).not.toContain(JUST_SHOWN_COPY_NOTE);
    expect(sameThingQuestion('the "big" cat')).toMatch(/^The thing: the 'big' cat\. Is it the same one on the right/);
  });
});

describe("the near-copy check always looks at the picture a continuation repeats", () => {
  it("405-8: its partner is the picture it continues; 404-7 the robin before the host take", () => {
    const a = job405();
    expect(nearCopyPartnerFor(a, a[2])).toBe(a[1]);
    const r = job404();
    expect(nearCopyPartnerFor(r, r[4])).toBe(r[2]);
  });

  it("a continuation with no key thing is paired by its words, across a host take too", () => {
    const KITCHEN = "a quiet farmhouse kitchen at dawn, a kettle on the old stove";
    const board = [
      pic(1, KITCHEN),
      pic(2, "a dog asleep on the porch steps"),
      host(3),
      pic(4, `${KITCHEN}${OTHER_VIEWS[1]}`),
    ];
    expect(nearCopyPartnerFor(board, board[3])).toBe(board[0]);
    // Marked to continue with words rewritten: the picture right before it.
    const marked = [pic(1, KITCHEN), pic(2, "steam curling off the kettle spout", { sameShot: true })];
    expect(nearCopyPartnerFor(marked, marked[1])).toBe(marked[0]);
  });

  it("different words and no memory: no partner; a split panel and the first picture never have one", () => {
    const board = [pic(1, "a dog asleep on the porch steps"), pic(2, "a red barn under a grey sky")];
    expect(nearCopyPartnerFor(board, board[1])).toBeUndefined();
    expect(nearCopyPartnerFor(board, board[0])).toBeUndefined();
    const split = host(3, { splitVisual: "a dog asleep on the porch steps" });
    expect(nearCopyPartnerFor([...board, split], split)).toBeUndefined();
  });

  const img = (r: number, g: number, b: number, stripe: "left" | "top" | "none") =>
    sharp({ create: { width: 320, height: 180, channels: 3, background: { r, g, b } } })
      .composite(
        stripe === "none"
          ? []
          : [
              {
                input: Buffer.from(
                  stripe === "left"
                    ? `<svg width="320" height="180"><rect x="0" y="0" width="160" height="180" fill="white"/></svg>`
                    : `<svg width="320" height="180"><rect x="0" y="0" width="320" height="60" fill="white"/><rect x="200" y="90" width="40" height="90" fill="black"/></svg>`
                ),
                left: 0,
                top: 0,
              },
            ]
      )
      .png()
      .toBuffer();

  it("the partner is looked at first however far its fingerprint reads; others still need to be close", async () => {
    const a = await img(40, 80, 120, "left");
    const b = await img(200, 60, 20, "top");
    const [ha, hb] = [await pictureHash(a), await pictureHash(b)];
    expect(hashDistance(ha, hb)).toBeGreaterThan(NEAR_COPY_BITS);
    rememberPicture(9101, 21, ha, await pictureThumb(a));
    rememberPicture(9101, 30, hb, await pictureThumb(b));
    expect(nearCopyCandidates(9101, 22, hb).map(c => c.index)).toEqual([30]);
    const withPartner = nearCopyCandidates(9101, 22, hb, 21);
    expect(withPartner.map(c => c.index)).toEqual([21, 30]);
    expect(withPartner[0].bits).toBeGreaterThan(NEAR_COPY_BITS);
    // Never its own earlier draw, and a partner never drawn in this process is simply not there.
    expect(nearCopyCandidates(9101, 21, ha, 21).map(c => c.index)).toEqual([]);
    expect(nearCopyCandidates(9101, 22, hb, 99).map(c => c.index)).toEqual([30]);
  });
});

describe("a same-topic chain ends at a host take placed later (breakTopicsAtHostTakes)", () => {
  it("405-24: the half after the glimpse gets the next view after 22's, never 22's words again", () => {
    const w = windowRun();
    expect(breakTopicsAtHostTakes(w)).toBe(1);
    expect(w[4].showSubject).toBe(`${WINDOW}${OTHER_VIEWS[1]}`);
    expect(w[4].visualPrompt).toBe(`${WINDOW}${OTHER_VIEWS[1]}`);
    expect(w[2].showSubject).toBe(`${WINDOW}${OTHER_VIEWS[0]}`); // the half before keeps its words
    // …and at render it is drawn from 22, from much further back.
    expect(continuedPicture(w, w[4])).toBe(w[2]);
    expect(memoryViewFor(w, w[4])).toBe(REDRAW_CAMERAS[1]);
  });

  it("a picture marked to continue loses the mark once a host take sits before it", () => {
    const board = [pic(1, WINDOW), host(2), pic(3, "the cat's tail curled around its paws on the sill", { sameShot: true })];
    expect(breakTopicsAtHostTakes(board)).toBe(1);
    expect(board[2].sameShot).toBeUndefined();
    expect(board[2].showSubject).toBe("the cat's tail curled around its paws on the sill");
  });

  it("leaves alone a different view, different words, a picture after a picture, a list item and a split's neighbour", () => {
    const other = [pic(1, WINDOW), host(2), pic(3, `${WINDOW}${OTHER_VIEWS[2]}`)];
    expect(breakTopicsAtHostTakes(other)).toBe(0);
    expect(other[2].showSubject).toBe(`${WINDOW}${OTHER_VIEWS[2]}`);
    const r = job404();
    expect(breakTopicsAtHostTakes(r)).toBe(0); // 404-7 says something of its own
    const b = job401();
    expect(breakTopicsAtHostTakes(b)).toBe(0); // 401-5 follows a picture, not a host take
    expect(b[3].sameShot).toBe(true);
    const item = [pic(1, WINDOW), host(2), pic(3, WINDOW, { listCut: true, sameShot: true })];
    expect(breakTopicsAtHostTakes(item)).toBe(0);
    const split = [pic(1, WINDOW), host(2, { splitVisual: "a cat on a sill" }), pic(3, WINDOW, { sameShot: true })];
    expect(breakTopicsAtHostTakes(split)).toBe(1);
    expect(split[2].sameShot).toBeUndefined();
    expect(split[2].showSubject).toBe(WINDOW); // the panel was the last picture, not scene 1
  });

  it("the plan gate runs it on its final plan (405-22/23/24 as the glimpse left them, every piece cut on words)", () => {
    let t = 0;
    const at = (s: StoryboardScene, sec: number) => {
      Object.assign(s, { narrationStartSec: t, narrationEndSec: t + sec, audioDuration: sec, audioUrl: `https://x/${s.index}.mp3` });
      t += sec;
      return s;
    };
    const scenes = [
      at(host(1, { scriptText: "Cats keep strange hours, and here is why." }), 5),
      at(pic(2, WINDOW, { stillImage: true, wordCut: true, scriptText: "There is a stubborn old myth that cats are nocturnal," }), 5),
      at(pic(3, `${WINDOW}${OTHER_VIEWS[0]}`, { stillImage: true, wordCut: true, scriptText: "creatures of the deep night, and that is mostly a cartoon." }), 4),
      at(host(4, { wordCut: true, scriptText: "The honest word is crepuscular," }), 2.6),
      at(pic(5, `${WINDOW}${OTHER_VIEWS[0]}`, { stillImage: true, wordCut: true, scriptText: "which is just a fancy way of saying dawn and dusk." }), 3.7),
      at(host(6, { scriptText: "So she wakes you at dawn on purpose." }), 5),
    ];
    const r = enforcePlanRules(scenes, { faceImageUrl: "https://x/host.jpg", hostName: "Luca" } as any);
    const after = r.scenes.find(s => s.scriptText?.startsWith("which is just"));
    expect(r.scenes.find(s => s.scriptText?.startsWith("The honest"))?.hostPresent).toBe(true);
    expect(after?.showSubject).toBe(`${WINDOW}${OTHER_VIEWS[1]}`);
    expect(r.fixes.some(f => /after a host take no longer continue/.test(f))).toBe(true);
  });
});
