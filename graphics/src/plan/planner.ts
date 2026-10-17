// The graphics PLANNER — one copy, used by the app's finishing step (server/graphics) and by the
// lab (graphics-lab/scripts/plan.mts). One model call reads the finished film's script and layout
// and writes the cue sheet: which graphic goes on which words.
//
// GENERAL RULES, for any channel and any script: every graphic type has ONE condition, written in
// terms of what a line DOES (compares two things, says a number, gives steps, corrects a belief…),
// never its topic. Whenever a line meets a condition, that graphic is placed — as many times as the
// script allows; there is no quota per type. The only limits are placement rules every graphic
// shares (./rules.ts): words the narrator says, nothing over the host's face or in the call to
// action, cards over b-roll only, a second between graphics, and readable text (measured on the
// real frames when the graphics are laid on the film).
//
// What the model writes is never trusted: every cue is resolved against the real word times, held
// to the rules, and every number it shows must be a number the narrator says; anything that fails
// goes back for ONE repair round, and whatever still fails is dropped.
//
// SAVED GRAPHICS are never lost: `kept` (a film's approved cue sheet) is placed first, as a fixed
// base, never dropped by a rule added after it was approved; a new graphic only joins where it adds
// no conflict with anything placed.
//
// Pure apart from the two things it is handed: `ask` (the model call — metered by the app) and
// `ensureIcon` (makes an emoji's image available).
import { CueError, MIN_ON_SCREEN_SEC, findPhrase, findVerbatim, indexWords, parseSpokenNumber, resolveCues, tokens, tooShortToRead, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
import { TEMPLATES, templateById } from "../registry";
import { FPS } from "../theme";
import { MIN_GAP_SEC, checkRules, nameTagRange, type FilmLayout, type LayoutScene } from "./rules";

/** The longest a graphic may sit still between one of its words and the next (Hank's job 382: a
 * number graphic opened on "But the one I was proudest of" and waited 9 s for the number). */
export const MAX_WAIT_SEC = 5;

/** Noto Color Emoji (Apache-2.0), pinned: the image of an emoji, by its code points. */
export const NOTO_PNG = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512";

/** Noto names a file by its code points, lower-case hex joined by "_", without FE0F. */
export function notoCode(icon: string): string {
  if (/^[0-9a-f]{4,6}(_[0-9a-f]{4,6})*$/i.test(icon)) return icon.toLowerCase();
  return Array.from(icon)
    .map(ch => ch.codePointAt(0)!)
    .filter(cp => cp !== 0xfe0f)
    .map(cp => cp.toString(16))
    .join("_");
}

const CATALOGUE = `
HOW PROPS WORK
A "phrase" is {"text": "...", "words": true}: shown word by word as the narrator says each word.
Its words are the narrator's own, WORD FOR WORD and IN A ROW — never leave out a word inside it, never
change or reorder one. It starts where he starts a sentence or a clause (a sentence's opening "So"/"And" may
be left off) and ends where one ends: at a full stop, a comma, a pause, or right before a clause word ("and",
"but", "that", "where", "because"…). Never stop mid-phrase ("…along the front edge" when he goes on "of the
table"). A line may stop right before a number or label the same graphic shows ("That order carries an
extra fee of" + 15 %).
"at": "@words" makes an element appear on those spoken words; "at": 0 makes it appear at the cue start.
Statement, MythTruth, FactCard, YesNoCard, Quote and every caption (HostCaption, DimCaption, ArrowCaption)
show a WHOLE SENTENCE as said — from where the sentence starts to its full stop, never stopped at a comma.
A caption pages a long sentence by itself (8-10 words on screen at a time), so never cut one short to fit;
a sentence longer than a card's limit is shown as a caption instead of that card.
Fixed text (titles, labels, subs, list items) is shown whole. When it stands for words the narrator says,
add "say": "those exact spoken words" beside it, so the graphic stays until they are said.
"emphasis": ["word."] = ONE word of the shown text, copied exactly as written there (with its punctuation),
drawn in the accent colour. "icon" = ONE emoji character (a 3D Noto emoji): a plain, literal object.

EVERY GRAPHIC AND THE MOMENT THAT CALLS FOR IT
Each line below is "Template — appears whenever the script…: props". Use a template EVERY time its
moment happens, as often as the script allows. Nothing here is limited to once.

Full-screen cards — replace the picture, so ONLY inside a b-roll stretch:
- Statement — sums up a point in one short line, or lands a punchline: {"kicker": "2-4 word label", "headline": ONE WHOLE SENTENCE as said (4-12 words), "emphasis"}
- MythTruth — states what people believe, then corrects it: {"myth": ONE WHOLE SENTENCE (≤14 words), "truth": ONE WHOLE SENTENCE (≤14 words), "emphasis"}
- Versus — compares two kinds or options: {"kicker", "left": {"icon","title" (1-3 words),"sub" (≤6 words),"say","at"}, "right": {same}, "winner": "left"|"right"|"none"}
- BigNumber — says a number that matters (a time, an amount, a count): {"kicker", "prefix": "$" (a currency sign, if any), "value": number, "unit": "1-2 words", "at": "@the spoken number", "line": phrase, "countSec": 0.6 for small numbers}. Start it on the sentence that holds the number, not sentences before.
- StepCards — gives 2-4 steps the viewer should do: {"kicker", "steps": [{"text" (≤4 words), "icon", "at": "@words"}]}
- BeforeAfter — an old way or state replaced by a new one: {"kicker", "before": {"icon","label","at"}, "after": {"icon","label","at"}}
- TwoPoint — links two places or things ("the one in the basement sets off the one by your bed"): {"title": phrase, "a": {"label","sub","at"}, "b": {"label","sub","at"}}
- FactCard — states a finding or a general fact ("most…", "studies show…", "the rule is…"): {"kicker": "Fact", "fact": ONE WHOLE SENTENCE (≤14 words), "emphasis", "source": "where it comes from, ONLY if the script says it", "icon"}
- YesNoCard — asks a yes/no question and answers it: {"kicker", "question": ONE WHOLE SENTENCE (≤14 words), "answer": "yes"|"no", "at": "@the spoken answer", "line": phrase (optional, the reason)}

Graphics with the picture in a window — they replace the picture with the footage framed beside text:
- TermWindow — names a term or a word and explains what it means (ONLY over b-roll): {"kicker": "The term", "term": "the term as said", "at": "@the term", "meaning": phrase (≤12 words)}
- ListWindow — lists 2-4 things or signs while the picture matters (ONLY over b-roll): {"title": "2-4 words", "items": [{"text" (≤5 words), "at": "@the item's FIRST spoken words", "say": "the item as said"}]}
- HostListWindow — the HOST lists what is coming or 2-4 points, while on camera (ONLY over a HOST scene, never under the name tag): same props as ListWindow

On top of the footage:
- TitleOverFootage — the video's topic line in its opening, over its first b-roll: {"kicker" (optional), "phrase": phrase (≤10 words), "emphasis"}
- ChapterLabel — the script counts its parts aloud ("first thing…", "second…"): label EVERY counted part (all or none): {"kicker": "Topic · 1 of 3", "number": 1, "title": "1-3 words"}, "durationSec": 4.5 instead of "end"
- StepLabels — describes 2-4 actions in order: {"steps": [{"text" (≤4 words), "at": "@words"}]}
- Checklist — lists 2-4 signs or things to check (each ticked as said) (over b-roll): {"title": "2-4 words", "items": [{"text" (≤5 words), "at": "@words"}]}
- CrossedList — dismisses 2-3 things ("not the bowl, not the house"), optionally then names the real one (over b-roll): {"items": [{"text" (≤3 words), "icon", "at": "@words", "keep": true only for the real one}]}
- WarningLabel — names a danger or a mistake to avoid: {"text": phrase (≤10 words), "emphasis"}
- IconLabels — names 1-3 right things to look for or buy: {"items": [{"icon","text" (1-3 words),"say","at"}]}
- IconCallout — makes one short point that one object says well (over b-roll): {"icon", "phrase": phrase (≤8 words), "emphasis"}
- SmallLabel — names the thing in the picture when the line names it (over b-roll): {"text": "1-4 words as said", "at": "@words"}
- NumberLabel — compares two values (over b-roll): {"kicker", "a": {"label","value","at"}, "b": {"label","value","at"}}
- BarChart — says 2-4 numbers to compare (over b-roll): {"title", "bars": [{"label","value": number,"display": "as said","at": "@the number"}]}
- BigNumberOverlay — says a number that matters while the picture matters too (over b-roll): same props as BigNumber
- DimCaption — a striking line over b-roll: {"phrase": phrase (≤10 words), "emphasis"}
- ArrowCaption — a line pointing at something in the picture ("this one", "that disc", "right here") (over b-roll): {"phrase": phrase (≤10 words), "emphasis"}
- MythStamp — says a myth over footage (no correction card needed): {"label": "Myth", "at": "@the myth's key words", "phrase": phrase (optional, ≤10 words)}
- Quote — the host's own advice in one memorable line (over b-roll): {"quote": ONE WHOLE SENTENCE (≤16 words), "author": "the host's name", "emphasis"}
- HostCaption — the host's punchline while on camera (HOST or SPLIT scene, never under the name tag): {"phrase": phrase (≤8 words), "emphasis"}
`;

export function systemPrompt(opts: { kept: boolean }): string {
  return `You place motion graphics on a finished talking-head YouTube film, in the style of Steve Cooper's
channel: dark cards and clean labels that land exactly on the words that make a point.

THE RULE: read the script line by line. For every line, ask which of the moments below it is. When it
is one, place that graphic on it — every time, as often as the script has that moment. A type may
appear again and again; there is no quota. A line that is none of them gets nothing.

When two moments overlap in time, keep the one that is the stronger point (a counted chapter, a spoken
number or a comparison beats a general caption); the other only if it still fits after a 1-second gap.

What every graphic must keep:
- EVERY WORD ON SCREEN IS THE NARRATOR'S. No fact, number or claim the script does not say. Fixed
  labels may be a short plain version of what is said. Every number shown must be a number said.
- SHORT. A label is read at a glance, not followed like a subtitle (word limits are hard).
- A SHOWN LINE READS AS A WHOLE THOUGHT: it starts where a sentence or clause starts (capital
  letter) and keeps every word its meaning needs. Do not open on "It"/"This" when what it refers to
  is not on screen.
- A graphic stays only while its words are spoken (it leaves ~0.8 s after its last word by itself):
  start it on the words that open the point; let its last word be the last word of the point.
- No graphic waits: never more than ${MAX_WAIT_SEC} s between one of its words appearing and the next.
- Where it may go: full-screen cards, window graphics and graphics about the picture go ONLY inside a
  b-roll stretch, with all their words inside that one stretch. Nothing in the call to action (CTA
  scenes). Nothing about the host's words under the name tag. ${MIN_GAP_SEC} s between graphics.
${opts.kept ? `\nSOME GRAPHICS ARE ALREADY PLACED AND APPROVED (listed in the message). Keep them exactly; add every other\nmoment around them, never overlapping them.\n` : ""}
Answer with JSON only: {"cues": [ ... ]} in film order, NEW graphics only. Each cue:
{"id": "short-kebab-name", "template": "...", "start": "the exact spoken words it starts on (4-7 words, unique enough to find)",
 "startPad": -0.15, "end": "the exact spoken words it ends on (2-6 words)", "endPad": 0.3, "props": {...}}
"start" and "end" are copied word for word from the script.
${CATALOGUE}`;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const kindOf = (s: LayoutScene) => (s.cta ? "CTA" : s.split ? "SPLIT (host left, picture right)" : s.hostPresent ? "HOST" : "B-ROLL");

/** The message the model reads: the film scene by scene, its b-roll stretches, and the graphics
 * already placed and approved. */
export function userPrompt(film: FilmLayout, kept: ResolvedCue[]): string {
  const nameTag = nameTagRange(film);
  const layout = film.scenes
    .map(s => {
      const tagUp = nameTag && s.narrationStartSec < nameTag[1] && s.narrationEndSec > nameTag[0] ? " [NAME TAG UP]" : "";
      return `#${s.index} ${mmss(s.narrationStartSec)}-${mmss(s.narrationEndSec)} ${kindOf(s)}${tagUp}: ${(s.scriptText ?? "").trim()}`;
    })
    .join("\n");
  // Stretches of consecutive b-roll (no host, no CTA): where cards and picture graphics go.
  const stretches: { from: number; to: number; text: string }[] = [];
  for (const s of film.scenes) {
    if (s.hostPresent || s.cta) continue;
    const last = stretches[stretches.length - 1];
    if (last && Math.abs(last.to - s.narrationStartSec) < 0.1) {
      last.to = s.narrationEndSec;
      last.text += " " + (s.scriptText ?? "").trim();
    } else stretches.push({ from: s.narrationStartSec, to: s.narrationEndSec, text: (s.scriptText ?? "").trim() });
  }
  const stretchList = stretches
    .filter(b => b.to - b.from >= 2.5)
    .map(b => `${mmss(b.from)}-${mmss(b.to)} (${(b.to - b.from).toFixed(1)} s): ${b.text}`)
    .join("\n");
  const keptNote = kept.length
    ? `\n\nALREADY PLACED AND APPROVED (keep; do not repeat them; add around them):\n${kept.map(c => `${mmss(c.start)}-${mmss(c.end)} ${c.template} "${c.id}"`).join("\n")}`
    : "";
  return `THE FILM, scene by scene (time, what is on screen, what is said):
${layout}

B-ROLL STRETCHES (where cards, window graphics and graphics about the picture go):
${stretchList}${keptNote}

Write the cue sheet: every moment in the script that calls for a graphic.`;
}

export function parseSheet(text: string): CueSpec[] {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error(`no JSON in the answer: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text.slice(a, b + 1)) as { cues?: CueSpec[] };
  if (!Array.isArray(parsed.cues)) throw new Error("answer has no cues array");
  return parsed.cues;
}

/* ───────────── Checks every new graphic is held to ───────────── */

/** The lines a viewer reads as SENTENCES (a number card's line and a term's meaning run on from
 * what is above them and are exempt). */
const LINE_KEYS = ["headline", "phrase", "quote", "myth", "truth", "title", "text", "fact", "question"] as const;

/** Hard word limits on a template's shown line (Steve's labels are a glance, not a subtitle:
 * job 385's 19-word warning stayed 11.5 s). */
export const MAX_WORDS: Record<string, number> = {
  Statement: 12, MythTruth: 14, TwoPoint: 12, WarningLabel: 10, HostCaption: 24, DimCaption: 24, Quote: 16,
  TitleOverFootage: 10, ArrowCaption: 20, IconCallout: 8, FactCard: 14, YesNoCard: 14, MythStamp: 10,
};

/** Keys whose strings are not shown words (or are checked by the resolver already). */
const NOT_SHOWN = new Set(["icon", "at", "say", "winner", "answer", "author", "start", "end"]);

/** Every number a cue SHOWS (in fixed text or a value), which must be a number the narrator says
 * while the graphic is up — a chart or a label can never invent one. */
export function shownNumbers(spec: CueSpec): string[] {
  if (spec.template === "ChapterLabel") return []; // its "1 of 3" counts the graphics, not a fact
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (Array.isArray(v)) return v.forEach(x => walk(x, key));
    if (typeof v === "number" && key === "value") out.push(String(v));
    if (typeof v === "string" && !NOT_SHOWN.has(key)) for (const m of Array.from(v.matchAll(/\d+(?:[.,]\d+)?/g))) out.push(m[0].replace(",", ""));
    if (v && typeof v === "object" && !(v as { words?: boolean }).words) for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(spec.props, "");
  return out;
}

/** Numbers tidied the way a reader expects: a currency sign before the number ("$" put in a unit
 * moves to the prefix), and two values compared sharing their unit ("2 hours" vs "6" reads as
 * "6 what?" — Hank, job 382). */
export function tidyNumbers(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(tidyNumbers);
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (typeof o.unit === "string" && typeof o.value === "number") {
    const m = /^\s*([$£€¥])\s*(.*)$/.exec(o.unit);
    if (m) {
      o.prefix = o.prefix ?? m[1];
      o.unit = m[2];
    }
  }
  const pair = [o.a, o.b] as { value?: unknown }[];
  if (pair.every(x => x && typeof x === "object" && typeof x.value === "string")) {
    const unitOf = (v: string) => /^\s*[$£€¥]?[\d.,]+\s+(.+)$/.exec(v)?.[1];
    const bare = (v: string) => /^\s*[$£€¥]?[\d.,]+\s*$/.test(v);
    const [a, b] = pair as { value: string }[];
    if (bare(b.value) && unitOf(a.value)) b.value = `${b.value.trim()} ${unitOf(a.value)}`;
    else if (bare(a.value) && unitOf(b.value)) a.value = `${a.value.trim()} ${unitOf(b.value)}`;
  }
  for (const v of Object.values(o)) tidyNumbers(v);
}

/* ───────────── Script moments and spoken lists ───────────── */

/** Words a sentence holds when it is a moment a template is made for. */
const MOMENT = new RegExp(
  "\\d|\\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|percent|half|twice|double|triple)\\b" +
    "|\\b(than|instead of|versus|vs|compared|unlike|cheaper|better|worse)\\b|\\b(called|means|known as)\\b" +
    "|\\b(never|don't|do not|avoid|mistake|careful|warning)\\b|\\b(first|second|third|step|then|finally)\\b",
  "i"
);

/**
 * Sentences with no graphic over them that hold a moment (`MOMENT`), outside the call to action, in
 * film order — what the fill round asks about. By the script, never by the clock. Pure.
 */
export function uncoveredMoments(placed: ResolvedCue[], words: Word[], film: FilmLayout): { from: number; to: number; text: string }[] {
  const cta = film.scenes.filter(s => s.cta).map(s => [s.narrationStartSec, s.narrationEndSec] as const);
  const sentences: { from: number; to: number; text: string }[] = [];
  let cur: Word[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[.?!]["”')]*$/.test(w.text.trim())) {
      sentences.push({ from: cur[0].start, to: cur[cur.length - 1].end, text: cur.map(x => x.text.trim()).join(" ") });
      cur = [];
    }
  }
  return sentences.filter(s => {
    if (s.text.split(" ").length < 4 || !MOMENT.test(s.text)) return false;
    if (cta.some(([a, b]) => s.from < b && s.to > a)) return false;
    const len = s.to - s.from;
    return !placed.some(c => Math.min(c.end, s.to) - Math.max(c.start, s.from) > len * 0.4);
  });
}

/** An item as a list row: no leading article, at most five words, a capital first letter. */
function rowText(item: string): string {
  const w = item.replace(/^(a|an|the|as|and|or)\s+/i, "").replace(/[.,;:!?]+$/, "").split(/\s+/).slice(0, 5).join(" ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/**
 * Where each spoken list is said — its first item's first word to its last item's last word — in
 * order, each searched from where the list before it starts (so a list said again after another list
 * binds after that one). A list whose first or last item is not heard word for word is left out. Pure.
 */
function locateLists(words: Word[], lists: { items: string[] }[]): { n: number; a: number; b: number }[] {
  const index = indexWords(words);
  const out: { n: number; a: number; b: number }[] = [];
  let from = 0;
  lists.forEach((l, n) => {
    const first = findVerbatim(index, l.items[0], from);
    if (!first) return;
    const last = findVerbatim(index, l.items[l.items.length - 1], first[0]);
    if (!last) return;
    from = first[0];
    out.push({ n, a: words[index[first[0]].word].start, b: words[index[last[last.length - 1]].word].end });
  });
  return out;
}

/** Does `a`-`b` run into a call-to-action scene (ending just as one starts does not)? No graphic may go there (rules.ts). */
function inCallToAction(film: FilmLayout, a: number, b: number): boolean {
  return film.scenes.some(s => s.cta && a < s.narrationEndSec && b > s.narrationStartSec);
}

/**
 * The spoken lists a graphic may cover: every one but a list said in the call to action. Only these
 * are put to the planner as lists that MUST get a graphic — a replay of 12 films found 15 of 49 lists
 * in a CTA, in every film (Dale's job 397: "other woodworkers, old shop habits, and a fair pile of my
 * own spoiled boards" in the book pitch; Hank's job 398: the scan steps "Point your phone's camera…,
 * hold it steady…, tap the link"), each told it MUST have a graphic where the rules allow none (none
 * got one, rightly; what the model tried there is not kept, so the refusals cannot be counted).
 * Located exactly as `missingListCues` locates them, over the whole sequence, so the two agree; a list
 * that is not heard word for word is still offered (the planner may place it on the words it finds). Pure.
 */
export function listsWhereGraphicsGo<L extends { items: string[] }>(words: Word[], film: FilmLayout, lists: L[]): L[] {
  const cta = new Set(locateLists(words, lists).filter(p => inCallToAction(film, p.a, p.b)).map(p => p.n));
  return lists.filter((_, n) => !cta.has(n));
}

/**
 * A list graphic for every spoken list no graphic covers yet, built from the list's own words —
 * ListWindow over b-roll, HostListWindow over the host — skipping a list in the call to action. Pure.
 */
export function missingListCues(placed: ResolvedCue[], words: Word[], film: FilmLayout, lists: { items: string[]; kind?: string }[]): CueSpec[] {
  const out: CueSpec[] = [];
  for (const { n, a, b } of locateLists(words, lists)) {
    if (inCallToAction(film, a, b)) continue;
    if (placed.some(c => Math.min(c.end, b) - Math.max(c.start, a) > (b - a) * 0.4)) continue;
    const l = lists[n];
    const over = film.scenes.filter(s => a < s.narrationEndSec && b > s.narrationStartSec);
    const host = over.filter(s => s.hostPresent).length > over.length / 2;
    const say = (x: string) => x.replace(/[.,;:!?]+$/, "");
    out.push({
      id: `spoken-list-${n + 1}`,
      template: host ? "HostListWindow" : "ListWindow",
      start: say(l.items[0]).split(/\s+/).slice(0, 2).join(" "),
      props: { items: l.items.map(x => ({ text: rowText(x), at: "@" + say(x).split(/\s+/).slice(0, 2).join(" "), say: say(x) })) },
    } as CueSpec);
  }
  return out;
}

/* ───────────── Timed lines ───────────── */

/** The props a template draws as a TIMED LINE (its default is {text, at}), at the top level. */
function phraseKeys(template: string): string[] {
  const d = templateById(template).defaultProps as Record<string, unknown>;
  return Object.entries(d)
    .filter(([, v]) => !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { text?: unknown }).text === "string" && "at" in (v as object))
    .map(([k]) => k);
}

/** A timed line the planner wrote as plain text becomes one ({"text", "words": true}) — a template
 * handed a bare string where it reads `.text` crashed the whole graphics step (job 395). */
export function normalizePhrases(spec: CueSpec): void {
  for (const k of phraseKeys(spec.template)) {
    const v = spec.props[k];
    if (typeof v === "string" && v.trim()) spec.props[k] = { text: v, words: true };
  }
}

/** The first timed-line prop that is present but has no text (it cannot be drawn), or undefined. */
export function malformedPhrase(spec: CueSpec): string | undefined {
  return phraseKeys(spec.template).find(k => {
    const v = spec.props[k];
    return v !== undefined && v !== null && !(typeof v === "object" && typeof (v as { text?: unknown }).text === "string");
  });
}

/* ───────────── The plan ───────────── */

export type PlanMessage = { role: "user" | "assistant"; content: string };
export type PlanProblem = { cue: string; problem: string };

export type PlanInput = {
  /** The narration's words, timed on the film's own clock. */
  words: Word[];
  /** The film's picture cuts (seconds), for edges that leave with the picture. */
  cuts?: number[];
  film: FilmLayout;
  /** Approved graphics to keep (a fixed base, never dropped). */
  kept?: CueSpec[];
  /** The model call: system prompt + messages → the answer's text. */
  ask: (system: string, messages: PlanMessage[]) => Promise<string>;
  /** Makes an emoji's image available by its Noto code; false when Noto has none. */
  ensureIcon: (code: string) => Promise<boolean>;
  /** The spoken lists the pipeline found in the script (`server/spokenLists.ts`): each one gets a
   * list graphic wherever one may go. */
  lists?: { items: string[]; kind?: "things" | "steps" }[];
};

export type PlanResult = {
  /** The cue sheet: approved graphics and new ones, in film order. */
  cues: CueSpec[];
  resolved: ResolvedCue[];
  rounds: { asked: number; kept: number; problems: PlanProblem[] }[];
  /** Approved graphics that could not be kept (never, unless the film itself changed). */
  lostKept: string[];
};

export async function planGraphics(input: PlanInput): Promise<PlanResult> {
  const { words, cuts, film, ask, ensureIcon } = input;
  const kept0 = input.kept ?? [];
  const keptIds = new Set(kept0.map(c => c.id));
  const index = indexWords(words);
  const structural = new Set(TEMPLATES.filter(t => t.structural).map(t => t.id));
  const cards = new Set(TEMPLATES.filter(t => t.kind === "card").map(t => t.id));
  const fullFrame = new Set(TEMPLATES.filter(t => t.kind === "card" || t.underlay === "window").map(t => t.id));
  const opts = { cuts, fps: FPS, structural, cards, fullFrame };

  /** Converts every `icon` in a cue's props to its Noto code in place; collects the ones Noto lacks. */
  const fixIcons = async (node: unknown, missing: string[]): Promise<void> => {
    if (Array.isArray(node)) {
      for (const x of node) await fixIcons(x, missing);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (k === "icon" && typeof v === "string") {
        const code = notoCode(v);
        if (await ensureIcon(code)) o.icon = code;
        else missing.push(v);
      } else await fixIcons(v, missing);
    }
  };
  /** Is number `n` said (as digits or in words) while the graphic is up? */
  const saidNear = (n: string, from: number, to: number): boolean => {
    const toks = words.filter(w => w.end >= from - 1 && w.start <= to + 1).flatMap(w => tokens(w.text));
    const plain = n.replace(/\.0+$/, "");
    return toks.some((t, i) => t === plain || t === n || t.replace(",", "") === plain || String(parseSpokenNumber(toks, i)?.value) === plain);
  };
  /** Rough time a cue starts (first place its start words occur), to slot new cues among the placed. */
  const approxStart = (spec: CueSpec): number => {
    const hits = findPhrase(index, spec.start, 0);
    return hits ? words[index[hits[0]].word].start : Infinity;
  };

  // A chapter series and a spoken list's graphic come first: a NEW graphic that clashes with one
  // gives way (Dale's "Coasters, ornaments, small cutting boards" had only a "Smalls" label).
  const required = new Set<string>();
  const priority = (s: CueSpec) => structural.has(s.template) || required.has(s.id);
  const lists = (input.lists ?? []).filter(l => l.items.length >= 2 && l.items.length <= 5);
  // The model is told a list MUST get a graphic only where one may go: a list in the call to action
  // can never have one, so naming it there is at best ignored and at worst refused. `missingListCues`
  // still reads every list, so a list said after a mid-roll CTA is located after it, not on an earlier
  // copy of its words.
  const offered = listsWhereGraphicsGo(words, film, lists);

  const validate = async (newSpecs: CueSpec[], final: boolean) => {
    const problems: PlanProblem[] = [];
    const ids = new Set<string>();
    // 1. The APPROVED graphics are the fixed base: placed first, in their own order, never dropped.
    //    Their own issues (if any) are reported, not acted on.
    const placed: { spec: CueSpec; t: number; kept: boolean }[] = [];
    for (const k of kept0) {
      const spec = structuredClone(k);
      ids.add(spec.id);
      normalizePhrases(spec);
      tidyNumbers(spec.props);
      await fixIcons(spec.props, []);
      placed.push({ spec, t: 0, kept: true });
    }
    const resolveAll = () => resolveCues(placed.map(p => p.spec), words, opts);
    let resolved: ResolvedCue[] = placed.length ? resolveAll() : [];
    for (const r of resolved) placed.find(p => p.spec.id === r.id)!.t = r.start;
    for (const p of checkRules(resolved, film)) problems.push({ cue: `[kept] ${p.cue}`, problem: p.problem });

    // 2. Each NEW graphic, in film order, joins only where it adds no problem to anything placed.
    const order = newSpecs.map(c => ({ c, t: approxStart(c) })).sort((a, b) => a.t - b.t);
    for (const { c: spec, t } of order) {
      const bad = (problem: string) => problems.push({ cue: spec.id ?? "?", problem });
      if (!spec.id || ids.has(spec.id)) {
        bad("missing or repeated id");
        continue;
      }
      ids.add(spec.id);
      try {
        templateById(spec.template);
      } catch {
        bad(`unknown template "${spec.template}"`);
        continue;
      }
      if (!spec.props || typeof spec.props !== "object") spec.props = {};
      normalizePhrases(spec);
      const malformed = malformedPhrase(spec);
      if (malformed) {
        bad(`"${malformed}" must be a timed line: {"text": "the narrator's words", "words": true}`);
        continue;
      }
      const cap = MAX_WORDS[spec.template];
      const wordCount = (s: string) => s.trim().split(" ").filter(Boolean).length;
      const long = cap && LINE_KEYS.map(k => (spec.props?.[k] as { text?: unknown } | undefined)?.text).find(s => typeof s === "string" && wordCount(s) > cap);
      if (long) {
        bad(`"${long}" is ${wordCount(String(long))} words — ${spec.template} takes at most ${cap}`);
        continue;
      }
      const fragment = LINE_KEYS.map(k => [k, (spec.props?.[k] as { text?: unknown } | undefined)?.text] as const).find(
        ([, text]) => typeof text === "string" && !STARTS_A_THOUGHT.test(text.trim())
      );
      if (fragment) {
        bad(`"${fragment[1]}" (${fragment[0]}) starts mid-sentence — a shown line must read as a whole thought`);
        continue;
      }
      tidyNumbers(spec.props);
      // A TITLE keeps the length it was planned with — but never under MIN_ON_SCREEN_SEC: Dale's
      // "Where to sell · 3 of 5" was planned at 1.4 s (job 397, 2:15). Raised, never refused: a
      // refused chapter takes its whole series down with it. An approved one keeps its length.
      if (structural.has(spec.template) && typeof spec.durationSec === "number" && spec.durationSec < MIN_ON_SCREEN_SEC) spec.durationSec = MIN_ON_SCREEN_SEC;
      const missing: string[] = [];
      await fixIcons(spec.props, missing);
      if (missing.length) {
        bad(`no Noto emoji for ${missing.join(" ")} — pick another`);
        continue;
      }
      // Slot it among what is placed by time, then resolve the whole sheet in film order (a
      // repeated phrase binds after the graphic before it).
      const at = placed.findIndex(p => p.t > t);
      placed.splice(at < 0 ? placed.length : at, 0, { spec, t, kept: false });
      const undo = () => placed.splice(placed.findIndex(p => p.spec === spec), 1);
      let next: ResolvedCue[];
      try {
        next = resolveAll();
      } catch (e) {
        undo();
        bad(e instanceof CueError ? e.message.replace(/^cue \S+: /, "") : String(e));
        continue;
      }
      const mine = next.find(r => r.id === spec.id)!;
      // A graphic that sits still for seconds between its own words is a frozen frame, not a point.
      const times = [mine.start, ...mine.sync.map(x => x.wordStart), mine.contentEnd ?? mine.start].sort((a, b) => a - b);
      const wait = Math.max(0, ...times.slice(1).map((x, i) => x - times[i]));
      if (wait > MAX_WAIT_SEC) {
        undo();
        bad(`waits ${wait.toFixed(1)} s between its own words (most ${MAX_WAIT_SEC} s) — start it nearer its point`);
        continue;
      }
      // Up long enough to READ. The resolver's reading floor can still be cut short — by the cap at
      // the next sentence, then a snap back onto a picture cut: Dale's "3 piles" on the two-word shot
      // "Three piles." came out 1.27 s (job 397, 0:48) and shipped. Refused here, where the repair
      // round can join it to more words; forcing the floor in the resolver would carry it a second
      // onto the next shot instead. (A title was raised above.)
      if (!structural.has(spec.template) && tooShortToRead(mine, FPS)) {
        undo();
        bad(`on screen ${((mine.endFrame - mine.startFrame) / FPS).toFixed(2)} s — too short to read (at least ${MIN_ON_SCREEN_SEC} s); join it to the next sentence or drop it`);
        continue;
      }
      const unsaid = shownNumbers(spec).filter(n => !saidNear(n, mine.start, mine.end));
      if (unsaid.length) {
        undo();
        bad(`shows ${unsaid.join(", ")}, which the narrator does not say while it is up`);
        continue;
      }
      // The placement rules, with the gap a new graphic keeps from everything — only problems that
      // involve THIS graphic count (approved graphics may touch each other, as when approved).
      let rule = checkRules(next, film, { gap: MIN_GAP_SEC }).filter(p => p.cue === spec.id || p.problem.includes(spec.id));
      // A chapter label is part of a SERIES, and one refused takes the whole series down with it
      // (Frederick's job 393: chapter 3 landed right after a caption, and all three were lost). So
      // where a chapter clashes only with NEW, non-structural graphics, those give way instead.
      if (rule.length && priority(spec)) {
        const others = placed.filter(p => p !== placed.find(q => q.spec === spec) && !p.kept && !priority(p.spec) && rule.some(r => r.cue === p.spec.id || r.problem.includes(p.spec.id)));
        const blamed = rule.every(r => others.some(o => r.cue === o.spec.id || r.problem.includes(o.spec.id)));
        if (others.length && blamed) {
          const removed = others.map(o => placed.splice(placed.indexOf(o), 1)[0]);
          try {
            next = resolveAll();
            rule = checkRules(next, film, { gap: MIN_GAP_SEC }).filter(p => p.cue === spec.id || p.problem.includes(spec.id));
          } catch {
            rule = [{ cue: spec.id, problem: "could not be placed" } as (typeof rule)[number]];
          }
          if (rule.length) for (const o of removed) placed.push(o);
          else for (const o of removed) problems.push({ cue: o.spec.id, problem: `gave way to ${spec.id} (a chapter series or a spoken list comes first)` });
        }
      }
      if (rule.length) {
        undo();
        for (const r of rule) bad(r.problem);
        continue;
      }
      resolved = next;
      for (const r of resolved) placed.find(p => p.spec.id === r.id)!.t = r.start;
    }

    // Chapter labels are a SERIES: "2 of 3" with no 1 or 3 is a broken promise on screen. A new
    // series that came out incomplete is dropped; an approved one never is.
    const chapters = placed.filter(p => p.spec.template === "ChapterLabel");
    const total = Math.max(0, ...chapters.map(p => Number(/of\s+(\d+)/i.exec(String(p.spec.props.kicker ?? ""))?.[1] ?? 0)));
    const have = new Set(chapters.map(p => Number(p.spec.props.number)));
    const lost = Array.from({ length: total }, (_, i) => i + 1).filter(n => !have.has(n));
    if (chapters.length && lost.length) {
      for (const n of lost) problems.push({ cue: `chapter ${n}`, problem: `chapter ${n} of ${total} is missing — label every counted part or none` });
      if (final) {
        for (const p of chapters.filter(p => !p.kept)) {
          problems.push({ cue: p.spec.id, problem: "dropped with its incomplete chapter series" });
          placed.splice(placed.indexOf(p), 1);
        }
        resolved = placed.length ? resolveAll() : [];
      }
    }
    return { cues: placed.map(p => p.spec), resolved, problems };
  };

  const system = systemPrompt({ kept: kept0.length > 0 });
  const listNote = offered.length
    ? `\n\nSPOKEN LISTS IN THIS SCRIPT — each one MUST get a list graphic wherever one may go (ListWindow over
b-roll, HostListWindow over the host; steps may be StepCards or StepLabels), every item a row in the order
said ("text" ≤5 words, "at": "@its first spoken words", "say": the item as said):
${offered.map((l, i) => `${i + 1}. ${l.kind === "steps" ? "[steps] " : ""}${l.items.map(x => `"${x}"`).join(", ")}`).join("\n")}`
    : "";
  const user = userPrompt(film, kept0.length ? resolveCues(kept0, words, opts) : []) + listNote;
  const first = await ask(system, [{ role: "user", content: user }]);
  let specs = parseSheet(first).filter(c => !keptIds.has(c.id));
  let verdict = await validate(structuredClone(specs), false);
  const rounds = [{ asked: specs.length, kept: verdict.cues.length, problems: verdict.problems }];
  if (verdict.problems.some(p => !p.cue.startsWith("[kept]"))) {
    const fix = `These cues failed the checks (resolved against the real word times and the film's layout):
${verdict.problems.filter(p => !p.cue.startsWith("[kept]")).map(p => `- ${p.cue}: ${p.problem}`).join("\n")}

Return the corrected NEW cues (JSON only, the whole list of new ones). Fix each failed cue — use words the
narrator really says, numbers he says, move it to where it may go, or drop it. Keep the ones that passed.`;
    specs = parseSheet(
      await ask(system, [
        { role: "user", content: user },
        { role: "assistant", content: first },
        { role: "user", content: fix },
      ])
    ).filter(c => !keptIds.has(c.id));
    verdict = await validate(structuredClone(specs), true);
    rounds.push({ asked: specs.length, kept: verdict.cues.length, problems: verdict.problems });
  }

  // FILL, by the SCRIPT (not by the clock — the operator, 2026-10-17: "if it should have a graphic
  // then it should"): every sentence with no graphic that holds a moment a template is made for — a
  // number, a comparison, a term, a warning, a step — is offered back. Every rule still holds; what
  // it adds is checked like any other cue, with one repair round.
  const moments = uncoveredMoments(verdict.resolved, words, film);
  if (moments.length) {
    const accepted = verdict.cues.filter(c => !keptIds.has(c.id));
    const taken = new Set(verdict.cues.map(c => c.id));
    const fill = `These sentences have NO graphic yet, and each may hold a moment a template is made for:
${moments.map(e => `- ${mmss(e.from)} "${e.text}"`).join("\n")}

Add a NEW cue for each one that really fits a template (a number, a list, a comparison, a term, a step,
a warning, a whole sentence worth a statement or a caption); skip one that does not. Every rule above
still applies. Return JSON only: {"cues": [ ...the NEW cues only... ]}, with ids not used before.`;
    const base = [{ role: "user" as const, content: user }, { role: "assistant" as const, content: JSON.stringify({ cues: accepted }) }];
    let added: CueSpec[] = [];
    try {
      added = parseSheet(await ask(system, [...base, { role: "user", content: fill }])).filter(c => !taken.has(c.id) && !keptIds.has(c.id));
    } catch {
      added = [];
    }
    if (added.length) {
      let next = await validate(structuredClone([...accepted, ...added]), false);
      const addedIds = new Set(added.map(c => c.id));
      const failed = next.problems.filter(p => addedIds.has(p.cue));
      rounds.push({ asked: added.length, kept: next.cues.length - accepted.length, problems: failed });
      if (failed.length) {
        const fix = `These added cues failed the checks:
${failed.map(p => `- ${p.cue}: ${p.problem}`).join("\n")}

Return the corrected ADDED cues (JSON only, {"cues": [...]}, only the ones you added). Fix each — use
words the narrator really says, a whole sentence where the template needs one, or drop it.`;
        try {
          const fixed = parseSheet(await ask(system, [...base, { role: "user", content: fill + "\n\nYOUR ADDED CUES WERE:\n" + JSON.stringify({ cues: added }) + "\n\n" + fix }])).filter(c => !taken.has(c.id) && !keptIds.has(c.id));
          next = await validate(structuredClone([...accepted, ...fixed]), true);
          rounds.push({ asked: fixed.length, kept: next.cues.length - accepted.length, problems: next.problems.filter(p => fixed.some(x => x.id === p.cue)) });
        } catch {
          next = await validate(structuredClone([...accepted, ...added]), true);
        }
      } else {
        next = await validate(structuredClone([...accepted, ...added]), true);
      }
      // only ever MORE: a fill that somehow lost an accepted graphic is not taken
      if (accepted.every(a => next.cues.some(c => c.id === a.id))) verdict = next;
    }
  }

  // EVERY SPOKEN LIST HAS ITS GRAPHIC: one the planner still left without is built from the list's
  // own words, and comes first over a new graphic in its way.
  const listCues = missingListCues(verdict.resolved, words, film, lists);
  if (listCues.length) {
    for (const c of listCues) required.add(c.id);
    const accepted = verdict.cues.filter(c => !keptIds.has(c.id));
    const next = await validate(structuredClone([...accepted, ...listCues]), true);
    const placedLists = listCues.filter(l => next.cues.some(c => c.id === l.id));
    rounds.push({ asked: listCues.length, kept: placedLists.length, problems: next.problems.filter(p => listCues.some(l => l.id === p.cue) || p.problem.includes("gave way")) });
    if (placedLists.length) verdict = next;
  }
  return {
    cues: verdict.cues,
    resolved: verdict.resolved,
    rounds,
    lostKept: kept0.filter(k => !verdict.cues.some(c => c.id === k.id)).map(k => k.id),
  };
}

/** A shown line starts a thought: a capital letter, a digit or an opening quote. (Built at runtime:
 * the app's type check targets a JavaScript older than the Unicode-property regex literal.) */
const STARTS_A_THOUGHT = new RegExp("^[\\p{Lu}\\d\"“'‘]", "u");
