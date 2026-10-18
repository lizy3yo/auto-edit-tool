/**
 * shared/scriptCheck.ts
 *
 * ONLY NARRATION MAY BE VOICED (2026-10-18). The generate route checked a script's length and its
 * CTA-marker pairing and nothing else, and `extractSpokenScript` drops only text outside an
 * explicit `=== SCRIPT === … === END SCRIPT ===` frame or a LEADING template preamble — so
 * anything else pasted into the box is read aloud. Production jobs 204 and 205 were pasted
 * straight from the script writer's output: the script, then its QA notes ("VERDICT: PASS",
 * "HOUSE FORMAT: …", "ROTATION LOG ENTRY: …", "VO COPY — ELEVENLABS V4"), then the whole script
 * AGAIN with voice directions in it — 2,843 and 3,408 words said twice, about half of each film,
 * every clip of it paid for.
 *
 * `checkScript` reads exactly the text the voice reads — the spoken portion, CTA marker lines and
 * voice directions removed, what `stripCtaMarkerLines(extractSpokenScript(raw))` returns — and
 * names each problem by its line in the script AS PASTED. The router refuses on `problems`
 * (`scriptRefusal`), and the generate dialog runs the same check before the click, so the two
 * cannot disagree.
 *
 * It also WARNS — never refuses — when a line spoken under the big QR card says the code is
 * somewhere else (`placementIssues`, 2026-10-18): job 409 said "lift your phone toward the pattern
 * in the corner of the screen" five seconds after the card had gone big and centred.
 *
 * Pure string work — bundles into the client for free.
 */
import { CTA_END_LINE, CTA_START_LINE, spokenScriptLines } from "./ctaMarkers";
import { scanWindowStart } from "./scanIntent";
import { stripVoiceDirections } from "./voiceDirections";

export interface ScriptIssue {
  kind: "note" | "repeat" | "placement";
  /** 1-based line in the script as pasted (a repeat: where its first copy starts). */
  line: number;
  /** A repeat: the line its second copy starts on. */
  againLine?: number;
  /** A repeat: how many words are said twice. */
  words?: number;
  /** A note: the line itself. A repeat: its first words. A placement: the sentence. */
  text: string;
  /** A placement: which marked CTA block, counted from 0 the way the pipeline numbers them
   *  (`StoryboardScene.ctaIndex` — empty blocks are not counted). */
  ctaBlock?: number;
  /** A placement: the words that put the code somewhere ("the corner of the screen"). */
  place?: string;
  /** One sentence for the operator. */
  message: string;
}

export interface ScriptCheck {
  /** What the router refuses on. */
  problems: ScriptIssue[];
  /** Shown before Generate and never refused: a pitch said again in another CTA block, or a line
   *  under the big QR card that puts the code somewhere else. */
  warnings: ScriptIssue[];
}

/**
 * A passage this long said twice is a paste error, never writing: across ~180 real scripts the
 * longest legitimate repeat is 17 words, and a script pasted twice repeats thousands. An absolute
 * floor only — a share-of-script rule fired on a 94-word developer test (job 93, 35 words of the
 * opening re-pasted into its CTA block) and adds nothing for a whole second copy.
 */
export const REPEAT_MIN_WORDS = 60;
/** Words per shingle: a repeat is found where twelve words in a row come again. */
const SHINGLE = 12;

// A note's optional lead-in: a bullet, quote mark or heading hash.
const LEAD = String.raw`(?:[#*>•\-–—]+\s*)?`;
/** "VERDICT: PASS", "HOUSE FORMAT: …", "ROTATION LOG ENTRY: …" — a label in capitals and a colon. */
const CAPS_LABEL = new RegExp(
  `^${LEAD}([A-Z][A-Z0-9&/'’().\\- ]{0,38}[A-Z0-9)])\\s*:`
);
/**
 * Labels a script writer's output carries and narration never opens a line with. Matched in any
 * case, but only with a colon and on a short line that does not end like a sentence ("Title: The
 * Truth About Black Cats", "Word count: 2,450"). Everyday words a script SAYS with a colon are
 * left out — "Hook: 5 mm" in a crochet materials line, "Verdict: worth it" in a review, "Notes:
 * vanilla and oak" in a tasting — and count only in capitals, which `CAPS_LABEL` already catches.
 */
