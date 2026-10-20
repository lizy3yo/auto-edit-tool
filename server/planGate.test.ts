import { describe, expect, it } from "vitest";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import {
  breakBetween,
  capMovingLength,
  checkPlan,
  CLOSING_HOST_MIN_SEC,
  closingFoldTarget,
  enforcePlanRules,
  len,
  topicOf,
} from "./planGate";

const params = {
  faceImageUrl: "https://example.com/host.jpg",
  hostName: "Hank Hardwood",
} as LongformInputParams;

/** A film laid end to end from [kind, seconds, text] rows. */
function film(rows: [("H" | "P" | "M"), number, string][]): StoryboardScene[] {
  let t = 0;
  return rows.map(([kind, sec, text], k) => {
    const s = {
      index: k + 1,
      scriptText: text,
      narration: text,
      visualPrompt: `picture ${k + 1}`,
      showSubject: `thing ${k + 1}`,
      hostPresent: kind === "H" ? true : undefined,
      stillImage: kind === "P" ? true : kind === "M" ? false : undefined,
      objectMotion: kind === "M" ? true : undefined,
      narrationStartSec: t,
      narrationEndSec: t + sec,
      audioDuration: sec,
      audioUrl: `https://example.com/${k}.mp3`,
    } as StoryboardScene;
    t += sec;
    return s;
  });
}

const sentence = (n: number) => `Line number ${n} says a thing.`;

describe("enforcePlanRules", () => {
  it("joins a flash shot to the shot beside it and re-cuts only what moved", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 3, "The saw goes back and forth"],
      ["P", 0.5, "slowly,"],
      ["M", 3, "until the board splits cleanly."],
      ["H", 5, sentence(2)],
    ]);
    expect(checkPlan(scenes, params).findings.some(f => f.rule === 7)).toBe(true);
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
    expect(r.scenes).toHaveLength(4);
    expect(r.scenes[1].scriptText).toBe("The saw goes back and forth slowly,");
    expect(r.scenes[1].audioUrl).toBeUndefined();
    expect(r.scenes[2].audioUrl).toBeDefined();
  });

  it("splits a picture past its quarter's limit on a pause in the voice", () => {
    // 13 s in the first quarter, where a picture may stay 7 s (7 / 10 / 12 / 14 by quarter).
    const scenes = film([
      ["H", 5, sentence(1)],
      [
        "M",
        13,
        "Japanese carpenters are famous for joints that lock wood together, and the shelf uses the simplest one of all.",
      ],
      ["H", 5, sentence(2)],
      ["H", 30, sentence(3)],
    ]);
    const r = enforcePlanRules(scenes, params, { silences: [{ start: 11.4, end: 11.6 }] });
    expect(r.unresolved.filter(f => f.rule === 9)).toEqual([]);
    const parts = r.scenes.filter(s => !s.hostPresent);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(s => len(s) <= 7.5)).toBe(true);
    expect(parts[0].narrationEndSec).toBeCloseTo(11.5);
    expect(parts.map(s => s.scriptText).join(" ")).toBe(scenes[1].scriptText);
  });

  it("brings the host back in a long stretch, paying for it with a spare check-in", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 5, sentence(0)]];
    let t = 5;
    let n = 1;
    // The first 3 minutes: the host every ~30 s.
    while (t < 200) {
      for (let k = 0; k < 4; k++) rows.push(["M", 6, sentence(n++)]);
      rows.push(["H", 4, sentence(n++)]);
      t += 28;
    }
    // Then 84 s with no host — over the 75 s late limit.
    for (let k = 0; k < 14; k++) rows.push(["M", 6, sentence(n++)]);
    rows.push(["H", 4, sentence(n++)]);
    rows.push(["M", 6, sentence(n++)]);
    rows.push(["H", 8, sentence(n++)]); // a spare check-in: removing it leaves a short gap
    rows.push(["M", 6, sentence(n++)]);
    rows.push(["H", 6, sentence(n++)]);
    const scenes = film(rows);
    const host = (xs: StoryboardScene[]) => xs.filter(s => s.hostPresent).reduce((a, s) => a + len(s), 0);
    const budget = host(scenes);
    const r = enforcePlanRules(scenes, params, { budgetSec: budget });
    expect(r.unresolved.filter(f => f.rule === 8)).toEqual([]);
    expect(host(r.scenes)).toBeLessThanOrEqual(budget + 0.5);
  });

  it("does nothing to the host when no clean candidate exists", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 6, sentence(0)]];
    for (let k = 1; k <= 30; k++) rows.push(["P", 3, `and then part ${k}`]); // never a sentence
    rows.push(["H", 6, sentence(99)]);
    const scenes = film(rows);
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.some(f => f.rule === 8)).toBe(true);
    expect(r.scenes.filter(s => s.hostPresent)).toHaveLength(2);
  });

  it("turns stills of something moving by itself into videos until ~15% of the cutaways move — the main thing's first", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 5, sentence(0)]];
    for (let k = 1; k <= 8; k++) rows.push(["P", k === 3 ? 5 : 3, sentence(k)]);
    rows.push(["H", 5, sentence(9)]);
    const scenes = film(rows);
    // Only something moving by itself may move (2026-09-30): hands and plain things stay photos.
    for (const s of scenes) if (s.index % 2 === 0) s.showSubject = `hands working on thing ${s.index}`;
    for (const s of scenes) if (s.index % 2 === 1 && !s.hostPresent) s.showSubject = `the farmhouse porch, view ${s.index}`;
    scenes[3].showSubject = "fire burning in the wood stove";
    scenes[5].showSubject = "smoke curling up from the lit incense in its holder";
    scenes[5].keyThing = "incense holder";
    // Judged (`judgeSelfMoving`): only the fire and the smoke move by themselves.
    scenes.forEach(s => (s.selfMoving = s === scenes[3] || s === scenes[5]));
    const r = enforcePlanRules(scenes, { ...params, keyThings: [{ name: "incense holder", look: "", main: true }] });
    const moved = r.scenes.filter(s => !s.hostPresent && !s.stillImage);
    expect(moved.map(s => s.showSubject)).toEqual(["smoke curling up from the lit incense in its holder"]);
    expect(moved.every(s => s.objectMotion === true && !s.cameraMove)).toBe(true);
  });

  it("puts the self-introduction on camera", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 4, "I'm Hank Hardwood, and this one is for you."],
      ["H", 5, sentence(2)],
    ]);
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes[1].hostPresent).toBe(true);
    expect(r.scenes[1].hostIntro).toBe(true);
  });
});

describe("nothing moves on its own", () => {
  it("makes a moving shot of an ordinary object or of hands a photo, keeps fire moving", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 3, sentence(2)],
      ["M", 3, sentence(3)],
      ["M", 3, sentence(4)],
      ["H", 5, sentence(5)],
    ]);
    scenes[1].showSubject = "scattered wooden strips on the workbench";
    scenes[2].showSubject = "a propane torch flame moving across a cedar board";
    scenes[3].showSubject = "hands sanding the edge of a pine board";
    scenes[1].selfMoving = false;
    scenes[2].selfMoving = true;
    scenes[3].selfMoving = false;
    // Enough stills around them that two moving shots stay within the video share.
    const more = film([["P", 20, sentence(9)]])[0];
    more.index = 6;
    scenes.splice(4, 0, more);
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes[1].stillImage).toBe(true);
    expect(r.scenes[2].stillImage).toBe(false);
    expect(r.scenes[2].objectMotion).toBe(true);
    // Hands never move in a video any more (2026-09-30): a photo of the host at work.
    expect(r.scenes[3].stillImage).toBe(true);
  });

  it("turns the shortest clips back into stills when the film has too much video", () => {
    const scenes = film([
      ["H", 5, sentence(0)],
      ["M", 3, sentence(1)],
      ["M", 6, sentence(2)],
      ["M", 2, sentence(3)],
      ["P", 4, sentence(4)],
      ["P", 10, sentence(6)],
      ["P", 10, sentence(7)],
      ["H", 5, sentence(5)],
    ]);
    for (const s of scenes) if (!s.hostPresent) s.showSubject = `a candle flame, shot ${s.index}`;
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => f.rule === 11)).toEqual([]);
    const pics = r.scenes.filter(s => !s.hostPresent);
    const moving = pics.filter(s => !s.stillImage).reduce((a, s) => a + len(s), 0);
    expect(moving / pics.reduce((a, s) => a + len(s), 0)).toBeLessThanOrEqual(0.25);
    // The shortest went back to stills first; the longest clip keeps moving (never below the floor).
    expect(r.scenes.find(s => s.scriptText === sentence(3))?.stillImage).toBe(true);
    expect(r.scenes.find(s => s.scriptText === sentence(2))?.stillImage).toBe(false);
  });

  it("stops a split panel of plain objects from moving", () => {
    const scenes = film([["H", 5, sentence(1)], ["H", 5, sentence(2)], ["H", 5, sentence(3)]]);
    scenes[1].splitVisual = "scattered lattice strips on the workbench" as any;
    scenes[1].splitMotion = true;
    enforcePlanRules(scenes, params);
    expect(scenes[1].splitMotion).toBeUndefined();
  });
});

describe("Ruth's job 178", () => {
  it("never invents hands or a camera move to make a video — a film with nothing moving by itself stays photos", () => {
    const rows: [("H" | "P" | "M"), number, string][] = [["H", 5, sentence(0)]];
    for (let k = 1; k <= 8; k++) rows.push(["P", 4, sentence(k)]);
    rows.push(["H", 5, sentence(9)]);
    const scenes = film(rows);
    scenes.forEach((s, k) => (s.showSubject = k === 2 ? "a craft booth table at the market" : `a spool of thread ${k}`));
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes.filter(s => !s.hostPresent && !s.stillImage)).toEqual([]);
    expect(r.scenes.some(s => /hands gently working/.test(s.showSubject ?? ""))).toBe(false);
    // The shortfall is said, not faked.
    expect(r.unresolved.some(f => f.rule === 11 && /only/.test(f.detail))).toBe(true);
  });

  it("gives back a crowded opening beat, never a paid one, to stay within the host minutes", () => {
    const scenes = film([
      ["H", 3, sentence(0)],
      ["P", 2, sentence(1)],
      ["H", 4, sentence(2)], // crowded: 2 s after the opener
      ["P", 2, sentence(3)],
      ["H", 4, sentence(4)], // crowded too, but already sent to HeyGen
      ["P", 3, sentence(5)],
      ["H", 5, sentence(6)],
    ]);
    scenes[4].submits = [{ provider: "heygen", at: "x", reason: "first", sec: 4 }] as any;
    const r = enforcePlanRules(scenes, params, { budgetSec: 13, sectionSec: 20 });
    expect(r.scenes[2].hostPresent).toBe(false);
    expect(r.scenes[4].hostPresent).toBe(true);
  });
});

describe("a host take never starts mid-sentence", () => {
  it("takes the start of its sentence back from the picture before it", () => {
    // Mae, job 196 at 2:12: "…I was about to carry it out when I thought, well now, | why not…"
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 4, "The bag was stuffed full of yarn ends. I was about to carry it out when I thought, well now,"],
      ["H", 3, "why not work a few of these ends into something?"],
      ["P", 5, sentence(2)],
      ["H", 5, sentence(3)],
    ]);
    // Word share puts "I was…" at 6.6 s; the sentence break is the LONGER pause at 6.9-7.1, not
    // the short comma-sized one right beside the guess.
    const silences = [
      { start: 6.55, end: 6.62 },
      { start: 6.9, end: 7.1 },
    ];
    const r = enforcePlanRules(scenes, params, { silences });
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
    const host = r.scenes.find(s => s.scriptText?.includes("why not"))!;
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toBe(
      "I was about to carry it out when I thought, well now, why not work a few of these ends into something?"
    );
    const pic = r.scenes[r.scenes.indexOf(host) - 1];
    expect(pic.scriptText).toBe("The bag was stuffed full of yarn ends.");
    expect(pic.narrationEndSec).toBeCloseTo(host.narrationStartSec!, 5);
    expect(pic.narrationEndSec).toBeCloseTo(7.0, 5); // on the sentence pause, not the guess
    expect(host.audioUrl).toBeUndefined();
  });

  it("takes a whole picture that is part of its sentence", () => {
    // Ruth, job 197 at 2:49: "Every one comes out a little different, | and folks loved…"
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 4, sentence(2)],
      ["P", 2.2, "Every one comes out a little different,"],
      ["H", 3.5, "and folks loved picking out the one that spoke to them."],
      ["P", 5, sentence(3)],
      ["H", 5, sentence(4)],
    ]);
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
    const host = r.scenes.find(s => s.scriptText?.includes("folks loved"))!;
    expect(host.scriptText).toBe(
      "Every one comes out a little different, and folks loved picking out the one that spoke to them."
    );
    expect(host.narrationStartSec).toBeCloseTo(9, 5);
  });

  it("no longer lets the host come in after a comma", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 3, "The first one was a scarf,"],
      ["H", 3, "and I sold it the same afternoon."],
      ["P", 5, sentence(2)],
      ["H", 5, sentence(3)],
    ]);
    expect(
      checkPlan(scenes, params).findings.some(f => f.rule === 7 && /starts mid-sentence/.test(f.detail))
    ).toBe(true);
  });
});

