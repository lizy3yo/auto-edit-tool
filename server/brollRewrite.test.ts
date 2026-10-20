/**
 * A cutaway's prompt is written for what the shot will be, and a rewrite that is not its picture is
 * refused (2026-10-20, job 413 scenes 9-10, Gary's garage businesses: both pictures shipped the
 * hands-at-work VIDEO directive they were given, reworded, as their description). Lines, subjects and
 * answers are the real ones from the local storyboards.
 */
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  addedKeyThings,
  cutawayPromptLane,
  leavesOutSubject,
  leftMotionLane,
  listedItems,
  notYetSaid,
  ownWordsOf,
  repeatsDirective,
  rewriteFallback,
  rewriteFault,
  saysNothingThere,
  withoutAddedKeyThings,
} from "./brollRewrite";

// The directive scenes 9-10 were handed (retired by this fix — no hands video is ever made).
const OLD_HANDS_DIRECTIVE =
  "IMPORTANT: this is a VIDEO cutaway with hands at work — the narration implies a manual " +
  "action. For this one prompt, override the paused/at-rest rule for the hands ONLY: describe " +
  "bare weathered hands already in frame and mid-task from the start (fingers on the tool, " +
  "pressing or adjusting what they work on), never entering from off-screen and never paused " +
  "on a finished result. Keep everything else at rest — no face, head, or body, and no broad " +
  "arm movement. The hands hold realistic anatomy with no extra fingers.";
// What both scenes came back as.
const ANSWER_413 =
  "Bare weathered hands with fingers already on a tool or workbench task, pressing or adjusting what " +
  "they work on. Wooden workbench, pegboard wall, and tools visible in the background. No face, head, " +
  "shoulders, or body visible.";
// The person-free rule every cutaway is still given.
const PERSON_FREE =
  "IMPORTANT: this cutaway must show NO PERSON — no face, head, hair, shoulders, torso, legs, " +
  "silhouette, reflection, or anyone in the background. If the original names or implies a " +
  "person (a man, a gardener, a homeowner, someone watching or inspecting), rewrite them out: " +
  "keep the object, tool, task, or result they interact with, or reduce them to a pair of bare " +
  "hands at the work, framed so nothing above the forearms is in shot.";

const SCENE_9 = {
  showSubject: "the host working at his garage workbench with tools around him",
  scriptText:
    "and Gary’s Garage Secrets is for working people who want extra income with numbers a neighbor would believe — no apps, no coins, no course-sellers.",
};
const SCENE_10 = {
  showSubject: "the host pulling a stool up to the garage workbench and opening a notebook",
  scriptText: "Here’s tonight’s deal:",
};

const cut = (over: Partial<StoryboardScene>): StoryboardScene =>
  ({ index: 1, narration: "n", visualPrompt: "vp", hostPresent: false, ...over }) as StoryboardScene;

describe("cutawayPromptLane — written for what the video rule will make the shot", () => {
  it("job 413 scenes 9-10: a shot of the host at the bench is written as a photo, though the balancer had made it moving", () => {
    // As the prompt writer saw them: moving, a person in them.
    for (const s of [SCENE_9, SCENE_10])
      expect(cutawayPromptLane(cut({ ...s, visualPrompt: s.showSubject, stillImage: false, humanPresent: true }))).toBe("still");
    // …and as they shipped, after the gate.
    expect(
      cutawayPromptLane(cut({ ...SCENE_9, stillImage: true, humanPresent: true, selfMoving: false }))
    ).toBe("still");
  });

  it("a thing that moves by itself is still written as a video, and a photo of it caught mid-motion keeps that wording", () => {
    const steam = { showSubject: "steam rising from a kettle on the stove", objectMotion: true as const };
    expect(cutawayPromptLane(cut({ ...steam, stillImage: false }))).toBe("video");
    expect(cutawayPromptLane(cut({ ...steam, stillImage: false, selfMoving: true }))).toBe("video");
    expect(cutawayPromptLane(cut({ ...steam, stillImage: true }))).toBe("moving-thing");
  });

  it("a shot the rule will not let move is written as a photo: judged still, hands, a tool biting in", () => {
    expect(
      cutawayPromptLane(cut({ showSubject: "a sliding door in a quiet room", objectMotion: true, stillImage: false, selfMoving: false }))
    ).toBe("still");
    expect(
      cutawayPromptLane(cut({ showSubject: "hands pouring water into a pot", objectMotion: true, stillImage: false }))
    ).toBe("still");
    expect(
      cutawayPromptLane(cut({ showSubject: "a drill boring into an oak board", objectMotion: true, stillImage: false, toolContact: true }))
    ).toBe("still");
    expect(cutawayPromptLane(cut({ showSubject: "a quiet workbench", stillImage: true }))).toBe("still");
  });
});