const PRODUCTION_LABEL = new RegExp(
  `^${LEAD}(?:word count|run ?time|read(?:ing)? time|qa|checklist|thumbnail|tags|version|draft|status|scene \\d+|b-?roll|on-?screen text|vo copy|voice-?over|narrator|host|title)\\s*:`,
  "i"
);
const PRODUCTION_LABEL_MAX_WORDS = 12;
/** A misspelled or unpaired marker ("=== START CTA ===", "=== END SCRIPT ===" with no start) is voiced. */
const STRAY_MARKER = /^={2,}.*={2,}$/;
const MARKDOWN = /^(?:#{1,6}\s|\*\*[^*]+\*\*:?$|-{3,}$|_{3,}$|\*{3,}$|\|.*\|$)/;
/** Ends like a sentence — a shouted line ("STOP RIGHT THERE!") is narration, a heading is not. */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/**
 * Why one spoken line (directions removed, trimmed) is a note rather than narration, or null.
 * Exported for the tests.
 */
export function noteLineReason(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  if (STRAY_MARKER.test(t))
    return "an === line that is not a CTA or SCRIPT marker";
  if (MARKDOWN.test(t)) return "formatting, not speech";
  const label = CAPS_LABEL.exec(t);
  if (label && /[A-Z].*[A-Z]/.test(label[1])) return "a label in capitals";
  const letters = t.match(/[A-Za-zÀ-ɏ]/g)?.length ?? 0; // Latin, accented included
  if (
    letters >= 6 &&
    t === t.toUpperCase() &&
    t.split(/\s+/).length >= 2 &&
    !SENTENCE_END.test(t)
  )
    return "a heading in capitals";
  if (
    PRODUCTION_LABEL.test(t) &&
    t.split(/\s+/).length <= PRODUCTION_LABEL_MAX_WORDS &&
    !SENTENCE_END.test(t)
  )
    return "a production label";
  return null;
}

interface Word {
  key: string;
  word: string;
  line: number;
  inCta: boolean;
}

/**
 * A word as compared: lower case, curly apostrophe straightened, punctuation gone (Latin letters,
 * accented included), so "sunset," and "sunset" are one word. Voice directions are gone before
 * this (`stripVoiceDirections`), so job 204's second copy, which carried "[warm]" and
 * "[matter-of-fact]" where the first did not, still reads as the same words.
 */
function wordKey(w: string): string {
  return w
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9À-ɏ']/g, "");
}

/**
 * Every passage said twice, found where twelve words in a row come again, then grown word by word
 * as far as both copies agree. The copies never overlap: a chant ("round and round and round…")
 * that runs into itself is not a passage said twice.
 */
function repeatedPassages(
  words: Word[]
): Array<{ at: number; again: number; n: number }> {
  const first = new Map<string, number>();
  const out: Array<{ at: number; again: number; n: number }> = [];
  for (let i = 0; i + SHINGLE <= words.length; i++) {
    const key = words
      .slice(i, i + SHINGLE)
      .map(w => w.key)
      .join(" ");
    const f = first.get(key);
    if (f === undefined) {
      first.set(key, i);
      continue;
    }
    if (i - f < SHINGLE) continue;
    let n = SHINGLE;
    while (
      i + n < words.length &&
      f + n < i &&
      words[f + n].key === words[i + n].key
    )
      n++;
    out.push({ at: f, again: i, n });
    i += n - 1; // the rest of this copy is already in `first` as the earlier one
  }
  return out;
}

const clip = (s: string, max = 90) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
const count = (n: number) => n.toLocaleString("en-US");

// ── Where the code is said to be, under the big card ─────────────────────────────────────────
// From a marked block's scan line to ===END CTA=== the code is ONE big card in the middle of the
// screen (`markCtaQrBlock`, the operator's fixed layout); before it, a small card in the corner.
// Nothing compared what the script SAYS about where the code is with that: job 409 (scene 37) went
// big and centred on "lift your phone toward the pattern in the corner of the screen", and the
// viewer was sent to a corner holding nothing. A script cannot be re-worded once voiced, so it is
// caught here, before Generate, and only warned about — the line still reads, just against the
// picture.

/** Which way along the edge of the frame: "top", "bottom-right", "lower left-hand". */
const EDGE_WAY = String.raw`(?:top|bottom|upper|lower|left|right|far)(?:[- ]hand)?`;
/** The film's own screen — never the description ("the top of the description", "the top of the
 *  video description"), never the phone's ("the top of your phone's screen" is where the link a
 *  scan brings up slides in). */
const FILM_SCREEN = String.raw`(?:your|the|this|my) (?:tv |television )?(?:screen|video|frame|picture)\b(?!['’]s|\s+description)`;
/**
 * Words that put the code somewhere the big card is not. Never "on your screen", "in the middle",
 * "up on the screen", "below" or "under this video" — those are where the card is, or where the
 * description's link is.
 */
const MISPLACED = new RegExp(
  [
    // "in the corner", "the bottom right corner", "the corner of your screen" — a place, so with
    // "the": never a quilter's "corner to corner" or "every corner I trimmed", never the corner of
    // something else ("the corner of the bench"). "Around the corner" is dropped by the caller.
    String.raw`\b(?:the|that|this|your)\s+(?:${EDGE_WAY}[\s-]+){0,2}corners?\b(?:\s+of\s+${FILM_SCREEN})?(?!\s+of\b)`,
    // "the bottom right", "lower-left", "top left-hand"
    String.raw`\b(?:top|bottom|upper|lower)[\s-]+(?:right|left)(?:[- ]hand)?\b`,
    // "the top of the screen", "the right side of your screen", "the bottom edge of the video"
    String.raw`\b(?:${EDGE_WAY}[\s-]+(?:side|edge|half)|top|bottom|side|edge|left|right)\s+of\s+${FILM_SCREEN}`,
    // "on the right side", "the left-hand edge"
    String.raw`\b(?:far[\s-]+)?(?:left|right)(?:[- ]hand)?[\s-]+(?:side|edge)\b`,
  ].join("|"),
  "gi"
);
/** "the holidays are just around the corner" — a time, not a place on the screen. */
const AROUND_BEFORE = /\ba?round\s+$/i;
/** What a placement must be ABOUT: the code (a scan line calls it a code, a square, a pattern), or
 *  a phone or camera aimed there. "A little bar slides up along the top of your screen" is the
 *  phone's own link bar (job 223), never the code. */
const NAMES_CODE = /\b(?:qr|codes?|squares?|patterns?|box)\b/i;
const AIMS_THERE =
  /\b(?:hold|lift|raise|point|aim|tilt|bring|hover)\b.*\b(?:phone|camera|smartphone|it)\b|\b(?:phone|camera|smartphone)\b.*\b(?:point|aim)\b/i;
/** Where one part of a sentence ends and the next begins: "…the corner of the screen and tap what
 *  rises, or find the first line of the description below" is three parts. */
const CLAUSE_BREAK =
  /[,;:()—–]|\s-\s|\b(?:and|or|but|then|so|while|because|when|until|if)\b/gi;
/** A part that is only a place, said first: "Down in the corner of the screen, there's a code". */
const LEADING_PLACE =
  /^\s*(?:(?:down|up|over|right|just|there)\s+)*(?:in|at|on|along|near|by|toward|towards|to)\b/i;

/** Split one block's text into sentences with their offsets, the way the pipeline backs up to a
 *  sentence start (". ", "! ", "? "). */
function sentencesOf(text: string): Array<{ at: number; text: string }> {
  const out: Array<{ at: number; text: string }> = [];
  const end = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
  let from = 0;
  for (let m = end.exec(text); m; m = end.exec(text)) {
    const to = m.index + m[0].length;
    if (text.slice(from, to).trim())
      out.push({ at: from, text: text.slice(from, to) });
    from = to;
  }
  if (text.slice(from).trim()) out.push({ at: from, text: text.slice(from) });
  return out;
}

/**
 * The words in one sentence that put the code somewhere the big card is not, and where they start
 * in it — or null. The place counts only in a part of the sentence that is about the code, or,
 * when that part is only the place said first, in the part right after it. Exported for the tests.
 */
export function misplacedCodeWords(
  sentence: string
): { place: string; at: number } | null {
  // "black and white" is one word here, not two parts (same length, so offsets hold).
  const text = sentence.replace(/\bblack and white\b/gi, "black-and-white");
  const parts: Array<{ at: number; text: string }> = [];
  let from = 0;
  for (const m of Array.from(text.matchAll(CLAUSE_BREAK))) {
    parts.push({ at: from, text: text.slice(from, m.index) });
    from = m.index! + m[0].length;
  }
  parts.push({ at: from, text: text.slice(from) });
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].text;
    const m = Array.from(p.matchAll(MISPLACED)).find(
      hit => !AROUND_BEFORE.test(p.slice(0, hit.index))
    );
    if (!m || m.index === undefined) continue;
    if (
      NAMES_CODE.test(p) ||
      AIMS_THERE.test(p) ||
      (LEADING_PLACE.test(p) && NAMES_CODE.test(parts[i + 1]?.text ?? ""))
    )
      return {
        place: m[0].replace(/\s+/g, " ").trim(),
        at: parts[i].at + m.index,
      };
  }
  return null;
}

