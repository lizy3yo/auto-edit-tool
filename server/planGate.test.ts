import { describe, expect, it } from "vitest";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import { breakBetween, capMovingLength, checkPlan, enforcePlanRules, len, topicOf } from "./planGate";

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

  it("knows a break from the words alone: a comma, a list, a joining word, an article, a name, a count, a preposition's object", () => {
    const breaks: [string, string, boolean?][] = [
      ["Today, with the help of a Roman who wrote the sharpest essay on time ever put to paper,", "I want to show you"],
      ["and this one's for anybody standing in a garage with", "a saw,", true],
      ["the one that paid me best for my time came out of", "a coffee can of burnt scraps I almost threw in the trash."],
      ["Two thousand years ago, a man named", "Lucius Annaeus Seneca wrote a short,"],
      ["My name is Gideon Grant, and this channel is for", "men and women in their fifties, sixties,"],
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