describe("leftMotionLane — a shot written for motion that is now a photo is written again", () => {
  it("the self-moving judge found nothing moving by itself, and the gate made the shot a photo", () => {
    expect(
      leftMotionLane(cut({ showSubject: "a sliding door in a quiet room", promptLane: "video", stillImage: true, selfMoving: false }))
    ).toBe(true);
  });

  it("a thing that still moves, made a photo only for the video share, keeps its in-motion wording (no call)", () => {
    // `removeMotion` / `capMovingLength` clear `objectMotion` as they make it a photo; the steam still
    // rises by itself, and the plain-photo rewrite's settled-instant rule would settle it away.
    const steam = { showSubject: "steam rising from a kettle on the stove", promptLane: "video" as const };
    expect(leftMotionLane(cut({ ...steam, stillImage: true, objectMotion: undefined, selfMoving: true }))).toBe(false);
    // Never judged (mock mode, or the judge's batch failed): the planner's call stands.
    expect(leftMotionLane(cut({ ...steam, stillImage: true, objectMotion: undefined }))).toBe(false);
  });

  it("left alone: still moving, still caught mid-motion, written as a photo, never written, a host take, a CTA", () => {
    const steam = { showSubject: "steam rising from a kettle on the stove", objectMotion: true as const };
    expect(leftMotionLane(cut({ ...steam, promptLane: "video", stillImage: false }))).toBe(false);
    expect(leftMotionLane(cut({ ...steam, promptLane: "video", stillImage: true }))).toBe(false);
    expect(leftMotionLane(cut({ ...SCENE_9, promptLane: "still", stillImage: true, humanPresent: true }))).toBe(false);
    expect(leftMotionLane(cut({ ...SCENE_9, stillImage: true, humanPresent: true }))).toBe(false);
    expect(leftMotionLane(cut({ promptLane: "video", stillImage: true, hostPresent: true }))).toBe(false);
    expect(leftMotionLane(cut({ promptLane: "video", stillImage: true, cta: true }))).toBe(false);
  });
});

