import { describe, it, expect } from "vitest";
import {
  scanCtaBlocks,
  ctaTitleMatches,
  ctaLabelMatches,
  previewBookAssignments,
  buildBookCtaTemplate,
  CTA_MARKER_TEMPLATE,
  CTA_TEMPLATE_PLACEHOLDER,
} from "../shared/ctaMarkers";
import { parseCtaMarkers, extractSpokenScript } from "./longformVideo";

describe("scanCtaBlocks (client-side preview of the marker scan)", () => {
  const script = [
    "Intro paragraph.",
    "===START CTA===",
    "Grab The Old Way Home today.",
    "===END CTA===",
    "Middle.",
    "===START CTA (Atomic Habits)===",
    "Last chance to get it.",
    "===END CTA===",
  ].join("\n");

  it("returns each block's text and marker label, in order", () => {
    const { blocks, empty, errors } = scanCtaBlocks(script);
    expect(errors).toEqual([]);
    expect(empty).toBe(0);
    expect(blocks).toEqual([
      { text: "Grab The Old Way Home today.", label: undefined },
      { text: "Last chance to get it.", label: "Atomic Habits" },
    ]);
  });

  it("counts an empty marker pair instead of returning it as a block", () => {
    const { blocks, empty, errors } = scanCtaBlocks(
      "Intro.\n===START CTA (Some Book)===\n\n===END CTA===\nOutro."
    );
    expect(errors).toEqual([]);
    expect(blocks).toEqual([]);
    expect(empty).toBe(1);
  });

  it("agrees with the server's parseCtaMarkers on count, labels and errors", () => {
    // The dialog's promise is only worth making if the router sees the same scan.
    const cases = [
      script,
      "No markers at all.",
      "Intro.\n===START CTA===\nPitch.", // unclosed
      "===END CTA===\nOrphan.", // END first
      "===START CTA===\nA.\n===START CTA===\nB.\n===END CTA===", // nested
      "Intro.\n  ===START CTA===  \n===END CTA===\nOutro.", // empty block dropped
      "===START CTA (My Book)===\nBuy it.\n===END CTA===", // labeled
    ];
    for (const s of cases) {
      const client = scanCtaBlocks(s);
      const server = parseCtaMarkers(extractSpokenScript(s));
      expect(client.blocks.length).toBe(server.spans.length);
      expect(client.blocks.map(b => b.label)).toEqual(
        server.spans.map(sp => sp.label)
      );
      expect(client.errors).toEqual(server.errors);
    }
  });

  it("scans only the spoken portion, like the server does", () => {
    const templated =
      "Host (identity lock)\n* stays seated\n\n=== SCRIPT ===\n===START CTA===\nBuy it.\n===END CTA===";
    expect(scanCtaBlocks(templated).blocks).toEqual([
      { text: "Buy it.", label: undefined },
    ]);
  });
});

describe("labeled markers on the server (===START CTA (name)===)", () => {
  it("captures the label onto the span and never voices the marker line", () => {
    const { script, spans, errors } = parseCtaMarkers(
      "Intro.\n===START CTA (The Old Way Home)===\nBuy my book today.\n===END CTA===\nOutro."
    );
    expect(errors).toEqual([]);
    expect(spans).toEqual([{ start: 1, end: 5, label: "The Old Way Home" }]);
    // The stripped script carries the pitch but not the marker or the name inside it.
    expect(script).not.toContain("START CTA");
    expect(script).not.toContain("The Old Way Home");
    expect(script).toContain("Buy my book today.");
  });

  it("treats an empty parenthesis as no label", () => {
    const { spans } = parseCtaMarkers(
      "===START CTA ()===\nPitch.\n===END CTA==="
    );
    expect(spans[0].label).toBeUndefined();
  });
});

describe("ctaTitleMatches (book → block by spoken title)", () => {
  it("matches when at least half the title's long words are spoken", () => {
    expect(
      ctaTitleMatches("The Old Way Home", "so grab the old way home today")
    ).toBe(true);
    expect(ctaTitleMatches("Atomic Habits", "build atomic routines")).toBe(
      true
    );
    expect(ctaTitleMatches("Atomic Habits", "totally unrelated pitch")).toBe(
      false
    );
  });

  it("never matches a title with no words over 3 letters", () => {
    expect(ctaTitleMatches("Go To It", "go to it now")).toBe(false);
  });
});

describe("ctaLabelMatches (book → block by marker name)", () => {
  it("matches exactly after normalization — short titles included", () => {
    expect(ctaLabelMatches("HAHAHAH", "hahahah")).toBe(true);
    expect(ctaLabelMatches("Go To It", "go to it")).toBe(true);
    expect(ctaLabelMatches("Go To It", "something else")).toBe(false);
  });

  it("falls back to the loose token rule for near-misses", () => {
    expect(ctaLabelMatches("The Old Way Home", "Old Way Home")).toBe(true);
  });
});

