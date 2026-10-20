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
  keepPanelTools,
  leadIntoNext,
  lineTool,
  withLineTool,
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

// A PANEL IS ABOUT ITS WHOLE LINE, AND KEEPS THE TOOL ITS LINE NAMES (round 14, 2026-10-20). Job 414
// (an Appalachian woodworking film): scene 4's panel showed the inside back wall for ten seconds while
// the voice described the cabin from outside — only the line's last six words, the start of the next
// sentence, were about that wall — and scene 22's panel showed a finished shingle under "got shaved
// thin at one end with a drawknife", the tool gone with the hands. The rows are the job's own.
describe("a panel is about its whole line, and keeps the tool its line names (job 414 scenes 4 and 22)", () => {
  const LINE_4 =
    "The roof was split oak, the walls were hewn poplar, and the door hung on wooden pins with a string for a lock. But on the back wall hung";
  const WALL_4 =
    "A back wall inside an abandoned log cabin, hewn poplar logs showing axe marks, with an axe, froe, and drawknife hung on the wall above a worn wooden shelf.";
  const LINE_22 = "They went up rough as shakes, or got shaved thin at one end with a drawknife to make shingles.";
  const SHINGLE_22 =
    "a split shingle lying on a log outside the cabin, one end shaved thin to a smooth taper, fresh pale wood curls scattered beside it";
  const CABIN_THINGS: KeyThing[] = [
    { main: true, name: "steel tools", look: "an axe, a froe, and a drawknife hanging together on the cabin's back interior wall" },
    { name: "split shingle", look: "a thin pale wood board, one end shaved thinner by a drawknife, tapered edge" },
  ];

  beforeEach(() => mockInvoke.mockReset());

  it("414 scene 4: the words that only begin the next sentence are found, with about how long they are said", () => {
    expect(leadIntoNext(LINE_4, 9.9482)).toEqual({ words: "But on the back wall hung", sec: 2.1 });
    expect(leadIntoNext(LINE_4)).toEqual({ words: "But on the back wall hung" });
  });

  it("a whole clause, a line of one sentence, a lone word or a long tail is no lead-in", () => {
    // A line that ends its sentence.
    expect(
      leadIntoNext("The roof was split oak, the walls were hewn poplar, and the door hung on wooden pins with a string for a lock.")
    ).toBeUndefined();
    // Job 409 scene 3: mostly that second sentence, and a whole clause — its panel of the cards is right.
    expect(
      leadIntoNext("His father made it to eighty-one. And somewhere between the sympathy cards and the cards for new grandbabies,")
    ).toBeUndefined();
    // Job 153 scene 452: a whole clause that is the line's point.
    expect(leadIntoNext("The Japanese look people paid me for wasn't the precision work. It was the fire,")).toBeUndefined();
    // Job 410 scene 10: one sentence, cut mid-clause, with nothing before it.
    expect(
      leadIntoNext("Today you're getting fourteen things flight attendants will quietly hand over for free, depending on")
    ).toBeUndefined();
    // Job 335 scene 15: one word names nothing.
    expect(leadIntoNext("Earlier in a way that decides whether anybody wakes up on their own. So")).toBeUndefined();
    // More than a third of the line.
    expect(
      leadIntoNext("I won't pretend. What I made was a plain wool blanket that kept a whole family warm all winter and")
    ).toBeUndefined();
  });

  it("the panel check is told the lead-in; a line that ends its sentence is sent as before", async () => {
    const scenes = [
      panel(4, LINE_4, WALL_4, { audioDuration: 9.9482 }),
      panel(22, LINE_22, SHINGLE_22, { audioDuration: 6.6774, keyThing: "split shingle" }),
    ];
    mockInvoke.mockResolvedValueOnce({ text: JSON.stringify({ pictures: [] }) });
    await fitSplitPanelsToLines(scenes, { keyThings: CABIN_THINGS });
    const sent: string = mockInvoke.mock.calls[0][0].userMessage;
    expect(sent).toContain(
      `#0 PANEL (9.9 s) (ends on "But on the back wall hung", about 2.1 s): said "${LINE_4}" | shows: ${WALL_4}`
    );
    expect(sent).toContain(`#1 PANEL (6.7 s): said "${LINE_22}" | shows: ${SHINGLE_22}`);
  });

  it("414 scene 22: the check's rewrite of the result alone gets the drawknife, lying flat on the work", async () => {
    const scenes = [
      panel(22, LINE_22, "a pale board on a stump, one end tapered, a drawknife beside it", { audioDuration: 6.6774 }),
    ];
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: [{ id: 0, about: "shaving shingles thin", shows_it: false, show: SHINGLE_22, thing: "split shingle", stage: "done" }],
      }),
    });
    const r = await fitSplitPanelsToLines(scenes, { keyThings: CABIN_THINGS });
    expect(r).toEqual({ checked: 1, fixed: 1 });
    const want = `${SHINGLE_22}, a drawknife lying flat on the work, unattended.`;
    expect(scenes[0].splitVisual).toBe(want);
    // A later redraw rewrites from the same words.
    expect(scenes[0].splitVisualSeed).toBe(want);
    // The tool is no key thing of the panel: it is drawn from the shingle's pictures.
    expect(scenes[0].keyThing).toBe("split shingle");
    expect(scenes[0].otherKeyThings).toBeUndefined();
  });

  it("the tool a line says its job is done with — never a ruled-out tool or a word naming something else", () => {
    expect(lineTool(LINE_22)).toBe("drawknife");
    expect(
      lineTool("For the handholds, I drilled a hole at each end of a slot in those end pieces and cut out between the holes with a jigsaw.")
    ).toBe("jigsaw");
    expect(
      lineTool("sawed the notches through all of them at once with a cheap pull saw, and cleaned each notch out with a little chisel,")
    ).toBe("cheap pull saw");
    expect(lineTool("where you can get at it with your scissors.")).toBe("scissors");
    expect(lineTool("Trim it with a pair of shears and you are done.")).toBe("pair of shears");
    // Ruled out by its own clause, or by what the sentence forbids.
    expect(lineTool("You don't need to shave it with a drawknife, a sharp knife works.")).toBeUndefined();
    expect(lineTool(LINE_22, "a drawknife on the shingle")).toBeUndefined();
    // The tool word is not the end of the noun, or names no tool at all.
    expect(lineTool("Start the hole with a drill bit sized to the screw.")).toBeUndefined();
    expect(lineTool("Two passengers settled in with a plane seat each.")).toBeUndefined();
    expect(lineTool("Face it with a level head and it goes fine.")).toBeUndefined();
    expect(lineTool("They went up rough as shakes, or got shaved thin at one end to make shingles.")).toBeUndefined();
  });

  it("a panel that names the tool, one about another sentence, or one on the host's body is left alone", () => {
    // A panel that has the drawknife, however it is spelt.
    const KEPT = "a pale board on a stump, one end tapered, a drawknife lying across it";
    expect(withLineTool(KEPT, LINE_22)).toBe(KEPT);
    expect(withLineTool("a pale board, one end tapered, a draw knife lying across it", LINE_22)).toBe(
      "a pale board, one end tapered, a draw knife lying across it"
    );
    // The same kind of tool written another way: a hand saw for a handsaw, a paintbrush for a paint brush.
    const SAWN = "a pine board with a slot, a hand saw lying beside it";
    expect(withLineTool(SAWN, "Cut the slot with a handsaw.")).toBe(SAWN);
    const TRIM = "freshly painted white window trim, a paintbrush resting on the open can";
    expect(withLineTool(TRIM, "Paint the trim with a paint brush.")).toBe(TRIM);
    // Jobs 118 and 122: the chisel is the first sentence's, the panel is the second's cleat.
    const CLEAT =
      "Wooden shelf back edge showing a slim wooden cleat fastened with screws, clamped horizontally on a workbench under even indoor daylight.";
    const LINE_CLEAT =
      "knock the chunks out, and pare it flat with the chisel, same rule as before, board clamped down and both hands behind the edge. When you hang it, screw a hidden cleat on the back into a wall stud,";
    expect(withLineTool(CLEAT, LINE_CLEAT)).toBe(CLEAT);
    // A panel drawn on the host's own hair stays on the host.
    const HAIR = "freshly trimmed silver hair ends, a close view";
    expect(withLineTool(HAIR, "Trim the ends with a pair of scissors every eight weeks.")).toBe(HAIR);
    // Never twice.
    const once = withLineTool(SHINGLE_22, LINE_22);
    expect(once).toBe(`${SHINGLE_22}, a drawknife lying flat on the work, unattended.`);
    expect(withLineTool(once, LINE_22)).toBe(once);
    // A tool said only in the plural is drawn as a pair.
    expect(
      withLineTool("Finished rag quilt squares laid flat, their exposed seams standing proud", "where you can get at it with your scissors.")
    ).toBe("Finished rag quilt squares laid flat, their exposed seams standing proud, a pair of scissors lying flat on the work, unattended.");
  });

  it("a tool word that only names its marks puts no tool in the picture (job 407 scene 19, the same line)", () => {
    // Job 407's panel asked for "drawknife strokes", and the film hung the drawknife on the wall
    // behind a bare board: the strokes are not the tool.
    const STROKES =
      "A pale oak board held flat on a work surface, one end shaved thin by drawknife strokes, wood curls resting on the board and ground nearby.";
    expect(withLineTool(STROKES, LINE_22)).toBe(
      "A pale oak board held flat on a work surface, one end shaved thin by drawknife strokes, wood curls resting on the board and ground nearby, a drawknife lying flat on the work, unattended."
    );
    expect(withLineTool("a pine board with a slot, fresh saw marks along its edge", "Cut the slot with a handsaw.")).toBe(
      "a pine board with a slot, fresh saw marks along its edge, a handsaw lying flat on the work, unattended."
    );
    // A sawhorse is no saw.
    expect(withLineTool("a pine board cut in two on sawhorses", "Cut the board with a saw.")).toBe(
      "a pine board cut in two on sawhorses, a saw lying flat on the work, unattended."
    );
  });

  it("a tool said in the plural or as a sheet reads as English; a tool said as a figure of speech is none", () => {
    expect(withLineTool("a pine box with clean corners", "Pare the corners with the chisels, then oil it.")).toBe(
      "a pine box with clean corners, chisels lying flat on the work, unattended."
    );
    expect(withLineTool("a pine box with softened edges", "Smooth the edges with some sandpaper.")).toBe(
      "a pine box with softened edges, a sheet of sandpaper lying flat on the work, unattended."
    );
    for (const idiom of [
      "Some buyers come with an axe to grind, and they will leave a bad review.",
      "Go over every listing with a fine-tooth comb.",
      "He painted the whole market with a broad brush.",
      "They tar every seller with the same brush.",
    ]) {
      expect(lineTool(idiom), idiom).toBeUndefined();
      expect(withLineTool("a booth at a weekend market", idiom), idiom).toBe("a booth at a weekend market");
    }
  });

  it("a place name's full stop is no sentence end", () => {
    expect(leadIntoNext("We drove all the way across three counties to St. Louis to buy")).toBeUndefined();
    expect(leadIntoNext("The whole lot came from the old hardware store run by Mr. Jenkins down the road")).toBeUndefined();
    // A real sentence end is still found.
    expect(leadIntoNext("We drove all the way across three counties to the market. And there it")).toEqual({ words: "And there it" });
  });

  it("keepPanelTools changes only the panels asked for, never a CTA panel", () => {
    const a = panel(1, LINE_22, SHINGLE_22);
    const b = panel(2, LINE_22, SHINGLE_22);
    const cta = { ...panel(3, LINE_22, SHINGLE_22), cta: true } as StoryboardScene;
    expect(keepPanelTools([a, b, cta], s => s !== b)).toBe(1);
    expect(a.splitVisual).toMatch(/a drawknife lying flat on the work, unattended\.$/);
    expect(b.splitVisual).toBe(SHINGLE_22);
    expect(cta.splitVisual).toBe(SHINGLE_22);
  });

  it("the panel rules weigh the whole line and keep the named tool, in neutral words", () => {
    expect(PANEL_FIT_RULES).toMatch(/A TOOL the line says the job is done with/);
    expect(PANEL_FIT_RULES).toMatch(/A panel of the result alone, the named tool left out, is WRONG/);
    expect(PANEL_FIT_RULES).toMatch(/shows what MOST of the line is about, by how\s+long each part is said/);
    expect(PANEL_FIT_RULES).toMatch(/A PANEL marked \(ends on "…"\)/);
    expect(PANEL_FIT_RULES).not.toMatch(CHANNEL_OBJECTS);
    expect(PANEL_FIT_RULES).not.toMatch(/\b(?:shingles?|drawknife|cabin|roof|oak|poplar|back wall|froe)\b/i);
  });

  // Job 418 scene 25 (round 15): the panel beside "When you rive, the bolt sits in a fork or against a
  // stump, never in your hand" read "Oak bolt wedged upright in a stump fork, froe blade set into its top
  // end with the handle angled, resting unattended on the work" — a tool in its working pose with no hand
  // on it, and the line's two holders run into one — and this pass let it through. The picture maker
  // hung the froe on a bare wire hook and bored a hole in the stump for the bolt.
  it("418 scene 25: the panel pass refuses a tool left in its working pose with nobody holding it, and two holders run into one", async () => {
    expect(PANEL_FIT_RULES).toMatch(/put down the way a person leaves it — lying flat on the work, unattended/);
    expect(PANEL_FIT_RULES).toMatch(/A TOOL IN A PANEL HAS NOBODY HOLDING IT, so it lies flat on the work, a bench or the ground/);
    expect(PANEL_FIT_RULES).toMatch(/stays standing in the work only where a real one stays by itself/);
    expect(PANEL_FIT_RULES).toMatch(/A panel that leaves a tool in its\s+working pose with no hand on it/);
    expect(PANEL_FIT_RULES).toMatch(/hanging from something the line never hangs it on, is WRONG:\s+rewrite it with the tool put down/);
    expect(PANEL_FIT_RULES).toMatch(/A HOLDER the line says the work sits in, on or against while it is done/);
    expect(PANEL_FIT_RULES).toMatch(/written by its parts — what it is\s+made of and how it holds the work/);
    expect(PANEL_FIT_RULES).toMatch(/When the line offers two, the panel shows\s+the first one alone/);
    expect(PANEL_FIT_RULES).toMatch(/runs the two into one thing/);
    // Neutral words only.
    expect(PANEL_FIT_RULES).not.toMatch(/\b(?:froe|fork|stump|bolt|riv(?:e|ing)|club|hook)\b/i);
    expect(PANEL_FIT_RULES).not.toMatch(CHANNEL_OBJECTS);
    // The pass's rewrite is what the panel becomes. The line names no tool its job is done WITH, so
    // nothing is added to it (`withLineTool`).
    const LINE_25 = "When you rive, the bolt sits in a fork or against a stump, never in your hand.";
    const PANEL_25 =
      "Oak bolt wedged upright in a stump fork, froe blade set into its top end with the handle angled, resting unattended on the work.";
    const FIXED_25 = "An oak bolt standing on end, wedged between the two arms of a forked log, a froe lying flat on the log beside it";
    const scenes = [panel(25, LINE_25, PANEL_25, { audioDuration: 7.03 })];
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: [{ id: 0, about: "holding the bolt in a fork while riving", shows_it: false, show: FIXED_25, thing: "froe" }],
      }),
    });
    const r = await fitSplitPanelsToLines(scenes, { keyThings: [{ name: "froe", look: "an L-shaped splitting blade" }] });
    expect(r).toEqual({ checked: 1, fixed: 1 });
    expect(scenes[0].splitVisual).toBe(FIXED_25);
    expect(withLineTool(PANEL_25, LINE_25)).toBe(PANEL_25);
    const sent = mockInvoke.mock.calls.at(-1)![0];
    expect(sent.systemSuffix).toBe(PANEL_FIT_RULES);
    expect(sent.userMessage).toContain(`#0 PANEL (7.0 s): said "${LINE_25}" | shows: ${PANEL_25}`);
  });
});
