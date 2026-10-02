/**
 * SPOKEN LISTS, found in the whole script (2026-10-01, the operator on Granny Ruth's practice film,
 * job 281). A spoken list gets one picture per item. That used to be decided piece by piece — "does
 * this storyboard piece look like a list item?" — but where a piece starts and ends is wherever the
 * storyboard happened to cut, so every run broke a list a new way: "the one | that paid me best"
 * read as two items and split one bowl into two pictures, while "…a kitchen table with a
 * straight-stitch machine, | a rotary cutter, and | a mountain of scraps…" crossed a beat cut, so
 * the machine stayed on the host and "a rotary cutter, and" was never recognised at all.
 *
 * Now the lists are found ONCE, in whole sentences, before anything is cut to fit them:
 *  1. `findSpokenLists` — one call reads the numbered sentences and writes every list's items word
 *     for word; `validateSpokenList` keeps only items that are really there, in order, joined the
 *     way list items are (commas, "and"/"or"). When the call fails, `listsByShape` finds them by
 *     sentence shape alone ("X, Y, and Z") — the same rules, so a film is never worse off.
 *  2. `applySpokenLists` — re-cuts the film so every item is exactly one picture, wherever the
 *     storyboard cut: a list that starts inside a host line hands over at its first item, words
 *     after the last item go to the next picture, and a piece that is NOT an item of any list loses
 *     the list mark it may have picked up, so it joins its neighbours like any other picture.
 * It replaces the per-piece list patches (`handOffHostLists`, `pullListLeadIns`) as the last word.
 * Nothing here names a channel or a craft.
 */