/**
 * Every line, inside a marked block's scan window (`scanWindowStart` — the sentence the big card
 * starts on, through ===END CTA===), that says the code is somewhere it is not. `blocks` are the
 * marked blocks' non-blank lines, numbered as the pipeline numbers them. A block with no scan line
 * is left alone: the card then takes only its last line or two, and no line there says "scan".
 */
function placementIssues(
  blocks: Array<Array<{ line: number; text: string }>>
): ScriptIssue[] {
  const out: ScriptIssue[] = [];
  blocks.forEach((lines, ctaBlock) => {
    const starts: number[] = [];
    let text = "";
    for (const l of lines) {
      if (text) text += "\n";
      starts.push(text.length);
      text += l.text;
    }
    const lineAt = (offset: number) => {
      let k = 0;
      while (k + 1 < starts.length && starts[k + 1] <= offset) k++;
      return lines[k].line;
    };
    const sentences = sentencesOf(text);
    const first = scanWindowStart(sentences.map(s => s.text));
    if (first < 0) return;
    for (const s of sentences.slice(first)) {
      const found = misplacedCodeWords(s.text);
      if (!found) continue;
      const { place } = found;
      const sentence = s.text.replace(/\s+/g, " ").trim();
      const line = lineAt(s.at + found.at); // where the place words sit
      out.push({
        kind: "placement",
        line,
        text: sentence,
        ctaBlock,
        place,
        message: `Line ${line} says the code is at "${place}", but from the scan line to the end of the call to action it is the big card in the middle of the screen: "${clip(sentence)}". Say "on your screen" instead — the line is read as written.`,
      });
    }
  });
  return out;
}