describe("a stretch without the host when the host minutes are nearly spent", () => {
  it("brings the host in for a glimpse: the opening clause, then the picture", () => {
    // Mae, job 205: 43 s without her, the only whole-sentence spot 7.4 s with 6.5 s of budget left.
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 9, sentence(2)],
      ["P", 9, sentence(3)],
      ["P", 8, "It takes me about ten minutes apiece, and the cost is nothing at all, because it's yarn I'd already paid for."],
      ["P", 9, sentence(4)],
      ["P", 9, sentence(5)],
      ["H", 5, sentence(6)],
    ]);
    const r = enforcePlanRules(scenes, params, { budgetSec: 14 });
    expect(r.unresolved.filter(f => f.rule === 8 || f.rule === 7)).toEqual([]);
    const glimpse = r.scenes.find(s => s.hostPresent && s.scriptText?.startsWith("It takes"))!;
    expect(glimpse.scriptText).toBe("It takes me about ten minutes apiece,"); // first clause long enough
    const pic = r.scenes[r.scenes.indexOf(glimpse) + 1];
    expect(pic.hostPresent).toBeFalsy();
    expect(pic.scriptText).toBe("and the cost is nothing at all, because it's yarn I'd already paid for.");
    expect(pic.narrationStartSec).toBeCloseTo(glimpse.narrationEndSec!, 5);
    expect(r.scenes.filter(s => s.hostPresent).reduce((a, s) => a + len(s), 0)).toBeLessThanOrEqual(14.5);
  });
});

describe("a cut the gate makes lands between two words", () => {
  it("puts a glimpse's hand-off in the gap after the word, not inside it (Mae's 'a- | piece')", () => {
    const line =
      "It takes me about ten minutes apiece, and the cost is nothing at all, because it's yarn I'd already paid for.";
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 9, sentence(2)],
      ["P", 9, sentence(3)],
      ["P", 8, line],
      ["P", 9, sentence(4)],
      ["P", 9, sentence(5)],
      ["H", 5, sentence(6)],
    ]);
    // The picture runs 23-31 s. "apiece," is spoken 25.5-26.1, then a gap, "and" from 26.5 — the
    // word-share guess (7 of 21 words ≈ 25.67 s) lands inside "apiece".
    const tokens = line.split(/\s+/);
    const words: { start: number; end: number }[] = [];
    let t = 23.1;
    tokens.forEach((w, i) => {
      const len = i < 6 ? 0.38 : w === "apiece," ? 0.6 : 0.28;
      if (i === 7) t = 26.5; // the gap after "apiece,"
      words.push({ start: t, end: t + len });
      t += len + 0.02;
    });
    const r = enforcePlanRules(scenes, params, { budgetSec: 14, words });
    const glimpse = r.scenes.find(s => s.hostPresent && s.scriptText?.startsWith("It takes"))!;
    expect(glimpse.scriptText).toBe("It takes me about ten minutes apiece,");
    const apiece = words[6];
    expect(glimpse.narrationEndSec!).toBeGreaterThanOrEqual(apiece.end);
    expect(glimpse.narrationEndSec!).toBeLessThanOrEqual(words[7].start);
  });
});

describe("without word timings the old guess can land inside a word", () => {
  it("documents why the timings are passed: the word-share guess cuts 'apiece'", () => {
    const line =
      "It takes me about ten minutes apiece, and the cost is nothing at all, because it's yarn I'd already paid for.";
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 9, sentence(2)],
      ["P", 9, sentence(3)],
      ["P", 8, line],
      ["P", 9, sentence(4)],
      ["P", 9, sentence(5)],
      ["H", 5, sentence(6)],
    ]);
    const r = enforcePlanRules(scenes, params, { budgetSec: 14 });
    const glimpse = r.scenes.find(s => s.hostPresent && s.scriptText?.startsWith("It takes"))!;
    // "apiece," is spoken 25.5-26.1 in the case above; the guess lands at ~25.67 — inside it.
    expect(glimpse.narrationEndSec!).toBeGreaterThan(25.5);
    expect(glimpse.narrationEndSec!).toBeLessThan(26.1);
  });
});

describe("a video is never longer than the video model renders", () => {
  it("turns a moving picture past 15 s into a photo, keeping the person in it", () => {
    const at = (a: number, b: number, extra: Partial<StoryboardScene>) =>
      ({ index: 1, scriptText: "x", narrationStartSec: a, narrationEndSec: b, ...extra }) as StoryboardScene;
    // Hank's 3-min test (job 227): an 18 s "video" of his hand at the coffee can.
    const hank = at(96, 114, { stillImage: false, humanPresent: true, showSubject: "Host's hand picking a scrap" });
    const short = at(0, 12, { stillImage: false, humanPresent: true });
    const paid = at(20, 40, { stillImage: false, humanPresent: true, submits: [{ provider: "apimart", at: 1, reason: "first", sec: 20 }] } as any);
    const host = at(50, 70, { hostPresent: true });
    expect(capMovingLength([hank, short, paid, host])).toBe(1);
    expect(hank.stillImage).toBe(true);
    expect(hank.humanPresent).toBe(true);
    expect(short.stillImage).toBe(false);
    expect(paid.stillImage).toBe(false);
  });
});

describe("topicOf — a topic is one unit for video or photo", () => {
  it("finds the views a topic continued into, and stops at the host or a new topic", () => {
    const p = (i: number, extra: Partial<StoryboardScene> = {}) =>
      ({ index: i, scriptText: `line ${i}`, audioDuration: 5, ...extra }) as StoryboardScene;
    // Dale's 3-min test (job 230): "coasters at the market", then its close-up.
    const scenes = [
      p(1, { hostPresent: true }),
      p(2, { showSubject: "coasters at the market" }),
      p(3, { showSubject: "coasters at the market, a close-up", sameShot: true }),
      p(4, { showSubject: "a bookcase" }),
    ];
    expect(topicOf(scenes, scenes[2]).map(s => s.index)).toEqual([2, 3]);
    expect(topicOf(scenes, scenes[1]).map(s => s.index)).toEqual([2, 3]);
    expect(topicOf(scenes, scenes[3]).map(s => s.index)).toEqual([4]);
  });
});

describe("no blink of pictures between two host takes", () => {
  it("gives a run under 2 s back to the host, as one take", () => {
    // Norbert's 3-min test (job 232, 3:04-3:16): host → 0.6 s → 1.3 s → host, in the goodbye.
    const scenes = film([
      ["P", 6, sentence(1)],
      ["H", 7.2, "Subscribe to Norbert Daniels for more fixes, and tell me which you'll pick,"],
      ["P", 0.6, "the drill"],
      ["P", 1.3, "or the handyman."],
      ["H", 2.9, "Check the door before you trust the lock. I'm Norbert Daniels."],
    ]);
    scenes[2].listCut = true;
    scenes[3].listCut = true;
    expect(checkPlan(scenes, params).findings.some(f => /picture blink/.test(f.detail))).toBe(true);
    // The goodbye is the outro section, which is protected, as in the real film.
    const r = enforcePlanRules(scenes, { ...params, hostName: "Norbert Daniels" }, { sectionSec: 15 });
    expect(r.unresolved.filter(f => /picture blink/.test(f.detail))).toEqual([]);
    expect(r.scenes.map(s => (s.hostPresent ? "H" : "P"))).toEqual(["P", "H"]);
    expect(r.scenes[1].scriptText).toBe(
      "Subscribe to Norbert Daniels for more fixes, and tell me which you'll pick, the drill or the handyman. Check the door before you trust the lock. I'm Norbert Daniels."
    );
  });

  it("leaves a real cutaway alone", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 3, sentence(2)],
      ["H", 5, sentence(3)],
    ]);
    expect(checkPlan(scenes, params).findings.some(f => /picture blink/.test(f.detail))).toBe(false);
  });
});

describe("the plan never makes a tool-contact shot a video", () => {
  it("turns a drilling video into a photo, keeping the person", async () => {
    const { settleMotion } = await import("./planGate");
    const s = {
      index: 1,
      scriptText: "Drill a pilot hole first.",
      stillImage: false,
      humanPresent: true,
      showSubject: "The host's hands drilling a pilot hole into the pine door frame",
    } as StoryboardScene;
    expect(settleMotion([s])).toBe(1);
    expect(s.stillImage).toBe(true);
    expect(s.humanPresent).toBe(true);
  });
});

describe("the plan respects the shot list's contact judgment", () => {
  it("never turns a contact shot into a video, whatever its words", async () => {
    const { settleMotion } = await import("./planGate");
    const s = {
      index: 1,
      scriptText: "Staple the fabric to the frame.",
      stillImage: false,
      humanPresent: true,
      toolContact: true,
      showSubject: "hands fixing fabric to a frame",
    } as StoryboardScene;
    expect(settleMotion([s])).toBe(1);
    expect(s.stillImage).toBe(true);
  });
});

describe("no video has hands in it (2026-09-30)", () => {
  it("makes every moving shot with hands or a person in it a photo — the hands stay in the photo", async () => {
    const { settleMotion } = await import("./planGate");
    const tin = {
      index: 1,
      scriptText: "that tin was packed tight",
      stillImage: false,
      humanPresent: true,
      showSubject: "the dented coffee tin packed tight with squares next to a wastebasket",
    } as StoryboardScene;
    const sewing = {
      index: 2,
      scriptText: "sew them together",
      stillImage: false,
      humanPresent: true,
      showSubject: "hands sewing fabric scraps into one long strip",
    } as StoryboardScene;
    settleMotion([tin, sewing]);
    expect(tin.stillImage).toBe(true);
    expect(sewing.stillImage).toBe(true);
    expect(sewing.humanPresent).toBe(true);
  });
});

describe("rule 15: a video only of a big thing", () => {
  it("finds a video of something small and makes it a photo; a paid clip is left alone", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["M", 4, sentence(2)],
      ["M", 4, sentence(3)],
      ["P", 30, sentence(4)],
      ["H", 5, sentence(5)],
    ]);
    scenes[1].showSubject = "a jar of buttons on the shelf";
    scenes[2].showSubject = "a jar of buttons, second view";
    scenes[1].selfMoving = false;
    scenes[2].selfMoving = false;
    scenes[2].submits = [{ provider: "sixtynine_labs", at: "x", reason: "first", sec: 4 }] as any;
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes[1].stillImage).toBe(true);
    expect(r.scenes[2].stillImage).toBe(false);
  });
});