import type { StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { safeParseJSON } from "./jsonRepair";
import {
  FRESH,
  HOST_HANDOFF_MIN_WORDS,
  LIST_ITEM_CLAUSE,
  NOT_A_LIST_ITEM,
  firstWords,
  tokenSpans,
} from "./shotList";

export interface SpokenList {
  /** Index of the sentence (in `splitSentences` of the film's running text) holding the list. */
  sentence: number;
  /** The items, word for word as spoken, without the joining "and"/"or". */
  items: string[];
  /**
   * "steps" for a sequence of things someone DOES (Hank's job 326: "Square up the scrap…, give it
   * a quick brush, drill the hole…, oil it, and put a felt dot on the bottom") — each step is a
   * picture of the hands doing it. "things" (the default) for things named one after another.
   */
  kind?: "things" | "steps";
}

const LIST_MODEL = () => process.env.LIST_MODEL || "claude-opus-5-5";

/** The most words one item may have — a thing and its own describing words, never a clause. */
export const LIST_ITEM_MAX_WORDS = 12;
/** Words the shape rules accept in one item ("a mountain of scraps too pretty to throw out"). */
const SHAPE_ITEM_MAX_WORDS = 9;
/** Words allowed between two items besides the joiners ("a churn dash HERE, a bear paw there"). */
const GAP_MAX_WORDS = 3;

/** The words that join list items. */
const JOINERS = new Set(["and", "or", "plus", "maybe", "then", "also", "even", "nor"]);

/** The film's running text cut into sentences (a sentence ends on . ! or ? before a space). Pure. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?]["')\]]?)\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ─── The shape rules ────────────────────────────────────────────────────────────────────────────

const stripJoiners = (t: string) =>
  t.replace(/^(?:(?:and|or|plus|maybe|then|also|even|nor)\s+)+/i, "");

/**
 * One comma piece of a sentence that only NAMES a thing: a few words, no subject or verb, not an
 * aside ("Honestly"), not a where/how-much opener ("all on one wall"). Pure.
 */
export function namesAThing(piece: string, maxWords = SHAPE_ITEM_MAX_WORDS): boolean {
  const core = stripJoiners(piece.trim().replace(/[.!?;:,]+$/, "")).trim();
  if (!core || !/[a-z]/i.test(core)) return false;
  const words = core.split(/\s+/);
  if (words.length > maxWords) return false;
  if (LIST_ITEM_CLAUSE.test(core)) return false;
  const first = words[0].replace(/[^a-z]/gi, "").toLowerCase();
  if (!first || NOT_A_LIST_ITEM.has(first)) return false;
  // An adverb opener is an aside ("Usually,", "Honestly,"), never a thing.
  if (/ly$/.test(first)) return false;
  if (DETERMINER.test(core)) return true;
  // With no "a/the/some/two…" in front, only a bare name of a few words is a thing ("flour",
  // "brown sugar", "fine sandpaper") — never a phrase saying where or what someone is doing
  // ("standing in a garage with a saw").
  return words.length <= 3 && !/ing$/.test(first) && !words.some(w => PLACE_WORD.has(w.toLowerCase()));
}

/** A piece opening on a determiner or a number names a thing ("a saw", "the pearls", "two spools"). */
const DETERMINER =
  /^(?:a|an|the|some|my|your|our|his|her|their|this|that|these|those|one|two|three|four|five|six|seven|eight|nine|ten|a few|a couple of|old|new|\d+)\b/i;
/** Words that make a bare phrase say where, not name a thing. */
const PLACE_WORD = new Set(["in", "on", "at", "with", "for", "from", "to", "into", "onto", "by", "near"]);

/** The trailing "a/the/some … thing" of a clause, when it is short enough to be a list's first item. */
function trailingThing(clause: string): string | null {
  const m =
    /(?:^|\s)((?:a|an|the|some|my|your|our|his|her|their|one|two|three|four|five)\s+[^,;]+)$/i.exec(
      clause.trim()
    );
  if (!m) return null;
  // The LAST article starts the item ("…at a kitchen table with a straight-stitch machine").
  const tail = m[1];
  const last = /^(?:.*\s)?((?:a|an|the|some|my|your|our|his|her|their|one|two|three|four|five)\s+\S.*)$/i.exec(tail);
  const item = (last ? last[1] : tail).trim();
  return item !== clause.trim() && namesAThing(item, 6) ? item : null;
}

/** Words that start the clause a list's last item can run into. */
const CLAUSE_START = new Set([
  "by", "for", "to", "in", "on", "at", "with", "from", "that", "which", "who", "because", "when",
  "so", "while", "if", "where", "until", "since",
]);

/**
 * "and Facebook Marketplace by what each one does well" → "and Facebook Marketplace": an "and/or"
 * piece whose first few words name a thing and then run into a clause. Null otherwise. Pure.
 */
function lastItemBeforeClause(piece: string): string | null {
  if (!/^(?:and|or)\s/i.test(piece.trim())) return null;
  const words = piece.trim().split(/\s+/);
  const stop = words.findIndex((w, k) => k > 1 && CLAUSE_START.has(w.toLowerCase()));
  if (stop < 2 || stop > 6) return null;
  const item = words.slice(0, stop).join(" ");
  return namesAThing(item) ? item : null;
}

/** A clause's last word, when a list of bare names follows it ("You need flour, | sugar, and butter"). */
function trailingBareThing(clause: string): string | null {
  const w = /(?:^|\s)([A-Za-z][A-Za-z'-]*)$/.exec(clause.trim())?.[1];
  return w && namesAThing(w) && !DETERMINER.test(w) ? w : null;
}

/**
 * The lists in one sentence, by shape alone: three or more comma-separated pieces that each name a
 * thing ("a churn dash here, a bear paw there, a flying geese row"), or two when the second is
 * joined by a comma AND "and"/"or" ("a saw, and a drill"). A list's first item may end the clause
 * before it ("…sitting at a kitchen table with a straight-stitch machine,"). Two things joined by a
 * bare "and" are not a list ("the potholders and the coasters were done"), nor is "the one that…".
 * Returns each list's items without their joiners. Pure.
 */
export function listsByShape(sentence: string): string[][] {
  const pieces = sentence
    .split(/[,;]/)
    .map(p => p.trim())
    .filter(Boolean);
  const out: string[][] = [];
  for (let i = 0; i < pieces.length; ) {
    if (!namesAThing(pieces[i])) {
      i++;
      continue;
    }
    let j = i;
    let run: string[] = [];
    while (j < pieces.length && namesAThing(pieces[j])) {
      // "a drill and a plane" inside a run is two items.
      const both = /^(.*\S)\s+(?:and|or)\s+(\S.*)$/i.exec(stripJoiners(pieces[j]));
      if (run.length && both && namesAThing(both[1]) && namesAThing(both[2])) run.push(pieces[j].replace(/\s+(?:and|or)\s+\S.*$/i, ""), `and ${both[2]}`);
      else run.push(pieces[j]);
      j++;
    }
    // A list of "a/the/some …" things starts at its first such item; a bare piece before it is the
    // clause the list hangs off ("Get a saw, | a drill, and some glue"), not an item.
    let source = i > 0 ? pieces[i - 1] : "";
    const firstDet = run.findIndex(t => DETERMINER.test(stripJoiners(t)));
    if (firstDet > 0) {
      source = run[firstDet - 1];
      run = run.slice(firstDet);
    }
    // The last item may run straight on into the rest of the sentence with no comma ("…, and
    // Facebook Marketplace by what each one does well"): its name is the words before the clause.
    const tail = run.length && j < pieces.length ? lastItemBeforeClause(pieces[j]) : null;
    if (tail) run.push(tail);
    const bare = run.every(t => !DETERMINER.test(stripJoiners(t)));
    const lead =
      source && run.length >= 2
        ? (bare ? trailingBareThing(source) : trailingThing(source))
        : null;
    const items = [...(lead ? [lead] : []), ...run];
    const joinedByAnd = /^(?:and|or)\s/i.test(items[items.length - 1] ?? "");
    if (items.length >= 3 || (items.length === 2 && joinedByAnd)) {
      out.push(items.map(t => stripJoiners(t).replace(/[.!?;:,]+$/, "").trim()));
    }
    i = j;
  }
  return out;
}

// ─── The double-check every list passes ─────────────────────────────────────────────────────────

/** Index of the first token of `want` in `toks` at or after `from`, or -1. */
function findTokens(toks: string[], want: string[], from: number): number {
  if (!want.length) return -1;
  outer: for (let i = Math.max(0, from); i + want.length <= toks.length; i++) {
    for (let k = 0; k < want.length; k++) if (toks[i + k] !== want[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Whether `items` really are a spoken list in `sentence`: every item is there, in order, at most
 * `LIST_ITEM_MAX_WORDS` words, with at most `GAP_MAX_WORDS` words between two items, and joined the
 * way list items are — two items need a comma between them, three or more at least one. A pair
 * joined only by "and" ("the potholders and the coasters") fails. Pure.
 */
export function validateSpokenList(sentence: string, items: string[]): boolean {
  if (!Array.isArray(items) || items.length < 2) return false;
  const spans = tokenSpans(sentence);
  const toks = spans.map(t => t.tok);
  let cursor = 0;
  let prevEnd = -1;
  let commas = 0;
  for (const item of items) {
    const want = tokenSpans(String(item ?? "")).map(t => t.tok);
    if (!want.length || want.length > LIST_ITEM_MAX_WORDS) return false;
    const at = findTokens(toks, want, cursor);
    if (at < 0) return false;
    if (prevEnd >= 0) {
      if (at - prevEnd > GAP_MAX_WORDS) return false;
      const between = sentence.slice(spans[prevEnd - 1].end, spans[at].start);
      if (/[,;]/.test(between)) commas++;
    }
    prevEnd = at + want.length;
    cursor = prevEnd;
  }
  return commas >= 1;
}

// ─── Finding them ───────────────────────────────────────────────────────────────────────────────

export const LISTS_SYSTEM = `You read a video's spoken script, one numbered sentence per line, and
find every SPOKEN LIST in it: two or more separate THINGS named one after another, so a viewer could
be shown one picture per item — or a SEQUENCE OF STEPS someone does, one after another ("square up the
scrap with a couple of saw cuts, give it a quick brush, drill the hole, oil it, and put a felt dot on
the bottom"), each step its own picture.

For each list give its items EXACTLY as spoken, word for word — each item with its own describing
words up to the next comma ("a flying geese row across the middle"), without the "and"/"or" that
joins it. A list's first item may sit at the end of a longer clause ("…sitting at a kitchen table
with a straight-stitch machine, a rotary cutter, and a pile of scraps": the machine is the first
item).

NOT a list:
- one thing being talked about ("the one that paid me best came out of a coffee can")
- two things together as the subject or object of a verb, joined only by "and" ("by the time the
  potholders and the coasters were done")
- reasons, places, times, numbers, prices or describing words one after another
- a story of what happened ("I went home, made dinner, and slept") — steps are things to DO

Answer with JSON only: {"lists":[{"sentence":<number>,"kind":"things"|"steps","items":["…","…"]}]} —
{"lists":[]} when there are none.`;

/** Read the model's answer: lists that pass `validateSpokenList` against their own sentence. Pure. */
export function parseSpokenLists(text: string, sentences: string[]): SpokenList[] | null {
  const r = safeParseJSON<{ lists?: unknown }>(text);
  const parsed = r.success ? r.data : null;
  if (!parsed || !Array.isArray(parsed.lists)) return null;
  const out: SpokenList[] = [];
  for (const raw of parsed.lists as { sentence?: unknown; items?: unknown; kind?: unknown }[]) {
    const n = Number(String(raw?.sentence ?? "").replace(/^#/, ""));
    const items = Array.isArray(raw?.items) ? raw.items.map(i => String(i ?? "").trim()) : [];
    if (!Number.isInteger(n) || !sentences[n]) continue;
    if (validateSpokenList(sentences[n], items))
      out.push({ sentence: n, items, ...(raw?.kind === "steps" ? { kind: "steps" as const } : {}) });
  }
  return out.sort((a, b) => a.sentence - b.sentence);
}

/** Words that open a clause about someone (a story), never a step to do. */
const SUBJECT_START = /^(?:i|you|we|he|she|they|it|there|that|this|these|those|my|our|his|her|their)\b/i;

/**
 * The steps in one sentence, by shape: three or more comma pieces, the last joined by "and"/"then",
 * each a short instruction that starts on its own verb-like word — no subject ("I went…"), no
 * determiner ("a saw" is a thing), no aside ("Honestly"), at most `STEP_MAX_WORDS`. Pure.
 */
export function stepsByShape(sentence: string): string[] | null {
  const pieces = sentence.split(/[,;]/).map(p => p.trim()).filter(Boolean);
  if (pieces.length < 3) return null;
  const last = pieces[pieces.length - 1];
  if (!/^(?:and|then|and then)\s/i.test(last)) return null;
  const items = pieces.map(p => p.replace(/^(?:and then|and|then)\s+/i, "").replace(/[.!?]+$/, "").trim());
  const isStep = (t: string) => {
    const words = t.split(/\s+/);
    const first = (words[0] ?? "").replace(/[^a-z]/gi, "").toLowerCase();
    return (
      words.length >= 2 &&
      words.length <= STEP_MAX_WORDS &&
      !!first &&
      !SUBJECT_START.test(first) &&
      !DETERMINER.test(t) &&
      !NOT_A_LIST_ITEM.has(first) &&
      !/ly$/.test(first) &&
      !JOINERS.has(first) &&
      // An instruction opens on its plain verb ("drill", "oil", "give"): never a past or -ing form,
      // never "money was tight" (a subject then its verb), never a date or a number.
      !/(?:ed|ing)$/.test(first) &&
      !STATE_VERB.test(words[1] ?? "") &&
      !/\d/.test(t)
    );
  };
  return items.every(isStep) ? items : null;
}

/** A second word that makes a piece a statement about something ("money WAS tight"), not a step. */
const STATE_VERB = /^(?:was|were|is|are|am|be|been|had|has|have|did|does|do|got|gets|went|goes|said|says|made|makes|came|comes|could|would|should|will|can|may|might|must)$/i;

/** The most words one step may have. */
const STEP_MAX_WORDS = 12;

/** Every list the shape rules find, sentence by sentence — things, then steps. Pure. */
export function spokenListsByShape(sentences: string[], only?: Set<number>): SpokenList[] {
  const out: SpokenList[] = [];
  sentences.forEach((s, n) => {
    if (only && !only.has(n)) return;
    for (const items of listsByShape(s))
      if (validateSpokenList(s, items)) out.push({ sentence: n, items });
    if (out.some(l => l.sentence === n)) return;
    const steps = stepsByShape(s);
    if (steps && validateSpokenList(s, steps)) out.push({ sentence: n, items: steps, kind: "steps" });
  });
  return out;
}

/**
 * Every spoken list in the film's running text. One model call per ~250 sentences, each answer
 * double-checked by `validateSpokenList`; a batch whose call fails falls back to the shape rules for
 * its own sentences. Never throws.
 */
export async function findSpokenLists(
  text: string,
  opts: { log?: (msg: string) => void; ask?: (system: string, user: string) => Promise<string> } = {}
): Promise<{ lists: SpokenList[]; sentences: string[]; fromModel: boolean }> {
  const sentences = splitSentences(text);
  const BATCH = 250;
  const ask =
    opts.ask ??
    (async (system: string, user: string) =>
      (await invokeClaude({ systemPrompt: system, userMessage: user, maxTokens: 8000, model: LIST_MODEL() })).text);
  const lists: SpokenList[] = [];
  let fromModel = true;
  for (let from = 0; from < sentences.length; from += BATCH) {
    const ids = sentences.slice(from, from + BATCH).map((_, k) => from + k);
    let got: SpokenList[] | null = null;
    try {
      const answer = await ask(LISTS_SYSTEM, `${ids.map(n => `${n}: ${sentences[n]}`).join("\n")}\n\nJSON:`);
      got = parseSpokenLists(answer, sentences)?.filter(l => ids.includes(l.sentence)) ?? null;
    } catch {
      got = null;
    }
    if (!got) {
      fromModel = false;
      got = spokenListsByShape(sentences, new Set(ids));
      opts.log?.(`spoken lists: the list check failed for sentences ${from}–${ids[ids.length - 1]} — found by sentence shape instead`);
    } else {
      // BOTH, always: a list the model missed but the sentence shape shows is kept too (Diane's job
      // 319: the model found none, and "Wash, towel, dryer, brush" lost its pictures).
      for (const extra of spokenListsByShape(sentences, new Set(ids)))
        if (!got.some(l => l.sentence === extra.sentence)) got.push(extra);
      got.sort((a, b) => a.sentence - b.sentence);
    }
    lists.push(...got);
  }
  return { lists, sentences, fromModel };
}

// ─── Cutting the film to fit them ───────────────────────────────────────────────────────────────

interface FilmToken {
  scene: number;
  start: number;
  end: number;
  tok: string;
}

/** A beat whose words may not be re-cut into list pictures. */
const fixedBeat = (s: StoryboardScene) =>
  !!(s.cta || s.qrHero || s.qrCorner || s.coverHero || s.assetImageUrl || s.splitVisual);

/** A word without its plural ending, for "scraps" ~ "scrap". */
const stem = (w: string) => w.replace(/(?:es|s)$/, "");
/** Words too plain to say two descriptions show the same thing. */
const PLAIN = new Set(["with", "from", "that", "this", "these", "those", "some", "your", "their", "there", "here", "pretty", "really", "just", "into", "onto", "over", "under", "about", "little", "big"]);

/** A list item's words without its joiners or trailing punctuation. */
const bareItem = (t: string) =>
  stripJoiners(t.trim()).replace(/[.!?;:,]+$/, "").trim();

/** The longest bridge into a list (a clause leading in, not a passage of its own). */
const BRIDGE_HOST_MAX_WORDS = 16;
/** A bridge shorter than this is not worth a picture of its own. */
const BRIDGE_MIN_WORDS = 3;


/** A short picture that only leads into what follows: one clause, no sentence end, not a list item. */
function isBridge(s: StoryboardScene): boolean {
  const t = (s.scriptText ?? "").trim();
  return (
    !s.hostPresent &&
    !s.listCut &&
    !fixedBeat(s) &&
    !!t &&
    !/[.!?]/.test(t) &&
    tokenSpans(t).length <= BRIDGE_HOST_MAX_WORDS
  );
}

/** "sitting at a kitchen table with" → "at a kitchen table": where the line puts the list. */
function placeOf(bridge: string): string | null {
  return (
    /\b((?:at|in|on|beside|by|inside|around)\s+(?:a|an|the|your|my|his|her|their|our)\s+[^,]+?)(?=\s+(?:with|and|for)\b|[,.]?$)/i.exec(
      bridge.trim()
    )?.[1] ?? null
  );
}

/** The bridge picture: the place the line names with every item of the list in it together. */
function setPicture(base: StoryboardScene, text: string, names: string[]): StoryboardScene {
  const where = placeOf(text);
  const things =
    names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
  const show = `${things} together${where ? ` ${where}` : ", laid out side by side"}`;
  return {
    ...base,
    ...FRESH,
    scriptText: text,
    narration: firstWords(text, 8),
    hostPresent: false,
    hostOpener: undefined,
    hostIntro: undefined,
    hostProtected: undefined,
    lipsynced: undefined,
    splitVisual: undefined,
    stillImage: true,
    objectMotion: undefined,
    humanPresent: undefined,
    selfMoving: undefined,
    visualPrompt: show,
    showSubject: show,
    visualPromptSeed: undefined,
    keyThing: undefined,
    otherKeyThings: undefined,
    sameShot: undefined,
    joinedLine: undefined,
    listCut: undefined,
    listSet: true,
    wordCut: true,
    shotGroup: base.shotGroup ?? base.index,
    hostCandidate: undefined,
  } as StoryboardScene;
}

/** A picture of one list item, made from the beat its words came from. */
function listPicture(base: StoryboardScene, text: string, show: string): StoryboardScene {
  return {
    ...base,
    ...FRESH,
    scriptText: text,
    narration: firstWords(text, 8),
    hostPresent: false,
    hostOpener: undefined,
    hostIntro: undefined,
    hostProtected: undefined,
    lipsynced: undefined,
    splitVisual: undefined,
    stillImage: true,
    objectMotion: undefined,
    cameraMove: undefined,
    humanPresent: undefined,
    selfMoving: undefined,
    visualPrompt: show,
    showSubject: show,
    visualPromptSeed: undefined,
    keyThing: undefined,
    otherKeyThings: undefined,
    pictureText: undefined,
    blurPrint: undefined,
    sameShot: undefined,
    listCut: true,
    wordCut: true,
    shotGroup: base.shotGroup ?? base.index,
    hostCandidate: undefined,
  } as StoryboardScene;
}

/**
 * Re-cut the film so every item of every list is exactly one picture (see the file comment). A list
 * is left as it is when it touches a CTA, cover, asset, QR or split beat, continues into a host line,
 * or starts in a host line that would keep fewer than `HOST_HANDOFF_MIN_WORDS` words (or lose the
 * host's name on the introduction), or that speaks on after it. The film's last beat never hands a
 * list over. A non-host piece holding no list item loses any list mark. Returns the new
 * film and what changed; the caller re-times it (`assignSceneRanges`). Pure.
 */
export function applySpokenLists(
  scenes: StoryboardScene[],
  lists: SpokenList[],
  opts: { hostName?: string; main?: string } = {}
): { scenes: StoryboardScene[]; applied: number; handed: number; cleared: number; skipped: string[] } {
  // Why each list found in the script was NOT cut here — logged by the caller, so a list that stays
  // on the host says why instead of having to be reproduced.
  const skipped: string[] = [];
  const G: FilmToken[] = [];
  scenes.forEach((s, i) => tokenSpans(s.scriptText ?? "").forEach(t => G.push({ scene: i, ...t })));
  const toks = G.map(g => g.tok);
  const firstTok = new Map<number, number>();
  const endTok = new Map<number, number>();
  G.forEach((g, k) => {
    if (!firstTok.has(g.scene)) firstTok.set(g.scene, k);
    endTok.set(g.scene, k + 1);
  });
  const between = (a: number, b: number) =>
    G[a].scene === G[b].scene
      ? (scenes[G[a].scene].scriptText ?? "").slice(G[a].end, G[b].start)
      : `${(scenes[G[a].scene].scriptText ?? "").slice(G[a].end)} ${(scenes[G[b].scene].scriptText ?? "").slice(0, G[b].start)}`;
  const punctBetween = (a: number, b: number) => /[,.;:!?]/.test(between(a, b));
  const nameToks = tokenSpans(opts.hostName ?? "").map(t => t.tok);

  interface Region {
    starts: number[];
    end: number;
    first: number;
    last: number;
    kind?: SpokenList["kind"];
  }
  const regions: Region[] = [];
  const itemScenes = new Set<number>();
  let cursor = 0;
  for (const list of lists) {
    const ranges: [number, number][] = [];
    let from = cursor;
    for (const item of list.items) {
      const want = tokenSpans(item).map(t => t.tok);
      const at = findTokens(toks, want, from);
      if (at < 0 || (ranges.length && at - ranges[ranges.length - 1][1] > GAP_MAX_WORDS)) {
        ranges.length = 0;
        break;
      }
      ranges.push([at, at + want.length]);
      from = at + want.length;
    }
    if (ranges.length < 2) {
      skipped.push(`"${list.items[0]}…": its words were not found in order in the film's text`);
      continue;
    }
    cursor = ranges[ranges.length - 1][1];
    for (const [a, b] of ranges) for (let k = a; k < b; k++) itemScenes.add(G[k].scene);
    // Each item's picture starts on its joiner ("and a mountain of scraps") and runs to the next
    // item (so "here" in "a churn dash here," stays with its item).
    const starts = ranges.map(([a], k) => {
      if (k === 0) return a;
      let s = a;
      while (s > ranges[k - 1][1] && JOINERS.has(toks[s - 1]) && !punctBetween(s - 1, s)) s--;
      return s;
    });
    // The last item keeps its own few describing words up to the next comma.
    let end = ranges[ranges.length - 1][1];
    for (let n = 0; n < 4 && end < G.length && !punctBetween(end - 1, end); n++) end++;
    if (end < G.length && !punctBetween(end - 1, end)) {
      // Still mid-phrase after four words: the item's words run into a clause — cut at the item.
      end = ranges[ranges.length - 1][1];
    }
    regions.push({ starts, end, first: G[starts[0]].scene, last: G[end - 1].scene, kind: list.kind });
  }

  const textOf = (a: number, b: number): string => {
    const parts: string[] = [];
    for (let k = a; k < b; ) {
      const sc = G[k].scene;
      let j = k;
      while (j < b && G[j].scene === sc) j++;
      const t = scenes[sc].scriptText ?? "";
      const to = j < G.length && G[j].scene === sc ? G[j].start : t.length;
      parts.push(t.slice(G[k].start, to).trim());
      k = j;
    }
    return parts.join(" ").trim();
  };

  const ok = regions.filter((r, k) => {
    const said = `"${textOf(r.starts[0], r.end).slice(0, 40)}…"`;
    const no = (why: string) => {
      skipped.push(`${said}: ${why}`);
      return false;
    };
    const prev = regions[k - 1];
    if (prev && r.first <= prev.last) return no("shares a beat with the list before it");
    for (let i = r.first; i <= r.last; i++) {
      if (fixedBeat(scenes[i])) return no("touches a CTA, cover, QR, asset or split beat");
      // A list may run across several host shots (Lance's job 321: the opening's two camera angles
      // split it — "…a kit. A bin in the hall closet," | "a bag in the garage, maybe a box…"). Only
      // the introduction is protected: its name never leaves the camera.
      if (i !== r.first && scenes[i].hostPresent && scenes[i].hostIntro)
        return no("runs on into the host's introduction");
    }
    const host = scenes[r.first];
    if (!host.hostPresent) return true;
    // The goodbye keeps its list; the opening line hands over like any other (Dale's job 292 kept
    // "Today I'm ranking Etsy," on the opener, and a later trim left "Etsy" inside a picture).
    if (r.first === scenes.length - 1) return no("is in the film's last line");
    const kept = tokenSpans((host.scriptText ?? "").slice(0, G[r.starts[0]].start)).map(t => t.tok);
    // A host line that is NOTHING but the list (Lance's job 311: "A bin in the hall closet, a bag in
    // the garage, maybe a box under the bed.") goes to the pictures whole — after a host line, never
    // the introduction. The film's first and last lines are kept above/below.
    const onlyList =
      kept.every(t => JOINERS.has(t)) &&
      (r.end >= G.length || G[r.end].scene !== r.first) &&
      !host.hostIntro &&
      !!scenes[r.first - 1]?.hostPresent;
    if (onlyList) return r.first > 0 || no("is the film's first line");
    // The introduction keeps the host's name on camera: its list hands over only after the name.
    if (host.hostIntro && nameToks.length && !kept.some((_, j) => nameToks.every((w, q) => kept[j + q] === w)))
      return no("would take the host's name off the introduction");
    // Otherwise a list inside a host line ALWAYS becomes pictures (Lance's job 314: "A bin in the hall
    // closet, a bag in the garage, maybe a box under the bed. And there's a decent chance…" stayed on
    // the host because the host spoke on): a few words before it go with the first item, and a host
    // who speaks on after it comes back for the rest (see the output loop).
    return true;
  });
  // Lists left as they are keep any list mark they have; so do pieces of lists that were applied.
  const byFirst = new Map(ok.map(r => [r.first, r]));
  const startsRegion = new Set(ok.map(r => r.first));


  const out: StoryboardScene[] = [];
  let applied = 0;
  let handed = 0;
  let cleared = 0;
  let carry: string | null = null;
  for (let i = 0; i < scenes.length; ) {
    const r = byFirst.get(i);
    if (!r) {
      let s = scenes[i];
      if (s.listCut && !s.hostPresent && !itemScenes.has(i)) {
        s = { ...s, listCut: undefined };
        cleared++;
      }
      if (carry) {
        s = { ...s, ...FRESH, scriptText: `${carry} ${(s.scriptText ?? "").trim()}`.trim(), narration: firstWords(`${carry} ${s.scriptText ?? ""}`, 8) };
        carry = null;
      }
      out.push(s);
      i++;
      continue;
    }
    if (carry) {
      // The words after a list run straight into another list: they keep a picture of their own.
      const prev = out[out.length - 1];
      out.push({ ...prev, ...FRESH, scriptText: carry, narration: firstWords(carry, 8), listCut: undefined, wordCut: true } as StoryboardScene);
      carry = null;
    }
    const head = scenes[i];
    const prefix = (head.scriptText ?? "").slice(0, G[r.starts[0]].start).trim();
    let leadIn: string | null = null;
    const bounds = [...r.starts, r.end];
    const names = bounds.slice(0, -1).map((a, k) => bareItem(textOf(a, bounds[k + 1])));
    // THE BRIDGE (Granny Ruth's job 302): the words leading from a host take into the list ("…I'm
    // Granny Ruth, | and this one's for anybody sitting at a kitchen table with | a straight-stitch
    // machine,"). Either a short picture of their own right after the host, the head's own words
    // before the first item, or both.
    const last = out[out.length - 1];
    const bridgePiece =
      !head.hostPresent && last && isBridge(last) && out[out.length - 2]?.hostPresent ? last : null;
    const hostBefore = bridgePiece
      ? out[out.length - 2]
      : !head.hostPresent && prefix && last?.hostPresent
        ? last
        : null;
    const bridgeText = `${bridgePiece?.scriptText ?? ""} ${head.hostPresent ? "" : prefix}`.trim();
    if (hostBefore && bridgeText && tokenSpans(bridgeText).length >= BRIDGE_MIN_WORDS) {
      // The bridge is ONE picture of the place the line names with the whole list in it — never the
      // empty place. Always a picture, never the host: the host's minutes are planned later, and a
      // bridge the host said took a check-in's time away (Ruth's job 304 went 48 s without her).
      const base = bridgePiece ?? head;
      if (bridgePiece) out.pop();
      out.push(setPicture(base, bridgeText, names));
    } else if (prefix && head.hostPresent && tokenSpans(prefix).length < HOST_HANDOFF_MIN_WORDS) {
      // Too few words for a host take of their own ("Get | a saw, …"): they lead the first item.
      leadIn = prefix;
    } else if (prefix) {
      out.push({
        ...head,
        ...FRESH,
        scriptText: prefix,
        narration: firstWords(prefix, 8),
        listCut: head.hostPresent ? head.listCut : undefined,
        wordCut: true,
      } as StoryboardScene);
    }
    if (head.hostPresent) handed++;
    const items: StoryboardScene[] = [];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [a, b] = [bounds[k], bounds[k + 1]];
      const text = textOf(a, b);
      // The beat that IS this item already (the planner cut it right) keeps its own picture.
      const exact = scenes.findIndex(
        (s, j) => j >= r.first && j <= r.last && !s.hostPresent && firstTok.get(j) === a && endTok.get(j) === b
      );
      if (exact >= 0) {
        items.push({ ...scenes[exact], listCut: true, wordCut: true, sameShot: undefined });
        continue;
      }
      const bare = bareItem(text);
      const named = new Set(tokenSpans(bare).map(t => stem(t.tok)).filter(w => w.length >= 4 && !PLAIN.has(w)));
      // A planner picture over most of these words that already shows this item keeps its look.
      const own = scenes.findIndex((s, j) => {
        if (j < r.first || j > r.last || s.hostPresent || !named.size) return false;
        const inItem = G.slice(a, b).filter(g => g.scene === j).length;
        return inItem * 2 >= b - a && tokenSpans(s.showSubject ?? "").some(t => named.has(stem(t.tok)));
      });
      const base = scenes[G[a].scene];
      // A STEP is the host's hands doing it (a photo — never a video of hands), on the thing being
      // made; a planner picture that already shows it keeps its look.
      const show =
        own >= 0
          ? scenes[own].showSubject!
          : r.kind === "steps"
            ? `the host's hands, mid-step: ${bare.charAt(0).toLowerCase()}${bare.slice(1)}${opts.main ? `, while making the ${opts.main}` : ""}`
            : `${bare}${opts.main ? ` (for the ${opts.main})` : ""}`;
      const pic = listPicture(base, text, show);
      if (own >= 0) {
        pic.visualPrompt = scenes[own].visualPrompt ?? show;
        pic.humanPresent = scenes[own].humanPresent;
        pic.keyThing = scenes[own].keyThing;
      }
      if (r.kind === "steps") pic.humanPresent = true;
      items.push(pic);
    }
    if (leadIn && items.length) {
      const first = items[0];
      items[0] = { ...first, ...FRESH, scriptText: `${leadIn} ${(first.scriptText ?? "").trim()}`, narration: firstWords(`${leadIn} ${first.scriptText ?? ""}`, 8) };
    }
    // Words after the last item in its own beat.
    const lastScene = scenes[r.last];
    if (r.end < G.length && G[r.end].scene === r.last) {
      const tail = (lastScene.scriptText ?? "").slice(G[r.end].start).trim();
      const next = scenes[r.last + 1];
      const newSentence = /[.!?]["')\]]?\s*$/.test(
        (lastScene.scriptText ?? "").slice(0, G[r.end].start).trim()
      );
      if (lastScene.hostPresent && (newSentence || tokenSpans(tail).length >= HOST_HANDOFF_MIN_WORDS)) {
        // The host speaks on after the list: they come back for the rest of their line.
        items.push({
          ...lastScene,
          ...FRESH,
          scriptText: tail,
          narration: firstWords(tail, 8),
          hostIntro: undefined,
          hostOpener: undefined,
          listCut: undefined,
          wordCut: true,
        } as StoryboardScene);
      } else if (lastScene.hostPresent) {
        // A host line ending in the list: its few closing words stay with the last item.
        const last = items[items.length - 1];
        last.scriptText = `${(last.scriptText ?? "").trim()} ${tail}`.trim();
      } else if (next && !next.hostPresent && !fixedBeat(next) && !startsRegion.has(r.last + 1)) {
        carry = tail;
      } else {
        items.push({ ...lastScene, ...FRESH, scriptText: tail, narration: firstWords(tail, 8), listCut: undefined, wordCut: true } as StoryboardScene);
      }
    }
    out.push(...items);
    applied++;
    i = r.last + 1;
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, applied, handed, cleared, skipped };
}
