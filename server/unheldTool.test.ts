/**
 * A TOOL NOBODY HOLDS IS PUT DOWN; A PANEL SHOWS THE HOLDER ITS LINE NAMES (round 15, 2026-10-20, the
 * targeted check of job 418, Sawdust Sam's practice film on the round-14 code). Scene 25's split panel,
 * beside "When you rive, the bolt sits in a fork or against a stump, never in your hand", was written
 * "Oak bolt wedged upright in a stump fork, froe blade set into its top end with the handle angled,
 * resting unattended on the work" — a lever tool in its working pose with the hand taken out, which no
 * tool keeps by itself — and `NO_FIGURES_SUFFIX` offered the picture maker one way to keep it there,
 * "rests on a surface or hangs from a hook". All three draws came back with the froe on a bare wire hook,
 * its handle out over nothing, the bolt sunk in a hole bored in the stump top; the check refused each as
 * broken and the last one shipped.
 *
 * The rules are general and the lines are the real rows: the panel writer and the panel pass are told a
 * tool nobody holds is put down and the holder the line names is drawn as one real thing; every picture
 * with nobody in it whose words name a tool carries `UNHELD_TOOL_CLAUSE`; the check names a tool hung or
 * propped with no hand on it, and that first broken draw is redrawn told how it is put down. Clean cases
 * — a tool hung on a wall the description hangs it on, someone at work, a picture with no tool, marks a
 * tool left, a slice of food, an aircraft — are held beside them.
 */
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  buildSplitRightScene,
  buildStillPrompt,
  CONNECTING_LINES_CLAUSE,
  connectingLinesClause,
  faultRedrawFor,
  NAMED_FAULT_START,
  namedFaultClause,
  namedFaultRedraw,
  NO_FIGURES_SUFFIX,
  SPLIT_STRIKE_CLAUSE,
  TOOL_AT_WORK_FIX,
  UNHELD_TOOL_CLAUSE,
  unheldToolClause,
} from "./longformVideo";
import { STILL_DEFECT_SYSTEM } from "./overlayTextScan";

const HOST =
  "the channel's host, exactly as in their host photo, seated in a chair talking directly to the camera, hands resting quietly in their lap";
const LINE_25 = "When you rive, the bolt sits in a fork or against a stump, never in your hand.";
const PANEL_25 =
  "Oak bolt wedged upright in a stump fork, froe blade set into its top end with the handle angled, resting unattended on the work.";
const NEED_25 =
  "An oak bolt wedged upright in the fork of a stump, a froe blade set into its top end and a hand on the right-angle handle";
/** Job 418 scene 25 as stored: a host beat with its person-free panel. */
const panel25 = () =>
  ({
    index: 25,
    hostPresent: true,
    narration: "When you rive, the bolt sits in a",
    scriptText: LINE_25,
    visualPrompt: HOST,
    showSubject: NEED_25,
    splitVisual: PANEL_25,
    forbids: "a hand holding the oak bolt while riving",
  }) as StoryboardScene;
const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const first = { broken: 0, writing: 0 };
const once = { broken: 1, writing: 0 };
type R = "at rest" | "soft print" | "named fault";
const none = new Set<R>();

describe("job 418 scene 25: a tool nobody holds is put down", () => {
  it("the panel as stored is drawn told how a tool nobody holds is put down, and is never offered a hook", () => {
    const prompt = buildStillPrompt(buildSplitRightScene(panel25()), false, undefined, undefined, true);
    expect(prompt).toContain(PANEL_25);
    expect(prompt.split(UNHELD_TOOL_CLAUSE)).toHaveLength(2);
    expect(prompt).toContain(NO_FIGURES_SUFFIX);
    expect(prompt).not.toMatch(/hangs? from a hook/);
    // The content-policy rung keeps its short prompt.
    expect(buildStillPrompt(buildSplitRightScene(panel25()), true, undefined, undefined, true)).not.toContain(
      UNHELD_TOOL_CLAUSE
    );
  });

  it("the clause says where a put-down tool goes, and names no tool the picture maker could add", () => {
    expect(UNHELD_TOOL_CLAUSE).toMatch(/^Nobody holds anything in this picture, so every tool in it is put down the way a person leaves one/);
    expect(UNHELD_TOOL_CLAUSE).toMatch(/lying on a surface — flat on the work, a bench, a table or the ground beside the work/);
    expect(UNHELD_TOOL_CLAUSE).toMatch(/resting in its own box, rack, jar or holder or across the rim of its own pot/);
    expect(UNHELD_TOOL_CLAUSE).toMatch(/standing in the work only where a real one stays there by itself, driven in or standing in its own cut/);
    // A tool the description hangs on a wall still hangs there (job 418's own back wall, scenes 7-9).
    expect(UNHELD_TOOL_CLAUSE).toMatch(/It hangs only where the description hangs it, from something fixed to a wall, beam or rack/);
    expect(UNHELD_TOOL_CLAUSE).toMatch(/never in mid-air or from something attached to nothing/);
    expect(UNHELD_TOOL_CLAUSE).toMatch(/never left standing, balanced or leaning in its working pose at an angle only a hand could hold/);
    expect(UNHELD_TOOL_CLAUSE).not.toMatch(
      /\b(?:froe|fork|stump|bolt|axe|wedge|saw|spade|hook|wire|chisel|knife|drill|scissors|needle|hammer)\b/i
    );
  });

  it("NO_FIGURES_SUFFIX no longer offers a hook to keep a tool up", () => {
    expect(NO_FIGURES_SUFFIX).not.toMatch(/hangs from a hook/);
    expect(NO_FIGURES_SUFFIX).toMatch(
      /a tool or object with no hand on it rests on a surface or in its own holder, or hangs where the description hangs it/
    );
    expect(NO_FIGURES_SUFFIX).toMatch(/never hovering in the air, hanging from nothing, propped at an angle only a hand could hold/);
    // Clothing still hangs on a hanger or a hook.
    expect(NO_FIGURES_SUFFIX).toMatch(/Clothing, shoes and jewellery with nobody in them hang/);
  });
});

