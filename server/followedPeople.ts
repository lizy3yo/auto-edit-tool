/**
 * WHO THE STORY FOLLOWS, read off the script's own words, so a missing `PERSON` line is noticed
 * instead of left to one model call (2026-10-18, the review of job 410). Job 410's script follows
 * two passengers — "one of them was sitting in an empty row…", "The other was still in row
 * fourteen… He figures she must know somebody on the crew. She doesn't. What she knows is…" — and
 * the props call, which is asked for a `PERSON name: look` line for exactly such a she and he, wrote
 * none that run: the man was a balding grey head in an olive jacket in scene 2 and a blue checked
 * shirt in scene 7. Nothing checked. These rules find a person the story keeps talking about (the
 * same "she" or "he" over neighbouring sentences, the same role or relation said twice) and a
 * `PERSON`/`VIEWER` look a picture generator cannot keep one person by (job 412: "an adult of
 * average build, wearing plain pajamas" — no man or woman, no age, no hair — and the sleeper was a
 * long-haired woman in one shot and a short curly-haired one seven seconds later). They only decide
 * WHETHER to ask; who the person is, and their look, is still the model's (`repairPeopleLines` in
 * shotList.ts), because a "she" can be a cat. And WHAT THE HOST DOES, from their own words, for the
 * props call to decide who "you" is (`hostOwnWords`). Pure — no imports beyond the word rules.
 */
import type { RecurringPerson } from "@shared/types";
import { introSpans } from "./hostIntro";
import { namedPeople, personKey, personNounOf, selfRolesOf, sexOfLook } from "./hostLook";

