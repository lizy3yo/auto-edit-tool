import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import { assignSceneRanges } from "./narrationAlignment";
import {
  applyShotPlan,
  foldSnappedFlashes,
  foldUnseenBeats,
  leadInBetweenItems,
  UNSEEN_BEAT_SEC,
  joinHookPictures,
  joinSameContext,
  applyContextGroups,
  withView,
  MOVING_PICTURE_MAX_SEC,
  contextRuns,
  parseContextGroups,
  splitPicture,
  pictureMaxSecAt,
  HOOK_PICTURE_MIN_SEC,
  LIST_SHOT_MIN_SEC,
  findPhraseAt,
  HOST_HANDOFF_MIN_SEC,
  MAX_PICTURE_SEC,
  settleShots,
  settleVideoKind,
  shotListEligible,
  tokenSpans,
  namesDevice,
  sellingScreen,
  showsScreen,
} from "./shotList";

const scene = (
  index: number,
  scriptText: string,
  extra: Partial<StoryboardScene> = {}
): StoryboardScene =>
  ({
    index,
    scriptText,
    narration: scriptText,
    visualPrompt: "old picture",
    ...extra,
  }) as StoryboardScene;

const HANK =
  "I'm Hank Hardwood, and this one's for anybody standing in a garage with a saw, a drill, and a stack of sandpaper.";

/** Seconds per word — stands in for the word timeline the caller measures with. */
/** A line after the host's, so the host's is not the film's closing line (which never hands over). */
const after = scene(99, "And that is the next part of the story.");

const byWords = (wps: number) => (s: StoryboardScene) =>
  tokenSpans(s.scriptText ?? "").length / wps;

describe("tokenSpans / findPhraseAt", () => {
  it("finds a phrase in order, ignoring case and punctuation", () => {
    const spans = tokenSpans(HANK);
    const saw = findPhraseAt(spans, "a saw,", 0);
    expect(spans[saw].tok).toBe("a");
    expect(spans[saw + 1].tok).toBe("saw");
    expect(findPhraseAt(spans, "a saw", saw + 1)).toBe(-1);
    expect(findPhraseAt(spans, "one's for", 0)).toBeGreaterThan(0);
  });
});

describe("applyShotPlan", () => {
  it("hands the host over to one quick shot per list item, verbatim", () => {
    const host = scene(1, HANK, { hostPresent: true, hostIntro: true });
    const { scenes: withAfter } = applyShotPlan(
      [host, after],
      [
        {
          scene: 1,
          hostUntil: "in a garage with",
          shots: [
            { from: "a saw", show: "a hand saw", list: true },
            { from: "a drill", show: "a cordless drill", list: true, motion: "object" },
            { from: "and a stack", show: "a stack of sandpaper", list: true },
          ],
        },
      ],
      { hostName: "Hank Hardwood" }
    );
    const scenes = withAfter.slice(0, -1);
    expect(scenes.map(s => s.scriptText)).toEqual([
      "I'm Hank Hardwood, and this one's for anybody standing in a garage with",
      "a saw,",
      "a drill,",
      "and a stack of sandpaper.",
    ]);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].hostIntro).toBe(true);
    expect(scenes.slice(1).every(s => !s.hostPresent && s.listCut && s.wordCut)).toBe(true);
    expect(scenes[1].showSubject).toBe("a hand saw");
    // A drill does not move by itself: the planner's "object" stands only until the picture is
    // judged (`judgeSelfMoving`) — judged still, it becomes a photo rather than sliding around.
    scenes[2].selfMoving = false;
    settleVideoKind(scenes[2]);
    expect(scenes[2].stillImage).toBe(true);
    expect(scenes[2].objectMotion).toBeUndefined();
    expect(scenes[3].stillImage).toBe(true);
    expect(scenes.map(s => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("never hands over before the host has said their own name", () => {
    const host = scene(1, HANK, { hostPresent: true, hostIntro: true });
    const { scenes: withAfter } = applyShotPlan(
      [host, after],
      [{ scene: 1, hostUntil: "I'm", shots: [{ from: "Hank", show: "x" }] }],
      { hostName: "Hank Hardwood" }
    );
    expect(withAfter.slice(0, -1)).toEqual([host]);
  });

  it("cuts a b-roll beat on the words that name each thing", () => {
    const b = scene(
      4,
      "Folks will tell you Japanese woodworking takes a master's hands and a wall full of fancy saws."
    );
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 4,
          shots: [
            { from: "Folks will", show: "weathered hands holding a chisel", motion: "hands" },
            { from: "and a wall", show: "a wall of Japanese saws" },
          ],
        },
      ]
    );
    expect(scenes.map(s => s.scriptText)).toEqual([
      "Folks will tell you Japanese woodworking takes a master's hands",
      "and a wall full of fancy saws.",
    ]);
    // Hands are the host at work — in a PHOTO: no video ever shows hands (2026-09-30).
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].stillImage).toBe(true);
  });

  it("drops a shot whose words are not in the beat, keeping the text whole", () => {
    const b = scene(2, "The panel took six hours and sold for ninety dollars.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 2,
          shots: [
            { from: "The panel", show: "a lattice panel" },
            { from: "a price tag", show: "nope" },
            { from: "and sold", show: "the panel at a market table" },
          ],
        },
      ]
    );
    expect(scenes.map(s => s.scriptText).join(" ")).toBe(b.scriptText);
    expect(scenes).toHaveLength(2);
  });

  it("leaves the CTA and the cover alone, and cuts the hook on either angle", () => {
    expect(shotListEligible(scene(1, "grab your phone and scan it now", { cta: true }))).toBe(false);
    expect(shotListEligible(scene(1, "the book is called this", { coverHero: true }))).toBe(false);
    const hook = scene(1, "out of ten projects the one", { hostOpener: true, hostPresent: true });
    // A one-angle hook starts on the host and may hand over…
    expect(shotListEligible(hook, scene(2, "next line"))).toBe(true);
    // …and so may the first angle of a two-angle open (kept whole it held a 14 s line).
    expect(shotListEligible(hook, scene(2, "second angle", { hostOpener: true }))).toBe(true);
    expect(shotListEligible(scene(1, "a plain line of words here"))).toBe(true);
  });
});

describe("settleShots", () => {
  const cut = (wps: number) => {
    const host = scene(1, HANK, { hostPresent: true, hostIntro: true });
    const applied = applyShotPlan(
      [host, after],
      [
        {
          scene: 1,
          hostUntil: "in a garage with",
          shots: [
            { from: "a saw", show: "a hand saw", list: true },
            { from: "a drill", show: "a drill", list: true },
            { from: "and a stack", show: "sandpaper", list: true },
          ],
        },
      ],
      { hostName: "Hank Hardwood" }
    );
    const settled = settleShots(applied.scenes, applied.originals, byWords(wps));
    return { host, applied, settled: { ...settled, scenes: settled.scenes.slice(0, -1) } };
  };

  it("keeps quick list cuts at a normal pace", () => {
    const { settled } = cut(3.8); // "a saw," = 0.53 s — quick, but long enough to keep (held to 1 s)
    expect(settled.changed).toBe(false);
    expect(settled.scenes).toHaveLength(4);
  });

  it("folds list items too short to read into their neighbour", () => {
    // "a saw," squeezed to a blink (0.2 s) while everything else reads at a normal pace.
    const { applied } = cut(4);
    const blink = (x: StoryboardScene) =>
      x.listCut && (x.scriptText ?? "").startsWith("a saw") ? 0.2 : byWords(4)(x);
    const raw = settleShots(applied.scenes, applied.originals, blink);
    const settled = { ...raw, scenes: raw.scenes.slice(0, -1) };
    expect(settled.changed).toBe(true);
    expect(settled.scenes.length).toBeLessThan(4);
    expect(settled.scenes.map(s => s.scriptText).join(" ")).toBe(HANK);
    // Only a blink folds, and it takes its neighbour's picture — never one shot of both (the
    // operator rejected "a saw, together with a drill").
    expect(settled.scenes.every(s => !/together with/.test(s.showSubject ?? ""))).toBe(true);
  });

  it("gives the whole line back to the host when the host part is too short", () => {
    const host = scene(1, "Right, so a saw, a drill, and some sandpaper.", { hostPresent: true });
    const applied = applyShotPlan(
      [host, after],
      [
        {
          scene: 1,
          hostUntil: "Right, so",
          shots: [
            { from: "a saw", show: "saw", list: true },
            { from: "a drill", show: "drill", list: true },
          ],
        },
      ]
    );
    const settled = settleShots(applied.scenes, applied.originals, byWords(2.5));
    expect(settled.scenes.slice(0, -1)).toEqual([host]);
    expect(HOST_HANDOFF_MIN_SEC).toBeGreaterThan(2 / 2.5);
  });

  it("hands a short hook over one picture later instead of keeping the whole line", () => {
    const text =
      "Out of ten quilts I have made, the cheapest fabric won, and the fancy one I loved most lost money on every single hour.";
    const hook = scene(1, text, { hostPresent: true, hostOpener: true });
    const applied = applyShotPlan(
      [hook, after],
      [
        {
          scene: 1,
          hostUntil: "I have made,",
          shots: [
            { from: "the cheapest", show: "a folded stack of cheap cotton fabric" },
            { from: "and the fancy", show: "an ornate quilt on a bed" },
            { from: "lost money", show: "a few coins on a sewing table" },
          ],
        },
      ]
    );
    // 7 words at 4 w/s = 1.75 s: under the hook's 2 s + margin; the next shot is too short to lend
    // words and still be a shot, so the host keeps all of it.
    const settled = settleShots(applied.scenes, applied.originals, byWords(4));
    const [host, ...rest] = settled.scenes.slice(0, -1);
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toBe("Out of ten quilts I have made, the cheapest fabric won,");
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every(s => !s.hostPresent)).toBe(true);
    expect(settled.scenes.slice(0, -1).map(s => s.scriptText).join(" ")).toBe(text);
  });

  it("splits a picture that would linger, at a clause break", () => {
    const long = scene(
      3,
      "Japanese carpenters are famous for joints that lock wood together without a single nail, and the shelf uses the simplest one of all, a plain half lap."
    );
    const applied = applyShotPlan(
      [long],
      [{ scene: 3, shots: [{ from: "Japanese carpenters", show: "interlocking wooden joints" }] }]
    );
    const settled = settleShots(applied.scenes, applied.originals, byWords(2.5)); // 11.2 s
    expect(settled.scenes.length).toBeGreaterThan(1);
    for (const s of settled.scenes)
      expect(byWords(2.5)(s)).toBeLessThanOrEqual(MAX_PICTURE_SEC + 1);
    expect(settled.scenes.map(s => s.scriptText).join(" ")).toBe(long.scriptText);
  });

  it("turns a moving shot too short for a video render into a still", () => {
    const b = scene(5, "Smoke from the chimney, then the fire burning low behind the stove's glass all evening long.");
    const applied = applyShotPlan(
      [b],
      [
        {
          scene: 5,
          shots: [
            { from: "Smoke from", show: "smoke rising from the chimney", motion: "object" },
            { from: "then the", show: "the fire burning low behind the stove's glass door", motion: "object" },
          ],
        },
      ]
    );
    expect(applied.scenes[0].objectMotion).toBe(true);
    const settled = settleShots(applied.scenes, applied.originals, byWords(2.5));
    const first = settled.scenes[0]; // 4 words = 1.6 s — a shot, but too short for a video render
    expect(first.stillImage).toBe(true);
    expect(first.objectMotion).toBeUndefined();
    expect(settled.scenes[1].stillImage).toBe(false);
    expect(settled.scenes[1].objectMotion).toBe(true);
  });
});

describe("host candidates", () => {
  it("keeps only the first piece of a storyboard host beat as a place the host can come in", () => {
    const b = scene(
      2,
      "But the one I was proudest of, a lattice panel that ate 6 hours of my Saturday, finished dead last.",
      { hostCandidate: true }
    );
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 2,
          shots: [
            { from: "But the one", show: "a lattice panel" },
            { from: "that ate", show: "hands fitting strips", motion: "hands" },
            { from: "finished dead last", show: "the panel on a market table" },
          ],
        },
      ]
    );
    expect(scenes.map(s => !!s.hostCandidate)).toEqual([true, false, false]);
  });
});

describe("the closing line", () => {
  it("never hands the film's last host line over to a picture", () => {
    const last = scene(9, "Keep that hook moving, and I'll see you back here at the kitchen table.", { hostPresent: true });
    expect(shotListEligible(last, undefined)).toBe(false);
    expect(shotListEligible(last, scene(10, "more"))).toBe(true);
  });
});

describe("hyphenated words", () => {
  it("never cuts inside a hyphenated word", () => {
    const host = scene(3, "But the one I was proudest of, a nine-patch crib quilt that took three evenings.", { hostPresent: true });
    const { scenes } = applyShotPlan(
      [host, after],
      [{ scene: 3, hostUntil: "proudest of, a nine", shots: [{ from: "patch crib quilt", show: "a nine-patch crib quilt" }] }]
    );
    // "a nine" is not a whole word here, so the hand-off is refused rather than landing mid-word.
    expect(scenes[0].scriptText).toBe(host.scriptText);
    const fresh = { ...host, index: 3 };
    const ok = applyShotPlan(
      [fresh, { ...after, index: 4 }],
      [{ scene: 3, hostUntil: "proudest of,", shots: [{ from: "a nine-patch", show: "a nine-patch crib quilt" }] }]
    ).scenes;
    expect(ok[1].scriptText).toBe("a nine-patch crib quilt that took three evenings.");
  });
});

describe("the host says a few words before handing over", () => {
  it("moves a too-early hand-off to the next shot instead of flashing the host", () => {
    const intro = scene(
      11,
      "I'm Granny Mae, and this one's for anybody sitting at a kitchen table with a hook, a skein of yarn, and a stack of stitch books.",
      { hostPresent: true, hostIntro: true }
    );
    const { scenes } = applyShotPlan(
      [intro, { ...after, index: 12 }],
      [
        {
          scene: 11,
          hostUntil: "I'm Granny Mae,",
          shots: [
            { from: "and this one's", show: "a kitchen table" },
            { from: "a hook", show: "a crochet hook", list: true },
            { from: "a skein", show: "a skein of yarn", list: true },
            { from: "and a stack", show: "stitch books", list: true },
          ],
        },
      ],
      { hostName: "Granny Mae" }
    );
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].scriptText).toBe(
      "I'm Granny Mae, and this one's for anybody sitting at a kitchen table with"
    );
    expect(scenes[1].scriptText).toBe("a hook,");
  });
});

describe("last guards", () => {
  it("folds a list item the pause-snap squeezed to a blink", () => {
    const pieces = [
      scene(1, "Materials ran about $8 for the batting,", { wordCut: true, listCut: true, shotGroup: 80, audioDuration: 2.8, showSubject: "batting" }),
      scene(2, "backing,", { wordCut: true, listCut: true, shotGroup: 80, audioDuration: 0.56, showSubject: "backing" }),
      scene(3, "and thread", { wordCut: true, listCut: true, shotGroup: 80, audioDuration: 0.14, showSubject: "thread" }),
      scene(4, "since the strips came out of the bin.", { wordCut: true, shotGroup: 80, audioDuration: 3.1 }),
    ];
    const r = foldSnappedFlashes(pieces, s => s.audioDuration ?? 0);
    expect(r.changed).toBe(true);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "Materials ran about $8 for the batting,",
      "backing, and thread",
      "since the strips came out of the bin.",
    ]);
  });

  it("folds an ordinary picture the snap pushed under its floor, keeps a quick list item", () => {
    const pieces = [
      scene(1, "But once you spread twelve hours across it,", { hostPresent: true, wordCut: true, shotGroup: 16, audioDuration: 3.9 }),
      scene(2, "that's about a dollar and thirty cents", { wordCut: true, shotGroup: 16, audioDuration: 0.99 }),
      scene(3, "for every hour I sat and stitched,", { wordCut: true, shotGroup: 16, audioDuration: 2.7 }),
      scene(4, "a saw,", { wordCut: true, listCut: true, shotGroup: 17, audioDuration: 0.5 }),
    ];
    const r = foldSnappedFlashes(pieces, s => s.audioDuration ?? 0);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "But once you spread twelve hours across it,",
      "that's about a dollar and thirty cents for every hour I sat and stitched,",
      "a saw,",
    ]);
    expect(r.scenes[0].hostPresent).toBe(true);
  });

  it("splits a long picture the shot list never planned", () => {
    const long = scene(
      411,
      "But the jump from number two to number one is the biggest jump on this whole list, and it is not even close, because one of them sold out."
    );
    const r = settleShots([long, { ...after, index: 412 }], new Map(), byWords(2.5)); // ~11 s
    expect(r.changed).toBe(true);
    expect(r.scenes.length).toBeGreaterThan(2);
  });
});