/** The check, on the script as pasted. Pure — unit-tested. */
export function checkScript(raw: string): ScriptCheck {
  const notes: ScriptIssue[] = [];
  const words: Word[] = [];
  const blocks: Array<Array<{ line: number; text: string }>> = [];
  let block: Array<{ line: number; text: string }> | null = null;
  let inCta = false;
  for (const { line, text } of spokenScriptLines(raw)) {
    // Directions come off BEFORE the marker test, in the order `parseCtaMarkers` does it: there
    // "[laughs] ===END CTA===" is a marker, so here it must not be a stray "===" note (refusing a
    // script the voice would read correctly) nor leave the words after it counted as in a block.
    const clean = stripVoiceDirections(text).trim();
    if (CTA_START_LINE.test(clean)) {
      inCta = true;
      block ??= [];
      continue;
    }
    if (CTA_END_LINE.test(clean)) {
      inCta = false;
      // Numbered like `parseCtaMarkers`' spans: a block with nothing to say is not counted.
      if (block?.length) blocks.push(block);
      block = null;
      continue;
    }
    if (!clean) continue;
    block?.push({ line, text: clean });
    const why = noteLineReason(clean);
    if (why)
      notes.push({
        kind: "note",
        line,
        text: clean,
        message: `Line ${line} is a note, not narration (${why}): "${clip(clean)}".`,
      });
    for (const word of clean.split(/\s+/)) {
      const key = wordKey(word);
      if (key) words.push({ key, word, line, inCta });
    }
  }

  const repeats: ScriptIssue[] = [];
  const warnings: ScriptIssue[] = [];
  for (const { at, again, n } of repeatedPassages(words)) {
    if (n < REPEAT_MIN_WORDS) continue;
    // A pitch reused word for word in the mid-roll and the close is a template's choice, not a
    // paste error: only the stretch where BOTH copies sit inside CTA blocks is let through.
    let run = 0;
    let outside = 0;
    for (let k = 0; k < n; k++) {
      if (words[at + k].inCta && words[again + k].inCta) run = 0;
      else outside = Math.max(outside, ++run);
    }
    // Its first words, always followed by "…" in the message.
    const sample = words
      .slice(at, at + 10)
      .map(w => w.word)
      .join(" ")
      .slice(0, 70)
      .trimEnd();
    const line = words[at].line;
    const againLine = words[again].line;
    const issue = {
      kind: "repeat" as const,
      line,
      againLine,
      words: n,
      text: sample,
    };
    if (outside >= REPEAT_MIN_WORDS)
      repeats.push({
        ...issue,
        message: `The same ${count(n)} words are said twice, from line ${line} and again from line ${againLine}: "${sample}…". Remove one copy.`,
      });
    else
      warnings.push({
        ...issue,
        message: `Two call-to-action blocks say the same ${count(n)} words (lines ${line} and ${againLine}): "${sample}…". Fine if you meant it — it is read both times.`,
      });
  }
  repeats.sort((a, b) => (b.words ?? 0) - (a.words ?? 0));
  warnings.push(...placementIssues(blocks));
  return { problems: [...notes, ...repeats], warnings };
}