describe("rewriteFault — a rewrite that is not its picture", () => {
  it("job 413: both answers repeat the directive they were given; scene 10's also leaves out its stool and notebook", () => {
    expect(repeatsDirective(ANSWER_413, [OLD_HANDS_DIRECTIVE], [SCENE_9.showSubject, SCENE_9.scriptText].join(" "))).toBe(true);
    expect(rewriteFault(ANSWER_413, SCENE_9, SCENE_9.showSubject, [OLD_HANDS_DIRECTIVE])).toBe("directive");
    expect(rewriteFault(ANSWER_413, SCENE_10, SCENE_10.showSubject, [OLD_HANDS_DIRECTIVE])).toBe("directive");
    // Without the directive to compare against (it is no longer sent), scene 10's is still refused…
    expect(rewriteFault(ANSWER_413, SCENE_10, SCENE_10.showSubject, [PERSON_FREE])).toBe("subject");
    expect(leavesOutSubject(ANSWER_413, SCENE_10.showSubject)).toBe(true);
    // …while scene 9's names three of its four words (work, workbench, tools): the photo lane is its fix.
    expect(leavesOutSubject(ANSWER_413, SCENE_9.showSubject)).toBe(false);
  });

  it("the neighbouring good rewrites of job 413 stand (scenes 11-12)", () => {
    const s11 = {
      showSubject:
        "the guided knife-sharpening unit on the workbench with a kitchen knife clamped in its guide and the host's hands drawing a stone along the edge",
      scriptText: "seventeen businesses,",
    };
    const s12 = {
      showSubject: "the host's hands tallying receipts with a pencil beside a calculator on the workbench",
      scriptText: "the true cost to start each one,",
    };
    expect(
      rewriteFault(
        "A guided knife-sharpening unit clamped to a garage workbench with a kitchen knife held in its metal guide, bare weathered hands pressing an abrasive stone along the blade edge, concrete floor and tool pegboard in the background.",
        s11,
        s11.showSubject,
        [PERSON_FREE, OLD_HANDS_DIRECTIVE]
      )
    ).toBeUndefined();
    expect(
      rewriteFault(
        "Bare weathered hands at a garage workbench holding a pencil over scattered receipts, a calculator resting nearby on the wood surface, workbench edge and tools visible at the frame edges.",
        s12,
        s12.showSubject,
        [PERSON_FREE, OLD_HANDS_DIRECTIVE]
      )
    ).toBeUndefined();
  });

  it("the person-free rule's own stand-in is no repeat (jobs 140, 141)", () => {
    expect(
      repeatsDirective(
        "A close-up from the doer's perspective showing a pair of bare hands at the treadle sewing machine, working a completed apron through the needle, the wooden treadle visible below the work surface as the seams are being finished, the rhythm of the hand-powered machine evident in the steadiness of the stitching.",
        [PERSON_FREE],
        "It takes about fifty minutes on the treadle."
      )
    ).toBe(false);
    expect(
      repeatsDirective(
        "A pair of bare weathered adult hands positioned from waist-height, holding an assembled cedar planter box steady on the workshop bench, the box's corner joints and exterior screws visible, hands and forearms only—no face, head, or body in shot.",
        [PERSON_FREE, OLD_HANDS_DIRECTIVE],
        "Cut your sides, screw the box together with exterior screws, drill a couple of drain holes in the bottom,"
      )
    ).toBe(false);
  });

  it("a rewrite of something else entirely is refused (job 409 scene 28, job 259 scene 12)", () => {
    const s28 = {
      showSubject: "the host reading a book at the desk in the study",
      scriptText:
        "The essay is called On the Shortness of Life, and it opens by picking a fight with its own title. Everyone complains that life is too short, Seneca says.",
    };
    expect(rewriteFault("a farmer standing in a field, seen from behind", s28, s28.showSubject, [PERSON_FREE])).toBe("subject");
    const alarm = {
      showSubject: "A close-up of the smoke alarm's domed face, showing its sensor grille and test button.",
      scriptText: "First thing on the label. The type. Ionization is quick on open flame,",
    };
    expect(
      rewriteFault(
        "Two alarm boxes on a retail shelf: one labeled ionization multipack, one photoelectric unit, boxes side by side showing their printed graphics and product names clearly.",
        alarm,
        alarm.showSubject,
        [PERSON_FREE]
      )
    ).toBe("subject");
  });

  it("a subject made of the line's own words is the rewrite's to make concrete (jobs 355, 338)", () => {
    // The group picture before a list…
    expect(
      rewriteFault(
        "A tan paper feed sack, a galvanized metal feed tin with snap-fit lid, and a plain ceramic bowl of kitchen scraps laid out side by side on a garage workbench.",
        {
          showSubject:
            "find every leak in that bag, plug them one at a time and fill the gaps with cheaper food together, laid out side by side",
          scriptText: "a fifty-pound feed bag into the truck, pull up a bucket and sit with me. We're going to",
          listSet: true,
        },
        "find every leak in that bag, plug them one at a time and fill the gaps with cheaper food together, laid out side by side",
        [PERSON_FREE]
      )
    ).toBeUndefined();
    // …and a step.
    expect(
      rewriteFault(
        "A pair of bare hands paused over the walnut and maple cutting board on the workbench, tools hung organized on the pegboard wall behind, garage workshop interior.",
        {
          showSubject: "the host's hands, mid-step: let every piece find its lane, while making the cutting board",
          scriptText: "and let every piece find its lane.",
          listCut: true,
        },
        "the host's hands, mid-step: let every piece find its lane, while making the cutting board",
        [PERSON_FREE]
      )
    ).toBeUndefined();
  });

  it("a paraphrase that keeps its subject stands; a subject too short to judge is not judged", () => {
    expect(
      leavesOutSubject(
        "A rat at ground level in dim light, mouth open around a tan feed pellet, with more scattered pellets visible in the dirt nearby.",
        "a rat carrying a pellet away from the scattered pellets beneath the feeder in the dark"
      )
    ).toBe(false);
    expect(leavesOutSubject("an oak board on the bench", "a saw")).toBe(false);
    expect(leavesOutSubject("an oak board on the bench", undefined)).toBe(false);
  });
});