describe("every beat can be seen (the audit's production snapshot, 2026-10-18)", () => {
  const items = (scenes: StoryboardScene[], ...at: number[]) => {
    for (const k of at) Object.assign(scenes[k], { listCut: true, wordCut: true });
    return scenes;
  };

  it("rule 7 names a measured zero an unseen beat; a beat with no range yet is not one", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 3, "The wren sings it three times,"],
      ["P", 0, "teakettle,"],
      ["H", 5, sentence(2)],
    ]);
    expect(checkPlan(scenes, params).findings).toContainEqual(
      expect.objectContaining({ rule: 7, scene: 3, detail: expect.stringMatching(/^unseen beat \(0\.00s/) })
    );
    const unmeasured = scenes.map(s => ({ ...s, narrationStartSec: undefined, narrationEndSec: undefined }));
    expect(checkPlan(unmeasured, params).findings.some(f => /unseen beat/.test(f.detail))).toBe(false);
  });

  it("production job 236 #79-#81: the unseen repeats join the item that was heard, which keeps its slice", () => {
    const scenes = items(
      film([
        ["H", 5, sentence(1)],
        ["P", 3, "The wren sings it three times,"],
        ["P", 1.3, "teakettle,"],
        ["P", 0, "teakettle,"],
        ["P", 0, "teakettle."],
        ["H", 5, sentence(2)],
      ]),
      2,
      3,
      4
    );
    const slice = scenes[2].audioUrl;
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved.filter(f => /unseen beat/.test(f.detail))).toEqual([]);
    const one = r.scenes.find(s => /teakettle/.test(s.scriptText ?? ""));
    expect(one).toMatchObject({
      scriptText: "teakettle, teakettle, teakettle.",
      listCut: true,
      narrationStartSec: 8,
      narrationEndSec: 9.3,
      audioUrl: slice,
    });
    expect(r.scenes).toHaveLength(4);
  });

  it("production job 215 #191/#192: 'piano,' at 0.000 s joins the 'piano,' before it, whose start and end do not move", () => {
    const scenes = items(
      film([
        ["H", 5, sentence(1)],
        ["P", 3, "You can hear it in every room of the house:"],
        ["P", 0.6, "a violin,"],
        ["P", 0.054, "piano,"],
        ["P", 0, "piano,"],
        ["P", 0.9, "and a cello."],
        ["H", 5, sentence(2)],
      ]),
      2,
      3,
      4,
      5
    );
    const [start, end] = [scenes[3].narrationStartSec, scenes[3].narrationEndSec];
    const r = enforcePlanRules(scenes, params);
    const piano = r.scenes.find(s => /piano/.test(s.scriptText ?? ""));
    expect(piano?.scriptText).toBe("piano, piano,");
    expect([piano?.narrationStartSec, piano?.narrationEndSec]).toEqual([start, end]);
    expect(r.scenes.find(s => s.scriptText === "and a cello.")?.listCut).toBe(true);
  });

  it("a zero-length QR beat is never folded: the job is told", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["H", 4, "The whole guide is in the link below."],
      ["P", 0, "Scan the code now."],
      ["H", 5, sentence(2)],
    ]);
    Object.assign(scenes[2], { qrHero: true, cta: true, ctaIndex: 0 });
    Object.assign(scenes[1], { cta: true, ctaIndex: 0 });
    const r = enforcePlanRules(scenes, params);
    expect(r.unresolved).toContainEqual(
      expect.objectContaining({ rule: 7, detail: expect.stringMatching(/^unseen beat .*Scan the code now/) })
    );
    expect(r.scenes.some(s => s.qrHero && s.scriptText === "Scan the code now.")).toBe(true);
  });

  it("production job 200 #184: 'So tonight,' between two items leads into the next item with that item's picture", () => {
    const scenes = items(
      film([
        ["H", 5, sentence(1)],
        ["P", 2.1, "check the lock on the back window,"],
        ["P", 0.8, "So tonight,"],
        ["P", 1.6, "walk over to that front door,"],
        ["P", 1.4, "and test the deadbolt."],
        ["H", 5, sentence(2)],
      ]),
      1,
      3,
      4
    );
    const door = scenes[3].showSubject;
    const r = enforcePlanRules(scenes, params);
    const led = r.scenes.find(s => /front door/.test(s.scriptText ?? ""));
    expect(led).toMatchObject({
      scriptText: "So tonight, walk over to that front door,",
      showSubject: door,
      listCut: true,
      narrationStartSec: 7.1,
      narrationEndSec: 9.5,
    });
    expect(led?.audioUrl).toBeUndefined();
    expect(r.unresolved.filter(f => f.rule === 7 && /flash shot/.test(f.detail))).toEqual([]);
  });
});

