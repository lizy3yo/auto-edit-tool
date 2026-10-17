import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import { cleanHostLook, markHostBroll } from "./hostLook";
import { buildStillPrompt, hostBrollClause, NO_FIGURES_SUFFIX, NO_OTHER_FIGURES_SUFFIX } from "./longformVideo";

const pic = (index: number, showSubject: string, extra: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText: showSubject, narration: showSubject, visualPrompt: showSubject, showSubject, ...extra }) as StoryboardScene;

describe("the host at work in b-roll (2026-09-28)", () => {
  it("keeps one plain line of the host's look", () => {
    expect(cleanHostLook('"A slim woman with auburn hair, a blue dress and a black apron."\nExtra')).toBe(
      "A slim woman with auburn hair, a blue dress and a black apron"
    );
    expect(cleanHostLook("")).toBe("");
  });

  it("marks pictures of someone doing the work as the host — never a split, host take or cover", () => {
    const scenes = [
      pic(1, "the host stitching a nine-patch block at the table"),
      pic(2, "hands cutting a feed sack with scissors"),
      pic(3, "a folded stack of feed sacks by the burn barrel"),
      pic(4, "the host at the machine", { splitVisual: "a quilt" } as any),
      pic(5, "talking", { hostPresent: true }),
    ];
    const n = markHostBroll(scenes, { hostLook: "a woman in a blue dress" }, "https://x/host.jpg");
    expect(n).toBe(2);
    expect(scenes.map(s => !!s.brollHostLook)).toEqual([true, true, false, false, false]);
    expect(scenes[0].humanPresent).toBe(true);
    expect(scenes[0].brollHostRef).toBe("https://x/host.jpg");
    // No look, no photo or a b-roll-only film: nothing marked, and old marks are cleared.
    expect(markHostBroll(scenes, { hostLook: "" }, "https://x/host.jpg")).toBe(0);
    expect(scenes[0].brollHostLook).toBeUndefined();
    expect(markHostBroll(scenes, { hostLook: "a woman", brollOnly: true }, "https://x/host.jpg")).toBe(0);
  });

  it("draws the host from behind with the face never shown, and nobody else", () => {
    const s = pic(1, "the host stitching a nine-patch block", {
      humanPresent: true,
      stillImage: true,
      brollHostLook: "a woman in a plain blue dress and a black apron",
    });
    const prompt = buildStillPrompt(s);
    expect(prompt).toContain(hostBrollClause("a woman in a plain blue dress and a black apron"));
    expect(prompt).toContain("never shown");
    expect(prompt).toContain(NO_OTHER_FIGURES_SUFFIX);
    expect(prompt).not.toContain(NO_FIGURES_SUFFIX);
    // Without the mark it is the old anonymous-hands picture.
    const anon = buildStillPrompt(pic(2, "hands stitching", { humanPresent: true, stillImage: true }));
    expect(anon).toContain(NO_FIGURES_SUFFIX);
    expect(anon).not.toMatch(/older man|weathered/i);
  });
});

describe("one body, two arms", () => {
  it("asks every host-at-work picture and every hands-only picture for one pair of arms", async () => {
    const { ONE_BODY_CLAUSE } = await import("./longformVideo");
    // Norbert's 3-min test (job 232, 2:19): a third sleeve at the drill's battery.
    expect(hostBrollClause("a man in a brown work jacket")).toContain(ONE_BODY_CLAUSE);
    expect(ONE_BODY_CLAUSE).toMatch(/exactly two arms and two hands/);
    expect(NO_FIGURES_SUFFIX).toMatch(/never a third hand or arm/);
  });
});

