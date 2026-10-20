import { describe, expect, it } from "vitest";
import type { ResolvedCue, Word } from "../cueResolve";
import { labelHead, labelProblem, listPicturesHidden, namedAs, namesThePicture, pictureNote, pictureOf, pictureProblem, picturesUnder, videoHidden } from "./pictures";
import { systemPrompt, userPrompt } from "./planner";
import type { FilmLayout, LayoutScene } from "./rules";

// Every scene and placed graphic below is the stored one (local DB, read only): jobs 385-413, the
// round-13 verification films and the practice films before them.
const scene = (index: number, a: number, b: number, extra: Partial<LayoutScene> = {}): LayoutScene => ({ index, narrationStartSec: a, narrationEndSec: b, hostPresent: false, cta: false, ...extra });
const placed = (id: string, template: string, start: number, end: number, props: Record<string, unknown> = {}, sync: ResolvedCue["sync"] = []) =>
  ({ id, template, start, end, props: { durationSec: end - start, ...props }, sync, conformed: { start: false, end: false }, startFrame: Math.round(start * 30), endFrame: Math.round(end * 30) }) as ResolvedCue;
const W = (s: string): Word[] =>
  s.split(" ").map(t => {
    const [text, range] = t.split("@");
    const [start, end] = range.split("-").map(Number);
    return { text, start, end };
  });

describe("what a picture shows is read off the storyboard (round 13: the planner saw only 'B-ROLL')", () => {
  it("409 scene 22: a still of a person, who it is", () => {
    expect(
      pictureOf({
        stillImage: true,
        showSubject: "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side",
        visualPrompt: "An off-white wool toga draped over a left shoulder in deep folds, a reed pen in hand writing on a scroll, lamplight on the face of the scroll, seen from the side.",
        otherPerson: "Seneca, a Roman writer",
        humanPresent: true,
      } as never)
    ).toEqual({
      shows: "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side",
      person: "Seneca, a Roman writer",
      video: false,
    });
  });

  it("408 scene 3: a moving clip, its key things; 410 scene 29: one step's own picture; a list of things", () => {
    expect(pictureOf({ objectMotion: true, showSubject: "a small white plastic bin with a closed hinged lid", keyThing: "bin", otherKeyThings: ["toilet"] } as never)).toEqual({
      shows: "a small white plastic bin with a closed hinged lid",
      things: ["bin", "toilet"],
      video: true,
    });
    expect(pictureOf({ stillImage: true, listCut: true, listKind: "steps", showSubject: "rows of passengers each holding a snack and a drink" })).toMatchObject({ listItem: "step", video: false });
    expect(pictureOf({ stillImage: true, listCut: true, showSubject: "a church pew" })).toMatchObject({ listItem: "item" });
  });

  it("a cutaway with neither the still flag nor a motion flag (a storyboard older than the still lane) is not taken for a video", () => {
    expect(pictureOf({ showSubject: "a wooden bench in a garage" }).video).toBe(false);
    expect(pictureOf({ humanPresent: true, showSubject: "hands sanding a board" }).video).toBe(true);
  });

  it("the picture's own description stands in when the shot list wrote no subject; a part and its thing are one thing", () => {
    expect(pictureOf({ stillImage: true, visualPrompt: "A worn old book lying closed on a wooden table." })).toEqual({ shows: "A worn old book lying closed on a wooden table.", video: false });
    expect(pictureOf({ stillImage: true, showSubject: "close view of water swirling down", keyThing: "toilet", partOf: "toilet" }).things).toEqual(["toilet"]);
  });

  it("a host take, a CTA beat, the book cover, the QR card and an operator's asset have no picture for the planner", () => {
    for (const s of [{ hostPresent: true, showSubject: "white porcelain toilet" }, { cta: true }, { coverHero: true, cta: true }, { qrHero: true }, { assetImageUrl: "https://x/a.png" }]) expect(pictureOf(s)).toEqual({});
  });

  it("the scene list names it — and a scene the film says nothing about reads as it always did", () => {
    expect(pictureNote(scene(29, 141.288, 143.286, { video: false, listItem: "step", shows: "rows of passengers each holding a snack and a drink" }))).toBe(" STILL, STEP PICTURE {shows: rows of passengers each holding a snack and a drink}");
    expect(pictureNote(scene(3, 7.29, 13.75, { video: true, things: ["bin", "toilet"] }))).toBe(" VIDEO {thing: bin, toilet}");
    expect(pictureNote(scene(35, 179.9, 188.7))).toBe("");
    const film = { scenes: [scene(35, 179.9, 188.7, { scriptText: "Put the $10 to $40 items along the front edge." })] };
    expect(userPrompt(film, [])).toContain("#35 2:59.9-3:08.7 B-ROLL: Put the $10 to $40 items along the front edge.");
  });

  it("the planner is told the rules before it writes", () => {
    const prompt = systemPrompt({ kept: false });
    expect(prompt).toContain("A SmallLabel names what\n  ITS picture shows (its shows / person / thing)");
    expect(prompt).toContain("A full-screen card or a Quote never hides a VIDEO whole: leave at least\n  1.5 s of it in view");
    expect(prompt).toContain("StepLabels for steps, a ListWindow, Checklist or IconLabels for things — never a full-screen card that\n  hides those pictures.");
    expect(prompt).toContain("- StepCards — gives 2-4 steps the viewer should do, when the steps have no pictures of their own (over STEP PICTURE scenes, StepLabels)");
  });
});

