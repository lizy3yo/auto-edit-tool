/**
 * THE STILL CHECK SEES WHICH WAY A SEAT FACES (round 16, 2026-10-20, the targeted check of job 421,
 * Helena Hart's practice film on the round-15 code). Round 15's pose line in the check's broken question
 * asks about the BODY, and faults about the FURNITURE passed it with no "broken":
 * - scene 2 ("one of them was sitting in an empty row closer to the front"): the empty row drawn
 *   front-on, cushions and seatbelts toward the camera, beside a woman whose own seat faced away — two
 *   rows knee to knee, job 417 scene 8's fault again — flagged only missing and detail;
 * - job 399 scene 2: a woman's torso drawn in front of the seat back it sat against;
 * - scene 29 ("and phrase it as an offer.") was read as the passenger's seat turned about 90° to face
 *   the gap between the rows, her thighs at the camera. A second look found it RIGHT: her seat faces
 *   forward, the camera behind and beside it saw the padded side of its seat back (taken for a
 *   cushion), her seat back's headrest crossed her hair, and she turned at the waist — the framing and
 *   pose the redraws ask for. So the line also says how to tell: what hides what.
 * The check now has a line of its own for fixed seats facing a way such seats never face, judged by
 * whether the seats around agree (a booth, a table's chairs, a train's facing pairs and a room's walls
 * of chairs are BUILT to face each other and are right), and starts such a fault "seat turned:". The
 * first broken draw's own reroll is told how fixed seats face (`SEAT_FACING_FIX`, in any picture) and,
 * with someone in it, how they sit in their seat (`SEATED_PERSON_FIX`) — no draw added.
 *
 * The rules are general and the rows are the real ones; the clean cases beside them are a booth, a
 * train's facing seats and a waiting room's chairs along its walls.
 */
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  buildStillPrompt,
  faultRedrawFor,
  NAMED_FAULT_START,
  namedFaultClause,
  namedFaultRedraw,
  NATURAL_POSE_FIX,
  SEAT_FACING_FIX,
  SEATED_PERSON_FIX,
} from "./longformVideo";
import { parseStillDefectVerdict, STILL_DEFECT_SYSTEM } from "./overlayTextScan";

type R = "at rest" | "soft print" | "named fault";
const none = new Set<R>();
const first = { broken: 0, writing: 0 };
const q2 = () => STILL_DEFECT_SYSTEM.slice(STILL_DEFECT_SYSTEM.indexOf("QUESTION 2"), STILL_DEFECT_SYSTEM.indexOf("QUESTION 3"));
const seatLine = () => q2().slice(q2().indexOf("- fixed seats facing"), q2().indexOf("- a mirror"));
const wordsOf = (s: StoryboardScene) => `${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`;

/** Job 421 scene 2 as stored (5.80-11.95). */
const row421 = () =>
  ({
    index: 2,
    scriptText:
      "By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding",
    showSubject:
      "a woman passenger sitting alone in a set of three blue upholstered airline seats near the front of the cabin, tray tables stowed, the beverage cart passing in the aisle beside her",
    visualPrompt:
      "Empty row of three blue upholstered airline seats near the front of the cabin, tray tables stowed, a metal service cart with small wheels visible in the aisle beside the row.",
    keyThing: "empty row",
    humanPresent: true,
    otherPerson: "a woman passenger",
    stillImage: true,
  }) as StoryboardScene;
/** Job 421 scene 29 as stored (147.12-149.28). */
const offer421 = () =>
  ({
    index: 29,
    scriptText: "and phrase it as an offer.",
    showSubject: "a flight attendant holding out the snack basket to a passenger seen from the side",
    visualPrompt: "A flight attendant in an aircraft cabin holding out the woven snack basket to a seated passenger.",
    keyThing: "snack basket",
    listCut: true,
    humanPresent: true,
    otherPerson: "a flight attendant and a passenger",
    otherPeople: 2,
    stillImage: true,
  }) as StoryboardScene;
/** Job 399 scene 2's description (the woman's torso drawn through her seat back). */
const pair399 = () =>
  ({
    index: 2,
    scriptText: "Two passengers boarded the same flight.",
    showSubject: "two passengers seated side by side in a seat row",
    visualPrompt:
      "Two passengers seated side by side in blue fabric airplane seats in the cabin, row fourteen visible, aisle-side positions, both looking forward, aircraft cabin behind them.",
    humanPresent: true,
    otherPerson: "two passengers",
    otherPeople: 2,
    stillImage: true,
  }) as StoryboardScene;