describe("wordsAfterName", () => {
  it("counts only what the host says after their own name", async () => {
    const { wordsAfterName } = await import("./shotList");
    expect(wordsAfterName("I'm Hank Hardwood, and this one's for anybody", "Hank Hardwood")).toBe(5);
    expect(wordsAfterName("Out of 10 crochet projects", "Granny Mae")).toBe(5);
  });
});

describe("a short host part borrows only the words it needs", () => {
  it("takes two words from the next shot and leaves it its picture", () => {
    const text =
      "Out of ten quilts I have made, the cheapest cotton fabric from the bargain bin won easily, and the fancy one lost.";
    const hook = scene(1, text, { hostPresent: true, hostOpener: true });
    const applied = applyShotPlan(
      [hook, after],
      [
        {
          scene: 1,
          hostUntil: "I have made,",
          shots: [
            { from: "the cheapest", show: "a folded stack of cheap cotton fabric" },
            { from: "and the fancy", show: "an ornate quilt on a bed" },
          ],
        },
      ]
    );
    // 7 words at 4 w/s = 1.75 s: 2 more words reach the 2 s + margin minimum.
    const settled = settleShots(applied.scenes, applied.originals, byWords(4));
    const [host, pic] = settled.scenes;
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toBe("Out of ten quilts I have made, the cheapest");
    expect(pic.hostPresent).toBeFalsy();
    expect(pic.scriptText?.startsWith("cotton fabric")).toBe(true);
    expect(pic.showSubject).toBe("a folded stack of cheap cotton fabric");
    expect(settled.scenes.slice(0, -1).map(s => s.scriptText).join(" ")).toBe(text);
  });
});

describe("pictures long enough to see (2026-09-27)", () => {
  it("keeps one picture per list item — \"a saw\", a slight pause, then \"a drill\"", () => {
    // The operator: each thing on screen as it is named, held to 1 s by a short pause after the
    // word — never joined into one shot of both. Only a blink the snap squeezed (< 0.25 s) joins.
    // A list item keeps its own picture at the pace it is spoken; only a blink joins.
    expect(LIST_SHOT_MIN_SEC).toBe(0.25);
    const pieces = [
      scene(1, "a saw,", { wordCut: true, listCut: true, shotGroup: 5, audioDuration: 0.54, showSubject: "a saw" }),
      scene(2, "a drill,", { wordCut: true, listCut: true, shotGroup: 5, audioDuration: 0.42, showSubject: "a drill" }),
      scene(3, "and a stack of sandpaper.", { wordCut: true, listCut: true, shotGroup: 5, audioDuration: 1.1 }),
    ];
    const r = foldSnappedFlashes(pieces, s => s.audioDuration ?? 0);
    expect(r.changed).toBe(false);
    expect(r.scenes.map(s => s.scriptText)).toEqual(["a saw,", "a drill,", "and a stack of sandpaper."]);
    // And the hook never joins a list either.
    const hook = joinHookPictures(pieces, s => s.audioDuration ?? 0);
    expect(hook.changed).toBe(false);
  });

  it("joins the hook's quick pictures, never across the host, and stops at the introduction", () => {
    // Mae's job 180: five pictures in the first ten seconds, 1.6-2.3 s each.
    const pieces = [
      scene(1, "Out of 10 crochet projects", { hostPresent: true, wordCut: true, audioDuration: 2.4 }),
      scene(2, "I've made from the cheapest yarn", { wordCut: true, shotGroup: 1, audioDuration: 1.6 }),
      scene(3, "the craft store sells,", { wordCut: true, shotGroup: 1, audioDuration: 1.6 }),
      scene(4, "the one that paid me best", { wordCut: true, shotGroup: 1, audioDuration: 2.0 }),
      scene(5, "came out of a bag of scraps.", { wordCut: true, shotGroup: 1, audioDuration: 2.1 }),
      scene(6, "I'm Granny Mae,", { hostPresent: true, hostIntro: true, audioDuration: 4 }),
      scene(7, "a hook,", { wordCut: true, listCut: true, audioDuration: 0.6 }),
    ];
    const r = joinHookPictures(pieces, s => s.audioDuration ?? 0);
    expect(r.changed).toBe(true);
    const texts = r.scenes.map(s => s.scriptText);
    expect(texts).toEqual([
      "Out of 10 crochet projects",
      "I've made from the cheapest yarn the craft store sells,",
      "the one that paid me best came out of a bag of scraps.",
      "I'm Granny Mae,",
      "a hook,", // after the introduction: left to the list rule
    ]);
    expect(r.scenes[0].hostPresent).toBe(true);
    // Nothing joined grows past the longest picture allowed.
    expect(1.6 + 1.6).toBeGreaterThanOrEqual(HOOK_PICTURE_MIN_SEC);
    expect(2.0 + 2.1).toBeLessThanOrEqual(MAX_PICTURE_SEC);
  });
});

describe("pictures follow the context (2026-09-28)", () => {
  it("lets a picture stay 7 / 10 / 12 / 14 s by quarter of the film", () => {
    // The quarter rhythm (7 / 10 / 12 / 14) with the same-topic allowance (×1.5) on top.
    expect(pictureMaxSecAt(0, 400)).toBeCloseTo(10.5);
    expect(pictureMaxSecAt(99, 400)).toBeCloseTo(10.5);
    expect(pictureMaxSecAt(100, 400)).toBeCloseTo(15);
    expect(pictureMaxSecAt(250, 400)).toBeCloseTo(18);
    expect(pictureMaxSecAt(399, 400)).toBeCloseTo(21);
    expect(pictureMaxSecAt(10, 0)).toBeCloseTo(10.5); // unknown length: the tightest
  });

  it("plays pictures of the same context as one, within the limit, keeping the first look", () => {
    const pieces = [
      scene(1, "a stack of feed sacks", { wordCut: true, audioDuration: 1.5, showSubject: "feed sacks by the burn barrel" }),
      scene(2, "my husband set aside for the burn barrel.", { wordCut: true, sameShot: true, audioDuration: 2.4, showSubject: "the burn barrel" }),
      scene(3, "But the one I was proudest of,", { wordCut: true, audioDuration: 2, showSubject: "a crib quilt" }),
      scene(4, "a nine-patch crib quilt that took three evenings,", { wordCut: true, sameShot: true, audioDuration: 6, showSubject: "the crib quilt" }),
    ];
    const r = joinSameContext(pieces, s => s.audioDuration ?? 0, () => 7);
    expect(r.changed).toBe(true);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "a stack of feed sacks my husband set aside for the burn barrel.",
      "But the one I was proudest of,",
      "a nine-patch crib quilt that took three evenings,", // 2 + 6 > 7: stays apart
    ]);
    expect(r.scenes[0].showSubject).toBe("feed sacks by the burn barrel");
    // A list item and a host take never join.
    const guarded = joinSameContext(
      [
        scene(1, "a needle,", { wordCut: true, listCut: true, audioDuration: 0.6 }),
        scene(2, "a spool of thread,", { wordCut: true, listCut: true, sameShot: true, audioDuration: 0.7 }),
        scene(3, "I'm Hannah,", { hostPresent: true, audioDuration: 2 }),
        scene(4, "and this one's for you", { wordCut: true, sameShot: true, audioDuration: 2 }),
      ],
      s => s.audioDuration ?? 0,
      () => 7
    );
    expect(guarded.changed).toBe(false);
  });
});

describe("one picture while the topic stays (2026-09-28, Hannah 0:02-0:10)", () => {
  it("joins two pictures of the same subject even when unmarked, within the soft limit", () => {
    const sacks = "feed sacks stacked flat in the yard near the rusted burn barrel";
    const r = joinSameContext(
      [
        scene(1, "cloth that was already sitting in our house, the one that paid me best for my", { wordCut: true, audioDuration: 3.3, showSubject: sacks }),
        scene(2, "time came from a stack of feed sacks my husband set aside for the burn barrel.", { wordCut: true, audioDuration: 4.7, showSubject: sacks }),
      ],
      s => s.audioDuration ?? 0,
      () => pictureMaxSecAt(0, 180)
    );
    expect(r.scenes).toHaveLength(1); // 8.0 s: within 7 × 1.25
  });

  it("splits one topic only past the soft limit, into clearly different views", () => {
    const long = scene(1, "one two three four five six seven eight nine ten eleven twelve thirteen fourteen", {
      wordCut: true,
      showSubject: "a nine-patch crib quilt",
      visualPrompt: "a nine-patch crib quilt on the table",
    });
    const parts = splitPicture(long, 2);
    expect(parts).toHaveLength(2);
    expect(parts[1].showSubject).not.toBe(parts[0].showSubject);
    expect(parts[1].showSubject).toMatch(/close-up|further back|other side/);
    // …so the same-subject join never folds them back together.
    const r = joinSameContext(parts.map((p, k) => ({ ...p, audioDuration: 3, index: k + 1 })), s => s.audioDuration ?? 0, () => 20);
    expect(r.scenes).toHaveLength(2);
  });
});

describe("spotting a line that is just a spoken list", () => {
  it("finds lists by their shape, on any channel's script", async () => {
    const { spokenListItems } = await import("./shotList");
    expect(spokenListItems("A bin in the hall closet, a bag in the garage, maybe a box under the bed.")).toEqual([
      "A bin in the hall closet",
      "a bag in the garage",
      "a box under the bed",
    ]);
    expect(spokenListItems("a saw, a drill, and a stack of sandpaper.")).toHaveLength(3);
    expect(spokenListItems("A hook, a skein of yarn, and a pair of scissors.")).toHaveLength(3);
  });
  it("leaves ordinary sentences and part-lists alone", async () => {
    const { spokenListItems } = await import("./shotList");
    expect(spokenListItems("Somewhere in your house there's probably a kit.")).toBeNull();
    expect(spokenListItems("I'm sitting at a kitchen table with a hook, a skein of yarn, and scissors.")).toBeNull();
    expect(spokenListItems("It sells for $90 to $130, but once you take out the lumber, that's about $14.")).toBeNull();
    expect(spokenListItems("A bin, a bag. Then a box, a tin.")).toBeNull(); // two sentences
    expect(spokenListItems("A bin and a bag.")).toBeNull(); // only two things
  });
});

