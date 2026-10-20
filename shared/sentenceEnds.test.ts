import { describe, expect, it } from "vitest";
import {
  abbreviationBreakAt,
  endsOnAbbreviation,
  isAbbreviationStop,
  rejoinAbbreviations,
  splitsInitials,
} from "./sentenceEnds";

/** Job 417's script, as written: "U. S." spelt with a space. */
const WHOLE_CAN =
  "Number one. The whole can. On a lot of U. S. airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.";

describe("isAbbreviationStop — a full stop that belongs to the word", () => {
  it("job 417: both letters of 'U. S.' are initials, never a sentence end", () => {
    expect(isAbbreviationStop("U.", "S.", "of")).toBe(true);
    expect(isAbbreviationStop("S.", "airlines,", "U.")).toBe(true);
    // Whatever follows the chain, the first letter is never an end.
    expect(isAbbreviationStop("U.", "S.")).toBe(true);
  });

  it("letters joined by full stops, titles, place names and lower-case short forms", () => {
    for (const w of ["U.S.", "U.K.", "e.g.", "i.e.", "a.m.", "p.m.", "Ph.D.", "D.C."])
      expect(isAbbreviationStop(w, "Then")).toBe(true);
    for (const w of ["Dr.", "Mr.", "Mrs.", "Ms.", "St.", "Mt.", "Jr.", "Co.", "Inc.", "Prof."])
      expect(isAbbreviationStop(w, "Louis")).toBe(true);
    for (const w of ["vs.", "etc.", "approx."]) expect(isAbbreviationStop(w, "and")).toBe(true);
    // A closing quote or bracket after the stop changes nothing.
    expect(isAbbreviationStop('U.S."', "Then")).toBe(true);
  });

  it("a lone initial in a name, and spaced lower-case initials", () => {
    expect(isAbbreviationStop("F.", "Kennedy", "John")).toBe(true);
    expect(isAbbreviationStop("J.", "Smith")).toBe(true);
    expect(isAbbreviationStop("a.", "m.", "6")).toBe(true);
    // Nothing known after a capital letter: never taken for an end.
    expect(isAbbreviationStop("U.", undefined, "of")).toBe(true);
  });

  it("only a letter is judged by a lower-case word after it, never a whole word", () => {
    expect(isAbbreviationStop("S.", "airlines,", "U.")).toBe(true);
    // Sentences written in lower case still end ("…we rake the dry leaves. the second sentence…").
    expect(isAbbreviationStop("leaves.", "the", "dry")).toBe(false);
    expect(isAbbreviationStop("One.", "two,")).toBe(false);
  });

  it("'No.' is short only before a number", () => {
    expect(isAbbreviationStop("No.", "5")).toBe(true);
    expect(isAbbreviationStop("No.", "#5")).toBe(true);
    expect(isAbbreviationStop("No.", "Will")).toBe(false);
    expect(isAbbreviationStop("No.")).toBe(false);
  });

  it("negative: real sentence ends stay ends, a capital-letter word among them", () => {
    expect(isAbbreviationStop("Boston.", "The")).toBe(false);
    expect(isAbbreviationStop("NASA.", "Then")).toBe(false);
    expect(isAbbreviationStop("FAA.", "It")).toBe(false);
    expect(isAbbreviationStop("can.", "On")).toBe(false);
    expect(isAbbreviationStop("I.", "Then", "did")).toBe(false);
    // A letter said as a letter (jobs 310 and 351: yarn that "crosses over itself in a small X. Snug, but…",
    // a valley "the bottom of the V. Every round…").
    expect(isAbbreviationStop("X.", "Snug,", "small")).toBe(false);
    expect(isAbbreviationStop("V.", "Every", "the")).toBe(false);
    // "rep." and "fig." said in lower case end sentences; "?", "!" and an ellipsis are never short.
    expect(isAbbreviationStop("rep.", "Then")).toBe(false);
    expect(isAbbreviationStop("fig.", "It")).toBe(false);
    expect(isAbbreviationStop("U.S.?", "Yes")).toBe(false);
    expect(isAbbreviationStop("wait...", "Then")).toBe(false);
    expect(isAbbreviationStop("a.", "Then", "plan")).toBe(false);
    expect(isAbbreviationStop(undefined)).toBe(false);
  });
});