describe("unheldToolClause — every picture with nobody in it whose words name a tool, and only those", () => {
  it("a person-free panel or picture of a tool gets it — the stored panels that posed one mid-use among them", () => {
    for (const words of [
      PANEL_25,
      // Job 418 scene 23 (right): the drawknife put down across the board it shaved.
      "Thin oak board laid on a work surface, one end tapered to a point with fine shavings curled away, a two-handled drawknife resting across it.",
      // Job 418 scene 8: hung on the wall the description hangs it on — the clause keeps it there.
      "A froe hanging on a dark log wall: straight flat dark steel blade with a wooden handle sticking out at a right angle from one end, L-shaped",
      // Panels of other channels that left a tool mid-use with nobody holding it (jobs 356, 162, 153).
      "A charred cedar scrap block on a garage workbench, a drill bit angled into its surface, ready to bore through.",
      "A Japanese pull saw mid-stroke through pine, the blade angled downward, kerf line visible and sharp against pale wood.",
      "A wooden board with half-lap joint marked in pencil, a pull saw's blade mid-stroke along the line, oak shavings curling on the work surface",
      // Any channel: kitchen, garden, sewing.
      "a wooden spoon and a whisk across the rim of a mixing bowl on the counter",
      "a garden spade standing in freshly turned soil beside the raised bed",
      "feed sack fabric laid flat on a sewing table with scissors resting across the cloth",
    ])
      expect(unheldToolClause({}, words), words).toBe(` ${UNHELD_TOOL_CLAUSE}`);
  });

  it("clean: someone at work, no tool, marks a tool left, what is made with one, a slice of food, an aircraft", () => {
    // Job 418 scene 18: hands at the froe — the tool is in the hands (`TOOL_CONTACT_CLAUSE`).
    const hands =
      "Hands striking the back of an L-shaped froe blade, set across the end of a white oak bolt, with a wooden club, the split opening straight down the grain";
    expect(unheldToolClause({ humanPresent: true }, hands)).toBe("");
    expect(buildStillPrompt(pic(18, "Number one is the roof, split by hand…", hands, { humanPresent: true }))).not.toContain(
      UNHELD_TOOL_CLAUSE
    );
    for (const words of [
      // Job 418 scenes 22, 24 and 29: no tool in them, only the marks of one.
      "A pale rived oak board lying flat, straight grain running its full length, split surface without saw marks",
      "an old log cabin roof of long rived oak boards held down by heavy poles laid across each course",
      "Hewn poplar log wall, flat axe-marked faces, small cracks running along the grain as green wood dries.",
      "A pale oak board, one end shaved thin by drawknife strokes",
      "a pine board cut in two on sawhorses, fresh sawdust on the floor",
      "hewn logs showing old tool marks",
      // Words that name no tool at all.
      "lemon wedges fanned on a white plate",
      "a carpet of pine needles under the trees",
      "a plane window view of farmland far below",
      "",
    ])
      expect(unheldToolClause({}, words), words).toBe("");
    // Nor in the prompt of such a picture.
    expect(buildStillPrompt(pic(22, "so every board runs from bark toward heart", "A pale rived oak board lying flat"))).not.toContain(
      UNHELD_TOOL_CLAUSE
    );
  });
});

