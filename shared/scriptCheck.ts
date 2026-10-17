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
 * Pure string work — bundles into the client for free.
 */
import { CTA_END_LINE, CTA_START_LINE, spokenScriptLines } from "./ctaMarkers";
import { stripVoiceDirections } from "./voiceDirections";

export interface ScriptIssue {
  kind: "note" | "repeat";
  /** 1-based line in the script as pasted (a repeat: where its first copy starts). */
  line: number;
  /** A repeat: the line its second copy starts on. */
  againLine?: number;
  /** A repeat: how many words are said twice. */
  words?: number;
  /** A note: the line itself. A repeat: its first words. */
  text: string;
  /** One sentence for the operator. */
  message: string;
}

export interface ScriptCheck {
  /** What the router refuses on. */
  problems: ScriptIssue[];
  /** Shown before Generate and never refused: a pitch said again in another CTA block. */
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

/** The check, on the script as pasted. Pure — unit-tested. */
export function checkScript(raw: string): ScriptCheck {
  const notes: ScriptIssue[] = [];
  const words: Word[] = [];
  let inCta = false;
  for (const { line, text } of spokenScriptLines(raw)) {
    // Directions come off BEFORE the marker test, in the order `parseCtaMarkers` does it: there
    // "[laughs] ===END CTA===" is a marker, so here it must not be a stray "===" note (refusing a
    // script the voice would read correctly) nor leave the words after it counted as in a block.
    const clean = stripVoiceDirections(text).trim();
    if (CTA_START_LINE.test(clean)) {
      inCta = true;
      continue;
    }
    if (CTA_END_LINE.test(clean)) {
      inCta = false;
      continue;
    }
    if (!clean) continue;
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
  return { problems: [...notes, ...repeats], warnings };
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
