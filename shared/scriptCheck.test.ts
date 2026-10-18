/**
 * Only narration may be voiced: the Generate-time script check (`shared/scriptCheck.ts`). The
 * positive cases are production jobs 204 and 205 — QA notes and a second copy of the script
 * pasted under it — and the negatives are real narration lines the rules must never refuse.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkScript,
  ctaPlacementWarnings,
  misplacedCodeWords,
  noteLineReason,
  REPEAT_MIN_WORDS,
  scriptRefusal,
} from "./scriptCheck";

// Job 205's real script, cut down to its shape: the narration (opening paragraphs and the closing
// CTA), the writer's QA notes, then the "VO COPY" — the same narration again with directions.
const OPENING_205 = [
  "Sometime tonight, after the lamp clicks off and the house goes quiet, you'll probably feel it. A soft thump at the end of the bed, a few careful steps across the blanket, a slow little circle, and then a warm weight settling in against your legs. It happens so often that it stops feeling like anything at all. But your cat just made a choice, and she made it on purpose, out of every warm, quiet, soft place in the entire house.",
  "I'm Luca, and this channel is for anyone who loves their cat but can't always read what she's saying. By the end of this video, you'll know what that nightly visit really means, what her sleeping position is telling you, and what to do if she suddenly stops coming to bed at all.",
  "So let's start with the part that makes everything else matter. A cat sleeps somewhere around twelve to sixteen hours a day. That's more than half of her life spent asleep, which makes the place she picks to do it one of the biggest decisions she makes. Think about it from her side of the room. She has the sunny windowsill, the top of the bookcase, the laundry basket full of clean towels you were meaning to fold, and the cardboard box the new shoes came in. Every one of those is available to her. And night after night, plenty of cats walk right past all of them and climb onto a large, noisy, restless human who rolls over without any warning at all.",
  "From a cat's point of view, that's a vote, and you won it.",
];
const DIRECTED_OPENING_205 = [
  "[quietly] Sometime tonight, after the lamp clicks off and the house goes quiet, you'll probably feel it. A soft thump at the end of the bed, a few careful steps across the blanket, a slow little circle, and then a warm weight settling in against your legs. It happens so often that it stops feeling like anything at all. But your cat just made a choice, and she made it on purpose, out of every warm, quiet, soft place in the entire house.",
  OPENING_205[1],
  "So let's start with the part that makes everything else matter. A cat sleeps somewhere around twelve to sixteen hours a day. That's more than half of her life spent asleep, which makes the place she picks to do it one of the biggest decisions she makes. [thoughtful] Think about it from her side of the room. She has the sunny windowsill, the top of the bookcase, the laundry basket full of clean towels you were meaning to fold, and the cardboard box the new shoes came in. Every one of those is available to her. And night after night, plenty of cats walk right past all of them and climb onto a large, noisy, restless human who rolls over without any warning at all.",
  "[slightly amused] From a cat's point of view, that's a vote, and you won it.",
];
const CLOSE_205 = [
  "===START CTA(Everything Your Cat Can't Tell You)===",
  " Where she sleeps is only one signal in a much longer conversation, and my book, Everything Your Cat Can't Tell You, is a digital download that walks through more than a hundred and seventy of them, from the slow blink to the bite in the middle of petting, each one with its own section on when a vet should take a look. You can reach it through the code on your screen, or with the first link in the description below.",
  " ===END CTA===",
  "Ciao, from Luca Marino.",
];
const NOTES_205 = [
  "VERDICT: PASS",
  " HOUSE FORMAT: Talking Head — 2/2 marker blocks present (mid + end), each marker alone on its own line, both start markers carrying the printed book title — end-CTA opens directly after the final content sentence — exactly one sentence after the end-CTA, and it is the last line of the script — PASS",
  'ROTATION LOG ENTRY: Ep 1 / 2026-10-03 — If Your Cat Sleeps With You, This Is What It REALLY Means — Second-person sensory scene + reframe (nightly bedtime moment recast as a deliberate choice) — Ingredient-by-ingredient bridges with one held loop paid off in the position run — "One quick pause here, because what comes next makes"',
  "VO COPY — ELEVENLABS V4",
];
const PASTED_205 = [
  ...OPENING_205, // lines 1-4
  ...CLOSE_205, // lines 5-8
  ...NOTES_205, // lines 9-12
  ...DIRECTED_OPENING_205, // lines 13-16
  ...CLOSE_205, // lines 17-20
].join("\n");

const wordsIn = (lines: string[]) =>
  lines
    .filter(l => !/===/.test(l))
    .join(" ")
    .split(/\s+/)
    .filter(w => /[A-Za-z0-9]/.test(w)).length;

describe("notes pasted with the script are refused (jobs 204/205)", () => {
  it("names each QA line by its line in the script as pasted", () => {
    const { problems, warnings } = checkScript(PASTED_205);
    const notes = problems.filter(p => p.kind === "note");
    expect(notes.map(n => n.line)).toEqual([9, 10, 11, 12]);
    expect(notes[0].message).toBe(
      'Line 9 is a note, not narration (a label in capitals): "VERDICT: PASS".'
    );
    expect(notes[3].message).toContain("a heading in capitals");
    expect(warnings).toEqual([]);
  });

  it("refuses the second copy, directions and all, from the line each copy starts on", () => {
    const repeat = checkScript(PASTED_205).problems.find(
      p => p.kind === "repeat"
    )!;
    expect(repeat.line).toBe(1);
    expect(repeat.againLine).toBe(13);
    expect(repeat.words).toBe(wordsIn([...OPENING_205, ...CLOSE_205]));
    expect(repeat.message).toContain(
      '"Sometime tonight, after the lamp clicks off and the house…"'
    );
  });

  it("the router's message carries the lines, the fix and the repeat", () => {
    const msg = scriptRefusal(checkScript(PASTED_205))!;
    expect(msg).toMatch(/^Only narration can be voiced\./);
    expect(msg).toContain("Line 9 is a note");
    expect(msg).toContain("Line 11 is a note");
    expect(msg).toContain("…and 1 more line like these.");
    expect(msg).toContain("=== SCRIPT === and === END SCRIPT ===");
    expect(msg).toContain("from line 1 and again from line 13");
  });

  it("catches each of job 204's four note lines on its own", () => {
    for (const line of [
      "VERDICT: PASS",
      " HOUSE FORMAT: Talking Head — 2/2 marker blocks present (mid + end), each marker alone on its own line — PASS",
      "ROTATION LOG ENTRY: Ep 1 / 2026-10-03 — The TRUTH About Black Cats — It's Not What You've Heard — Hook archetype: second-person superstition scene flipped into a myth check",
      "VO COPY — ELEVENLABS V4",
    ])
      expect(noteLineReason(line)).not.toBeNull();
  });

  it("counts lines from the box even when a CRLF script is framed", () => {
    const framed = ["Notes for the editor.", "=== SCRIPT ===", PASTED_205]
      .join("\n")
      .replace(/\n/g, "\r\n");
    const notes = checkScript(framed).problems.filter(p => p.kind === "note");
    expect(notes.map(n => n.line)).toEqual([11, 12, 13, 14]);
  });
});

describe("what a note line is", () => {
  it.each([
    ["VERDICT: PASS", "a label in capitals"],
    ["VO COPY — ELEVENLABS V4", "a heading in capitals"],
    ["Word count: 2,450", "a production label"],
    ["Title: The Truth About Black Cats", "a production label"],
    ["Runtime: about 14 min", "a production label"],
    ["## Section two", "formatting, not speech"],
    ["---", "formatting, not speech"],
    ["| Scene | Line |", "formatting, not speech"],
    ["**The hook**", "formatting, not speech"],
    // A misspelled marker is not a marker — it would be read aloud.
    ["=== START CTA ===", "an === line that is not a CTA or SCRIPT marker"],
    ["=== END SCRIPT ===", "an === line that is not a CTA or SCRIPT marker"],
  ])("%s → %s", (line, why) => {
    expect(noteLineReason(line)).toBe(why);
  });

  it.each([
    // Job 46: a real narration line with "verdict" in it.
    "So today, twelve things about plain white vinegar, and an honest verdict on every one.",
    // Everyday words a script says with a colon.
    "Hook: 5 mm",
    "Verdict: worth every penny.",
    "Notes: vanilla, oak and a little smoke",
    "Number seven:",
    "Step one on the list:",
    // A production word on a full spoken sentence.
    "Title: that is the one word on the box that matters, and here is why.",
    // A shouted line is narration.
    "STOP RIGHT THERE!",
    "DON'T DO THIS.",
    "#1 tip: clean the blade first.",
    "I'm Luca, and this one is for anyone who shares a couch with a black cat.",
  ])("%s → narration", line => {
    expect(noteLineReason(line)).toBeNull();
  });
});

describe("what passes the check whole", () => {
  it("job 93's real test script — 35 words of the opening re-pasted into its CTA — passes", () => {
    const job93 =
      "If your last granny square came out shaped more like a pentagon than a square, your hands weren't the problem. You missed one cluster before the join, and the video you were following went too fast to show you. I'm Granny Mae. We're at my kitchen table with one ball of worsted weight yarn and a five millimeter hook.\n\n\n===START CTA (HAHAHAH)===\nbefore the join, and the video you were following went too fast to show you. I'm Granny Mae. We're at my kitchen table with one ball of worsted weight yarn and a five millimeter hook.\n===END CTA===";
    expect(checkScript(job93)).toEqual({ problems: [], warnings: [] });
  });

  it("a repeat as long as the longest in any real script (17 words, jobs 115/125) passes", () => {
    const phrase = "and ribbon it takes about an hour and a half for a set of";
    const script = [
      `Cut the strips, fold them, ${phrase} four cloth placemats.`,
      "Then the coasters, which go faster once your hands know the folds.",
      `Wrap the edges in bias tape ${phrase} four cloth placemats, start to finish.`,
    ].join("\n\n");
    expect(checkScript(script)).toEqual({ problems: [], warnings: [] });
  });

  it("markers, the SCRIPT frame, notes outside it and voice directions are never notes", () => {
    const script = [
      "Reminder for the editor: VERDICT: PASS",
      "=== SCRIPT ===",
      "[warmly] Welcome back to the shop.",
      "[laughs]",
      "===START CTA (The Weekend Shop)===",
      "The book is linked below.",
      "===END CTA===",
      "See you next time.",
      "=== END SCRIPT ===",
      "VERDICT: PASS",
      "VO COPY — ELEVENLABS V4",
    ].join("\n");
    expect(checkScript(script)).toEqual({ problems: [], warnings: [] });
  });

  it("a copy of the narration kept above the frame is not a repeat", () => {
    const body = OPENING_205.join("\n\n");
    const script = `DRAFT\n${body}\n\n=== SCRIPT ===\n${body}\n=== END SCRIPT ===`;
    expect(checkScript(script).problems).toEqual([]);
  });
});

describe("a pitch said in two CTA blocks", () => {
  // The skeptic's probe: a 75-word pitch reused word for word in the mid-roll and the close.
  const pitch =
    "If you want every one of these projects laid out step by step with the cut lists the measurements and the little tricks that keep a beginner from wasting good wood, I put it all in a short book called The Weekend Shop, and the link is right there in the description under this video so you can grab it whenever you are ready and keep it on the bench beside you while you work.";
  const narration = [
    "Today we are building three small projects from one board of pine.",
    "First, the box. Cut the sides to length and glue them square.",
  ];

  it("is a warning naming both blocks, never a refusal", () => {
    const script = [
      ...narration, // 1-2
      "===START CTA===", // 3
      pitch, // 4
      "===END CTA===",
      "Next, the shelf. Two brackets and a plank, nothing more.",
      "===START CTA===",
      pitch, // 8
      "===END CTA===",
    ].join("\n");
    const { problems, warnings } = checkScript(script);
    expect(pitch.split(/\s+/).length).toBeGreaterThanOrEqual(REPEAT_MIN_WORDS);
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(4);
    expect(warnings[0].againLine).toBe(8);
    expect(warnings[0].message).toContain("Two call-to-action blocks");
    expect(scriptRefusal(checkScript(script))).toBeNull();
  });

  it("is refused when one copy sits outside the blocks — that one is read as narration", () => {
    const script = [
      ...narration,
      pitch,
      "Next, the shelf. Two brackets and a plank, nothing more.",
      "===START CTA===",
      pitch,
      "===END CTA===",
    ].join("\n");
    const { problems, warnings } = checkScript(script);
    expect(warnings).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      kind: "repeat",
      line: 3,
      againLine: 6,
    });
  });

  it("a marker carrying a voice direction is a marker, as the voice reads it", () => {
    // `parseCtaMarkers` takes directions off before it looks for markers, so these are two good
    // blocks there — never a stray "===" note, and both pitches still count as inside a block.
    const script = [
      ...narration,
      "[warmly] ===START CTA===",
      pitch,
      "===END CTA=== [laughs]",
      "Next, the shelf. Two brackets and a plank, nothing more.",
      "===START CTA===",
      pitch,
      "[softly] ===END CTA===",
    ].join("\n");
    const { problems, warnings } = checkScript(script);
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ line: 4, againLine: 8 });
  });

  it("a misspelled marker with a direction on it is still a stray line", () => {
    expect(
      checkScript("Welcome back.\n[warmly] === START CTA ===\nThe book is below.")
        .problems
    ).toMatchObject([{ kind: "note", line: 2 }]);
  });
});

describe("the generate route runs the check", () => {
  it("refuses on scriptRefusal(checkScript(input.script)) inside generate", () => {
    const routers = readFileSync(
      path.resolve(import.meta.dirname, "../server/routers.ts"),
      "utf8"
    );
    const start = routers.indexOf("generate: approvedProcedure");
    const end = routers.indexOf("getChannelLayer(input.channelKey)", start);
    expect(start).toBeGreaterThan(0);
    expect(routers.slice(start, end)).toContain(
      "scriptRefusal(checkScript(input.script))"
    );
  });
});

describe("a line under the big QR card that puts the code somewhere else (job 409 scene 37)", () => {
  // Job 409's real close (the Gideon Grant practice script, scripts/stress/scripts): the card went
  // big and centred on the scan sentence, which sends the viewer to "the corner of the screen".
  const CLOSE_409 = [
    "So which door are you holding open?", // 1
    "===START CTA(The Stoic Way)===", // 2
    "Some of you are already a page ahead of me, wondering where all of this lives in one place. The thinking belongs to Seneca and the Stoics after him; my work was gathering it into a digital book called The Stoic Way — a hundred and one lessons on money, grief, people, and more.", // 3
    "", // 4
    "Chapter twelve stands on today’s exact ground — time, legacy, and what the remaining years are for. Getting there is one small motion: lift your phone toward the pattern in the corner of the screen and tap what rises, or find the first line of the description below. No timer on this — a lesson about hurry is a poor place to hurry you.", // 5
    "", // 6
    "Now, back to that door you have been holding open.", // 7
    "===END CTA===", // 8
  ];
  const block = (...lines: string[]) =>
    [
      "Today, three small projects from one board.",
      "===START CTA===",
      ...lines,
      "===END CTA===",
    ].join("\n");
  const placements = (script: string) =>
    checkScript(script).warnings.filter(w => w.kind === "placement");

  it("warns, naming the line and the words — never refuses", () => {
    const check = checkScript(CLOSE_409.join("\n"));
    expect(check.problems).toEqual([]);
    expect(scriptRefusal(check)).toBeNull();
    expect(check.warnings).toHaveLength(1);
    expect(check.warnings[0]).toMatchObject({
      kind: "placement",
      line: 5,
      ctaBlock: 0,
      place: "the corner of the screen",
    });
    expect(check.warnings[0].message).toMatch(
      /^Line 5 says the code is at "the corner of the screen", but from the scan line to the end of the call to action it is the big card in the middle of the screen: "Getting there is one small motion: lift your phone toward the pattern in the corner/
    );
    expect(check.warnings[0].message).toContain('Say "on your screen" instead');
    expect(ctaPlacementWarnings(CLOSE_409.join("\n"))).toEqual(check.warnings);
  });

  it("says nothing about the real scan lines that place the code where the card is", () => {
    // Every other scan line in the local practice scripts and jobs: "on your screen", "up on your
    // screen", the description "below" or "at the top", and the phone's own link bar (job 223).
    for (const line of [
      "If you would rather have it in your hand than scattered across videos, you can find The Old Way Home at the link below, or scan the code on your screen.",
      "The QR code is up on your screen right now, and the link sits at the top of the description if that's easier.",
      "Just point your camera at the little square code up on your screen there and it'll carry you right to it, and the link's down under the video too if that suits you better.",
      "Look to the code on your screen and hold your camera steady upon it a moment, and it'll carry you right to the book, and the link is down below the video too if that's easier for you.",
      "That code is right there on your screen, so just point your camera at it and let it carry you on over, or the link's sitting at the top of the description if that's easier on you.",
      "Point your phone at the code. A little bar slides up along the top of your screen.",
      "Lift your phone, point it like you're taking a picture of the screen, and wait for the bar to slide in along the top.",
      "The checkered code is on your screen, or you'll find the link in the description below.",
      "Hold your phone up to the screen with its camera on, and aim it at the little black and white code. Or look underneath this video, open the description, and tap the link at the top.",
      "Aim your phone’s camera at the code on your screen, hold steady, and tap the message that appears, or the first line of the description under this video goes to the same place.",
      "You'll find it at the top of the description, and the code is on the screen if your phone is close by.",
      "Phone at the code on the screen, or the first link under the video.",
      "If you want it, point your phone camera at the square on the screen and touch the bar that comes up, or use the first link under this video.",
      "To get it, use the link in the description below this video.",
      "Point your camera at the code in the middle of the screen.",
    ])
      expect(placements(block(line)), line).toEqual([]);
  });

  it("reads the window as the pipeline does: before the trigger line the small corner card is right", () => {
    const before =
      "You'll see the little code down in the bottom right corner the whole time I talk.";
    expect(
      placements(
        block(
          before,
          "Now go ahead and grab your phone and point it at the code on your screen."
        )
      )
    ).toEqual([]);
    // The same words AFTER the trigger are spoken under the big card.
    expect(
      placements(block("Now go ahead and grab your phone.", before)).map(
        w => w.place
      )
    ).toEqual(["the bottom right corner"]);
  });

  it("only reads marked blocks, and numbers them the way the pipeline does", () => {
    const corner = "Point your phone at the code in the corner of your screen.";
    expect(placements(`Today, three projects.\n${corner}`)).toEqual([]);
    const script = [
      "Today, three small projects from one board.",
      "===START CTA===",
      "===END CTA===", // empty: not a block to the pipeline either
      "===START CTA===",
      "The plans are in a short book. Scan the code on your screen.",
      "===END CTA===",
      "Next, the shelf.",
      "===START CTA===",
      "The book again, for anyone who just joined us.",
      corner, // line 10
      "===END CTA===",
    ].join("\n");
    expect(placements(script).map(w => [w.ctaBlock, w.line])).toEqual([
      [1, 10],
    ]);
  });

  it("names the line the place words are on when a sentence runs over two lines", () => {
    const w = placements(
      block(
        "Now go ahead and grab your phone and point it",
        "at the square at the top of your screen."
      )
    );
    expect(w.map(x => [x.line, x.place])).toEqual([[4, "top of your screen"]]);
  });
});

describe("misplacedCodeWords", () => {
  it.each([
    [
      "lift your phone toward the pattern in the corner of the screen and tap what rises",
      "the corner of the screen",
    ],
    [
      "Point your phone at the code in the bottom right corner.",
      "the bottom right corner",
    ],
    ["The code's at the top of your screen.", "top of your screen"],
    [
      "Aim it at the square on the right side of the screen.",
      "right side of the screen",
    ],
    ["Scan the QR code down in the lower-left.", "lower-left"],
    ["Hold your camera up to the top-right corner.", "the top-right corner"],
    [
      "Up in the top corner of the screen, you'll see a little square code.",
      "the top corner of the screen",
    ],
    [
      "There's a black and white box on the left-hand side.",
      "left-hand side",
    ],
  ])("%s → %s", (sentence, place) => {
    expect(misplacedCodeWords(sentence)?.place).toBe(place);
  });

  it.each([
    // Where the card really is, or the description's link.
    "Scan the code on your screen.",
    "The code is up on your screen right now.",
    "Point your camera at the code in the middle of the screen.",
    "Or tap the first link in the description below.",
    "The link sits at the top of the description.",
    "The link is at the top of the video description.",
    // The phone's own link bar, never the code.
    "A little bar slides up along the top of your screen.",
    "Tap the link that pops up in the corner.",
    "Point your phone at the code and tap the bar at the top of your phone's screen.",
    // A corner that is not a place on the screen.
    "Scan the code before the season comes around the corner.",
    "Aim the camera at the corner of your porch so you see who knocks.",
    "Every corner I trimmed off those squares went into the coffee can too.",
    "Sew corner to corner across that square, so an X sits inside the box.",
    "Mine is worked from one corner out to a square.",
  ])("%s → nothing", sentence => {
    expect(misplacedCodeWords(sentence)).toBeNull();
  });

  it("stays fast on a long sentence", () => {
    const long =
      "hold your phone up to the code on the right of the box and the top of the bench ".repeat(
        300
      );
    const t0 = Date.now();
    misplacedCodeWords(long);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
