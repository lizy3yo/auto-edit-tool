/**
 * SPLIT PANELS ARE CHECKED AGAINST THEIR LINES, AND NAME ONE THING (round 11, 2026-10-18). The line
 * check ran at voicing, before any split existed, and `fitCandidate` left host beats out — so a
 * split's picture half was never asked whether it shows what its line is about. The review of jobs
 * 401-407 found the cost: job 401 scene 26 drew "I pull my chair in closer" as an empty chair beside
 * the host, scene 21 put the video's main prop under "Your problem is theft…", job 406 scene 19's
 * panel read "A guided sharpening system or belt sander setup …" and the picture model drew one
 * thing, the cheap one its memory held, under "a belt setup runs a hundred to three hundred
 * dollars". The cases are real rows; the rules are general.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  applyPanelFixes,
  FIT_SYSTEM,
  fitSplitPanelsToLines,
  oneThingOnly,
  oneThingPanels,
  PANEL_FIT_RULES,
  panelCandidate,
  parsePanelFixes,
  parsePictureFixes,
} from "./shotList";

const HOST_PROMPT =
  "the channel's host, exactly as in their host photo, seated in a chair talking directly to the camera, sitting still and composed";
const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const panel = (index: number, scriptText: string, splitVisual: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, hostPresent: true, visualPrompt: HOST_PROMPT, hostShot: 1, splitVisual, ...over }) as StoryboardScene;

/** Job 406's key things, as its props list wrote them. */
const GARAGE: KeyThing[] = [
  { main: true, name: "sharpening system", look: "a tabletop guided knife sharpener, black plastic base with metal guide rods, clamps to bench edge" },
  { name: "mower blade", look: "a flat steel blade with a rounded cutting edge, nicked and dull, mounted under a mower deck" },
  { name: "belt sharpening setup", look: "a benchtop machine with a spinning abrasive belt, metal frame, bolted to the garage workbench" },
];
/** Job 401's. */
const ESSAY: KeyThing[] = [
  { main: true, name: "sympathy card", look: "a plain cream card with a simple embossed border, no writing visible, held or resting on the desk" },
  { name: "chair", look: "a wooden chair with a curved back, pulled close to the desk" },
];

/** What the cases came from — never in the panel rules (they must fit any channel). */
const CHANNEL_OBJECTS = /sympathy|sharpen|belt|sander|swab|toilet|trapway|robin|tabby|chair|seneca|theft|thieves/i;

const PANEL_19 =
  "A guided sharpening system or belt sander setup sitting on a garage workshop bench, viewed from a step back, with hand tools and wall storage visible at the edges.";
const LINE_19 = "A guided sharpening system or a belt setup runs a hundred to three hundred dollars, and that’s the whole buy-in.";