describe("same topic, same picture", () => {
  // Mae's scarf (job 219, 12:00-12:23): three lines about one scarf, then the host.
  const pic = (i: number, text: string, show: string, sec: number, extra: Partial<StoryboardScene> = {}) =>
    scene(i, text, { wordCut: true, showSubject: show, audioDuration: sec, ...extra });
  const film = () => [
    pic(1, "Number five. The simple crochet scarf.", "a striped scarf draped over a chair back", 5),
    pic(2, "The yarn does all the color-changing for you", "a striped scarf draped over a chair back", 3),
    pic(3, "while you do nothing but keep hooking.", "hands crocheting the striped scarf", 3),
    scene(4, "One ball of that yarn makes one scarf.", { hostPresent: true, audioDuration: 4 }),
    pic(5, "A saw, a drill,", "a saw", 1, { listCut: true }),
    pic(6, "and sandpaper.", "sandpaper", 1, { listCut: true }),
    pic(7, "Worn bedsheets were the start.", "worn bedsheets folded in a stack", 3),
    pic(8, "And a spool of thread.", "a spool of thread", 3),
  ];

  it("only looks at runs of pictures — never the host, a list item or a CTA", () => {
    expect(contextRuns(film())).toEqual([[0, 1, 2], [6, 7]]);
  });

  it("keeps only real groups: consecutive, inside one run, not overlapping", () => {
    const runs = contextRuns(film());
    const text = JSON.stringify({
      groups: [
        { ids: [0, 1, 2], show: "hands crocheting the striped scarf, the finished part draped on a chair" },
        { ids: [2, 6], show: "crosses the host" },
        { ids: [6, 8], show: "not consecutive" },
        { ids: [1, 2], show: "overlaps the first" },
        { ids: [7], show: "one alone" },
      ],
    });
    expect(parseContextGroups(text, runs)).toEqual([
      { ids: [0, 1, 2], show: "hands crocheting the striped scarf, the finished part draped on a chair" },
    ]);
    expect(parseContextGroups("not json", runs)).toEqual([]);
  });

  it("makes one topic one picture, within the limit, and keeps the host at work in it", () => {
    const scenes = film();
    const marked = applyContextGroups(scenes, [{ ids: [0, 1, 2], show: "the striped scarf on a chair" }]);
    expect(marked).toBe(2);
    // The group had hands in it, so the picture keeps a person even though the words dropped them.
    expect(scenes[0].showSubject).toMatch(/host's hands/);
    const r = joinSameContext(scenes, s => s.audioDuration ?? 0, () => 12);
    expect(r.scenes.map(s => s.showSubject ?? "(host)")).toEqual([
      "the striped scarf on a chair, with the host's hands at work on it",
      "(host)",
      "a saw",
      "sandpaper",
      "worn bedsheets folded in a stack",
      "a spool of thread",
    ]);
    expect(r.scenes[0].humanPresent).toBe(true);
    expect(r.scenes[0].scriptText).toContain("keep hooking");
  });

  it("past the limit, the next line becomes its own picture again", () => {
    const scenes = film();
    applyContextGroups(scenes, [{ ids: [0, 1, 2], show: "the striped scarf on a chair" }]);
    const r = joinSameContext(scenes, s => s.audioDuration ?? 0, () => 9);
    // 5 + 3 fits in 9, the third line (3 s more) does not: it gets a DIFFERENT view of the scarf,
    // never a near-copy of the picture before.
    expect(r.scenes[0].scriptText).toContain("color-changing");
    // The restart shows the TOPIC from another view, not a line of its own.
    expect(r.scenes[1].showSubject).toBe(
      "the striped scarf on a chair, with the host's hands at work on it, a close-up of one detail of it filling the frame"
    );
    expect(r.scenes[1].humanPresent).toBe(true);
    // Run again (the pipeline re-runs the join after re-timing): the view is not added twice.
    const again = joinSameContext(r.scenes, () => 3, () => 5);
    expect(again.scenes[1].showSubject).toBe(r.scenes[1].showSubject);
  });
});

describe("same topic past the limit", () => {
  it("rotates the views — close-up, further back, other side — instead of repeating one", () => {
    const one = (i: number) =>
      scene(i, `Line ${i} about the scarf.`, {
        wordCut: true,
        showSubject: `scarf picture ${i}`,
        audioDuration: 4,
        sameShot: i > 1 ? true : undefined,
      });
    const r = joinSameContext([1, 2, 3, 4, 5, 6, 7].map(one), () => 4, () => 8.5);
    expect(r.scenes.map(s => s.showSubject)).toEqual([
      "scarf picture 1",
      "scarf picture 3, a close-up of one detail of it filling the frame",
      "scarf picture 5, seen from much further back with the whole place around it",
      "scarf picture 7, seen from the other side",
    ]);
  });
});

describe("one topic, one shot — a video or a photo", () => {
  // The dishcloth script the operator approved (2026-09-28).
  const pic = (i: number, text: string, show: string, sec: number, moving?: "hands") =>
    scene(i, text, {
      wordCut: true,
      showSubject: show,
      audioDuration: sec,
      stillImage: moving ? false : true,
      humanPresent: moving === "hands" ? true : undefined,
      objectMotion: moving && moving !== "hands" ? true : undefined,
      cameraMove: moving === "camera" ? true : undefined,
    });
  const dishcloth = () => [
    scene(0, "Number three. The crochet dishcloth.", { hostPresent: true, audioDuration: 3 }),
    pic(1, "A dishcloth is just a small square of cotton.", "a dishcloth", 3),
    pic(2, "Cotton is the only yarn for it.", "a ball of cotton yarn", 5),
    pic(3, "I work mine in a simple waffle stitch.", "hands crocheting a dishcloth", 5, "hands"),
    pic(4, "One takes me about forty minutes.", "a finished dishcloth", 2),
    pic(5, "At the market I tie three together.", "dishcloths tied with ribbon", 5),
    pic(6, "They sell for eight dollars a bundle.", "a market table", 3),
  ];
  const groups = [
    { ids: [1, 2], show: "a cotton dishcloth beside a ball of cotton yarn" },
    { ids: [3, 4], show: "hands crocheting a waffle-stitch dishcloth" },
    { ids: [5, 6], show: "three dishcloths tied with ribbon and soap on a market table" },
  ];
  const kind = (s: StoryboardScene) =>
    s.hostPresent ? "host" : !s.stillImage && (s.humanPresent || s.objectMotion) ? "video" : "photo";

  it("shows each topic as ONE shot — and hands at work are a PHOTO, never a video", () => {
    const scenes = dishcloth();
    applyContextGroups(scenes, groups);
    const r = joinSameContext(scenes, s => s.audioDuration ?? 0, () => 10.5);
    expect(r.scenes.map(s => `${kind(s)}: ${s.showSubject ?? "(host)"}`)).toEqual([
      "host: (host)",
      "photo: a cotton dishcloth beside a ball of cotton yarn",
      "photo: hands crocheting a waffle-stitch dishcloth",
      "photo: three dishcloths tied with ribbon and soap on a market table",
    ]);
    // The hands stay in the photo (the host at work).
    expect(r.scenes[2].humanPresent).toBe(true);
  });

  it("a topic with a big moving thing is ONE video, and never runs past what the model renders", () => {
    const long = [
      pic(1, "The stove keeps the whole house warm.", "fire burning in the wood stove", 9, "object"),
      pic(2, "All winter long, day and night.", "fire burning in the wood stove", 9, "object"),
    ];
    applyContextGroups(long, [{ ids: [0, 1], show: "fire burning behind the wood stove's glass door" }]);
    // The quarter would allow 21 s; a video stops at 15 and the topic continues from another view.
    const r = joinSameContext(long, s => s.audioDuration ?? 0, () => 21);
    expect(MOVING_PICTURE_MAX_SEC).toBe(15);
    expect(r.scenes.map(kind)).toEqual(["video", "video"]);
    expect(r.scenes[1].showSubject).toMatch(/close-up/);
  });

  it("does not set a thing moving on its own — a topic with no hands and no self-moving thing stays a photo", () => {
    const scenes = [
      pic(1, "The quilt top.", "a quilt top", 4),
      scene(2, "Laid out on the bed.", {
        wordCut: true,
        showSubject: "a quilt on a bed",
        audioDuration: 4,
        stillImage: false,
        objectMotion: true,
      }),
    ];
    // Judged: nothing in a quilt on a bed moves by itself.
    scenes.forEach(s => (s.selfMoving = false));
    applyContextGroups(scenes, [{ ids: [0, 1], show: "a quilt laid out on a bed" }]);
    scenes.forEach(s => settleVideoKind(s));
    expect(scenes.map(kind)).toEqual(["photo", "photo"]);
  });
});

describe("withView", () => {
  it("adds a view without a stray full stop before it", () => {
    expect(withView("Hands cutting a notch on the workbench.", ", seen from the other side")).toBe(
      "Hands cutting a notch on the workbench, seen from the other side"
    );
    expect(withView("a quilt top ", ", a close-up")).toBe("a quilt top, a close-up");
  });
});

describe("a list's last item runs on into the same picture", () => {
  it("joins the identical picture right after a list into the list's last item", () => {
    const item = (i: number, show: string, sec: number, list = true) =>
      scene(i, `line ${i}`, { wordCut: true, showSubject: show, audioDuration: sec, listCut: list || undefined });
    // Dale's 3-min test (job 230, 3:21-3:30).
    const scenes = [
      item(1, "coasters on the market table", 1.6),
      item(2, "an engraved cutting board on the workbench", 1.8),
      item(3, "the furniture piece waiting near the edge of the driveway", 1.8),
      item(4, "the furniture piece waiting near the edge of the driveway", 3.9, false),
    ];
    const r = joinSameContext(scenes, s => s.audioDuration ?? 0, () => 10);
    expect(r.scenes.map(s => s.showSubject)).toEqual([
      "coasters on the market table",
      "an engraved cutting board on the workbench",
      "the furniture piece waiting near the edge of the driveway",
    ]);
    // Two different list items never join.
    expect(r.scenes).toHaveLength(3);
  });
});

describe("a tool biting into material is a photo, never a video", () => {
  it("keeps drilling, sawing, screwing, cutting and carving still — on any channel", async () => {
    const { safeMotion, contactToolWork } = await import("./shotList");
    // Norbert's 3-min test (job 236, 2:19): the drill never went in.
    expect(safeMotion("The host's hands drilling a pilot hole into the pine door frame", "hands")).toBe("none");
    expect(safeMotion("hands sawing a pine board on the workbench", "hands")).toBe("none");
    expect(safeMotion("hands driving a screw into the strike plate", "hands")).toBe("none");
    expect(safeMotion("hands cutting fabric squares with a rotary cutter", "hands")).toBe("none");
    expect(safeMotion("hands carving a spoon from green wood", "hands")).toBe("none");
    // Since 2026-09-30 no hand work moves at all — hands are always a photo.
    expect(safeMotion("hands crocheting a granny square", "hands")).toBe("none");
    expect(safeMotion("hands sanding the edge of a board", "hands")).toBe("none");
    expect(contactToolWork("a cutting board on the counter")).toBe(false);
    // Holding a tool, or a tool lying there, is not the work.
    expect(contactToolWork("weathered hands holding a chisel")).toBe(false);
    expect(contactToolWork("a cordless drill resting on the bench")).toBe(false);
    expect(contactToolWork("hands pressing a ruler on the green cutting mat")).toBe(false);
  });
});

describe("the shot list's own contact judgment makes a photo — any craft, any wording", () => {
  it("a shot the planner marks contact is a photo even when it asked for moving hands", () => {
    const b = scene(7, "Then I punch a row of holes along the strap and stitch it shut.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 7,
          shots: [
            // Leatherwork: no word list names "punch", the planner's judgment does.
            { from: "Then I", show: "hands tapping a leather punch along a strap", motion: "hands", contact: true },
            { from: "and stitch", show: "hands saddle-stitching the strap", motion: "hands" },
          ],
        },
      ]
    );
    expect(scenes[0].stillImage).toBe(true);
    expect(scenes[0].toolContact).toBe(true);
    // Stitching is gentle, but it is hands: a photo too (2026-09-30).
    expect(scenes[1].stillImage).toBe(true);
    expect(scenes[1].toolContact).toBeUndefined();
  });

  it("a topic holding a contact shot is a photo, every view of it", () => {
    const pic = (i: number, show: string, extra: Partial<StoryboardScene> = {}) =>
      scene(i, `line ${i}`, { wordCut: true, showSubject: show, audioDuration: 4, ...extra });
    const scenes = [
      pic(1, "hands welding a steel bracket", { stillImage: false, humanPresent: true, toolContact: true }),
      pic(2, "hands holding the welded bracket up", { stillImage: false, humanPresent: true }),
    ];
    applyContextGroups(scenes, [{ ids: [0, 1], show: "hands welding a steel bracket" }]);
    expect(scenes.map(s => s.stillImage)).toEqual([true, true]);
  });
});

describe("the shot list's own held judgment puts hands on the thing — any wording", () => {
  it("a shot the planner marks held has a person in it, even as a still", () => {
    const b = scene(9, "Aim the dryer at the roots first, then the ends.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 9,
          shots: [
            // No "held"/"holding" in the words — the planner's judgment decides.
            { from: "Aim the", show: "a hair dryer aimed at the roots of the hair", motion: "none", held: true },
            { from: "then the", show: "the ends of the hair, smooth and dry" },
          ],
        },
      ]
    );
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].stillImage).toBe(true);
    // Hair is always on a person (Diane's job 309): "the ends of the hair" is the host's hair.
    expect(scenes[1].humanPresent).toBe(true);
  });
});

describe("a video is only ever of something that moves by itself — never hands (2026-09-30)", () => {
  it("never moves hands or a person, and has no camera moves", async () => {
    const { videoKind } = await import("./shotList");
    expect(videoKind("the dented coffee tin packed tight with squares", "hands")).toBe("none");
    expect(videoKind("hands sewing fabric scraps into a strip", "object")).toBe("none");
    expect(videoKind("the host threading the machine", "object")).toBe("none");
    // No camera-move kind, and a thing JUDGED not to move by itself is a photo, whatever was asked.
    expect(videoKind("the wood stove in the corner of the living room", "camera", { selfMoving: false })).toBe("none");
    expect(videoKind("a cordless drill on the workbench", "object", { selfMoving: false })).toBe("none");
  });
  it("moves whatever moves by itself in the moment the words describe — small things may sit still in it", async () => {
    const { videoKind } = await import("./shotList");
    // Hank's opening (the operator, 2026-09-30): the incense holder smoking beside the can of scraps.
    expect(
      videoKind("the charred cedar incense holder with a lit stick, smoke curling up, the coffee can of scraps beside it", "object")
    ).toBe("object");
    expect(videoKind("steam rising off the kettle on the stove", "object")).toBe("object");
    expect(videoKind("a pickup truck driving past the farmhouse", "object")).toBe("object");
    expect(videoKind("the sliding glass door opening onto the deck", "object")).toBe("object");
    expect(videoKind("fire burning in the wood stove", "camera")).toBe("object");
  });
});

describe("a line naming something new keeps its own picture (Hank's job 258)", () => {
  it("cuts a context group at a picture of something the group's picture does not show", async () => {
    const { parseContextGroups, namesSomethingElse } = await import("./shotList");
    const group = "hands cutting a notch halfway through a pine strip, the kumiko lattice panel nearby";
    expect(namesSomethingElse("a Japanese sliding door with a kumiko lattice", group)).toBe(true);
    expect(namesSomethingElse("the kumiko lattice panel on the bench", group)).toBe(false);
    const shows = [
      "the kumiko lattice panel on the bench",
      "a Japanese sliding door with a kumiko lattice",
      "hands cutting a notch in a pine strip",
      "the kumiko lattice panel, seen closer",
    ];
    const groups = parseContextGroups(
      JSON.stringify({ groups: [{ ids: [0, 1, 2, 3], show: group }] }),
      [[0, 1, 2, 3]],
      i => shows[i]
    );
    // The sliding door keeps its own picture; the pictures after it still share one.
    expect(groups).toEqual([{ ids: [2, 3], show: group }]);
  });
});

describe("the key thing a picture names", () => {
  it("finds it in a split screen's or the QR background's own words", async () => {
    const { keyThingIn } = await import("./shotList");
    const things = [
      { name: "charred cedar incense holder", look: "black charred cedar block", main: true as const },
      { name: "kumiko lattice panel", look: "a foot-square pine grid" },
      { name: "coffee can", look: "a dented coffee can of burnt scraps" },
    ];
    expect(keyThingIn("A finished charred cedar incense holder sitting upright on a wooden workbench", things)?.name).toBe(
      "charred cedar incense holder"
    );
    expect(keyThingIn("A kumiko lattice panel leaning against the bench", things)?.name).toBe("kumiko lattice panel");
    expect(keyThingIn("a market table in the sun", things)).toBeNull();
  });
});

describe("angles of one topic never repeat or stack (Scarlett, job 244)", () => {
  it("replaces an angle already on the text instead of adding a second", () => {
    const close = ", a close-up of one detail of it filling the frame";
    const back = ", seen from much further back with the whole place around it";
    expect(withView(`gold chain at the collarbone${close}`, close)).toBe(`gold chain at the collarbone${close}`);
    expect(withView(`gold chain at the collarbone${close}`, back)).toBe(`gold chain at the collarbone${back}`);
  });
  it("keeps rotating across passes — the next view follows the one before", () => {
    const one = (i: number, sec: number) =>
      scene(i, `Line ${i} about the chain.`, {
        wordCut: true,
        showSubject: "gold chain at the collarbone",
        audioDuration: sec,
        sameShot: i > 1 ? true : undefined,
      });
    const first = joinSameContext([one(1, 8), one(2, 7)], s => s.audioDuration ?? 0, () => 10);
    // A second pass (the pipeline re-runs the join) adds the third picture.
    const withThird = [...first.scenes, one(3, 7)];
    const second = joinSameContext(withThird, () => 7, () => 10);
    const views = second.scenes.map(s => s.showSubject);
    expect(views[1]).toMatch(/close-up/);
    expect(views[2]).toMatch(/further back/);
    expect(views.every(v => (v!.match(/close-up/g) ?? []).length <= 1)).toBe(true);
  });
});

describe("a list's last picture runs on into a NEARLY identical one (Dale, job 248)", () => {
  it("joins 'the bookcase … in the concrete driveway' and '… in the driveway, same view'", async () => {
    const { nearlySameSubject } = await import("./shotList");
    expect(
      nearlySameSubject(
        "The honey-stained bookcase standing alone in the concrete driveway",
        "The honey-stained bookcase standing alone in the driveway, same view"
      )
    ).toBe(true);
    expect(nearlySameSubject("a round wooden coaster on the bench", "a stack of coasters in a basket")).toBe(false);
    const item = (i: number, show: string, sec: number, list = true) =>
      scene(i, `line ${i}`, { wordCut: true, showSubject: show, audioDuration: sec, listCut: list || undefined });
    const r = joinSameContext(
      [
        item(1, "The pale maple engraved board displayed flat on the workbench", 1.8),
        item(2, "The honey-stained bookcase standing alone in the concrete driveway", 1.8),
        item(3, "The honey-stained bookcase standing alone in the driveway, same view", 3.9, false),
      ],
      s => s.audioDuration ?? 0,
      () => 10
    );
    expect(r.scenes).toHaveLength(2);
  });
});

describe("what moves by itself is judged per picture, not from a word list (2026-10-01)", () => {
  it("reads the judgement and puts it on pictures and split panels — only on those asked about", async () => {
    const { parseSelfMoving, applySelfMoving } = await import("./shotList");
    const scenes = [
      scene(1, "a", { showSubject: "a sliding door standing closed" }),
      scene(2, "b", { showSubject: "smoke rising from a smoldering mattress" }),
      scene(3, "c", { hostPresent: true, splitVisual: "a candle burning on the table" }),
      scene(4, "d", { showSubject: "a parked car", selfMoving: true }),
    ];
    const asked = [0, 1, 2];
    const moving = parseSelfMoving('{"moving":[1,2,3,9]}', asked);
    expect(moving).toEqual([1, 2]); // 3 and 9 were not asked about
    applySelfMoving(scenes, asked, moving);
    expect(scenes.map(s => s.selfMoving)).toEqual([false, true, undefined, true]);
    expect(scenes[2].splitSelfMoving).toBe(true);
  });
  it("a door or anything a person moves is never a video once judged", async () => {
    const { videoKind } = await import("./shotList");
    expect(videoKind("the sliding glass door opening onto the deck", "object", { selfMoving: false })).toBe("none");
    expect(videoKind("smoke rising from a smoldering mattress", "object", { selfMoving: true })).toBe("object");
  });
});