describe("after the book cover the host comes back on a sentence (job 399)", () => {
  // Helena's 3-min test, 2:50: the cover ended on the storyboard's word count, "…every secret gives
  // you the exact words,", and the host came back mid-list on "who to say them to, and the moment
  // in the trip when they work." The cover is a fixed frame, so rule 7 used to count it as an edge
  // and let the host in anywhere.
  const COVER =
    "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF, and every secret gives you the exact words,";
  const HOST =
    "who to say them to, and the moment in the trip when they work. Chapter four covers in-flight requests, so when the right sentence won't come to you at the galley, it's already in your pocket. Hold your phone up to the screen with its camera on, and aim it at the little black and white code. A link appears, and you tap it.";
  /** The job's own transcript over the cover and the host take. */
  const TRANSCRIPT =
    "It's@162.80-162.92 called@162.98-163.30 A@163.42-163.46 Hundred@163.58-163.94 Air@164.06-164.20 Hostess@164.24-164.62 Secrets.@164.66-165.10 a@165.55-166.43 485-page@166.47-167.05 PDF,@167.11-167.65 and@168.05-168.15 every@168.35-168.59 secret@168.68-169.03 gives@169.09-169.28 you@169.29-169.41 the@169.46-169.53 exact@169.63-170.09 words,@170.16-170.54 who@170.86-171.02 to@171.04-171.14 say@171.16-171.32 them@171.36-171.48 to,@171.54-171.78 and@172.12-172.20 the@172.24-172.32 moment@172.40-172.68 in@172.74-172.80 the@172.82-172.90 trip@172.96-173.20 when@173.26-173.38 they@173.40-173.54 work.@173.58-173.84 Chapter@174.48-174.82 4@175.10-175.18 covers@175.26-175.58 in-flight@175.76-176.18 requests,@176.24-176.76 so@177.20-177.44 when@177.70-177.84 the@177.86-177.94 right@178.00-178.18 sentence@178.24-178.54 won't@178.58-178.76 come@178.82-178.98 to@179.02-179.08 you@179.12-179.20 at@179.26-179.32 the@179.36-179.44 galley,@179.48-179.88 it's@180.12-180.28 already@180.42-180.78 in@180.84-180.90 your@180.94-181.08 pocket.@181.10-181.48 Hold@182.08-182.24 your@182.28-182.40 phone@182.44-182.66 up@182.72-182.78 to@182.82-182.92 the@182.96-183.04 screen@183.08-183.40 with@183.44-183.54 its@183.60-183.70 camera@183.74-184.10 on@184.26-184.38 and@184.56-184.66 aim@184.80-184.96 it@185.00-185.06 at@185.12-185.20 the@185.24-185.32 little@185.38-185.58 black@185.64-185.86 and@185.88-185.98 white@186.02-186.20 code.@186.26-186.58 A@187.22-187.26 link@187.30-187.48 appears,@187.52-187.94 and@188.08-188.16 you@188.20-188.30 tap@188.32-188.56 it.@188.63-189.49";
  const words = TRANSCRIPT.split(" ").map(tok => {
    const [, start, end] = /@([\d.]+)-([\d.]+)$/.exec(tok)!;
    return { start: Number(start), end: Number(end) };
  });

  type Kind = "H" | "B" | "Q" | "A";
  const beat = (index: number, kind: Kind, from: number, to: number, text: string, cta = true) =>
    ({
      index,
      scriptText: text,
      narration: text,
      visualPrompt: `picture ${index}`,
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      hostPresent: kind === "H",
      stillImage: kind !== "H",
      coverHero: kind === "B" ? true : undefined,
      qrHero: kind === "Q" ? true : undefined,
      qrTail: kind === "Q" ? true : undefined,
      qrCorner: kind === "H" && cta ? true : undefined,
      assetImageUrl: kind === "A" ? "https://example.com/asset.png" : undefined,
      cta: cta ? true : undefined,
      ctaIndex: cta ? 0 : undefined,
      hostProtected: kind === "H" && cta ? true : undefined,
    }) as StoryboardScene;

  /** Job 399's CTA block as stored (scenes 27-30), after a host line before it. */
  const block = (cover = COVER, host = HOST, coverKind: Kind = "B") => [
    beat(1, "H", 144.655, 148.646, "And that is the second ask.", false),
    beat(
      2,
      "H",
      148.646,
      162.649,
      "Two asks in, you might wonder how anyone keeps this straight. I read what nobody else bothers to, the federal rules airlines must honor and the policies they never mention, and I gathered it into one digital book."
    ),
    beat(3, coverKind, 162.649, 170.752, cover),
    beat(4, "H", 170.752, 189.022, host),
    beat(
      5,
      "Q",
      189.022,
      202.13,
      "Or look underneath this video, open the description, and tap the link at the top. None of that needs doing today, and it'll keep just fine."
    ),
  ];
  const order = (scenes: StoryboardScene[]) =>
    scenes
      .filter(s => s.cta)
      .map(s => (s.qrHero ? "Q" : s.coverHero ? "B" : s.assetImageUrl ? "A" : "H"))
      .join("");
  const afterCover = (f: { rule: number; detail: string }) =>
    f.rule === 7 && /starts mid-sentence after the book cover/.test(f.detail);

  it("rule 7 names a host take that comes back inside the cover's sentence", () => {
    expect(checkPlan(block(), params).findings).toContainEqual(
      expect.objectContaining({
        rule: 7,
        scene: 4,
        detail: expect.stringMatching(/after the book cover: "who to say them to/),
      })
    );
  });

  it("the cover finishes the sentence and the host comes back on 'Chapter four', between the two words", () => {
    const r = enforcePlanRules(block(), params, { words });
    expect(r.unresolved.filter(afterCover)).toEqual([]);
    const cover = r.scenes.find(s => s.coverHero)!;
    const host = r.scenes[r.scenes.indexOf(cover) + 1];
    expect(cover.scriptText).toBe(`${COVER} who to say them to, and the moment in the trip when they work.`);
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toMatch(/^Chapter four covers in-flight requests,/);
    // In the gap after "work." (173.84) and before "Chapter" (174.48), never inside a word.
    expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(173.84);
    expect(cover.narrationEndSec!).toBeLessThanOrEqual(174.48);
    expect(host.narrationStartSec).toBeCloseTo(cover.narrationEndSec!, 5);
    expect(len(cover)).toBeLessThanOrEqual(15);
    // Both ranges moved, so both are re-cut from the master; the CTA order is untouched.
    expect(cover.audioUrl).toBeUndefined();
    expect(host.audioUrl).toBeUndefined();
    expect(order(r.scenes)).toBe("HBHQ");
    expect(checkPlan(r.scenes, params).findings.filter(afterCover)).toEqual([]);
  });

  it("without a transcript the cut goes on the sentence's pause", () => {
    const silences = [{ start: 173.85, end: 174.47 }];
    const r = enforcePlanRules(block(), params, { silences });
    const cover = r.scenes.find(s => s.coverHero)!;
    expect(cover.scriptText).toMatch(/when they work\.$/);
    expect(cover.narrationEndSec).toBeCloseTo(174.16, 5);
  });

  it("a host who already comes back on a sentence is left alone", () => {
    const scenes = block(
      "It's called A Hundred Air Hostess Secrets, a four hundred eighty-five page PDF.",
      "Every secret gives you the exact words, who to say them to, and the moment in the trip when they work. A link appears, and you tap it."
    );
    expect(checkPlan(scenes, params).findings.filter(f => f.rule === 7)).toEqual([]);
    const r = enforcePlanRules(scenes, params, { words });
    expect(r.scenes.find(s => s.coverHero)?.narrationEndSec).toBe(170.752);
  });

  it("a cover that would run past its ceiling keeps its line: the host comes in inside the sentence", () => {
    // 8.1 s of cover + a sentence that only ends deep inside the host take (~13 s of it).
    const long =
      "who to say them to, the moment in the trip when they work, the seat to be in when the cart starts down the aisle, the galley you can walk back to, and the crew member who has the spare cans in the drawer. A link appears, and you tap it.";
    const scenes = block(COVER, long);
    expect(checkPlan(scenes, params).findings.filter(f => f.rule === 7)).toEqual([]);
    const r = enforcePlanRules(scenes, params, { words });
    expect(r.scenes.find(s => s.coverHero)?.scriptText).toBe(COVER);
  });

  it("a host take that is only the end of the cover's sentence stays the host and is named, never folded into the cover", () => {
    // Taking it would leave book → card, with no host between.
    const scenes = block(COVER, "who to say them to, and the moment in the trip when they work.");
    scenes[3].narrationEndSec = 174.16;
    scenes[3].audioDuration = 174.16 - 170.752;
    scenes[4].narrationStartSec = 174.16;
    scenes[4].audioDuration = 202.13 - 174.16;
    const r = enforcePlanRules(scenes, params, { words });
    expect(r.unresolved.some(afterCover)).toBe(true);
    expect(order(r.scenes)).toBe("HBHQ");
    expect(r.scenes.find(s => s.coverHero)?.scriptText).toBe(COVER);
  });

  it("an operator's asset is not the cover: the host after it is not held to this", () => {
    const scenes = block(COVER, HOST, "A");
    expect(checkPlan(scenes, params).findings.filter(afterCover)).toEqual([]);
    const r = enforcePlanRules(scenes, params, { words });
    expect(r.scenes.find(s => s.assetImageUrl)?.scriptText).toBe(COVER);
  });
});

describe("a sentence cut goes right after the word the script ends it on (job 400)", () => {
  // Job 400 as stored: the cover ended on a semicolon, "…the Stoics after him;", and the host came
  // back on "my work was gathering it into a digital book called The Stoic Way — a hundred and one
  // lessons on money, grief, people, and more." The script says "a hundred and one" and a dash where
  // the voice was heard as "101" and a full stop, so the word share lands one word late, between
  // "13" and "chapters," — inside the next sentence.
  const HEARD =
    "My@180.92-181.12 work@181.16-181.44 was@181.50-181.64 gathering@181.72-182.18 it@182.24-182.32 into@182.42-182.62 a@182.66-182.70 digital@182.78-183.18 book@183.22-183.46 called@183.60-183.94 The@183.96-184.28 Stoic@184.38-184.80 Way.@184.86-185.16 101@185.82-186.38 lessons@186.44-186.84 on@186.98-187.06 money,@187.16-187.48 grief,@187.86-188.20 people,@188.64-189.06 and@189.40-189.48 more.@189.54-189.82 13@190.54-190.87 chapters,@190.91-191.43 each@191.87-192.04 lesson@192.13-192.49 built@192.55-192.79 the@192.85-192.95 same@193.01-193.25 way.@193.33-193.57";
  const heard = HEARD.split(" ").map(tok => {
    const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
    return { word, start: Number(start), end: Number(end) };
  });
  const scenes = () => {
    const s = film([
      ["H", 6.36, "Some of you are already a page ahead of me, wondering where all of this lives in one place."],
      ["P", 3.783, "The thinking belongs to Seneca and the Stoics after him;"],
      [
        "H",
        12.839,
        "my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more. Thirteen chapters, each lesson built the same way.",
      ],
      ["P", 8, "No timer on this. Now, back to that door you have been holding open."],
    ]);
    // On the master's own clock, as the film has it.
    s.forEach(x => {
      x.narrationStartSec! += 170.618;
      x.narrationEndSec! += 170.618;
      Object.assign(x, { cta: true, ctaIndex: 0 });
    });
    Object.assign(s[1], { coverHero: true });
    Object.assign(s[3], { qrHero: true, qrTail: true });
    return s;
  };

  it("the cover ends after 'and more.', where it was heard, not where the word share puts it", () => {
    const r = enforcePlanRules(scenes(), params, { words: heard });
    const cover = r.scenes.find(s => s.coverHero)!;
    const host = r.scenes[r.scenes.indexOf(cover) + 1];
    expect(cover.scriptText).toMatch(/people, and more\.$/);
    expect(host.scriptText).toBe("Thirteen chapters, each lesson built the same way.");
    expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(189.82); // "more." has ended
    expect(cover.narrationEndSec!).toBeLessThanOrEqual(190.54); // "13" has not begun
  });

  it("without what was heard, the cut stays on the word share (the transcript's count alone)", () => {
    const counted = heard.map(({ start, end }) => ({ start, end }));
    const r = enforcePlanRules(scenes(), params, { words: counted });
    const cover = r.scenes.find(s => s.coverHero)!;
    // One word late: after "13", before "chapters," — which is why the heard word is used.
    expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(190.87);
    expect(cover.narrationEndSec!).toBeLessThanOrEqual(190.91);
  });
});

describe("a host take stops mid-sentence only at a natural break (job 400)", () => {
  // Job 400 at 1:31: "…I want to show you that the arithmetic | was never your problem." — the
  // first half of a picture split for length, made a check-in, and passed as a shot-list hand-off
  // because both pieces were word-cut.
  const cut = (scenes: StoryboardScene[], ...at: number[]) => {
    for (const k of at) scenes[k].wordCut = true;
    return scenes;
  };
  const ends = (scenes: StoryboardScene[]) =>
    checkPlan(scenes, params).findings.filter(f => f.rule === 7 && /ends mid-sentence/.test(f.detail));

  it("knows a break from the words alone: a comma, a list, a joining word, an article, a name, a count", () => {
    const breaks: [string, string, boolean?][] = [
      ["Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper,", "I want to show you"],
      ["and this one's for anybody standing in a garage with", "a saw,", true],
      ["the one that paid me best for my time came out of", "a coffee can of burnt scraps I almost threw in the trash."],
      ["Two thousand years ago, a man named", "Lucius Annaeus Seneca wrote a short,"],
      ["Every one comes out a little different", "and folks loved picking out the one that spoke to them."],
      ["by the end of this video you will be able to name all", "seven of the thieves."],
      ["men and women in their fifties, sixties, and beyond", "— people carrying real questions about"],
    ];
    for (const [before, after, list] of breaks) expect(breakBetween(before, after, { list }), before).toBe(true);
    const notBreaks: [string, string][] = [
      ["I want to show you that the arithmetic", "was never your problem."], // subject | verb (job 400)
      ["There is a man standing in the greeting card", "aisle of a pharmacy on a Tuesday morning,"], // inside a name (job 400)
      ["I want to show you that", "the arithmetic was never your problem."], // "that" waits for its clause
      ["Then I", "sanded the whole thing smooth."], // a subject waits for its verb
      ["Nobody could say what it was made of", "was a mystery to me."], // a stranded preposition, then a verb
      // A preposition's bare object: the break goes before the preposition (job 408, below).
      ["My name is Gideon Grant, and this channel is for", "men and women in their fifties, sixties,"],
    ];
    for (const [before, after] of notBreaks) expect(breakBetween(before, after), before).toBe(false);
  });

  it("two word-cut pieces at no break are not a hand-off; at a comma they are", () => {
    const bad = cut(
      film([
        ["H", 5, sentence(1)],
        ["H", 8, "Today, with the help of a Roman who wrote the sharpest essay, I want to show you that the arithmetic"],
        ["P", 4, "was never your problem. Your problem is theft."],
        ["H", 5, sentence(2)],
      ]),
      1,
      2
    );
    expect(ends(bad).map(f => f.detail)).toEqual([
      expect.stringMatching(/^host take ends mid-sentence, at no natural break: "Today, with the help/),
    ]);
    const good = cut(
      film([
        ["H", 5, sentence(1)],
        ["H", 5, "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper,"],
        ["P", 4, "I want to show you that the arithmetic was never your problem."],
        ["H", 5, sentence(2)],
      ]),
      1,
      2
    );
    expect(ends(good)).toEqual([]);
  });

  it("'too long to finish' is measured on the rest of the SENTENCE, not the whole picture after", () => {
    // 8 s of host, then 1.5 s of its sentence inside a 9.5 s picture: the old check added the whole
    // picture, called it past the 15 s ceiling and excused the take.
    const short = film([
      ["H", 5, sentence(1)],
      ["H", 8, "Today, with the help of a Roman who wrote the sharpest essay, I want to show you that the arithmetic"],
      ["P", 9.5, "was never your problem. Your problem is theft, and by the end of this video you will be able to name all seven of the thieves."],
      ["H", 5, sentence(2)],
    ]);
    expect(ends(short)).toHaveLength(1);
    // A sentence that really runs on past the ceiling may be left at a break — the ordinary L-cut…
    const long = (hostText: string) =>
      film([
        ["H", 5, sentence(1)],
        ["H", 8, hostText],
        ["P", 12, "and every one of them came back with a story about the market they sold at and the people who stopped"],
        ["P", 3, "to ask about the price."],
        ["H", 5, sentence(2)],
      ]);
    expect(ends(long("Today I want to tell you about the thirty boards I made last winter,"))).toEqual([]);
    // …but never inside a phrase.
    expect(ends(long("Today I want to tell you about the thirty boards I made last winter for the"))).toHaveLength(1);
  });

  const arithmetic = () =>
    cut(
      film([
        ["H", 5, sentence(1)],
        ["H", 8, "Today, with the help of a Roman who wrote the sharpest essay, I want to show you that the arithmetic"],
        ["P", 8, "was never your problem. Your problem is theft, and by the end of this video you will name the thieves."],
        ["H", 5, sentence(2)],
      ]),
      1,
      2
    );

  it("finishes the sentence when the host minutes allow it", () => {
    const r = enforcePlanRules(arithmetic(), params);
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
    const [host, pic] = [r.scenes[1], r.scenes[2]];
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toMatch(/that the arithmetic was never your problem\.$/);
    expect(pic.scriptText).toMatch(/^Your problem is theft,/);
    expect(pic.narrationStartSec).toBeCloseTo(host.narrationEndSec!, 5);
    expect(host.audioUrl).toBeUndefined();
    expect(pic.audioUrl).toBeUndefined();
  });

  it("with the host minutes spent it hands over at its own last comma instead", () => {
    const r = enforcePlanRules(arithmetic(), params, { budgetSec: 18 });
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
    const [host, pic] = [r.scenes[1], r.scenes[2]];
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toBe("Today, with the help of a Roman who wrote the sharpest essay,");
    expect(pic.scriptText).toMatch(/^I want to show you that the arithmetic was never your problem\./);
    expect(pic.narrationStartSec).toBeCloseTo(host.narrationEndSec!, 5);
    expect(host.wordCut && pic.wordCut).toBe(true);
    expect(r.scenes.filter(s => s.hostPresent).reduce((a, s) => a + len(s), 0)).toBeLessThanOrEqual(18.5);
  });

  it("a host take already at a break keeps its hand-off untouched", () => {
    const scenes = cut(
      film([
        ["H", 5, sentence(1)],
        ["H", 4, "Out of ten projects, the one that paid me best came out of"],
        ["P", 4, "a coffee can of burnt scraps I almost threw in the trash."],
        ["H", 5, sentence(2)],
      ]),
      1,
      2
    );
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes[1].scriptText).toBe("Out of ten projects, the one that paid me best came out of");
    expect(r.scenes[1].narrationEndSec).toBe(9);
  });

  // The introduction hands over only once the WHOLE name is said. Asked of the kept words alone,
  // "…I'm Hank" read as an introduction, and with the host minutes spent the walk back from a cut
  // at no break handed over between the two words of the name.
  const intro = (hostText: string) => {
    const s = cut(
      film([
        ["P", 5, sentence(1)],
        ["H", 6, hostText],
        ["P", 6, "talking to you from my garage today about a box."],
        ["H", 5, sentence(2)],
      ]),
      1,
      2
    );
    s[1].hostIntro = true;
    return s;
  };

  it("never hands the introduction over between the two words of the host's name", () => {
    for (const [hostName, text] of [
      ["Hank Hardwood", "So before we get going on any of it, I'm Hank Hardwood"],
      ["Sawdust Sam", "So before we get going on any of it, I'm Sawdust Sam"],
    ]) {
      const r = enforcePlanRules(intro(text), { ...params, hostName }, { budgetSec: 11 });
      expect(r.scenes[1].scriptText, hostName).toBe(text);
      expect(r.scenes[2].scriptText, hostName).toBe("talking to you from my garage today about a box.");
    }
  });

  it("hands the introduction over after the name — said whole, or by its last word (job 407)", () => {
    for (const [hostName, text, kept] of [
      [
        "Hank Hardwood",
        "Before anything else, I'm Hank Hardwood, and today we start with the",
        "Before anything else, I'm Hank Hardwood,",
      ],
      ["Sawdust Sam", "Before anything else, I am Sam, and today we start with the", "Before anything else, I am Sam,"],
    ]) {
      const r = enforcePlanRules(intro(text), { ...params, hostName }, { budgetSec: 11 });
      expect(r.scenes[1].scriptText, hostName).toBe(kept);
      expect(r.scenes[2].scriptText, hostName).toMatch(/^and today we start with the talking/);
    }
    // Never before the name: with no comma after it, the last clause mark is "today," — where the
    // name is not yet said — so the hand-off comes later, after "I am Sam".
    const r = enforcePlanRules(
      intro("Before we get going on any of it today, I am Sam and we start with the"),
      { ...params, hostName: "Sawdust Sam" },
      { budgetSec: 11 }
    );
    expect(r.scenes[1].scriptText).toMatch(/^Before we get going on any of it today, I am Sam\b/);
  });

  it("a stretch without the host never takes a picture that stops at no break as its check-in", () => {
    const rows = (a: string, b: string): [("H" | "P" | "M"), number, string][] => [
      ["H", 5, sentence(1)],
      ["P", 9.5, sentence(2)],
      ["P", 9.5, sentence(3)],
      ["P", 5, a],
      ["P", 4, b],
      ["P", 9.5, sentence(4)],
      ["P", 9.5, sentence(5)],
      ["H", 5, sentence(6)],
    ];
    const atComma = cut(
      film(
        rows(
          "Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper,",
          "I want to show you that the arithmetic was never your problem."
        )
      ),
      3,
      4
    );
    expect(enforcePlanRules(atComma, params).scenes[3].hostPresent).toBe(true);
    const noBreak = cut(
      film(
        rows(
          "Today, with the help of a Roman who wrote the sharpest essay, I want to show you that the arithmetic",
          "was never your problem. Your problem is theft."
        )
      ),
      3,
      4
    );
    const hosts = enforcePlanRules(noBreak, params)
      .scenes.filter(s => s.hostPresent)
      .map(s => s.scriptText ?? "");
    expect(hosts.some(t => /the arithmetic$/.test(t))).toBe(false);
    // The host comes in on the clause instead — a glimpse that leaves at the comma.
    expect(hosts).toContain("Today, with the help of a Roman who wrote the sharpest essay,");
  });
});

describe("a natural break, read on the films' own hand-offs (review of the job 400 fix)", () => {
  it("a picture may open on a preposition with its object, a clause word or a clause's own subject", () => {
    // Hand-offs the shot list made at exactly these breaks; the first cut of the rule re-cut them.
    const breaks: [string, string][] = [
      ["Those buyers will pay real money for one good piece", "on a bare wall,"], // job 153
      ["Now I love a quilt, and there is nothing that sits on a bed", "in a farmhouse guest room like a hand-pieced one,"], // job 167
      ["because that's the number that tells you", "whether your evening earned its keep."], // job 172
      ["I round off with a little single-crochet edge", "so they lie flat on the edge of the sink"], // job 151
      ["a woman with gray hair that catches the light will read younger", "than a woman with flawlessly dyed brown hair"], // job 320
      ["My neighbor across the fence saw the first one and bought it off me", "before I'd even woven in the ends."], // job 170
      ["that's about $4 for every hour", "I sat at that machine,"], // job 159
      ["A fellow from a bonsai club bought", "three at once, one for each of his best trees,"], // job 153
    ];
    for (const [before, after] of breaks) expect(breakBetween(before, after), before).toBe(true);
  });

  it("…but never a preposition left before a verb, a count inside its name, 'of', or an object pronoun", () => {
    const notBreaks: [string, string][] = [
      ["For as long as anyone can remember, the sacks that flour and feed came", "in were printed with little flowers and checks,"], // job 163
      ["The homemade quilt folks paid me best for", "wasn't the precision piecing."], // jobs 159 and 166
      ["But the jump from number two to number", "one is the biggest jump on this whole list."], // jobs 153-178
      ["A nine-patch is nine little squares", "of cloth sewn into a block,"], // job 163
      ["My neighbor across the fence saw the first one and bought", "it off me before I'd even woven in the ends."], // job 173
      ["Then I'll show you how", "the joint locks without a single nail."], // a clause word waits for its clause
      ["We set up at the stall where", "the buyers stop first."],
    ];
    for (const [before, after] of notBreaks) expect(breakBetween(before, after), before).toBe(false);
  });

  // Jobs 153-178: "But the jump from number two to number one | is the biggest jump on this whole
  // list." — the host take stopped between subject and verb.
  const numberOne = () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 2.6, "But the jump from number two to number one"],
      ["P", 6, "is the biggest jump on this whole list. Number one is the holder made from scraps."],
      ["H", 5, sentence(3)],
    ]);
    scenes[2].wordCut = true;
    scenes[3].wordCut = true;
    return scenes;
  };

  it("with room the host finishes the sentence", () => {
    const r = enforcePlanRules(numberOne(), params);
    const host = r.scenes.find(s => /^But the jump/.test(s.scriptText ?? ""))!;
    expect(host.hostPresent).toBe(true);
    expect(host.scriptText).toBe("But the jump from number two to number one is the biggest jump on this whole list.");
    expect(r.unresolved.filter(f => f.rule === 7)).toEqual([]);
  });

  it("with no room it is never cut inside 'number one': the take goes to a picture instead", () => {
    // 12.6 s of host against a 12.1 s budget: no room to say even "is".
    const r = enforcePlanRules(numberOne(), params, { budgetSec: 12.1 });
    const takes = r.scenes.filter(s => s.hostPresent).map(s => s.scriptText ?? "");
    expect(takes.some(t => /to number$/.test(t))).toBe(false);
    expect(takes.some(t => /^But the jump/.test(t))).toBe(false);
    expect(r.scenes.map(s => s.scriptText).join(" ")).toContain(
      "But the jump from number two to number one is the biggest jump on this whole list."
    );
  });
});

