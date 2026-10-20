/**
 * shared/sentenceEnds.ts
 *
 * A FULL STOP THAT ENDS NO SENTENCE (2026-10-20, job 417 scenes 16-17). The script spelt "U. S."
 * with a space, and the storyboard's sentence splitter took the lone capital "U." for a sentence
 * end: the line was cut "Number one. The whole can. On a lot of U." | "S. airlines, the flight
 * attendant pours your soda…", and the cut landed inside the one spoken word "U.S." (heard
 * 58.78-59.06, no gap inside it to snap to) — a real render's lip-synced host take stops mid-word.
 * Every splitter and sentence-end test that cuts beats, pictures or host takes had its own idea of
 * which full stops count ("St.", "Mr.", "etc." were kept out in two places, nothing knew an
 * initial), so this is the ONE answer they all ask.
 *
 * Merging two sentences costs at most one cut point a sentence end would have offered; cutting at
 * an initial cuts a word in two. So when in doubt a full stop is NOT a sentence end — "Plan B. Then…"
 * reads as one sentence. Two kinds of capital letter still end one: "I." ("…and so did I."), and a
 * letter said AS a letter, a shape or a mark, after a word in lower case and before a new sentence
 * ("…crosses over itself in a small X. Snug, but…", "…the bottom of the V. Every round…" — the only
 * single capitals the 357 stored scripts end a sentence on, 5 times, while the 8 "U. S." of four
 * scripts were each cut in two). Pure.
 */

/** Short forms written with a capital ("Dr. Hale", "St. Louis", "Acme Co. and"): never "rep." or "hon." said lowercase. */
const TITLES = new Set([
  "Mr", "Mrs", "Ms", "Mx", "Dr", "St", "Mt", "Ft", "Jr", "Sr", "Prof", "Rev", "Fr", "Lt", "Capt",
  "Gen", "Sgt", "Col", "Gov", "Sen", "Rep", "Hon", "Ave", "Rd", "Blvd", "Inc", "Co", "Ltd", "Corp",
  "Bros", "Fig",
]);
/** Short forms written in lower case ("saws, drills, etc. and", "us vs. them", "approx. two"). */
const LOWER_FORMS = new Set(["vs", "etc", "approx", "cf", "incl"]);
/** What may close a sentence after its stop, and open a word before it. */
const CLOSERS = /["'”’)\]]+$/;
const OPENERS = /^[("'“‘[]+/;

/**
 * Whether `word` — one whitespace-separated word of a script or a transcript — ends on a full stop
 * that belongs to the word, not to a sentence: an initial ("U." of "U. S.", "F." of "John F.
 * Kennedy"), letters joined by full stops ("U.S.", "U.K.", "e.g.", "a.m.", "p.m.", "Ph.D."), a
 * title or a place's short form ("Dr.", "Mrs.", "St.", "Co."), "vs.", "etc.", "approx.", and "No."
 * before a number ("No. 5"; "No." the answer still ends its sentence). `next` and `prev` are the
 * words either side of it, when known. A "!", a "?" or an ellipsis is never a short form. Only a
 * LETTER is judged by a lower-case word after it: scripts and tests write whole sentences in lower
 * case ("…we rake the dry leaves. the second sentence…"), so a word's full stop before one still
 * ends its sentence. Pure.
 */
export function isAbbreviationStop(
  word: string | undefined,
  next?: string,
  prev?: string
): boolean {
  const core = (word ?? "").trim().replace(CLOSERS, "").replace(OPENERS, "");
  // Exactly one full stop at the end: "…" and "..." trail off, "?" and "!" end the sentence.
  if (!/[^.]\.$/.test(core)) return false;
  const body = core.slice(0, -1);
  const after = (next ?? "").trim().replace(OPENERS, "");
  if (/^[A-Za-z]$/.test(body)) {
    // Before another letter ("U. S.", "a. m.", "J. R. R.") or a word in lower case ("S. airlines")
    // a letter is part of one word or a name, whatever its case.
    if (/^[A-Za-z]\.$/.test(after.replace(CLOSERS, "")) || /^[a-z]/.test(after)) return true;
    // A lower-case letter on its own ends a sentence ("…plan a."), and so does "I.".
    if (!/^[A-Z]$/.test(body) || body === "I") return false;
    // A capital after a word in lower case and before a new sentence is a letter said as one ("…in
    // a small X. Snug"). With nothing known after it, after a capitalised word ("John F. Kennedy",
    // "Plan B.") or with nothing before it, it is an initial.
    const before = (prev ?? "").trim().replace(OPENERS, "");
    return !(after && /^[a-z]/.test(before));
  }
  if (/^[A-Za-z]{1,3}(?:\.[A-Za-z]{1,3})+$/.test(body)) return true;
  if (TITLES.has(body) || LOWER_FORMS.has(body.toLowerCase())) return true;
  if (/^no$/i.test(body)) return /^[#(]?\d/.test(after);
  return false;
}

/** Whether a text's last word ends on such a full stop (`isAbbreviationStop`). Pure. */
export function endsOnAbbreviation(text: string | undefined, next?: string): boolean {
  const words = (text ?? "").trim().split(/\s+/);
  return isAbbreviationStop(words[words.length - 1], firstWord(next), words[words.length - 2]);
}

/**
 * Whether the break that ends at offset `end` of `text` — anywhere in the stop's own closing quotes
 * and the space after them, or right after the stop — follows a full stop that ends no sentence.
 * Asked of a splitter's match (`m.index + m[0].length`, or the space a look-behind split cut on). Pure.
 */
export function abbreviationBreakAt(text: string, end: number): boolean {
  let k = Math.min(end, text.length) - 1;
  while (k >= 0 && /\s/.test(text[k])) k--;
  while (k >= 0 && /["'”’)\]]/.test(text[k])) k--;
  if (k < 0 || text[k] !== ".") return false;
  let from = k;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  let to = k + 1;
  while (to < text.length && !/\s/.test(text[to])) to++;
  const prev = /(\S+)\s*$/.exec(text.slice(0, from))?.[1];
  return isAbbreviationStop(text.slice(from, to), firstWord(text.slice(to)), prev);
}

/**
 * Whether a cut where a word starts (offset `at`) would fall between the letters of ONE spoken word
 * spelt as initials with spaces: "U. | S. airlines", "6 a. | m.", "J. | R. R.". The voice says
 * "U.S." in one breath and the transcript hears one word, so there is no gap to cut in — any
 * cutter that picks its own words (the shot list's `from`, the line check's splits) refuses it,
 * as the sentence splitters refuse the full stop. Pure.
 */
export function splitsInitials(text: string, at: number): boolean {
  const before = /(\S+)\s+$/.exec(text.slice(0, at))?.[1];
  const word = /^\S+/.exec(text.slice(at))?.[0];
  const bare = (w: string) => w.replace(CLOSERS, "").replace(OPENERS, "");
  return !!before && !!word && /^[A-Za-z]\.$/.test(bare(before)) && /^[A-Za-z]\./.test(bare(word));
}

/**
 * Pieces a sentence splitter cut, put back together where a cut followed a full stop that ends no
 * sentence ("On a lot of U." + "S. airlines…" → one). Joined with one space, as splitters that
 * collapse whitespace first produce them. Pure — returns a new list.
 */
export function rejoinAbbreviations(pieces: string[]): string[] {
  const out: string[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    if (prev !== undefined && endsOnAbbreviation(prev, p)) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
}

/** The first whitespace-separated word of a text. */
function firstWord(text: string | undefined): string | undefined {
  return /\S+/.exec(text ?? "")?.[0];
}