describe("every picture shows what its line is about (Frederick's job 259)", () => {
  it("keeps only real fixes and puts the new picture, its key things and the video rule on it", async () => {
    const { parsePictureFixes, applyPictureFixes } = await import("./shotList");
    const scenes = [
      scene(1, "Fires don't all behave the same way.", {
        showSubject: "the smoke alarm on the hallway ceiling",
        keyThing: "smoke alarm",
        stillImage: false,
        objectMotion: true,
      }),
      scene(2, "I'm Frederick Barnes.", { hostPresent: true }),
    ];
    const fixes = parsePictureFixes(
      JSON.stringify({
        fix: [
          { id: 0, show: "a grease flame flaring on a stovetop beside a smoldering ember glow", thing: null },
          { id: 1, show: "the host", thing: null }, // a host take is never rewritten
          { id: 9, show: "nothing there" },
        ],
      }),
      scenes
    );
    expect(fixes.map(f => f.id)).toEqual([0]);
    const things = [{ name: "smoke alarm", look: "round white", main: true as const }];
    expect(applyPictureFixes(scenes, fixes, things)).toBe(1);
    expect(scenes[0].showSubject).toMatch(/grease flame/);
    expect(scenes[0].keyThing).toBeUndefined(); // the alarm is no longer in it
    expect(scenes[0].objectMotion).toBe(true); // a flame moves by itself
  });
});

describe("writing only when the script says it, and exact (2026-10-01)", () => {
  it("keeps the planner's text only when every word of it is spoken in the line", async () => {
    const { saidText } = await import("./shotList");
    expect(saidText("PHOTOELECTRIC", "Look for the word photoelectric on the box.")).toBe("PHOTOELECTRIC");
    expect(saidText("MFG 2016", "And while you're up there, turn one over and look for the date.")).toBeUndefined();
    expect(saidText("10 YEAR", "Smoke alarms expire. At 10 years the unit is finished.")).toBeUndefined(); // "year" ≠ "years"
    expect(saidText("10 years", "At 10 years the unit is finished.")).toBe("10 years");
    expect(saidText(undefined, "anything")).toBeUndefined();
  });
  it("puts it on the piece only when that piece's own words say it", () => {
    const b = scene(3, "The box says photoelectric right on the front. Then look for the date.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 3,
          shots: [
            { from: "The box", show: "the alarm box on the shelf", text: "PHOTOELECTRIC" },
            { from: "Then look", show: "the alarm turned over", text: "2016" },
          ],
        },
      ]
    );
    expect(scenes[0].pictureText).toBe("PHOTOELECTRIC");
    expect(scenes[1].pictureText).toBeUndefined(); // no date is said — none is printed
  });
});

describe("picture numbers read back from a model (jobs 265/266: every '#' id was dropped)", () => {
  it("reads 12, '12' and '#12' alike, and nothing else", async () => {
    const { pictureId, parseSelfMoving, parseContextGroups } = await import("./shotList");
    expect([12, "12", "#12", " # 12 "].map(pictureId)).toEqual([12, 12, 12, 12]);
    expect(["twelve", "12a", 1.5, null].map(pictureId)).toEqual([null, null, null, null]);
    expect(parseSelfMoving('{"moving":["#1","#18"]}', [1, 18, 3])).toEqual([1, 18]);
    expect(parseContextGroups('{"groups":[{"ids":["#0","#1"],"show":"x"}]}', [[0, 1]])).toEqual([{ ids: [0, 1], show: "x" }]);
  });
});

describe("a spoken list is recognised from its words, whatever the planner marked (Hank's job 268)", () => {
  it("marks every item of a list as a list item, so no fold or flash rule can merge them", () => {
    const b = scene(4, "a saw, a drill, and a stack of sandpaper, wondering if that look is worth anything.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 4,
          shots: [
            // The planner forgot `list` on the first two items.
            { from: "a saw", show: "a hand saw on the workbench" },
            { from: "a drill", show: "a drill on the workbench" },
            { from: "and a stack", show: "a stack of sandpaper", list: true },
            { from: "wondering if", show: "a market table" },
          ],
        },
      ]
    );
    expect(scenes.map(s => [s.scriptText, !!s.listCut])).toEqual([
      ["a saw,", true],
      ["a drill,", true],
      ["and a stack of sandpaper,", true],
      ["wondering if that look is worth anything.", false],
    ]);
    // Settled at a quick pace, each item keeps its own picture.
    const settled = settleShots(scenes, new Map([[4, b]]), s => (s.listCut ? 0.5 : 3));
    expect(settled.scenes.filter(s => s.listCut).map(s => s.scriptText)).toEqual([
      "a saw,",
      "a drill,",
      "and a stack of sandpaper,",
    ]);
  });
  it("splits a picture the planner gave two items into one picture per item", () => {
    const b = scene(4, "a saw, a drill, and a stack of sandpaper.");
    const { scenes } = applyShotPlan(
      [b],
      [{ scene: 4, shots: [{ from: "a saw", show: "a drill on the workbench" }, { from: "and a stack", show: "sandpaper", list: true }] }]
    );
    expect(scenes.map(s => s.scriptText)).toEqual(["a saw,", "a drill,", "and a stack of sandpaper."]);
    expect(scenes[0].showSubject).toBe("a saw on the workbench");
    expect(scenes[1].showSubject).toBe("a drill on the workbench");
    expect(scenes.every(s => s.listCut)).toBe(true);
  });
  it("never takes an ordinary short line for a list", async () => {
    const { looksLikeListItem } = await import("./shotList");
    expect(looksLikeListItem("Start with the one that lost.")).toBe(false);
    expect(looksLikeListItem("wondering if that clean look is worth anything on a market table.")).toBe(false);
  });
});

describe("a clause is never taken for a list item", () => {
  it("reads 'the cheapest fabric won,' and 'the one I loved most' as clauses", async () => {
    const { looksLikeListItem } = await import("./shotList");
    expect(looksLikeListItem("the cheapest fabric won,")).toBe(false);
    expect(looksLikeListItem("and the fancy one I loved most")).toBe(false);
    expect(looksLikeListItem("a rusted hand saw,")).toBe(true);
  });
});

describe("a list without articles is recognised too — any channel", () => {
  it("keeps 'flour, sugar, and butter' as one picture per item, never an aside", async () => {
    const { looksLikeBareListItem, splitListPieces } = await import("./shotList");
    for (const t of ["flour,", "and butter.", "hammers,", "and chisels,", "2 eggs,"]) expect(looksLikeBareListItem(t)).toBe(true);
    for (const t of ["Honestly,", "slowly,", "Next,", "every weekend,", "I did,"]) expect(looksLikeBareListItem(t)).toBe(false);
    const split = splitListPieces([scene(1, "flour, sugar, and butter.", { showSubject: "baking things on the counter" })]);
    expect(split.map(s => [s.scriptText, s.showSubject, s.listCut])).toEqual([
      ["flour,", "flour on the counter", true],
      ["sugar,", "sugar on the counter", true],
      ["and butter.", "butter on the counter", true],
    ]);
  });
  it("marks a run of bare items the planner left unmarked", () => {
    const b = scene(2, "hammers, saws, and chisels, all on one wall.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 2,
          shots: [
            { from: "hammers", show: "hammers on the wall" },
            { from: "saws", show: "saws on the wall" },
            { from: "and chisels", show: "chisels on the wall" },
            { from: "all on", show: "the tool wall" },
          ],
        },
      ]
    );
    expect(scenes.map(s => !!s.listCut)).toEqual([true, true, true, false]);
  });
});

describe("a list item is a thing (the audit's replay: jobs 351, 352, 357, 362, 400)", () => {
  it("refuses numbers, lengths of time, labels, rates, set phrases and clauses — the items that were drawn", async () => {
    const { notAThing } = await import("./shotList");
    const refused: [string, string][] = [
      ["six,", "only a number"], // job 352: "Mostly four, six, and eight inch widths."
      ["twenty.", "only a number"], // job 351
      ["six and a half", "only a number"],
      ["One", "only a number"], // job 351: "One, two, three, four, all the way up to twelve."
      ["round ten,", "a numbered label"], // job 351: "Round three, three a side, round ten, …"
      ["and round twenty,", "a numbered label"],
      ["three a side,", "a rate"],
      ["two or three rounds apiece,", "a rate"],
      ["a few weeks of evenings,", "a length of time"], // job 351
      ["or a couple of months,", "a length of time"],
      ["five minutes", "a length of time"], // job 11
      ["Two thousand years ago,", "a length of time"], // job 400
      ["give or take", "a set phrase or a pronoun"],
      ["too", "a set phrase or a pronoun"],
      ["and nowhere else.", "a set phrase or a pronoun"], // job 322
      ["Hello", "a set phrase or a pronoun"], // job 220: "Hello, friend, and welcome to …"
      ["tell me", "a set phrase or a pronoun"], // job 355
      ["as rest,", "an aside or a preposition first"], // job 362, the model's list
      ["through the pine", "an aside or a preposition first"],
      ["A whole lot of folks wonder if that's rude,", "a clause"], // job 357
      ["That's called joining,", "a clause"], // job 351
      ["that still counts.", "a clause"],
      ["the star looks fine right afterward,", "a clause"],
      ["The word lives in your head and theirs", "a clause"], // job 322
      ["a week later his club friends started messaging me", "a clause"],
      // "all / every / more …" are judged on what follows: a time or a where is still no thing.
      ["every single morning", "a time"],
      ["all day long", "a time"],
      ["all of them", "an aside or a preposition first"],
      ["just for fun", "an aside or a preposition first"],
      ["less than a dollar", "an aside or a preposition first"],
    ];
    for (const [item, why] of refused) expect([item, notAThing(item)]).toEqual([item, why]);
    // Things stay things — the clean lists of the same replay, and the shapes the rule must not reach.
    for (const item of [
      "and eight inch widths.",
      "Two slip nuts",
      "one bucket",
      "a dozen eggs",
      "2 eggs,",
      "a curtain that came down years ago", // job 106: a relative clause still names a thing
      "the good half of a canvas drop cloth",
      "quilted,", // jobs 159/174/178: "pieced from a few scraps, quilted, and bound" — three real stages
      "and bound,",
      "flicked into the dirt", // job 355
      "carried off by a rat after dark",
      "mother of pearl", // job 362: "Ivory, oat, a warm coral, mother of pearl."
      "Drawer fronts", // job 352
      "and some glue too.", // a trailing "too" is not what is named
      "the round after that too",
      "a quarter", // a coin, not a number
      "two weekend bags", // a time word that names a thing
      "the sounds of the market", // "sounds of" is a noun, not a verb
      "nice even stitches",
      // A model item may open on "all / every / more / just": one refused item drops its whole list.
      "all the scraps you can find",
      "every spool of thread",
      "and more glue",
      "just a pencil",
      "the box it came in", // a clause with no "that" still names the box
      "everyone's favorite pie", // whose, not "everyone is"
    ])
      expect([item, notAThing(item)]).toEqual([item, null]);
  });

  it("never splits or marks pieces that name nothing as list items", async () => {
    const { looksLikeBareListItem, looksLikeListItem, splitListPieces } = await import("./shotList");
    for (const t of ["twenty.", "give or take,", "too.", "and round twenty,"]) expect([t, looksLikeBareListItem(t)]).toEqual([t, false]);
    for (const t of ["six and a half,", "three a side,", "a few weeks of evenings,", "the star looks fine right afterward,"])
      expect([t, looksLikeListItem(t)]).toEqual([t, false]);
    expect(looksLikeListItem("and eight inch widths.")).toBe(true);
    expect(looksLikeBareListItem("quilted,")).toBe(true);
    const one = scene(1, "six and a half, give or take,", { showSubject: "a clock on the wall" });
    expect(splitListPieces([one])).toEqual([one]);
    // Job 351: "Round three, three a side, round ten, ten a side, and round twenty, twenty." — every
    // piece read as a list item, so each was marked and kept apart, and "and round twenty, twenty."
    // was split in two: six pictures of one blanket. Now none is a list item, so they may join.
    const b = scene(3, "Round three, three a side, round ten, ten a side, and round twenty, twenty.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 3,
          shots: [
            { from: "Round three", show: "the small star blanket after round three" },
            { from: "three a side", show: "three stitches along one side" },
            { from: "round ten", show: "the growing star blanket" },
            { from: "ten a side", show: "ten stitches along one side" },
            { from: "and round twenty", show: "a much larger star blanket" },
          ],
        },
      ]
    );
    expect(scenes.map(s => [s.scriptText, !!s.listCut])).toEqual([
      ["Round three,", false],
      ["three a side,", false],
      ["round ten,", false],
      ["ten a side,", false],
      ["and round twenty, twenty.", false],
    ]);
  });

  it("a host line of clauses is not 'just a list' (job 106)", async () => {
    const { spokenListItems } = await import("./shotList");
    expect(spokenListItems("the hem went around once, the straps were four short seams, and the four squares finished it.")).toBeNull();
    expect(spokenListItems("A bin in the hall closet, a bag in the garage, maybe a box under the bed.")).toEqual([
      "A bin in the hall closet",
      "a bag in the garage",
      "a box under the bed",
    ]);
  });
});

describe("a picture shows what its line is about, in the place it names (Hank's job 269: an empty market table)", () => {
  it("tells the line check a place alone is wrong, and a new thing the line names is right", async () => {
    const { FIT_SYSTEM } = await import("./shotList");
    expect(FIT_SYSTEM).toMatch(/shows only a PLACE or SURFACE the line names/);
    expect(FIT_SYSTEM).toMatch(/the picture is the work\s+that has it/);
    expect(FIT_SYSTEM).toMatch(/something NEW the line names[\s\S]*is RIGHT/);
    // No channel's own examples in it.
    expect(FIT_SYSTEM).not.toMatch(/kumiko|incense|smoke alarm|market table\b(?! for)/i);
  });
});

describe("the line check goes picture by picture, and can split a line (Hank's job 271)", () => {
  it("reads the per-picture answer: rewrites only what does not fit, and keeps each split", async () => {
    const { parsePictureFixes } = await import("./shotList");
    const scenes = [
      scene(1, "the one that paid me best came out of a coffee can of burnt scraps.", { showSubject: "a coffee can" }),
      scene(2, "Kumiko is fitting strips together, the kind of lattice you see in old sliding doors.", { showSubject: "a lattice panel" }),
      scene(3, "I'm Hank.", { hostPresent: true }),
    ];
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          { id: 0, about: "the winning project", shows_it: false, show: "the winning piece beside the can", thing: null },
          { id: 1, about: "kumiko", shows_it: true, split: [{ from: "the kind of lattice", show: "an old sliding door with a lattice" }] },
          { id: 2, about: "host", shows_it: false, show: "x" }, // a host take is never rewritten
        ],
      }),
      scenes
    );
    expect(fixes).toEqual([
      { id: 0, show: "the winning piece beside the can" },
      { id: 1, split: [{ from: "the kind of lattice", show: "an old sliding door with a lattice", thing: undefined }] },
    ]);
  });
  it("splits the line where the new thing starts; the part before keeps its picture", async () => {
    const { applyPictureSplits } = await import("./shotList");
    const scenes = [
      scene(1, "Kumiko is fitting strips together, the kind of lattice you see in old sliding doors.", {
        showSubject: "a lattice panel",
        wordCut: true,
        shotGroup: 4,
      }),
    ];
    const r = applyPictureSplits(
      scenes,
      [{ id: 0, split: [{ from: "the kind of lattice", show: "an old sliding door with a lattice" }] }],
      []
    );
    expect(r.split).toBe(1);
    expect(r.scenes.map(s => [s.scriptText, s.showSubject])).toEqual([
      ["Kumiko is fitting strips together,", "a lattice panel"],
      ["the kind of lattice you see in old sliding doors.", "an old sliding door with a lattice"],
    ]);
    // A split whose words are not in the line, or that leaves a part under 4 words, is skipped.
    expect(applyPictureSplits(scenes, [{ id: 0, split: [{ from: "not in it", show: "x" }] }], []).split).toBe(0);
    expect(applyPictureSplits(scenes, [{ id: 0, split: [{ from: "old sliding doors", show: "x" }] }], []).split).toBe(0);
  });
});