describe("the text helpers", () => {
  it("endsOnAbbreviation reads the text's last word with the words around it", () => {
    expect(endsOnAbbreviation("Number one. The whole can. On a lot of U.", "S. airlines, the flight attendant")).toBe(true);
    expect(endsOnAbbreviation("Number one. The whole can. On a lot of U.")).toBe(true);
    expect(endsOnAbbreviation("Number one. The whole can.", "On a lot of U. S. airlines,")).toBe(false);
    expect(endsOnAbbreviation("clockwise, that crosses over itself in a small X.", "Snug, but loose")).toBe(false);
  });

  it("abbreviationBreakAt judges the break a splitter's match ends at", () => {
    const at = WHOLE_CAN.indexOf("U. ") + 3; // after "U. "
    expect(abbreviationBreakAt(WHOLE_CAN, at)).toBe(true);
    expect(abbreviationBreakAt(WHOLE_CAN, WHOLE_CAN.indexOf("S. ") + 3)).toBe(true);
    // The real sentence ends of the same line.
    expect(abbreviationBreakAt(WHOLE_CAN, WHOLE_CAN.indexOf("one. ") + 5)).toBe(false);
    expect(abbreviationBreakAt(WHOLE_CAN, WHOLE_CAN.indexOf("can. ") + 5)).toBe(false);
    // A look-behind split hands the offset of the space itself.
    expect(abbreviationBreakAt("We met Dr. Hale. Then", "We met Dr.".length)).toBe(true);
    expect(abbreviationBreakAt("We met Dr. Hale. Then", "We met Dr. Hale.".length)).toBe(false);
  });

  it("rejoinAbbreviations puts a split initial back, and leaves sentences apart", () => {
    const pieces = WHOLE_CAN.split(/(?<=[.!?])\s+/);
    expect(pieces).toContain("On a lot of U.");
    expect(rejoinAbbreviations(pieces)).toEqual([
      "Number one.",
      "The whole can.",
      "On a lot of U. S. airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.",
    ]);
    expect(rejoinAbbreviations(["that crosses over itself in a small X.", "Snug, but loose enough."])).toHaveLength(2);
  });

  it("splitsInitials: never between the letters of one spoken word", () => {
    expect(splitsInitials(WHOLE_CAN, WHOLE_CAN.indexOf("S. airlines"))).toBe(true);
    expect(splitsInitials("at 6 a. m. sharp", "at 6 a. ".length)).toBe(true);
    // Between whole words is no such cut.
    expect(splitsInitials(WHOLE_CAN, WHOLE_CAN.indexOf("airlines"))).toBe(false);
    expect(splitsInitials(WHOLE_CAN, WHOLE_CAN.indexOf("On a lot"))).toBe(false);
    expect(splitsInitials("asked Dr. Hale", "asked Dr. ".length)).toBe(false);
  });

  it("splitsInitials: never inside the same word written closed ('U.S.', 'a.m.', a price)", () => {
    // The cutters find words run of letters by run of letters: "U.S." is "u" and "s".
    const closed = "On a lot of U.S. airlines, the flight attendant pours your soda.";
    expect(splitsInitials(closed, closed.indexOf("S. airlines"))).toBe(true);
    expect(splitsInitials("doors open at 6 a.m. sharp", "doors open at 6 a.".length)).toBe(true);
    expect(splitsInitials("a can costs $1.50 on board", "a can costs $1.".length)).toBe(true);
    // Negative: a cut after a full stop and a space, or after a dash with none, is between words.
    expect(splitsInitials(closed, closed.indexOf("airlines"))).toBe(false);
    expect(splitsInitials("The whole can. On a lot", "The whole can. ".length)).toBe(false);
    expect(splitsInitials("hold it—then let go", "hold it—".length)).toBe(false);
  });

  it("a web address a sentence ends on is no short form; letters in groups of one or two are", () => {
    expect(isAbbreviationStop("irs.gov.", "Then")).toBe(false);
    expect(isAbbreviationStop("ssa.gov.", "You")).toBe(false);
    expect(abbreviationBreakAt("Go to irs.gov. Then fill in the form.", "Go to irs.gov. ".length)).toBe(false);
    for (const w of ["U.S.A.", "Ph.D.", "N.Y."]) expect(isAbbreviationStop(w, "Then")).toBe(true);
  });
});