/** A script cut into sentences (a sentence ends on . ! or ? before a space). Pure. */
export function scriptSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…]["'”’)\]]?)\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Someone the script keeps talking about, and the sentences that do. */
export interface FollowedPerson {
  /** "she" or "he" for a person followed by pronoun; else the role or relation ("neighbour", "wife"). */
  cue: string;
  /** The sex the pronoun or the noun gives, when it gives one. */
  sex?: "f" | "m";
  /** The sentences (0-based, in order) that talk about them. */
  sentences: number[];
}

const SHE = /\b(?:she|her|hers|herself)\b/i;
const HE = /\b(?:he|him|his|himself)\b/i;
/**
 * The most sentences between two that still follow one "she" or "he": a story keeps its pronoun
 * going sentence after sentence, while a "she" twenty sentences on is a new story's.
 */
const FOLLOW_GAP = 3;
/** Words before a role noun that point at one particular person: "the neighbour", "my wife". */
const POINTING = new Set("the my our your his her their this that".split(" "));
/**
 * Words that name nobody in particular as a role noun's determiner-less neighbour, and person nouns
 * that are often a THING in prose ("the driver" is a club or a screwdriver, "the agent" a cleaner).
 */
const NOT_A_FOLLOWED_ROLE = new Set(["driver", "member", "agent", "carrier"]);
/** The plain words for one person that may be followed by name of kind: "the man", "that woman". */
const PLAIN_ONE = new Set(["man", "woman", "lady", "gentleman", "guy"]);
/**
 * A sentence that brings someone in right before a pronoun takes it up — job 410's "The other was
 * still in row fourteen…" before "He figures she must know somebody": the man is said in two
 * sentences, though "he" is in one.
 */
const BRINGS_SOMEONE_IN =
  /\b(?:the other|one of (?:them|us|those)|(?:a|an|the|this|that|one)\s+(?:[a-z'’-]+\s+)?(?:man|woman|lady|gentleman|guy|boy|girl))\b/i;

/**
 * One word for a role or relation the person-noun list spells two ways. A script's "my mom" against
 * a PERSON line named "my mother", or "neighbor" against "the neighbour", is the same person: read
 * as two, the check asked for a line the list already had, and the repair could add that person a
 * second time under the other word with a second look.
 */
const SAME_ROLE: Record<string, string> = {
  neighbour: "neighbor",
  traveller: "traveler",
  labourer: "laborer",
  "co-worker": "coworker",
  mother: "mom",
  mum: "mom",
  mama: "mom",
  father: "dad",
  grandmother: "grandma",
  grandfather: "grandpa",
  grandkid: "grandchild",
  teenager: "teen",
  infant: "baby",
};
/** A role or relation word in its one spelling (`SAME_ROLE`). Pure. */
export function sameRole(word: string): string {
  const w = word.toLowerCase();
  return SAME_ROLE[w] ?? w;
}

/** A role or relation pointed at as one person in a sentence ("the neighbour", "my late husband"). */
function rolesPointedAt(sentence: string): { lemma: string; sex?: "f" | "m" }[] {
  const tokens = sentence.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*/g) ?? [];
  const out: { lemma: string; sex?: "f" | "m" }[] = [];
  tokens.forEach((tok, k) => {
    const noun = personNounOf(tok.replace(/['’]s$/i, ""));
    if (!noun || noun.plural || NOT_A_FOLLOWED_ROLE.has(noun.lemma)) return;
    if (!(noun.kind === "role" || (noun.kind === "generic" && PLAIN_ONE.has(noun.lemma)))) return;
    // Right after the pointing word, or one describing word after it ("my late husband").
    const prev = tokens[k - 1]?.toLowerCase();
    const before = tokens[k - 2]?.toLowerCase();
    if (!prev || !(POINTING.has(prev) || (before && POINTING.has(before) && !personNounOf(prev)))) return;
    if (!out.some(r => r.lemma === noun.lemma)) out.push({ lemma: noun.lemma, ...(noun.sex ? { sex: noun.sex } : {}) });
  });
  return out;
}

/** Runs of sentence numbers where each is at most `FOLLOW_GAP` after the one before. */
function runsOf(hits: number[]): number[][] {
  const runs: number[][] = [];
  for (const i of hits) {
    const last = runs[runs.length - 1];
    if (last && i - last[last.length - 1] <= FOLLOW_GAP) last.push(i);
    else runs.push([i]);
  }
  return runs;
}

/**
 * The people a script FOLLOWS — talks about in two or more sentences, so a `PERSON` line is owed
 * (`CONTINUITY_SYSTEM`'s rule): the same "she" or "he" over neighbouring sentences (with the
 * sentence that brought them in), or the same role or relation pointed at in two sentences anywhere
 * ("my sister", "the buyer"). A role the host gives themself (their title, "I'm Ana, a nurse") is
 * the host and never counts. An animal's "she" is counted too — words cannot tell it from a
 * woman's — so this only says WHETHER to ask (`uncoveredPeople`); the model answers who. The CTA
 * should be taken out first (the props call reads the content only). Pure.
 */
export function followedPeople(
  script: string,
  opts: { hostName?: string; hostTitle?: string } = {}
): FollowedPerson[] {
  const sentences = scriptSentences(script);
  const selfRoles = new Set(
    selfRolesOf(hostOwnWords(script, opts).join(" "), opts.hostTitle, opts.hostName).map(sameRole)
  );
  const out: FollowedPerson[] = [];
  const bringsIn = (s: string) => BRINGS_SOMEONE_IN.test(s) || rolesPointedAt(s).length > 0;
  for (const [cue, sex, re] of [
    ["she", "f", SHE],
    ["he", "m", HE],
  ] as const) {
    const hits = sentences.flatMap((s, i) => (re.test(s) ? [i] : []));
    for (const run of runsOf(hits)) {
      const lead = run[0] - 1;
      const followed = lead >= 0 && bringsIn(sentences[lead]) ? [lead, ...run] : run;
      if (followed.length >= 2) out.push({ cue, sex, sentences: followed });
    }
  }
  const byRole = new Map<string, FollowedPerson>();
  sentences.forEach((s, i) => {
    for (const r of rolesPointedAt(s)) {
      const role = sameRole(r.lemma);
      if (selfRoles.has(role)) continue;
      const had = byRole.get(role);
      // "my mom … my mother" in ONE sentence is still one sentence.
      if (had) {
        if (had.sentences[had.sentences.length - 1] !== i) had.sentences.push(i);
      } else byRole.set(role, { cue: r.lemma, ...(r.sex ? { sex: r.sex } : {}), sentences: [i] });
    }
  });
  for (const p of Array.from(byRole.values())) if (p.sentences.length >= 2) out.push(p);
  return out;
}

/**
 * The followed people no `PERSON` line covers: a "she" with no line for a woman, a "he" with none
 * for a man, a role no line's name (or the viewer's) holds. A line whose sex cannot be read covers
 * no pronoun — its look is incomplete anyway (`lookGaps`). Pure.
 */
export function uncoveredPeople(
  followed: FollowedPerson[],
  people: RecurringPerson[],
  viewer?: RecurringPerson
): FollowedPerson[] {
  const factOf = (p: RecurringPerson) => {
    const named = namedPeople(p.name);
    return {
      sex: named?.sex ?? sexOfLook(p.look),
      words: personKey(p.name).split(" ").map(sameRole),
      roles: (named?.people ?? []).map(x => sameRole(x.noun)),
    };
  };
  const facts = people.map(factOf);
  const withViewer = viewer ? [...facts, factOf(viewer)] : facts;
  return followed.filter(f =>
    f.cue === "she" || f.cue === "he"
      ? !facts.some(x => x.sex === f.sex)
      : !withViewer.some(x => x.words.includes(sameRole(f.cue)) || x.roles.includes(sameRole(f.cue)))
  );
}

/** What a `PERSON`/`VIEWER` look must say for one person to be drawn the same in every picture. */
export type LookGap = "man or woman" | "an age range" | "hair";

const SEX_WORD =
  /\b(?:man|men|woman|women|male|female|boy|girl|lady|gentleman|guy|he|she|his|her|bearded|beard)\b/i;
const AGE_WORD = new RegExp(
  String.raw`\b(?:\d{1,3}s?|(?:twent|thirt|fort|fift|sixt|sevent|eight|ninet)(?:y|ies)|teens?|teenage(?:d|r|rs)?|` +
    String.raw`young|younger|youthful|old|older|elderly|aged|middle-aged|retired|retirement|senior|grey-haired|gray-haired|` +
    String.raw`child|kid|toddler|baby|infant|years?[- ]old)\b|\b(?:aged?|about|around|roughly|maybe|nearly)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b`,
  "i"
);
const HAIR_WORD =
  /\b(?:hair(?:ed)?|bald(?:ing)?|ponytail|pony-tail|bun|braids?|braided|plaits?|curls|curly|crew-?cut|buzz-?cut|shaved head|headscarf|hijab|turban|bob|pigtails?|dreadlocks|locs)\b/i;

/**
 * What a person's look leaves out of the three things that keep one person the same from picture to
 * picture — man or woman, an age range and hair (`CONTINUITY_SYSTEM`'s PERSON look). Job 412's
 * viewer, "an adult of average build, wearing plain pajamas, lying in the unmade bed…", gives none
 * of them, and the picture maker chose the sex and the hair afresh on every draw. Pure.
 */
export function lookGaps(look: string | undefined): LookGap[] {
  const t = look ?? "";
  const gaps: LookGap[] = [];
  if (!SEX_WORD.test(t)) gaps.push("man or woman");
  if (!AGE_WORD.test(t)) gaps.push("an age range");
  if (!HAIR_WORD.test(t)) gaps.push("hair");
  return gaps;
}

/**
 * A sentence where the host says what they are or were: "I'm a retired nurse", "I was a mechanic",
 * "after thirty years as a…", "I worked in…" — never a bare "I'm going to show you".
 */
const SAYS_WHAT_I_DO =
  /\b(?:(?:I['’]m|I am|I was|I['’]ve been|I have been)\s+(?:[A-Z][\w'’-]*,?\s+){0,3}(?:an?|the)\s+[a-z]|(?:years|decades|career|life) (?:as|in|on|behind|working)\b|\bI (?:worked|served|trained|taught|spent \w+ (?:years|decades))\b|\bmy (?:job|work|years|career)\b)/;

/**
 * What the host says about THEMSELF, in their own words, for the props call to read what the host
 * does (2026-10-18, job 410: no host title, and a look — "a white blouse, navy blazer with gold pin,
 * and striped scarf" — that never names the job, so the call could not see that the host's work
 * serves the "you" who asks the crew, wrote no `VIEWER` line, and a passenger's polite request was
 * drawn as the host in uniform talking to crew). The sentence holding the self-introduction and the
 * one after it (hosts often say what they do next: "I am <Name>. This channel is for people in older
 * houses…"), then up to two more in the opening third where the host says what they are or were. At
 * most four, in script order. Empty when the host never speaks of themself. Pure.
 */
export function hostOwnWords(script: string, opts: { hostName?: string } = {}): string[] {
  const sentences = scriptSentences(script);
  if (!sentences.length) return [];
  const picked = new Set<number>();
  // The self-introduction: the sentence whose text holds the first introduction span.
  const flat = sentences.join(" ");
  const intro = introSpans(flat, opts.hostName).sort((a, b) => a[0] - b[0])[0];
  if (intro) {
    let at = 0;
    for (let i = 0; i < sentences.length; i++) {
      const end = at + sentences[i].length;
      if (intro[0] >= at && intro[0] < end + 1) {
        picked.add(i);
        if (i + 1 < sentences.length) picked.add(i + 1);
        break;
      }
      at = end + 1;
    }
  }
  const opening = Math.max(8, Math.ceil(sentences.length / 3));
  for (let i = 0, more = 0; i < Math.min(opening, sentences.length) && more < 2; i++) {
    if (picked.has(i) || !SAYS_WHAT_I_DO.test(sentences[i])) continue;
    picked.add(i);
    more++;
  }
  return Array.from(picked)
    .sort((a, b) => a - b)
    .slice(0, 4)
    .map(i => sentences[i]);
}