describe("printing the line talks about is shown blurred, not hidden (2026-10-01)", () => {
  it("reads a description about printing as blurred print — unless the line says the words", async () => {
    const { blurredPrint } = await import("./shotList");
    expect(blurredPrint("the alarm box with the three things printed on it")).toBe(true);
    expect(blurredPrint("the jar turned to show its date")).toBe(true);
    expect(blurredPrint("a wood stove in the corner")).toBe(false);
    const b = scene(5, "By the end of this you'll know three things printed on the box. The tag says handmade.");
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 5,
          shots: [
            { from: "By the", show: "the alarm box with its printed label", print: "blurred" },
            { from: "The tag", show: "the tag on the quilt", text: "HANDMADE" },
          ],
        },
      ]
    );
    expect(scenes[0].blurPrint).toBe(true);
    expect(scenes[0].pictureText).toBeUndefined();
    expect(scenes[1].pictureText).toBe("HANDMADE");
    expect(scenes[1].blurPrint).toBeUndefined();
  });
  it("the line check is told not to repeat the picture before, and to show the main thing in use first", async () => {
    const { FIT_SYSTEM } = await import("./shotList");
    expect(FIT_SYSTEM).toMatch(/repeats what the picture before\s+already shows/);
    expect(FIT_SYSTEM).toMatch(/a kind of event or situation/);
    expect(FIT_SYSTEM).toMatch(/FIRST of the MAIN thing/);
  });
});


describe("a short line is one picture, not two quick ones (Dale's job 288)", () => {
  const pic = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
    ({ index, scriptText, showSubject, visualPrompt: showSubject, wordCut: true, ...over }) as StoryboardScene;
  const secOf = (m: Map<string, number>) => (s: StoryboardScene) => m.get(s.scriptText ?? "") ?? 0;

  it("joins 'Sell your furniture | on Facebook Marketplace.' into one picture of the whole line", async () => {
    const { joinShortSplits } = await import("./shotList");
    const scenes = [
      pic(1, "Number five. Sell your furniture", "the walnut bookcase in the driveway"),
      pic(2, "on Facebook Marketplace.", "a phone showing a buy-and-sell app"),
      pic(3, "Shipping a bookcase eats the profit.", "the bookcase in the driveway"),
    ];
    const r = joinShortSplits(scenes, secOf(new Map([
      ["Number five. Sell your furniture", 2.1],
      ["on Facebook Marketplace.", 1.9],
      ["Shipping a bookcase eats the profit.", 4.4],
    ])));
    expect(r.changed).toBe(true);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "Number five. Sell your furniture on Facebook Marketplace.",
      "Shipping a bookcase eats the profit.",
    ]);
    expect(r.scenes[0].joinedLine).toBe(true);
  });

  it("never joins list items, two sentences, or parts that are both long enough", async () => {
    const { joinShortSplits } = await import("./shotList");
    const sec = () => 1;
    const list = [pic(1, "a saw,", "a saw", { listCut: true }), pic(2, "a drill,", "a drill", { listCut: true })];
    expect(joinShortSplits(list, sec).changed).toBe(false);
    const twoSentences = [pic(1, "It sold.", "a quilt"), pic(2, "Then I made another.", "a new quilt")];
    expect(joinShortSplits(twoSentences, sec).changed).toBe(false);
    const long = [pic(1, "Kumiko is a craft used", "a kumiko panel"), pic(2, "in Japanese sliding doors.", "a sliding door")];
    expect(joinShortSplits(long, () => 4).changed).toBe(false);
  });

  it("the line check never splits a line into parts under 3 seconds", async () => {
    const { applyPictureSplits } = await import("./shotList");
    const s = pic(1, "Number five. Sell your furniture on Facebook Marketplace today.", "the bookcase");
    const fixes = [{ id: 0, split: [{ from: "on Facebook Marketplace", show: "a phone app" }] }];
    expect(applyPictureSplits([s], fixes, undefined, () => 4).split).toBe(0);
    expect(applyPictureSplits([s], fixes, undefined, () => 9).split).toBe(1);
    expect(applyPictureSplits([{ ...s, joinedLine: true }], fixes, undefined, () => 9).split).toBe(0);
  });
});

describe("one idea, one picture — decided by the words (the operator, 2026-10-02)", () => {
  const pic = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
    ({ index, scriptText, showSubject, visualPrompt: showSubject, wordCut: true, audioDuration: 4, ...over }) as StoryboardScene;

  it("reads a join from the line check", async () => {
    const { parsePictureFixes } = await import("./shotList");
    const scenes = [pic(1, "Sell your furniture", "a bookcase"), pic(2, "on Facebook Marketplace.", "a phone")];
    const fixes = parsePictureFixes(
      '{"pictures":[{"id":0,"about":"x","shows_it":true},{"id":"#1","about":"selling furniture on an app","shows_it":true,"join":true,"show":"the bookcase as a listing on a phone buy-and-sell app"}]}',
      scenes
    );
    expect(fixes).toEqual([{ id: 1, join: true, show: "the bookcase as a listing on a phone buy-and-sell app" }]);
  });

  it("makes one picture of one idea, showing what the check wrote for the whole line", async () => {
    const { applyPictureJoins } = await import("./shotList");
    const scenes = [
      pic(1, "Number five. Sell your furniture", "the bookcase in the driveway"),
      pic(2, "on Facebook Marketplace.", "a phone with an app"),
      pic(3, "Shipping a bookcase eats the profit.", "a bookcase by a truck"),
    ];
    const r = applyPictureJoins(
      scenes,
      [{ id: 1, join: true, show: "the bookcase as a listing on a phone's buy-and-sell app" }],
      undefined,
      s => s.audioDuration ?? 0,
      () => 12
    );
    expect(r.joined).toBe(1);
    expect(r.scenes.map(s => [s.scriptText, s.showSubject, !!s.joinedLine])).toEqual([
      ["Number five. Sell your furniture on Facebook Marketplace.", "the bookcase as a listing on a phone's buy-and-sell app", true],
      ["Shipping a bookcase eats the profit.", "a bookcase by a truck", false],
    ]);
    expect(r.remap.get(2)).toBe(1);
  });

  it("never joins across a sentence end, a list item, or past the picture's limit", async () => {
    const { applyPictureJoins } = await import("./shotList");
    const sec = (s: StoryboardScene) => s.audioDuration ?? 0;
    const join = [{ id: 1, join: true, show: "x" }];
    expect(applyPictureJoins([pic(1, "It sold.", "a"), pic(2, "Then another.", "b")], join, undefined, sec).joined).toBe(0);
    expect(applyPictureJoins([pic(1, "a saw,", "a", { listCut: true }), pic(2, "a drill,", "b", { listCut: true })], join, undefined, sec).joined).toBe(0);
    expect(applyPictureJoins([pic(1, "Sell your furniture", "a"), pic(2, "on the app.", "b")], join, undefined, sec, () => 6).joined).toBe(0);
  });
});

describe("a short piece is never merged into a list item (Dale's job 293)", () => {
  const p = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
    ({ index, scriptText, showSubject: `picture ${index}`, wordCut: true, ...over }) as StoryboardScene;
  it("folds 'Today I'm ranking' into the picture before, not into 'Etsy,'", async () => {
    const { foldSnappedFlashes } = await import("./shotList");
    const scenes = [
      p(1, "The place you tried to sell it just wasn't built for that piece.", { shotGroup: 2 }),
      p(2, "Today I'm ranking", { shotGroup: 4 }),
      p(3, "Etsy,", { shotGroup: 4, listCut: true }),
      p(4, "craft fairs,", { shotGroup: 4, listCut: true }),
    ];
    const secs = new Map([[scenes[0], 4], [scenes[1], 1.0], [scenes[2], 0.33], [scenes[3], 0.8]]);
    const r = foldSnappedFlashes(scenes, s => secs.get(s) ?? 5);
    expect(r.scenes.map(s => [s.scriptText, !!s.listCut])).toEqual([
      ["The place you tried to sell it just wasn't built for that piece. Today I'm ranking", false],
      ["Etsy,", true],
      ["craft fairs,", true],
    ]);
  });
  it("a flash between two list items leads into the item after it, which keeps its own picture", async () => {
    // Nothing is merged INTO an item by the longer-wins join (it was left as a 0.3 s picture until
    // 2026-10-18); the item after it now says it first, with its own picture and list mark.
    const { foldSnappedFlashes } = await import("./shotList");
    const scenes = [p(1, "a saw,", { listCut: true }), p(2, "and", {}), p(3, "a drill,", { listCut: true })];
    const r = foldSnappedFlashes(scenes, s => (s.listCut ? 0.6 : 0.3));
    expect(r.scenes.map(s => [s.scriptText, s.showSubject, !!s.listCut])).toEqual([
      ["a saw,", "picture 1", true],
      ["and a drill,", "picture 3", true],
    ]);
  });
});

describe("every beat can be seen (the audit's production snapshot, 2026-10-18)", () => {
  /** Words laid end to end from `t0`, one every `per` seconds, as the transcriber returns them. */
  const spoken = (text: string, t0: number, per = 0.32) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((word, k) => ({ word, start: t0 + k * per, end: t0 + k * per + per - 0.04 }));
  const item = (index: number, text: string, subject: string) =>
    scene(index, text, { listCut: true, wordCut: true, showSubject: subject, visualPrompt: subject });

  it("production job 236 #79-#81: a word said three times and heard once is ONE item, not two unseen ones", () => {
    const intro = "the wren sings three times in a row which birders remember as";
    const scenes = [
      scene(1, "Out back the loudest bird in the yard is the Carolina wren and"),
      scene(2, intro),
      item(3, "teakettle,", "a wren with its beak wide open on the fence post"),
      item(4, "teakettle,", "a wren with its beak wide open on the fence post"),
      item(5, "teakettle.", "a wren with its beak wide open on the fence post"),
      scene(6, "If you hear that by the feeder you know who it is and you can stop looking for it."),
    ];
    const words = [
      ...spoken("Out back the loudest bird in the yard is the Carolina wren and", 0),
      ...spoken(intro, 4.2),
      ...spoken("teakettle.", 8.1),
      ...spoken("If you hear that by the feeder you know who it is and you can stop looking for it.", 9.4),
    ];
    // The aligner as it is: two of the three items get no time at all.
    assignSceneRanges(scenes, words, 15, [], []);
    expect(scenes.filter(s => (s.audioDuration ?? 0) <= UNSEEN_BEAT_SEC)).toHaveLength(2);
    const r = foldUnseenBeats(scenes, s => s.audioDuration);
    expect(r.joined).toBe(2);
    expect(r.unplaced).toEqual([]);
    assignSceneRanges(r.scenes, words, 15, [], []);
    const one = r.scenes.find(s => /teakettle/.test(s.scriptText ?? ""));
    expect(one?.scriptText).toBe("teakettle, teakettle, teakettle.");
    expect(one?.listCut).toBe(true);
    expect(one?.audioDuration).toBeCloseTo(1.3, 1);
    expect(r.scenes.every(s => (s.audioDuration ?? 0) > UNSEEN_BEAT_SEC)).toBe(true);
    expect(r.scenes.map(s => s.index)).toEqual([1, 2, 3, 4]);
  });

  it("production job 215 #191/#192: the unseen 'piano,' joins the same words before it, not the next item", () => {
    const scenes = [
      item(190, "a violin,", "a violin"),
      { ...item(191, "piano,", "an upright piano"), audioDuration: 0.054 },
      { ...item(192, "piano,", "an upright piano"), audioDuration: 0 },
      { ...item(193, "and a cello.", "a cello"), audioDuration: 0.9 },
    ];
    scenes[0].audioDuration = 0.6;
    const r = foldUnseenBeats(scenes, s => s.audioDuration);
    expect(r.scenes.map(s => [s.scriptText, s.showSubject, s.audioDuration])).toEqual([
      ["a violin,", "a violin", 0.6],
      ["piano, piano,", "an upright piano", 0.054],
      ["and a cello.", "a cello", 0.9],
    ]);
  });

  it("only a MEASURED zero: a short beat, or one not measured yet, is left to the other folds", () => {
    const scenes = [
      { ...scene(1, "The first coat goes on thin,"), audioDuration: 2 },
      { ...scene(2, "slowly,"), audioDuration: 0.05 },
      { ...scene(3, "and then"), audioDuration: undefined },
      { ...scene(4, "the second coat goes on after an hour."), audioDuration: 3 },
    ];
    const r = foldUnseenBeats(scenes, s => s.audioDuration);
    expect(r.changed).toBe(false);
    expect(r.scenes).toHaveLength(4);
  });

  it("a QR, cover or asset beat is never folded, and nothing is folded INTO one or the release beat", () => {
    const qr = { ...scene(2, "Scan the code on your screen now."), qrHero: true, cta: true, ctaIndex: 0, audioDuration: 0 };
    const kept = foldUnseenBeats(
      [{ ...scene(1, "Here is the guide."), cta: true, ctaIndex: 0, audioDuration: 4 }, qr],
      s => s.audioDuration
    );
    expect(kept.changed).toBe(false);
    expect(kept.unplaced).toEqual([qr]);
    // A closing word after the scan window: the QR beat holds the block's release words.
    const after = { ...scene(3, "Goodnight."), audioDuration: 0 };
    const closing = foldUnseenBeats(
      [{ ...scene(1, "Scan it, the guide is yours."), qrHero: true, qrTail: true, cta: true, ctaIndex: 0, audioDuration: 6 }, after],
      s => s.audioDuration
    );
    expect(closing.changed).toBe(false);
    expect(closing.unplaced).toEqual([after]);
    // Never across a CTA edge either: the picture after it takes the words instead.
    const edge = foldUnseenBeats(
      [
        { ...scene(1, "Now the guide itself."), hostPresent: true, cta: true, ctaIndex: 0, audioDuration: 3 },
        { ...scene(2, "Anyway,"), audioDuration: 0 },
        { ...scene(3, "back to the porch light."), audioDuration: 3 },
      ],
      s => s.audioDuration
    );
    expect(edge.scenes.map(s => s.scriptText)).toEqual(["Now the guide itself.", "Anyway, back to the porch light."]);
  });

  it("an unseen host beat's roles stay with the host take that takes its words", () => {
    const r = foldUnseenBeats(
      [
        { ...scene(1, "Hello there, friends."), hostPresent: true, hostOpener: true, audioDuration: 3 },
        { ...scene(2, "I'm the host."), hostPresent: true, hostIntro: true, hostProtected: true, audioDuration: 0 },
        { ...scene(3, "a porch light on a timer"), audioDuration: 3 },
      ],
      s => s.audioDuration
    );
    expect(r.scenes).toHaveLength(2);
    expect(r.scenes[0]).toMatchObject({ scriptText: "Hello there, friends. I'm the host.", hostIntro: true, hostProtected: true });
  });

  it("production job 200 #184: 'So tonight,' between two items leads into the next item, which keeps its picture", () => {
    const scenes = [
      { ...item(183, "check the lock on the back window,", "a window latch"), audioDuration: 2.1 },
      { ...scene(184, "So tonight,", { wordCut: true, showSubject: "a dark porch" }), audioDuration: 0.8 },
      { ...item(185, "walk over to that front door,", "a front door from the hallway"), audioDuration: 1.6 },
      { ...item(186, "and test the deadbolt.", "a deadbolt"), audioDuration: 1.4 },
    ];
    const r = foldSnappedFlashes(scenes, s => s.audioDuration ?? 0);
    expect(r.scenes.map(s => [s.scriptText, s.showSubject, !!s.listCut])).toEqual([
      ["check the lock on the back window,", "a window latch", true],
      ["So tonight, walk over to that front door,", "a front door from the hallway", true],
      ["and test the deadbolt.", "a deadbolt", true],
    ]);
  });

  it("a lead-in at its floor, before a list, or across a CTA edge is not led into an item", () => {
    const lead = (over: Partial<StoryboardScene>, sec: number) =>
      ({ ...scene(2, "So tonight,", { wordCut: true, showSubject: "a dark porch" }), audioDuration: sec, ...over }) as StoryboardScene;
    const items = (l: StoryboardScene) => [
      { ...item(1, "check the back window,", "a latch"), audioDuration: 2 },
      l,
      { ...item(3, "walk to the front door,", "a door"), audioDuration: 2 },
    ];
    // At its floor: left alone.
    expect(foldSnappedFlashes(items(lead({}, 1.3)), s => s.audioDuration ?? 0).changed).toBe(false);
    // Inside a CTA block while the items are not: left alone.
    expect(foldSnappedFlashes(items(lead({ cta: true, ctaIndex: 0 }, 0.8)), s => s.audioDuration ?? 0).changed).toBe(false);
    expect(leadInBetweenItems(items(lead({}, 0.8)), 1)).toBe(true);
    // Before a list's first item it still joins the picture before it (Dale's job 293).
    const before = [
      { ...scene(1, "The place just wasn't built for that piece.", { wordCut: true, shotGroup: 2 }), audioDuration: 4 },
      { ...scene(2, "Today I'm ranking", { wordCut: true, shotGroup: 4 }), audioDuration: 1 },
      { ...item(3, "Etsy,", "a shop page"), audioDuration: 0.4 },
      { ...item(4, "craft fairs,", "a fair"), audioDuration: 0.8 },
    ];
    expect(leadInBetweenItems(before, 1)).toBe(false);
    const r = foldSnappedFlashes(before, s => s.audioDuration ?? 0);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "The place just wasn't built for that piece. Today I'm ranking",
      "Etsy,",
      "craft fairs,",
    ]);
  });
});

