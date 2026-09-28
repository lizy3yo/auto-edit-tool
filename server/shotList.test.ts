import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  applyShotPlan,
  foldSnappedFlashes,
  joinHookPictures,
  joinSameContext,
  applyContextGroups,
  pullListLeadIns,
  trailingListItem,
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
  shotListEligible,
  tokenSpans,
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
    // A drill does not move by itself: asked to be an "object" shot, it stays a still rather than
    // sliding around the bench on its own. A thing that just sits there is a still too.
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
    expect(scenes[0].humanPresent).toBe(true);
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
    // A folded pair is one shot of BOTH things, not a picture of whichever ran longer.
    expect(settled.scenes[1].showSubject).toContain("together with");
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
    const b = scene(5, "I sanded it smooth, then oiled every edge until it glowed in the light.");
    const applied = applyShotPlan(
      [b],
      [
        {
          scene: 5,
          shots: [
            { from: "I sanded", show: "hands sanding", motion: "hands" },
            { from: "then oiled", show: "hands oiling an edge", motion: "hands" },
          ],
        },
      ]
    );
    const settled = settleShots(applied.scenes, applied.originals, byWords(2.5));
    const first = settled.scenes[0]; // 4 words = 1.6 s — a shot, but too short for a video render
    expect(first.stillImage).toBe(true);
    expect(first.humanPresent).toBeUndefined();
    expect(settled.scenes[1].stillImage).toBe(false);
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
    expect(LIST_SHOT_MIN_SEC).toBe(0.4);
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

  it("shows each topic as ONE shot: a video where something is done, else a photo", () => {
    const scenes = dishcloth();
    applyContextGroups(scenes, groups);
    const r = joinSameContext(scenes, s => s.audioDuration ?? 0, () => 10.5);
    expect(r.scenes.map(s => `${kind(s)}: ${s.showSubject ?? "(host)"}`)).toEqual([
      "host: (host)",
      "photo: a cotton dishcloth beside a ball of cotton yarn",
      "video: hands crocheting a waffle-stitch dishcloth",
      "photo: three dishcloths tied with ribbon and soap on a market table",
    ]);
  });

  it("never lets a video run past what the video model can render", () => {
    const long = [
      pic(1, "I work mine in a waffle stitch.", "hands crocheting", 9, "hands"),
      pic(2, "Row after row, while the kettle heats.", "hands crocheting", 9, "hands"),
    ];
    applyContextGroups(long, [{ ids: [0, 1], show: "hands crocheting a dishcloth" }]);
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
    applyContextGroups(scenes, [{ ids: [0, 1], show: "a quilt laid out on a bed" }]);
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

describe("a list's first item left on the line before goes to the list", () => {
  const host = (i: number, text: string) =>
    scene(i, text, { hostPresent: true, hostIntro: true, audioDuration: 13 });
  const item = (i: number, text: string, show: string) =>
    scene(i, text, { listCut: true, wordCut: true, showSubject: show, audioDuration: 1.5, shotGroup: 5 });

  it("Granny Mae (job 231): 'with a hook,' becomes the list's first picture", () => {
    const scenes = [
      host(4, "I'm Granny Mae, and this one's for anybody sitting at a kitchen table with a hook,"),
      item(5, "a skein of yarn,", "a worsted-weight cream yarn skein resting on the kitchen table"),
      item(6, "and a stack of stitch books,", "a small stack of stitch books on the kitchen table"),
    ];
    const r = pullListLeadIns(scenes, "crochet projects");
    expect(r.moved).toBe(1);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      "I'm Granny Mae, and this one's for anybody sitting at a kitchen table with",
      "a hook,",
      "a skein of yarn,",
      "and a stack of stitch books,",
    ]);
    expect(r.scenes[0].hostPresent).toBe(true);
    expect(r.scenes[0].wordCut).toBe(true);
    expect(r.scenes[1].listCut).toBe(true);
    expect(r.scenes[1].hostPresent).toBeFalsy();
    expect(r.scenes[1].showSubject).toBe("a hook (as used for crochet projects) on the kitchen table");
  });

  it("works on any channel's wording, and leaves a list that is already whole alone", () => {
    // Hank's list was all in one beat: nothing to move.
    const hank = [
      host(1, "I'm Hank Hardwood, and this one's for anybody standing in a garage with"),
      item(2, "a saw,", "a handsaw on the workbench"),
    ];
    expect(pullListLeadIns(hank).moved).toBe(0);
    // Any host, any list, any item: a woodworker, a locksmith, a jeweller.
    expect(trailingListItem("You'll want to start the job at the front door with a stepladder,")).toEqual({
      keep: "You'll want to start the job at the front door with",
      item: "a stepladder,",
    });
    expect(trailingListItem("Before you pick one, lay them all out on the dresser: the pearls,")?.item).toBe(
      "the pearls,"
    );
    // A line that does not END on a short item stays whole.
    expect(trailingListItem("That's the whole build, and it takes twelve minutes.")).toBeNull();
    expect(trailingListItem("with a big old bag of every leftover scrap of yarn I ever kept,")).toBeNull();
    // Never leaves the host fewer than five words.
    expect(trailingListItem("Grab a hook,")).toBeNull();
  });

  it("never takes from a CTA, cover or split line", () => {
    const cta = [
      { ...host(1, "The book is on my table with a bookmark,"), cta: true } as StoryboardScene,
      item(2, "a pen,", "a pen"),
    ];
    expect(pullListLeadIns(cta).moved).toBe(0);
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
    // Gentle hand work still moves.
    expect(safeMotion("hands crocheting a granny square", "hands")).toBe("hands");
    expect(safeMotion("hands sanding the edge of a board", "hands")).toBe("hands");
    expect(safeMotion("hands oiling a walnut cutting board", "hands")).toBe("hands");
    expect(safeMotion("hands stitching a quilt block", "hands")).toBe("hands");
    expect(contactToolWork("a cutting board on the counter")).toBe(false);
    // Holding a tool, or a tool lying there, is not the work.
    expect(safeMotion("weathered hands holding a chisel", "hands")).toBe("hands");
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
    expect(scenes[1].stillImage).toBe(false);
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
    expect(scenes[1].humanPresent).toBeUndefined();
  });
});

describe("the planner cannot ask for moving hands on a picture with no hands", () => {
  it("a 'hands' shot with no hands or person in it is a still", async () => {
    const { safeMotion } = await import("./shotList");
    expect(safeMotion("the dented coffee tin packed tight with squares", "hands")).toBe("none");
    expect(safeMotion("hands sewing fabric scraps into a strip", "hands")).toBe("hands");
    expect(safeMotion("the host threading the machine", "hands")).toBe("hands");
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