describe("rewriteFallback — the scene's own words", () => {
  it("job 413 scene 10 goes back to its own description", () => {
    expect(rewriteFallback(SCENE_10, SCENE_10.showSubject)).toBe(SCENE_10.showSubject);
  });

  it("a seed that has itself left the subject behind gives way to the subject", () => {
    expect(rewriteFallback(SCENE_10, "a stack of feed sacks against the garage wall")).toBe(SCENE_10.showSubject);
    // No subject: the seed, whatever it says.
    expect(rewriteFallback({}, "a stack of feed sacks")).toBe("a stack of feed sacks");
  });
});

// ─── Nothing the line does not name (2026-10-20, job 414 scenes 2-8) ─────────────────────────────
// An old-cabin film whose reveal at 21 s is "But on the back wall hung an axe, a froe, and a
// drawknife": the prompt writer put the three tools into every picture from 2.6 s. Lines, subjects,
// key things and rewrites are the real ones from the local storyboards.

const STEEL_TOOLS = {
  name: "steel tools",
  look: "an axe, a froe, and a drawknife hanging together on the cabin's back interior wall",
  main: true as const,
};
const THINGS_414 = [
  STEEL_TOOLS,
  { name: "white oak bolt", look: "a short pale log section with straight grain, split from a larger white oak log" },
  { name: "chestnut bolt", look: "a short tan-brown log section with straight grain, split from a larger chestnut log" },
  { name: "green poplar log", look: "a long straight tulip poplar log, pale greenish-white bark, two faces freshly hewn flat" },
  { name: "split shingle", look: "a thin pale wood board, one end shaved thinner by a drawknife, tapered edge" },
  { name: "roof pole", look: "a long rough-barked pole laid crosswise over shingle courses to weigh them down" },
  { name: "broadaxe", look: "a heavy steel axe with a wide flat blade and a short curved wooden handle" },
  { name: "hearth", look: "a stone fireplace set into the cabin's interior wall, dark soot-stained opening" },
  { name: "wooded felling area", look: "a stand of tall bare-branched trees in a clearing, cut stumps and fallen logs on the ground" },
];
// The film's first ten lines, in order (scene 1 is the host's).
const LINES_414 = [
  "Go through an old mountain cabin looking for anything",
  "a store sold, and you will come up nearly empty-handed.",
  "A log restorer in Grayson County, Virginia, let me try it.",
  "The roof was split oak, the walls were hewn poplar, and the door hung on wooden pins with a string for a lock. But on the back wall hung",
  "an axe,",
  "a froe,",
  "and a drawknife,",
  "and the steel in those three was the one thing that homestead could not grow.",
  "That steel is why the last skill on this list held the other twenty-four together.",
  "I am Sam, and this one is for anybody who has wondered",
];
const SCENE_2 = {
  scriptText: LINES_414[1],
  showSubject: "the old log cabin interior, looking for store-bought goods",
};
const REWRITE_2 =
  "Interior of a historic log cabin in Grayson County, Virginia, with hewn poplar walls. The back wall shows " +
  "an axe, a froe, and a drawknife hanging together. Scattered salvage and old objects rest on surfaces around " +
  "the cabin's dim interior.";