describe("the host comes back after the book cover on the whole number, never inside it (job 406)", () => {
  // Gary's practice film, 3:00: the cover ended on the storyboard's cut, "…Garage to Profit Bible,",
  // and the gate let it finish its sentence, "…working people actually run.", with the host coming
  // back on "Three hundred seventy pages". The cut came out at 180.69 — after "Three hundred", the
  // middle of a transcript gap that sat wholly after the real 0.74 s pause (179.42-180.16): the word
  // before heard running on over the pause and the number heard late, as one token, "370".
  /** The film's own words as heard, 171-198 s (the graphics step's transcript of job 406). */
  const HEARD =
    "That@171.165-171.345 pattern@171.405-171.745 fills@171.785-172.005 a@172.065-172.105 digital@172.165-172.525 book@172.565-172.765 called@172.825-173.085 the@173.105-173.165 Garage@173.205-173.666 to@173.686-173.766 Profit@173.826-174.206 Bible,@174.246-174.606 put@174.846-175.006 together@175.046-175.406 under@175.486-175.646 this@175.686-175.846 channel's@175.886-176.267 name@176.307-176.547 from@176.607-176.747 the@176.767-176.867 honest@176.987-177.307 arithmetic@177.367-177.947 working@178.027-178.347 people@178.387-178.688 actually@178.888-179.308 run.@179.368-179.528 370@180.528-180.768 pages,@181.269-181.689 101@182.209-182.61 numbered@182.77-183.27 hustles@183.31-183.69 across@183.791-184.111 13@184.351-184.671 chapters,@184.731-185.212 each@185.752-185.912 one@186.032-186.152 printed@186.232-186.552 with@186.612-186.733 its@186.793-186.893 real@187.013-187.253 dollar@187.313-187.613 range@187.653-187.973 and@188.114-188.194 a@188.234-188.254 Know@188.334-188.534 Your@188.554-188.714 Limit@188.774-189.014 panel@189.054-189.374 that@189.434-189.575 states@189.635-189.935 the@189.975-190.095 downside@190.135-190.715 flat.@190.956-191.296 Tonight@191.936-192.256 covers@192.296-192.577 17@192.597-193.317 under@193.437-194.218 $500.@194.258-194.618 The@195.319-195.419 book@195.439-195.619 runs@195.659-195.879 the@195.939-196.039 same@196.099-196.339 math@196.399-196.639 on@196.72-196.78 the@196.8-196.9 other@196.98-197.16 84.@197.22-197.72";
  const heard = () =>
    HEARD.split(" ").map(tok => {
      const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
      return { word, start: Number(start), end: Number(end) };
    });
  /** The words the cut was made from: "run." heard on over the pause, "370" heard late. */
  const voiced = () =>
    heard().map(x =>
      x.word === "run." ? { ...x, end: 180.619 } : x.word === "370" ? { ...x, start: 180.768, end: 181.0 } : x
    );
  /** The job's real pauses (`masterSilences`) over the same stretch. */
  const silences = [
    [172.608, 172.733], [174.458, 174.783], [178.597, 178.719], [178.85, 179.028], [179.423, 180.162],
    [181.513, 181.944], [184.013, 184.173], [184.836, 184.97], [185.039, 185.626], [186.716, 186.842],
    [189.766, 189.913], [190.603, 190.914], [191.117, 191.853], [193.498, 193.653], [194.431, 195.244],
    [197.287, 197.433], [197.594, 198.311],
  ].map(([start, end]) => ({ start, end }));

  type Kind = "H" | "B" | "Q" | "P";
  const beat = (index: number, kind: Kind, from: number, to: number, text: string, cta = true) =>
    ({
      index,
      scriptText: text,
      narration: text,
      visualPrompt: `picture ${index}`,
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      hostPresent: kind === "H",
      stillImage: kind !== "H",
      coverHero: kind === "B" ? true : undefined,
      qrHero: kind === "Q" ? true : undefined,
      qrTail: kind === "Q" ? true : undefined,
      qrCorner: kind === "H" && cta ? true : undefined,
      cta: cta ? true : undefined,
      ctaIndex: cta ? 0 : undefined,
      hostProtected: kind === "H" && cta ? true : undefined,
    }) as StoryboardScene;
  /** Job 406's scenes 30-34 as the gate got them. */
  const block = () => [
    beat(1, "P", 156.74, 164.46, "The downside is real: some mowers are just done, and you’ll eat a couple of corpses learning to tell the difference.", false),
    beat(2, "H", 164.46, 171.023, "Three businesses in, and you can already see the pattern: the money lives in the math, not the hype."),
    beat(3, "B", 171.023, 174.62, "That pattern fills a digital book called The Garage to Profit Bible,"),
    beat(
      4,
      "H",
      174.62,
      198.271,
      "put together under this channel’s name from the honest arithmetic working people actually run. Three hundred seventy pages, a hundred and one numbered hustles across thirteen chapters, each one printed with its real dollar range and a Know Your Limit panel that states the downside flat. Tonight covers seventeen under five hundred dollars; the book runs the same math on the other eighty-four."
    ),
    beat(
      5,
      "Q",
      198.271,
      219.76,
      "There’s a QR code on your screen — aim your phone’s camera at it, and the page opens on its own. If it’s gone before you look up, the first line of this video’s description lands in the same place."
    ),
  ];
  const cut = (words: { word: string; start: number; end: number }[]) => {
    const r = enforcePlanRules(block(), params, { words, silences });
    const cover = r.scenes.find(s => s.coverHero)!;
    const host = r.scenes[r.scenes.indexOf(cover) + 1];
    expect(cover.scriptText).toMatch(/working people actually run\.$/);
    expect(host.scriptText).toMatch(/^Three hundred seventy pages,/);
    expect(host.narrationStartSec).toBeCloseTo(cover.narrationEndSec!, 5);
    return cover.narrationEndSec!;
  };

  it("on the words the cut was made from, it lands in the pause before the sentence, not at 180.69", () => {
    const at = cut(voiced());
    expect(at).toBeGreaterThanOrEqual(179.423);
    expect(at).toBeLessThanOrEqual(180.162);
  });

  it("on the film's own words it stays where it was: the part of the pause after 'run.'", () => {
    expect(cut(heard())).toBeCloseTo((179.528 + 180.162) / 2, 5);
  });

  it("a cut after a comma stays in the heard gap: a silence inside a heard word may be its own closure", () => {
    // Mae's glimpse (job 205): "It takes me about ten minutes apiece, | and the cost is nothing…".
    // A silence inside "apiece," (its "p" closure, 25.80-25.95) must not take the hand-off — only a
    // sentence break reaches past the heard words to the pause.
    const line =
      "It takes me about ten minutes apiece, and the cost is nothing at all, because it's yarn I'd already paid for.";
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 9, sentence(2)],
      ["P", 9, sentence(3)],
      ["P", 8, line],
      ["P", 9, sentence(4)],
      ["P", 9, sentence(5)],
      ["H", 5, sentence(6)],
    ]);
    const words: { word: string; start: number; end: number }[] = [];
    let t = 23.1;
    line.split(/\s+/).forEach((w, i) => {
      const sec = i < 6 ? 0.38 : w === "apiece," ? 0.6 : 0.28;
      if (i === 7) t = 26.5; // the gap after "apiece,"
      words.push({ word: w, start: t, end: t + sec });
      t += sec + 0.02;
    });
    const r = enforcePlanRules(scenes, params, {
      budgetSec: 14,
      words,
      silences: [{ start: 25.8, end: 25.95 }],
    });
    const glimpse = r.scenes.find(s => s.hostPresent && s.scriptText?.startsWith("It takes"))!;
    expect(glimpse.scriptText).toBe("It takes me about ten minutes apiece,");
    expect(glimpse.narrationEndSec!).toBeGreaterThanOrEqual(words[6].end);
    expect(glimpse.narrationEndSec!).toBeLessThanOrEqual(words[7].start);
  });

  it("a pause in the heard gap keeps the cut, even with a longer one past a word the transcript lost", () => {
    // Job 404's own words and pauses (3:06-3:27): "…tap it. Or scroll down…" — the transcript lost
    // "Or". The first pause after "it." (192.77-193.12) is the sentence's; the longer one after it
    // (193.55-194.06) comes after "Or". Taking the longest pause within reach cut at 193.80 and gave
    // "Or" to the picture finishing the sentence before.
    const words404 = (
      "The@180.601-180.701 robin@180.761-181.082 has@181.142-181.322 its@181.402-181.502 own@181.642-181.782 profile,@181.862-182.463 so@182.843-183.003 when@183.083-183.203 yours@183.243-183.504 slip@183.544-183.784 off@183.844-183.984 the@184.024-184.124 lawn,@184.144-184.505 you'll@184.705-184.925 know@184.965-185.105 what@185.145-185.285 draws@185.325-185.605 them@185.645-185.786 back.@185.826-186.126 " +
      "If@186.906-186.967 your@186.987-187.127 phone's@187.167-187.427 within@187.487-187.767 reach,@187.867-188.168 point@188.468-188.668 its@188.708-188.828 camera@188.868-189.248 at@189.288-189.368 the@189.388-189.489 code@189.549-189.789 in@189.809-189.869 this@189.909-190.049 video,@190.109-190.569 and@190.79-190.89 when@190.91-191.07 a@191.11-191.13 link@191.19-191.41 shows@191.43-191.69 on@191.75-191.83 the@191.851-191.931 phone,@191.971-192.251 tap@192.511-192.771 it.@192.851-192.911 " +
      "scroll@194.284-194.585 down@194.625-194.785 to@194.845-194.945 the@194.985-195.045 description@195.086-195.586 below@195.646-195.967 the@196.007-196.067 video@196.127-196.548 and@196.688-196.788 it's@196.828-196.949 on@196.989-197.049 the@197.089-197.169 very@197.229-197.469 first@197.529-197.79 line.@197.85-198.15 Today,@198.812-199.232 next@199.573-199.793 week,@199.873-200.654 or@200.675-200.715 once@200.835-201.015 the@201.075-201.155 snow@201.195-201.436 flies,@201.496-201.896 any@202.417-202.558 of@202.598-202.638 those@202.698-202.878 works@202.958-203.179 just@203.259-203.459 as@203.519-203.599 well.@203.659-203.92 " +
      "Back@204.701-204.881 to@204.901-205.001 the@205.021-205.082 robins,@205.142-205.582 who've@205.843-206.043 picked@206.083-206.304 up@206.344-206.424 some@206.464-206.624 company.@206.684-207.085"
    )
      .split(" ")
      .map(tok => {
        const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
        return { word, start: Number(start), end: Number(end) };
      });
    const pauses404 = [
      [179.869, 180.487], [182.437, 182.686], [186.106, 186.762], [188.218, 188.382], [190.528, 190.681],
      [192.225, 192.431], [192.774, 193.116], [193.548, 194.057], [198.078, 198.72], [201.938, 202.228],
      [203.867, 204.613], [205.621, 205.784], [205.887, 206.009], [207.058, 207.215],
    ].map(([start, end]) => ({ start, end }));
    // Laid out as a book cover finishing its sentence before the host comes back — the path that
    // made job 406's cut.
    const scenes = [
      beat(1, "H", 180.487, 186.722, "The robin has its own profile, so when yours slip off the lawn, you’ll know what draws them back."),
      beat(2, "B", 186.722, 192.45, "If your phone’s within reach, point its camera at the code in this video, and when a link shows on the phone,"),
      beat(
        3,
        "H",
        192.45,
        204.2,
        "tap it. Or scroll down to the description below the video, and it’s on the very first line. Today, next week, or once the snow flies, any of those works just as well."
      ),
      beat(4, "Q", 204.2, 207.1, "Back to the robins, who’ve picked up some company."),
    ];
    const r = enforcePlanRules(scenes, params, { words: words404, silences: pauses404 });
    const cover = r.scenes.find(s => s.coverHero)!;
    const host = r.scenes[r.scenes.indexOf(cover) + 1];
    expect(cover.scriptText).toMatch(/tap it\.$/);
    expect(host.scriptText).toMatch(/^Or scroll down/);
    expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(192.911);
    expect(cover.narrationEndSec!).toBeLessThanOrEqual(193.116);
    expect(host.narrationStartSec).toBeCloseTo(cover.narrationEndSec!, 5);
  });
});

