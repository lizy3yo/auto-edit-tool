import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  applyShotPlan,
  foldSnappedFlashes,
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
    const { settled } = cut(4.5); // "a saw," = 0.44 s — Hank reads the list this fast
    expect(settled.changed).toBe(false);
    expect(settled.scenes).toHaveLength(4);
  });

  it("folds list items too short to read into their neighbour", () => {
    const { settled } = cut(5.5); // "a saw," = 0.36 s — under the list floor; the host part 2.4 s
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
      scene(2, "backing,", { wordCut: true, listCut: true, shotGroup: 80, audioDuration: 0.46, showSubject: "backing" }),
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