const SCENE_3 = {
  scriptText: LINES_414[2],
  showSubject: "a log restorer working at the cabin's log wall, seen from behind",
};
const REWRITE_3 =
  "Close view of bare weathered hands working on a hewn poplar log wall inside the cabin, fingers pressing and " +
  "adjusting with a tool. The back wall with the three hung steel tools is visible behind. Nothing above the " +
  "forearms shown.";
const PANEL_SEED_4 =
  "an old log cabin seen from outside, its walls made of hewn logs with scalloped axe marks and pale chinking, " +
  "a roof of split oak boards, and a plank door hung on wooden pins with a latch string hanging out";
const PANEL_REWRITE_4 =
  "A back wall inside an abandoned log cabin, hewn poplar logs showing axe marks, with an axe, froe, and " +
  "drawknife hung on the wall above a worn wooden shelf.";

describe("listedItems — a group key thing is named by its items", () => {
  it("job 414: the three tools of 'steel tools'", () => {
    expect(listedItems(STEEL_TOOLS.look)).toEqual(["axe", "fro", "drawknif"]);
  });

  it("one thing's parts or features are no list (job 414's broadaxe and shingle, job 411's robin)", () => {
    expect(listedItems("a heavy steel axe with a wide flat blade and a short curved wooden handle")).toEqual([]);
    expect(listedItems("a thin pale wood board, one end shaved thinner by a drawknife, tapered edge")).toEqual([]);
    expect(
      listedItems("an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring")
    ).toEqual([]);
    expect(listedItems(undefined)).toEqual([]);
  });
});

describe("notYetSaid — what a later line reveals", () => {
  it("job 414: the three tools are not yet said under every picture before 'an axe,'", () => {
    for (const i of [1, 2, 3]) expect(notYetSaid(LINES_414, i, THINGS_414).map(t => t.name)).toContain("steel tools");
    // Said from the list on — the group shot of "those three" is free to show them.
    for (const i of [4, 7, 8]) expect(notYetSaid(LINES_414, i, THINGS_414).map(t => t.name)).not.toContain("steel tools");
  });

  it("a thing no line ever says reveals nothing, and neither does one already said", () => {
    // "hearth" is never said in these lines; "split shingle" and "green poplar log" are said in
    // passing at scene 4 ("split oak", "hewn poplar"), read loosely — not yet at scene 2.
    expect(notYetSaid(LINES_414, 1, THINGS_414).map(t => t.name)).not.toContain("hearth");
    expect(notYetSaid(LINES_414, 1, THINGS_414).map(t => t.name)).toContain("split shingle");
    const names = notYetSaid(LINES_414, 3, THINGS_414).map(t => t.name);
    expect(names).not.toContain("split shingle");
    expect(names).not.toContain("green poplar log");
  });
});