describe("a screen is a device, and it sells only when its own words say so (the audit's grid screens)", () => {
  it("a screen word with no device in the picture is no screen", () => {
    // Job 151: a crooked afghan "listing to one side"; job 342's split panel "ready for an online
    // shop photograph"; job 154: a hand-written page "listing items".
    expect(
      showsScreen("Finished lace shell afghan, the afghan angled and listing to one side of the table's center.")
    ).toBe(false);
    expect(showsScreen("walnut cutting board displayed flat on a plain background, ready for an online shop photograph.")).toBe(false);
    expect(showsScreen("Close view of a hand-written page or chart listing items")).toBe(false);
    expect(namesDevice("a screen-printed tee and a screen door")).toBe(false);
    // With the device named it is a screen, whatever it shows.
    expect(showsScreen("a phone screen showing a listing of the walnut bookcase")).toBe(true);
    expect(showsScreen("a laptop screen showing the shop page with the board listed")).toBe(true);
    expect(showsScreen("close-up of a phone screen showing a seat map")).toBe(true);
  });

  it("only a screen whose words ask for things for sale, and name nothing else on it, sells", () => {
    expect(sellingScreen("a phone showing a buy-and-sell app with handmade listings")).toBe(true);
    expect(sellingScreen("a phone showing Facebook Marketplace listings of dressers")).toBe(true);
    expect(sellingScreen("a phone showing her Etsy shop")).toBe(true);
    // "setting" alone is a place, not a settings page.
    expect(sellingScreen("a phone showing a buy-and-sell app with listings, in a plain kitchen setting")).toBe(true);
    // Production job 271 (Dale): a message INSIDE the selling app is a message screen.
    expect(
      sellingScreen(
        "a smartphone in hand showing a buy-and-sell app message screen Smartphone held at chest height displaying an open messaging app with incoming customer inquiries"
      )
    ).toBe(false);
    // Production jobs 310 / 235 (Helena), 260 (Lance), job 103 (Mae), job 345 (Dale's shop settings).
    expect(sellingScreen("close-up of a phone screen showing a seat map with a price on a chosen seat")).toBe(false);
    expect(sellingScreen("mobile phone on the kitchen table showing an airline app screen")).toBe(false);
    expect(sellingScreen("hands holding black smartphone changing password in camera app settings")).toBe(false);
    expect(sellingScreen("A smartphone on a kitchen table, its screen showing blurred hands moving quickly through stitches")).toBe(false);
    expect(sellingScreen("close-up of a phone screen showing a shop settings page with an on-off toggle")).toBe(false);
    // The LINE is never read: a hand tapping a phone under "Subscribe to…" has no selling words.
    expect(sellingScreen("a hand tapping a phone screen in a hallway beneath a ceiling smoke alarm")).toBe(false);
  });

  it("an app LISTING names, a rental listing and a thing 'listed' are no page of things for sale", () => {
    // Production job 332: the network scanner app "listing manufacturer names" kept the grid while
    // its neighbours ("app list") did not; the rental listing came back as a grid of bags.
    expect(
      sellingScreen(
        "phone screen close on the scanner app listing manufacturer names, with the host's hands at work on it Close view of a smartphone screen showing a network scanner app list with manufacturer names and device types"
      )
    ).toBe(false);
    expect(sellingScreen("a phone held showing a rental listing screen A slim black smartphone displaying a vacation rental listing with photos and details")).toBe(false);
    expect(sellingScreen("a phone showing a notes app listing the three checks")).toBe(false);
    expect(sellingScreen("a laptop screen with the three checks listed")).toBe(false);
    // …while the noun "listing" still sells, whatever follows it.
    expect(sellingScreen("a phone on the workbench showing a buy-and-sell app listing, a close-up of one detail")).toBe(true);
    expect(sellingScreen("Bare hands holding a smartphone displaying an app listing screen, framed close.")).toBe(true);
    expect(sellingScreen("a phone displaying an app listing with an editable price box")).toBe(true);
    expect(sellingScreen("a smartphone on the workbench showing a listing screen with dimensions noted")).toBe(true);
    expect(sellingScreen("a laptop showing the shop page listing the walnut board")).toBe(true);
    expect(sellingScreen("a phone showing a coffee table listing on a marketplace")).toBe(true);
  });

  it("a marketplace search is still a page of things for sale (production job 244)", () => {
    expect(
      sellingScreen(
        "phone search bar listing results of wooden dressers Phone screen showing a marketplace search results grid, listings of wooden dressers displayed in thumbnail photos."
      )
    ).toBe(true);
    // A search with nothing for sale in it is not.
    expect(sellingScreen("a laptop showing search results for flights home")).toBe(false);
  });

  it("a thing made FOR a device is no device", () => {
    expect(namesDevice("a walnut phone stand ready for its listing photo")).toBe(false);
    expect(showsScreen("a tablet holder and a computer desk photographed for an online listing")).toBe(false);
    // The device itself, in its stand or charging, still is.
    expect(showsScreen("a phone resting in a walnut phone stand, its screen showing a listing")).toBe(true);
    expect(showsScreen("a phone charging on the counter, its screen showing a listing")).toBe(true);
  });
});

describe("a picture shows WHO does WHAT, the STATE and the COUNT its line makes the point with (2026-10-18)", () => {
  it("tells the line check those are WRONG when left out — keeping the planner's exceptions", async () => {
    const { FIT_SYSTEM } = await import("./shotList");
    // 218-113: "Put on gloves and a mask and open the window." planned as "host opening the bedroom
    // window wide"; 292-163: "one box per cat plus one extra" planned as a single box.
    expect(FIT_SYSTEM).toMatch(/still WRONG when it leaves out what the line makes its point with/);
    expect(FIT_SYSTEM).toMatch(/WHO is doing WHAT/);
    expect(FIT_SYSTEM).toMatch(/the STATE the line describes/);
    expect(FIT_SYSTEM).toMatch(/COUNT the line makes the point of/);
    // Never for: a comparison (rule 4), a bare number (rule 5), someone only mentioned (6a — 144-99's
    // "they go to women setting up a kitchen" shows the cloths), a warning (6b — 153-296's soaked,
    // wadded rags are shown spread out safely), or what the line says does not happen (148-313's
    // "not one buyer ever asked", 293-34's "strangers aren't walking through your house").
    expect(FIT_SYSTEM).toMatch(/a comparison that only says what\s+something costs or is like/);
    expect(FIT_SYSTEM).toMatch(/a bare number, price or length of time/);
    expect(FIT_SYSTEM).toMatch(/only sells to, tells, helps or mentions, who does nothing/);
    expect(FIT_SYSTEM).toMatch(/show the safe way, never the danger/);
    expect(FIT_SYSTEM).toMatch(/does NOT happen or is NOT there \(never draw it happening\)/);
    // The person a rewrite adds is named, so it is never drawn as the host.
    expect(FIT_SYSTEM).toMatch(/set other to who they are/);
    expect(FIT_SYSTEM).toMatch(/"other":null/);
    // No channel's own things in the wording.
    expect(FIT_SYSTEM).not.toMatch(/padlock|bobbin|neighbor across|driveway|gloves and a mask|litter|\bcats?\b/i);
  });

  // Hank's job 171 scene 248: "That changes right here, and my neighbor across the street watched the
  // whole thing from his driveway." planned as "an empty driveway across the street from the workshop".
  const NEIGHBOUR_LINE =
    "That changes right here, and my neighbor across the street watched the whole thing from his driveway.";

  it("reads who the rewrite shows: a person, nobody (null), or no answer at all", async () => {
    const { parsePictureFixes } = await import("./shotList");
    const scenes = [
      scene(1, NEIGHBOUR_LINE, { showSubject: "an empty driveway across the street from the workshop garage" }),
      scene(2, "Then I swept up.", { showSubject: "a broom" }),
      scene(3, "And it sold.", { showSubject: "a piece" }),
    ];
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          {
            id: 0,
            about: "the neighbour watching",
            shows_it: false,
            show: "an older neighbour standing at the end of his driveway across the street, watching",
            thing: null,
            stage: null,
            other: "an older neighbour",
          },
          { id: 1, about: "sweeping", shows_it: false, show: "the host's hands sweeping sawdust", other: null },
          { id: 2, about: "the sale", shows_it: false, show: "the piece wrapped for a buyer" },
        ],
      }),
      scenes
    );
    expect(fixes[0].other).toBe("an older neighbour");
    expect(fixes[1].other).toBeNull();
    expect("other" in fixes[2]).toBe(false);
    // The host or the viewer is never "someone else".
    const host = parsePictureFixes(
      JSON.stringify({ pictures: [{ id: 0, about: "x", shows_it: false, show: "the host at the bench", other: "the host" }] }),
      scenes
    );
    expect(host[0].other).toBeNull();
  });

  it("draws the person a rewrite adds as that person, never as the host", async () => {
    const { applyPictureFixes } = await import("./shotList");
    const { markHostBroll } = await import("./hostLook");
    const scenes = [scene(1, NEIGHBOUR_LINE, { showSubject: "an empty driveway across the street from the workshop garage" })];
    applyPictureFixes(
      scenes,
      [{ id: 0, show: "an older neighbour standing in the driveway across the street, watching", other: "an older neighbour" }],
      undefined
    );
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].otherPerson).toBe("an older neighbour");
    markHostBroll(scenes, { hostLook: "a grey-bearded man in a plaid shirt" }, "https://x/host.png");
    expect(scenes[0].brollHostLook).toBeUndefined();
    expect(scenes[0].brollHostRef).toBeUndefined();
  });

  it("an answer of nobody else clears the old person; no answer keeps it while someone is still there", async () => {
    const { applyPictureFixes } = await import("./shotList");
    const make = () => [
      scene(1, "and buyers liked picking out their favorite.", {
        showSubject: "a woman customer picking out her favorite holder at the table",
        humanPresent: true,
        otherPerson: "a woman customer",
      }),
    ];
    const cleared = make();
    applyPictureFixes(cleared, [{ id: 0, show: "the host's hands setting the holders out", other: null }], undefined);
    expect(cleared[0].otherPerson).toBeUndefined();
    expect(cleared[0].humanPresent).toBe(true); // the host's hands
    const kept = make();
    applyPictureFixes(kept, [{ id: 0, show: "a woman picking up one holder from the table" }], undefined);
    expect(kept[0].otherPerson).toBe("a woman customer");
    const nobody = make();
    applyPictureFixes(nobody, [{ id: 0, show: "the holders laid out on the table" }], undefined);
    expect(nobody[0].otherPerson).toBeUndefined();
    expect(nobody[0].humanPresent).toBeUndefined();
  });

  it("a split's new picture takes only the person the check named, never the line's old one", async () => {
    const { applyPictureSplits, parsePictureFixes } = await import("./shotList");
    const line =
      "My aunt picked one up at the table and turned it over, the kind of thing you see in an old farmhouse kitchen.";
    const s = scene(1, line, {
      showSubject: "an older aunt turning a bowl over at the table",
      humanPresent: true,
      otherPerson: "an older aunt",
      wordCut: true,
    });
    const plain = applyPictureSplits([s], [{ id: 0, split: [{ from: "the kind of thing", show: "an old farmhouse kitchen" }] }], []);
    expect(plain.split).toBe(1);
    expect(plain.scenes[0].otherPerson).toBe("an older aunt");
    expect(plain.scenes[1].otherPerson).toBeUndefined();
    expect(plain.scenes[1].humanPresent).toBeUndefined();
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          {
            id: 0,
            about: "x",
            shows_it: true,
            split: [{ from: "the kind of thing", show: "a woman cooking in an old farmhouse kitchen", other: "a farm woman" }],
          },
        ],
      }),
      [s]
    );
    const named = applyPictureSplits([s], fixes, []);
    expect(named.scenes[1].otherPerson).toBe("a farm woman");
    expect(named.scenes[1].humanPresent).toBe(true);
  });

  it("a joined picture carries the person too", async () => {
    const { applyPictureJoins } = await import("./shotList");
    const pic = (index: number, scriptText: string, showSubject: string) =>
      ({ index, scriptText, showSubject, visualPrompt: showSubject, wordCut: true, audioDuration: 3 }) as StoryboardScene;
    const r = applyPictureJoins(
      [pic(1, "My neighbor stopped by", "a porch"), pic(2, "to buy two of them.", "two bowls")],
      [{ id: 1, join: true, show: "an older neighbour on the porch holding two bowls", other: "an older neighbour" }],
      undefined,
      s => s.audioDuration ?? 0,
      () => 12
    );
    expect(r.joined).toBe(1);
    expect(r.scenes[0].otherPerson).toBe("an older neighbour");
    expect(r.scenes[0].humanPresent).toBe(true);
  });
});