/** The clean cases: seats BUILT to face each other, and chairs round a room. */
const CLEAN = [
  {
    index: 5,
    scriptText: "They met for coffee every Thursday.",
    showSubject: "two friends talking across a diner booth table, seen over one shoulder",
    visualPrompt: "Two friends sitting facing each other across a diner booth table with coffee cups, seen over one shoulder.",
    humanPresent: true,
    otherPerson: "two friends",
    otherPeople: 2,
    stillImage: true,
  },
  {
    index: 6,
    scriptText: "The whole ride north, they talked about the farm.",
    showSubject: "two travellers in a train's pair of facing seats, a small table between them",
    visualPrompt: "Two travellers sitting in a train's pair of facing seats with a small table between them, fields passing the window.",
    humanPresent: true,
    otherPerson: "two travellers",
    otherPeople: 2,
    stillImage: true,
  },
  {
    index: 7,
    scriptText: "The waiting room was full by nine.",
    showSubject: "a waiting room's chairs along the walls facing the middle of the room, a woman seated with her bag on her lap",
    visualPrompt:
      "A small waiting room with chairs along the walls facing the middle of the room, a woman seated with her bag on her lap, seen from the side.",
    humanPresent: true,
    otherPerson: "a woman",
    stillImage: true,
  },
] as StoryboardScene[];