describe("previewBookAssignments (the router's placement rule, previewed)", () => {
  const blocks = [
    { text: "grab the old way home now" },
    { text: "and one more thing" },
  ];

  it("prefers the marker label over everything, including spoken titles", () => {
    const labelled = [
      { text: "grab the old way home now", label: "Beta Grande" },
      { text: "and one more thing" },
    ];
    expect(
      previewBookAssignments(labelled, ["The Old Way Home", "Beta Grande"])
    ).toEqual([
      { bookIndex: 1, byLabel: true, byTitle: false },
      { bookIndex: 1, byLabel: false, byTitle: false }, // order fallback
    ]);
  });

  it("then prefers the block that speaks the title", () => {
    expect(previewBookAssignments(blocks, ["The Old Way Home"])).toEqual([
      { bookIndex: 0, byLabel: false, byTitle: true },
      // single upload falls back onto every block, exactly like the router
      { bookIndex: 0, byLabel: false, byTitle: false },
    ]);
  });

  it("falls back to order, then to none, for multiple unnamed books", () => {
    expect(
      previewBookAssignments(blocks, ["Alpha Omega", "Beta Grande"])
    ).toEqual([
      { bookIndex: 0, byLabel: false, byTitle: false },
      { bookIndex: 1, byLabel: false, byTitle: false },
    ]);
    expect(
      previewBookAssignments(
        [{ text: "only block" }],
        ["Alpha Omega", "Beta Grande"]
      )
    ).toEqual([{ bookIndex: 0, byLabel: false, byTitle: false }]);
  });

  it("marks a block with no book as fallback (channel cover/QR)", () => {
    expect(previewBookAssignments(blocks, [])).toEqual([
      { bookIndex: null, byLabel: false, byTitle: false },
      { bookIndex: null, byLabel: false, byTitle: false },
    ]);
  });

  it("places an auto (channel) book ONLY when the script calls it", () => {
    const auto = { title: "The Old Way Home", requiresCall: true };
    // Called — by spoken title here — so it places.
    expect(previewBookAssignments(blocks, [auto])).toEqual([
      { bookIndex: 0, byLabel: false, byTitle: true },
      // ...but it is NEVER handed out positionally or as the single default.
      { bookIndex: null, byLabel: false, byTitle: false },
    ]);
    // A marker label calls it too.
    expect(
      previewBookAssignments(
        [{ text: "no title spoken", label: "Old Way Home" }],
        [auto]
      )
    ).toEqual([{ bookIndex: 0, byLabel: true, byTitle: false }]);
    // Uncalled anywhere → stays on the shelf entirely.
    expect(
      previewBookAssignments([{ text: "nothing relevant" }], [auto])
    ).toEqual([{ bookIndex: null, byLabel: false, byTitle: false }]);
  });

  it("skips auto books in the positional fallback — attached books keep their positions", () => {
    const mixed = [
      { title: "Shelf Book", requiresCall: true },
      { title: "Alpha Omega" }, // attached to the video
    ];
    // Neither block calls anything: block 1 gets the FIRST attached book, not the shelf book.
    expect(
      previewBookAssignments(
        [{ text: "generic pitch" }, { text: "another pitch" }],
        mixed
      )
    ).toEqual([
      { bookIndex: 1, byLabel: false, byTitle: false },
      { bookIndex: 1, byLabel: false, byTitle: false }, // single attached → every block
    ]);
  });
});

describe("CTA_MARKER_TEMPLATE (the one-click insert)", () => {
  it("scans as exactly one valid block containing the placeholder", () => {
    const { blocks, errors } = scanCtaBlocks(
      `Some script.\n\n${CTA_MARKER_TEMPLATE}\n`
    );
    expect(errors).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain(CTA_TEMPLATE_PLACEHOLDER);
  });

  it("is accepted by the server's parser too", () => {
    const { spans, errors } = parseCtaMarkers(`Intro.\n${CTA_MARKER_TEMPLATE}`);
    expect(errors).toEqual([]);
    expect(spans).toHaveLength(1);
  });
});

describe("buildBookCtaTemplate (per-book Copy CTA skeleton)", () => {
  it("is bare markers with the name in the START line — the pitch is the operator's", () => {
    expect(buildBookCtaTemplate("The Old Way Home")).toBe(
      "===START CTA (The Old Way Home)===\n\n===END CTA==="
    );
  });

  it("once the pitch is written in, the label assigns the book — no spoken title needed", () => {
    const pasted = buildBookCtaTemplate("HAHAHAH").replace(
      "\n\n",
      "\nHere is my pitch, no title spoken.\n"
    );
    const { blocks, errors } = scanCtaBlocks(`Intro.\n\n${pasted}`);
    expect(errors).toEqual([]);
    expect(blocks).toEqual([
      { text: "Here is my pitch, no title spoken.", label: "HAHAHAH" },
    ]);
    expect(previewBookAssignments(blocks, ["HAHAHAH"])).toEqual([
      { bookIndex: 0, byLabel: true, byTitle: false },
    ]);
  });

  it("strips parens from the name so the marker still parses", () => {
    const t = buildBookCtaTemplate("My Book (2nd Edition)");
    expect(t).toContain("===START CTA (My Book 2nd Edition)===");
    const { blocks } = scanCtaBlocks(t.replace("\n\n", "\nPitch.\n"));
    expect(blocks[0].label).toBe("My Book 2nd Edition");
    // ...and the label still matches the original paren-carrying title.
    expect(ctaLabelMatches("My Book (2nd Edition)", blocks[0].label!)).toBe(
      true
    );
  });

  it("an unfilled skeleton is an EMPTY pair, not a block — the dialog flags it", () => {
    const { blocks, empty } = scanCtaBlocks(
      `Intro.\n\n${buildBookCtaTemplate("HAHAHAH")}`
    );
    expect(blocks).toEqual([]);
    expect(empty).toBe(1);
  });
});
