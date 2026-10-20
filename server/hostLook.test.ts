import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import { cleanHostLook, markHostBroll, namesSomeone, showsPerson } from "./hostLook";
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
    expect(NO_FIGURES_SUFFIX).toMatch(/never hovering in the air, hanging from nothing, propped at an angle only a hand could hold, or pressed against the work on its own/);
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
      "I've sold more of these in my neck of the woods than anywhere else.",
      "Sanding that edge by hand was a real pain in my neck.",
      "The buyer was breathing down my neck about the date.",
      "Clamp a scrap near the face of the board so it won't tear out.",
      "Keep the bit near the face edge, never the end grain.",
      "", undefined,
    ])
      expect(looksAtChinLine(line), String(line)).toBe(false);
  });

  it("counts hands and fingers as no overview", async () => {
    const { looksAtChinLine } = await import("./hostLook");
    expect(looksAtChinLine("Hold it with two hands right under your chin and look at the light.")).toBe(true);
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

  it("a worn piece keeps its room, and 'the host's' alone does not mean worn", async () => {
    const { wornAtTheNeck } = await import("./hostLook");
    for (const as of [
      "host wearing a pearl strand, a jewelry box open on the dresser beside her",
      "a pearl strand at her collarbone, the host sitting on the edge of the bed",
    ])
      expect(wornAtTheNeck(as), as).toBe(as);
    expect(wornAtTheNeck("the host's pearl necklace laid on the dresser")).toBe(
      "the host's pearl necklace, worn at the host's own neck, the chin and jaw in view above it — never set down."
    );
  });

  it("takes out every view that turns the host away, and nothing else (job 395 scene 25)", async () => {
    const { facingTheCamera } = await import("./hostLook");
    expect(
      facingTheCamera(
        "woman wearing dark beaded necklace at collarbone, soft shadow under the chin above the dark beads, face turned away"
      )
    ).toBe("woman wearing dark beaded necklace at collarbone, soft shadow under the chin above the dark beads");
    expect(facingTheCamera("host from behind, a pearl strand at her collarbone")).toBe("host, a pearl strand at her collarbone");
    expect(facingTheCamera("the host seen from the side, a gold chain under her chin")).toBe("the host, a gold chain under her chin");
    expect(facingTheCamera("the host with her back to the camera, a pendant at her neck")).toBe("the host, a pendant at her neck");
    expect(facingTheCamera("an over-the-shoulder view of the host fastening a pearl strand")).toBe("the host fastening a pearl strand");
    expect(facingTheCamera("a gold chain at the throat, framed from the chin down")).toBe("a gold chain at the throat, framed from the lips down");
    for (const as of [
      "pearl strand at her collarbone, window light from behind",
      "a pearl strand at her collarbone, lit from the side",
      "a silk scarf draped over her shoulder, knotted at the neck",
      "a gold chain at the throat, the face out of frame",
      "a pearl strand at the collarbone, the box pulled from the back of the drawer",
    ])
      expect(facingTheCamera(as), as).toBe(as);
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

describe("a strand is part of a person only when it is hair (round 9's review, 2026-10-18)", () => {
  it("never reads a strand of pearls, beads, yarn or lights as a person", async () => {
    const { SHOWS_PERSON, BODY_PART_WORDS, showsPerson } = await import("./hostLook");
    for (const thing of [
      "a pearl strand on the dresser",
      "pearl strand necklace resting unused inside the open jewelry box", // job 223 scene 12
      "single strand pearl necklace with round ivory pearls laid on the dressing room table", // job 234 scene 7
      "chunky strand of large oat-toned matte beads on a soft cloth, close view", // job 392 scene 26
      "a double strand of beads coiled on a velvet tray",
      "a loose strand of pearls caught in the bathroom drain", // a strand OF something else, wherever it lies
      "stray strands of tinsel on the bottom branches",
      "two strands of yarn held together over the hook",
      "strand lights wrapped around the porch rail",
    ]) {
      expect(SHOWS_PERSON.test(thing), thing).toBe(false);
      expect(showsPerson(thing), thing).toBe(false);
      expect(BODY_PART_WORDS.test(thing), thing).toBe(false);
    }
  });

  it("still reads a strand of hair as a person, with or without the word 'hair'", async () => {
    const { SHOWS_PERSON, BODY_PART_WORDS } = await import("./hostLook");
    for (const hair of [
      "A few strands of gray hair caught in a round brush on the counter.", // the operator's own case, 2026-10-02
      "strands of her hair lifting in the breeze",
      "stray gray strands catching the window light",
      "flyaway strands lifting off the crown",
      "a few fallen strands on the bathroom tile",
      "a few strands caught in the wide-tooth comb",
      "loose strands in the shower drain",
    ]) {
      expect(SHOWS_PERSON.test(hair), hair).toBe(true);
      expect(BODY_PART_WORDS.test(hair), hair).toBe(true);
    }
  });

  it("a strand its own name makes a thing is that thing even in a drain or a brush, or with 'stray' before it", async () => {
    const { SHOWS_PERSON, BODY_PART_WORDS } = await import("./hostLook");
    for (const thing of [
      "a pearl strand caught in the drain",
      "single strand pearl necklace in the bathroom drain",
      "a yarn strand wrapped around a paint brush",
      "strand lights caught in the gutter drain",
      "stray yarn strands on the kitchen table",
      "a few stray tinsel strands on the rug",
      "fallen pearl strands on the carpet",
    ]) {
      expect(SHOWS_PERSON.test(thing), thing).toBe(false);
      expect(BODY_PART_WORDS.test(thing), thing).toBe(false);
    }
    // Only a material or a piece right beside the strand names it: a hair word there does not.
    for (const hair of [
      "silky strands caught in the brush",
      "stray light-brown strands on the collar",
      "a single strand caught in the comb",
      "shed strands collected in the drain cover",
    ]) {
      expect(SHOWS_PERSON.test(hair), hair).toBe(true);
      expect(BODY_PART_WORDS.test(hair), hair).toBe(true);
    }
  });

  it("a pearl strand set down is the necklace alone under any other line, and still worn under a neck line", () => {
    const look = { hostLook: "a woman with silver hair in a striped top" };
    const alone = pic(1, "a pearl strand on the dresser", { scriptText: "Pearls never really go out of style." });
    const fallen = pic(2, "a few strands caught in the wide-tooth comb", { scriptText: "That is normal shedding." });
    // Job 325 scene 12's line: the piece the line is about sits at the collarbone, so it is worn.
    const neck = pic(3, "a pearl strand resting inside the open jewelry box", {
      scriptText: "A single strand sitting right at the collarbone.",
    });
    expect(markHostBroll([alone, fallen, neck], look, "https://x/host.jpg")).toBe(2);
    expect(alone.humanPresent).toBeFalsy();
    expect(alone.brollHostLook).toBeUndefined();
    expect(alone.showSubject).toBe("a pearl strand on the dresser");
    expect(fallen.brollHostLook).toBe(look.hostLook);
    expect(neck.brollHostLook).toBe(look.hostLook);
    expect(neck.showSubject).toMatch(/worn at the host's own neck/);
  });

  it("a split panel of a pearl strand is not about the host's body; one of fallen hair is", () => {
    const look = { hostLook: "a woman with silver hair" };
    const panel = (splitVisual: string) => pic(1, "talking", { hostPresent: true, splitVisual } as Partial<StoryboardScene>);
    const pearls = panel("a pearl strand laid on the dresser by the window");
    const hair = panel("a few strands caught in a round brush on the counter");
    markHostBroll([pearls, hair], look, "https://x/host.jpg");
    expect(pearls.brollHostLook).toBeUndefined();
    expect(hair.brollHostLook).toBe(look.hostLook);
  });
});

describe("'hand' naming a thing is not a person (round 11's review, job 406 scene 7)", () => {
  it("never reads a hand tool, a made-by-hand word, a way of doing or a clock's hands as a person", async () => {
    const { SHOWS_PERSON, showsPerson } = await import("./hostLook");
    for (const thing of [
      "hand tools hanging silent on a pegboard wall in the garage", // job 406 scene 7's showSubject
      "Hand tools hanging on a pegboard wall in the garage workshop, spanners, hammers, and wrenches arranged on the board, spring daylight through the side window.", // its visualPrompt
      "an old hand saw hanging on a nail above the bench",
      "a handsaw resting across two sawhorses",
      "a hand drill and a brace on the shelf",
      "two hand planes lined up on the bench",
      "a hand-plane resting on its side",
      "a tube of hand cream on the nightstand",
      "a folded hand towel beside the sink",
      "a hand-crank pencil sharpener clamped to the desk",
      "a second-hand drill press in the corner of the garage",
      "a handmade cutting board on the counter",
      "a hand-stitched quilt folded over the chair",
      "a hand-me-down rocking chair on the porch",
      "a hands-free phone mount on the dashboard",
      "a basket woven by hand on the porch step",
      "spare batteries kept on hand in the kitchen drawer",
      "a flashlight close at hand on the nightstand",
      "the hands of the old wall clock near midnight",
      "the minute hand of the kitchen clock",
      "a kitchen wall clock, its second hand sweeping past the twelve",
      // job 405 scene 28's visualPrompt
      "Round analog clock on a wooden nightstand, white face and black hands pointing near three o'clock, cream lamp beside it glowing softly.",
    ]) {
      expect(SHOWS_PERSON.test(thing), thing).toBe(false);
      expect(showsPerson(thing), thing).toBe(false);
    }
  });

  it("still reads a hand on a body as a person, whatever it does", async () => {
    const { SHOWS_PERSON, showsPerson } = await import("./hostLook");
    for (const hand of [
      "a hand reaching for the hammer on the pegboard",
      "hands sanding the edge of a board",
      "Bare weathered hands guiding a dull mower blade against a spinning belt", // job 406 scene 20
      "a hand rests on the workbench beside the plane",
      "a hand grips the chisel above the board",
      "a hand brushes sawdust off the bench",
      "a hand pumps the handle of the old well",
      "hand-sewing the binding onto a quilt",
      "two figures walking hand in hand along a sunny park path", // job 401 scene 19
      "a woman on hands and knees scrubbing the floor",
      "a hammer in hand at the bench",
      "a hired hand stacking hay bales in the loft",
      "the hand of a sleeping person resting on the blanket",
    ]) {
      expect(SHOWS_PERSON.test(hand), hand).toBe(true);
      expect(showsPerson(hand), hand).toBe(true);
    }
  });

  it("a hand tool at work, or work being done by hand, still has someone's hand in it (stored jobs 133-232)", async () => {
    const { SHOWS_PERSON, showsPerson } = await import("./hostLook");
    // Every one of these was a person through "hand" alone before the fix, and needs one.
    for (const doing of [
      "a hand drill boring a hole into a small charred cedar block", // job 189 scene 36
      "a hand drill bit entering a charred cedar block at a slight angle, close up on workbench", // job 189 scene 39
      "A wooden workbench surface in soft garage light, scattered with fine wood shavings and a hand plane mid-stroke across a half-finished pine board", // job 133 scene 190
      "a hand saw cutting through a pine board clamped to the bench",
      "a hand mixer whipping cream in a glass bowl",
      "A 3-inch screw being turned by hand with a screwdriver into the wooden door frame", // job 232 scene 23
      "nine-patch crib quilt being pieced by hand at the work table under lamp light", // job 144 scene 3
      "close up of two matching shell stitches being aligned by hand", // job 158 scene 40
      "An open-mesh market bag held stretched wide by hand, close up", // job 168 scene 127
      "sanding the edge by hand with a folded sheet of sandpaper",
    ]) {
      expect(SHOWS_PERSON.test(doing), doing).toBe(true);
      expect(showsPerson(doing), doing).toBe(true);
    }
    // At rest, or made by hand some time ago: nobody.
    for (const done of [
      "a hand plane resting on the bench",
      "a hand saw and sanding block on the bench",
      "a hand saw with a turned beech handle",
      "a soft pale bedsheet square, hemmed by hand with visible thread, folded flat", // job 147 scene 101
      "Braided rag rug coiled flat on a wooden floor, coils laced together by hand with visible stitching", // job 129 scene 22
      "the overall construction done by hand at a slow, deliberate pace", // job 107 scene 113
      "visible stitching done by hand along the binding",
      "a finished walnut cutting board lying flat on the workshop bench, surrounded by hand tools and wood shavings",
    ]) {
      expect(SHOWS_PERSON.test(done), done).toBe(false);
      expect(showsPerson(done), done).toBe(false);
    }
  });

  it("an animal's pronoun after hand tools is the animal's; one after a hand stays the person's", async () => {
    const { withoutAnimalPronouns } = await import("./hostLook");
    expect(withoutAnimalPronouns("a dog asleep under the hand tools, his tail over his nose")).toBe(
      "a dog asleep under the hand tools, its tail over its nose"
    );
    expect(withoutAnimalPronouns("a dog sniffing a hand, her fingers spread")).toBe("a dog sniffing a hand, her fingers spread");
  });

  it("a hand-knotted necklace set down is worn under a chin line; one draped over a hand stays as it is", async () => {
    const { wornAtTheNeck } = await import("./hostLook");
    expect(wornAtTheNeck("hand-knotted pearl necklace laid on the dresser")).toMatch(
      /^hand-knotted pearl necklace, worn at the host's own neck/
    );
    const held = "fine gold chain necklace with pendant draped over a hand near the collarbone"; // job 223 scene 15
    expect(wornAtTheNeck(held)).toBe(held);
  });

  it("job 406 scene 7: hand tools on a wall are drawn with nobody in them; a hand at work is the host", () => {
    const look = { hostLook: "a lean man in his late fifties in a light blue denim shirt" };
    const wall = pic(7, "hand tools hanging silent on a pegboard wall in the garage", {
      scriptText: "That one belief keeps more good tools hanging silent on more garage walls than rust ever has.",
    });
    const work = pic(8, "a hand reaching for the hammer on the pegboard");
    expect(markHostBroll([wall, work], look, "https://x/host.jpg")).toBe(1);
    expect(wall.humanPresent).toBeFalsy();
    expect(wall.brollHostLook).toBeUndefined();
    expect(wall.brollHostRef).toBeUndefined();
    expect(buildStillPrompt(wall)).toContain(NO_FIGURES_SUFFIX);
    expect(work.brollHostLook).toBe(look.hostLook);
  });
});

describe("someone in the words, narrowly — the picture behind the big QR card (job 402 scene 33)", () => {
  it("finds the person and the hand the scan window was drawn with", () => {
    expect(
      namesSomeone(
        "A flight attendant's hands holding a small packet of crackers or cookies, offering it downward toward a seated passenger in the cabin row"
      )
    ).toBe(true);
    expect(namesSomeone("one hand extending it toward another hand reaching to receive it")).toBe(true);
    expect(namesSomeone("fingers wrapped round a foil packet")).toBe(true);
    expect(namesSomeone("a woman pouring tea")).toBe(true);
    expect(namesSomeone("someone's coffee left on the tray")).toBe(true);
  });

  it("never swaps away a picture of nobody that only names what a person uses or wears", () => {
    for (const words of [
      "a coffee can full of nails on the workbench",
      "a jar of skin cream on a vanity",
      "a kettle in use on the stove",
      "a robin in her nest",
      "a hand plane resting on the bench",
      "a hand-stitched quilt over a chair",
      "an old clock, its hands at three",
      "an empty passenger seat with its tray table down",
      "Plain cream sympathy card with simple embossed border resting on a wooden desk in a quiet study",
      "the hen as she scratches at the feed",
    ])
      expect(namesSomeone(words)).toBe(false);
    // The wider test every other step uses still counts the first four (who to draw is its job).
    expect(showsPerson("a coffee can full of nails on the workbench")).toBe(true);
  });
});

describe("someone in the words — never a thing named for a hand or a finger (review of M6)", () => {
  // On the backdrop behind the big QR card a false hit swaps a good picture for a borrowed one, so
  // the craft and clock words that only NAME a hand or a finger must not count.
  it("never counts a joint, a way of making, a clock's hand or a fastener", () => {
    for (const words of [
      "Close-up of a walnut box with tight finger joints at the corner, on the bench",
      "a finger-jointed cedar box on the bench",
      "a cherry box with dovetails cut by hand, resting on the workbench",
      "a quilt stitched by hand folded over a chair",
      "spare blades kept on hand by the door",
      "a pocket watch with its hour hand on two",
      "the second hand ticking past twelve on a kitchen clock",
      "a brass thumb screw on the jig",
      "a plate of fish fingers on a table",
      "a five-finger mitt on a shelf",
      // Job 362's scan window: a dress form has a collarbone too; only BARE skin is a person's.
      "A plain knit sweater draped on a dress form. A simple gold chain rests at the collarbone.",
    ])
      expect(namesSomeone(words)).toBe(false);
  });

  it("still counts a person's hand, finger, thumb and bare skin", () => {
    for (const words of [
      "one hand extending it toward a second hand reaching to receive it",
      "a ring on her hand",
      "a mug in hand by the window",
      "a thumb resting on the trigger",
      "a 9-volt battery held between bare fingertips",
      // Job 380's scan window: a chain on a person's collarbone behind the card.
      "A slim gold chain resting on bare collarbone and skin in a bright airy dressing room",
    ])
      expect(namesSomeone(words)).toBe(true);
  });
});

describe("a look on the host's own face (the operator's decision on the audit's cause 9, 2026-10-18)", () => {
  it("knows a line about how a shade, a cut, glasses or earrings look on the face", async () => {
    const { looksOnTheFace } = await import("./hostLook");
    for (const line of [
      // Diane's stored lines — each drawn as the back of a head.
      "A woman with gray hair that catches the light will read younger than a woman with flawlessly dyed brown hair that goes flat under a restaurant lamp.", // job 309 scene 29
      "The woman who spends the most money and the most time on her hair is usually the one who reads oldest in the room.", // job 309 scene 2
      "Shine is the single thing people read as healthy hair. A woman with gray hair that catches the light will read younger than a woman with flawlessly dyed brown hair that goes flat under a restaurant lamp.", // job 222 scene 40
      "Shoulder-length hair that grazes your collarbone reads younger.",
      // the operator's kinds of look, in general words
      "A blue-red lipstick brightens the whole face.",
      "That coral lipstick looks fresher on older skin than any brown.",
      "Blush placed too low makes you look tired.",
      "Thin wire-rimmed glasses soften the face.",
      "Small pearl earrings bring out your eyes.",
      "A dye a shade too dark washes you out.",
      "A chin-length bob takes ten years off.",
      "A V neckline frames your face.",
      "Go two shades lighter and you'll look ten years younger.",
    ])
      expect(looksOnTheFace(line), line).toBe(true);
  });

  it("leaves a thing's own look, a word that only names glasses or an earring, sayings and overviews alone", async () => {
    const { looksOnTheFace } = await import("./hostLook");
    for (const line of [
      "A dye job carries one. The hair looks applied.", // job 309 scene 11 — the hair's own look
      "Shine is the single thing people read as healthy hair.", // job 309 scene 28
      "Not because she is older. Because she is trying harder, and it shows.", // job 309 scene 3
      "Real hair carries eight or ten tones at once, which is why it moves in the light.", // job 309 scene 10
      "By the afternoon your hair looks dull and heavy.", // the hair's own shine and weight, not the face
      "Hey, it's me again. If your lawn looks tired no matter how often you mow,", // job 28 scene 1
      "wear gloves and safety glasses,", // job 143 scene 190
      "I once watched a hen toss beakful after beakful over her shoulder like she'd lost an earring in there.", // job 355 scene 17
      "Three necklaces today that read expensive on a woman over sixty, and one that is aging you.", // job 244 scene 6
      "On the face of it, the cheaper saw looks older than it is.",
      "Keep your eyes on the line so the edge looks fresh.",
      "Pick whatever suits you.",
      "A sharp blade takes years off the life of the motor.",
      "That's the aging you see in old pine.",
      "Plane the face of the board until it looks bright.",
      "Your dog's face looks tired after a long walk.",
      "The light in that room looks harsh at noon.",
      "", undefined,
    ])
      expect(looksOnTheFace(line), String(line)).toBe(false);
  });

  it("asks the line to name the thing whose look it judges — a line about the person alone is no look", async () => {
    const { looksOnTheFace } = await import("./hostLook");
    for (const line of [
      // Scarlett's full script: a bridge to the next section, nothing worn named in it.
      "Before we turn to the three that are aging you, I want to say something about money, because I know what happens the moment a woman hears the word expensive.",
      "Stress ages you faster than anything.",
      "You look tired.",
      "You'll look younger, you'll feel better, and you'll sleep through the night.",
      "Her eyes looked tired after the long drive home.",
      "His face looked older than I remembered when I saw him at the funeral.",
      "Your skin looks dull because you don't drink water.",
      "A good night's sleep brightens your whole face.",
      "Walking every day takes ten years off.",
      "That old truck makes you look older than you are, honey.",
      "The cream softens the skin overnight.",
    ])
      expect(looksOnTheFace(line), line).toBe(false);
    // The same judgements with the thing named are looks.
    for (const line of [
      "Black right under the face ages you faster than anything.",
      "This shade? It takes ten years off.",
      "A side part softens the face.",
      "A crew neck in navy makes you look tired.",
    ])
      expect(looksOnTheFace(line), line).toBe(true);
  });

  it("frames a host picture of the look on the face — never a chin line's, a neck piece's, an overview's or a group picture", async () => {
    const { faceLookFramed } = await import("./hostLook");
    // Diane's job 309 scene 2: her hair being styled, under the line about who reads oldest.
    expect(
      faceLookFramed({
        scriptText: "The woman who spends the most money and the most time on her hair is usually the one who reads oldest in the room.",
        showSubject: "Host's hair being styled elaborately at the bathroom counter with hair-care products nearby.",
      })
    ).toBe(true);
    // Pearl earrings are earrings, not a neck piece.
    expect(faceLookFramed({ scriptText: "Small pearl earrings bring out your eyes.", showSubject: "the host wearing small pearl stud earrings" })).toBe(true);
    // Job 354 scene 23: "the face looks tired" is a chin line, framed at the lips as round 9 made it.
    expect(
      faceLookFramed({
        scriptText: "The eye reads it together with the soft shadows under the chin, and the face looks tired.",
        showSubject: "dark bead necklace on the chest over a navy sweater in a mirror, with shadows under the chin above it",
      })
    ).toBe(false);
    // Job 240 scene 2: a necklace "flattering you" is a picture of the piece worn at the neck.
    expect(
      faceLookFramed({
        scriptText: "decides whether a necklace is flattering you or working against you.",
        showSubject: "A long gold chain hanging low on the host's chest, catching window light, with a navy sweater nearby in the dressing room.",
      })
    ).toBe(false);
    const line = "A blue-red lipstick brightens the whole face.";
    expect(faceLookFramed({ scriptText: line, showSubject: "three lipsticks laid side by side on the vanity" })).toBe(false);
    expect(faceLookFramed({ scriptText: line, showSubject: "the host wearing a blue-red lipstick", listSet: true })).toBe(false);
    expect(faceLookFramed({ scriptText: "Silver goes brassy and yellow over time.", showSubject: "host's brassy silver hair at the sink" })).toBe(false);
  });

  it("takes every view that hides the face out of a face-shown picture's words, and nothing else", async () => {
    const { faceInView } = await import("./hostLook");
    // Diane's job 282 scenes 34 and 2.
    expect(faceInView("host from behind, gray-blended hair catching light near the wall")).toBe("host, gray-blended hair catching light near the wall");
    expect(faceInView("Woman's shoulder-length hair rinsing under running shower water, seen from behind in the bathroom.")).toBe(
      "Woman's shoulder-length hair rinsing under running shower water in the bathroom."
    );
    expect(faceInView("The host stands, both hands resting in her hair, viewed from behind.")).toBe("The host stands, both hands resting in her hair.");
    expect(faceInView("a coral lipstick on the host, framed from the chin down")).toBe("a coral lipstick on the host");
    expect(faceInView("the host in thin glasses, her face out of frame")).toBe("the host in thin glasses");
    for (const as of [
      "the host's silver hair catching window light from behind",
      "the host wearing a blue-red lipstick, close view",
      "a soft bob framing the host's face, lit from the side",
    ])
      expect(faceInView(as), as).toBe(as);
  });
});

describe("a face's expression said with the body, on a picture that shows no face (job 410 scene 8)", () => {
  // The shot list wrote what only a face can show into a picture of someone else — "smiling politely
  // up at a flight attendant" — and the picture maker drew her face in profile to show the smile,
  // beside a clause saying no face is ever shown.
  it("job 410 scene 8, 402 scene 29, 410 scene 31, 405 scene 10: the feeling stays, in the body", async () => {
    const { expressionAsBody } = await import("./hostLook");
    expect(expressionAsBody("an older woman seen from the side smiling politely up at a flight attendant standing in the aisle")).toBe(
      "an older woman seen from the side nodding politely up at a flight attendant standing in the aisle"
    );
    expect(
      expressionAsBody(
        "An older woman sitting in her seat seen from the side, looking up and smiling politely at a flight attendant standing in the aisle."
      )
    ).toBe(
      "An older woman sitting in her seat seen from the side, looking up and nodding politely at a flight attendant standing in the aisle."
    );
    expect(expressionAsBody("a flight attendant smiling as she hands a cookie packet to an older passenger, seen from the side")).toBe(
      "a flight attendant nodding as she hands a cookie packet to an older passenger, seen from the side"
    );
    expect(expressionAsBody("a flight attendant smiling and handing a cookie to an older passenger at the galley")).toBe(
      "a flight attendant nodding and handing a cookie to an older passenger at the galley"
    );
    expect(
      expressionAsBody("a person half sitting up in the bed at night, seen from the side, frowning at the tabby cat sitting on the blanket")
    ).toBe("a person half sitting up in the bed at night, seen from the side, leaning toward the tabby cat sitting on the blanket");
    // Job 241 scene 6 (an anonymous person at a mirror): "her expression is calm" is her posture.
    expect(expressionAsBody("Her hair is undone, her expression is calm and unbothered, and she glances at her watch")).toBe(
      "Her hair is undone, her posture is calm and unbothered, and she glances at her watch"
    );
  });

  it("every kind of face word goes the same way, the sentence kept whole", async () => {
    const { expressionAsBody } = await import("./hostLook");
    const cases: [string, string][] = [
      ["a smiling woman handing a mug across the counter", "a woman handing a mug across the counter"],
      ["Smiling, she hands the jar to a neighbour", "Nodding, she hands the jar to a neighbour"],
      ["a grinning teenager holding up the fish", "a teenager holding up the fish"],
      ["an old man on a bench, a warm smile on his face, feeding pigeons", "an old man on a bench, with a warm nod, feeding pigeons"],
      ["a man reading the bill with a worried look on his face", "a man reading the bill with a worried set to the shoulders"],
      ["a woman staring at the screen, her eyes wide with surprise", "a woman staring at the screen, drawing back a little"],
      ["a man with raised eyebrows looking at the price tag", "a man, drawing back a little, looking at the price tag"],
      ["a woman with tears in her eyes holding the letter", "a woman, head bowed, holding the letter"],
      ["a customer wincing at the price tag", "a customer flinching at the price tag"],
      ["a man squinting at the small print on the box", "a man leaning toward the small print on the box"],
      ["a woman asleep in bed with her eyes closed, the cat on her legs", "a woman asleep in bed, the cat on her legs"],
    ];
    for (const [asked, said] of cases) expect(expressionAsBody(asked), asked).toBe(said);
    // Said once is said: the body words are never read as a face again.
    for (const [, said] of cases) expect(expressionAsBody(said), said).toBe(said);
  });

  it("a phrase starts on a whole word, keeps its article, and a frown 'in' something leans forward", async () => {
    const { expressionAsBody } = await import("./hostLook");
    const cases: [string, string][] = [
      // The "an" ending "man"/"woman" began the phrase: "a mwith tense shoulders", "a womwith …".
      ["a man with a frown reading the bill", "a man with tense shoulders reading the bill"],
      ["a woman wears a frown as she reads the letter", "a woman with tense shoulders as she reads the letter"],
      ["a man wearing a smile on his face", "a man with a nod"],
      // "with a anxious set to the shoulders" was the plain swap.
      ["an older woman with an anxious expression, reading the letter", "an older woman with an anxious set to the shoulders, reading the letter"],
      ["a woman with an awkward smile on her face", "a woman with an awkward nod"],
      ["a man with an uneasy look on his face", "a man with an uneasy set to the shoulders"],
      // "leaning in in concentration", "leaning in into the sun".
      ["a man frowning in concentration at the bill", "a man leaning forward in concentration at the bill"],
      ["a woman squinting into the sun", "a woman leaning forward into the sun"],
      ["the man frowns", "the man leans in"],
    ];
    for (const [asked, said] of cases) expect(expressionAsBody(asked), asked).toBe(said);
    for (const [, said] of cases) expect(expressionAsBody(said), said).toBe(said);
    // Clean: an animal's look keeps its words, a word ending in "a" before it included.
    const dog = "a mama dog with a look of hope on its face beside the bowl";
    expect(expressionAsBody(dog)).toBe(dog);
  });

  it("clean: a thing, an animal's face, tearing and light keep their words, byte for byte", async () => {
    const { expressionAsBody, withoutFaceAsks } = await import("./hostLook");
    for (const as of [
      "hands tearing cloth into strips two fingers wide on the work table", // job 144 scene 55
      "Hands pull the shoji paper too tight, tearing it on the frame", // job 216 scene 55
      "sunlight beaming through the kitchen window onto the board",
      "the glare of the screen on the window",
      "the grey cat with its eyes closed on the owner's legs",
      "a burlap sack with its mouth open on the barn floor",
      "a smiley-face sticker on the fridge door",
      "an older man seen from behind planting a young tree in a backyard", // job 409 scene 18
      "a woman looking out of the window at the rain",
      "  hands sanding a board , with dust  ",
    ]) {
      expect(expressionAsBody(as), as).toBe(as);
      expect(withoutFaceAsks(as), as).toBe(as);
    }
  });

  it("markHostBroll says it with the body on someone else's picture and the host's from behind, never on the host's own face", () => {
    const scenes = [
      pic(8, "an older woman seen from the side smiling politely up at a flight attendant standing in the aisle", {
        scriptText: "She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.",
        humanPresent: true,
        otherPerson: "an older woman passenger and a flight attendant",
      }),
      pic(9, "the host smiling as she hands a jar of jam across the market table", { humanPresent: true }),
      // A step on the host's own face shows it, and keeps what the face does.
      pic(10, "the host smiling as she pats concealer under her eyes", { humanPresent: true }),
    ];
    markHostBroll(scenes, { hostLook: "a woman in her sixties with short grey hair" }, "https://x/host.png");
    expect(scenes[0].otherPerson).toBeTruthy();
    expect(scenes[0].showSubject).toBe("an older woman seen from the side nodding politely up at a flight attendant standing in the aisle");
    expect(scenes[1].brollHostLook).toBeTruthy();
    expect(scenes[1].showSubject).toBe("the host nodding as she hands a jar of jam across the market table");
    expect(scenes[2].hostFaceShown).toBe(true);
    expect(scenes[2].showSubject).toBe("the host smiling as she pats concealer under her eyes");
  });
});