describe("a typed redo prompt owns the picture (job 383 scenes 20, 33 and 40)", () => {
  const things = [
    { name: "smoke alarm", look: "round white ceiling alarm", main: true as const },
    { name: "smoke detector box", look: "small rectangular cardboard box" },
  ];

  it("reads what typed words say is NOT there as naming nothing", async () => {
    const { withoutNegatedPhrases } = await import("./shotList");
    expect(withoutNegatedPhrases("one round white smoke alarm on a counter, no box, no packaging")).toBe(
      "one round white smoke alarm on a counter, ,"
    );
    expect(withoutNegatedPhrases("a pen over a blank sticky note… no writing of any kind anywhere")).toBe(
      "a pen over a blank sticky note…"
    );
    expect(withoutNegatedPhrases("a jar without a lid and a spoon beside it")).toBe("a jar and a spoon beside it");
    expect(withoutNegatedPhrases("it isn't plugged in, the cord coiled")).toBe("it , the cord coiled");
    // A count stays.
    expect(withoutNegatedPhrases("no more than three jars on the shelf")).toBe("no more than three jars on the shelf");
  });

  it("scene 20: the typed alarm replaces the planner's box — subject, key thing, soft print", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const old = "close-up of the front label of a small rectangular cardboard smoke detector box held in one hand";
    const s = scene(20, "First thing on the label.", {
      showSubject: old,
      visualPrompt: old,
      keyThing: "smoke detector box",
      buildStage: "done",
      blurPrint: true,
    });
    const typed =
      "A quick ordinary phone photo: one round white smoke alarm lying face up on a wooden kitchen counter in plain daylight, no box, no packaging";
    expect(ownTypedPicture(s, typed, things)).toBe(true);
    expect(s.showSubject).toBe(typed);
    expect(s.keyThing).toBe("smoke alarm");
    expect(s.otherKeyThings).toBeUndefined(); // "no box" names no box
    expect(s.buildStage).toBeUndefined();
    expect(s.blurPrint).toBeUndefined();
  });

  it("scene 40: a blank sticky note with 'no writing of any kind' keeps no soft print and no detector", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const old = "detector back panel close up showing battery compartment and date area";
    const s = scene(40, "That number surprises people more than anything else I've mentioned tonight. That's the job.", {
      showSubject: old,
      visualPrompt: old,
      keyThing: "smoke alarm",
      blurPrint: true,
      pictureText: "10 years",
      namedLook: "smoke alarm back panel: a round white plastic back with a battery door",
      partOf: "smoke alarm",
    });
    ownTypedPicture(
      s,
      "his hand holding a pen over a small BLANK yellow sticky note on the counter, no writing of any kind anywhere",
      things
    );
    expect(s.blurPrint).toBeUndefined();
    expect(s.pictureText).toBeUndefined();
    expect(s.keyThing).toBeUndefined();
    expect(s.partOf).toBeUndefined();
    expect(s.namedLook).toBeUndefined();
  });

  it("keeps what the typed words still name — the key thing, its stage, the said words", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const s = scene(33, "At 10 years the unit is finished.", {
      showSubject: "the date area on the back of the smoke alarm",
      visualPrompt: "the date area on the back of the smoke alarm",
      keyThing: "smoke alarm",
      buildStage: "done",
      pictureText: "10 years",
    });
    ownTypedPicture(s, "the back of the smoke alarm at arm's length, its label reading 10 years, soft", things);
    expect(s.keyThing).toBe("smoke alarm");
    expect(s.buildStage).toBe("done");
    expect(s.pictureText).toBe("10 years");
    expect(s.blurPrint).toBeUndefined(); // the words are said, so printed exactly
  });

  // Job 383 as it was stored: its real key things, lines, typed prompts and planner fields.
  const STORED = [
    { name: "smoke detector", look: "round white plastic disc", main: true as const },
    { name: "smoke detector box", look: "small rectangular cardboard box with a printed label" },
    { name: "detector back panel", look: "the disc turned over to show a battery compartment and date area" },
  ];
  const HOST_LOOK = "A sturdy man in his fifties with a short grey-flecked beard, in a navy crew-neck t-shirt";

  it("stored scene 20: 'no hands, no readable writing' drops the planner's person and its words", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const s = scene(20, "or dual sensor,", {
      showSubject: "close-up of the front label of a small rectangular cardboard smoke detector box held in one hand",
      visualPrompt: "close-up of the front label of a small rectangular cardboard smoke detector box held in one hand",
      keyThing: "smoke detector box",
      pictureText: "Dual Sensor",
      humanPresent: true,
      brollHostLook: HOST_LOOK,
      listCut: true,
    });
    const typed =
      "A quick ordinary phone photo: one round white smoke alarm lying face up on a wooden kitchen counter in plain " +
      "daylight, a second small grey sensor window beside its vents, no box, no packaging, no hands, no readable " +
      "writing anywhere";
    expect(ownTypedPicture(s, typed, STORED)).toBe(true);
    expect(s.showSubject).toBe(typed);
    expect(s.keyThing).toBeUndefined(); // the box is said to be left out, and no other key thing is named
    expect(s.pictureText).toBeUndefined(); // "no readable writing anywhere"
    expect(s.blurPrint).toBeUndefined();
    expect(s.humanPresent).toBeUndefined(); // "no hands": the host is not drawn into it
  });

  it("stored scene 40: the typed hand keeps the person; 'his face not shown' and 'no writing' name nothing", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const s = scene(40, "That number surprises people more than anything else I've mentioned tonight. That's the job.", {
      showSubject: "detector back panel turned over showing battery compartment and date area",
      visualPrompt: "detector back panel turned over showing battery compartment and date area",
      keyThing: "detector back panel",
      blurPrint: true,
      humanPresent: true,
      brollHostLook: HOST_LOOK,
    });
    ownTypedPicture(
      s,
      "A quick ordinary phone photo taken from behind a man's shoulder at a kitchen table: his hand holding a pen " +
        "over a small BLANK yellow sticky note, an old yellowed smoke alarm lying FACE UP beside it showing only its " +
        "smooth vented front, his face not shown, plain daylight, no writing of any kind anywhere",
      STORED
    );
    expect(s.humanPresent).toBe(true);
    expect(s.brollHostLook).toBe(HOST_LOOK);
    expect(s.keyThing).toBeUndefined();
    expect(s.blurPrint).toBeUndefined();
  });

  it("stored scene 33: typed soft print on the back labels stays soft print; the part it no longer names goes", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const s = scene(33, "At 10 years the unit is finished.", {
      showSubject: "close-up of the printed date area on the flat gray back of a turned-over round white smoke detector",
      visualPrompt: "close-up of the printed date area on the flat gray back of a turned-over round white smoke detector",
      keyThing: "detector back panel",
      otherKeyThings: ["smoke detector"],
      partOf: "detector back panel",
      blurPrint: true,
    });
    ownTypedPicture(
      s,
      "A quick ordinary phone photo from arm's length: two smoke alarms lying on a wooden workbench turned over to " +
        "show their back panels, the left one old and yellow-brown with age, the right one clean and white and new; " +
        "the small printing on both back labels soft, blurred and impossible to read, plain daylight, no hands",
      STORED
    );
    expect(s.blurPrint).toBe(true);
    expect(s.partOf).toBeUndefined();
    expect(s.keyThing).toBeUndefined();
    expect(s.otherKeyThings).toBeUndefined();
    expect(s.humanPresent).toBeUndefined(); // there was none, and none is added
  });

  it("only words that really say nobody take the person out", async () => {
    const { ownTypedPicture } = await import("./shotList");
    const person = (typed: string) => {
      const s = scene(1, "and I sanded it smooth.", {
        showSubject: "the host's hands sanding a board",
        visualPrompt: "the host's hands sanding a board",
        humanPresent: true,
        brollHostLook: HOST_LOOK,
      });
      ownTypedPicture(s, typed, undefined);
      return s.humanPresent;
    };
    expect(person("a smooth maple board on the bench, nobody in the shot")).toBeUndefined();
    expect(person("a smooth maple board on the bench without any people")).toBeUndefined();
    // The typed words show a person themselves: kept.
    expect(person("her hands sanding the board, no other people in the room")).toBe(true);
    // "no one thing" is not "no one".
    expect(person("a board where no one thing stands out")).toBe(true);
    // Saying nothing about people leaves the picture's person as it was.
    expect(person("a smooth maple board lying on the bench")).toBe(true);
  });

  it("a hyphened name is a kind of thing, never its absence", async () => {
    const { ownTypedPicture, withoutNegatedPhrases } = await import("./shotList");
    expect(withoutNegatedPhrases("a no-sew fleece blanket folded on the couch")).toBe(
      "a no-sew fleece blanket folded on the couch"
    );
    expect(withoutNegatedPhrases("a never-ending scarf on a chair")).toBe("a never-ending scarf on a chair");
    expect(withoutNegatedPhrases("a jar whose lid cannot close, on the shelf")).toBe("a jar whose lid , on the shelf");
    const s = scene(5, "This no-sew blanket takes an afternoon.", {
      showSubject: "the no-sew fleece blanket laid flat",
      visualPrompt: "the no-sew fleece blanket laid flat",
      keyThing: "no-sew fleece blanket",
      namedLook: "no-sew fleece blanket: two layers of fleece knotted along every edge",
    });
    ownTypedPicture(s, "a no-sew fleece blanket folded over the arm of a couch", [
      { name: "no-sew fleece blanket", look: "two layers of fleece knotted along every edge", main: true },
    ]);
    expect(s.keyThing).toBe("no-sew fleece blanket");
    expect(s.namedLook).toBe("no-sew fleece blanket: two layers of fleece knotted along every edge");
  });

  it("a plain regenerate, which sends the picture's own prompt back, changes nothing", async () => {
    const { ownTypedPicture } = await import("./shotList");
    // Job 397 scene 14, "Coasters,": regenerated with the card's own prompt.
    const s = scene(14, "Coasters,", {
      showSubject: "round maple and walnut coasters stacked on the workbench",
      visualPrompt: "Round maple and walnut coasters stacked in a neat pile on the workbench.",
      keyThing: "coaster",
    });
    expect(
      ownTypedPicture(s, "  Round maple and walnut coasters stacked in a neat pile on the workbench.  ", undefined)
    ).toBe(false);
    expect(s.showSubject).toBe("round maple and walnut coasters stacked on the workbench");
    expect(s.keyThing).toBe("coaster");
  });
});

describe("a general head before its examples is not a list item (job 400 at 0:47)", () => {
  // "…usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the
  // morning…": "some ordinary place" only says what kind of place the others are. It was item 1 — a
  // picture of its own (a woman at a sink) and row 1 of the list graphic.
  const LINE =
    "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";

  it("knows a head from a thing", async () => {
    const { generalHead } = await import("./shotList");
    for (const t of [
      "some ordinary place,",
      "Somewhere",
      "something small",
      "someone you trust",
      "any old thing",
      "some other way",
      "a certain kind of wood",
      "any sort of place",
      "everything",
    ])
      expect([t, generalHead(t)]).toEqual([t, true]);
    for (const t of [
      "some glue",
      "some scrap pine",
      "some kind of glue", // "some kind of glue, a clamp, and a rag" is three things to get
      "somebody's barn",
      "anybody with a porch", // job 110: "…to anybody with a porch, a patio, or a houseplant habit"
      "a quiet place",
      "the kitchen table",
      "some people",
      "a waiting room",
    ])
      expect([t, generalHead(t)]).toEqual([t, false]);
  });

  it("drops the head only in front of two or more examples, never when the next item is a head too", async () => {
    const { withoutGeneralHead, ledByGeneralHead } = await import("./shotList");
    expect(withoutGeneralHead(["some ordinary place", "a waiting room", "a church pew"])).toEqual(["a waiting room", "a church pew"]);
    const one = ["some quiet spot", "a porch"];
    expect(withoutGeneralHead(one)).toBe(one);
    expect(ledByGeneralHead(one)).toBe(true);
    const three = ["Something sweet", "something salty", "something to drink"];
    expect(withoutGeneralHead(three)).toBe(three);
    const things = ["a saw", "a drill", "something to clamp it with"];
    expect(withoutGeneralHead(things)).toBe(things);
  });

  it("a host line of a head and its examples is a list of the examples", async () => {
    const { spokenListItems } = await import("./shotList");
    expect(spokenListItems("Some ordinary place, a waiting room, a church pew.")).toEqual(["a waiting room", "a church pew"]);
    expect(spokenListItems("Some quiet spot, a porch swing.")).toBeNull();
    // A real thing first stays an item.
    expect(spokenListItems("Some glue, a clamp, and a rag.")).toEqual(["Some glue", "a clamp", "a rag"]);
  });

  it("a picture of the head and its examples is cut per example, the head leading the first", async () => {
    const { splitListPieces } = await import("./shotList");
    const split = splitListPieces([scene(8, "some ordinary place, a waiting room, a church pew,", { showSubject: "quiet places" })]);
    expect(split.map(s => [s.scriptText, s.showSubject, !!s.listCut])).toEqual([
      ["some ordinary place, a waiting room,", "a waiting room", true],
      ["a church pew,", "a church pew", true],
    ]);
    // A head with one example is no list: the picture is left whole.
    const one = scene(8, "some quiet spot, a porch swing,", { showSubject: "a porch swing" });
    expect(splitListPieces([one])).toEqual([one]);
    // Unchanged: a real first thing is its own picture.
    expect(splitListPieces([scene(3, "some glue, a clamp, a rag,", { showSubject: "shop things" })]).map(s => s.scriptText)).toEqual([
      "some glue,",
      "a clamp,",
      "a rag,",
    ]);
  });

  it("the shot list's own cut never marks the head a list item", () => {
    const b = scene(7, LINE);
    const { scenes } = applyShotPlan(
      [b],
      [
        {
          scene: 7,
          shots: [
            { from: "Most people past sixty", show: "an older man alone on a chair against a pale wall" },
            { from: "some ordinary place", show: "a woman at a sink by a window" },
            { from: "a waiting room", show: "a row of waiting room chairs" },
            { from: "a church pew", show: "a church pew seen from the side" },
            { from: "the kitchen table", show: "a kitchen table at night" },
          ],
        },
      ]
    );
    expect(scenes.map(s => [s.scriptText, !!s.listCut])).toEqual([
      ["Most people past sixty have — usually in silence, usually in", false],
      ["some ordinary place,", false],
      ["a waiting room,", true],
      ["a church pew,", true],
      ["the kitchen table at two in the morning when the house is too quiet.", false],
    ]);
  });
});