describe("the host comes back after the book cover in the pause, even with the word before dragged past it (job 413)", () => {
  // Gary's verification film, 2:59 (#35 → #36): the same line as job 406, the round-11 fix in. This
  // time the transcriber heard "run." at 180.09-180.61 — over "Three hundred", wholly AFTER the
  // 0.81 s pause it really ends (179.146-179.958) — and "370" at 180.71. The number could not be
  // moved back past the word before it, the heard gap held no pause, and the two heard words did not
  // reach the real one: the cut went in the middle of the heard gap, 180.66, and the host came back
  // on "seventy".
  /** The film's own words as heard (the graphics step's transcript of job 413). */
  const HEARD =
    "That@170.722-170.922 pattern@170.982-171.322 fills@171.362-171.582 a@171.642-171.682 digital@171.742-172.122 book@172.182-172.403 called@172.483-172.723 the@172.743-172.823 Garage@172.863-173.303 to@173.343-173.423 Profit@173.483-173.883 Bible,@173.923-174.284 put@174.564-174.724 together@174.764-175.104 under@175.184-175.344 this@175.384-175.544 channel's@175.604-175.984 name@176.045-176.285 from@176.345-176.485 the@176.505-176.605 honest@176.725-177.045 arithmetic@177.125-177.705 working@177.785-178.106 people@178.146-178.426 actually@178.666-179.306 run.@180.087-180.607 370@180.707-181.087 pages,@181.127-181.567 101@182.208-182.808 numbered@182.948-183.268 hustles@183.308-183.689 across@183.749-184.069 13@184.249-184.649 chapters,@184.689-185.189 each@185.75-185.91 one@186.03-186.13 printed@186.19-186.53 with@186.59-186.71 its@186.77-186.89 real@187.01-187.251 dollar@187.291-187.611 range@187.651-187.991 and@188.111-188.211 a@188.251-188.271 know-your-limit@188.351-189.031 panel@189.071-189.432 that@189.472-189.592 states@189.652-189.952 the@190.012-190.112 downside@190.152-190.732 flat.@190.892-191.213 Tonight@191.813-192.133 covers@192.193-192.493 17@192.713-193.214 under@193.334-193.514 $500.@193.594-194.494 The@194.995-195.095 book@195.135-195.315 runs@195.355-195.575 the@195.615-195.715 same@195.775-196.015 math@196.075-196.335 on@196.415-196.475 the@196.495-196.595 other@196.676-196.836 84.@196.856-196.916";
  const words = () =>
    HEARD.split(" ").map(tok => {
      const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
      return { word, start: Number(start), end: Number(end) };
    });
  /** The job's real pauses (`masterSilences`) over the same stretch. */
  const silences = [
    [168.878, 169.313], [169.923, 170.639], [172.25, 172.394], [174.179, 174.503], [178.356, 178.486],
    [179.146, 179.958], [181.391, 181.858], [183.944, 184.116], [184.815, 184.941], [184.995, 185.631],
    [189.784, 189.935], [190.6, 190.857], [191.024, 191.736], [193.384, 193.539], [194.317, 194.93],
    [196.984, 197.119], [197.281, 197.997], [199.452, 200.227],
  ].map(([start, end]) => ({ start, end }));
  const beat = (index: number, kind: "H" | "B" | "Q" | "P", from: number, to: number, text: string, cta = true) =>
    ({
      index,
      scriptText: text,
      narration: text,
      visualPrompt: `picture ${index}`,
      narrationStartSec: from,
      narrationEndSec: to,
      audioDuration: to - from,
      audioUrl: `https://example.com/${index}.mp3`,
      hostPresent: kind === "H",
      stillImage: kind !== "H",
      coverHero: kind === "B" ? true : undefined,
      qrHero: kind === "Q" ? true : undefined,
      qrTail: kind === "Q" ? true : undefined,
      qrCorner: kind === "H" && cta ? true : undefined,
      cta: cta ? true : undefined,
      ctaIndex: cta ? 0 : undefined,
      hostProtected: kind === "H" && cta ? true : undefined,
    }) as StoryboardScene;
  /** Job 413's scenes 34-37, laid out as job 406's were when the gate let the cover finish its sentence. */
  const block = () => [
    beat(1, "P", 156.74, 164.06, "The downside is real: some mowers are just done, and you’ll eat a couple of corpses learning to tell the difference.", false),
    beat(2, "H", 164.06, 170.599, "Three businesses in, and you can already see the pattern: the money lives in the math, not the hype."),
    beat(3, "B", 170.599, 174.42, "That pattern fills a digital book called The Garage to Profit Bible,"),
    beat(
      4,
      "H",
      174.42,
      197.957,
      "put together under this channel’s name from the honest arithmetic working people actually run. Three hundred seventy pages, a hundred and one numbered hustles across thirteen chapters, each one printed with its real dollar range and a Know Your Limit panel that states the downside flat. Tonight covers seventeen under five hundred dollars; the book runs the same math on the other eighty-four."
    ),
    beat(
      5,
      "Q",
      197.957,
      219.548,
      "There’s a QR code on your screen — aim your phone’s camera at it, and the page opens on its own. If it’s gone before you look up, the first line of this video’s description lands in the same place."
    ),
  ];

  it("the cover finishes 'run.' and the host comes back in the pause, not on 'seventy'", () => {
    const r = enforcePlanRules(block(), params, { words: words(), silences });
    const cover = r.scenes.find(s => s.coverHero)!;
    const host = r.scenes[r.scenes.indexOf(cover) + 1];
    expect(cover.scriptText).toMatch(/working people actually run\.$/);
    expect(host.scriptText).toMatch(/^Three hundred seventy pages,/);
    expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(179.146);
    expect(cover.narrationEndSec!).toBeLessThanOrEqual(179.958);
    expect(host.narrationStartSec).toBeCloseTo(cover.narrationEndSec!, 5);
  });

  describe("a sentence that ENDS on a number the script spells out (job 413 at 2:03)", () => {
    // "…priced twenty-five to seventy-five dollars. | Nine times out of ten…": the script spells the
    // price, the transcriber heard "$75.", so the gate never found "dollars." among the heard words
    // and the word share alone placed the cut — a word off: after "Nine", 125.23, so the cover kept
    // "Nine" and the host came back on "times" (from a span starting a scene earlier, between "to" and
    // "$75.", inside the price). The film's own words and pauses, laid out as a book cover finishing
    // its sentence before the host comes back.
    const HEARD_203 =
      "flipping.@116.259-116.639 Every@117.34-117.56 spring,@117.6-118 Marketplace@118.22-118.801 fills@118.881-119.181 up@119.261-119.341 with@119.401-119.521 mowers@119.601-119.942 listed@120.022-120.322 as@120.442-120.562 ran@120.822-121.083 last@121.143-121.423 season,@121.463-121.863 priced@122.103-122.704 $25@122.744-123.064 to@123.124-123.204 $75.@123.284-123.865 Nine@125.026-125.206 times@125.246-125.486 out@125.546-125.646 of@125.686-125.726 ten,@125.806-126.127 the@126.187-126.267 crime@126.307-126.567 is@126.627-126.707 stale@126.767-127.107 fuel@127.187-127.528 and@127.568-127.648 a@127.668-127.708 gummed@127.768-128.028 up@128.068-128.188 carburetor,@128.228-128.849 an@129.269-129.329 afternoon@129.429-129.809 of@129.849-129.91 cleaning,@129.97-130.39 and@130.45-130.55 a@130.57-130.61 $2@130.83-131.11 gasket.@131.151-131.591";
    const heard203 = () =>
      HEARD_203.split(" ").map(tok => {
        const [, word, start, end] = /^(.*)@([\d.]+)-([\d.]+)$/.exec(tok)!;
        return { word, start: Number(start), end: Number(end) };
      });
    const pauses203 = [
      [116.101, 116.237], [116.472, 117.211], [117.943, 118.098], [118.721, 118.848], [120.444, 120.692],
      [121.695, 122.028], [122.94, 123.069], [124.064, 124.902], [127.001, 127.151], [128.703, 129.165],
      [131.215, 131.359], [131.423, 132.171],
    ].map(([start, end]) => ({ start, end }));
    const PRICE = "priced twenty-five to seventy-five dollars.";
    const block203 = (price = PRICE) => [
      beat(1, "H", 110, 117.211, "Three businesses in, and you can already see the pattern: the money lives in the math."),
      beat(2, "B", 117.211, 122.028, "Every spring, Marketplace fills up with mowers listed as ran-last-season,"),
      beat(
        3,
        "H",
        122.028,
        132.171,
        `${price} Nine times out of ten the crime is stale fuel and a gummed-up carburetor — an afternoon of cleaning and a two-dollar gasket.`
      ),
      beat(4, "Q", 132.171, 140, "There’s a QR code on your screen — aim your phone’s camera at it, and the page opens on its own."),
    ];

    it("the cover finishes the price and the host comes back in the pause after it", () => {
      const r = enforcePlanRules(block203(), params, { words: heard203(), silences: pauses203 });
      const cover = r.scenes.find(s => s.coverHero)!;
      const host = r.scenes[r.scenes.indexOf(cover) + 1];
      expect(cover.scriptText).toMatch(/seventy-five dollars\.$/);
      expect(host.scriptText).toMatch(/^Nine times out of ten/);
      expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(124.064);
      expect(cover.narrationEndSec!).toBeLessThanOrEqual(124.902);
      expect(host.narrationStartSec).toBeCloseTo(cover.narrationEndSec!, 5);
    });

    it("unchanged: a sentence ending on a word heard as itself is found by that word", () => {
      // The same line ending on a plain word: "dollars." is replaced by "bucks." in the script and in
      // what was heard, so the word itself anchors the cut — in the same pause.
      const words = heard203().map(x => (x.word === "$75." ? { ...x, word: "bucks." } : x));
      const r = enforcePlanRules(block203("priced twenty-five to seventy-five bucks."), params, {
        words,
        silences: pauses203,
      });
      const cover = r.scenes.find(s => s.coverHero)!;
      expect(cover.scriptText).toMatch(/seventy-five bucks\.$/);
      expect(cover.narrationEndSec!).toBeGreaterThanOrEqual(124.064);
      expect(cover.narrationEndSec!).toBeLessThanOrEqual(124.902);
    });
  });
});