describe("one thing, never X or Y (job 406 scene 19)", () => {
  it("the shipped panel keeps the first thing and everything after the choice", () => {
    expect(oneThingOnly(PANEL_19)).toBe(
      "A guided sharpening system sitting on a garage workshop bench, viewed from a step back, with hand tools and wall storage visible at the edges."
    );
  });

  it("its storyboard seed had two choices in it; both go", () => {
    // Job 406 scene 19's `brollVisual`, the panel's seed.
    const seed =
      "A guided sharpening system or belt sander setup sitting on a workshop bench—compact, practical, made for hand work—with a price tag or cost reference visible nearby (no readable numbers, just the suggestion of value).";
    expect(oneThingOnly(seed)).toBe(
      "A guided sharpening system sitting on a workshop bench—compact, practical, made for hand work—with a price tag visible nearby (no readable numbers, just the suggestion of value)."
    );
  });

  it("an alternative ending at a comma, at the end, or before where the thing is", () => {
    // Job 402 scene 33's scan-window prompt (a CTA cutaway, shown here only for the wording).
    expect(
      oneThingOnly("A flight attendant's hands holding a small packet of crackers or cookies, offering it downward toward a seated passenger")
    ).toBe("A flight attendant's hands holding a small packet of crackers, offering it downward toward a seated passenger");
    expect(oneThingOnly("either a stand mixer or a hand whisk on the counter")).toBe("a stand mixer on the counter");
    expect(oneThingOnly("Either a stand mixer or a hand whisk on the counter")).toBe("A stand mixer on the counter");
    expect(oneThingOnly("a bolt or a steel ring on the bench")).toBe("a bolt on the bench");
    // Rows of the local storyboards (jobs 396, 397, 401).
    expect(oneThingOnly("A household hallway or bedroom interior with a mounted smoke alarm visible on the ceiling")).toBe(
      "A household hallway with a mounted smoke alarm visible on the ceiling"
    );
    expect(oneThingOnly("Bare weathered hands gripping a car door or key, stepping toward a parked car.")).toBe(
      "Bare weathered hands gripping a car door, stepping toward a parked car."
    );
  });

  it("when the first is one describing word, the second, which carries the thing's name, is kept", () => {
    // Job 396 scene 1 and job 403 scene 1: cutting the second choice would have cut the noun with it
    // ("A white mounted flat against…").
    expect(oneThingOnly("A white or cream-colored smoke alarm mounted flat against a textured drywall ceiling")).toBe(
      "A cream-colored smoke alarm mounted flat against a textured drywall ceiling"
    );
    expect(oneThingOnly("A stretch of cream or pale-gray bathroom tile on the floor beside a white toilet bowl")).toBe(
      "A stretch of pale-gray bathroom tile on the floor beside a white toilet bowl"
    );
    expect(oneThingOnly("a coaster or small ornament")).toBe("a small ornament");
    // The article and a sentence's capital follow the thing kept (jobs 257, 279, 391, 325).
    expect(oneThingOnly("Close view of a white or ivory smoke alarm mounted on the ceiling")).toBe(
      "Close view of an ivory smoke alarm mounted on the ceiling"
    );
    expect(oneThingOnly("Coasters arranged in the basket. Late autumn or winter evening light.")).toBe(
      "Coasters arranged in the basket. Winter evening light."
    );
    expect(oneThingOnly("A screen in near view showing a progress bar or indicator line sliding upward across the top")).toBe(
      "A screen in near view showing an indicator line sliding upward across the top"
    );
    // A first choice ending on a describing word leaves the name to the second.
    expect(oneThingOnly("A chunky necklace made of very dark or black beads, held up to the light")).toBe(
      "A chunky necklace made of black beads, held up to the light"
    );
    // A doing word after the name closes the second choice.
    expect(oneThingOnly("A display showing a digital book or guide opened to a page with text")).toBe(
      "A display showing a digital book opened to a page with text"
    );
  });

  it("an 'or' that offers no choice of things is left exactly as written", () => {
    for (const text of [
      "one or two glass jars on the pantry shelf",
      "a quiet minute or so before the kettle boils",
      "a clean counter with no writing or logos anywhere",
      "the same bowl on the table, with or without its lid",
      "rest the dough an hour, or it cracks when rolled",
      "whether or not the lid is on, the jar sits by the window",
      "more or less the same jar on the shelf",
      // No clear end within five words: not guessed at.
      "a jar or a very old rusty dented metal tin can",
      // A list closed by ", or", under a negation (job 401 scenes 22-29) or not; "A, B or C".
      "Bare hands clasped together on a desk surface in a dim study. No face, head, or body visible.",
      "The plastic casing is smooth, with no visible battery door, pull-tab, or opening.",
      "a ceramic bowl, or a wooden one, on the kitchen table",
      "hand tools on the bench: chisels, planes or saws",
      // A choice of doing words (job 396 scene 7, job 401 scene 1).
      "Kitchen near the stove, bare weathered hands adjusting or pointing at something on the stovetop",
      "a few sympathy card envelopes, stacked or fanned loosely on a wire display",
      // A choice of states, of places, or of clauses (rows of jobs 215, 225, 279, 282).
      "The hair is wet or freshly styled, showing the gray roots",
      "The bag sits under the foot of the treadle, straps positioned ready or just stitched, by the window.",
      "A basket of coasters on a craft-fair table outdoors or in a covered market space.",
      "the driveway is empty behind it, showing the car has recently left or is about to.",
      "beginning with 'First line down' or similar, rendered in a clean font",
      // "or" inside words is no choice.
      "a tabletop knife sharpener clamped to the door frame of the floor cabinet",
      "A sympathy card lies on a study desk near a window, late morning light crossing the surface.",
    ])
      expect(oneThingOnly(text), text).toBe(text);
  });

  it("the cut never glues the two choices together (rows of the local storyboards, jobs 150-295)", () => {
    // Job 150 #96, a split panel: "lined" was read as where the pouch is, so the cut left "a pot
    // holder lined pouch".
    expect(
      oneThingOnly(
        "A finished quilted pot holder or small lined pouch resting flat on the wooden sewing table by the window, morning light soft across its stitched surface, empty and at rest."
      )
    ).toBe(
      "A finished quilted pot holder resting flat on the wooden sewing table by the window, morning light soft across its stitched surface, empty and at rest."
    );
    // A first choice that is only a word describing the name gives way to the second's (jobs 154, 163,
    // 172): keeping it and dropping the second left "a simple wooden in a modest room".
    expect(oneThingOnly("A small hand-pieced quilt draped over a simple wooden or metal rail in a modest room, the light soft and pale.")).toBe(
      "A small hand-pieced quilt draped over a simple metal rail in a modest room, the light soft and pale."
    );
    expect(oneThingOnly("The cloth shows faded geometric or floral print in muted tones; the weave is soft and worn at the edges.")).toBe(
      "The cloth shows faded floral print in muted tones; the weave is soft and worn at the edges."
    );
    expect(oneThingOnly("each square showing a distinct small-scale floral or check pattern in muted cotton prints")).toBe(
      "each square showing a distinct small-scale check pattern in muted cotton prints"
    );
    // A thing whose name ends like a doing word is still the thing (jobs 154, 166, 261).
    expect(oneThingOnly("a pale finished nine-patch top, an old worn blanket or plain batting beneath it, all layered")).toBe(
      "a pale finished nine-patch top, an old worn blanket beneath it, all layered"
    );
    expect(oneThingOnly("A finished scrap quilt project—a small pieced pillow or wall hanging—lies flat on the sewing room table")).toBe(
      "A finished scrap quilt project—a small pieced pillow—lies flat on the sewing room table"
    );
    expect(oneThingOnly("A finished scrap quilt project—perhaps a patchwork table runner or small pieced wall hanging—displayed flat")).toBe(
      "A finished scrap quilt project—perhaps a small pieced wall hanging—displayed flat"
    );
    expect(oneThingOnly("its blackened surface and simple geometry, with blurred autumn foliage or market setting softly behind.")).toBe(
      "its blackened surface and simple geometry, with blurred autumn foliage behind."
    );
    // Two whole choices, each with its own describing word (job 295): the first, never "light dark walnut".
    expect(oneThingOnly("Fingers curl around a small round wooden coaster in light maple or dark walnut. Other coasters sit stacked.")).toBe(
      "Fingers curl around a small round wooden coaster in light maple. Other coasters sit stacked."
    );
    // The first choice starts after the word saying what the thing does, never before it.
    expect(oneThingOnly("The shelf holds jars or small glass spice tins near the stove")).toBe(
      "The shelf holds small glass spice tins near the stove"
    );
    // Not clear where the second choice's name ends, or two whole new things: left as written.
    for (const text of ["a bag or small set of tools on the bench", "a rack of a wooden or a metal kind by the door"])
      expect(oneThingOnly(text), text).toBe(text);
  });

  it("oneThingPanels cuts only panels, and moves the key thing to what the panel still names", () => {
    const scenes = [
      panel(19, LINE_19, PANEL_19, { keyThing: "belt sharpening setup", otherKeyThings: ["sharpening system"] }),
      // A full-frame picture is not a panel: left to the picture writers.
      pic(20, "You charge five to ten dollars a knife", "a mower blade or a kitchen knife on the bench"),
      panel(16, "Number one: knife and tool sharpening.", "A tabletop knife sharpener clamped to a garage workbench."),
    ];
    expect(oneThingPanels(scenes, GARAGE)).toBe(1);
    expect(scenes[0].splitVisual).toMatch(/^A guided sharpening system sitting on/);
    // "belt sharpening setup" was only read off the two choices together; the panel is now the system.
    expect(scenes[0].keyThing).toBe("sharpening system");
    expect(scenes[0].otherKeyThings).toBeUndefined();
    expect(scenes[0].visualPrompt).toBe(HOST_PROMPT);
    expect(scenes[1].showSubject).toBe("a mower blade or a kitchen knife on the bench");
    expect(scenes[2].splitVisual).toBe("A tabletop knife sharpener clamped to a garage workbench.");
  });

  it("only the panels just written, when asked", () => {
    const a = panel(1, "x", "a coaster or small ornament on a shelf");
    const b = panel(2, "y", "a mug or a jar on a shelf");
    expect(oneThingPanels([a, b], undefined, s => s === b)).toBe(1);
    expect(a.splitVisual).toBe("a coaster or small ornament on a shelf");
    expect(b.splitVisual).toBe("a mug on a shelf");
  });
});

