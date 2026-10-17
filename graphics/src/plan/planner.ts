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
import { CueError, findPhrase, indexWords, parseSpokenNumber, resolveCues, tokens, type CueSpec, type ResolvedCue, type Word } from "../cueResolve";
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
Its words must be the narrator's own, in order (you may leave words out, never change or reorder them).
"at": "@words" makes an element appear on those spoken words; "at": 0 makes it appear at the cue start.
Fixed text (titles, labels, subs, list items) is shown whole. When it stands for words the narrator says,
add "say": "those exact spoken words" beside it, so the graphic stays until they are said.
"emphasis": ["word."] = ONE word of the shown text, copied exactly as written there (with its punctuation),
drawn in the accent colour. "icon" = ONE emoji character (a 3D Noto emoji): a plain, literal object.

EVERY GRAPHIC AND THE MOMENT THAT CALLS FOR IT
Each line below is "Template — appears whenever the script…: props". Use a template EVERY time its
moment happens, as often as the script allows. Nothing here is limited to once.

Full-screen cards — replace the picture, so ONLY inside a b-roll stretch:
- Statement — sums up a point in one short line, or lands a punchline: {"kicker": "2-4 word label", "headline": phrase (4-10 words), "emphasis"}
- MythTruth — states what people believe, then corrects it: {"myth": phrase, "truth": phrase, "emphasis"}
- Versus — compares two kinds or options: {"kicker", "left": {"icon","title" (1-3 words),"sub" (≤6 words),"say","at"}, "right": {same}, "winner": "left"|"right"|"none"}
- BigNumber — says a number that matters (a time, an amount, a count): {"kicker", "prefix": "$" (a currency sign, if any), "value": number, "unit": "1-2 words", "at": "@the spoken number", "line": phrase, "countSec": 0.6 for small numbers}. Start it on the sentence that holds the number, not sentences before.
- StepCards — gives 2-4 steps the viewer should do: {"kicker", "steps": [{"text" (≤4 words), "icon", "at": "@words"}]}
- BeforeAfter — an old way or state replaced by a new one: {"kicker", "before": {"icon","label","at"}, "after": {"icon","label","at"}}
- TwoPoint — links two places or things ("the one in the basement sets off the one by your bed"): {"title": phrase, "a": {"label","sub","at"}, "b": {"label","sub","at"}}
- FactCard — states a finding or a general fact ("most…", "studies show…", "the rule is…"): {"kicker": "Fact", "fact": phrase (≤14 words), "emphasis", "source": "where it comes from, ONLY if the script says it", "icon"}
- YesNoCard — asks a yes/no question and answers it: {"kicker", "question": phrase (≤14 words), "answer": "yes"|"no", "at": "@the spoken answer", "line": phrase (optional, the reason)}

Graphics with the picture in a window — they replace the picture with the footage framed beside text:
- TermWindow — names a term or a word and explains what it means (ONLY over b-roll): {"kicker": "The term", "term": "the term as said", "at": "@the term", "meaning": phrase (≤12 words)}
- ListWindow — lists 2-4 things or signs while the picture matters (ONLY over b-roll): {"title": "2-4 words", "items": [{"text" (≤5 words), "at": "@words", "say"}]}
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
- Quote — the host's own advice in one memorable line (over b-roll): {"quote": phrase (≤12 words), "author": "the host's name", "emphasis"}
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
  Statement: 10, MythTruth: 10, TwoPoint: 12, WarningLabel: 10, HostCaption: 8, DimCaption: 10, Quote: 12,
  TitleOverFootage: 10, ArrowCaption: 10, IconCallout: 8, FactCard: 14, YesNoCard: 14, MythStamp: 10,
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
  const opts = { cuts, fps: FPS, structural, cards };

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

  const validate = async (newSpecs: CueSpec[], final: boolean) => {
    const problems: PlanProblem[] = [];
    const ids = new Set<string>();
    // 1. The APPROVED graphics are the fixed base: placed first, in their own order, never dropped.
    //    Their own issues (if any) are reported, not acted on.
    const placed: { spec: CueSpec; t: number; kept: boolean }[] = [];
    for (const k of kept0) {
      const spec = structuredClone(k);
      ids.add(spec.id);
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
      const unsaid = shownNumbers(spec).filter(n => !saidNear(n, mine.start, mine.end));
      if (unsaid.length) {
        undo();
        bad(`shows ${unsaid.join(", ")}, which the narrator does not say while it is up`);
        continue;
      }
      // The placement rules, with the gap a new graphic keeps from everything — only problems that
      // involve THIS graphic count (approved graphics may touch each other, as when approved).
      const rule = checkRules(next, film, { gap: MIN_GAP_SEC }).filter(p => p.cue === spec.id || p.problem.includes(spec.id));
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
  const user = userPrompt(film, kept0.length ? resolveCues(kept0, words, opts) : []);
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