describe("withoutAddedKeyThings — a rewrite shows nothing its line does not name", () => {
  const later = (i: number) => notYetSaid(LINES_414, i, THINGS_414);

  it("job 414 scene 2: the back wall with the three tools goes, the rest of the rewrite stays word for word", () => {
    const own = ownWordsOf(SCENE_2, SCENE_2.showSubject);
    const kept =
      "Interior of a historic log cabin in Grayson County, Virginia, with hewn poplar walls. Scattered salvage " +
      "and old objects rest on surfaces around the cabin's dim interior.";
    expect(addedKeyThings(REWRITE_2, own, later(1))).toEqual(["steel tools"]);
    expect(withoutAddedKeyThings(REWRITE_2, own, later(1))).toEqual({ text: kept, added: ["steel tools"], left: kept });
  });

  it("job 414 scene 3: 'the three hung steel tools … visible behind' goes, the restorer at the wall stays", () => {
    const r = withoutAddedKeyThings(REWRITE_3, ownWordsOf(SCENE_3, SCENE_3.showSubject), later(2));
    expect(r.added).toEqual(["steel tools"]);
    expect(r.text).toBe(
      "Close view of bare weathered hands working on a hewn poplar log wall inside the cabin, fingers pressing " +
        "and adjusting with a tool. Nothing above the forearms shown."
    );
  });

  it("job 414 scene 4's panel was about the tools: refused — one 'axe marks' in its seed does not name all three", () => {
    const own = ownWordsOf({ scriptText: LINES_414[3], showSubject: PANEL_SEED_4 }, PANEL_SEED_4);
    const r = withoutAddedKeyThings(PANEL_REWRITE_4, own, later(3));
    expect(r.added).toEqual(["steel tools"]);
    expect(r.text).toBeUndefined();
  });

  it("a key thing the line names stays: job 414's group shot under 'the steel in those three', and the list's axe", () => {
    const group = {
      scriptText: LINES_414[7],
      showSubject: "a closer view of the steel tools hanging on the cabin wall",
      keyThing: "steel tools",
    };
    const rewrite8 =
      "The axe, froe, and drawknife hanging together on the cabin's back interior wall, all three steel tools " +
      "visible in one view against the dark hewn poplar.";
    // Held to EVERY key thing, not only the ones not yet said: still nothing to take out.
    expect(withoutAddedKeyThings(rewrite8, ownWordsOf(group, group.showSubject), THINGS_414)).toEqual({
      text: rewrite8,
      added: [],
    });
    const axe = { scriptText: "an axe,", showSubject: "an axe (for the steel tools)", keyThing: "steel tools" };
    const rewrite5 =
      "An axe hanging on the cabin's back interior wall, its wide flat steel blade and short curved wooden handle " +
      "clearly visible against the dark wood.";
    expect(withoutAddedKeyThings(rewrite5, ownWordsOf(axe, axe.showSubject), THINGS_414).text).toBe(rewrite5);
  });

  it("job 411 scenes 18 and 24: a thing a later line reveals goes with its part of the sentence only", () => {
    // Holly is first said at scene 25 ("While the robins work on that holly").
    const holly = {
      name: "holly bush",
      look: "a dense evergreen shrub with glossy pointed dark green leaves and clusters of bright red berries",
    };
    const lawn = { name: "lawn", look: "a wide stretch of short green-to-brown grass covering the backyard" };
    const lines = [
      "If so many of them stay, then why does the yard feel so empty come November?",
      "and that’s easy to miss with the storm windows shut.",
      "While the robins work on that holly, here’s something to help you name everything else out there.",
    ];
    const things = notYetSaid(lines, 1, [holly, lawn]);
    expect(things.map(t => t.name)).toEqual(["holly bush"]);
    const storm = {
      scriptText: lines[1],
      showSubject:
        "close-up of the clear glass storm window pane in a white aluminum frame, shut over the kitchen window, with the wintry yard blurred outside",
    };
    expect(
      withoutAddedKeyThings(
        "A clear glass storm window pane in a white aluminum frame mounted over the kitchen window, closed, with the " +
          "wintry backyard lawn and holly bushes softly out of focus beyond the glass.",
        ownWordsOf(storm, storm.showSubject),
        things
      ).text
    ).toBe("A clear glass storm window pane in a white aluminum frame mounted over the kitchen window, closed.");
    // The empty yard: held to every key thing its own words do not name.
    const empty = { scriptText: lines[0], showSubject: "the empty backyard lawn in late November light" };
    expect(
      withoutAddedKeyThings(
        "The suburban backyard lawn in late November, short brown grass stretching empty, holly bushes along the " +
          "border, no birds visible, late fall light.",
        ownWordsOf(empty, empty.showSubject),
        [holly, lawn]
      ).text
    ).toBe("The suburban backyard lawn in late November, short brown grass stretching empty, no birds visible, late fall light.");
  });

  it("left alone: the line's word in another form (job 411 'snowy'), a thing only where something sits (job 161), part of a name (job 143)", () => {
    const snow = { name: "snow", look: "a thin even layer of white snow covering the lawn and holly leaves in late winter" };
    const birder = {
      scriptText:
        "the big holiday tally birders have kept going for more than a hundred years, and they’ll tell you a different story.",
      showSubject: "a birder in a winter coat seen from behind, looking through binoculars at trees in a snowy park",
    };
    const rewrite11 =
      "Bare hands holding binoculars, raised to eye level, facing snowy evergreen trees in a park with snow on the " +
      "ground and branches, winter daylight.";
    expect(withoutAddedKeyThings(rewrite11, ownWordsOf(birder, birder.showSubject), [snow]).text).toBe(rewrite11);

    const pad = {
      name: "concrete pad",
      look: "plain gray concrete slab just outside the garage door, scorch marks and ash dust scattered across it",
    };
    const torch = {
      scriptText: "and light a fire down inside it.",
      showSubject: "hands holding a propane torch with a narrow blue flame near tied cedar boards, spray bottle nearby",
    };
    const rewrite252 =
      "Weathered bare hands grip a silver propane torch with a narrow blue flame, positioned near the base of three " +
      "cedar boards tied in a triangle on a concrete pad; a clear spray bottle rests nearby; soft diffuse daylight; " +
      "hands and torch angled toward the boards, ready to char from within.";
    expect(addedKeyThings(rewrite252, ownWordsOf(torch, torch.showSubject), [pad])).toEqual(["concrete pad"]);
    expect(withoutAddedKeyThings(rewrite252, ownWordsOf(torch, torch.showSubject), [pad]).text).toBe(rewrite252);

    const chisels = {
      name: "chisel set",
      look: "three wood-handled chisels of different widths, lined up in a canvas roll on the bench, beveled steel edges catching the light",
    };
    expect(
      addedKeyThings(
        "A beginner's kumiko lattice panel lying flat on a workshop bench under even daylight, its geometric grid of " +
          "pale wood strips showing fresh chisel marks and slightly uneven joins.",
        "I'm not going to pretend my grid belongs in the same room as theirs.",
        [chisels]
      )
    ).toEqual([]);
  });

  it("no key things, or nothing added: the rewrite comes back as it was", () => {
    expect(withoutAddedKeyThings(REWRITE_2, "", undefined)).toEqual({ text: REWRITE_2, added: [] });
    expect(withoutAddedKeyThings(REWRITE_2, "", [])).toEqual({ text: REWRITE_2, added: [] });
  });
});

describe("saysNothingThere — a line about an empty place or a search that finds nothing", () => {
  it("the real lines that say so", () => {
    for (const line of [
      "a store sold, and you will come up nearly empty-handed.", // job 414 scene 2
      "If so many of them stay, then why does the yard feel so empty come November?", // job 411 scene 18
      "The song at first light goes quiet, the grass sits empty in the mornings,", // job 404 scene 2
      "it tells them when the house is empty.", // job 242 scene 3
      "I searched the whole shed and found nothing.",
    ])
      expect(saysNothingThere(line), line).toBe(true);
  });

  it("'bare' or 'empty' before a thing, and a 'nothing' that goes on, are not (the local films' own lines)", () => {
    for (const line of [
      "Keep the stack off bare concrete,", // job 352
      "Two clean seams, and nothing in there that can unravel on you.", // job 106
      "Now I love a quilt, and there is nothing", // job 154 — the sentence goes on
      "Nothing there is going anywhere.", // jobs 222, 235 (a CTA)
      "the cost is nothing at all",
      "Rinse the empty jar and set it upside down to dry.",
      "",
    ])
      expect(saysNothingThere(line), line).toBe(false);
    expect(saysNothingThere(undefined)).toBe(false);
  });
});
