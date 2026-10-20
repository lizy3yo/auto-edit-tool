/**
 * A THING ONLY THE CTA NAMES IS NO PROP OF THE FILM (round 13, job 409). The style bible and the
 * props list read the whole spoken script, marked CTA blocks included, so the closing CTA's "lift
 * your phone toward the pattern in the corner of the screen" — the script's only phone — became
 * "Props recur: sympathy cards, greeting cards, a phone" and the key thing "phone: a black
 * smartphone … resting face-up on the desk", which then filled the split panel under "Maybe you
 * have done that arithmetic" (scene 7) and the study shots 14 and 19. Both passes now read the
 * content only (`splitCtaFromContent`), and the props list drops a thing only a CTA names
 * (`withoutCtaOnlyProps`). The texts are the real films'.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildStyleBibleUserMessage } from "./visualDirection";
import { extractSpokenScript, parseCtaMarkers, splitCtaFromContent } from "./longformVideo";
import { parseKeyThings, withoutCtaOnlyProps } from "./shotList";

// Job 409's script (its first paragraphs, the line before the CTA, and the whole marked CTA).
const CONTENT_409 = [
  "There is a man standing in the greeting card aisle of a pharmacy on a Tuesday morning, buying his third sympathy card since spring, and doing a kind of arithmetic nobody ever taught him. He is counting backward. He is sixty-four. His father made it to eighty-one. And somewhere between the sympathy cards and the cards for new grandbabies, he has quietly worked out that if the family average holds, he has about seventeen summers left.",
  "",
  "Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat. Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.",
  "",
  "Then he turns the whole thing over in a single motion: life is not short.",
  "",
].join("\n");
const CTA_409 = [
  "===START CTA(The Stoic Way)===",
  "Some of you are already a page ahead of me, wondering where all of this lives in one place. The thinking belongs to Seneca and the Stoics after him; my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more. Thirteen chapters, each lesson built the same way: the real struggle, the principle underneath it, a boxed exercise to run before the day ends, and an honest note on where the advice breaks down.",
  "",
  "Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for. Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below. No timer on this — a lesson about hurry is a poor place to hurry you.",
  "",
  "Now, back to that door you have been holding open.",
  "===END CTA===",
].join("\n");
const SCRIPT_409 = CONTENT_409 + CTA_409;

// Job 409's real props list, as the props call wrote it from the whole script.
const SHEET_409 = [
  "HOME: a quiet home study, pale cream walls, a wooden desk by a window, soft gray morning light",
  "MAIN sympathy card: a plain cream greeting card with a muted gray ribbon print on the front, blank inside, small and rectangular",
  "greeting card: a pale blue card with a simple floral print on the front, slightly smaller than the sympathy card, blank inside",
  "phone: a black smartphone with a glass screen and thin silver edges, resting face-up on the desk",
  "pharmacy aisle: a narrow aisle lined with low wooden shelves holding neat rows of greeting cards, bright overhead lighting",
  "church pew: a long wooden bench with a polished dark brown finish, straight back, set in quiet stillness",
  "kitchen table: a round wooden table with a smooth pale finish, two plain wooden chairs, dim late-night lighting",
  "parking lot: a flat paved lot with faint lane lines, a few parked cars, gray overcast sky",
].join("\n");

const parts = (raw: string) => {
  const { script, spans } = parseCtaMarkers(extractSpokenScript(raw));
  return { script, ...splitCtaFromContent(script, spans) };
};
const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;

describe("splitCtaFromContent: the script's content apart from its marked CTA blocks", () => {
  it("job 409: the content holds every content line and no word of the CTA — its phone included", () => {
    const { script, content, cta } = parts(SCRIPT_409);
    expect(content).not.toMatch(/phone|screen|description|digital book|Stoic Way/i);
    expect(cta).toMatch(/lift your phone toward the pattern in the corner of the screen/);
    expect(content).toContain("Maybe you have done that arithmetic.");
    expect(content).toContain("Then he turns the whole thing over in a single motion: life is not short.");
    // Paragraphs kept; nothing lost or doubled.
    expect(content.split("\n\n")).toHaveLength(3);
    expect(wordCount(content) + wordCount(cta)).toBe(wordCount(script));
    // The style bible's message is built from it, so the CTA's phone never reaches the world pass.
    expect(buildStyleBibleUserMessage(null, content, "You're Not Running Out of Time After 60")).not.toMatch(/phone/i);
  });

  it("a mid-roll and a closing block both go; the content between and after them stays, in order", () => {
    const raw = [
      "Sand the board to 220 before the oil goes on.",
      "",
      "===START CTA===",
      "Every finish I trust is in my book. Point your phone at the code on the screen.",
      "===END CTA===",
      "",
      "Now flood the oil on and let it sit ten minutes.",
      "",
      "===START CTA (My Book)===",
      "The link is first in the description below.",
      "===END CTA===",
      "Wipe it dry and the board is done.",
    ].join("\n");
    const { content, cta } = parts(raw);
    expect(content).toBe(
      "Sand the board to 220 before the oil goes on.\n\nNow flood the oil on and let it sit ten minutes.\n\nWipe it dry and the board is done."
    );
    expect(cta).toBe(
      "Every finish I trust is in my book. Point your phone at the code on the screen.\n\nThe link is first in the description below."
    );
  });

  it("a script with no marked block is all content, and one that is all CTA keeps its whole text", () => {
    const plain = "Just a plain script.\n\nWith two paragraphs.";
    expect(splitCtaFromContent(plain, [])).toEqual({ content: plain, cta: "" });
    const { script, content, cta } = parts("===START CTA===\nPoint your phone at the code.\n===END CTA===");
    expect(content).toBe(script);
    expect(cta).toBe("Point your phone at the code.");
  });
});

describe("withoutCtaOnlyProps: a thing only the CTA names is no key thing", () => {
  it("job 409: the CTA's phone leaves the props list; every content thing and the home stay", () => {
    const { content, cta } = parts(SCRIPT_409);
    const { sheet, dropped } = withoutCtaOnlyProps(SHEET_409, content, cta);
    expect(dropped).toEqual(["phone"]);
    const things = parseKeyThings(sheet);
    expect(things.map(t => t.name)).toEqual([
      "sympathy card",
      "greeting card",
      "pharmacy aisle",
      "church pew",
      "kitchen table",
      "parking lot",
    ]);
    expect(things.find(t => t.main)?.name).toBe("sympathy card");
    expect(sheet.split("\n")[0]).toMatch(/^HOME: a quiet home study/);
  });

  it("a phone the content talks about stays a key thing — as 'phone', 'phones' or 'smartphone'", () => {
    const cta = "There's a code on your screen — aim your phone’s camera at it, and the page opens on its own.";
    const sheet = [
      "HOME: a one-car garage workshop, pegboard wall, a long wooden workbench",
      "MAIN cutting board: a walnut and maple striped cutting board with rounded corners",
      "phone: a plain black phone in a grey case",
    ].join("\n");
    for (const content of [
      "Take the photo with your phone in daylight, the board on the workbench.",
      "Buyers scroll on their phones at night, so the first photo has to sell the board.",
      "Your smartphone's camera is plenty for a listing photo of the cutting board.",
    ]) {
      const out = withoutCtaOnlyProps(sheet, content, cta);
      expect(out.dropped).toEqual([]);
      expect(parseKeyThings(out.sheet).map(t => t.name)).toEqual(["cutting board", "phone"]);
    }
  });

  it("an ordinary CTA word never takes a content thing: job 413's gas can, job 368's chicken run", () => {
    // Job 413: the CTA says "you can already see the pattern"; the content says "gasoline".
    const gas = withoutCtaOnlyProps(
      "HOME: a two-car garage\ngas can: a red plastic gasoline can with a black spout and cap",
      "And treat gasoline like it's actively looking for a reason — drain it outside.",
      "Three businesses in, and you can already see the pattern: the money lives in the math, not the hype."
    );
    expect(gas.dropped).toEqual([]);
    // Job 368: the CTA says "It runs eight chapters"; the content says "the girls come running".
    const run = withoutCtaOnlyProps(
      "HOME: a modest fenced dirt yard with a coop\nrun: wire mesh enclosure attached to coop, grey woven wire",
      "You pour one scoop of layer feed into the feeder, and the girls come running.",
      "It runs eight chapters, over a hundred and sixty pages, with cost tables."
    );
    expect(run.dropped).toEqual([]);
  });

  it("only a whole name the CTA says goes: a name with a word the CTA never says stays", () => {
    // Job 355's CTA says "kitchen scraps" but never "bowl"; job 404's says "holly" but never "bush".
    const out = withoutCtaOnlyProps(
      "HOME: a backyard coop\nkitchen scraps bowl: a shallow steel bowl of vegetable peelings\nphone screen: a phone showing a code",
      "You pour one scoop of layer feed into the feeder.",
      "a short, firm list of kitchen scraps. Grab your phone, point the camera at the little code on the screen."
    );
    expect(out.dropped).toEqual(["phone screen"]);
  });

  it("the home line, the people and 'you' are never dropped, and no CTA means no change", () => {
    const sheet = [
      "phone booth: a red phone booth on a street corner",
      "phone: a black phone",
      "PERSON the neighbour: a tall man in his seventies, a faded green jacket",
      "VIEWER the patient: a woman in her sixties in a cardigan",
    ].join("\n");
    const cta = "Hold your phone up to the booth of the screen, neighbour, patient.";
    const out = withoutCtaOnlyProps(sheet, "A quiet street at night.", cta);
    expect(out.dropped).toEqual(["phone"]);
    expect(out.sheet.split("\n")).toEqual([sheet.split("\n")[0], ...sheet.split("\n").slice(2)]);
    expect(withoutCtaOnlyProps(SHEET_409, "anything", "")).toEqual({ sheet: SHEET_409, dropped: [] });
  });
});

describe("the world and the props are the content's (wiring)", () => {
  // The two passes are LLM calls, so the wiring is held by the source: a later edit that hands
  // them the whole spoken script again would bring the CTA's phone back.
  const src = readFileSync(join(import.meta.dirname, "longformVideo.ts"), "utf8");
  it("the style bible reads the content, never the whole spoken script", () => {
    expect(src).toMatch(/splitCtaFromContent\(spokenScript, ctaSpans\)/);
    expect(src).toMatch(/deriveStyleBible\(params, scriptParts\.content\)/);
    expect(src).not.toMatch(/deriveStyleBible\(params, spokenScript\)/);
  });
  it("the props list reads the content and drops what only a CTA names", () => {
    expect(src).toMatch(/deriveContinuitySheet\(ctx\.contentScript,/);
    expect(src).toMatch(/withoutCtaOnlyProps\(derived, ctx\.contentScript, ctx\.ctaScript\)/);
    expect(src).toMatch(/contentScript: scriptParts\.content,\s*ctaScript: scriptParts\.cta,/);
  });
});
