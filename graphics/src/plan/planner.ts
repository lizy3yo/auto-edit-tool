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
import { CARD_HOLD_MAX_SEC, CueError, LINGER_SEC, MIN_ON_SCREEN_SEC, MIN_SHOT_SEC, NEW_LINE_GRACE_SEC, blinkBeside, findPhrase, findVerbatim, holdToCut, indexWords, ownSentenceEnd, parseSpokenNumber, resolveCues, sameWord, tokens, tooShortToRead, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
import { resolveSets, templateById } from "../registry";
import { FPS, LAYOUT, WIDTH } from "../theme";
import { MIN_GAP_SEC, checkRules, nameTagRange, type FilmLayout, type LayoutScene } from "./rules";
import { VIDEO_MIN_SEEN_SEC, pictureNote, pictureProblem } from "./pictures";

/** The longest a graphic may sit still between one of its words and the next (Hank's job 382: a
 * number graphic opened on "But the one I was proudest of" and waited 9 s for the number). */
export const MAX_WAIT_SEC = 5;

/**
 * The most words a row of a list window (ListWindow, HostListWindow) shows. It was 5, and the
 * planner clipped rows into headlines to fit: Gideon's job 400 (2:03) showed "One step from throne"
 * and "Ordered to end life" for "one step from the throne" and "ordered to end his own life". Six
 * holds the spoken words with their grammar; a row may take two lines in the window, as five-word
 * rows already did.
 */
export const ROW_MAX_WORDS = 6;

/**
 * The most words a step (StepCards, StepLabels) shows. It was 4, asked in the prompt only, and the
 * planner clipped steps into headlines to fit: Helena's job 410 (2:21) showed "Phrase it as offer"
 * and "Wait until all served" for "…phrase it as an offer" and "wait until everyone's been served".
 * Five holds a step in his words with their grammar.
 */
export const STEP_MAX_WORDS = 5;

/** A step label strip as measured off job 399's (four pills, 70 characters, 1,718 px across): about
 * 15.4 px a character, 90 px a pill's number and padding, 94 px an arrow and its gaps. (Up here: the
 * catalogue, built when the module loads, states the strip's budget from them.) */
const STRIP_CHAR_PX = 15.4;
const STRIP_PILL_PX = 90;
const STRIP_ARROW_PX = 94;
/** The widest a strip may be: it starts at the action-safe edge and ends inside the other one. */
export const STEP_STRIP_MAX_PX = WIDTH - 2 * LAYOUT.actionSafeX;
/**
 * The most characters `n` step labels may hold between them and still fit the strip (82 for three,
 * 70 for four). The pills never wrap or shrink, so five-word steps in his words, four of them, run
 * past the picture's edge — and the planner is told this budget up front instead of learning it in
 * its one repair round. Pure.
 */
export function stepStripMaxChars(n: number): number {
  return Math.floor((STEP_STRIP_MAX_PX - n * STRIP_PILL_PX - Math.max(0, n - 1) * STRIP_ARROW_PX) / STRIP_CHAR_PX);
}

/** The list windows: numbered rows, each standing for an item the narrator says. */
const LIST_WINDOWS = new Set(["ListWindow", "HostListWindow"]);

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

/**
 * AN ICON IS THE THING ITSELF, OR THERE IS NONE (round 10 review). The catalogue used to ask for an
 * icon on every card, so where no emoji is the object the line names the planner took the nearest
 * one: job 399 (whole-can-fact, 1:09) put the "canned food" tin on a fact about the rest of a drink
 * can — Unicode has no drink can — and job 400 (clock-before-after, 1:03) a megaphone for "The
 * loudest thing" beside an alarm clock for the clock. Now an icon is optional on every template but
 * the one an icon IS (one short point one object says): there it is refused when missing, and the
 * repair is steered to a caption. Everywhere else a card with no icon is complete.
 *
 * NOT CHECKED: whether the emoji is that object. The repo ships the Noto images by code point and
 * no table of their names, so nothing here can tell "canned food" from a drink can; the prompt's
 * rule is the only guard.
 */
export const ICON_REQUIRED = new Set(["IconCallout"]);

/** An icon slot the planner left empty rather than filled: no string, blank, or a word for none. */
export function noIcon(v: unknown): boolean {
  return typeof v !== "string" || !v.trim() || /^(?:none|null|no icon|n\/a|-+)$/i.test(v.trim());
}

/**
 * ICONS SIDE BY SIDE COME AS A SET: a graphic's two sides (Versus "left"/"right", BeforeAfter
 * "before"/"after") or its rows ("steps", "items") show an icon on each or on none. With the icon
 * optional, a set can come back half-filled — the planner gives one side its object and leaves the
 * other out (job 400's after side, "The loudest thing", names no object), or an emoji Noto has no
 * image for is taken off — and a half set is drawn unevenly: a side or step box without its icon
 * sits its words a whole icon higher than its neighbour's. The icons of a half set are all taken
 * off, in place. A single icon (FactCard, IconCallout) is not a set. Pure.
 */
const ICON_PAIRS = [["left", "right"], ["before", "after"]];
const ICON_ROWS = ["steps", "items"];
export function iconsAsASet(props: Record<string, unknown>): void {
  const sets: unknown[][] = [...ICON_PAIRS.map(keys => keys.map(k => props[k])), ...ICON_ROWS.map(k => (Array.isArray(props[k]) ? (props[k] as unknown[]) : []))];
  for (const set of sets) {
    const slots = set.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    const shown = slots.filter(s => typeof s.icon === "string");
    if (shown.length && shown.length < slots.length) for (const s of slots) delete s.icon;
  }
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
drawn in the accent colour.
"icon" is OPTIONAL everywhere but IconCallout. It is ONE emoji character (a 3D Noto emoji) that IS the object
its own words name (the side's title, the step, the item, the card's line): that same kind of thing, drawn as
itself — an umbrella for "the umbrella", a light bulb for "the bulb". Leave "icon" out when those words name no
object ("most people never ask"), and when no single emoji is that exact object: the nearest emoji of another
kind is wrong (a mug for a bottle, a car for a truck, a tin of food for a paint can). Never an icon
for an idea, a quality or a feeling (a trophy for "the best", a rocket for "fast", a heart for "love"). A
graphic without an icon is complete. Icons side by side come as a set: on both sides of a Versus or a
BeforeAfter, on every step or item, or on none. When one thing changes state, both sides show that same thing.

EVERY GRAPHIC AND THE MOMENT THAT CALLS FOR IT
Each line below is "Template — appears whenever the script…: props". Use a template EVERY time its
moment happens, as often as the script allows. Nothing here is limited to once.

Full-screen cards — replace the picture, so ONLY inside a b-roll stretch, never hiding a whole VIDEO or a list's own pictures:
- Statement — sums up a point in one short line, or lands a punchline: {"kicker": "2-4 word label", "headline": ONE WHOLE SENTENCE as said (4-12 words), "emphasis"}
- MythTruth — states what people believe, then corrects it: {"myth": ONE WHOLE SENTENCE (≤14 words), "truth": ONE WHOLE SENTENCE (≤14 words), "emphasis"}
- Versus — compares two kinds or options: {"kicker", "left": {"icon" (optional),"title" (1-3 words),"sub" (≤6 words),"say","at"}, "right": {same}, "winner": "left"|"right"|"none"}
- BigNumber — says a number that matters (a time, an amount, a count): {"kicker", "prefix": "$" (a currency sign, if any), "value": number, "unit": "1-2 words", "at": "@the spoken number", "line": phrase, "countSec": 0.6 for small numbers}. Start it on the sentence that holds the number, not sentences before.
- StepCards — gives 2-4 steps the viewer should do, when the steps have no pictures of their own (over STEP PICTURE scenes, StepLabels): {"kicker", "steps": [{"text" (≤${STEP_MAX_WORDS} words), "icon" (optional), "at": "@words"}]}
  (each step is the narrator's own words, shortened, keeping his "a", "the", "it" — "Leave it on the shelf", never
  "Leave on shelf" — never a word he does not say, and never stopped before what its last word takes. Steps are
  done ONE AFTER ANOTHER: a choice the line offers — "…, or …", "alternatively" — is part of the
  step before it, never a step of its own: "Call the office, or send an email" is ONE step, "Call or email")
- BeforeAfter — an old way or state replaced by a new one: {"kicker", "before": {"icon" (optional),"label","at"}, "after": {"icon" (optional),"label","at"}}
- TwoPoint — links two places or things ("the one in the basement sets off the one by your bed"): {"title": phrase, "a": {"label","sub","at"}, "b": {"label","sub","at"}}
- FactCard — states a finding or a general fact ("most…", "studies show…", "the rule is…"): {"kicker": "Fact", "fact": ONE WHOLE SENTENCE (≤14 words), "emphasis", "source": "where it comes from, ONLY if the script says it", "icon" (optional)}
- YesNoCard — asks a yes/no question and answers it: {"kicker", "question": ONE WHOLE SENTENCE (≤14 words), "answer": "yes"|"no", "at": "@the spoken answer", "line": phrase (optional, the reason)}

Graphics with the picture in a window — they replace the picture with the footage framed beside text:
- TermWindow — names a term or a word and explains what it means (ONLY over b-roll): {"kicker": "The term", "term": "the term as said", "at": "@the term", "meaning": phrase (≤12 words)}
- ListWindow — lists 2-4 things or signs the narrator NAMES one after another, while the picture matters (ONLY over b-roll): {"title": "2-4 words", "items": [{"text" (≤${ROW_MAX_WORDS} words), "at": "@the item's FIRST spoken words", "say": "the item as said"}]}
  (a list is separate things he names one after another — never a sentence chopped at its commas into a
  time, a clause and describing words: "a short, quiet, careful letter" is one letter. Each row is the item in his
  own words, keeping their "a", "the", "his", "her": "A seat by the window", "Her grandmother's sewing box" —
  never clipped like a headline, "Seat by window", and never stopped before what its last word takes: "The kids are
  already practicing the song" is "The kids are practicing the song", never "The kids are already practicing")
- HostListWindow — the HOST lists what is coming or 2-4 points, while on camera (ONLY over a HOST scene, never under the name tag): same props as ListWindow

On top of the footage:
- TitleOverFootage — the video's topic line in its opening, over its first b-roll: {"kicker" (optional), "phrase": phrase (≤10 words), "emphasis"}
- ChapterLabel — the script counts its parts aloud ("first thing…", "second…"): label EVERY counted part (all or none): {"kicker": "Topic · 1 of 3", "number": 1, "title": "1-3 words"}, "durationSec": 4.5 instead of "end"
- StepLabels — describes 2-4 actions in order: {"steps": [{"text" (≤${STEP_MAX_WORDS} words, his own words as for StepCards), "at": "@words"}]} (a choice
  — "…, or …" — is part of the step before it, never the next step, as for StepCards; the labels sit side by side
  on ONE line, so all of them together hold at most ${stepStripMaxChars(3)} characters with three steps, ${stepStripMaxChars(4)} with four)
- Checklist — lists 2-4 signs or things to check (each ticked as said) (over b-roll): {"title": "2-4 words", "items": [{"text" (≤5 words), "at": "@words"}]}
- CrossedList — dismisses 2-3 things ("not the bowl, not the house"), optionally then names the real one (over b-roll): {"items": [{"text" (≤3 words), "icon" (optional), "at": "@words", "keep": true only for the real one}]}
- WarningLabel — names a danger or a mistake to avoid, in words that SAY it: read alone under its "WARNING"
  header, the line itself says what not to do or what goes wrong ("never", "don't", "not", "avoid", "too…",
  the harm or the bad result — "Never leave it plugged in overnight", "The glue fails in the cold"), or is
  a sentence of its own that only names the thing to avoid ("Cheap plastic hinges."). A line that tells the
  viewer to DO something is advice, not a warning: when the script warns with "do X, and [bad result]"
  ("Open it while it's hot, and the jar cracks"), the "do X" half alone reads as an instruction to do it —
  show words that name the danger, or show the right way with another template, or nothing:
  {"text": phrase (≤10 words), "emphasis"}
- IconLabels — names 1-3 right things to look for or buy: {"items": [{"icon" (optional),"text" (1-3 words),"say","at"}]}
- IconCallout — makes one short point that one object says well, ONLY when one emoji IS that object (else a
  DimCaption) (over b-roll): {"icon" (required), "phrase": phrase (≤8 words), "emphasis"}
- SmallLabel — names the thing or person the picture SHOWS (its shows / person / thing) when the line names it, one name per picture (over b-roll): {"text": "1-4 words as said", "at": "@words"}
- NumberLabel — says two values together: two compared, a range, or one for each of two things (over b-roll): {"kicker", "a": {"label","value","at"}, "b": {"label","value","at"}, "compare": true (optional)}
  ("compare": true draws "vs" between the two, ONLY when the line weighs one value against the other — then
  and now, what was planned and what it took, this one against that one. A range ("$20 to $50"), two values
  listed with "and" or offered with "or" ("$3 a cup and $8 a bag"), or two different measures (a time and a
  cost) are not compared: leave "compare" out, and the two stand side by side)
- BarChart — says 2-4 numbers to compare (over b-roll): {"title", "bars": [{"label","value": number,"display": "as said","at": "@the number"}]}
- BigNumberOverlay — says a number that matters while the picture matters too (over b-roll): same props as BigNumber
- DimCaption — a striking line over b-roll: {"phrase": phrase (≤10 words), "emphasis"}
- ArrowCaption — a line pointing at something in the picture ("this one", "that disc", "right here") (over b-roll): {"phrase": phrase (≤10 words), "emphasis"}
- MythStamp — says a myth over footage (no correction card needed): {"label": "Myth", "at": "@the myth's key words", "phrase": phrase (optional, ≤10 words)}
- Quote — the host's OWN advice or saying, in one memorable line (over b-roll): {"quote": ONE WHOLE SENTENCE (≤16 words), "author": "the host's name", "emphasis"}.
  It is signed with the host's name, so it is never words the script gives someone ELSE to say: a line
  the viewer is told to say or ask ("Just ask: Could I get that in writing, please?"), a request to a
  clerk or a server, or what another person said — signed, it reads as if the host said it. Show such a
  line as a DimCaption (no name), or nothing
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
- A graphic that HIDES the picture (a full-screen card, a window graphic, a Quote) leaves no blink of a
  shot. Either it stays to the picture change — after its last word only the rest of its own sentence is
  said, and the change comes within ${CARD_HOLD_MAX_SEC} s of that sentence's end — or the shot plays on ${MIN_SHOT_SEC} s or
  more after it leaves (the change at least ${(LINGER_SEC + MIN_SHOT_SEC).toFixed(1)} s after its last word). Otherwise show that line over the footage.
- WHAT THE PICTURE SHOWS. Each b-roll scene in the list says whether its picture is a STILL or a moving
  VIDEO, whether it is the picture of ONE list item or step, and {what it shows}. A SmallLabel names what
  ITS picture shows (its shows / person / thing), never a name the line says while the picture shows
  someone or something else — that name goes on words said over the picture that shows it, or nowhere —
  and one picture takes one name. A full-screen card or a Quote never hides a VIDEO whole: leave at least
  ${VIDEO_MIN_SEEN_SEC} s of it in view (half of a shorter one), or show the line over the footage. A spoken list or steps
  whose items each have their own picture (LIST ITEM / STEP PICTURE scenes) goes OVER the footage —
  StepLabels for steps, a ListWindow, Checklist or IconLabels for things — never a full-screen card that
  hides those pictures.
${opts.kept ? `\nSOME GRAPHICS ARE ALREADY PLACED AND APPROVED (listed in the message). Keep them exactly; add every other\nmoment around them, never overlapping them.\n` : ""}
Answer with JSON only: {"cues": [ ... ]} in film order, NEW graphics only. Each cue:
{"id": "short-kebab-name", "template": "...", "start": "the exact spoken words it starts on (4-7 words, unique enough to find)",
 "startPad": -0.15, "end": "the exact spoken words it ends on (2-6 words)", "endPad": 0.3, "props": {...}}
"start" and "end" are copied word for word from the script.
${CATALOGUE}`;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
/** A split the operator turned round (host on the right, `hostPanel`) is named as it is drawn. */
const splitKind = (s: LayoutScene) => (s.hostPanel && s.hostPanel.x > 0 ? "SPLIT (host right, picture left)" : "SPLIT (host left, picture right)");
const kindOf = (s: LayoutScene) => (s.cta ? "CTA" : s.split ? splitKind(s) : s.hostPresent ? "HOST" : "B-ROLL");

/**
 * What is said over each scene (one line per `film.scenes` entry), as the FILM'S OWN SOUND has it:
 * the transcript's words whose middle falls inside the scene's span — the clock the resolver times a
 * cue on and the rules hold it to. The scene's script text used to be read instead, and the two can
 * disagree: Dale's job 397 put "…can gross $500 to $1,500. Number five." under b-roll scene 35 while
 * the film says "$500 to $1,500. Number five," over host scene 36 (from 188.73 s), so the planner
 * asked for a number label over b-roll that the rules then refused as over the host.
 * Where the words heard in a span ARE the scene's script, word for word as the resolver matches
 * them (a number read as digits, a compound split, one misheard word), the script's own text is
 * kept: the same words on the same clock, spelled as written — the planner copies a line onto the
 * screen, and Hank's "out of square" heard as "out a square" (job 398) must not be shown that way.
 * A span with no words heard keeps its script text. Pure.
 */
export function wordsSaidOver(film: FilmLayout, words: Word[]): string[] {
  const heard: Word[][] = film.scenes.map(() => []);
  for (const w of words) {
    const mid = (w.start + w.end) / 2;
    const k = film.scenes.findIndex(s => mid >= s.narrationStartSec && mid < s.narrationEndSec);
    if (k >= 0) heard[k].push(w);
  }
  return film.scenes.map((s, k) => {
    const script = (s.scriptText ?? "").trim();
    const index = indexWords(heard[k]);
    if (!index.length) return script;
    const hits = script ? findVerbatim(index, script, 0) : null;
    if (hits && hits[0] === 0 && index[hits[hits.length - 1]].word === index[index.length - 1].word) return script;
    return heard[k].map(w => w.text.trim()).join(" ");
  });
}

/** The message the model reads: the film scene by scene, its b-roll stretches, and the graphics
 * already placed and approved. What is said over each scene is `wordsSaidOver` — the words the
 * film's sound has under it (its script text when there is no transcript, as in a test). */
export function userPrompt(film: FilmLayout, kept: ResolvedCue[], words: Word[] = []): string {
  const nameTag = nameTagRange(film);
  const said = wordsSaidOver(film, words);
  const layout = film.scenes
    .map((s, k) => {
      const tagUp = nameTag && s.narrationStartSec < nameTag[1] && s.narrationEndSec > nameTag[0] ? " [NAME TAG UP]" : "";
      // What a b-roll picture is and shows (`pictureNote`): job 409's "Paulinus" label went on the
      // picture of Seneca because the planner read "B-ROLL" and the words, nothing more.
      const kind = kindOf(s);
      return `#${s.index} ${mmss(s.narrationStartSec)}-${mmss(s.narrationEndSec)} ${kind}${kind === "B-ROLL" ? pictureNote(s) : ""}${tagUp}: ${said[k]}`;
    })
    .join("\n");
  // Stretches of consecutive b-roll (no host, no CTA): where cards and picture graphics go.
  const stretches: { from: number; to: number; text: string }[] = [];
  film.scenes.forEach((s, k) => {
    if (s.hostPresent || s.cta) return;
    const last = stretches[stretches.length - 1];
    if (last && Math.abs(last.to - s.narrationStartSec) < 0.1) {
      last.to = s.narrationEndSec;
      last.text += " " + said[k];
    } else stretches.push({ from: s.narrationStartSec, to: s.narrationEndSec, text: said[k] });
  });
  const stretchList = stretches
    .filter(b => b.to - b.from >= 2.5)
    .map(b => `${mmss(b.from)}-${mmss(b.to)} (${(b.to - b.from).toFixed(1)} s): ${b.text}`)
    .join("\n");
  const keptNote = kept.length
    ? `\n\nALREADY PLACED AND APPROVED (keep; do not repeat them; add around them):\n${kept.map(c => `${mmss(c.start)}-${mmss(c.end)} ${c.template} "${c.id}"`).join("\n")}`
    : "";
  return `THE FILM, scene by scene (time, what is on screen, what is said). A b-roll picture says whether it is a STILL
or a moving VIDEO, whether it is the picture of ONE spoken list item or step, and {what it shows}:
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

/**
 * Words that make a line say what to AVOID or what goes WRONG: a negation, a word for steering clear,
 * "too" + a word, a requirement said as one, or the danger or bad result itself. A WarningLabel's line
 * is read ALONE under its "WARNING" header, so without one of these it reads as advice to do the
 * thing: Helena's job 399 (2:13) showed "Ask while the cart is still working its way back," — the
 * first half of "…, and you're asking the crew to guess whether the last few rows will come up
 * short", which is advice NOT to ask then; the planner's own id was "dont-ask-too-early". Every
 * warning the planner placed before passes (planner.test.ts). A requirement ("has to", "must") counts
 * because it can never be the "do X" half of a "do X, and [bad result]" warning.
 * (Joined from parts, one kind of word to a line.)
 */
const NAMES_A_DANGER = new RegExp(
  [
    // a negation: "not for hot food", "No date at all?", "doing absolutely nothing", "don't"
    "\\b(?:no|not|never|nothing|none|nobody|nowhere|neither|nor|without|cannot|unless|otherwise|or else)\\b",
    "n't\\b",
    // steering clear of it: "Keep all ten fingers away from…"
    "\\b(?:avoid(?:s|ed|ing)?|stop(?:s|ped|ping)?|careful(?:ly)?|cautio(?:n|us)|beware|warn(?:s|ed|ing|ings)?|watch out|look out|away from|stay (?:away|back|clear|off|out)|clear of|out of reach)\\b",
    "\\bkeep (?:\\S+ ){1,4}away\\b",
    // too much of it: "too early", "too hot"
    "\\btoo [a-z]",
    // a requirement said as one: "Every notch has to be dead on"
    "\\b(?:must|has to|have to|had to|need to|needs to|got to|gotta)\\b",
    // the danger or the bad result itself
    "\\b(?:dangers?|dangerous(?:ly)?|hazards?|hazardous|risks?|risky|mistakes?|mistaken|wrong(?:ly)?|bad|badly|worse|worst|unsafe|harm(?:s|ed|ful|ing)?|hurts?|hurting|injur(?:e|es|ed|y|ies|ing)|toxic|poison(?:s|ed|ous)?|deadly|fatal|kill(?:s|ed|ing)?|die|dies|died|dying|death|fires?|burn(?:s|ed|t|ing)?|scald(?:s|ed|ing)?|shock(?:s|ed|ing)?|explod(?:e|es|ed|ing)|explosion|break|breaks|breaking|broke|broken|crack(?:s|ed|ing)?|fail(?:s|ed|ing|ure|ures)?|ruin(?:s|ed|ing)?|damag(?:e|es|ed|ing)|destroy(?:s|ed|ing)?|lose|loses|losing|lost|loss|wast(?:e|es|ed|ing)|spoil(?:s|ed|ing|t)?|rot|rots|rotted|rotten|rotting|mou?ld(?:y|s)?|leak(?:s|ed|ing)?|warp(?:s|ed|ing)?|expir(?:e|es|ed|ing|y)|problems?|trouble|illegal|scams?|regret(?:s|ted)?|costs? you)\\b",
    "\\b(?:runs? out|ran out|running out|comes? up short|came up short)\\b",
  ].join("|"),
  "i"
);

/**
 * A SENTENCE OF ITS OWN THAT NAMES A THING — commanding nothing and speaking to no one — names the
 * danger by itself under the WARNING header (as "Wet floor" does on a sign), and cannot tell the viewer
 * to DO anything: the "do X" half of a warning needs a command. Scarlett's job 395 placed "Chunky black
 * or very dark beads." right after "Now the one that's aging you."; no danger word is in it, and it is
 * a good warning. Not one when it has a helper verb or a contraction ("is", "can", "'ll"), a person
 * ("you", "your", "it" — "Sort your finished pieces by size and price", Dale's job 397), a clause word
 * ("while", "until"), or a command verb first ("Use…", "Leave…" — Dale's job 389 placed "Either way,
 * leave enough room in the price", the right way, which belongs in another template). And it must end
 * its sentence (".", "!", "?"): a line stopped at a comma or before "but" may be the safe half of a
 * contrast whose warning comes after it. (A possessive "'s" is not a sign — "a neighbour's ladder" is
 * a thing.)
 */
const CLAUSE_SIGN =
  /\b(?:is|are|was|were|be|been|being|am|do|does|did|has|have|had|will|would|shall|should|can|could|may|might|i|you|your|yours|he|she|it|we|they|me|him|us|them|my|our|their|while|until|till|when|whenever|if|because|whether)\b|'(?:re|ve|ll|d|m)\b/;
const OPENERS = /^(?:(?:so|and|but|or|now|then|just|also|always|first|next|instead|simply|plus|please|okay|well|either way)\b[\s,.]*)+/;
const COMMAND_VERBS = new Set(
  (
    "add apply ask bake boil bring buy call carry check choose clean close cook cover cut dip do drill drink drive drop dry eat " +
    "fill find fix fold follow get give glue go grab hang heat hold keep leave let lift load lock look make measure mix move oil " +
    "open order pack paint pay pick place plug pour press pull push put read remember remove rinse run sand save sell send set " +
    "shop show sit soak sort spend spray start stir store switch take tap tell think throw tie try turn unplug use wait walk wash " +
    "watch water wear wipe wrap write"
  ).split(" ")
);
function namesAThingAlone(line: string): boolean {
  if (!/[.!?]["”']?$/.test(line) || CLAUSE_SIGN.test(line)) return false;
  const first = line.replace(OPENERS, "").split(/\s+/)[0]?.replace(/[^a-z0-9$']/g, "");
  return !!first && !COMMAND_VERBS.has(first);
}

/** Does a warning's line, read alone, say what to avoid or what goes wrong (`NAMES_A_DANGER`), or
 * name the thing to avoid in a sentence of its own (`namesAThingAlone`)? Pure. */
export function namesTheDanger(text: string): boolean {
  const line = text.trim().toLowerCase().replace(/[’‘]/g, "'");
  return NAMES_A_DANGER.test(line) || namesAThingAlone(line);
}

/**
 * A QUOTE IS THE HOST'S OWN WORDS. The card signs its line with the host's name, so a line the
 * script hands someone ELSE to say reads as the host saying it: Helena's job 399 (1:23) signed "Could
 * I keep the rest of the can, please?" with her name, right after "So when the cart reaches your row,
 * speak up." — the words she tells the VIEWER to say to the crew; signed, she (a flight attendant)
 * was the one asking for the can.
 *
 * HANDS_A_LINE is how the words leading into it hand the viewer a line, at their very end: a speech
 * verb as a command, at the start of a clause ("speak up", "ask", "just say", "tell them"), with only
 * a person or a word on how after it ("ask the crew", "say it plainly", "Just ask:"). A speech verb with
 * a subject is the host speaking ("here's what I tell everyone who asks"), and one followed by what
 * it is about hands over nothing (Dale's job 389: "…and tell me in the comments which of the three
 * sells best where you live." before his own signed "Build it well, price it honest, …").
 * An adverb is part of the COMMAND only at the start of a clause ("Just ask:", "so always ask", "why
 * not just ask"): after a subject it is the host telling what they do themselves — "Like I always say,"
 * / "As I always tell them:" lead into the host's OWN saying, the very line a Quote is for.
 * (Joined from parts: where the command starts, its adverbs, the verb, to whom, how.)
 */
const HANDS_A_LINE = new RegExp(
  [
    "(?:^|[,;:]\\s*|\\b(?:so|then|and|now|instead|why not)\\s+|\\byou (?:can|could|should|might|may|will|just)\\s+)",
    "(?:(?:just|simply|always|politely|nicely|kindly|instead|now|then)\\s+)*",
    "(?:speak|pipe up|say|ask|tell|request|call out|try saying|try asking|go with)",
    "(?: (?:to )?(?:them|him|her|someone|somebody|anyone|anybody|(?:the|your|a|an) [a-z']+(?: [a-z']+)?))?",
    "(?: (?:up|out|this|it|that|something like this|something like|like this|like so|for it|nicely|politely|kindly|plainly|simply|directly|out loud|aloud|clearly|instead|first|again))*$",
  ].join("")
);
/** A REQUEST TO SOMEONE, whoever says it: a question asked with "please" (job 399's "Could I keep the
 * rest of the can, please?"), "would you mind…", "excuse me…", or wanting something with "please"
 * ("I'd like the aisle seat, please."). Never the host's own saying. The "please" is the courtesy word
 * (`asksPolitely`), never the verb. */
const A_REQUEST = /^(?:would|do) you mind\b|^(?:excuse|pardon) me\b/;
const WANTS_SOMETHING = /^(?:i|we)(?:'d| would|'ll| will)? (?:like|love|take|have|want|need|prefer)\b/;
/** "please" as a VERB — to please someone — asks nothing: "You can't please everyone, so why try?" and
 * "We want to please everyone, and that is the trap." are a host's own sayings. */
const PLEASE_AS_VERB =
  /\b(?:to|can't|cannot|can not|couldn't|won't|never|trying to|try to)\s+please\b|\bplease\s+(?:everyone|everybody|anyone|anybody|nobody|no one|people|others|them|him|her|yourself|myself|ourselves|themselves|the (?:crowd|customers?|buyers?|people))\b/g;
const asksPolitely = (q: string) => /\bplease\b/.test(q.replace(PLEASE_AS_VERB, ""));
/** A line that sounds SAID TO SOMEONE, read once the words before it hand the viewer a line: a
 * question in the first person ("Can we get the bigger one?"), a word of asking (`asksPolitely`) or
 * thanks, or wanting something ("I'll take the whole jar.", `WANTS_SOMETHING`). The host's own question
 * to the viewer ("What's the worst they can say?") and the host's own advice ("Nobody minds being asked
 * twice.") have none of these: after "speak up" they are still the host's. */
const SAID_TO_SOMEONE = /\b(?:i|i'm|i'd|i'll|i've|me|my|we|we're|we'd|we'll|us|our)\b.*\?$|\b(?:thanks|thank you|excuse me|pardon me)\b/;

/**
 * Why a Quote's line is NOT the host's own statement — words the narration hands the viewer to say
 * (`before`, the words leading into it, ends handing a line, and the line sounds said to someone or
 * the script puts it in quotation marks: `quoted`), or a request to someone at all — or undefined when
 * it may be signed with the host's name. Pure.
 */
export function notTheHostsWords(quote: string, before = "", quoted = false): string | undefined {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
  const q = norm(quote).replace(/^"+|"+$/g, "").trim();
  const polite = asksPolitely(q);
  if (A_REQUEST.test(q) || (polite && (/\?$/.test(q) || WANTS_SOMETHING.test(q)))) return "it is a request to someone, not a saying of the host's";
  const lead = norm(before).replace(/[\s"'.,;:!?…-]+$/, "");
  if (HANDS_A_LINE.test(lead) && (quoted || /^"/.test(norm(quote)) || polite || WANTS_SOMETHING.test(q) || SAID_TO_SOMEONE.test(q))) {
    const tail = lead.split(" ").slice(-3).join(" ");
    return `the narrator hands it to the viewer to say ("…${tail}")`;
  }
  return undefined;
}

/** The words leading into word `first`: back to the end of the sentence before (the same sentence's
 * opening when the line starts inside one), at most 30 words. Pure. */
function wordsLeadingInto(words: Word[], first: number): string {
  const out: string[] = [];
  for (let i = first - 1; i >= 0 && out.length < 30; i--) {
    const t = words[i].text.trim();
    if (out.length && /[.?!]["”')]*$/.test(t)) break;
    out.unshift(t);
  }
  return out.join(" ");
}

/** Does the SCRIPT open a quotation mark on this line — someone's speech inside the narration? The
 * film's sound carries no quotation marks (job 399 heard "speak up. Could I keep…"; its script reads
 * `speak up. "Could I keep…"`). Read from the scenes the line is said over; a straight mark counts as
 * opening only after a space, a colon or a dash, so the CLOSING mark of the speech before (`"No." Could
 * I…`) is not one. Pure. */
export function quotedInScript(film: FilmLayout, from: number, to: number, line: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  const script = norm(
    film.scenes
      .filter(s => s.narrationEndSec > from - 0.5 && s.narrationStartSec < to + 0.5)
      .map(s => s.scriptText ?? "")
      .join(" ")
  );
  const want = norm(line).replace(/^["“”]+|["“”]+$/g, "").trim();
  for (const w of [want, want.replace(/[.?!,;:]+$/, "")]) {
    const at = w ? script.indexOf(w) : -1;
    if (at >= 0) return /(?:“|(?:^|[\s:(—-])")\s*$/.test(script.slice(Math.max(0, at - 4), at));
  }
  return false;
}

/**
 * STEPS ARE DONE ONE AFTER ANOTHER. StepLabels and StepCards number every step and draw an arrow into
 * it from the one before, so a step the line offers as a CHOICE reads as the next thing to do: Helena's
 * job 399 (2:19) chained "1 Wait until served → 2 Catch an attendant → 3 Or step to galley → 4 Phrase
 * it as offer" on "So wait until everyone's been served, then catch a flight attendant as they pass, or
 * step back to the galley and phrase it as an offer." Stepping back to the galley is another way to
 * reach the crew, and the arrows told the viewer to do both.
 *
 * A step after the first is a choice when its shown text or its spoken words ("at", "say") open on
 * "or" / "or else" / "alternatively" (`OFFERS_A_CHOICE`), or the narrator says one of them right before
 * its first word (`before(k)`: the words leading into step k, when it resolved). The first step never
 * is: "Or look underneath this video, open the description, and tap the link" (the same film) offers
 * the whole sequence as a choice, and its steps are still done in order. An "or" INSIDE a step ("Wait
 * a minute or two") is part of it. Returns the steps that are choices, counted from 0. Pure.
 */
const OFFERS_A_CHOICE = /^(?:or|alternatively)\b/;
export function choiceSteps(steps: unknown, before: (k: number) => string | undefined = () => undefined): number[] {
  if (!Array.isArray(steps)) return [];
  const opens = (v: unknown) => {
    const s = typeof v === "string" ? v : (v as { text?: unknown } | null)?.text;
    return typeof s === "string" && OFFERS_A_CHOICE.test(s.trim().replace(/^@/, "").replace(/^["“'‘(]+/, "").toLowerCase());
  };
  const out: number[] = [];
  steps.forEach((step, k) => {
    if (k === 0 || !step || typeof step !== "object") return;
    const o = step as { text?: unknown; at?: unknown; say?: unknown };
    const lead = (before(k) ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const saidFirst = ["or", "alternatively"].includes(lead[lead.length - 1] ?? "") || lead.slice(-2).join(" ") === "or else";
    if (opens(o.text) || opens(o.at) || opens(o.say) || saidFirst) out.push(k);
  });
  return out;
}

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

/** A word as compared: lower case, no punctuation ("throne," is "throne", "Rome’s" is "rome's"). */
const plainWord = (w: string) => w.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']/g, "");
/** The words a headline leaves out: an article or a possessive, the "own" after one, and the "it" or
 * "them" of a step ("Phrase as offer" for "phrase it as an offer", Helena's job 402). */
const GRAMMAR_WORD = /^(?:a|an|the|his|her|its|their|my|your|our|own|it|them)$/;
/** Words a row never ends on: each needs the word after it ("…at two IN", "…to end HIS", "…as AN",
 * "the cousin WHOM"). */
const HANGING_WORD = /^(?:a|an|the|his|her|its|their|my|your|our|own|of|in|on|at|to|for|from|with|by|into|onto|as|like|than|until|without|and|or|but|that|who|whose|whom|which|where|when)$/;
/** A row's first letter in capitals. */
const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** An article or a possessive: one opens a noun phrase, and two never stack ("her the truth"). */
const DETERMINER_WORD = /^(?:a|an|the|his|her|its|their|my|your|our)$/;
/** The possessives, the only words an "own" follows ("his own life"). */
const POSSESSIVE_WORD = /^(?:his|her|its|their|my|your|our)$/;

/**
 * Where a row starting at spoken word `i` starts once the article or possessive said right before
 * it is taken back ("a | second bag of pretzels", "his own | life"): one of them, or a possessive and
 * its "own" — never one before a row that opens on its own ("tell her | the truth" is not "Her the
 * truth"), never "own" the verb ("if you own | a truck"), and "her" only where it cannot be the
 * object of the verb before it ("pour her | coffee", "give her | flowers"): as the first word said,
 * after "and"/"or"/a comma, or before "own". Pure.
 */
function leadIn(s: string[], spoken: string[], i: number): number {
  if (DETERMINER_WORD.test(s[i])) return i;
  const from = i > 1 && s[i - 1] === "own" && POSSESSIVE_WORD.test(s[i - 2]) ? i - 2 : i > 0 && DETERMINER_WORD.test(s[i - 1]) ? i - 1 : i;
  if (from === i || s[from] !== "her" || s[from + 1] === "own") return from;
  return from === 0 || /^(?:and|or|plus|then)$/.test(s[from - 1]) || /[,;:]$/.test(spoken[from - 1]) ? from : i;
}

/** Words shown as a row or a step: a capital first letter, no closing comma or full stop. */
const shownRow = (words: string[]) => capitalized(words.join(" ").replace(/[.,;:]+$/, ""));

/**
 * Words a row or a step may lose to fit its limit: they shade what is said and never carry it ("the
 * young are ALREADY rehearsing the complaint"). Never "not", "never", "only", "still" or "even",
 * which change it.
 */
const FILLER_WORD = /^(?:already|just|really|actually|simply|very|quite|basically|literally|honestly|truly)$/;
/** `words` without filler words (`FILLER_WORD`), left to right, until they fit `max` — never the first word. */
function withoutFillers(words: string[], max: number): string[] {
  const out = [...words];
  for (let k = 1; k < out.length && out.length > max; ) {
    if (FILLER_WORD.test(plainWord(out[k]))) out.splice(k, 1);
    else k++;
  }
  return out;
}

/** Words that open what a verb or a preposition takes: an article or a possessive, a word for how
 * many, a pronoun or a number ("rehearsing | THE complaint", "until | EVERYONE'S been served"). */
const OPENS_AN_OBJECT =
  /^(?:a|an|the|his|her|its|their|my|your|our|this|that|these|those|it|them|him|me|us|everyone|everybody|everything|someone|somebody|something|anyone|anybody|anything|nobody|nothing|all|each|every|both|some|any|no|many|few|most|another|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|hundred|\d[\d,.]*)$/;
/** A preposition: it takes the words after it ("phrase it AS | an offer", "wait UNTIL | everyone's been served",
 * "rived the boards ALONG | those same lines"). */
const PREPOSITION_WORD =
  /^(?:of|in|on|at|to|for|from|with|by|into|onto|as|like|than|about|until|till|without|within|between|among|against|toward|towards|through|throughout|across|along|around|behind|beside|below|above|beneath|under|underneath|over|near|past|beyond|inside|outside|upon|via|per|during|before|after|since|despite|except)$/;
/** Words a verb follows: a helping verb ("you WILL take | the money") or a subject ("you NEED | a drill"). */
const BEFORE_A_VERB = /^(?:will|would|can|could|should|must|may|might|shall|do|does|did|don't|doesn't|didn't|won't|can't|cannot|wouldn't|shouldn't|couldn't|i|you|we|they|he|she)$/;
/** Words a "to" + verb follows ("ordered to END | his own life"): a verb in -ed, or a common verb that takes one. */
const BEFORE_TO_VERB = /^(?:[a-z]+ed|want|wants|need|needs|have|has|had|going|used|how|able|try|tries|trying|learn|forget|remember|decide)$/;
/** Words a noun follows, so an "-ing" word after one is a thing ("the wedding", "every evening"). */
const BEFORE_A_NOUN = /^(?:a|an|the|his|her|its|their|my|your|our|this|that|these|those|every|each|no|some|any|one)$/;
/** "-ing" words that are things wherever they stand ("everything", "morning"). */
const ING_THING = /(?:thing|morning|evening|ceiling|building|wedding|spring|string|king|ring)$/;
/** Words that start a new part of a sentence: what a verb takes stops before one, and an item may.
 * "whose" and "whom" too: without them a stored item "…for anybody whose dog greets them" (job 357)
 * found no place to stop but "This one's". */
const JOINING_WORD = /^(?:and|or|but|that|who|whose|whom|which|where|when|while|because|if|then|so)$/;
/** A word the narrator ends on a pause or a sentence's end. */
const ENDS_ON_A_PAUSE = /[,;:.!?]["”')]*$/;
/** Words that lead into where or how ("into the chain space | RIGHT beside your hook"): an item may stop before one. */
const LEADS_A_PLACE = /^(?:right|almost|nearly|exactly|directly|straight)$/;

/** A word's form as a step may change it: no possessive, no "-ing", "-ed", "-es" or "-s", no final
 * "e" — "rived" and "Rive", "asking" and "Ask", "served" and "serve" (job 407's "Rive the boards"
 * for "they rived the boards"). */
function wordBase(w: string): string {
  let t = w.replace(/'s$/, "").replace(/'$/, "");
  if (t.length >= 6 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length >= 5 && /ie[sd]$/.test(t)) t = `${t.slice(0, -3)}y`;
  else if (t.length >= 5 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length >= 5 && /(?:ss|x|z|ch|sh)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length >= 4 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t.length >= 4 && t.endsWith("e") ? t.slice(0, -1) : t;
}
/** One word for another as a shown row or step may have it: the resolver's measure (`sameWord`) or the same form (`wordBase`). */
const sameForm = (a: string, b: string) => sameWord(a, b) || wordBase(a) === wordBase(b);

/**
 * Does a row (its words, as compared) end on a word that takes what follows it: a preposition, an
 * "-ing" verb ("are already REHEARSING"), a verb after a helping verb or a subject ("you NEED"), or a
 * verb after "to" ("ordered to END")? A step is said as a command, so a step of one word is its verb
 * ("Catch | a flight attendant"). Pure.
 */
function takesWhatFollows(row: string[], step: boolean): boolean {
  const last = row[row.length - 1] ?? "";
  const prev = row[row.length - 2] ?? "";
  if (PREPOSITION_WORD.test(last)) return true;
  if (last.length >= 5 && last.endsWith("ing") && !ING_THING.test(last) && !BEFORE_A_NOUN.test(prev)) return true;
  if (row.length >= 2 && BEFORE_A_VERB.test(prev)) return true;
  if (prev === "to" && BEFORE_TO_VERB.test(row[row.length - 3] ?? "")) return true;
  return step && row.length === 1;
}

/**
 * Where a row stops right before the words its last word takes, read against its spoken words: the
 * row's last word, said after where its first word is said, is followed by words that open what it
 * takes (`OPENS_AN_OBJECT`) and it takes them (`takesWhatFollows`). Undefined when the row ends where
 * the narrator ends, on a pause ("served,"), or on a word that needs nothing more. `object` is those
 * words: up to a pause, a joining word or a preposition, at most six. Pure.
 */
function cutBeforeObject(text: string, say: string, step: boolean): { at: number; object: string[]; spoken: string[]; s: string[] } | undefined {
  const row = text.trim().split(/\s+/).map(plainWord).filter(Boolean);
  const spoken = say.trim().split(/\s+/).filter(Boolean);
  const s = spoken.map(plainWord);
  if (!row.length || !s.length) return undefined;
  const last = row[row.length - 1];
  const first = Math.max(0, s.findIndex(w => sameForm(w, row[0])));
  let j = s.findIndex((w, k) => k >= first + row.length - 1 && sameForm(w, last));
  if (j < 0) j = s.findIndex((w, k) => k >= first && sameForm(w, last));
  if (j < 0 || j >= s.length - 1 || ENDS_ON_A_PAUSE.test(spoken[j])) return undefined;
  if (!OPENS_AN_OBJECT.test(s[j + 1].replace(/'s$/, "")) || !takesWhatFollows(row, step)) return undefined;
  const object: string[] = [];
  for (let k = j + 1; k < spoken.length && object.length < 6; k++) {
    if (object.length && (JOINING_WORD.test(s[k]) || PREPOSITION_WORD.test(s[k]))) break;
    object.push(spoken[k]);
    if (ENDS_ON_A_PAUSE.test(spoken[k])) break;
  }
  return { at: j, object, spoken, s };
}

/**
 * The words a row or a step stops before although its last word takes them — "the complaint" for
 * "The young are already rehearsing" when he says "…already rehearsing the complaint" (Gideon's job
 * 409, 2:41) — or undefined. `step`: a one-word step is a verb. Pure.
 */
export function objectCutOff(text: string, say: string, step = false): string | undefined {
  const cut = cutBeforeObject(text, say, step);
  return cut ? cut.object.join(" ").replace(/[.,;:!?]+$/, "") : undefined;
}

/**
 * The row's words in the spoken words (as compared), in order, with only grammar words between them
 * (`GRAMMAR_WORD`): where it starts and ends there, the first place it is found. Pure.
 */
function rowInSpoken(r: string[], s: string[]): { i: number; j: number } | undefined {
  if (!r.length || r.some(w => !w)) return undefined;
  for (let i = s.indexOf(r[0]); i >= 0; i = s.indexOf(r[0], i + 1)) {
    let j = i;
    let k = 1;
    for (; k < r.length; k++) {
      let n = j + 1;
      while (n < s.length && s[n] !== r[k] && GRAMMAR_WORD.test(s[n])) n++;
      if (n >= s.length || s[n] !== r[k]) break;
      j = n;
    }
    if (k === r.length) return { i, j };
  }
  return undefined;
}

/**
 * A ROW KEEPS WHAT ITS LAST WORD TAKES. Cut to its limit, a row stopped on a verb or a preposition
 * with what it takes cut off: Gideon's job 409 (2:41) showed "The young are already rehearsing" for
 * "…and the young are already rehearsing the complaint", a broken thought under "The farmer
 * complains". A row that is the spoken words with only grammar left out takes those words back
 * (`objectCutOff`) and, to fit `max`, leaves out a filler word ("The young are rehearsing the
 * complaint"); one that cannot is kept as written, and the check refuses it. Pure.
 */
export function keepObject(text: string, say: string, max: number, step = false): string {
  const cut = cutBeforeObject(text, say, step);
  if (!cut) return text;
  const at = rowInSpoken(text.trim().split(/\s+/).map(plainWord), cut.s);
  if (!at || at.j !== cut.at) return text;
  const words = withoutFillers(cut.spoken.slice(leadIn(cut.s, cut.spoken, at.i), cut.at + 1 + cut.object.length), max);
  return words.length <= max ? shownRow(words) : text;
}

/**
 * An item as a list row: its spoken words with their grammar ("A waiting room", never "Waiting
 * room"), at most `ROW_MAX_WORDS`, a capital first letter. The joining "and"/"or", and the "as" of
 * "as rest", are left off. An item over the limit loses a filler word first ("the young are already
 * rehearsing the complaint" → "The young are rehearsing the complaint", job 409), then stops where
 * the item may stop — after a comma, or before a preposition, a joining word, a "right" or the next
 * noun phrase's first word ("The kitchen table at two | in the morning", "An old cast iron skillet |
 * my grandmother left me") — and never on a word that needs the next, nor before what its last word
 * takes: the cut used to stop wherever the words ran out ("The kitchen table at two in", "The young
 * are already rehearsing", "Rived the boards along those same", job 407). An item that may stop
 * nowhere ("the young are rehearsing the same old | bitter complaint") is kept whole, and the row
 * limit refuses it rather than show it cut mid-thought.
 */
function rowText(item: string): string {
  const words = item.replace(/^(?:as|and|or)\s+/i, "").replace(/[.,;:!?]+$/, "").split(/\s+/).filter(Boolean);
  if (words.length <= ROW_MAX_WORDS) return shownRow(words);
  const lean = withoutFillers(words, ROW_MAX_WORDS);
  if (lean.length <= ROW_MAX_WORDS) return shownRow(lean);
  for (let k = ROW_MAX_WORDS; k >= 2; k--) {
    const w = lean.slice(0, k);
    const last = plainWord(w[k - 1]);
    const next = plainWord(lean[k]);
    const stops = ENDS_ON_A_PAUSE.test(w[k - 1]) || PREPOSITION_WORD.test(next) || JOINING_WORD.test(next) || LEADS_A_PLACE.test(next) || OPENS_AN_OBJECT.test(next.replace(/'s$/, ""));
    if (stops && !HANGING_WORD.test(last) && !objectCutOff(w.join(" "), lean.join(" "))) return shownRow(w);
  }
  return shownRow(words);
}

/**
 * A ROW KEEPS THE SPOKEN WORDS' GRAMMAR. A row the planner clipped from its item's spoken words by
 * leaving out only the articles and possessives between them reads like a headline: Gideon's job 400
 * (2:03) showed "One step from throne" for "an advisor standing one step from the throne" and
 * "Ordered to end life" for "…would be ordered to end his own life". Those words go back in — and an
 * article or possessive said right before the row's first word ("Second bag of pretzels" → "A second
 * bag of pretzels", `leadIn`) — when the row still fits `max` (`ROW_MAX_WORDS`; a step's is
 * `STEP_MAX_WORDS`, job 410's "Phrase it as offer"). A row in the planner's own words (it
 * left out a word that is not grammar, added one, or wrote a spoken number in digits) is its short
 * version and is kept as written: "Buried under obligations" for "buried under exactly the kind of
 * obligations…". Returns the row to show. Pure.
 */
export function restoreRowGrammar(text: string, say: string, max = ROW_MAX_WORDS): string {
  const row = text.trim().split(/\s+/).filter(Boolean);
  const spoken = say.trim().replace(/[.,;:!?]+$/, "").split(/\s+/).filter(Boolean);
  const s = spoken.map(plainWord);
  const at = rowInSpoken(row.map(plainWord), s);
  if (!at) return text;
  const words = spoken.slice(leadIn(s, spoken, at.i), at.j + 1);
  if (words.length === row.length || words.length > max) return text;
  return shownRow(words);
}

/* ───────────── Steps in his own words ───────────── */

/** The most spoken words read as one step's, from its first (the last step runs to its sentence's end). */
const STEP_SAID_MAX_WORDS = 14;
/** About how many characters of a step card's text fit on one line: 42 px Inter ExtraBold in a 320 px
 * column — job 410's card broke "Wait until all served" after "all" (14 characters in 254 px). */
const STEP_CARD_LINE_CHARS = 17;
/** The lines a step card has room for (it is 300 px tall): three, two under an icon. */
const STEP_CARD_LINES = 3;
const STEP_CARD_LINES_UNDER_ICON = 2;
/** About how many lines a step card's text takes, its words wrapped at `STEP_CARD_LINE_CHARS`. Pure. */
export function stepCardLines(text: string): number {
  let lines = 0;
  let len = 0;
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    if (!lines || len + 1 + w.length > STEP_CARD_LINE_CHARS) {
      lines++;
      len = w.length;
    } else len += 1 + w.length;
  }
  return lines;
}

/** About how wide (px) a strip of step labels with these texts is. Pure. */
export function stepStripWidth(texts: string[]): number {
  return Math.round(texts.reduce((n, t) => n + t.trim().length * STRIP_CHAR_PX + STRIP_PILL_PX, 0) + Math.max(0, texts.length - 1) * STRIP_ARROW_PX);
}

/**
 * What each step of a placed step graphic says, read off where it resolved: its own "say" when it has
 * one, else from its first spoken word ("at") to the next step's first word, the last step to the end
 * of its sentence — at most `STEP_SAID_MAX_WORDS`. `heard` is every word said from the graphic's start
 * word (`startAt`, seconds) to the end of its last step, and every step's "say"; empty when no step
 * is placed on spoken words. Pure.
 */
export function stepsAsSaid(steps: unknown[], c: ResolvedCue, words: Word[], startAt: number): { each: (string | undefined)[]; heard: string[] } {
  const firstWord = steps.map((_, k) => {
    const at = c.sync.find(x => x.element.startsWith(`steps[${k}].at `));
    return at ? words.findIndex(w => w.start === at.wordStart) : -1;
  });
  const own = steps.map(step => {
    const say = (step as { say?: unknown } | null)?.say;
    return typeof say === "string" && say.trim() ? say.trim() : undefined;
  });
  let last = -1;
  const each = steps.map((_, k) => {
    const i = firstWord[k];
    if (i < 0) return own[k];
    const next = firstWord.slice(k + 1).find(x => x > i);
    let end = Math.min(words.length, next ?? Infinity, i + STEP_SAID_MAX_WORDS);
    if (next === undefined)
      for (let e = i; e < end; e++)
        if (/[.?!]["”')]*$/.test(words[e].text.trim())) {
          end = e + 1;
          break;
        }
    last = Math.max(last, end);
    return own[k] ?? words.slice(i, end).map(w => w.text.trim()).join(" ");
  });
  const placed = firstWord.filter(i => i >= 0);
  const start = words.findIndex(w => w.start >= startAt - 1e-6);
  const from = Math.min(start < 0 ? Infinity : start, ...placed);
  const heard = placed.length && last > from ? words.slice(from, last).map(w => w.text.trim()) : [];
  return { each, heard: heard.length ? [...heard, ...own.filter((s): s is string => !!s)] : [] };
}

/** The articles a step may change as it shortens his words ("Catch an attendant" for "catch a flight attendant"). */
const ARTICLE = /^(?:a|an|the)$/;

/**
 * A STEP IS HIS OWN WORDS, WITH THEIR GRAMMAR. Job 410's step card (2:21) read "Wait until all served
 * → Ask in aisle or galley → Phrase it as offer" for "…wait until everyone's been served, then catch a
 * flight attendant as they pass or step back to the galley and phrase it as an offer": broken
 * headline English on a card held 8 s, and a middle step of words never said. List rows had their
 * grammar put back (`restoreRowGrammar`); steps did not.
 *
 * Each step (`said.each`, `stepsAsSaid`) first takes back, in place, the articles and the "it" left out
 * between its words and what its last word takes (`restoreRowGrammar`, `keepObject`, to
 * `STEP_MAX_WORDS`): "Phrase it as offer" is "Phrase it as an offer". Then it is held to:
 * - every word one the narrator says while the graphic is up (`said.heard`; an article aside, and a
 *   number is checked by `shownNumbers`), in any form ("Rive the boards" for "they rived the boards");
 * - no last word stopped before what it takes (`objectCutOff`, a step of one word being a verb);
 * - at most `STEP_MAX_WORDS`;
 * - room on screen: three lines in a card (two under an icon — a set whose text needs more loses its
 *   icons, which are optional, `iconsAsASet`), and a strip of labels inside the picture's
 *   action-safe edges (`stepStripWidth`).
 * Returns what is wrong, one problem each. Pure apart from mending `steps` in place.
 */
export function stepTextProblems(template: string, steps: unknown, said: { each: (string | undefined)[]; heard: string[] }): string[] {
  if (!Array.isArray(steps)) return [];
  const all = steps as ({ text?: unknown; icon?: unknown } | null)[];
  all.forEach((st, k) => {
    const say = said.each[k];
    if (st && typeof st.text === "string" && say) st.text = keepObject(restoreRowGrammar(st.text, say, STEP_MAX_WORDS), say, STEP_MAX_WORDS, true);
  });
  const shown = all.map((st, k) => ({ k, text: st && typeof st.text === "string" ? st.text.trim() : "", say: said.each[k] })).filter(s => s.text);
  const name = (s: { k: number; text: string }) => `step ${s.k + 1} ("${s.text}")`;
  const hint = (s: { say?: string }) => (s.say ? ` (he says "${s.say.replace(/[.,;:!?]+$/, "")}")` : "");
  const problems: string[] = [];
  const heard = said.heard.flatMap(w => tokens(w));
  if (heard.length)
    for (const s of shown) {
      const unsaid = Array.from(new Set(tokens(s.text).filter(t => !/^\d/.test(t) && !ARTICLE.test(t) && !heard.some(h => sameForm(h, t)))));
      if (unsaid.length)
        problems.push(`${name(s)} shows ${unsaid.map(t => `"${t}"`).join(", ")}, which the narrator does not say — a step is his own words, shortened${hint(s)}`);
    }
  for (const s of shown) {
    const cut = s.say ? objectCutOff(s.text, s.say, true) : undefined;
    if (cut) problems.push(`${name(s)} stops before "${cut}", which its last word needs — a step never ends on a word whose object is cut off; keep those words and shorten elsewhere`);
  }
  for (const s of shown) {
    const n = s.text.split(/\s+/).length;
    if (n > STEP_MAX_WORDS) problems.push(`${name(s)} is ${n} words — a step takes at most ${STEP_MAX_WORDS}: his own words, shortened`);
  }
  if (template === "StepCards") {
    if (shown.some(s => stepCardLines(s.text) > STEP_CARD_LINES_UNDER_ICON)) for (const st of all) if (st) delete st.icon;
    for (const s of shown) {
      const lines = stepCardLines(s.text);
      if (lines > STEP_CARD_LINES) problems.push(`${name(s)} takes about ${lines} lines, more than its card holds (${STEP_CARD_LINES}) — shorten it in his own words`);
    }
  } else if (template === "StepLabels") {
    const wide = stepStripWidth(shown.map(s => s.text));
    if (wide > STEP_STRIP_MAX_PX)
      problems.push(
        `the ${shown.length} steps side by side are about ${wide} px wide, wider than the picture allows (${STEP_STRIP_MAX_PX}) — shorten them in his own words, keeping his "a"/"the", or use fewer steps, or StepCards where the steps have no pictures of their own`
      );
  }
  return problems;
}

/** One run of words found whole inside another ("the farmer" in "the farmer complains"). */
function within(part: string[], whole: string[]): boolean {
  if (!part.length || part.length > whole.length) return false;
  for (let i = 0; i + part.length <= whole.length; i++) if (part.every((t, k) => whole[i + k] === t)) return true;
  return false;
}

/**
 * Are a list window's rows (each row's spoken words) the items of a list the pipeline found — each
 * row one item, in the order said, its words inside that item's or holding them ("The farmer" for
 * "The farmer complains")? Such a list passed the item rules when it was found. Pure.
 */
export function fromAFoundList(rows: string[], lists: { items: string[] }[]): boolean {
  if (!rows.length) return false;
  return lists.some(l => {
    let k = 0;
    return rows.every(row => {
      const r = tokens(row);
      while (k < l.items.length) {
        const item = tokens(l.items[k++]);
        if (within(r, item) || within(item, r)) return true;
      }
      return false;
    });
  });
}

/** A list window's rows as said: each item's "say", else its shown text. */
function listRows(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.map(it => {
    const o = (it ?? {}) as { say?: unknown; text?: unknown };
    return String(typeof o.say === "string" && o.say.trim() ? o.say : (o.text ?? "")).trim();
  });
}

/** What the script says around `a`-`b` (seconds): the scenes it overlaps and one either side, so a
 * sentence that starts in the scene before is whole. Pure. */
function scriptAround(film: FilmLayout, a: number, b: number): string {
  const over = film.scenes.map((s, k) => (s.narrationEndSec > a && s.narrationStartSec < b ? k : -1)).filter(k => k >= 0);
  if (!over.length) return "";
  return film.scenes
    .slice(Math.max(0, over[0] - 1), over[over.length - 1] + 2)
    .map(s => (s.scriptText ?? "").trim())
    .join(" ");
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

/**
 * Why a graphic that hides the picture is sent back for a BLINK of footage beside it (`blinkBeside`),
 * in words the repair round can act on: how long the shot is left alone, and why the graphic may not
 * simply stay to the picture change — a new sentence starts first (`ownSentenceEnd`), or the change
 * comes too long after its own sentence (`holdToCut`). The ways out: a line whose shot it can fill to
 * the change, a template that plays over the footage, or nothing.
 */
export function blinkProblem(template: string, c: ResolvedCue, blink: { side: "after" | "before"; cutFrame: number; sec: number }, words: Word[]): string {
  const cut = blink.cutFrame / FPS;
  const glitch = `under ${MIN_SHOT_SEC} s, which reads as a glitch`;
  const over = `use a template that plays over the footage and leaves the picture in view (DimCaption, BigNumberOverlay, SmallLabel), or drop it`;
  if (blink.side === "before")
    return `${template} hides the picture, and it opens ${blink.sec.toFixed(2)} s after the shot changes at ${mmss(cut)}: a blink of the new picture before it, ${glitch}. Put it on words said as that shot begins — its first shown words within about a second of the change — or ${over}`;
  const from = c.contentEnd ?? c.end;
  const { newLineAt } = ownSentenceEnd(words, from, cut);
  const hold = holdToCut(words, from, c.end, cut);
  // A new sentence said in the sliver is the reason to name. One that starts within NEW_LINE_GRACE_SEC
  // of the change does not stop a hold (`holdToCut`), so there the reason is how long after its own
  // sentence the change comes — to two places, as "2.0 s … (at most 2 s)" names no reason at all.
  const opener = newLineAt === undefined || newLineAt >= cut - NEW_LINE_GRACE_SEC ? [] : words.filter(w => w.start >= newLineAt - 1e-6 && w.start < cut).slice(0, 4);
  const why = opener.length
    ? `It may not stay to the change: "${opener.map(w => w.text.trim()).join(" ")}…" starts a new sentence first.`
    : `It may not stay to the change: that comes ${(cut - hold.spoken).toFixed(2)} s after its own sentence ends (at most ${hold.max} s).`;
  return (
    `${template} hides the picture, and it leaves ${blink.sec.toFixed(2)} s of the shot alone before the picture changes at ${mmss(cut)}: ` +
    `a blink of footage between it and the next shot, ${glitch}. ${why} Put it on a line whose shot it can fill to the picture ` +
    `change (only the rest of its own sentence may be said under it), or ${over}`
  );
}

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
  /**
   * Why a list's rows, as said, are not a spoken list by the rules every list the pipeline finds
   * passes — or undefined when they are (the app hands `notAListAsSaid` from `server/spokenLists.ts`,
   * so there is one set of rules). `script` is what the script says around the list. A list window
   * the planner writes on its own is held to it (job 400's "Seneca's essay" numbered pieces of one
   * sentence), and so is a stored list of things, which may predate the rules. Without it, neither is.
   * `points`: the rows are the host's points (a HostListWindow's "what is coming"), which may be
   * topics ("where they go", "when to retire one") as well as things.
   */
  listCheck?: (script: string, rows: string[], opts?: { points?: boolean }) => string | undefined;
};

/** A sentence the fill round offered back, and what came of it. */
export type OfferedMoment = {
  from: number;
  to: number;
  text: string;
  /** The asked cues (fill or its repair) whose start words are said in it: none, and not placed,
   * means the model passed it over (or named start words the narrator never says — that cue is in
   * the round's problems, on no sentence). */
  asked: string[];
  /** A graphic is over it once the fill round is done. */
  placed: boolean;
};

/** One round of the plan: what it asked for, how many passed, and what the checks refused. */
export type PlanRound = {
  /** The first answer, its repair, the fill (sentences offered back), the fill's repair, or the
   * spoken lists built from their own words. */
  step: "first" | "repair" | "fill" | "fill repair" | "lists";
  asked: number;
  kept: number;
  problems: PlanProblem[];
  /** The fill round only: every sentence offered back. A sentence the model passed over leaves no
   * cue and no problem, so without this a bare moment could not be told from a refused one (Dale's
   * job 397: "Smalls, about $10 to $40." was offered, has no graphic, and the rules accept one). */
  offered?: OfferedMoment[];
  /** The fill call failed, or its answer could not be read: nothing was added. */
  error?: string;
};

export type PlanResult = {
  /** The cue sheet: approved graphics and new ones, in film order. */
  cues: CueSpec[];
  resolved: ResolvedCue[];
  rounds: PlanRound[];
  /** Approved graphics that could not be kept (never, unless the film itself changed). */
  lostKept: string[];
};

export async function planGraphics(input: PlanInput): Promise<PlanResult> {
  const { words, cuts, film, ask, ensureIcon } = input;
  const kept0 = input.kept ?? [];
  const keptIds = new Set(kept0.map(c => c.id));
  const index = indexWords(words);
  const { structural, cards, fullFrame, windows } = resolveSets();
  const opts = { cuts, fps: FPS, structural, cards, fullFrame, windows };
  /** The film's picture cuts as frames, as QA sees them (finish.ts hands the frames it measured / FPS). */
  const cutFrames = (cuts ?? []).map(c => Math.round(c * FPS)).sort((a, b) => a - b);
  /** The graphics that hide the picture and leave a blink of footage beside them (QA's test). */
  const blinksIn = (cues: ResolvedCue[]) =>
    new Map(cues.flatMap(c => {
      const b = fullFrame.has(c.template) ? blinkBeside(c, cutFrames, FPS) : undefined;
      return b ? [[c.id, b] as const] : [];
    }));

  /** Converts every `icon` in a cue's props to its Noto code in place. An icon left empty (`noIcon`)
   * is taken off; so is one Noto has no image for, which is also named in `missing`. Taken off, not
   * sent back to "pick another": an icon is the object itself or none (`ICON_REQUIRED`), and asked
   * for a substitute the planner reaches for the nearest emoji of another kind (job 399's food tin). */
  const fixIcons = async (node: unknown, missing: string[]): Promise<void> => {
    if (Array.isArray(node)) {
      for (const x of node) await fixIcons(x, missing);
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (k !== "icon") await fixIcons(v, missing);
      else if (noIcon(v)) delete o.icon;
      else {
        const code = notoCode(String(v).trim());
        if (await ensureIcon(code)) o.icon = code;
        else {
          missing.push(String(v));
          delete o.icon;
        }
      }
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
  /** When a resolved cue's start words are said: the place they occur nearest its start. That start is
   * padded and may snap onto a picture cut up to CUT_SNAP_SEC away, so on its own it often falls in the
   * pause BEFORE its sentence (a shot changes in the half-second sentence pause): read that way, a cue
   * asked for a sentence and refused sat on no sentence, and the sentence read as passed over. */
  const startWordNear = (spec: CueSpec, t: number): number => {
    const pad = spec.startPad ?? 0;
    let best = approxStart(spec);
    for (let hits = findPhrase(index, spec.start, 0); hits; hits = findPhrase(index, spec.start, hits[0] + 1)) {
      const w = words[index[hits[0]].word].start;
      if (Math.abs(w + pad - t) < Math.abs(best + pad - t)) best = w;
    }
    return best;
  };

  // A chapter series and a spoken list's graphic come first: a NEW graphic that clashes with one
  // gives way (Dale's "Coasters, ornaments, small cutting boards" had only a "Smalls" label).
  const required = new Set<string>();
  const priority = (s: CueSpec) => structural.has(s.template) || required.has(s.id);
  const sized = (input.lists ?? []).filter(l => l.items.length >= 2 && l.items.length <= 5);
  // A STORED list of things is held to the same rules as a list window the planner writes
  // (`listCheck`): a job keeps the lists found when it was made, and Gideon's job 400 kept "Two
  // thousand years ago, | a man named Lucius Annaeus Seneca wrote a short, | furious" from before the
  // rules — put to the planner as a list that MUST get a graphic, and built by `missingListCues` all
  // the same. Read where it is said; one not heard word for word is held to its rows alone. A list
  // of steps is never asked whether its steps are things.
  const where = new Map(locateLists(words, sized).map(p => [p.n, p] as const));
  const staleLists: PlanProblem[] = [];
  const lists = sized.filter((l, n) => {
    if (l.kind === "steps" || !input.listCheck) return true;
    const at = where.get(n);
    const why = input.listCheck(at ? scriptAround(film, at.a, at.b) : "", l.items);
    if (why) staleLists.push({ cue: `spoken list "${l.items.join(", ")}"`, problem: `not a list of things by the rules lists are found by — ${why}; it gets no list graphic` });
    return !why;
  });
  // The model is told a list MUST get a graphic only where one may go: a list in the call to action
  // can never have one, so naming it there is at best ignored and at worst refused. `missingListCues`
  // still reads every list, so a list said after a mid-roll CTA is located after it, not on an earlier
  // copy of its words.
  const offered = listsWhereGraphicsGo(words, film, lists);

  const validate = async (newSpecs: CueSpec[], final: boolean) => {
    const problems: PlanProblem[] = [];
    const ids = new Set<string>();
    /** When each new cue's start words are said: where it resolved when it did, else the first place
     * they occur (`approxStart`). */
    const startsAt = new Map<string, number>();
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
      startsAt.set(spec.id, t);
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
      // A LIST WINDOW's rows are the spoken words with their grammar, never clipped into a headline
      // (`restoreRowGrammar`: job 400's "Ordered to end life"), never stopped before what their last
      // word takes (`keepObject`: job 409's "The young are already rehearsing"), and at most
      // ROW_MAX_WORDS each.
      if (LIST_WINDOWS.has(spec.template) && Array.isArray(spec.props.items)) {
        const items = spec.props.items as { text?: unknown; say?: unknown }[];
        for (const it of items) if (it && typeof it.text === "string" && typeof it.say === "string") it.text = keepObject(restoreRowGrammar(it.text, it.say), it.say, ROW_MAX_WORDS);
        const longRow = items.map(it => it?.text).find((s): s is string => typeof s === "string" && wordCount(s) > ROW_MAX_WORDS);
        if (longRow) {
          bad(`row "${longRow}" is ${wordCount(longRow)} words — a list row takes at most ${ROW_MAX_WORDS}: the item in its own spoken words, shortened`);
          continue;
        }
        const cutRow = items
          .map(it => (it && typeof it.text === "string" && typeof it.say === "string" ? { text: it.text, object: objectCutOff(it.text, it.say) } : undefined))
          .find(r => r?.object);
        if (cutRow) {
          bad(
            `row "${cutRow.text}" stops before "${cutRow.object}", which its last word needs — a row never ends on a word whose object ` +
              `is cut off: keep those words and shorten the row elsewhere (leave out a word like "already" or "just"), or show the item another way`
          );
          continue;
        }
      }
      // A WARNING reads as one: its line, alone under the header, says what to avoid or what goes
      // wrong — job 399's "Ask while the cart is still working its way back," told the viewer to do
      // the very thing the script warned against (`namesTheDanger`).
      const warning = spec.template === "WarningLabel" ? (spec.props.text as { text?: unknown } | undefined)?.text : undefined;
      if (typeof warning === "string" && !namesTheDanger(warning)) {
        bad(
          `"${warning}" does not say what to avoid or what goes wrong — read alone under WARNING it tells the viewer to DO it. ` +
            `Show the narrator's words that name the mistake or the harm ("never…", "don't…", "not…", "avoid…", "too…", the bad result), ` +
            `or show the right way with another template (a caption, a statement, step labels), or drop it`
        );
        continue;
      }
      tidyNumbers(spec.props);
      // A TITLE keeps the length it was planned with — but is never PLANNED under MIN_ON_SCREEN_SEC:
      // Dale's "Where to sell · 3 of 5" was planned at 1.4 s (job 397, 2:15). Raised, never refused:
      // a refused chapter takes its whole series down with it. An approved one keeps its length. (A
      // cut within CUT_SNAP_SEC before its end still ends it there, sooner; QA reports that.)
      if (structural.has(spec.template) && typeof spec.durationSec === "number" && spec.durationSec < MIN_ON_SCREEN_SEC) spec.durationSec = MIN_ON_SCREEN_SEC;
      // AN ICON IS THE OBJECT OR NONE (`ICON_REQUIRED`): an empty or unknown one is taken off, a set
      // left half-filled loses the rest (`iconsAsASet`), and only a template that IS its icon is refused
      // without one — steered to a caption, never to the nearest emoji of another kind.
      const missing: string[] = [];
      await fixIcons(spec.props, missing);
      if (ICON_REQUIRED.has(spec.template) && typeof spec.props.icon !== "string") {
        bad(
          `${missing.length ? `no Noto emoji for ${missing.join(" ")}` : "no icon"} — ${spec.template} makes its point with its icon: ONE emoji that IS the object ` +
            `its words name. Use that emoji, or show the line as a DimCaption (no icon); never the nearest emoji of another kind`
        );
        continue;
      }
      iconsAsASet(spec.props);
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
      let mine = next.find(r => r.id === spec.id)!;
      startsAt.set(spec.id, startWordNear(spec, mine.start));
      // A QUOTE is signed with the host's name, so it must be the host's own words — job 399 signed
      // "Could I keep the rest of the can, please?", the line the host tells the viewer to say after
      // "speak up." (`notTheHostsWords`). Read where it resolved: the words leading into it, and
      // whether the script puts it in quotation marks.
      if (spec.template === "Quote") {
        const line = (spec.props.quote as { text?: unknown } | undefined)?.text;
        const at = mine.sync.find(s => s.element.startsWith('quote "'));
        const first = at ? words.findIndex(w => w.start === at.wordStart) : -1;
        const why = typeof line === "string" && first >= 0 ? notTheHostsWords(line, wordsLeadingInto(words, first), quotedInScript(film, at!.wordStart, mine.contentEnd ?? mine.end, line)) : undefined;
        if (why) {
          undo();
          bad(
            `"${line}" is not the host's own words — ${why}. Signed with the host's name it reads as if the host said it. ` +
              `Show it as a caption with no name (DimCaption over b-roll), or drop it`
          );
          continue;
        }
      }
      // A LIST WINDOW is a list the narrator says (`listCheck`): Gideon's job 400 (1:41) numbered "1 Two
      // thousand years ago / 2 Seneca wrote a short / 3 Furious / 4 Loving essay" on ONE sentence,
      // the planner's own list. A list the pipeline found passed the same rules when it was found
      // (`fromAFoundList`). Read around where it resolved.
      if (LIST_WINDOWS.has(spec.template) && input.listCheck) {
        const rows = listRows(spec.props.items);
        const why =
          rows.length && !fromAFoundList(rows, lists)
            ? input.listCheck(scriptAround(film, mine.start, mine.contentEnd ?? mine.end), rows, { points: spec.template === "HostListWindow" })
            : undefined;
        if (why) {
          undo();
          const title = typeof spec.props.title === "string" && spec.props.title.trim() ? `"${spec.props.title.trim()}"` : "The list window";
          bad(
            `${title} is not a list the narrator says: ${why}. A list window numbers separate things he names one after ` +
              `another ("a pen, a notebook, and a lamp"), each row on that item's own words — never a sentence chopped at ` +
              `its commas, a time or describing words. Show the line another way (a caption or a statement), or drop it`
          );
          continue;
        }
      }
      // STEPS are done one after another: a step the line offers as a CHOICE is not the next step
      // (job 399's "3 Or step to galley", `choiceSteps`). Read where it resolved: the two words said
      // right before each step's first word. And a step is his own words with their grammar, with
      // room on screen (`stepTextProblems`: job 410's "Wait until all served → Ask in aisle or galley
      // → Phrase it as offer"), its grammar put back first.
      if (spec.template === "StepLabels" || spec.template === "StepCards") {
        const steps = spec.props.steps;
        const choices = choiceSteps(steps, k => {
          const at = mine.sync.find(s => s.element.startsWith(`steps[${k}].at `));
          const i = at ? words.findIndex(w => w.start === at.wordStart) : -1;
          return i > 0 ? words.slice(Math.max(0, i - 2), i).map(w => w.text.trim()).join(" ") : undefined;
        });
        const troubles: string[] = [];
        if (choices.length) {
          const named = choices.map(k => `step ${k + 1} ("${String((steps as { text?: unknown }[])[k]?.text ?? "")}")`).join(" and ");
          troubles.push(
            `${named} ${choices.length > 1 ? "are choices" : "is a choice"} instead of the step before, not the next step ("…, or …") — ` +
              `numbered with an arrow into it, it tells the viewer to do both. Put the choice inside the step before it, as ONE step ` +
              `("Call or email"), or drop it; or show the choice with Versus`
          );
        }
        const asPlanned = JSON.stringify(steps);
        troubles.push(...stepTextProblems(spec.template, steps, stepsAsSaid(Array.isArray(steps) ? steps : [], mine, words, startsAt.get(spec.id) ?? mine.start)));
        if (troubles.length) {
          // A cue has ONE repair round, so it is told all that is wrong at once — job 410's step card,
          // mended to his words, would still have been refused for hiding its step pictures, and lost.
          const onPicture = pictureProblem(mine, next, film, words);
          undo();
          bad([...troubles, ...(onPicture ? [onPicture] : [])].join(". Also: "));
          continue;
        }
        // The mended steps are what is drawn, and a graphic's reading time grows with the words it
        // shows ("Catch" given back "a flight attendant" holds longer): placed again, so every check
        // below — and the timing handed on — measures the steps as drawn, not as the planner wrote them.
        if (JSON.stringify(steps) !== asPlanned) {
          try {
            next = resolveAll();
          } catch (e) {
            undo();
            bad(e instanceof CueError ? e.message.replace(/^cue \S+: /, "") : String(e));
            continue;
          }
          mine = next.find(r => r.id === spec.id)!;
        }
      }
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
      // NO BLINK OF FOOTAGE beside a graphic that hides the picture — QA's own test (`blinkBeside`),
      // asked here, where the repair round can still put it somewhere else. QA only REPORTED it, and
      // the films shipped with it: job 404's Versus card left 0.80 s of its shot before the next one
      // because "And if you live…" starts a new sentence in that sliver, so it may not hold to the cut
      // (1:28); job 403's "The toilet is fine." left 1.22 s under "There is a stick in it." (2:06). A blink this graphic causes BESIDE ANOTHER (by moving where it ends)
      // is refused the same way; one already there is not this graphic's.
      const blinkedBefore = blinksIn(resolved);
      const blink = Array.from(blinksIn(next)).find(([id]) => !blinkedBefore.has(id));
      if (blink) {
        undo();
        bad(blink[0] === spec.id ? blinkProblem(spec.template, mine, blink[1], words) : `would leave a blink of footage beside ${blink[0]} (${blink[1].sec.toFixed(2)} s of a shot alone) — move it or drop it`);
        continue;
      }
      // THE PICTURE UNDER IT (`pictureProblem`): a label names what its picture shows, one name to a
      // picture (job 409's "Paulinus" on the picture of Seneca, labelled "Seneca" 2 s before); a card
      // never hides a video whole (job 408's Versus over scene 3) nor a spoken list's own pictures
      // (job 410's StepCards over its three step pictures). Asked here, where the repair round can
      // still move it or choose a template over the footage.
      const onPicture = pictureProblem(mine, next, film, words);
      if (onPicture) {
        undo();
        bad(onPicture);
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
    return { cues: placed.map(p => p.spec), resolved, problems, startsAt };
  };

  const system = systemPrompt({ kept: kept0.length > 0 });
  // Steps take StepCards only when they have no pictures of their own: this note said "StepCards or
  // StepLabels" while the catalogue and `pictureProblem` refuse a card over STEP PICTURE scenes (job
  // 410's StepCards), so a list told it may have either was sent to the repair round for following it.
  const listNote = offered.length
    ? `\n\nSPOKEN LISTS IN THIS SCRIPT — each one MUST get a list graphic wherever one may go (ListWindow over
b-roll, HostListWindow over the host; steps may be StepLabels, or StepCards when the steps have no pictures
of their own), every item a row in the order
said ("text" ≤${ROW_MAX_WORDS} words, the item's own spoken words with their "a"/"the"/"his", "at": "@its first spoken words", "say": the item as said):
${offered.map((l, i) => `${i + 1}. ${l.kind === "steps" ? "[steps] " : ""}${l.items.map(x => `"${x}"`).join(", ")}`).join("\n")}`
    : "";
  const user = userPrompt(film, kept0.length ? resolveCues(kept0, words, opts) : [], words) + listNote;
  const first = await ask(system, [{ role: "user", content: user }]);
  let specs = parseSheet(first).filter(c => !keptIds.has(c.id));
  let verdict = await validate(structuredClone(specs), false);
  // A stored list the rules refused is named with the first round, so a list left without a graphic
  // is explained (it is no cue, so it is never put to the repair).
  const rounds: PlanRound[] = [{ step: "first", asked: specs.length, kept: verdict.cues.length, problems: [...staleLists, ...verdict.problems] }];
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
    rounds.push({ step: "repair", asked: specs.length, kept: verdict.cues.length, problems: verdict.problems });
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
    // The round is recorded even when nothing comes back: "offered, none asked" is the answer to
    // why a moment is bare, and an empty answer is not a failed call.
    const fillRound: PlanRound = { step: "fill", asked: 0, kept: 0, problems: [] };
    rounds.push(fillRound);
    /** Where each cue the fill (or its repair) asked for starts, to say which sentences were asked at all. */
    const askedAt = new Map<string, number>();
    const noteAsked = (v: { startsAt: Map<string, number> }, ids: Set<string>) => {
      for (const [id, t] of Array.from(v.startsAt)) if (ids.has(id)) askedAt.set(id, t);
    };
    const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
    let added: CueSpec[] = [];
    try {
      added = parseSheet(await ask(system, [...base, { role: "user", content: fill }])).filter(c => !taken.has(c.id) && !keptIds.has(c.id));
    } catch (e) {
      added = [];
      fillRound.error = why(e);
    }
    fillRound.asked = added.length;
    if (added.length) {
      let next = await validate(structuredClone([...accepted, ...added]), false);
      const addedIds = new Set(added.map(c => c.id));
      noteAsked(next, addedIds);
      const failed = next.problems.filter(p => addedIds.has(p.cue));
      fillRound.kept = next.cues.length - accepted.length;
      fillRound.problems = failed;
      if (failed.length) {
        const fix = `These added cues failed the checks:
${failed.map(p => `- ${p.cue}: ${p.problem}`).join("\n")}

Return the corrected ADDED cues (JSON only, {"cues": [...]}, only the ones you added). Fix each — use
words the narrator really says, a whole sentence where the template needs one, or drop it.`;
        try {
          const fixed = parseSheet(await ask(system, [...base, { role: "user", content: fill + "\n\nYOUR ADDED CUES WERE:\n" + JSON.stringify({ cues: added }) + "\n\n" + fix }])).filter(c => !taken.has(c.id) && !keptIds.has(c.id));
          next = await validate(structuredClone([...accepted, ...fixed]), true);
          noteAsked(next, new Set(fixed.map(c => c.id)));
          rounds.push({ step: "fill repair", asked: fixed.length, kept: next.cues.length - accepted.length, problems: next.problems.filter(p => fixed.some(x => x.id === p.cue)) });
        } catch (e) {
          next = await validate(structuredClone([...accepted, ...added]), true);
          rounds.push({ step: "fill repair", asked: 0, kept: next.cues.length - accepted.length, problems: [], error: why(e) });
        }
      } else {
        next = await validate(structuredClone([...accepted, ...added]), true);
      }
      // only ever MORE: a fill that somehow lost an accepted graphic is not taken
      if (accepted.every(a => next.cues.some(c => c.id === a.id))) verdict = next;
    }
    // What came of each offered sentence: a graphic over it, asked for and refused (its cue's id is
    // in the problems), or passed over (no cue's start words are said in it).
    const bare = new Set(uncoveredMoments(verdict.resolved, words, film).map(m => m.from));
    const offeredBack: OfferedMoment[] = moments.map(m => ({ from: m.from, to: m.to, text: m.text, asked: [], placed: !bare.has(m.from) }));
    for (const [id, t] of Array.from(askedAt)) offeredBack.find(o => o.from <= t && t <= o.to)?.asked.push(id);
    fillRound.offered = offeredBack;
  }

  // EVERY SPOKEN LIST HAS ITS GRAPHIC: one the planner still left without is built from the list's
  // own words, and comes first over a new graphic in its way.
  const listCues = missingListCues(verdict.resolved, words, film, lists);
  if (listCues.length) {
    for (const c of listCues) required.add(c.id);
    const accepted = verdict.cues.filter(c => !keptIds.has(c.id));
    const next = await validate(structuredClone([...accepted, ...listCues]), true);
    const placedLists = listCues.filter(l => next.cues.some(c => c.id === l.id));
    rounds.push({ step: "lists", asked: listCues.length, kept: placedLists.length, problems: next.problems.filter(p => listCues.some(l => l.id === p.cue) || p.problem.includes("gave way")) });
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