describe("round 16: the still check sees which way a seat faces (job 421 scenes 2 and 29)", () => {
  it("the check has a line for fixed seats facing a way such seats never face, judged by the seats around", () => {
    const line = seatLine();
    expect(line).toMatch(/^- fixed seats facing a way such seats never face/);
    // How it is seen: which side of each seat the camera sees, against the seats around it.
    expect(line).toMatch(/see which side of each seat the camera sees — its back, or its cushion and the front of its seat back/);
    expect(line).toMatch(/one seat or one row facing another way from the rows beside, ahead of and behind it is turned/);
    // The faults: a seat turned to the gap (what 421 #29 was first read as), 421 #2 and 417 #8, 417 #2,
    // 399 #2.
    expect(line).toMatch(/a seat turned sideways or round while its row faces forward; a row showing/);
    // 421 #29, looked at again: "her thighs at the camera" was how a RIGHT picture was misread — a seat
    // facing forward seen from behind and beside, the padded side of its seat back taken for a cushion,
    // her turned at the waist. So the line no longer offers the knees as the sign, and says how to tell:
    // what hides what, and a person turned at the waist in a seat facing its row's way is right.
    expect(line).not.toMatch(/knees toward the camera/);
    expect(line).toMatch(
      /Tell which way a seat faces by what hides what: a seat back that hides part of the person in it \(its headrest across their hair, its side in front of their shoulder\) is behind them, so that seat faces away from the camera/
    );
    expect(line).toMatch(/the padded side of a seat back seen at an angle is no cushion/);
    expect(line).toMatch(/someone in it who turns their head and shoulders or leans toward the gap beside their seat is right/);
    expect(line).toMatch(/a row showing its cushions beside or ahead of seats that show their backs, so two rows face each other knee to knee/);
    expect(line).toMatch(/a person facing their own seat back/);
    expect(line).toMatch(/a body, arm or leg passing through its seat, seat back or armrest/);
    // Seats built to face each other agree with what is around them (round 15's reviewer), and so do
    // rows that all face the camera and a loose chair the room turns.
    expect(line).toMatch(
      /Seats BUILT to face each other agree with what is around them and are right: a booth, chairs round a table, a train's pairs of facing seats, a bay of four, chairs along the walls of a room facing its middle/
    );
    expect(line).toMatch(/so are rows that all face the camera, and a loose chair or sofa turned any way the room puts it/);
    // "Mild strangeness" is how all three passed: each seat looks right on its own.
    expect(line).toMatch(/A seat turned against its rows is no mild strangeness: each seat looks right on its own, so judge them together/);
    // Round 15's pose line is kept as it was, and the leniency for everything else too.
    expect(q2()).toMatch(/- a person in a pose nobody takes for what they are doing/);
    expect(q2()).toMatch(/When unsure, answer false/);
  });

  it("the check's words say which: a seat fault starts \"seat turned:\", and the verdict carries it", () => {
    expect(STILL_DEFECT_SYSTEM).toMatch(
      /a seat or a row facing another way from the rows around it starts "seat turned:" and says which one and which way \(e\.g\. "seat turned: one seat sideways, its row forward", "seat turned: row ahead faces the row behind"\)/
    );
    // Round 15's pose form is still asked for.
    expect(STILL_DEFECT_SYSTEM).toMatch(/a person in a pose nobody takes starts "unnatural pose:" and says who and how/);
    const v = parseStillDefectVerdict(
      '{"overlay":false,"broken":true,"writing":false,"what":"seat turned: her seat sideways, its row forward"}'
    );
    expect(v).toMatchObject({ broken: true, what: "seat turned: her seat sideways, its row forward" });
  });

  // A seat turned to the gap while its rows face forward — what 421 #29 was first read as. When the
  // check names it, the reroll is told how seats face and how a person sits in one.
  it("a seat turned to the gap (421 #29 as first read) is redrawn told how fixed seats face and how she sits, in the reroll's own turn", () => {
    const words = wordsOf(offer421());
    for (const what of [
      "seat turned: her seat sideways, its row forward",
      "unnatural pose: passenger's seat turned sideways to face the aisle",
      "woman's seat rotated about 90 degrees toward the aisle",
      "seat faces the aisle while the rows face forward",
      "passenger sitting sideways, knees toward the camera",
      "her thighs pointing toward the aisle",
    ]) {
      const clause = namedFaultClause(what, words, true);
      expect(clause, what).toContain(SEAT_FACING_FIX);
      expect(clause, what).toContain(SEATED_PERSON_FIX);
      expect(faultRedrawFor(offer421(), { broken: true, what }, first, none, true, true), what).toBe("named fault");
    }
    const prompt = buildStillPrompt(offer421());
    // The first draw is as it was: the rule rides only the redraw of a picture the check refused.
    expect(prompt).not.toContain(SEAT_FACING_FIX);
    expect(prompt).not.toContain(SEATED_PERSON_FIX);
    const what = "seat turned: her seat sideways, its row forward";
    expect(namedFaultRedraw(prompt, what, words, true)).toBe(
      `${prompt} ${NAMED_FAULT_START} ${what}. This time draw it the way it really is. ${SEAT_FACING_FIX} ${SEATED_PERSON_FIX}`
    );
    // The scene's own failure: the passenger turned with her seat toward the one handing her something.
    expect(SEATED_PERSON_FIX).toMatch(/knees pointing the way the seat faces, and turns only the head and shoulders toward anyone/);
    expect(SEAT_FACING_FIX).toMatch(/none turned sideways and none turned round to face the row behind it/);
    expect(SEAT_FACING_FIX).toMatch(/Show a seat from another side by moving the CAMERA, never by turning the seat or the row/);
  });

  it("421 #2 and 417 #8: a row drawn front-on beside a person whose own seat faces away — in a picture with nobody in it too", () => {
    const words = wordsOf(row421());
    for (const what of [
      "seat turned: row ahead faces the row behind",
      "row ahead drawn front-on, facing her seat",
      "two rows of seats facing each other",
      "two rows knee to knee",
      "row ahead turned round to face the man behind", // 417-8
      "seats in the row ahead facing him", // 417-8
      "front row seats face the camera while others face away",
    ]) {
      expect(namedFaultClause(what, words, true), what).toContain(`${SEAT_FACING_FIX} ${SEATED_PERSON_FIX}`);
      // A row turned round is as wrong empty: told how fixed seats face, and nothing of a person.
      const empty = namedFaultClause(what, words, false);
      expect(empty, what).toContain(SEAT_FACING_FIX);
      expect(empty, what).not.toContain(SEATED_PERSON_FIX);
      expect(empty, what).not.toContain(NATURAL_POSE_FIX);
      expect(faultRedrawFor(row421(), { broken: true, what }, first, none, true, false), what).toBe("named fault");
    }
    // It names no person, so a picture drawn with nobody in it is never asked for one.
    expect(SEAT_FACING_FIX).not.toMatch(/\b(?:person|people|someone|man|woman|he|she|they|knees?)\b/i);
  });

  it("417 #2 and 399 #2: a person facing their own seat back or through it is told the pose, how seats face and how to sit", () => {
    const words = wordsOf(pair399());
    for (const what of [
      "unnatural pose: two people sitting backwards in their seats", // 417-2
      "two passengers sitting backwards, facing their seat backs", // 417-2
      "woman's torso passing through the seat back", // 399-2
      "unnatural pose: her torso through the seat back", // 399-2
      "seat back running through her chest", // 399-2
    ]) {
      const clause = namedFaultClause(what, words, true);
      expect(clause, what).toContain(`${NATURAL_POSE_FIX} ${SEAT_FACING_FIX} ${SEATED_PERSON_FIX}`);
      // A person against their seat with nobody drawn in the picture: no one to fix — its plain reroll.
      expect(namedFaultClause(what, words, false), what).toBeUndefined();
    }
    expect(SEATED_PERSON_FIX).toMatch(/sits on their own seat's cushion with its back behind them, never through it/);
  });

  it("clean: a booth, a train's facing seats and a waiting room's chairs are never told the seat rule", () => {
    for (const s of CLEAN) {
      const prompt = buildStillPrompt(s);
      expect(prompt, s.showSubject).not.toContain(SEAT_FACING_FIX);
      expect(prompt, s.showSubject).not.toContain(SEATED_PERSON_FIX);
      // The check is told such seats are right; a check that passes them redraws nothing.
      expect(faultRedrawFor(s, { broken: false, what: "" }, first, none, true, true)).toBeUndefined();
      // A fault in them about anything else keeps its own road: no seat rule.
      for (const what of [
        "cup floating above the booth table",
        "bag floating beside the chair",
        "table edge fails to line up across the frame",
        "chairs set round a table",
      ])
        expect(namedFaultClause(what, wordsOf(s), true) ?? "", what).not.toContain(SEAT_FACING_FIX);
    }
    // Two people in a booth talking side by side is round 15's pose fault, never a seat turned.
    const booth = namedFaultClause("two people in the booth talking side by side facing the wall", wordsOf(CLEAN[0]), true);
    expect(booth).toContain(NATURAL_POSE_FIX);
    expect(booth).not.toContain(SEAT_FACING_FIX);
    // A misread booth redrawn is kept a booth: seats built in facing pairs stay as built.
    expect(SEAT_FACING_FIX).toMatch(/seats built in facing pairs are left as built/);
    expect(seatLine()).toMatch(/a booth, chairs round a table, a train's pairs of facing seats/);
    expect(seatLine()).toMatch(/chairs along the walls of a room facing its middle/);
  });

  it("clean: a seat's own fault with no way to face in it, and the words of things that are no seats, keep their road", () => {
    for (const what of [
      "plane seat back merging into the window", // job 410 scene 2
      "second tray table folded up on seatback, unattached", // the render logs
      "man's tray table is the one in front of seat-back, cup on it", // the render logs
      "seat cushion warped like wax",
      "armrest detached from the seat",
      "chair arm merging into the seat",
      "seat belt facing the camera",
      "bench vise jaws turned sideways",
      "workbench turned sideways",
      "row of jars facing the wall",
      "crop rows running sideways",
      "head turned round toward the row behind",
      // Things lined up IN a row are no seats.
      "jars in a row facing the wall",
      "bottles lined up in a neat row facing the camera",
      // A bare "bench" is the workbench: a tool's fault on it is never told how rows of seats face.
      "chisel resting on the bench facing the wall",
      "plane on the bench turned the wrong way",
      "bench facing the wall",
      // Loose furniture the check is told may face any way the room puts it.
      "sofa facing the wall",
      "armchair turned toward the window",
      // 421 #29 as the second look found it: a seat facing its row's way, the person turned at the waist.
      "woman turned at the waist toward the aisle, her seat facing forward",
      "passenger leaning into the aisle",
    ]) {
      for (const atWork of [true, false]) {
        const clause = namedFaultClause(what, "", atWork) ?? "";
        expect(clause, what).not.toContain(SEAT_FACING_FIX);
        expect(clause, what).not.toContain(SEATED_PERSON_FIX);
      }
    }
    // …while a bench named as a seat, a pew and a row of seats still are seats.
    for (const what of [
      "pew turned round to face the others",
      "park bench turned round to face the wall",
      "in a row of seats facing each other",
      "woman in the row ahead facing her",
    ])
      expect(namedFaultClause(what, "", false), what).toContain(SEAT_FACING_FIX);
  });

  it("the redraw stays inside the old budget: the named fault once, then the at-rest draw", () => {
    const what = "seat turned: her seat sideways, its row forward";
    const fault = { broken: true, what };
    expect(faultRedrawFor(offer421(), fault, first, none, true, true)).toBe("named fault");
    // The named fault takes the plain reroll's own turn and is never asked twice.
    expect(faultRedrawFor(offer421(), fault, first, new Set<R>(["named fault"]), true, true)).toBeUndefined();
    // Broken a second time: the existing at-rest draw.
    expect(faultRedrawFor(offer421(), fault, { broken: 1, writing: 0 }, new Set<R>(["named fault"]), true, true)).toBe("at rest");
    // A content-policy rung's prompt is never rebuilt over, and the clause is never added twice.
    expect(faultRedrawFor(offer421(), fault, first, none, false, true)).toBeUndefined();
    const once = namedFaultRedraw("P.", what, wordsOf(offer421()), true);
    expect(namedFaultRedraw(once, "seat turned: row ahead faces the row behind", wordsOf(offer421()), true)).toBe(once);
  });

  it("the new rules name no channel's things, and the redraw's names no place or kind of seat", () => {
    for (const text of [seatLine(), SEAT_FACING_FIX, SEATED_PERSON_FIX])
      expect(text).not.toMatch(/plane|aircraft|airline|cabin|passenger|flight|galley|aisle|tray|toilet|froe|scroll|\bcat\b/i);
    // A thing a prompt names is a thing the picture maker draws.
    for (const text of [SEAT_FACING_FIX, SEATED_PERSON_FIX])
      expect(text).not.toMatch(/\b(?:bus|theatre|theater|classroom|bed|desk|bench|counter|table|sofa|car|train|booth|pew|church|hall)\b/i);
  });
});