describe("the film never ends on a host shot under a second (the audit's last open item)", () => {
  // A goodbye on the host under a second goes to the beat before it: a host take becomes one take
  // with it, anything else plays on to the end. (The audit's 21 production films all had it right
  // after the end QR card, which it never joins — see the operator cases.)
  const closing = (r: { unresolved: { detail: string }[] }) =>
    r.unresolved.filter(f => /^closing host shot/.test(f.detail));

  it("names only the LAST beat, and only a measured one under a second", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["H", 0.7, "Right."],
      ["P", 6, sentence(2)],
      ["H", 0.8, "See you next week."],
    ]);
    const found = checkPlan(scenes, params).findings.filter(f => /^closing host shot/.test(f.detail));
    expect(found).toEqual([
      expect.objectContaining({ rule: 7, scene: 4, detail: expect.stringContaining("(0.80s)") }),
    ]);
    // A beat with no length yet is not measured: nothing to say about it.
    const unmeasured = scenes.map((s, k) =>
      k === 3 ? { ...s, narrationStartSec: undefined, narrationEndSec: undefined, audioDuration: undefined } : s
    );
    expect(checkPlan(unmeasured, params).findings.some(f => /^closing host shot/.test(f.detail))).toBe(false);
    expect(CLOSING_HOST_MIN_SEC).toBe(1);
  });

  it("job 45's shape: the goodbye after a picture goes to that picture, which runs to the end", () => {
    const scenes = film([
      ["H", 6, "There is a bag somewhere in your house that holds the end of every project you have ever finished."],
      ["P", 5, "and every so often you look at it and close it again. But there is a blanket"],
      ["P", 2, "that was built for exactly that bag,"],
      ["P", 4.67, "and the whole thing turns on one decision you make at the end of every square,"],
      ["H", 0.8, "not at the beginning."],
    ]);
    const end = scenes[4].narrationEndSec;
    const r = enforcePlanRules(scenes, params);
    expect(closing(r)).toEqual([]);
    expect(r.scenes).toHaveLength(4);
    const last = r.scenes[3];
    expect(last.hostPresent).toBeFalsy();
    expect(last).toMatchObject({
      scriptText: "and the whole thing turns on one decision you make at the end of every square, not at the beginning.",
      showSubject: "thing 4",
      narrationStartSec: 13,
      narrationEndSec: end,
    });
    expect(last.audioUrl).toBeUndefined();
    // The picture before it is not touched: the host is not handed its sentence back.
    expect(r.scenes[2]).toMatchObject({ scriptText: "that was built for exactly that bag,", audioUrl: "https://example.com/2.mp3" });
    expect(r.fixes).toContainEqual(expect.stringMatching(/^closing host shot at scene 5 \(0\.80s\) folded into the picture before it/));
  });

  it("a full-frame host take before it becomes one take with the goodbye", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 8, "That's the whole trick, and it costs you nothing."],
      ["H", 0.6, "See you next week."],
    ]);
    scenes[3].hostProtected = true;
    const r = enforcePlanRules(scenes, params);
    expect(closing(r)).toEqual([]);
    expect(r.scenes).toHaveLength(3);
    expect(r.scenes[2]).toMatchObject({
      hostPresent: true,
      hostProtected: true,
      scriptText: "That's the whole trick, and it costs you nothing. See you next week.",
      narrationStartSec: 11,
      narrationEndSec: 19.6,
    });
    expect(r.fixes).toContainEqual(expect.stringMatching(/joined the host take before it$/));
  });

  it("a split screen or a list item before it keeps its picture (and the list its mark)", () => {
    const split = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 7, "And that is all the glue it ever needs."],
      ["H", 0.7, "Go build it."],
    ]);
    split[2].splitVisual = "the glued joint drying in the clamp";
    const r = enforcePlanRules(split, params);
    expect(r.scenes.at(-1)).toMatchObject({
      hostPresent: true,
      splitVisual: "the glued joint drying in the clamp",
      scriptText: "And that is all the glue it ever needs. Go build it.",
    });
    expect(r.fixes).toContainEqual(expect.stringMatching(/folded into the split screen before it, which runs to the end$/));

    const list = film([
      ["H", 5, sentence(1)],
      ["P", 3, "You need three things:"],
      ["P", 0.9, "a saw,"],
      ["P", 0.9, "a drill,"],
      ["P", 1.2, "and some glue."],
      ["H", 0.7, "Go build it."],
    ]);
    for (const k of [2, 3, 4]) Object.assign(list[k], { listCut: true, wordCut: true });
    const l = enforcePlanRules(list, params);
    expect(l.scenes.at(-1)).toMatchObject({
      listCut: true,
      showSubject: "thing 5",
      scriptText: "and some glue. Go build it.",
    });
    expect(l.scenes.at(-1)?.hostPresent).toBeFalsy();
  });

  it("a long closing host take stays as it is", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 3.6, "Keep all ten fingers. See you at the bench."],
    ]);
    expect(checkPlan(scenes, params).findings.some(f => /^closing host shot/.test(f.detail))).toBe(false);
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes).toHaveLength(3);
    expect(r.scenes[2]).toMatchObject({
      hostPresent: true,
      scriptText: "Keep all ten fingers. See you at the bench.",
      narrationStartSec: 11,
      narrationEndSec: 14.6,
      audioUrl: "https://example.com/2.mp3",
    });
    expect(r.scenes[1].scriptText).toBe(sentence(2));
  });

  it("into the end card's release beat (the operator's choice), never across a CTA edge, past the one-take limit, or over a paid render — the job is told", () => {
    const qr = film([
      ["H", 5, sentence(1)],
      ["H", 6, "The whole guide is in the link below."],
      ["P", 6, "Scan the code now."],
      ["H", 0.8, "See you next time."],
    ]);
    Object.assign(qr[1], { cta: true, ctaIndex: 0, qrCorner: true });
    Object.assign(qr[2], { cta: true, ctaIndex: 0, qrHero: true, qrTail: true });
    const r = enforcePlanRules(qr, params);
    expect(closing(r)).toHaveLength(0);
    // the card and its picture run to the end under the goodbye
    expect(r.scenes.at(-1)).toMatchObject({ qrHero: true, scriptText: "Scan the code now. See you next time." });
    expect(r.scenes.at(-1)?.hostPresent).toBeFalsy();

    // A pitch picture of an unmarked CTA (cta, no QR) is still the other side of the edge.
    const edge = film([
      ["H", 5, sentence(1)],
      ["P", 6, "It costs twelve dollars and ships in a day."],
      ["H", 0.8, "See you next time."],
    ]);
    Object.assign(edge[1], { cta: true, ctaIndex: 0 });
    expect(closingFoldTarget(edge, 2)).toBe(-1);

    const long = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 59.5, sentence(3)],
      ["H", 0.7, "See you next week."],
    ]);
    expect(closingFoldTarget(long, 3)).toBe(-1);
    expect(closing(enforcePlanRules(long, params))).toHaveLength(1);

    const paid = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 0.7, "See you next week."],
    ]);
    expect(closingFoldTarget(paid, 2)).toBe(1);
    paid[2].submits = [{ provider: "heygen", at: "x", reason: "first", sec: 0.7 }] as any;
    expect(closingFoldTarget(paid, 2)).toBe(-1);
    // Only the last beat is a closing beat.
    expect(closingFoldTarget(film([["H", 5, sentence(1)], ["H", 0.7, "Right."], ["P", 6, sentence(2)]]), 1)).toBe(-1);
  });
});