describe("withoutMirrors — a picture of the host never has a mirror", () => {
  it("takes the mirror out of Scarlett's descriptions (job 234) and any other wording", async () => {
    const { withoutMirrors } = await import("./hostLook");
    expect(
      withoutMirrors(
        "host wearing a fine gold chain necklace, close view of her neck and chin catching light in the dressing room mirror"
      )
    ).toBe("host wearing a fine gold chain necklace, close view of her neck and chin catching light");
    expect(withoutMirrors("the host fastening a clasp, facing the tall mirror")).toBe("the host fastening a clasp");
    expect(withoutMirrors("a full-length mirror behind the host as she folds a scarf")).toBe(
      "the wall behind the host as she folds a scarf"
    );
    expect(withoutMirrors("hands sanding a board on the workbench")).toBe("hands sanding a board on the workbench");
  });
  it("marks host pictures without their mirrors and asks for no reflection", async () => {
    const { markHostBroll } = await import("./hostLook");
    const s = {
      index: 1,
      scriptText: "x",
      humanPresent: true,
      showSubject: "the host fastening a pearl strand in the dressing room mirror",
      visualPrompt: "the host fastening a pearl strand in the dressing room mirror",
    } as any;
    markHostBroll([s], { hostLook: "a woman in a striped top" } as any, "https://x/host.jpg");
    expect(s.showSubject).toBe("the host fastening a pearl strand");
    expect(NO_OTHER_FIGURES_SUFFIX).toMatch(/No mirror/);
  });
});

describe("a held thing has a holder; a thing with no hand rests", () => {
  it("puts the host's hands on a tool the line says is held (Norbert, job 238)", async () => {
    const { markHostBroll } = await import("./hostLook");
    const s = {
      index: 1,
      scriptText: "x",
      showSubject: "cordless drill with metal bit held near the doorframe, black and grey",
    } as any;
    markHostBroll([s], { hostLook: "a man in a brown work jacket" } as any, "https://x/host.jpg");
    expect(s.humanPresent).toBe(true);
    expect(s.brollHostLook).toBeDefined();
    // A tool simply lying there stays person-free.
    const lying = { index: 2, scriptText: "x", showSubject: "a cordless drill resting on the workbench" } as any;
    markHostBroll([lying], { hostLook: "a man" } as any, "https://x/host.jpg");
    expect(lying.humanPresent).toBeFalsy();
  });
  it("tells a person-free picture that nothing hovers", () => {
    expect(NO_FIGURES_SUFFIX).toMatch(/never hovering in the air or pressed against the work on its own/);
  });
});

describe("the host is recognised however the line names them (Scarlett, job 244)", () => {
  it("counts 'Host wearing…' and a necklace at the collarbone as the host, not a crewneck laid flat", async () => {
    const { SHOWS_PERSON } = await import("./hostLook");
    expect(SHOWS_PERSON.test("Host wearing a long slim gold chain over a navy turtleneck")).toBe(true);
    expect(SHOWS_PERSON.test("Pearl strand necklace resting at the collarbone")).toBe(true);
    expect(SHOWS_PERSON.test("A plain navy crewneck laid flat on the dresser")).toBe(false);
    expect(SHOWS_PERSON.test("a sweater's neckline folded on the bed")).toBe(false);
  });
});