describe("the check names a tool hung or propped with no hand on it, and the redraw is told how it is put down", () => {
  it("the broken question names it, and keeps a tool on its wall, in its holder or left where it stays", () => {
    const q2 = STILL_DEFECT_SYSTEM.slice(STILL_DEFECT_SYSTEM.indexOf("QUESTION 2"), STILL_DEFECT_SYSTEM.indexOf("QUESTION 3"));
    expect(q2).toMatch(/a tool with NO hand on it that hangs in mid-air or from a hook, wire or string fixed to\s+nothing/);
    expect(q2).toMatch(/stands, balances or leans in its working pose at an angle it could not keep by\s+itself/);
    expect(q2).toMatch(/a handle sticking up or out over nothing from a blade that is not deep in the work/);
    expect(q2).toMatch(/hanging on a wall,\s+peg or rack, or left standing in the work where a real one stays by itself/);
    expect(q2).toMatch(/When unsure, answer false/);
    // Its words carry the fault to the redraw.
    expect(STILL_DEFECT_SYSTEM).toMatch(/"chisel hanging from a hook fixed to\s+nothing"/);
  });

  it("job 418 scene 25's fault, in a picture with nobody in it, takes the named-fault reroll told how a tool is put down", () => {
    const words = `${PANEL_25} ${PANEL_25}`;
    for (const what of [
      "froe hanging from a wire hook above the bolt",
      "froe balanced on top of the bolt, handle sticking out over nothing",
      "froe suspended in mid-air on a bare hook",
      "tool floating above the stump",
      "saw standing upright on its teeth with no hand",
    ]) {
      const clause = namedFaultClause(what, words, false);
      expect(clause, what).toBe(`${NAMED_FAULT_START} ${what}. This time draw it the way it really is. ${UNHELD_TOOL_CLAUSE}`);
      // The "wire" it hangs from connects nothing: never the rule for lines.
      expect(clause, what).not.toContain(CONNECTING_LINES_CLAUSE);
      expect(faultRedrawFor({}, { broken: true, what }, first, none, true, false), what).toBe("named fault");
    }
    const prompt = buildStillPrompt(buildSplitRightScene(panel25()), false, undefined, undefined, true);
    const redraw = namedFaultRedraw(prompt, "froe hanging from a wire hook above the bolt", words, false);
    expect(redraw.startsWith(`${prompt} ${NAMED_FAULT_START}`)).toBe(true);
    expect(redraw.endsWith(UNHELD_TOOL_CLAUSE)).toBe(true);
    // The second broken draw still gets the at-rest draw, once.
    const hook = { broken: true, what: "froe hanging from a wire hook above the bolt" };
    expect(faultRedrawFor({}, hook, once, new Set<R>(["named fault"]), true, false)).toBe("at rest");
    expect(faultRedrawFor({}, hook, first, new Set<R>(["named fault"]), true, false)).toBeUndefined();
  });

  it("clean: someone at work keeps the tool's own rule; a tool lying put down, a line, or no tool keep theirs", () => {
    // Someone at work: the tool's own kind (job 414 scene 17), never "put it down".
    const atWork = namedFaultClause("froe hanging in the air above the bolt", "hands splitting a bolt with a froe", true);
    expect(atWork).toContain(SPLIT_STRIKE_CLAUSE);
    expect(atWork).not.toContain(UNHELD_TOOL_CLAUSE);
    expect(namedFaultClause("chisel hanging from a hook fixed to nothing", "hands chopping a mortise", true)).toContain(
      TOOL_AT_WORK_FIX
    );
    // With nobody at it, a tool lying on the work is how a tool is left: its plain reroll, as before.
    expect(namedFaultClause("froe blade lying flat on top of the bolt, no club", PANEL_25, false)).toBeUndefined();
    expect(faultRedrawFor({}, { broken: true, what: "froe blade lying flat on top of the bolt, no club" }, first, none, true, false)).toBeUndefined();
    // A line with no tool keeps the rule for lines; no tool, a slice of food or a finger too many, none.
    expect(namedFaultClause("power cord running into the tap", "a kettle on the counter", false)).toContain(CONNECTING_LINES_CLAUSE);
    for (const what of ["cutting board floating above the table", "lemon wedges floating above the plate", "six fingers on the hanging saw"])
      expect(namedFaultClause(what, "", false), what).toBeUndefined();
  });

  it("a wire hook connects nothing: never told the rule for lines, in a fault or a picture's words", () => {
    // With hands at the froe the fault takes the froe's own rule, no longer the rule for lines.
    const atWork = namedFaultClause("froe hanging from a wire hook above the bolt", "hands splitting a bolt with a froe", true);
    expect(atWork).toContain(SPLIT_STRIKE_CLAUSE);
    expect(atWork).not.toContain(CONNECTING_LINES_CLAUSE);
    expect(connectingLinesClause("a coat hung on a wire hook by the door")).toBe("");
    // A lead is still a lead (job 413 scene 29), and a hook beside one does not hide it.
    expect(connectingLinesClause("the spark plug wire runs to the plug")).toBe(` ${CONNECTING_LINES_CLAUSE}`);
    expect(connectingLinesClause("a lamp cord plugged into the wall below a wire hook")).toBe(` ${CONNECTING_LINES_CLAUSE}`);
  });
});
