import { describe, expect, it } from "vitest";
import {
  countScriptWords,
  HEYGEN_TEST_MAX_WORDS,
  heygenTestInputError,
} from "../shared/heygenTest";
import {
  fillVslScript,
  planVslPick,
  VSL_BOOK_TOKEN,
  VSL_DEFAULT_TEMPLATE,
  vslInputError,
  vslTemplateFrom,
  vslWordsLeft,
} from "../shared/vsl";
import { heygenTestStorageDir } from "./heygenTest";

const TITLE = "The Weekend Woodworker's Handbook";

describe("upsell VSL script", () => {
  it("drops the book's title into the template, everywhere it is named", () => {
    const filled = fillVslScript(`Thanks for ${VSL_BOOK_TOKEN}. ${VSL_BOOK_TOKEN} is a start.`, TITLE);
    expect(filled).toBe(`Thanks for ${TITLE}. ${TITLE} is a start.`);
    // No book yet: the token stays, and the run is refused for it below.
    expect(fillVslScript(VSL_DEFAULT_TEMPLATE, "  ")).toContain(VSL_BOOK_TOKEN);
  });

  it("turns a saved script back into a template for the next book", () => {
    const script = fillVslScript(VSL_DEFAULT_TEMPLATE, TITLE);
    expect(vslTemplateFrom(script, TITLE)).toBe(VSL_DEFAULT_TEMPLATE);
    expect(vslTemplateFrom(script, null)).toBe(script);
  });

  it("the standard script is ready to voice once the book is in it, even a long title", () => {
    const long = "100 Ways to Make Your First $1,000 with Woodworking, Second Revised Edition";
    for (const title of [TITLE, long]) {
      const script = fillVslScript(VSL_DEFAULT_TEMPLATE, title);
      expect(countScriptWords(script)).toBeLessThanOrEqual(HEYGEN_TEST_MAX_WORDS);
      expect(vslWordsLeft(script)).toBeGreaterThanOrEqual(0);
      expect(vslInputError({ script, bookTitle: title })).toBeNull();
      expect(heygenTestInputError({ script, imageUrls: ["https://x/y.jpg"] })).toBeNull();
    }
    // No tip: the operator's call. The book's title is the only thing left to fill in.
    expect(VSL_DEFAULT_TEMPLATE).not.toMatch(/\btip\b/i);
    expect(VSL_DEFAULT_TEMPLATE.match(/\{\w+\}/g)).toEqual([VSL_BOOK_TOKEN]);
  });

  it("refuses a script the host would read a placeholder from", () => {
    expect(vslInputError({ script: VSL_DEFAULT_TEMPLATE, bookTitle: "" })).toMatch(/book/);
    // A typed title with the token still in the script (the template was not filled).
    expect(vslInputError({ script: VSL_DEFAULT_TEMPLATE, bookTitle: TITLE })).toMatch(/\{book\}/);
    expect(
      vslInputError({ script: `Thanks for ${VSL_BOOK_TOKEN}.`, bookTitle: "x".repeat(300) })
    ).toMatch(/too long/);
  });
});

describe("upsell VSL — the clip in use", () => {
  const row = (batchId: string, bookTitle: string, isPicked = false, channelKey = "hank") => ({
    batchId,
    channelKey,
    bookTitle,
    isPicked,
  });

  it("keeps one clip in use per channel and book", () => {
    const rows = [
      row("a", TITLE, true),
      row("b", TITLE),
      row("c", "Another Book", true),
      row("d", TITLE.toUpperCase(), true),
    ];
    const plan = planVslPick(rows, "b");
    expect(plan.pick).toEqual(["b"]);
    // The same book's other picks go (case does not make it a different book); another book's stays.
    expect(plan.unpick.sort()).toEqual(["a", "d"]);
  });

  it("picking the clip already in use stops using it", () => {
    expect(planVslPick([row("a", TITLE, true)], "a")).toEqual({ pick: [], unpick: ["a"] });
  });

  it("changes nothing for a run that is not there", () => {
    expect(planVslPick([row("a", TITLE, true)], "zz")).toEqual({ pick: [], unpick: [] });
  });
});

describe("upsell VSL storage", () => {
  it("keeps a VSL under its channel and a test where tests always were", () => {
    expect(heygenTestStorageDir({ kind: "vsl", channelKey: "hank", batchId: "b1" })).toBe(
      "vsl/hank/b1"
    );
    expect(heygenTestStorageDir({ kind: "test", channelKey: "hank", batchId: "b1" })).toBe(
      "heygen-tests/b1"
    );
  });
});