describe("a line about the chin, jaw or neck (the audit, 2026-10-18)", () => {
  it("knows a line about the chin, the jawline, the neck, the collarbone or a piece near the face", async () => {
    const { looksAtChinLine } = await import("./hostLook");
    for (const line of [
      "Land two inches lower, and that same necklace drags your chin and your jawline down with it.", // job 244 scene 3
      "Does it brighten the skin under your chin, or does it put a shadow there?", // job 378 scene 28
      "The eye reads it together with the soft shadows under the chin, and the face looks tired.", // job 395 scene 25
      "A single strand sitting right at the collarbone.", // job 325 scene 12
      "hold the piece up near your face by a window,", // job 354 scene 30
      "A soft scarf knotted at my neck keeps the wind off.",
    ])
      expect(looksAtChinLine(line), line).toBe(true);
  });

  it("leaves a product, a scarf's fringe, hair, sayings and the neck of a thing alone", async () => {
    const { looksAtChinLine } = await import("./hostLook");
    for (const line of [
      "No lift, no bleach, no roots to manage afterward.", // job 320 scene 27
      "A little fringe on each end, tied on with a hook, dresses it right up.", // job 219 scene 108
      "The woman who spends the most money and the most time on her hair is usually the one who reads oldest in the room.", // job 222 scene 2
      "The top gathers in like the neck of a drawstring bag.", // job 297 scene 23
      "Then say hello. Soft voice, calm pat on the chest or the side of the neck.", // job 358 scene 31, a dog
      "Scratch your dog under the chin before you clip the leash.",
      "Keep your chin up, the first market is always slow.",
      "I stuck my neck out for that order and it paid off.",
      "Dry the hair at the nape of your neck first.",
      "Tighten the vise until the jaws grip the board.",
      "Buckle your chin strap before you ride.",
      "", undefined,
    ])
      expect(looksAtChinLine(line), String(line)).toBe(false);
  });

  it("an overview that counts the pieces is not one, a measure is (job 223 scene 8 vs job 244 scene 3)", async () => {
    const { looksAtChinLine } = await import("./hostLook");
    expect(looksAtChinLine("Three necklaces today, each one sitting at a different spot under your chin.")).toBe(false);
    expect(looksAtChinLine("Land two inches lower, and that same necklace drags your chin")).toBe(true);
    expect(looksAtChinLine("Let it hang three quarters of an inch below your collarbone.")).toBe(true);
    expect(looksAtChinLine("Number two is a fine gold chain. That thin line of gold puts a highlight right under your chin,")).toBe(true);
  });

  it("frames neither a hair picture, an overview picture nor an animal for the chin", async () => {
    const { chinFramed } = await import("./hostLook");
    const line = "That thin line of gold puts a moving highlight right under your chin.";
    expect(chinFramed({ scriptText: line, showSubject: "a fine gold chain catching the light" })).toBe(true);
    expect(chinFramed({ scriptText: "Shoulder-length hair that grazes your collarbone reads younger.", showSubject: "host from behind brushing her shoulder-length hair" })).toBe(false);
    expect(chinFramed({ scriptText: line, showSubject: "pearl necklace, gold chain, and dark bead necklace laid together on the table" })).toBe(false);
    expect(chinFramed({ scriptText: line, showSubject: "open jewelry box with pearls, gold chain, and bead necklaces arranged in rows" })).toBe(false);
    expect(chinFramed({ scriptText: line, showSubject: "a gold chain in the cat's paws" })).toBe(false);
    expect(chinFramed({ scriptText: line, showSubject: "the gold chain alone", listSet: true })).toBe(false);
  });

  it("puts a piece that was set down on the host's neck — and leaves a held or worn one as it is", async () => {
    const { wornAtTheNeck } = await import("./hostLook");
    // Job 223 scene 5 and job 392 scene 23: the piece on a table or a cloth under a line about the chin.
    expect(wornAtTheNeck("fine gold chain necklace with small pendant draped over dressing table close up")).toBe(
      "fine gold chain necklace with small pendant, worn at the host's own neck, the chin and jaw in view above it — never set down."
    );
    expect(wornAtTheNeck("a chunky dark bead necklace laid on the soft cloth surface")).toMatch(
      /^a chunky dark bead necklace, worn at the host's own neck/
    );
    expect(wornAtTheNeck("single strand pearl necklace with round ivory pearls on the dressing room table near the window")).toMatch(
      /^single strand pearl necklace with round ivory pearls, worn at the host's own neck/
    );
    // Job 354 scene 13: nothing says where it is — it is worn.
    expect(wornAtTheNeck("close-up of a thin polished gold chain with a glint of light running along it")).toMatch(
      /running along it, worn at the host's own neck, the chin and jaw in view above it/
    );
    // Job 364 scene 22: worn already, only the dress form goes.
    expect(wornAtTheNeck("dark bead necklace worn at collarbone on dress form")).toBe("dark bead necklace worn at collarbone.");
    for (const as of [
      "fine gold chain necklace with pendant draped over a hand near the collarbone", // job 223 scene 15
      "pearl necklace hanging two inches below the collarbone over a navy crewneck sweater", // job 378 scene 3
      "host's hand holding a necklace up near her face beside a window", // job 234 scene 29
      "Close-up of a fine thin gold chain as it lies on a navy knit sweater just below the collarbone", // job 364 scene 14
      "a jar of cream on the bathroom counter",
    ])
      expect(wornAtTheNeck(as), as).toBe(as);
    const once = wornAtTheNeck("a pearl strand resting inside the open jewelry box");
    expect(wornAtTheNeck(once)).toBe(once);
  });

  it("never lets a mirror take the chest with it (job 223 scene 4)", async () => {
    const { withoutMirrors } = await import("./hostLook");
    expect(withoutMirrors("same necklace hanging two inches lower on the chest near mirror")).toBe(
      "same necklace hanging two inches lower on the chest"
    );
    expect(withoutMirrors("a necklace on the dresser beside the dressing room mirror")).toBe(
      "a necklace on the dresser beside the wall"
    );
  });
});
