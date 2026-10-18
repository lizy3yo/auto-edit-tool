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
 *     way list items are (commas, "and"/"or"), and `itemsAreThings` keeps a list of things only
 *     when every item names one (never "six,", "round ten," or "as rest,"). A general head in front
 *     of examples ("some ordinary place, a waiting room, a church pew") is never an item
 *     (`withoutGeneralHead`), and a parallel series keeps its last member when it is said differently
 *     ("the farmer complains, the senator complains, and the young are already rehearsing the
 *     complaint", `withLastSeriesMember`), and a last item that runs on into a clause of when, where
 *     or why is its words up to that clause ("…a church pew, the kitchen table at two in the morning
 *     when the house is too quiet", job 401, `itemBeforeClause`). When the call fails,
 *     `listsByShape` finds them by sentence shape alone ("X, Y, and Z") — the same rules, so a
 *     film is never worse off; and a list the model ended early where the shape holds more takes the
 *     longer one (`endsEarly`).
 *  2. `applySpokenLists` — re-cuts the film so every item is exactly one picture, wherever the
 *     storyboard cut: a list that starts inside a host line hands over at its first item, words
 *     after the last item go to the next picture, and a piece that is NOT an item of any list loses
 *     the list mark it may have picked up, so it joins its neighbours like any other picture.
 * It replaces the per-piece list patches (`handOffHostLists`, `pullListLeadIns`) as the last word.
 * The motion-graphics planner holds a list graphic it writes on its own to the same rules
 * (`notAListAsSaid`), so a numbered list on screen is always a list the narrator says.
 * Nothing here names a channel or a craft.
 */
import type { StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { safeParseJSON } from "./jsonRepair";
import { namedPeople, showsPerson } from "./hostLook";
import { namesHostBefore } from "./hostIntro";
import {
  FRESH,
  HOST_HANDOFF_MIN_WORDS,
  LIST_ITEM_CLAUSE,
  NOT_A_LIST_ITEM,
  firstWords,
  generalHead,
  ledByGeneralHead,
  maskSeriesCommas,
  notAThing,
  seriesCommas,
  tokenSpans,
  unmaskSeriesCommas,
  withoutGeneralHead,
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
  /**
   * The time and place the list's sentence is set in when that is not the video's own here and now
   * (`listSettingOf`): asked in the same call that finds the lists, since it reads the whole script
   * and so knows the passage a sentence sits in even when the sentence names no time itself (job 409:
   * "The farmer complains, the senator complains, …" is said inside a passage about an ancient
   * writer). Each item's picture is told it (`scene.listSetting`, `listItemClause`). Never on a list
   * of steps, whose pictures are the host's own hands here and now.
   */
  setting?: string;
}

const LIST_MODEL = () => process.env.LIST_MODEL || "claude-sonnet-5-5";

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
  // A number, a length of time, a set phrase or a clause names nothing, even when it opens on a
  // number word like a counted thing does ("six and a half", "give or take", "round ten"), so a
  // run of them never becomes a list (`notAThing`) — nor does a time a sentence opens on ("Two
  // thousand years ago,", "Years ago,") or one describing word on its own ("furious,", job 400).
  if (notAThing(core)) return false;
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

/**
 * Whether a clause ENDS on a general head (`generalHead`): "…usually in some ordinary place",
 * "…I looked everywhere", "…you want a certain kind of wood". A list after such a clause is examples
 * of the head, and the head is what the list hangs off, never its first item (job 400). Pure.
 */
function endsOnGeneralHead(clause: string): boolean {
  const words = clause.trim().split(/\s+/).filter(Boolean);
  for (let k = 1; k <= Math.min(6, words.length); k++) if (generalHead(words.slice(-k).join(" "))) return true;
  return false;
}

/**
 * Whether a piece's words are a general head and nothing else ("some ordinary place,", job 400), in
 * the middle of its sentence — the words that lead a list's first example. Pure.
 */
function onlyAGeneralHead(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  return !!t && !/[.!?]["')\]]?$/.test(t) && generalHead(t);
}

/**
 * The trailing "a/the/some … thing" of a clause, when it is short enough to be a list's first item —
 * never a general head ("…usually in some ordinary place," before "a waiting room, a church pew",
 * job 400: the place was item 1 and got a picture of its own).
 */
function trailingThing(clause: string): string | null {
  if (endsOnGeneralHead(clause)) return null;
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
 * Words that open a clause saying WHEN, WHERE or WHY — what the rest of a sentence a list's last item
 * runs on into opens on ("…the kitchen table at two in the morning WHEN the house is too quiet").
 */
const TRAILING_CLAUSE = new Set([
  "when", "whenever", "where", "wherever", "while", "whilst", "because", "though", "although", "unless",
]);

/**
 * A LAST ITEM IS KEPT WHEN IT RUNS ON INTO A CLAUSE (2026-10-18, Gideon's job 401 at 0:49): "…usually
 * in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when
 * the house is too quiet." names three places, and the list graphic showed two — the third item ran
 * on, with no comma and no "and", into the clause that ends the sentence, so it was 14 words: over the
 * shape rules' limit (the run stopped before it) and the model's (one long item threw its whole list
 * away). The item is its words up to the clause word (`TRAILING_CLAUSE`): "the kitchen table at two in
 * the morning". Its own describing words stay ("at two in the morning"); only a clause of when, where
 * or why goes, and it keeps the item's picture (`applySpokenLists`). Null when the piece has no such
 * clause, when the clause is a word or two ("when needed"), when the words before it end on a
 * preposition ("a plane for | when you need one") or name no thing (`namesAThing`, at most `maxWords`
 * words: "the whole kit cost forty dollars | when I bought it" is a clause, never an item). Pure.
 */
export function itemBeforeClause(piece: string, maxWords = SHAPE_ITEM_MAX_WORDS): string | null {
  const words = piece.trim().replace(/[.!?;:,]+$/, "").split(/\s+/).filter(Boolean);
  const plain = (w: string) => w.toLowerCase().replace(/[^a-z']/g, "");
  let lead = 0;
  while (lead < words.length && JOINERS.has(plain(words[lead]))) lead++;
  // Never "while" as a length of time ("the porch swing for a while when…").
  const stop = words.findIndex((w, k) => k > lead && TRAILING_CLAUSE.has(plain(w)) && !/^(?:a|an|the)$/.test(plain(words[k - 1])));
  // The clause word and at least two words of a clause after it.
  if (stop < 0 || words.length - stop < 3) return null;
  if (HEAD_ENDS.has(plain(words[stop - 1]))) return null;
  const item = words.slice(0, stop).join(" ").replace(/[,;:—–-]+$/, "").trim();
  // "the kind of thing people buy | when they visit" and "the moment the phone rings | while…" sum the
  // list up or tell of a time; neither is one more thing in it.
  const opening = words.slice(lead, Math.min(stop, lead + 3)).map(plain);
  if (!item || [headWord(item), ...opening].some(w => singulars(w).some(s => SUMS_UP.has(s)))) return null;
  // The words before the clause may be a clause themselves, with a verb `namesAThing` does not know:
  // "a warm coat, a hot meal, the house GETS quiet when the kids go to bed" ends on what happens, not
  // on a third thing, and with no "and" in front nothing else says so. Such a piece used to stop the
  // run (too long for an item), so refusing it only keeps what the shape rules found before.
  if (verbInHead(words.slice(lead, stop).map(plain))) return null;
  return namesAThing(item, maxWords) ? item : null;
}

/**
 * Whether an item's leading words — after its first word, up to its first preposition or clause word
 * (`HEAD_ENDS`) — hold a word ending in "-s" with a word on each side of it: a present-tense verb
 * between its subject and what follows ("the house GETS quiet", "the job GETS done"). Never the last
 * of those words, which is what the item names ("the old work boots | by the door"), and never the
 * word right after the first, where a plural names the thing ("the eggs getting cold", "the sales
 * rack"). Pure.
 */
function verbInHead(words: string[]): boolean {
  const end = words.findIndex((w, k) => k > 0 && HEAD_ENDS.has(w));
  const head = words.slice(1, end < 0 ? words.length : end);
  return head.some((w, k) => k > 0 && k < head.length - 1 && w.length >= 4 && /s$/.test(w) && !/(?:ss|us|is|'s)$/.test(w));
}

/** Head words of words that sum a list up rather than add to it ("the KIND of thing", "the WAY it…"). */
const SUMS_UP = new Set(["kind", "sort", "type", "thing", "stuff", "one", "way", "moment", "time"]);

/** Whether two list items are named the same way: both "a/the/some …", or both bare names. */
const sameKind = (a: string, b: string) =>
  DETERMINER.test(stripJoiners(a.trim())) === DETERMINER.test(stripJoiners(b.trim()));

/**
 * The model's list with a last item too long to be one (over `LIST_ITEM_MAX_WORDS`) cut before the
 * clause it runs on into (`itemBeforeClause`) — job 401's "the kitchen table at two in the morning when
 * the house is too quiet" threw away the whole list of three places. Only when the list is clearly one
 * without it: two or more items before it, every one named the same way as the cut item (`sameKind`).
 * A last item within the limit keeps every word: "the moment in the trip when they work" (job 399) is
 * one point, its clause part of what it names. Returns the same array when nothing is cut. Pure.
 */
export function withLastItemCut(items: string[]): string[] {
  if (!Array.isArray(items) || items.length < 3) return items;
  const last = String(items[items.length - 1] ?? "");
  if (tokenSpans(last).length <= LIST_ITEM_MAX_WORDS) return items;
  const cut = itemBeforeClause(last, LIST_ITEM_MAX_WORDS);
  if (!cut || !items.slice(0, -1).every(i => sameKind(String(i ?? ""), cut))) return items;
  return [...items.slice(0, -1), cut];
}

/**
 * "and Facebook Marketplace by what each one does well" → "and Facebook Marketplace": an "and/or"
 * piece whose first few words name a thing and then run into a clause. A clause of when, where or why
 * is cut first, so the item keeps its own describing words ("and the kitchen table at two in the
 * morning | when the house is too quiet", `itemBeforeClause`, job 401). Null otherwise. Pure.
 */
function lastItemBeforeClause(piece: string): string | null {
  if (!/^(?:and|or)\s/i.test(piece.trim())) return null;
  const before = itemBeforeClause(piece);
  if (before) return before;
  const words = piece.trim().split(/\s+/);
  const stop = words.findIndex((w, k) => k > 1 && CLAUSE_START.has(w.toLowerCase()));
  if (stop < 2 || stop > 6) return null;
  const item = words.slice(0, stop).join(" ");
  return namesAThing(item) ? item : null;
}

/**
 * The same with no "and" in front ("a waiting room, a church pew, | the kitchen table at two in the
 * morning when the house is too quiet", job 401): only after two or more items (`before`) named the
 * same way (`sameKind`), so the words are clearly a list, and only before a clause of when, where or
 * why (`itemBeforeClause`) — a piece that merely says more ("a saw, a drill, the whole kit cost forty
 * dollars when I bought it") is no item. Null otherwise. Pure.
 */
function lastItemIntoClause(before: string[], piece: string): string | null {
  if (before.length < 2 || /^(?:and|or)\s/i.test(piece.trim())) return null;
  const cut = itemBeforeClause(piece);
  return cut && before.every(t => sameKind(t, cut)) ? cut : null;
}

/**
 * A clause's last word, when a list of bare names follows it ("You need flour, | sugar, and butter")
 * — never the last word of a general head ("you want a certain kind of WOOD, | oak, walnut…").
 */
function trailingBareThing(clause: string): string | null {
  if (endsOnGeneralHead(clause)) return null;
  const w = /(?:^|\s)([A-Za-z][A-Za-z'-]*)$/.exec(clause.trim())?.[1];
  return w && namesAThing(w) && !DETERMINER.test(w) ? w : null;
}

/**
 * The lists in one sentence, by shape alone: three or more comma-separated pieces that each name a
 * thing ("a churn dash here, a bear paw there, a flying geese row"), or two when the second is
 * joined by a comma AND "and"/"or" ("a saw, and a drill"), or after a general head ("some quiet
 * spot, a porch swing, a park bench" — the head is never an item). A list's first item may end the
 * clause before it ("…sitting at a kitchen table with a straight-stitch machine,"). Two things joined
 * by a bare "and" are not a list ("the potholders and the coasters were done"), nor is "the one
 * that…", nor the describing words in front of ONE thing ("…wrote a short, furious, loving essay",
 * job 400 — never cut at those commas, `seriesCommas`). Returns each list's items without their
 * joiners. Pure.
 */
export function listsByShape(sentence: string): string[][] {
  const pieces = maskSeriesCommas(sentence)
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
      // "a drill and a plane" inside a run is two items — never the "and" between describing words
      // ("a big, heavy, and sturdy table" is one table).
      const both = inSeries(pieces[j]) ? null : /^(.*\S)\s+(?:and|or)\s+(\S.*)$/i.exec(stripJoiners(pieces[j]));
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
    // Facebook Marketplace by what each one does well"): its name is the words before the clause —
    // with no "and" either, after two items, one of them maybe the first item ending the clause before
    // the run ("…in a coat pocket, | a kitchen drawer, | the glove box of the car when…").
    const runBare = run.every(t => !DETERMINER.test(stripJoiners(t)));
    const firstThing = source ? (runBare ? trailingBareThing(source) : trailingThing(source)) : null;
    const tail =
      run.length && j < pieces.length
        ? (lastItemBeforeClause(pieces[j]) ?? lastItemIntoClause([...(firstThing ? [firstThing] : []), ...run], pieces[j]))
        : null;
    if (tail) run.push(tail);
    const bare = run.every(t => !DETERMINER.test(stripJoiners(t)));
    const lead =
      source && run.length >= 2
        ? (bare ? trailingBareThing(source) : trailingThing(source))
        : null;
    let items = [...(lead ? [lead] : []), ...run];
    // A GENERAL HEAD, then examples of it (job 400: "…usually in some ordinary place, a waiting room,
    // a church pew,"): the head is what the list hangs off, never its first item — whether it ends the
    // clause before the list (`trailingThing` refuses it) or opens the run itself ("Some quiet spot, a
    // porch swing, a park bench"). Two examples after a head are a list: the head says examples follow.
    let headed = !lead && run.length >= 2 && !!source && endsOnGeneralHead(source);
    if (items.length >= 3 && ledByGeneralHead(items)) {
      items = items.slice(1);
      headed = true;
    }
    const clean = items.map(t => unmaskSeriesCommas(stripJoiners(t).replace(/[.!?;:,]+$/, "").trim()));
    // The run stops at a parallel series' last member when it is said differently ("…, the old
    // complain, and the young are already rehearsing the complaint", job 400) — it is still an item.
    const full = withLastSeriesMember(sentence, clean);
    const joinedByAnd = full !== clean || /^(?:and|or)\s/i.test(items[items.length - 1] ?? "");
    if (full.length >= 3 || (full.length === 2 && (joinedByAnd || headed))) out.push(full);
    i = j;
  }
  return out;
}

/** Whether a piece holds a run of describing words whose commas `maskSeriesCommas` hid. */
const inSeries = (t: string) => unmaskSeriesCommas(t) !== t;

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

/** A step's ways of doing it: the step, then each choice joined to it after a comma
 * (`joinChoiceSteps`: "catch a flight attendant as they pass, or step back to the galley"). */
const waysOf = (step: string) => step.split(/\s*[,;]\s*(?=(?:or|alternatively)\b)/i);

/**
 * Whether `items` really are a spoken list in `sentence`: every item is there, in order, at most
 * `LIST_ITEM_MAX_WORDS` words, with at most `GAP_MAX_WORDS` words between two items, and joined the
 * way list items are — two items need a comma between them, three or more at least one. A pair
 * joined only by "and" ("the potholders and the coasters") fails, and so does a list led by a general
 * head (`ledByGeneralHead`: "some ordinary place, a waiting room, a church pew", job 400) — the head
 * is dropped first (`withoutGeneralHead`), and a head with one example is no list at all. No item
 * may begin or end at a comma between the describing words of ONE thing (`seriesCommas`): job 400's
 * "…wrote a short, | furious, | loving essay" passed every other test, whether the model or the
 * sentence shape proposed it, and became three pictures and a list graphic. For a list of `steps` the
 * word limit holds for each WAY of a step (`waysOf`): job 399's "catch a flight attendant as they pass,
 * or step back to the galley" is one step of 13 words, two ways of 7 and 6. `maxWords` is that limit:
 * a list graphic's rows are held to everything else but not to it (`notAListAsSaid`). Two steps are a
 * list only when each does something to a thing it names (`stepsAreASequence`, job 408). Pure.
 */
export function validateSpokenList(sentence: string, items: string[], steps = false, maxWords = LIST_ITEM_MAX_WORDS): boolean {
  if (!Array.isArray(items) || items.length < 2) return false;
  if (steps && !stepsAreASequence(items)) return false;
  if (ledByGeneralHead(items)) return false;
  const spans = tokenSpans(sentence);
  const toks = spans.map(t => t.tok);
  const inner = seriesCommas(sentence);
  const holdsInner = (from: number, to: number) => {
    for (const c of Array.from(inner)) if (c >= from && c < to) return true;
    return false;
  };
  let cursor = 0;
  let prevEnd = -1;
  let commas = 0;
  for (const item of items) {
    const want = tokenSpans(String(item ?? "")).map(t => t.tok);
    const ways = steps ? waysOf(String(item ?? "")) : [String(item ?? "")];
    if (!want.length || ways.some(w => tokenSpans(w).length > maxWords)) return false;
    const at = findTokens(toks, want, cursor);
    if (at < 0) return false;
    if (inner.size) {
      // Before the item (past its joiner: ", and loving essay") and after it, up to the next word.
      const b = at > 0 && JOINERS.has(toks[at - 1]) ? at - 1 : at;
      const last = at + want.length - 1;
      if (holdsInner(b > 0 ? spans[b - 1].end : 0, spans[b].start)) return false;
      if (holdsInner(spans[last].end, last + 1 < spans.length ? spans[last + 1].start : sentence.length)) return false;
    }
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

/**
 * What bare words after it DESCRIBE ("it looks | clean, bright, and calm", "it's | cheap, simple,
 * quick and quiet"): a linking verb other than "be", or "be" right after a pronoun. "Be" after a
 * thing is left alone — "the woods I use are | oak, maple, and cherry" is a list of things.
 */
const DESCRIBED_BY =
  /(?:\b(?:looks?|looked|feels?|felt|sounds?|sounded|seems?|seemed|stays?|stayed|(?:keeps?|kept|makes?|made) (?:it|them))|\b(?:it|that|this|they|he|she)(?:'s|'re| is| are| was| were))\s*$/i;

/**
 * Bare words of one or two each, with no "a/the/some", right after a word that makes them describe
 * something (`DESCRIBED_BY`) — describing words, not things, however short and noun-like each
 * looks on its own. Pure.
 */
function describingWords(sentence: string, items: string[]): boolean {
  if (items.some(i => DETERMINER.test(bareItem(i)) || bareItem(i).split(/\s+/).length > 2)) return false;
  const spans = tokenSpans(sentence);
  const at = findTokens(spans.map(t => t.tok), tokenSpans(bareItem(items[0] ?? "")).map(t => t.tok), 0);
  return at >= 0 && DESCRIBED_BY.test(sentence.slice(0, spans[at].start).replace(/’/g, "'"));
}

/**
 * Whether every item of a list of things names a thing (`notAThing`: never a time like "years ago",
 * never one describing word like "busy,"), and the items are not describing words after a linking
 * verb (`describingWords`). One item that is not a thing means the
 * sentence is not a list of things, so the WHOLE list goes — never trimmed to the items that pass:
 * trimmed, "the fence for thrifty, old-fashioned chicken keeping, tell me" (job 355) and "Two
 * thousand years ago, a man named … wrote a short, furious" (job 400) each still left two false
 * items. Two bare words alone are no list of things either (`twoBareWords`: "Flush, and follow.", job
 * 408). Never asked of a sequence of steps (steps are things someone does). Pure.
 */
export function itemsAreThings(sentence: string, items: string[]): boolean {
  return items.every(i => !notAThing(String(i ?? ""))) && !describingWords(sentence, items) && !twoBareWords(sentence, items);
}

/** A point a host lists rather than a thing: a topic opening on a question word ("where they go",
 * "when to retire one", "how much to charge"). */
const POINT = /^(?:how|what|when|where|why|which|whether)\b/i;

/** A sentence quoted in a message, cut to a readable length. */
const quoted = (s: string, max = 140) => `"${s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s}"`;

/**
 * A LIST GRAPHIC IS A LIST THE NARRATOR SAYS (2026-10-18, Gideon's job 400, 1:41): the graphics
 * planner numbered "1 Two thousand years ago / 2 Seneca wrote a short / 3 Furious / 4 Loving essay"
 * on ONE sentence — "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short,
 * furious, loving essay to a man named Paulinus" — a time, a broken clause and describing words. A
 * list the pipeline finds has passed the rules here already; a list graphic the planner writes on
 * its own had passed nothing. Why a list graphic's rows, as said (`rows`: each row's spoken words),
 * are NOT a spoken list by the rules every found list passes — or undefined when they are:
 *  - every row names a thing (`notAThing`: never a number, a length of time, a set phrase, an
 *    aside or a clause);
 *  - rows said in ONE sentence of `script` (what is said around the graphic) are said there as a
 *    list: in order, at most `GAP_MAX_WORDS` words apart, joined by commas (`validateSpokenList`),
 *    and are not describing words after a linking verb (`describingWords`). A row may be as long as
 *    it is said — a graphic shows a short label for it, where a list's pictures need short items:
 *    the same film's "Who Seneca was" rows ("an advisor standing one step from the throne, buried
 *    under exactly the kind of obligations we are about to talk about — and a man who, years later,
 *    would be ordered to end his own life") are a list of what one man was, 13 words to a row.
 * Rows in different sentences ("A cord under a rug. A space heater quietly cooking the side of a
 * mattress at 2 in the morning.", Frederick's job 393) and rows not found in `script` (a number
 * said as digits) are held to the first rule only: nothing here refuses what it cannot read.
 * With `points` (the host listing what is coming), a row may also be a TOPIC opening on a question
 * word (`POINT`): Frederick's opening "…detectors, where they go, and when to retire one" (jobs 385,
 * 393, 396) is three points of an agenda — no picture could show "when to retire one", but a host's
 * list window can. Pure.
 */
export function notAListAsSaid(script: string, rows: string[], opts: { points?: boolean } = {}): string | undefined {
  const said = rows.map(r => bareItem(String(r ?? "")));
  for (let k = 0; k < said.length; k++) {
    if (opts.points && POINT.test(said[k])) continue;
    const why = notAThing(said[k]);
    if (why) return `row ${k + 1} ("${said[k]}") names no thing (${why})`;
  }
  if (said.length < 2) return undefined;
  // Where the rows are said: the tightest run holding every row in order.
  const sentences = splitSentences(script);
  const flat: { tok: string; s: number }[] = [];
  sentences.forEach((s, n) => tokenSpans(s).forEach(t => flat.push({ tok: t.tok, s: n })));
  const toks = flat.map(t => t.tok);
  const wants = said.map(r => tokenSpans(r).map(t => t.tok));
  let best: number[] | null = null;
  let span = Infinity;
  for (let i = findTokens(toks, wants[0], 0); i >= 0; i = findTokens(toks, wants[0], i + 1)) {
    const at = [i];
    let cursor = i + wants[0].length;
    for (const w of wants.slice(1)) {
      const j = findTokens(toks, w, cursor);
      if (j < 0) break;
      at.push(j);
      cursor = j + w.length;
    }
    if (at.length === wants.length && cursor - i < span) [best, span] = [at, cursor - i];
  }
  if (!best) return undefined;
  const bySentence = new Map<number, string[]>();
  best.forEach((i, k) => bySentence.set(flat[i].s, [...(bySentence.get(flat[i].s) ?? []), said[k]]));
  for (const [s, group] of Array.from(bySentence)) {
    if (group.length < 2) continue;
    const named = group.map(r => `"${r}"`).join(", ");
    if (!validateSpokenList(sentences[s], group, false, Infinity))
      return `${named} are not said as a list — one after another, joined by commas — in ${quoted(sentences[s])}`;
    if (describingWords(sentences[s], group)) return `${named} are describing words in ${quoted(sentences[s])}, not things`;
    // A job keeps the lists found when it was made: job 408 kept "Flush, follow" and its planner
    // numbered it "1 Flush → 2 Follow".
    if (twoBareWords(sentences[s], group)) return `${named} are two bare words in ${quoted(sentences[s])} — as likely two actions as two things`;
  }
  return undefined;
}

/** What opens each clause of a parallel series ("THE farmer complains, THE senator complains"). */
const SERIES_OPENER = new Set(["a", "an", "the", "my", "your", "our", "his", "her", "their", "every", "each"]);
/** The most words one clause of such a series may have: an opener, who or what, and the shared word. */
const SERIES_CLAUSE_MAX_WORDS = 6;
/** Where the series' last member stops: the next comma, semicolon, colon or dash, or the sentence's end. */
const MEMBER_END = /[,;:—–]|\s-\s|[.!?](?=["')\]]?(?:\s|$))/;
/** Words that open a clause of its own right after "the truth is" / "the point was" ("…is EVERYONE complains"). */
const OWN_CLAUSE_OPENER = new Set([
  "that", "everyone", "everybody", "nobody", "no", "none", "someone", "somebody", "people", "there",
  "i", "we", "you", "they", "he", "she", "it",
]);

/**
 * A PARALLEL SERIES KEEPS ITS LAST MEMBER (2026-10-18, job 400 at 2:36): "The farmer complains, the
 * senator complains, the old complain, and the young are already rehearsing the complaint." was cut
 * after "the old" — the last member of a series is where a speaker says it differently, and the shape
 * rules stop at the first piece that does not name a thing — so "the young", the point of the line,
 * played after the list graphic had closed, on a picture outside the list. When every item is a short
 * clause ENDING ON THE SAME WORD ("… complains", "… complain"), and right after the last one comes
 * "and" (a comma before it or not) with a clause that opens like them ("the …") and says that word
 * again in any form ("… rehearsing the complaint"), that clause is the series' last item, whole, up
 * to the next comma or the sentence's end — so its picture is the whole clause, like the items before
 * it. Nothing is added without that echo: "the farmer complains, the senator complains, and the truth
 * is nobody listens" ends on a clause about something else (so does "…, and the truth is everyone
 * complains", which says the word again only inside a clause of its own), and a list of things that do
 * not end on one word ("a saw, a drill, and the whole thing cost me forty dollars") is never touched. The longer
 * list is kept only when it still passes `validateSpokenList` and `itemsAreThings`, so a member that
 * fails them never costs the list the items it had. Returns the same array when nothing is added. Pure.
 */
export function withLastSeriesMember(sentence: string, items: string[]): string[] {
  if (!Array.isArray(items) || items.length < 2) return items;
  const spans = tokenSpans(sentence);
  const toks = spans.map(t => t.tok);
  const openers = new Set<string>();
  let shared: string | null = null;
  let cursor = 0;
  for (const item of items) {
    const want = tokenSpans(String(item ?? "")).map(t => t.tok);
    // An opener, at least one word for who or what, then the word every clause ends on.
    if (want.length < 3 || want.length > SERIES_CLAUSE_MAX_WORDS || !SERIES_OPENER.has(want[0])) return items;
    const end = stem(want[want.length - 1]);
    if (shared === null) shared = end;
    else if (end !== shared) return items;
    const at = findTokens(toks, want, cursor);
    if (at < 0) return items;
    openers.add(want[0]);
    cursor = at + want.length;
  }
  if (!shared || shared.length < 3 || cursor >= toks.length || toks[cursor] !== "and") return items;
  if (!/^\s*,?\s*$/.test(sentence.slice(spans[cursor - 1].end, spans[cursor].start))) return items;
  const open = cursor + 1;
  if (open >= toks.length || !openers.has(toks[open])) return items;
  const rest = sentence.slice(spans[open].start);
  const stop = rest.search(MEMBER_END);
  const member = (stop < 0 ? rest : rest.slice(0, stop)).trim();
  const words = tokenSpans(member).map(t => t.tok);
  if (words.length < 2 || words.length > LIST_ITEM_MAX_WORDS) return items;
  const said = shared;
  const echoes = (w: string) => stem(w) === said || (said.length >= 5 && w.startsWith(said));
  // Said again AFTER its own who or what, like the clauses before it: "and the complaints never end"
  // only sums the series up — its subject is the shared word itself, not one more member.
  if (!words.slice(2).some(echoes)) return items;
  // "and the truth is everyone complains" says the word again inside a clause of its own — a summing-up
  // ("the truth is …", "the point was that …"), not one more member; "and the child is already learning
  // to complain" is still one.
  if ((words[2] === "is" || words[2] === "was") && OWN_CLAUSE_OPENER.has(words[3] ?? "")) return items;
  const longer = [...items, member];
  return validateSpokenList(sentence, longer) && itemsAreThings(sentence, longer) ? longer : items;
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
item). A GENERAL word the items are examples of is never an item: in "…waits in some quiet spot, a
porch swing, a park bench, the front seat of a parked car" the items are the porch swing, the park
bench and the front seat — "some quiet spot" only says what kind of things they are. In a sequence of
steps, a CHOICE of another way to do a step ("call the office, or send an email") is part of that
step, never the next step: give both ways as ONE item.

NOT a list:
- one thing being talked about ("the one that paid me best came out of a coffee can")
- two things together as the subject or object of a verb, joined only by "and" ("by the time the
  potholders and the coasters were done")
- reasons, places, times, numbers, prices or describing words one after another
- the describing words in front of ONE thing ("she wrote a long, slow, careful letter" is one letter),
  and the time a sentence opens on ("years ago, …")
- a story of what happened ("I went home, made dinner, and slept") — steps are things to DO
- words about how the video itself will go, or two bare words ("watch, and learn") — steps are three
  or more, or two that each do something to a thing they name ("fill the jar, and close the lid")

For each list also give setting: when its sentence is set in ANOTHER TIME or a FARAWAY PLACE than the
video's own here and now — inside a passage of history, a story of long ago, what a writer of another
age said or saw, how things are done in another country — that time and place in 3-10 plain words
("a medieval market town, about 1300", "a fishing village in Norway in the 1890s"). Read the sentences
around it: a list counts as inside such a passage even when its own sentence names no time or place
("the baker grumbles, the miller grumbles, …" told of that town). setting is null when the list is
about the video's own here and now.

Answer with JSON only: {"lists":[{"sentence":<number>,"kind":"things"|"steps","items":["…","…"],"setting":null}]} —
{"lists":[]} when there are none.`;

/** Words that only say "here and now" (or nothing): a setting made of these adds nothing to a picture. */
const PRESENT_WORDS = new Set([
  "the", "a", "and", "of", "in", "s", "present", "day", "days", "today", "todays", "modern", "time", "times", "now",
  "nowadays", "contemporary", "current", "currently", "here", "world", "video", "videos", "own", "ordinary",
  "everyday", "same", "as", "rest", "null", "none", "n", "no", "nothing", "unknown", "unspecified", "setting",
]);

/**
 * The list finder's `setting`, cleaned: the time and place a list's sentence is set in when that is
 * not the video's own here and now — a short phrase of at most 14 words and 100 characters, quotes
 * and closing marks taken off. Undefined for anything else: no answer, null, a rambling one, or one
 * that only says the present ("today", "the present day", "modern times", "the video's own world"),
 * which would add nothing to a picture. A faraway place today keeps its place ("a fishing village in
 * Japan today"). Job 409's list inside its passage about an ancient writer is what it is for. Pure.
 */
export function listSettingOf(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.,;:!?]+$/g, "")
    .trim();
  if (!text || text.length > 100) return undefined;
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!words.length || words.length > 14) return undefined;
  if (words.every(w => PRESENT_WORDS.has(w))) return undefined;
  return text;
}

/**
 * Read the model's answer: lists that pass `validateSpokenList` against their own sentence and, for
 * a list of things, `itemsAreThings` — each without a general head in front of its examples. Pure.
 */
export function parseSpokenLists(text: string, sentences: string[]): SpokenList[] | null {
  const r = safeParseJSON<{ lists?: unknown }>(text);
  const parsed = r.success ? r.data : null;
  if (!parsed || !Array.isArray(parsed.lists)) return null;
  const out: SpokenList[] = [];
  for (const raw of parsed.lists as { sentence?: unknown; items?: unknown; kind?: unknown; setting?: unknown }[]) {
    const n = Number(String(raw?.sentence ?? "").replace(/^#/, ""));
    // A general head the model counted as item 1 ("some ordinary place", job 400) is dropped, not
    // the whole list: the examples after it ARE the list. Dropped before the thing check, so a head
    // that names nothing ("anything, a mouse, a snake, a raccoon") no longer costs the list.
    const items = withoutGeneralHead(Array.isArray(raw?.items) ? raw.items.map(i => String(i ?? "").trim()) : []);
    if (!Number.isInteger(n) || !sentences[n]) continue;
    const steps = raw?.kind === "steps";
    // The model is told numbers and describing words are not lists, and still answered "as health,
    // as rest, as a good night's sleep…" (job 362, again in jobs 392 and 395). Dropped here, the
    // sentence shape may still find the real list in that sentence (`findSpokenLists` adds it).
    if (!steps && !itemsAreThings(sentences[n], items)) continue;
    // A step offered as a CHOICE ("…, or step back to the galley", job 399) is part of the step
    // before it, never the next one (`joinChoiceSteps`). A list of things keeps its "or": "a saw,
    // a drill, or a plane" is three things to show — and a last item that runs on into a clause of
    // when, where or why past the item limit loses the clause, not the list (`withLastItemCut`, job
    // 401: "the kitchen table at two in the morning when the house is too quiet").
    const kept = steps ? joinChoiceSteps(sentences[n], items) : withLastItemCut(items);
    if (!validateSpokenList(sentences[n], kept, steps)) continue;
    // The time and place it is set in, when not the video's own here and now (job 409, `listSettingOf`).
    // Never on STEPS: each step is drawn as "the host's hands, mid-step" (`applySpokenLists`), steps
    // are what the viewer does here and now, and a setting there would ask the host's own sleeves to
    // be dressed for another age beside the clause that draws them in the host's clothes.
    const setting = steps ? undefined : listSettingOf(raw?.setting);
    const where = setting ? { setting } : {};
    if (steps) out.push({ sentence: n, items: kept, kind: "steps" });
    // A parallel series the model ended one member early, at the member said differently ("…, the old
    // complain, and the young are already rehearsing the complaint", job 400), gets it back.
    else out.push({ sentence: n, items: withLastSeriesMember(sentences[n], kept), ...where });
  }
  return out.sort((a, b) => a.sentence - b.sentence);
}

/** Words that open a clause about someone (a story), never a step to do. */
const SUBJECT_START = /^(?:i|you|we|he|she|they|it|there|that|this|these|those|my|our|his|her|their)\b/i;

/**
 * Words that open a CHOICE, not the next step: "or", "or else", "alternatively". Helena's job 399
 * (2:19): "So wait until everyone's been served, then catch a flight attendant as they pass, or step
 * back to the galley, and phrase it as an offer." Stepping back to the galley is ANOTHER WAY to reach
 * the crew, not something done after catching one; drawn as the next step (the graphic's numbered
 * chain "1 Wait until served → 2 Catch an attendant → 3 Or step to galley → 4 …") it tells the viewer
 * to do both. A choice is part of the step before it.
 */
const OFFERS_A_CHOICE = /^(?:or|alternatively)\b/i;
const CHOICE_WORDS = new Set(["or", "alternatively"]);

/** The words between two steps open a new comma piece on a choice: "…as they pass, or step back". */
const CHOICE_PIECE = /^\s*[,;]\s*(?:or|alternatively)\b/i;

/**
 * A step list with every CHOICE joined to the step before it: a step that opens on "or" /
 * "alternatively", or that the words between it and the step before lead into with one (the model
 * leaves the joining "or" out of its items, job 399's "…as they pass, or step back to the galley")
 * — said right before the step ("or", "or else"), or opening a comma piece ("…, or you can step
 * back") — becomes part of that step: one item, the sentence's own words from the first way's start
 * to the choice's end. An "or" elsewhere in those words is no choice: they may hold up to
 * `GAP_MAX_WORDS` words the model left off the step before ("let it sit a minute | or two, then |
 * wipe it off"), and that "or" belongs to that step. The first step is never joined to anything
 * (job 399's "Or look underneath this video, open the description, and tap the link at the top."
 * offers the whole sequence as a choice, and its steps are still done in order). A list whose items
 * are not found in order is returned as it is, for `validateSpokenList` to refuse; an item not
 * joined keeps its own text. Pure.
 */
export function joinChoiceSteps(sentence: string, items: string[]): string[] {
  const spans = tokenSpans(sentence);
  const toks = spans.map(t => t.tok);
  const found: { a: number; b: number; item: string }[] = [];
  let cursor = 0;
  for (const item of items) {
    const want = tokenSpans(String(item ?? "")).map(t => t.tok);
    const at = findTokens(toks, want, cursor);
    if (at < 0) return items;
    found.push({ a: at, b: at + want.length, item });
    cursor = at + want.length;
  }
  const out: { a: number; b: number; item: string }[] = [];
  for (const f of found) {
    const prev = out[out.length - 1];
    const gap = prev ? toks.slice(prev.b, f.a) : [];
    const choice =
      !!prev &&
      (CHOICE_WORDS.has(toks[f.a]) ||
        (gap.length > 0 && CHOICE_WORDS.has(gap[gap.length - 1])) ||
        gap.slice(-2).join(" ") === "or else" ||
        CHOICE_PIECE.test(sentence.slice(spans[prev.b - 1].end, spans[f.a].start)));
    if (!choice) out.push({ ...f });
    else {
      prev.b = f.b;
      prev.item = sentence.slice(spans[prev.a].start, spans[prev.b - 1].end);
    }
  }
  return out.map(o => o.item);
}

/**
 * The steps in one sentence, by shape: three or more comma pieces, the last joined by "and"/"then",
 * each a short instruction that starts on its own verb-like word — no subject ("I went…"), no
 * determiner ("a saw" is a thing), no aside ("Honestly"), at most `STEP_MAX_WORDS`. Never cut at a
 * comma between describing words: "Cut a long, thin strip, glue it down, and clamp it" is three
 * steps, the first with its strip whole (`maskSeriesCommas`). A piece that offers a choice
 * (`OFFERS_A_CHOICE`: "…, or soak it") is part of the step before it, never a step of its own — it
 * used to sink the whole sentence instead. Pure.
 */
export function stepsByShape(sentence: string): string[] | null {
  const masked = maskSeriesCommas(sentence);
  // Each comma piece where it sits, so a choice joined to its step keeps the sentence's own words.
  const pieces: string[] = [];
  let from = -1;
  let to = -1;
  for (const m of Array.from(masked.matchAll(/[^,;]+/g))) {
    const text = m[0].trim();
    if (!text) continue;
    const [a, b] = [m.index!, m.index! + m[0].length];
    if (from >= 0 && OFFERS_A_CHOICE.test(text)) to = b;
    else {
      if (from >= 0) pieces.push(masked.slice(from, to).trim());
      [from, to] = [a, b];
    }
  }
  if (from >= 0) pieces.push(masked.slice(from, to).trim());
  if (pieces.length < 3) return null;
  const last = pieces[pieces.length - 1];
  if (!/^(?:and|then|and then)\s/i.test(last)) return null;
  const items = pieces.map(p => unmaskSeriesCommas(p.replace(/^(?:and then|and|then)\s+/i, "").replace(/[.!?]+$/, "").trim()));
  // …never a date or a number among the pieces ("in 2019, in 2020, and in 2021").
  return items.every(t => isInstruction(t) && !/\d/.test(t)) ? items : null;
}

/**
 * A past or -ing form ("grabbed", "making"), never an instruction's plain verb — though a plain verb
 * may END like one: "feed", "bleed", "speed" (one or two letters before "-eed"; "agreed" is past) and
 * "bring", "string", "sing" (no vowel before the "-ing"). Read as past forms, they sank job 352's "Bring
 * your cut list, match the short parts to short boards, and save the long, clear stock…" by its shape,
 * and — once a model's two steps were held to `isInstruction` too (job 408) — would have refused "fill
 * the feeder, and bring it inside at dusk". Pure.
 */
const pastOrIng = (w: string) =>
  /ing$/.test(w) ? /[aeiouy]/.test(w.slice(0, -3)) : /ed$/.test(w) && !/^(?:[a-z]{0,2}eed|proceed|succeed|exceed|shred|embed)$/.test(w);

/**
 * Whether one step is a short instruction that starts on its own verb-like word — no subject ("I
 * went…"), no determiner ("a saw" is a thing), no aside ("Honestly"), at most `STEP_MAX_WORDS` words
 * in each of its ways (`waysOf`). A number inside it is the shape rules' concern only (`stepsByShape`):
 * "cut it to 24 inches" is an instruction all the same. Pure.
 */
function isInstruction(t: string): boolean {
  // The step itself is its first way; a choice joined to it is held only to the length limit.
  const ways = waysOf(t);
  const words = ways[0].split(/\s+/);
  const first = (words[0] ?? "").replace(/[^a-z]/gi, "").toLowerCase();
  return (
    words.length >= 2 &&
    ways.every(w => w.split(/\s+/).length <= STEP_MAX_WORDS) &&
    !!first &&
    !SUBJECT_START.test(first) &&
    // …and a subject in a contraction ("and you'll know", "and I'll answer" read "youll", "ill"
    // above): a sentence an "or" piece used to sink can now reach this line, so its last piece is
    // held to the same rule.
    !SUBJECT_START.test((words[0] ?? "").toLowerCase().replace(/’/g, "'")) &&
    !DETERMINER.test(t) &&
    !NOT_A_LIST_ITEM.has(first) &&
    !/ly$/.test(first) &&
    !JOINERS.has(first) &&
    // An instruction opens on its plain verb ("drill", "oil", "give"): never a past or -ing form,
    // never "money was tight" (a subject then its verb).
    !pastOrIng(first) &&
    !STATE_VERB.test(words[1] ?? "")
  );
}

/** Words right after a step's verb that point at a thing named before ("drain IT outside"). */
const OBJECT_WORD = new Set(["it", "them", "this", "that", "these", "those", "both", "everything"]);
/** A word that may stand between a verb and the thing it acts on ("look AT it", "turn OVER the board"). */
const VERB_PARTICLE = new Set(["at", "to", "on", "onto", "into", "in", "over", "with", "under", "through", "around", "up", "down", "out", "off"]);

/**
 * Whether one step does something TO A THING it names: past its verb, a noun phrase led by "a/the/
 * your/…" or a count ("hold your phone up to the screen", "tap the link"), or "it/them/…" right after
 * the verb, or after the verb and one particle, for a thing named before ("drain it outside", "store it
 * sealed", "look at it"), or a NAME past the verb ("open Etsy", "tap Sell" — a capital that is not
 * "I"). A bare verb names nothing ("flush", "follow"), and neither does a step that only says how, when
 * or where ("go slow", "wait until everyone's been served", "look at what it gives back"). Pure.
 */
function actsOnAThing(step: string): boolean {
  const raw = waysOf(step)[0].trim().split(/\s+/).filter(Boolean);
  const words = raw
    .map(w => w.toLowerCase().replace(/’/g, "'").replace(/^[^a-z0-9$]+|[^a-z0-9%']+$/g, ""))
    .filter(Boolean);
  if (words.length < 2) return false;
  if (raw.slice(1).some(w => /^[A-ZÀ-ÖØ-Þ]/.test(w.replace(/^["'“‘(]+/, "")) && !/^I(?:['’]\w+)?\W*$/.test(w))) return true;
  if (OBJECT_WORD.has(words[1]) || (VERB_PARTICLE.has(words[1]) && OBJECT_WORD.has(words[2] ?? ""))) return true;
  return words.slice(1).some((_, k) => DETERMINER.test(words.slice(k + 1).join(" ")));
}

/** A clause of when or if in front of a step, up to its comma ("when a link shows on the phone, | tap it"). */
const LEADING_WHEN = /^(?:when|whenever|once|after|before|if|as soon as|until|while)\b[^,]*,\s*/i;

/**
 * TWO STEPS ARE A LIST ONLY WHEN EACH ONE DOES SOMETHING TO A THING (2026-10-18, job 408 at 1:08): "So.
 * We will go the way the water goes. Flush, and follow." says how the video will run — follow the
 * water's route — and it was cut as a list: two flash pictures (0.75 s and 1.28 s) and a numbered "1
 * Flush → 2 Follow", where "follow" names nothing a picture could show but the same water again.
 * Three or more steps are a sequence by their number; two are a list of steps only when each is an
 * instruction (`isInstruction`) on a thing it names (`actsOnAThing`): "Hold your phone up to the
 * screen with its camera on, and aim it at the little black and white code" (job 410), "drain it
 * outside, store it sealed" (job 413). A clause of when in front of a step is read past ("…, and when
 * a link shows on the phone, tap it", job 404). The shape rules never found two (`stepsByShape` needs
 * three pieces); the model's answer was held to nothing of the kind, and is now (`validateSpokenList`).
 * Pure.
 */
export function stepsAreASequence(items: string[]): boolean {
  if (!Array.isArray(items) || items.length < 2) return false;
  if (items.length > 2) return true;
  return items.every(i => {
    const step = stripJoiners(String(i ?? "").trim()).replace(LEADING_WHEN, "").replace(/[.!?]+$/, "").trim();
    return isInstruction(step) && actsOnAThing(step);
  });
}

/**
 * TWO BARE WORDS ARE NO LIST OF THINGS (same film): with no "a/the/some…" and nothing else said with
 * them, two single words joined by a comma read as two actions as easily as two things — "Flush, and
 * follow." passed every rule a list of things is held to, by sentence shape and by the model alike,
 * and became the false list above. One of them a NAME is a thing all the same ("on Etsy, or eBay"): a
 * capital that is not the sentence's first letter — read where the sentence SAYS the word, since a
 * list graphic's rows come capitalised ("1 Flush → 2 Follow"). Three or more bare words stay a list
 * ("Wash, towel, dryer, brush", job 319), and so do two with words of their own ("brown sugar, and
 * butter"). Pure.
 */
export function twoBareWords(sentence: string, items: string[]): boolean {
  if (!Array.isArray(items) || items.length !== 2) return false;
  const opening = sentence.trim().replace(/^["'“‘(]+/, "");
  return items.every(i => {
    const word = stripJoiners(String(i ?? "").trim()).replace(/[.!?;:,]+$/, "").trim();
    if (!word || /\s/.test(word) || DETERMINER.test(word)) return false;
    const said = new RegExp(`(?<![\\p{L}\\p{N}'’])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").exec(opening);
    const form = said ? said[0] : word;
    const atStart = said ? said.index === 0 : opening.startsWith(word);
    return !/[A-Z]/.test(atStart ? form.slice(1) : form);
  });
}

/** A second word that makes a piece a statement about something ("money WAS tight"), not a step. */
const STATE_VERB = /^(?:was|were|is|are|am|be|been|had|has|have|did|does|do|got|gets|went|goes|said|says|made|makes|came|comes|could|would|should|will|can|may|might|must)$/i;

/** The most words one step may have. */
const STEP_MAX_WORDS = 12;

/**
 * Every list the shape rules find, sentence by sentence — things (each item naming one,
 * `itemsAreThings`), then steps. Pure.
 */
export function spokenListsByShape(sentences: string[], only?: Set<number>): SpokenList[] {
  const out: SpokenList[] = [];
  sentences.forEach((s, n) => {
    if (only && !only.has(n)) return;
    for (const items of listsByShape(s))
      if (validateSpokenList(s, items) && itemsAreThings(s, items)) out.push({ sentence: n, items });
    if (out.some(l => l.sentence === n)) return;
    const steps = stepsByShape(s);
    if (steps && validateSpokenList(s, steps, true)) out.push({ sentence: n, items: steps, kind: "steps" });
  });
  return out;
}

/** An item's words, for comparing two lists' items whatever their case or punctuation. */
const wordsOf = (item: string) => tokenSpans(String(item ?? "")).map(t => t.tok).join(" ");

/**
 * Whether `longer` (a list the sentence shape found in `sentence`) is `list` (the model's) with the one
 * last item the model left out because it ran on into a clause of when, where or why (job 401: "a
 * waiting room, a church pew" without "the kitchen table at two in the morning | when the house is
 * too quiet"): two lists of things in one sentence, every item of `list` word for word the item at the
 * same place in `longer`, exactly one more item after them, said right before a `TRAILING_CLAUSE`
 * word — and `list` still open, its last item not joined by "and"/"or". A list that closed on "and"
 * is whole: Sam's job 407 "…an axe, a froe, and a drawknife, and the steel in those three was the one
 * thing…" is three tools, and the shape's "and the steel" a new clause. A list of steps is never
 * lengthened this way. Pure.
 */
export function endsEarly(list: SpokenList, longer: SpokenList, sentence: string): boolean {
  if (list.kind === "steps" || longer.kind === "steps" || list.sentence !== longer.sentence) return false;
  if (longer.items.length !== list.items.length + 1 || !list.items.length) return false;
  if (!list.items.every((it, k) => wordsOf(it) === wordsOf(longer.items[k]))) return false;
  const toks = tokenSpans(sentence).map(t => t.tok);
  let cursor = 0;
  let lastAt = -1;
  longer.items.forEach((item, k) => {
    const want = tokenSpans(String(item ?? "")).map(t => t.tok);
    const at = cursor < 0 ? -1 : findTokens(toks, want, cursor);
    // Where the model's last item starts: the word before it says whether its list was closed.
    if (k === list.items.length - 1) lastAt = at;
    cursor = at < 0 ? -1 : at + want.length;
  });
  return cursor > 0 && lastAt > 0 && !JOINERS.has(toks[lastAt - 1]) && TRAILING_CLAUSE.has(toks[cursor] ?? "");
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
      (await invokeClaude({ systemPrompt: system, userMessage: user, maxTokens: 8000, model: LIST_MODEL(), step: "Spoken lists" })).text);
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
      // And a list the model ended one item early, at an item that ran on into a clause of when, where
      // or why, is the shape's longer one (`endsEarly`; job 401: the model gave "a waiting room, a
      // church pew" and left out "the kitchen table at two in the morning", before "when the house is
      // too quiet" — the list graphic showed two of three places).
      for (const extra of spokenListsByShape(sentences, new Set(ids))) {
        const shorter = got.findIndex(l => l.sentence === extra.sentence && endsEarly(l, extra, sentences[extra.sentence]));
        // The shape knows no time or place: the longer list keeps the one the model read (job 409).
        const setting = shorter >= 0 ? got[shorter].setting : undefined;
        if (shorter >= 0) got[shorter] = setting ? { ...extra, setting } : extra;
        else if (!got.some(l => l.sentence === extra.sentence)) got.push(extra);
      }
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

/** A step's first way of doing it, before a choice joined to it after a comma ("…as they pass, or
 * step back to the galley"); an "or" inside one piece ("two or three drops") stays. */
const firstChoice = (step: string) => step.replace(/\s*[,;]\s*(?:or|alternatively)\b[\s\S]*$/i, "").trim() || step;

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

/** Words that open a question or a clause in an item's place ("WHAT the remaining years are for"). */
const QUESTION_WORD = /^(?:what|what's|whats|how|how's|why|who|who's|whom|whose|when|where|where's|whether|which|whatever|whoever|wherever)$/;
/**
 * Words that end an item's leading words: a preposition, a clause or a describing phrase after its
 * head ("a bottle OF water", "the moment IN the trip WHEN they work", "a mountain of scraps TOO
 * pretty", "all the scraps YOU can find").
 */
const HEAD_ENDS = new Set([
  "of", "in", "on", "at", "for", "with", "from", "to", "into", "onto", "over", "under", "underneath",
  "beneath", "behind", "beside", "between", "by", "near", "about", "around", "across", "through",
  "along", "past", "against", "inside", "outside", "above", "below", "without", "within", "after",
  "before", "during", "toward", "towards", "up", "down", "off", "like", "than", "as", "too", "that",
  "which", "who", "whom", "whose", "when", "where", "while", "if", "because", "and", "or", "but",
  "so", "i", "you", "he", "she", "we", "they", "it", "here", "there",
]);
/**
 * A counted length of something ("a yard of fabric", "two feet of rope", "half a yard of denim"),
 * with what is measured — never "the back yard of the house", which nothing counts.
 */
const MEASURED_LENGTH =
  /^(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|half an?|an? few|an? couple of|several|\d[\d./]*)\s+(?:yards?|foot|feet|inch(?:es)?|met(?:er|re)s?)\s+of\s+(.+)$/;
/**
 * The word an item is about: the last word before its first preposition or clause ("old shop HABITS
 * of mine"). A last word is the head even when it can be a preposition ("the past"), and a closing
 * "too / as well / either" is not part of what is named ("some grief too"). A counted length is
 * judged on what it measures: in "a yard of fabric, a spool of thread, and a pack of needles" — a
 * sewing kit on a table — the "yard" is not the place `NOT_LAID_OUT` holds.
 */
function headWord(item: string): string {
  const text = bareItem(item)
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\s+(?:too|as well|either)$/, "");
  const measured = MEASURED_LENGTH.exec(text);
  if (measured) return headWord(measured[1]);
  const words = text
    .split(/\s+/)
    .map(w => w.replace(/[^a-z'-]/g, ""))
    .filter(Boolean);
  const stop = words.findIndex((w, k) => k > 0 && k < words.length - 1 && HEAD_ENDS.has(w));
  return (stop < 0 ? words : words.slice(0, stop)).pop() ?? "";
}
/**
 * Endings that make a word an idea or a quality, never a thing on a table ("loneliness", "dignity",
 * "stoicism", "childhood"). "-hood" only past seven letters ("a hood" is a thing), and the few
 * things that end the same way are left out by name.
 */
const IDEA_ENDING = /^(?:[a-z-]{3,}(?:ness|ity|ism)|[a-z-]{4,}hood)$/;
const ENDS_LIKE_AN_IDEA = new Set(["harness", "vanity", "mechanism"]);
/**
 * Head words that name an idea, a feeling, a quality, a time or a place — what no photograph can lay
 * beside other things. A closed list of ordinary English, no channel's words; a thing it misses only
 * keeps the group picture it had before.
 */
const NOT_LAID_OUT = new Set([
  // feelings and states of mind
  "grief", "sorrow", "joy", "love", "hate", "hatred", "fear", "anger", "rage", "guilt", "shame",
  "pride", "regret", "remorse", "worry", "anxiety", "stress", "boredom", "hope", "despair", "envy",
  "jealousy", "gratitude", "peace", "calm", "confidence", "courage", "patience", "faith", "trust",
  "doubt", "loss", "pain", "suffering", "heartbreak", "nostalgia", "mood", "feeling", "emotion",
  // ideas, qualities and the things a life is made of
  "idea", "thought", "opinion", "purpose", "meaning", "wisdom", "truth", "freedom", "justice",
  "virtue", "principle", "value", "belief", "philosophy", "advice", "lesson", "knowledge", "reason",
  "luck", "fate", "chance", "risk", "success", "failure", "health", "wealth", "death", "mortality",
  "life", "legacy", "character", "reputation", "respect", "dignity", "honor", "honour", "power",
  "privacy", "safety", "struggle", "problem", "question", "answer", "decision", "choice",
  "goal", "dream", "memory", "habit", "skill", "experience", "mindset", "attitude", "relationship",
  "friendship", "marriage", "hardship", "history", "tradition", "culture", "progress", "growth",
  "effort", "discipline", "motivation", "ambition", "attention", "focus",
  // times
  "time", "moment", "future", "past", "youth", "age", "retirement", "lifetime", "year", "month",
  "week", "weekend", "day", "night", "morning", "evening", "hour", "minute", "season", "decade",
  // places: two of them never share one photograph, and a place is not laid on a table
  "place", "room", "kitchen", "bedroom", "bathroom", "garage", "basement", "attic", "yard",
  "backyard", "porch", "home", "office", "store", "market", "marketplace", "fair", "church",
  "school", "hospital", "airport", "park", "street", "town", "city",
]);
/** A head word as it may stand in `NOT_LAID_OUT`: itself or its singular ("habits", "memories", "churches"). */
const singulars = (w: string) => [w, w.replace(/ies$/, "y"), w.replace(/es$/, ""), w.replace(/s$/, "")];

/**
 * ONE PHOTOGRAPH MUST HOLD THEM ALL (2026-10-18, the review of job 400 at 1:11): the bridge picture
 * into a list asked for "money, grief, difficult people and what the remaining years are actually
 * for together, laid out side by side", and the picture maker could only lay grief, people and the
 * years on a kitchen table as paper cut-outs — a rain cloud, three paper figures, an hourglass —
 * and the "money" picture after it was drawn from that pile as a close-up. Job 399's bridge asked
 * the same of "the airline, the flight and what's left in the galley". Why one list item cannot be
 * laid beside the others in ONE photograph, or null when it can: anything that is not a thing at
 * all (`notAThing`); a question or a clause ("what's left", "who to say them to"); a person — the
 * group picture is drawn with nobody in it, and people are not laid out (`namedPeople`: "difficult
 * people", "my wife"); and a thing whose head word names an idea, a feeling, a quality, a time or a
 * place, by its ending ("loneliness") or a closed list of ordinary English ("grief", "old shop
 * habits", "the moment in the trip when they work", "a waiting room"). Things stay things ("a
 * bottle of water for later", "a mountain of scraps too pretty to throw out"). Pure.
 */
export function notInOnePhoto(item: string): string | null {
  const why = notAThing(item);
  if (why) return why;
  const first = bareItem(item).toLowerCase().replace(/’/g, "'").split(/\s+/)[0]?.replace(/[^a-z']/g, "") ?? "";
  if (QUESTION_WORD.test(first)) return "a question or a clause";
  if (namedPeople(bareItem(item))?.count) return "a person";
  const head = headWord(item);
  if (!head) return null;
  if (IDEA_ENDING.test(head) && !ENDS_LIKE_AN_IDEA.has(head)) return "an idea or a quality";
  if (singulars(head).some(w => NOT_LAID_OUT.has(w))) return "an idea, a feeling, a time or a place";
  return null;
}

/**
 * Whether a list's items can be drawn as ONE group picture (`setPicture`) that each item's own
 * picture is then drawn from: a list of THINGS whose every item one photograph can hold
 * (`notInOnePhoto`). A list of steps never is — steps are things someone does, one after another,
 * never laid side by side (job 355 scene 9 asked for "find every leak in that bag, plug them one at a
 * time and fill the gaps with cheaper food together, laid out side by side"). Pure.
 */
export function itemsInOnePhoto(names: string[], kind?: SpokenList["kind"]): boolean {
  return kind !== "steps" && names.length > 0 && names.every(n => !notInOnePhoto(n));
}

/**
 * The bridge into a list one photograph cannot hold (`itemsInOnePhoto`): still ONE picture of the
 * bridge words and never the host (Ruth's job 304), but an ordinary one — the picture already
 * planned for those words, which the line check judges against them and rewrites when it does not
 * fit (`fitPicturesToLines` never reads a `listSet` picture) — and no item is drawn from it.
 */
function bridgePicture(base: StoryboardScene, text: string): StoryboardScene {
  return {
    ...base,
    ...FRESH,
    scriptText: text,
    narration: firstWords(text, 8),
    hostPresent: false,
    sameShot: undefined,
    joinedLine: undefined,
    listCut: undefined,
    listKind: undefined,
    listSet: undefined,
    wordCut: true,
    hostCandidate: undefined,
  } as StoryboardScene;
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
    buildStage: undefined,
    sameShot: undefined,
    joinedLine: undefined,
    listCut: undefined,
    listKind: undefined,
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
    buildStage: undefined,
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
): {
  scenes: StoryboardScene[];
  applied: number;
  handed: number;
  cleared: number;
  skipped: string[];
  apart: string[];
} {
  // Why each list found in the script was NOT cut here — logged by the caller, so a list that stays
  // on the host says why instead of having to be reproduced.
  const skipped: string[] = [];
  // Bridges left an ordinary picture because one photograph cannot hold the list (`itemsInOnePhoto`),
  // each with the item that decided it — logged by the caller too.
  const apart: string[] = [];
  // Whether the video MAKES its main thing: the shot list stages only pictures of a thing being made.
  const mainMade = !!opts.main && scenes.some(s => s.keyThing === opts.main && !!s.buildStage);
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
  // Where a clause of when, where or why that opens right after token `at` (no comma before it) ends:
  // at its comma or full stop, in the same beat, within `LIST_ITEM_MAX_WORDS` words. Undefined
  // otherwise — a clause that runs on into the next beat, or longer, is left where the beats cut it.
  const clauseEnd = (at: number): number | undefined => {
    if (at <= 0 || at >= G.length || !TRAILING_CLAUSE.has(toks[at]) || punctBetween(at - 1, at)) return undefined;
    const sc = G[at - 1].scene;
    for (let e = at + 1; e <= Math.min(G.length, at + LIST_ITEM_MAX_WORDS); e++) {
      if (G[e - 1].scene !== sc) return undefined;
      if (e === G.length || punctBetween(e - 1, e)) return e;
    }
    return undefined;
  };

  interface Region {
    starts: number[];
    end: number;
    /** Where the last item's own words end, when its picture runs on over a clause (`clauseEnd`). */
    nameEnd?: number;
    first: number;
    last: number;
    kind?: SpokenList["kind"];
    setting?: string;
  }
  const regions: Region[] = [];
  const itemScenes = new Set<number>();
  let cursor = 0;
  for (const list of lists) {
    const ranges: [number, number][] = [];
    let from = cursor;
    // A list saved before the general-head rule (job 400's "some ordinary place, a waiting room, a
    // church pew") is cut without its head on a resume too, the same as a list found today.
    const listItems = withoutGeneralHead(list.items);
    for (const item of listItems) {
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
      skipped.push(`"${listItems[0]}…": its words were not found in order in the film's text`);
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
    let nameEnd: number | undefined;
    for (let n = 0; n < 4 && end < G.length && !punctBetween(end - 1, end); n++) end++;
    if (end < G.length && !punctBetween(end - 1, end)) {
      // Still mid-phrase after four words: the item's words run into a clause — cut at the item.
      end = ranges[ranges.length - 1][1];
      // ...unless it is a clause of when, where or why the item runs on into in its own beat, which
      // keeps the item's picture to its comma or full stop (job 401: "the kitchen table at two in the
      // morning | when the house is too quiet." is one picture of the table at night). Cut off, those
      // words were a picture of their own, a second or two long, between the list and what follows.
      // The picture is still named by the item's own words: the clause may be about something else
      // ("and a plane | when the boards come in rough"), and the plane is what it shows.
      const clause = clauseEnd(end);
      if (clause) [nameEnd, end] = [end, clause];
    }
    regions.push({
      starts,
      end,
      nameEnd,
      first: G[starts[0]].scene,
      last: G[end - 1].scene,
      kind: list.kind,
      // A list saved before the setting was asked for has none, and its pictures stay as they were;
      // a list of steps never has one (the host's own hands, `parseSpokenLists`).
      setting: list.kind === "steps" ? undefined : listSettingOf(list.setting),
    });
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
    // The introduction keeps the host's name on camera: its list hands over only after the name —
    // the name as the introduction was found (`namesHostBefore`: "I am Sam" for Sawdust Sam, job 407).
    if (
      host.hostIntro &&
      opts.hostName?.trim() &&
      !namesHostBefore(host.scriptText ?? "", opts.hostName, G[r.starts[0]].start)
    )
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
        s = { ...s, listCut: undefined, listKind: undefined, listSetting: undefined };
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
      out.push({ ...prev, ...FRESH, scriptText: carry, narration: firstWords(carry, 8), listCut: undefined, listKind: undefined, wordCut: true } as StoryboardScene);
      carry = null;
    }
    const head = scenes[i];
    const prefix = (head.scriptText ?? "").slice(0, G[r.starts[0]].start).trim();
    let leadIn: string | null = null;
    const bounds = [...r.starts, r.end];
    // Where item k's own words end: the next item's start, and for the last item before any clause
    // its picture runs on over (`nameEnd`).
    const nameEndOf = (k: number) => (k + 2 === bounds.length && r.nameEnd ? r.nameEnd : bounds[k + 1]);
    const names = bounds.slice(0, -1).map((a, k) => bareItem(textOf(a, nameEndOf(k))));
    // A GENERAL HEAD right before the first item ("some ordinary place," before "a waiting room,",
    // job 400 scene 8) gets no picture of its own: its words lead the first example's picture, as in
    // `splitListPieces` — whether the planner cut it as a beat of its own or it opens this beat. It is
    // never the bridge's set picture below either: right after the host it read as a bridge, and job
    // 400's head became "a waiting room and a church pew together, laid out side by side". The
    // examples of a head are instances of it, not things that sit together in one place.
    const before = out[out.length - 1];
    // Never when the first item is a head too ("something sweet, | something salty, …" is the list).
    const headLeads = (t: string | undefined) => onlyAGeneralHead(t) && !generalHead(names[0] ?? "");
    if (
      !prefix &&
      before &&
      !before.hostPresent &&
      !before.listCut &&
      !before.listSet &&
      !fixedBeat(before) &&
      headLeads(before.scriptText)
    ) {
      out.pop();
      leadIn = (before.scriptText ?? "").trim();
    } else if (prefix && !head.hostPresent && headLeads(prefix)) {
      leadIn = prefix;
    }
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
    if (leadIn) {
      // A general head: its words lead the first item (above).
    } else if (
      hostBefore &&
      bridgeText &&
      tokenSpans(bridgeText).length >= BRIDGE_MIN_WORDS &&
      // A longer lead-in that ends on a general head ("usually in some ordinary place,") is no set
      // picture either: it keeps a picture of its own, as any lead-in too long to lead an item does.
      !endsOnGeneralHead(bridgeText)
    ) {
      // The bridge is ONE picture of the place the line names with the whole list in it — never the
      // empty place. Always a picture, never the host: the host's minutes are planned later, and a
      // bridge the host said took a check-in's time away (Ruth's job 304 went 48 s without her).
      const base = bridgePiece ?? head;
      if (bridgePiece) out.pop();
      // ...but only when one photograph can hold the whole list: abstract items laid out together
      // came back as paper cut-outs on a table (job 400, `notInOnePhoto`), so such a bridge stays the
      // picture already planned for its words, for the line check to judge and rewrite.
      // The bridge is said in the list's own sentence, so it is set where the list is (job 409).
      if (itemsInOnePhoto(names, r.kind)) out.push({ ...setPicture(base, bridgeText, names), listSetting: r.setting });
      else {
        out.push({ ...bridgePicture(base, bridgeText), listSetting: r.setting });
        const odd = names.find(n => notInOnePhoto(n));
        const why = r.kind === "steps" ? "a list of steps" : odd ? `"${odd}" is ${notInOnePhoto(odd)}` : "no items";
        apart.push(`"${firstWords(bridgeText, 6)}…": ${why}`);
      }
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
        listKind: head.hostPresent ? head.listKind : undefined,
        wordCut: true,
      } as StoryboardScene);
    }
    if (head.hostPresent) handed++;
    const items: StoryboardScene[] = [];
    // A STEP of making the main thing is "making" unless the planner already gave its picture a stage
    // (a finishing step it called "done"), and with no key thing of its own it takes the main thing
    // (`ownKeyThing`) — so it is drawn only from pictures of the piece at the same or an earlier
    // stage, never from the finished piece the video opened on (Hank's job 269: "Square up the scrap
    // with a couple of saw cuts," was drawn from "A finished charred cedar incense holder"). A step
    // filed under the bench or a tool is still a moment of the making (jobs 332, 361: "give it a quick
    // brush," on the workbench). Only when the video MAKES its main thing — the shot list gave a
    // picture of it a stage (`mainMade`): most step lists build nothing ("get a stepladder, take one
    // alarm down, and read the label", Frederick's job 359; "hold the piece up near your face by a
    // window", Scarlett's job 354) and stay exactly as they were. Any other list clears the mark.
    // EVERY ITEM IS SET WHERE ITS SENTENCE IS (job 409, 156-164 s): "The farmer complains, the senator
    // complains, the old complain, and the young are already rehearsing the complaint", said inside a
    // passage about a writer of ancient times, was drawn from each item's bare words — a farmer in
    // overalls, an old man on a park bench, a young man in a hoodie; only the senator was dressed for
    // the time. The list finder reads the passage (`setting`), and each item's prompt says it
    // (`listItemClause`). A list with no setting clears any an earlier pass left.
    const asItem = (p: StoryboardScene): StoryboardScene => {
      const q = { ...p, listSetting: r.setting };
      if (r.kind !== "steps") return { ...q, listKind: undefined };
      if (!mainMade) return { ...q, listKind: "steps" };
      return { ...q, listKind: "steps", keyThing: p.keyThing ?? opts.main, buildStage: p.buildStage ?? "making" };
    };
    for (let k = 0; k + 1 < bounds.length; k++) {
      const [a, b] = [bounds[k], bounds[k + 1]];
      const text = textOf(a, b);
      // The beat that IS this item already (the planner cut it right) keeps its own picture.
      const exact = scenes.findIndex(
        (s, j) => j >= r.first && j <= r.last && !s.hostPresent && firstTok.get(j) === a && endTok.get(j) === b
      );
      if (exact >= 0) {
        items.push(asItem({ ...scenes[exact], listCut: true, wordCut: true, sameShot: undefined }));
        continue;
      }
      const bare = bareItem(textOf(a, nameEndOf(k)));
      const named = new Set(tokenSpans(bare).map(t => stem(t.tok)).filter(w => w.length >= 4 && !PLAIN.has(w)));
      // A planner picture over most of these words that already shows this item keeps its look.
      const own = scenes.findIndex((s, j) => {
        if (j < r.first || j > r.last || s.hostPresent || !named.size) return false;
        const inItem = G.slice(a, b).filter(g => g.scene === j).length;
        return inItem * 2 >= b - a && tokenSpans(s.showSubject ?? "").some(t => named.has(stem(t.tok)));
      });
      const base = scenes[G[a].scene];
      // A STEP is the host's hands doing it (a photo — never a video of hands), on the thing being
      // made; a planner picture that already shows it keeps its look. A step that offers a choice
      // ("catch a flight attendant as they pass, or step back to the galley", job 399) shows its
      // first way: a picture draws ONE thing, never "X or Y".
      const way = firstChoice(bare);
      const show =
        own >= 0
          ? scenes[own].showSubject!
          : r.kind === "steps"
            ? `the host's hands, mid-step: ${way.charAt(0).toLowerCase()}${way.slice(1)}${opts.main ? `, while making the ${opts.main}` : ""}`
            : `${bare}${opts.main ? ` (for the ${opts.main})` : ""}`;
      const pic = listPicture(base, text, show);
      if (own >= 0) {
        pic.visualPrompt = scenes[own].visualPrompt ?? show;
        pic.humanPresent = scenes[own].humanPresent;
        pic.keyThing = scenes[own].keyThing;
        pic.buildStage = scenes[own].buildStage;
      }
      if (r.kind === "steps") pic.humanPresent = true;
      items.push(asItem(pic));
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
          listKind: undefined,
          wordCut: true,
        } as StoryboardScene);
      } else if (lastScene.hostPresent) {
        // A host line ending in the list: its few closing words stay with the last item.
        const last = items[items.length - 1];
        last.scriptText = `${(last.scriptText ?? "").trim()} ${tail}`.trim();
      } else if (next && !next.hostPresent && !fixedBeat(next) && !startsRegion.has(r.last + 1)) {
        carry = tail;
      } else {
        items.push({ ...lastScene, ...FRESH, scriptText: tail, narration: firstWords(tail, 8), listCut: undefined, listKind: undefined, wordCut: true } as StoryboardScene);
      }
    }
    out.push(...items);
    applied++;
    i = r.last + 1;
  }
  out.forEach((s, k) => (s.index = k + 1));
  return { scenes: out, applied, handed, cleared, skipped, apart };
}

/**
 * The words leading into a list that say someone is holding what it names ("…, holding"). Only the
 * -ing forms, and only with a person in the sentence (`PERSON_WORD`): "Cut the pockets a little
 * bigger, and the same tray holds | a small teapot" (job 143) is a thing holding things.
 */
const HOLDING_LEAD = /\b(?:holding|carrying|clutching|cradling|gripping|juggling|balancing|toting|hugging)\s*[,:]?$/i;
/** A first item that opens on the holding word itself ("holding the whole can,"). */
const HOLDING_START = /^\s*(?:holding|carrying|clutching|cradling|gripping|juggling|balancing|toting|hugging)\b/i;
/**
 * A person in the sentence that leads into the list: the one doing the holding is someone. Never
 * "their" or "its", which things have too ("the rack, holding their lids").
 */
const PERSON_WORD =
  /\b(?:she|he|they|them|i|you|we|her|him|his|my|your|our|someone|somebody|everyone|everybody)\b/i;
/** The host speaking of their own hands ("I walked in holding", "my arms full"). */
const FIRST_PERSON = /\b(?:i|i'm|i’m|i've|i’ve|me|my)\b/i;
/**
 * "resting on the tray table", "standing in a seat-back pocket": where a thing is put down, not held
 * (job 402 scene 5's bottle stood in a seat-back pocket while the line said she was holding it).
 */
const PUT_DOWN_ON =
  /,?\s+(?:resting|sitting|lying|standing|set|placed|left|propped|perched|laid|tucked)\s+(?:on\s+top\s+of|on|upon|atop|in|inside|into)\s+(?:the|a|an|its|her|his|their|this|that)\s+[a-z'’-]+(?:\s+(?!(?:in|at|near|beside|by|inside|under|next|with|of|on|among|against|and)\b)[a-z'’-]+){0,3}/i;

/** A description of a list item with the hand that holds it: put down nowhere, held in `hand`. */
function heldIn(text: string | undefined, hand: string): string | undefined {
  if (!text?.trim()) return text;
  const t = text.replace(PUT_DOWN_ON, "").trim();
  const stop = /[.!]\s*$/.test(t);
  return `${t.replace(/[\s.!,;]+$/, "")}, held in ${hand}${stop ? "." : ""}`;
}

/**
 * Who holds what a list of HELD things names, from the list's own pictures and the picture that leads
 * into it — the items first, since they show the hands the things are in, where the lead-in may show
 * someone beside the holder: the one someone else they show (one person only), else the host when
 * the host is at work in them or says it of their own hands. Undefined when nobody is known —
 * nothing is guessed.
 */
function listHolder(
  head: StoryboardScene | undefined,
  run: StoryboardScene[]
): { who: string; people?: number } | "host" | undefined {
  const pictures = [...run, ...(head && !head.hostPresent ? [head] : [])];
  const other = pictures.find(s => s.otherPerson);
  if (other) return (other.otherPeople ?? 1) > 1 ? undefined : { who: other.otherPerson!, people: other.otherPeople };
  if (pictures.some(s => s.humanPresent)) return "host";
  const said = (head?.scriptText ?? "").split(/(?<=[.!?])\s+/).pop() ?? "";
  return head?.hostPresent && FIRST_PERSON.test(said) ? "host" : undefined;
}

/**
 * A LIST OF WHAT SOMEONE HOLDS KEEPS THE ONE HOLDING IT (2026-10-18, job 410 scene 6): "…one of them
 * was sitting in an empty row closer to the front, holding | the whole can of ginger ale, | a second
 * bag of pretzels, | and a bottle of water for later." Items one and two showed the older woman's
 * hands holding the can and the pretzels; the third was planned as "small water bottle resting on the
 * tray table in the empty row", nobody in it, and drawn from the empty row's look ("unoccupied") —
 * her seat came back empty, as if she had vanished. When the words leading into a list say someone is
 * holding what it names, every item picture that shows nobody is given the holder (`listHolder`): held
 * in their hand, the person carried as someone else (`otherPerson`) or as the host at work. Never a
 * list of steps (the host's hands already), a CTA or split beat, or a picture with a person in it;
 * nothing when the holder is not known. Run after every writer of descriptions, before
 * `markHostBroll`, which keeps a person only while the words show one. Returns how many pictures
 * were given the holder. Pure apart from mutating `scenes`.
 */
export function keepListHolders(scenes: StoryboardScene[]): number {
  let n = 0;
  const item = (s: StoryboardScene | undefined) => !!s?.listCut && !s.hostPresent;
  for (let i = 0; i < scenes.length; i++) {
    if (!item(scenes[i]) || item(scenes[i - 1])) continue;
    let j = i;
    while (item(scenes[j + 1])) j++;
    const run = scenes.slice(i, j + 1);
    const head = scenes[i - 1];
    // The sentence the list hangs on: the end of the line before it, else the first item's own words.
    const lead = (head?.scriptText ?? "").trim().replace(/[.!?…]+$/, "");
    const sentence = lead.split(/(?<=[.!?])\s+/).pop() ?? "";
    const held =
      (HOLDING_LEAD.test(lead) && (PERSON_WORD.test(sentence) || !!namedPeople(sentence))) ||
      (HOLDING_START.test(run[0].scriptText ?? "") && PERSON_WORD.test(sentence));
    const holder = held && !run.some(s => s.listKind === "steps") ? listHolder(head, run) : undefined;
    if (holder) {
      // "the hand of …", never "…'s hand": a holder is often a phrase ("a man in his sixties", "a
      // woman at a baby shower" on stored films), and its possessive is not English.
      const hand = holder === "host" ? "the host's hand" : `the hand of ${holder.who}`;
      for (const s of run) {
        if (s.humanPresent || fixedBeat(s) || showsPerson(`${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`)) continue;
        s.showSubject = heldIn(s.showSubject, hand);
        s.visualPrompt = heldIn(s.visualPrompt, hand) ?? s.visualPrompt;
        s.humanPresent = true;
        if (holder !== "host") {
          s.otherPerson = holder.who;
          s.otherPeople = holder.people;
        }
        n++;
      }
    }
    i = j;
  }
  return n;
}