describe("a host take never stops right after a preposition (job 408)", () => {
  // Job 408's introduction ended "…This channel is for people in" and the next picture began "older
  // houses and apartments…": the host's last word on camera was "in". A preposition's bare object
  // used to count as a natural break.
  it("the break goes before the preposition, not after it — an article, a count or a name after one still opens a picture", () => {
    expect(breakBetween("I am Werner Finkbeiner. This channel is for people in", "older houses and apartments who would rather understand the cause")).toBe(false);
    expect(breakBetween("I am Werner Finkbeiner. This channel is for people", "in older houses and apartments who would rather understand the cause")).toBe(true);
    expect(breakBetween("My name is Gideon Grant, and this channel is for", "men and women in their fifties, sixties,")).toBe(false);
    expect(breakBetween("My name is Gideon Grant, and this channel is", "for men and women in their fifties, sixties,")).toBe(true);
    // The operator's own breaks after a preposition are kept: an article, a count, a name, a list item.
    expect(breakBetween("the one that paid me best for my time came out of", "a coffee can of burnt scraps")).toBe(true);
    expect(breakBetween("I sold the whole batch for", "forty dollars at the market.")).toBe(true);
    // Any number word is a count — before, the bare-object rule carried the ones the count list lacked.
    expect(breakBetween("the boards sold for", "seventeen dollars apiece.")).toBe(true);
    expect(breakBetween("fifteen minutes fetching around", "fourteen dollars comes to about a dollar an hour")).toBe(true); // job 172
    expect(breakBetween("a pair went for", "thirty-five dollars.")).toBe(true);
    expect(breakBetween("Out of 10 Japanese woodworking projects you can build from", "cheap box-store lumber, the one")).toBe(false); // job 153
    expect(breakBetween("Out of 10 Japanese woodworking projects you can build", "from cheap box-store lumber, the one")).toBe(true);
    expect(breakBetween("I learned it from", "Lucius Annaeus Seneca, of all people.")).toBe(true);
    expect(breakBetween("and this one's for anybody standing in a garage with", "a saw,", { list: true })).toBe(true);
  });

  const werner = { ...params, hostName: "Werner Finkbeiner" } as LongformInputParams;
  const intro = () => {
    const scenes = film([
      ["H", 2.12, "Look at the floor beside your toilet."],
      ["P", 5.17, "That little stretch of tile between the bowl and the wall. In most American bathrooms,"],
      ["P", 6.46, "it is empty. In a German bathroom, usually, a small bin stands there, with a lid."],
      ["P", 8.52, "It is the answer to one plain sentence the water utilities in Germany have repeated for years: the toilet is not a trash can."],
      ["P", 7.76, "Nine things stay out of the toilet there, and in plenty of American homes, most of them go down it in an ordinary week."],
      ["H", 4.35, "One has a word printed on its package that your pipes do not agree with."],
      ["P", 7.47, "One is a thread so thin you would never think it could stop anything, and it can stop a pump a long way from your house."],
      ["P", 9.13, "And besides what your own body sends there, exactly one thing is allowed in the bowl. It was built on purpose to do something the nine cannot."],
      ["H", 3.41, "I am Werner Finkbeiner. This channel is for people in"],
      ["P", 5.02, "older houses and apartments who would rather understand the cause than pay for the visit."],
      ["P", 6.07, "Today we go through all nine, one at a time, and look at what the German habit does instead."],
      ["H", 3.21, "So. We will go the way the water goes."],
      ["P", 2.03, "Flush, and follow."],
      ["P", 6.11, "Each of the nine stops somewhere, and each one stops a little farther from your house than the one before."],
      ["H", 7.13, "Number one never leaves the toilet. Cotton swabs. The little stick with cotton on both ends."],
    ]);
    for (const s of scenes) Object.assign(s, { wordCut: true, minHoldSec: s.hostPresent ? 2 : 1.2 });
    Object.assign(scenes[0], { hostOpener: true });
    Object.assign(scenes[8], { hostIntro: true, hostProtected: true });
    return scenes;
  };

  it("job 408's introduction hands over before 'in', and the picture opens on 'in older houses'", () => {
    const scenes = intro();
    expect(
      checkPlan(scenes, werner).findings.some(f => f.rule === 7 && f.scene === 9 && /ends mid-sentence/.test(f.detail))
    ).toBe(true);
    const r = enforcePlanRules(scenes, werner, { budgetSec: 72 });
    const k = r.scenes.findIndex(s => s.hostIntro);
    expect(r.scenes[k].scriptText).toBe("I am Werner Finkbeiner. This channel is for people");
    expect(r.scenes[k + 1].scriptText).toBe(
      "in older houses and apartments who would rather understand the cause than pay for the visit."
    );
    expect(r.scenes[k].narrationEndSec).toBe(r.scenes[k + 1].narrationStartSec);
    // No host take ends on a preposition anywhere in the film.
    expect(r.scenes.filter(s => s.hostPresent).map(s => s.scriptText)).not.toContainEqual(expect.stringMatching(/\b(?:in|for|with|of)$/));
  });

  it("a take that hands over before an article after a preposition is left as it is", () => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", 3.5, "And the one that paid me best for my time came out of"],
      ["P", 4, "a coffee can of burnt scraps I almost threw in the trash."],
      ["P", 6, sentence(3)],
      ["H", 5, sentence(4)],
    ]);
    scenes[2].wordCut = true;
    scenes[3].wordCut = true;
    expect(checkPlan(scenes, params).findings.filter(f => f.rule === 7 && /ends mid-sentence/.test(f.detail))).toEqual([]);
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes.map(s => s.scriptText)).toEqual(scenes.map(s => s.scriptText));
  });

  // Job 189's shot list handed over right after "into", before the thing a picture shows. The sentence
  // is short enough to finish on the host, and finishing it came first: replayed, the host said the
  // patterns and their picture was dropped. Handing over before the preposition comes ahead of that.
  const ends = (scenes: StoryboardScene[]) =>
    checkPlan(scenes, params).findings.filter(f => f.rule === 7 && /ends mid-sentence/.test(f.detail));
  const kumiko = (hostText: string, hostSec: number) => {
    const scenes = film([
      ["H", 5, sentence(1)],
      ["P", 6, sentence(2)],
      ["H", hostSec, hostText],
      ["P", 3.5, "patterns, the kind of lattice you see in Japanese sliding doors."],
      ["P", 6, sentence(3)],
      ["H", 5, sentence(4)],
    ]);
    scenes[2].wordCut = true;
    scenes[3].wordCut = true;
    return scenes;
  };

  it("a check-in that stops on 'into' hands over before it — the picture of the patterns stays, the host does not say them", () => {
    const scenes = kumiko("Kumiko is the Japanese craft of fitting thin strips of wood together into", 4);
    expect(ends(scenes).map(f => f.scene)).toEqual([3]);
    const r = enforcePlanRules(scenes, params);
    expect(r.scenes.map(s => s.scriptText)).toEqual([
      sentence(1),
      sentence(2),
      "Kumiko is the Japanese craft of fitting thin strips of wood together",
      "into patterns, the kind of lattice you see in Japanese sliding doors.",
      sentence(3),
      sentence(4),
    ]);
    expect(r.scenes[2].hostPresent).toBe(true);
    expect(r.scenes[3].hostPresent).toBeFalsy();
    expect(r.scenes[2].narrationEndSec).toBe(r.scenes[3].narrationStartSec);
    expect(ends(r.scenes)).toEqual([]);
  });

  it("a take too short to give the preposition back still finishes its sentence, as before", () => {
    // Three words before "into" — under `HOST_HANDOFF_MIN_WORDS` — so nothing can go back.
    const r = enforcePlanRules(kumiko("Kumiko fits strips into", 2.5), params);
    expect(r.scenes[2].scriptText).toBe(
      "Kumiko fits strips into patterns, the kind of lattice you see in Japanese sliding doors."
    );
    expect(r.scenes.map(s => s.scriptText)).toEqual([sentence(1), sentence(2), r.scenes[2].scriptText, sentence(3), sentence(4)]);
  });
});

describe("a host take never stops between a word that says nothing on its own and the clause describing it (job 414)", () => {
  // Job 414's cold open stopped "Go through an old mountain cabin looking for anything | a store sold,
  // and you will come up nearly empty-handed." — "a" after "anything" counted as a picture's new noun
  // phrase, but "a store sold" is what "anything" means, and the host's last word on camera said
  // nothing.
  it("no break before the clause that says what 'anything', 'someone', 'the one' or 'the kind' is", () => {
    const notBreaks: [string, string][] = [
      ["Go through an old mountain cabin looking for anything", "a store sold, and you will come up nearly empty-handed."], // job 414
      ["Look for anything", "that a store sold."],
      ["This channel is for anyone", "who has a garage and a free Saturday."],
      ["I want to show you something", "my grandfather made every winter."],
      ["Out of everything", "I sold at the market that year, the boards paid best."],
      ["It was the kind", "your grandmother kept in a kitchen drawer."],
      ["The board that sold first was the one", "I almost threw away."],
      ["Rive it the only way", "the old-timers did, along the grain."],
      ["You will find nothing", "two hands could not mend."],
      ["You can see everything", "Grandpa built in that barn."],
    ];
    for (const [before, after] of notBreaks) expect(breakBetween(before, after), before).toBe(false);
  });

  it("…but a joining word, a clause word or a preposition after one still opens a picture, and other nouns keep their breaks", () => {
    const breaks: [string, string][] = [
      ["I lost everything", "and started over the next spring."],
      ["The old-timers would mend anything", "before they would buy new."],
      ["Look for anything", "on the bottom shelf of the cabinet."], // a preposition with its object, as before
      ["Somewhere on the way", "the truck lost a wheel."], // "on the way" waits for nothing
      ["that's about $4 for every hour", "I sat at that machine,"], // job 159: an ordinary noun
      ["and the first one drew a crowd", "I didn't know lived in my town."], // job 153
      ["The roof was split oak, the walls were hewn poplar, and the door hung on wooden pins with", "a string for a lock."],
    ];
    for (const [before, after] of breaks) expect(breakBetween(before, after), before).toBe(true);
  });

  // Job 414's opening, with its real ranges: the host finishes the sentence (inside the hook's
  // ceiling and the host minutes); the next picture is untouched.
  const opening = (hostText: string, picText: string) => {
    const scenes = film([
      ["H", 2.612, hostText],
      ["P", 4.542, picText],
      ["P", 4.64, "A log restorer in Grayson County, Virginia, let me try it."],
      ["H", 9.948, "The roof was split oak, the walls were hewn poplar, and the door hung on wooden pins with a string for a lock."],
    ]);
    for (const s of scenes) Object.assign(s, { wordCut: true, minHoldSec: s.hostPresent ? 2 : 1.2 });
    Object.assign(scenes[0], { hostOpener: true, hostProtected: true });
    return scenes;
  };
  const sam = { ...params, hostName: "Sawdust Sam" } as LongformInputParams;

  it("job 414's cold open says the whole sentence instead of stopping on 'anything'", () => {
    const scenes = opening(
      "Go through an old mountain cabin looking for anything",
      "a store sold, and you will come up nearly empty-handed."
    );
    expect(
      checkPlan(scenes, sam).findings.some(f => f.rule === 7 && f.scene === 1 && /at no natural break/.test(f.detail))
    ).toBe(true);
    const r = enforcePlanRules(scenes, sam, { budgetSec: 61.76 });
    expect(r.scenes[0].hostPresent).toBe(true);
    expect(r.scenes[0].scriptText).toBe(
      "Go through an old mountain cabin looking for anything a store sold, and you will come up nearly empty-handed."
    );
    expect(r.scenes[0].narrationEndSec).toBeCloseTo(7.154, 3);
    expect(r.scenes[1].scriptText).toBe("A log restorer in Grayson County, Virginia, let me try it.");
    expect(r.scenes[1].narrationStartSec).toBeCloseTo(7.154, 3);
  });

  it("unchanged: a cold open that hands over at a joining word after 'everything'", () => {
    const scenes = opening("Go through an old mountain cabin and you will find everything", "and nothing a store ever sold.");
    expect(checkPlan(scenes, sam).findings.filter(f => f.rule === 7 && /mid-sentence/.test(f.detail))).toEqual([]);
    const r = enforcePlanRules(scenes, sam, { budgetSec: 61.76 });
    expect(r.scenes.map(s => s.scriptText)).toEqual(scenes.map(s => s.scriptText));
  });

  // The same rule on a line two practice channels opened with (jobs 117-156 and 390): the
  // storyboard's word-count cut left "…cheap box-store lumber, the one" on the host and "that paid me
  // best…" on the picture, accepted as a long sentence's L-cut at the break before "that". Too long
  // to finish inside the hook, the take now hands over at its own comma, and the picture opens on
  // "the one that paid me best".
  it("an opening that stopped on 'the one' before 'that paid me best' hands over at its comma (jobs 117-156, 390)", () => {
    expect(
      breakBetween(
        "Out of 10 Japanese woodworking projects you can build from cheap box-store lumber, the one",
        "that paid me best for my time came out of a coffee can of burnt scraps I almost threw in the trash."
      )
    ).toBe(false);
    const scenes = film([
      ["H", 7.44, "Out of 10 Japanese woodworking projects you can build from cheap box-store lumber, the one"],
      ["P", 7.84, "that paid me best for my time came out of a coffee can of burnt scraps I almost threw in the trash."],
      ["P", 5.22, "But the one I was proudest of, a lattice panel, paid the least."],
      ["H", 6, sentence(1)],
    ]);
    Object.assign(scenes[0], { hostOpener: true, hostProtected: true, minHoldSec: 2 });
    const r = enforcePlanRules(scenes, params, { budgetSec: 47.78 });
    expect(r.scenes[0].scriptText).toBe("Out of 10 Japanese woodworking projects you can build from cheap box-store lumber,");
    expect(r.scenes[1].scriptText).toMatch(/^the one that paid me best for my time/);
    expect(r.scenes[1].narrationStartSec).toBe(r.scenes[0].narrationEndSec);
    expect(r.scenes[2].scriptText).toBe(scenes[2].scriptText);
  });

  it("'the same way' waits for its clause; 'on the way', 'that way' and a phrase a comma closed do not", () => {
    expect(breakBetween("Indoor cats inherited that schedule the same way", "she inherited her whiskers.")).toBe(false); // job 405
    expect(breakBetween("Somewhere on the way", "the truck lost a wheel.")).toBe(true);
    expect(breakBetween("Split it that way", "the grain stays whole.")).toBe(true);
    expect(breakBetween("Stack the boards, one", "a week, until the spring market.")).toBe(true);
  });
});
