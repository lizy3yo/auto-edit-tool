import { describe, expect, it } from "vitest";
import type { LongformInputParams, StoryboardScene } from "@shared/types";
import { capMovingLength, checkPlan, enforcePlanRules, len, topicOf } from "./planGate";

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