describe("a label names what its picture shows (409's 'Paulinus' on the picture of Seneca)", () => {
  it("the word a label names its thing by", () => {
    expect(labelHead("A toilet auger")).toBe("auger");
    expect(labelHead("Lucius Annaeus Seneca")).toBe("seneca");
    expect(labelHead("On the Shortness of Life")).toBe("shortness");
    expect(labelHead("Federal Aviation Rules")).toBe("rule");
    expect(labelHead("The Foxfire books")).toBe("book");
    expect(labelHead("Paulinus")).toBe("paulinus");
    expect(labelHead("the")).toBeUndefined();
  });

  it("the noun the narrator names a label by, said right before it", () => {
    expect(namedAs(["The", "essay", "is", "called"])).toBe("essay");
    expect(namedAs(["to", "a", "man", "named"])).toBe("man");
    expect(namedAs(["a", "fitting", "known", "as"])).toBe("fitting");
    expect(namedAs(["the", "official", "in", "charge"])).toBeUndefined();
  });

  // Every SmallLabel the stored plans placed, on the picture it sat on.
  const auger = scene(23, 134.693, 139.444, { video: false, shows: "toilet auger hooked tip inserted into toilet bowl trapway opening", things: ["toilet auger"] });
  const senecaWriting = scene(22, 100.675, 109.896, { video: false, shows: "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side", person: "Seneca, a Roman writer" });
  it("kept: each names what its picture shows (408, 409, 401, 398, 407, 413)", () => {
    expect(namesThePicture("A toilet auger", auger)).toBe(true);
    expect(namesThePicture("Seneca", senecaWriting)).toBe(true);
    expect(namesThePicture("Lucius Annaeus Seneca", scene(22, 101.008, 110.599, { shows: "a Roman man in a toga writing on a scroll at a wooden desk by lamplight", person: "Seneca, a Roman writer" }))).toBe(true);
    expect(namesThePicture("Lattice panel", scene(3, 14.83, 24.88, { shows: "a one-foot-square kumiko lattice of thin pale pine strips crossing in an even square grid", things: ["lattice panel", "workbench"] }))).toBe(true);
    expect(namesThePicture("Burnt scraps", scene(2, 9.79, 14.83, { shows: "small finished charred-wood pieces with dark blackened edges laid on the workbench beside the dented coffee can of burnt scraps", things: ["coffee can of burnt scraps", "workbench"] }))).toBe(true);
    expect(namesThePicture("The Foxfire books", scene(11, 52.17, 55.58, { shows: "a worn old book lying closed on a wooden table" }))).toBe(true);
    expect(namesThePicture("A mower blade", scene(19, 70.33, 74.92, { shows: "a dull steel mower blade with a nicked curved edge leaning against the wall of a garden shed", things: ["mower blade"] }))).toBe(true);
  });

  it("refused: a name the line says while the picture shows someone or something else (409, 410, 402, 404)", () => {
    expect(namesThePicture("Paulinus", senecaWriting)).toBe(false);
    expect(namesThePicture("Federal Aviation Rules", scene(22, 96.509, 108.695, { shows: "a zipped carry-on bag stowed under a seat", things: ["carry-on bag"] }))).toBe(false);
    expect(namesThePicture("Federal Aviation Rules", scene(22, 105.129, 117.424, { shows: "a miniature liquor bottle sealed and tucked in a black carry-on bag under the seat", things: ["small liquor bottle", "carry-on bag"] }))).toBe(false);
    // what the robin sings is not a thing the picture shows; a caption can carry it
    expect(namesThePicture("Cheer up, cheerily", scene(18, 117.449, 128.839, { shows: "a male robin singing with its beak open on a branch at sunrise in spring", things: ["robin"] }))).toBe(false);
  });

  it("a name the narrator gives a THING counts by the noun he names it by — never a person's", () => {
    // 401: "The essay is called On the Shortness of Life" over the essay's own manuscript page
    const page = scene(27, 145.474, 153.108, { shows: "Close-up of an open aged manuscript page filling the frame, the essay's title written in ink across the top of the page" });
    expect(namesThePicture("On the Shortness of Life", page)).toBe(false);
    expect(namesThePicture("On the Shortness of Life", page, "essay")).toBe(true);
    // 409: the same words over "the host reading a book" — the picture is no page of the essay
    expect(namesThePicture("On the Shortness of Life", scene(28, 144.483, 156.109, { shows: "the host reading a book at the desk in the study" }), "essay")).toBe(false);
    // "a man named Paulinus": any picture of a man would pass, so a person's name must be the picture's own
    expect(namesThePicture("Paulinus", senecaWriting, "man")).toBe(false);
    expect(namesThePicture("Paulinus", scene(22, 0, 9, { shows: "a man in an off-white toga writing on a scroll" }), "man")).toBe(false);
  });

  it("the noun is read off the words said before the label: 401's title on its page is kept, 409's on a book in the host's hands is not", () => {
    const sync = (word: string, at: number) => [{ element: `.at "${word}"`, word, wordStart: at }];
    const p401 = W("The@145.573-145.693 essay@145.813-146.133 is@146.213-146.293 called@146.373-146.673 On@147.149-147.229 the@147.269-147.369 Shortness@147.469-147.97 of@148.15-148.23 Life,@148.35-148.63");
    const page = { scenes: [scene(27, 145.474, 153.108, { video: false, shows: "Close-up of an open aged manuscript page filling the frame, the essay's title written in ink across the top of the page" })] };
    expect(labelProblem(placed("essay-title", "SmallLabel", 145.467, 148.933, { text: "On the Shortness of Life" }, sync("On", 147.149)), [], page, p401)).toBeUndefined();
    const p409 = W("The@144.6-144.7 essay@144.82-145.1 is@145.16-145.24 called@145.32-145.66 on@146.097-146.177 the@146.217-146.317 shortness@146.417-146.937 of@147.097-147.177 life,@147.277-147.577");
    const book = { scenes: [scene(28, 144.483, 156.109, { video: false, shows: "the host reading a book at the desk in the study" })] };
    expect(labelProblem(placed("essay-title", "SmallLabel", 144.467, 147.733, { text: "On the Shortness of Life" }, sync("on", 146.097)), [], book, p409)).toMatch(/^"On the Shortness of Life" is not what the picture under it shows — scene #28 shows "the host reading a book/);
  });

  it("a picture the film says nothing about cannot be judged, and passes", () => {
    expect(namesThePicture("Paulinus", scene(22, 100.675, 109.896))).toBe(true);
  });

  it("one picture, one name: a second name on a picture already named is refused; the same name again is not", () => {
    const film: FilmLayout = { scenes: [scene(22, 100.675, 109.896), scene(23, 109.896, 117.23)] };
    const words = W("a@108.057-108.097 man@108.157-108.377 named@108.437-108.677 Paulinus,@108.757-109.437");
    const first = placed("seneca-name", "SmallLabel", 103.933, 105.7, { text: "Seneca" });
    const second = placed("paulinus-label", "SmallLabel", 107.733, 109.9, { text: "Paulinus" }, [{ element: '.at "Paulinus"', word: "Paulinus,", wordStart: 108.757 }]);
    expect(labelProblem(second, [first, second], film, words)).toMatch(/^the picture of scene #22 is already labelled "Seneca" \(seneca-name\) — one picture, one name/);
    expect(labelProblem(placed("again", "SmallLabel", 107.733, 109.9, { text: "Lucius Annaeus Seneca" }), [first], film, words)).toBeUndefined();
    // the first name on the picture is no second one; a picture beside it is another picture
    expect(labelProblem(first, [first], film, words)).toBeUndefined();
    expect(labelProblem(placed("official", "SmallLabel", 110.1, 112.4, { text: "Paulinus" }), [first], film, words)).toBeUndefined();
  });

  it("a label up over two pictures must name both; an edge on the cut is not on the next picture", () => {
    const film: FilmLayout = { scenes: [auger, scene(24, 139.444, 146.224, { shows: "a plunger standing upright beside the toilet", things: ["plunger"] })] };
    expect(picturesUnder({ start: 134.7, end: 139.6 }, film).map(s => s.index)).toEqual([23]);
    expect(labelProblem(placed("auger", "SmallLabel", 134.7, 139.6, { text: "A toilet auger" }), [], film, [])).toBeUndefined();
    expect(labelProblem(placed("auger", "SmallLabel", 134.7, 140.6, { text: "A toilet auger" }), [], film, [])).toMatch(/^"A toilet auger" is not what the picture under it shows — scene #24 shows "plunger"/);
  });
});

describe("a card never hides a whole video, or a spoken list's own pictures (408, 410)", () => {
  const video = (index: number, a: number, b: number) => scene(index, a, b, { video: true });
  it("408: the Versus card left nothing of video scene 3 in view — refused; scene 2 kept 3.55 s of its 5.17", () => {
    const film: FilmLayout = { scenes: [scene(1, 0, 2.1165, { hostPresent: true }), video(2, 2.1165, 7.28991), video(3, 7.28991, 13.7519), scene(4, 13.7519, 22.2734, { hostPresent: true })] };
    const versus = placed("american-vs-german-floor", "Versus", 5.667, 13.767);
    expect(videoHidden(versus, [versus], film)).toEqual({ scene: film.scenes[2], seen: 0 });
    // the same card held to scene 2 alone would leave both videos in view
    expect(videoHidden(placed("v", "Versus", 2.2, 5.6), [], film)).toBeUndefined();
  });

  it("kept: a card over PART of a video (396's '3 minutes', 403's 'stiff stick', 385's Versus)", () => {
    expect(videoHidden(placed("three-minutes", "BigNumber", 58.6, 63.3), [], { scenes: [video(11, 56.0024, 63.2845)] })).toBeUndefined();
    expect(videoHidden(placed("stiff-stick", "Statement", 102.167, 105.5), [], { scenes: [video(17, 94.0721, 105.51)] })).toBeUndefined();
    expect(videoHidden(placed("06-versus-type", "Versus", 74.3, 81.467), [], { scenes: [video(12, 77.08, 85.793)] })).toBeUndefined();
  });

  it("405: a short video (2.24 s) wholly under a step card is refused; it needs half its length in view", () => {
    const film: FilmLayout = { scenes: [scene(14, 57.5969, 58.6526), scene(15, 58.6526, 59.7151), video(16, 59.7151, 61.9524)] };
    expect(videoHidden(placed("decode-steps", "StepCards", 57.6, 61.967), [], film)?.scene.index).toBe(16);
    expect(videoHidden(placed("decode-steps", "StepCards", 57.6, 60.8), [], film)).toBeUndefined();
  });

  it("a Quote blurs the footage and counts; a window plays it in its frame and a darkening leaves it in view", () => {
    const film: FilmLayout = { scenes: [video(3, 7.28991, 13.7519)] };
    expect(videoHidden(placed("q", "Quote", 7.29, 13.75), [], film)).toBeDefined();
    expect(videoHidden(placed("w", "ListWindow", 7.29, 13.75), [], film)).toBeUndefined();
    expect(videoHidden(placed("d", "DimCaption", 7.29, 13.75), [], film)).toBeUndefined();
  });

  it("two cards that between them hide all of a video: the new one is refused", () => {
    const film: FilmLayout = { scenes: [video(3, 7.28991, 13.7519)] };
    const kept = placed("kept-card", "Statement", 7.29, 10.2);
    const next = placed("new-card", "FactCard", 11.2, 13.75);
    expect(videoHidden(next, [kept], film)?.seen).toBeCloseTo(1, 2);
    expect(videoHidden(next, [], film)).toBeUndefined();
  });

  const steps = (index: number, a: number, b: number) => scene(index, a, b, { video: false, listItem: "step" });
  it("410: the step card over all three step pictures is refused, and pointed to StepLabels", () => {
    const film: FilmLayout = { scenes: [scene(28, 128.869, 141.288), steps(29, 141.288, 143.286), steps(30, 143.286, 147.619), steps(31, 147.619, 149.553)] };
    const card = placed("snack-steps", "StepCards", 141.3, 149.567);
    expect(listPicturesHidden(card, film).map(s => s.index)).toEqual([29, 30, 31]);
    expect(pictureProblem(card, [card], film, [])).toMatch(/^StepCards hides the pictures of 3 spoken steps \(scenes #29, #30, #31\), each drawn for its own step\. .* StepLabels for the steps/);
    // over the footage, the same steps are not hidden
    expect(pictureProblem(placed("snack-step-labels", "StepLabels", 141.3, 149.567), [], film, [])).toBeUndefined();
  });

  it("389: a Quote that blurs two list pictures is refused the same way; 392: a card over one is not", () => {
    const items = (index: number, a: number, b: number) => scene(index, a, b, { video: false, listItem: "item" });
    const dale: FilmLayout = { scenes: [scene(42, 226.894, 235.847, { hostPresent: true }), items(43, 235.847, 236.891), items(44, 236.891, 237.963), items(45, 237.963, 240.119)] };
    expect(pictureProblem(placed("closing-quote", "Quote", 235.833, 237.967), [], dale, [])).toMatch(/^Quote hides the pictures of 2 spoken list items \(scenes #43, #44\).* a ListWindow, Checklist or IconLabels for the items, a DimCaption for a line/);
    const pearl: FilmLayout = { scenes: [scene(29, 183.052, 187.977), items(30, 187.977, 190.922), items(31, 190.922, 193.03)] };
    expect(listPicturesHidden(placed("two-things-steps", "StepCards", 185.367, 190.933), pearl).map(s => s.index)).toEqual([30]);
    expect(pictureProblem(placed("two-things-steps", "StepCards", 185.367, 190.933), [], pearl, [])).toBeUndefined();
  });

  it("410: the spoken-lists note offers StepCards only for steps with no pictures of their own, as the catalogue does", async () => {
    // It said "steps may be StepCards or StepLabels", so a steps list over its own step pictures was
    // invited to the very card the check then refused.
    const { planGraphics } = await import("./planner");
    const told: string[] = [];
    const words = W(
      "So@141.115-141.275 wait@141.355-141.555 until@141.595-141.875 everyone's@142.015-142.415 been@142.455-142.615 served,@142.675-143.115 then@143.496-143.716 catch@143.756-143.996 a@144.036-144.056 flight@144.096-144.336 attendant@144.356-144.736 as@144.796-144.876 they@144.916-145.056 pass@145.116-145.556 or@146.076-146.276 step@146.356-146.596 back@146.636-146.796 to@146.836-146.936 the@146.956-147.016 galley@147.056-147.477 and@147.757-147.857 phrase@147.917-148.197 it@148.257-148.317 as@148.417-148.497 an@148.537-148.597 offer.@148.737-149.057"
    );
    const film: FilmLayout = { scenes: [steps(29, 141.288, 143.286), steps(30, 143.286, 147.619), steps(31, 147.619, 149.553)] };
    const lists = [{ kind: "steps" as const, items: ["wait until everyone's been served", "catch a flight attendant as they pass or step back to the galley", "phrase it as an offer"] }];
    await planGraphics({ words, film, lists, ensureIcon: async () => true, ask: async (_s, m) => (told.push(m[m.length - 1].content), JSON.stringify({ cues: [] })) });
    expect(told[0]).toContain("steps may be StepLabels, or StepCards when the steps have no pictures\nof their own)");
    expect(told[0]).not.toContain("steps may be StepCards or StepLabels");
  });

  it("a film that does not say which pictures are videos or list items changes nothing", () => {
    const film: FilmLayout = { scenes: [scene(3, 7.28991, 13.7519), scene(29, 141.288, 143.286), scene(30, 143.286, 147.619)] };
    expect(pictureProblem(placed("v", "Versus", 5.667, 13.767), [], film, [])).toBeUndefined();
    expect(pictureProblem(placed("s", "StepCards", 141.3, 147.6), [], film, [])).toBeUndefined();
  });
});
