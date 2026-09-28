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