/**
 * The placement warnings alone, for the voicing stage to record on the job (the same lines, the
 * same words, as the Generate dialog showed). Pure.
 */
export function ctaPlacementWarnings(raw: string): ScriptIssue[] {
  return checkScript(raw).warnings.filter(w => w.kind === "placement");
}

/** How notes can stay in the box: outside the frame, nothing is voiced. */
export const SCRIPT_FRAME_TIP =
  "Delete them, or put the narration between === SCRIPT === and === END SCRIPT === lines and keep notes outside.";
const NOTES_SHOWN = 3;

/** The router's refusal, naming the lines — or null when the script is all narration. */
export function scriptRefusal(check: ScriptCheck): string | null {
  if (!check.problems.length) return null;
  const notes = check.problems.filter(p => p.kind === "note");
  const repeats = check.problems.filter(p => p.kind === "repeat");
  const parts = ["Only narration can be voiced."];
  parts.push(...notes.slice(0, NOTES_SHOWN).map(p => p.message));
  if (notes.length > NOTES_SHOWN)
    parts.push(
      `…and ${notes.length - NOTES_SHOWN} more line${notes.length - NOTES_SHOWN === 1 ? "" : "s"} like these.`
    );
  if (notes.length) parts.push(SCRIPT_FRAME_TIP);
  parts.push(...repeats.slice(0, 2).map(p => p.message));
  return parts.join(" ");
}