describe("the panel rules", () => {
  it("say what a panel adds to the line check, with no channel's objects", () => {
    expect(PANEL_FIT_RULES).toMatch(/only pictures to check are the PANEL lines/);
    expect(PANEL_FIT_RULES).toMatch(/A panel names ONE thing\. A panel that says "X or Y"/);
    expect(PANEL_FIT_RULES).toMatch(/even when the line itself offers the choice/);
    expect(PANEL_FIT_RULES).toMatch(/FIGURE OF SPEECH about what the host does or feels/);
    expect(PANEL_FIT_RULES).toMatch(/never the video's\s+MAIN thing unless the line names it/);
    expect(PANEL_FIT_RULES).toMatch(/a thing only a neighbouring line talks about/);
    expect(PANEL_FIT_RULES).toMatch(/NO person: no face, body, hands or arms/);
    // A body-part panel is drawn on the host (`buildSplitRightScene`): the check must not turn it into
    // a bottle or a loose lock, which the line check's own body-part rule forbids.
    expect(PANEL_FIT_RULES).toMatch(/The one exception is a body\s+part the line is about \(hair, skin, nails\): it is drawn on the host/);
    expect(PANEL_FIT_RULES).toMatch(/never rewrite it into a product or a part lying on its own/);
    expect(PANEL_FIT_RULES).toMatch(/never split or joined/);
    expect(PANEL_FIT_RULES).not.toMatch(CHANNEL_OBJECTS);
  });

  it("a CTA panel, a cutaway and a plain host take are not panels to check", () => {
    expect(panelCandidate(panel(1, "x", "a quiet bench"))).toBe(true);
    expect(panelCandidate(panel(1, "x", "a quiet bench", { cta: true }))).toBe(false);
    expect(panelCandidate(panel(1, "x", "  "))).toBe(false);
    expect(panelCandidate(pic(1, "x", "a quiet bench"))).toBe(false);
    expect(panelCandidate({ ...panel(1, "x", "a"), splitVisual: undefined })).toBe(false);
  });
});

describe("reading and applying a panel rewrite", () => {
  const CHAIR = "A wooden chair pulled close to a desk in a quiet study, positioned as if just moved nearer; a desk surface with papers and writing materials visible beyond.";
  const LINE_26 = "When a man like that sits down to write about time, I pull my chair in closer.";
  const board = () => [
    pic(25, "and a man who, years later, would be ordered to end his own life by the very emperor he had served.", "a man sitting alone in a dim study, head bowed"),
    panel(26, LINE_26, CHAIR, { keyThing: "chair", showSubject: "a wooden chair being pulled closer to a desk in the study" }),
  ];

  it("only panel ids are read; a panel is never split or joined and has nobody in it", () => {
    const scenes = board();
    const answer = {
      pictures: [
        { id: 0, about: "the emperor", shows_it: false, show: "a palace hall" },
        {
          id: 1,
          about: "a writer sitting down to write about time",
          shows_it: false,
          show: "a half-unrolled scroll and a reed pen on a wooden desk in a quiet study",
          thing: null,
          stage: null,
          other: "a writer",
          who: "a writer",
          join: true,
          split: [{ from: "I pull my chair", show: "an empty chair" }],
        },
      ],
    };
    const fixes = parsePanelFixes(JSON.stringify(answer), scenes);
    expect(fixes).toEqual([
      { id: 1, show: "a half-unrolled scroll and a reed pen on a wooden desk in a quiet study", stage: null },
    ]);
    // The line check proper never reads a panel.
    expect(parsePictureFixes(JSON.stringify(answer), scenes).map(f => f.id)).toEqual([0]);
  });

  it("job 401 scene 26: the panel is rewritten, the host half and its timing are not", () => {
    const scenes = board();
    const show = "a half-unrolled scroll and a reed pen on a wooden desk in a quiet study";
    expect(applyPanelFixes(scenes, [{ id: 1, show, stage: null }], ESSAY)).toBe(1);
    const s = scenes[1];
    expect(s.splitVisual).toBe(show);
    // A later redraw rewrites from the checked words, not the chair.
    expect(s.splitVisualSeed).toBe(show);
    // The chair's pictures no longer feed the panel (`withSplitMemory` reads the key thing).
    expect(s.keyThing).toBeUndefined();
    expect(s.hostPresent).toBe(true);
    expect(s.visualPrompt).toBe(HOST_PROMPT);
    expect(s.hostShot).toBe(1);
    expect(s.scriptText).toBe(LINE_26);
    // The full-frame picture beside it is the line check's, not this pass's.
    expect(scenes[0].showSubject).toBe("a man sitting alone in a dim study, head bowed");
  });

  it("job 401 scene 21: the main prop under an idea it has no tie to loses its key thing", () => {
    const s = panel(21, "Your problem is theft, and by the end of this video you will be able to name all seven of the thieves.",
      "A sympathy card lies on a study desk near a window, late morning light crossing the surface. The card is closed, at rest, alone in the frame.",
      { keyThing: "sympathy card" });
    expect(applyPanelFixes([s], [{ id: 0, show: "a wall clock above an empty desk at midnight" }], ESSAY)).toBe(1);
    expect(s.keyThing).toBeUndefined();
    expect(s.splitVisual).toBe("a wall clock above an empty desk at midnight");
  });

  it("job 406 scene 19: the check's one thing becomes the panel's key thing", () => {
    const s = panel(19, LINE_19, PANEL_19, { keyThing: "belt sharpening setup", otherKeyThings: ["sharpening system"] });
    applyPanelFixes([s], [{ id: 0, show: "a benchtop belt sharpening setup bolted to a garage workbench", thing: "belt sharpening setup" }], GARAGE);
    expect(s.splitVisual).toBe("a benchtop belt sharpening setup bolted to a garage workbench");
    expect(s.keyThing).toBe("belt sharpening setup");
    expect(s.otherKeyThings).toBeUndefined();
  });

  it("a rewrite with a person or hands in it is not used; a body part (drawn on the host) is", () => {
    const s = panel(1, "Hold the blade to the belt for a count of three.", "a benchtop belt sharpening setup on a bench");
    expect(applyPanelFixes([s], [{ id: 0, show: "bare hands holding a mower blade against the belt" }], GARAGE)).toBe(0);
    expect(s.splitVisual).toBe("a benchtop belt sharpening setup on a bench");
    const hair = panel(2, "That gloss brings the shine right back.", "a bottle of hair gloss on a bathroom shelf");
    expect(applyPanelFixes([hair], [{ id: 0, show: "freshly glossed silver hair, a close view" }], undefined)).toBe(1);
  });

  it("what the sentence rules out rides a panel the check left as it is", () => {
    const s = panel(1, "Keep the fuel can well away from the bench grinder.", "a red fuel can on a garage shelf");
    const fixes = parsePanelFixes(
      JSON.stringify({ pictures: [{ id: 0, about: "where to keep the fuel", shows_it: true, forbids: "the fuel can beside the grinder" }] }),
      [s]
    );
    expect(applyPanelFixes([s], fixes, undefined)).toBe(0);
    expect(s.forbids).toBe("the fuel can beside the grinder");
    expect(s.splitVisual).toBe("a red fuel can on a garage shelf");
  });
});

describe("the panel pass end to end (canned answer — the plumbing, not the model)", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("the panels are marked, the rest is context, and only the panel is rewritten", async () => {
    const scenes = [
      pic(18, "and every shed has a mower blade that’s beating the grass instead of cutting it.", "a nicked dull mower blade under a mower deck"),
      panel(19, LINE_19, PANEL_19),
      pic(20, "You charge five to ten dollars a knife and ten to twenty a mower blade.", "the host sharpening a mower blade on a benchtop belt sharpening setup"),
      { ...panel(33, "Scan the code on screen now.", "a calm workbench"), cta: true } as StoryboardScene,
      { index: 34, narration: "See you next time.", scriptText: "See you next time.", hostPresent: true, visualPrompt: HOST_PROMPT } as StoryboardScene,
    ];
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: [
          { id: 0, about: "a dull mower blade", shows_it: false, show: "a pile of grass clippings" },
          { id: 1, about: "what the buy-in buys", shows_it: false, show: "a benchtop belt sharpening setup bolted to a garage workbench", thing: "belt sharpening setup", stage: null },
          { id: 3, about: "the pitch", shows_it: false, show: "a phone showing a code" },
        ],
      }),
    });
    const r = await fitSplitPanelsToLines(scenes, { keyThings: GARAGE, subject: "garage businesses" });
    const call = mockInvoke.mock.calls[0][0];
    expect(call.systemPrompt).toBe(FIT_SYSTEM);
    expect(call.systemSuffix).toBe(PANEL_FIT_RULES);
    expect(call.step).toBe("Line check (split panels)");
    const sent: string = call.userMessage;
    expect(sent).toContain(`#1 PANEL: said "${LINE_19}" | shows: ${PANEL_19}`);
    expect(sent).toContain('CONTEXT: said "and every shed has a mower blade');
    expect(sent).toContain('HOST/OTHER: "Scan the code on screen now."');
    expect(sent).toContain('HOST/OTHER: "See you next time."');
    expect(sent).not.toContain("#0 ");
    expect(sent).toContain("KEY THINGS: MAIN sharpening system:");
    expect(r).toEqual({ checked: 1, fixed: 1 });
    expect(scenes[1].splitVisual).toBe("a benchtop belt sharpening setup bolted to a garage workbench");
    expect(scenes[1].keyThing).toBe("belt sharpening setup");
    expect(scenes[1].visualPrompt).toBe(HOST_PROMPT);
    // The cutaway and the CTA panel are not this pass's to change.
    expect(scenes[0].showSubject).toBe("a nicked dull mower blade under a mower deck");
    expect(scenes[3].splitVisual).toBe("a calm workbench");
  });

  it("a film with no panel costs nothing", async () => {
    const r = await fitSplitPanelsToLines([pic(1, "a line", "a picture")]);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(r).toEqual({ checked: 0, fixed: 0 });
  });

  it("a failed check changes nothing", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("529"));
    const scenes = [panel(1, LINE_19, PANEL_19)];
    const r = await fitSplitPanelsToLines(scenes, { keyThings: GARAGE });
    expect(r).toEqual({ checked: 0, fixed: 0 });
    expect(scenes[0].splitVisual).toBe(PANEL_19);
  });
});