describe("describing words in front of ONE thing are never list items (job 400 at 1:41)", () => {
  // "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to
  // a man named Paulinus…" was cut "Two thousand years ago," / "…wrote a short," / "furious," — three
  // pictures and a list graphic for one essay.
  const ESSAY =
    "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus, the official in charge of Rome’s grain supply — busy, important, and worn down to the rims.";

  it("one describing word, and a time a sentence opens on, name nothing", async () => {
    const { notAThing } = await import("./shotList");
    for (const [t, why] of [
      ["furious,", "a describing word"], // job 400
      ["busy,", "a describing word"], // job 400: "— busy, important, and worn down to the rims"
      ["important,", "a describing word"],
      ["coziest", "a describing word"],
      ["and careless", "a describing word"],
      ["Two thousand years ago,", "a length of time"], // job 400
      ["Years ago,", "a length of time"],
      ["a century ago", "a length of time"],
      ["months later", "a length of time"],
      ["Long ago,", "a time"],
      ["that night,", "a time"],
      ["the next morning", "a time"],
      ["last summer", "a time"],
      ["back in 1850", "a time"],
      ["ago", "a time"],
    ])
      expect([t, notAThing(t)]).toEqual([t, why]);
    // Things stay things: a material, a food, a stage of making (jobs 159/174/178), an amount, a word
    // that is as often a thing ("cooler", "light"), a colour, and a thing with its own describing word.
    for (const t of ["oak", "flour", "quilted", "bound", "handful", "cooler", "light", "Ivory", "forest", "harvest", "a short", "a warm coral", "a night out", "a weekend bag", "this spring", "a second bag of pretzels", "back"])
      expect([t, notAThing(t)]).toEqual([t, null]);
  });

  it("finds the commas inside a run of describing words, and only those", async () => {
    const { seriesCommas } = await import("./shotList");
    const at = (s: string) => Array.from(seriesCommas(s)).map(c => s.slice(0, c).split(/\s+/).pop());
    expect(at(ESSAY)).toEqual(["short", "furious"]);
    expect(at("The tea tray, a plain, low serving tray, and it only moved up this list once I started putting names on it.")).toEqual(["plain"]); // Hank's script
    expect(at("It sells for $120 to $170, mostly to folks who want a real, honest quilt without paying heirloom prices.")).toEqual(["real"]); // Ruth's
    // More from the practice scripts, and a degree word or a describing word of the run itself.
    for (const [s, want] of [
      ["a solid, matte, uniform shade", ["solid", "matte"]],
      ["my two biggest, coziest things", ["biggest"]],
      ["the slow, smoldering fire", ["slow"]],
      ["a long, wet night", ["long"]],
      ["a really long, very slow walk", ["long"]],
      ["a nice, pretty, little house", ["nice", "pretty"]],
    ] as [string, string[]][])
      expect([s, at(s)]).toEqual([s, want]);
    // Lists of things, and words that only look like the start of a run.
    for (const s of [
      "standing in a garage with a saw, a drill, and a stack of sandpaper,",
      "You need a hammer, nails, and wood glue.",
      "The batting, backing, and thread run about $28",
      "Matte black, dull tarnish, heavy dark wood, all of those take it away.",
      "Bring something warm, dry socks, and a hat.",
      "Simple, warm, and impossible to argue with.",
      "One short, check the other end.",
    ])
      expect([s, at(s)]).toEqual([s, []]);
  });

  it("a piece that is one describing word is no bare list item; 'flour,' still is", async () => {
    const { looksLikeBareListItem } = await import("./shotList");
    expect(looksLikeBareListItem("furious,")).toBe(false);
    expect(looksLikeBareListItem("Years ago,")).toBe(false);
    expect(looksLikeBareListItem("flour,")).toBe(true);
    expect(looksLikeBareListItem("and wood glue.")).toBe(true);
  });

  it("a picture of one described thing is never split into items; 'a saw, a drill,' still is", async () => {
    const { splitListPieces } = await import("./shotList");
    const essay = scene(22, "a short, heartfelt, loving essay", { showSubject: "an essay on a desk" });
    expect(splitListPieces([essay])).toEqual([essay]);
    expect(splitListPieces([scene(3, "a saw, a drill,", { showSubject: "tools on the workbench" })]).map(s => s.scriptText)).toEqual(["a saw,", "a drill,"]);
  });

  it("pieces cut at those commas are never marked as list items; a real run still is", async () => {
    const { markListPieces } = await import("./shotList");
    const cut = [
      scene(1, "a man wrote a short,", { shotGroup: 1 }),
      scene(2, "heartfelt,", { shotGroup: 1 }),
      scene(3, "loving essay to his friend.", { shotGroup: 1 }),
    ];
    expect(markListPieces(cut)).toBe(0);
    expect(cut.map(s => !!s.listCut)).toEqual([false, false, false]);
    const tools = [scene(1, "a saw,", { shotGroup: 2 }), scene(2, "a drill,", { shotGroup: 2 }), scene(3, "and a plane.", { shotGroup: 2 })];
    expect(markListPieces(tools)).toBe(3);
  });
});

describe("a run of describing words starts only where one can (review of job 400's describing-run rule)", () => {
  const at = async (s: string) => {
    const { seriesCommas } = await import("./shotList");
    return Array.from(seriesCommas(s)).map(c => s.slice(0, c).split(/\s+/).pop());
  };

  it("never after a verb: the words say what something IS, and the comma separates nothing", async () => {
    // Job 400's own script, and another practice script: "too" after "is" read as "a REALLY long, …".
    for (const s of [
      "Everyone complains that life is too short, Seneca says.",
      "The title says lost, which is too strong, since folk schools still teach plenty of these.",
      "That's too short, my doctor says.",
      "It's simple, folks tell me.",
    ])
      expect([s, await at(s)]).toEqual([s, []]);
    // A degree word that itself stands where a run may start still leads one.
    expect(await at("a really long, very slow walk")).toEqual(["long"]);
    expect(await at("Very long, dull meetings wear everyone out.")).toEqual(["long"]);
    expect(await at("Grandma's old, worn quilt")).toEqual(["old"]);
  });

  it("a describing word that is a whole piece starts the next thing; one after 'and' never continues a run", async () => {
    // "and warm," used to be pulled into a run starting at "blanket", which joined the blanket and the
    // socks into one item and lost a list of three.
    expect(await at("Pack a flashlight, a blanket, and warm, dry socks.")).toEqual(["warm"]);
    expect(await at("They hewed green, right after felling, and tall, straight tulip poplar was a favorite.")).toEqual(["tall"]); // a practice script
    expect(await at("A big, heavy, and sturdy table")).toEqual(["big", "heavy"]);
    // Still no run where nothing describes ("Pilot holes, long screws, snug." / "busy, important, and worn down").
    expect(await at("Pilot holes, long screws, snug.")).toEqual([]);
    expect(await at("the official in charge of the grain supply — busy, important, and worn down to the rims.")).toEqual([]);
  });

  it("a thing ending in -ous is still a thing", async () => {
    const { describingWord, notAThing } = await import("./shotList");
    for (const w of ["couscous", "rendezvous", "bayous"]) {
      expect([w, describingWord(w)]).toEqual([w, false]);
      expect([w, notAThing(w)]).toEqual([w, null]);
    }
    expect(describingWord("furious")).toBe(true);
    expect(describingWord("generous")).toBe(true);
  });
});

describe("a picture that repeats the words before it gets its own view past the limit (job 399 scenes 20-21)", () => {
  // Job 399 (a 202.5 s film): the planner wrote the identical shot for two storyboard beats of one
  // sentence, unmarked. 11.7 s + 6.3 s at 1:36 is past the second quarter's 15 s, so they could not
  // join — and with no view of its own the second went to the picture model with the same words and
  // came back a tighter crop of the first: the same bag on screen for 18 s.
  const BAG = "several closed small liquor bottles tucked inside an open carry-on bag on a seat";
  const BAG_PROMPT = "Several unopened small liquor bottles tucked inside an open carry-on bag placed on an aircraft seat.";
  const CLOSE = ", a close-up of one detail of it filling the frame";
  const FILM_SEC = 202.47;
  const film = () => [
    scene(19, "One more thing about drinks, because it catches good people off guard.", {
      wordCut: true,
      hostPresent: true,
      showSubject: "a small liquor bottle standing closed on the beverage cart tray",
      splitVisual: "A small unopened liquor bottle standing on the galley beverage cart during flight service.",
      keyThing: "small liquor bottle",
      audioDuration: 4.1519,
    }),
    scene(
      20,
      "On a U. S. airline, the only alcohol you're allowed to drink is alcohol the airline serves you, so the little bottles tucked in your carry-on stay closed. That's in the federal aviation rules,",
      { wordCut: true, showSubject: BAG, visualPrompt: BAG_PROMPT, keyThing: "small liquor bottle", audioDuration: 11.6667 }
    ),
    scene(21, "section one twenty-one point five seventy-five, and it doesn't care how good your intentions were.", {
      wordCut: true,
      showSubject: BAG,
      visualPrompt: BAG_PROMPT,
      keyThing: "small liquor bottle",
      audioDuration: 6.332,
    }),
    scene(
      22,
      "That takes care of your thirst. Now for the rumble that shows up somewhere over the middle of the country.",
      {
        wordCut: true,
        showSubject: "the pretzel basket sitting on the beverage cart in the cabin aisle",
        keyThing: "pretzel basket",
        audioDuration: 13.821,
      }
    ),
  ];
  const START: Record<number, number> = { 19: 92.12, 20: 96.27, 21: 107.94, 22: 114.27 };
  const limit = (s: StoryboardScene) => pictureMaxSecAt(START[s.index] ?? 0, FILM_SEC);

  it("gives the later picture the next view when the two cannot join", () => {
    expect(limit(film()[1])).toBeCloseTo(15);
    const r = joinSameContext(film(), s => s.audioDuration ?? 0, limit);
    expect(r.changed).toBe(true);
    expect(r.scenes).toHaveLength(4);
    expect(r.scenes[1].showSubject).toBe(BAG); // the first keeps its look
    expect(r.scenes[1].visualPrompt).toBe(BAG_PROMPT);
    expect(r.scenes[2].showSubject).toBe(`${BAG}${CLOSE}`);
    expect(r.scenes[2].visualPrompt).toBe(`${BAG_PROMPT.replace(/\.$/, "")}${CLOSE}`);
    // The next topic and the split are left alone.
    expect(r.scenes[3].showSubject).toBe("the pretzel basket sitting on the beverage cart in the cabin aisle");
    expect(r.scenes[0].showSubject).toBe("a small liquor bottle standing closed on the beverage cart tray");
  });

  it("does nothing more on the pipeline's next pass", () => {
    const r = joinSameContext(film(), s => s.audioDuration ?? 0, limit);
    const again = joinSameContext(r.scenes, s => s.audioDuration ?? 0, limit);
    expect(again.changed).toBe(false);
    expect(again.scenes.map(s => s.showSubject)).toEqual(r.scenes.map(s => s.showSubject));
  });

  it("still plays the same pair as ONE picture when it fits the limit", () => {
    // Later in a film the limit is 18 s: 11.7 + 6.3 fits, so the line keeps the first picture.
    const r = joinSameContext(film(), s => s.audioDuration ?? 0, () => 18);
    expect(r.scenes).toHaveLength(3);
    expect(r.scenes[1].showSubject).toBe(BAG);
    expect(r.scenes[1].scriptText).toContain("good your intentions were.");
  });

  it("a third repeat takes the view after the second's, never back to the first's", () => {
    const three = [20, 21, 22].map(i =>
      scene(i, `line ${i}`, { wordCut: true, showSubject: BAG, visualPrompt: BAG_PROMPT, audioDuration: 7 })
    );
    const r = joinSameContext(three, s => s.audioDuration ?? 0, () => 10.5);
    expect(r.scenes.map(s => s.showSubject)).toEqual([
      BAG,
      `${BAG}${CLOSE}`,
      `${BAG}, seen from much further back with the whole place around it`,
    ]);
  });

  it("words that already repeat a view are moved to the next one", () => {
    const both = [20, 21].map(i => scene(i, `line ${i}`, { wordCut: true, showSubject: `${BAG}${CLOSE}`, audioDuration: 9 }));
    const r = joinSameContext(both, s => s.audioDuration ?? 0, () => 10.5);
    expect(r.scenes[0].showSubject).toBe(`${BAG}${CLOSE}`);
    expect(r.scenes[1].showSubject).toBe(`${BAG}, seen from much further back with the whole place around it`);
  });

  it("leaves alone a picture with its own words, its own view, or beside a split", () => {
    // Different words past the limit: two pictures already.
    const other = film();
    other[2].showSubject = "a printed page of aviation rules beside a closed carry-on bag";
    const r1 = joinSameContext(other, s => s.audioDuration ?? 0, limit);
    expect(r1.changed).toBe(false);
    expect(r1.scenes[2].showSubject).toBe("a printed page of aviation rules beside a closed carry-on bag");
    // A view of its own already (a split topic's later part): not touched again.
    const viewed = film();
    viewed[2].showSubject = `${BAG}, seen from the other side`;
    const r2 = joinSameContext(viewed, s => s.audioDuration ?? 0, limit);
    expect(r2.scenes[2].showSubject).toBe(`${BAG}, seen from the other side`);
    // The same words as a split host beat: the split is never joined and its panel is drawn from its
    // own description, so the picture after it keeps its words.
    const besideSplit = film();
    besideSplit[1].showSubject = besideSplit[0].showSubject;
    const r3 = joinSameContext(besideSplit, s => s.audioDuration ?? 0, limit);
    expect(r3.scenes[1].showSubject).toBe("a small liquor bottle standing closed on the beverage cart tray");
  });
});

describe("a picture that already has a view, split in two, never says that view twice (job 341 scenes 3-4)", () => {
  // Job 341: the join gave the cutting board's continuation "a close-up" (scene 2 was the board, plain),
  // then the plan gate split that 12.2 s picture in two — and the second part came back with the SAME
  // words, "…unsold, a close-up of one detail of it filling the frame", drawn as one photo twice.
  // Jobs 302, 307, 310 and 352 each shipped the same pair. The parts count on from the picture's view.
  const CLOSE = ", a close-up of one detail of it filling the frame";
  const BACK = ", seen from much further back with the whole place around it";
  const SIDE = ", seen from the other side";
  const BOARD = "two-tone walnut and maple cutting board leaning against the garage wall, unsold";
  const LINE =
    "That happens to everybody who sells what they build, and it's fixable, because the board usually isn't the problem. The place you tried to sell it just wasn't built for that piece. Today I'm ranking";
  const board = (showSubject: string) =>
    scene(3, LINE, {
      wordCut: true,
      showSubject,
      visualPrompt: "Close-up of the smooth oiled surface of a two-tone walnut and maple cutting board.",
      keyThing: "walnut and maple cutting board",
    });

  it("gives the second part the view AFTER the picture's own", () => {
    const parts = splitPicture(board(`${BOARD}${CLOSE}`), 2);
    expect(parts).toHaveLength(2);
    expect(parts[0].showSubject).toBe(`${BOARD}${CLOSE}`); // the first part keeps the picture
    expect(parts[0].visualPrompt).toBe("Close-up of the smooth oiled surface of a two-tone walnut and maple cutting board.");
    expect(parts[1].showSubject).toBe(`${BOARD}${BACK}`);
    expect(parts[1].visualPrompt).toBe(`${BOARD}${BACK}`);
  });

  it("keeps rotating over three parts, and wraps from the last view to the first", () => {
    const three = splitPicture(board(`${BOARD}${CLOSE}`), 3).map(p => p.showSubject);
    expect(three).toEqual([`${BOARD}${CLOSE}`, `${BOARD}${BACK}`, `${BOARD}${SIDE}`]);
    const fromSide = splitPicture(board(`${BOARD}${SIDE}`), 2).map(p => p.showSubject);
    expect(fromSide).toEqual([`${BOARD}${SIDE}`, `${BOARD}${CLOSE}`]);
    // A trailing full stop on the view is still read as that view.
    expect(splitPicture(board(`${BOARD}${CLOSE}.`), 2)[1].showSubject).toBe(`${BOARD}${BACK}`);
  });

  it("a picture with no view of its own splits exactly as before", () => {
    const plain = splitPicture(board(BOARD), 4).map(p => p.showSubject);
    expect(plain).toEqual([BOARD, `${BOARD}${CLOSE}`, `${BOARD}${BACK}`, `${BOARD}${SIDE}`]);
    // Only the description's END names its view: "a close-up" inside the words is not one.
    const inside = "a close-up of the board's oiled edge on the garage shelf";
    expect(splitPicture(board(inside), 2)[1].showSubject).toBe(`${inside}${CLOSE}`);
  });

  it("no two neighbouring parts ever share their words", () => {
    for (const own of ["", CLOSE, BACK, SIDE])
      for (const n of [2, 3, 4]) {
        const words = splitPicture(board(`${BOARD}${own}`), n).map(p => p.showSubject);
        for (let k = 1; k < words.length; k++) expect(words[k]).not.toBe(words[k - 1]);
      }
  });
});
