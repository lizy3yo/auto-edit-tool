/**
 * Finding the host's self-introduction in a script ("I'm Hank Hardwood", "I am Mae", "Sam here,")
 * from the channel's host name alone, so it works for every channel without a per-channel list.
 *
 * One home because five places ask the same question: which beats go on camera
 * (`markHostIntroductions`), where the introducing sentence starts (`introSentenceStart`), whether a
 * hand-off keeps the name on the host (`applyShotPlan`, `applySpokenLists`, the plan gate), and how
 * much the host says after it (`wordsAfterName`). They used to answer it three ways — the whole name,
 * the first word, the name without its honorific — so an introduction one of them found another
 * missed: Sawdust Sam's "I am Sam" (job 407) matched none of them, and played over a split screen
 * with no name card. Pure — no imports.
 */

/** Honorifics a host name carries that a host does not introduce themself by ("Granny Mae" → "Mae"). */
const NAME_HONORIFIC =
  /^(granny|grandma|grandpa|gramma|nana|aunt|auntie|uncle|mr|mrs|ms|miss|dr|pastor|farmer|chef|mama|papa)\.?$/i;

/**
 * Words that are never a name on their own, so ONE word of a host name stands for the host only when
 * it is not one of them: a channel called "The Handyman" or "Just Jim" must not turn every "this is
 * the…" or "I'm just…" into an introduction. Name suffixes ("Jr") are here for the same reason.
 */
const NAME_FUNCTION_WORD =
  /^(?:a|an|the|and|or|but|nor|of|to|in|on|at|by|for|with|from|into|onto|off|out|up|down|over|under|as|if|so|than|then|not|no|yes|i|me|my|mine|you|your|we|us|our|he|him|his|she|her|it|its|they|them|their|this|that|these|those|is|am|are|was|were|be|been|do|does|did|has|have|had|can|just|here|there|too|very|all|some|one|jr|sr|ii|iii|iv)\.?$/i;

/**
 * Words that follow "I'm" at the start of a sentence without being a name ("I'm Not sure…"), so
 * the no-name backstop below never mistakes them for one.
 */
const NOT_A_NAME =
  /^(not|so|sure|sorry|going|glad|here|back|telling|talking|just|also|still|really|always|never|about|afraid|done|getting|looking|trying|the|a|an|in|on|at|from|with|over|sixty|seventy|eighty|one|two|three|four|five)$/i;

/** One way a script may say the host's name. */
export interface HostNameForm {
  /** The words, as the channel wrote them. */
  words: string;
  /**
   * One word standing for a longer name ("Sam" for "Sawdust Sam", "Hank" for "Hank Hardwood"). It
   * counts only written as a name — capitalised — because it is often an ordinary word too: "the
   * backyard here" for Backyard Brenda, "it's sawdust" for Sawdust Sam, "sterling silver" for
   * Scarlett Sterling, "a wren here" on Walter Wren's bird channel.
   */
  partial: boolean;
}

/**
 * Every form of `hostName` a host introduces themself by: the name as written, the name without its
 * honorific ("Mae" for "Granny Mae"), its first word ("Hank" for "Hank Hardwood", "Diane" for "Diane
 * De Chambray") and, for a name of TWO words, its last ("Sam" for "Sawdust Sam", "Brenda" for
 * "Backyard Brenda") — the channel's name is often "<descriptor> <first name>", and the script says
 * the first name alone (job 407: "I am Sam, and this one is for anybody…" never matched "Sawdust
 * Sam" or "Sawdust"). Which word is the given name cannot be told from the name, so both count; a
 * function word ("The Handyman") never does. Pure.
 */
export function hostNameForms(hostName: string | undefined): HostNameForm[] {
  const name = hostName?.trim().replace(/\s+/g, " ");
  if (!name) return [];
  const forms: HostNameForm[] = [];
  const add = (words: string, partial: boolean) => {
    if (!forms.some(f => f.words.toLowerCase() === words.toLowerCase())) forms.push({ words, partial });
  };
  add(name, false);
  const core = name.split(" ").filter(p => !NAME_HONORIFIC.test(p));
  if (!core.length) return forms;
  add(core.join(" "), false);
  const alone = (w: string) =>
    (w.match(/[A-Za-zÀ-ɏ]/g)?.length ?? 0) >= 2 && !NAME_FUNCTION_WORD.test(w);
  if (core.length > 1 && alone(core[0])) add(core[0], true);
  if (core.length === 2 && alone(core[1])) add(core[1], true);
  return forms;
}

const escapeName = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** Not "it's Hank's saw": a name followed by more word, or a possessive, is not an introduction. */
const NOT_POSSESSIVE = "(?![\\w'’])";

/**
 * What a host says right before their name. Both cases of each first letter are spelled out instead
 * of the `i` flag, so a one-word form can still insist on its capital.
 */
const INTRO_LEAD = "(?:[Ii]['’]m|[Ii] am|[Tt]his is|[Ii]t['’]s|[Cc]all me|[Mm]y name(?:['’]s| is))";

/** The regexes that find the host introducing themself, built once per host name. */
function introPatterns(hostName: string | undefined): RegExp[] {
  const out: RegExp[] = [/\b[Mm]y name(?:['’]s| is)\s+[A-Z][\w'’-]*/g];
  for (const f of hostNameForms(hostName)) {
    if (!f.partial) {
      const esc = escapeName(f.words);
      out.push(
        new RegExp(`\\b${INTRO_LEAD}\\s+${esc}${NOT_POSSESSIVE}`, "gi"),
        new RegExp(`\\b${esc}\\s+here\\b`, "gi")
      );
      continue;
    }
    // One word of a longer name: capitalised, and "<word> here" only as a sign-on — at the start of
    // a sentence or after a greeting's comma, then a pause or a sign-on's next word ("Sam here, back
    // in the shop.", "Hank here again.") — so "the Carolina Wren here, though," or "Sawdust here
    // gets into everything" is not one.
    const esc = escapeName(f.words.charAt(0).toUpperCase() + f.words.slice(1));
    out.push(
      new RegExp(`\\b${INTRO_LEAD}\\s+${esc}${NOT_POSSESSIVE}`, "g"),
      new RegExp(
        `(?:^|(?<=[.!?…,;:]["'”’)\\]]*\\s+))${esc}\\s+here` +
          `(?=\\s*(?:[,.;:!?…—–-]|$)|\\s+(?:again|and|with|from|today|back)\\b)`,
        "g"
      )
    );
  }
  return out;
}

/** Character spans [start, end) of every self-introduction in `text`. Pure. */
export function introSpans(
  text: string,
  hostName: string | undefined
): [number, number][] {
  const spans: [number, number][] = [];
  // No name to look for (a channel with neither a host name nor a display name): the FIRST
  // "I'm <Name>" / "I am <Name>" near the start of the script is the introduction — hosts
  // introduce themselves in the opening, so nothing later can be mistaken for one.
  if (!hostName?.trim()) {
    const opening = Math.max(700, Math.floor(text.length * 0.2));
    for (const m of Array.from(text.matchAll(/\b(?:I['’]m|I am)\s+([A-Z][\w'’-]+)/g))) {
      if (m.index! > opening) break;
      if (NOT_A_NAME.test(m[1])) continue;
      spans.push([m.index!, m.index! + m[0].length]);
      break;
    }
  }
  for (const re of introPatterns(hostName)) {
    re.lastIndex = 0;
    for (const m of Array.from(text.matchAll(re)))
      spans.push([m.index!, m.index! + m[0].length]);
  }
  return spans;
}

/**
 * True when a line is the host introducing themself: "I'm Hank Hardwood", "I am Granny Mae",
 * "I am Sam" (Sawdust Sam), "Hank here", "this is Ruth", "my name is…". Built from the channel's
 * `hostName` (`hostNameForms`) so it works for every channel without a per-channel list. A
 * possessive ("it's Hank's saw") is not an introduction. Pure — unit-tested.
 */
export function introducesHost(
  text: string | undefined,
  hostName: string | undefined
): boolean {
  return introSpans(text ?? "", hostName).length > 0;
}

/**
 * Character ranges [start, end) of `text` that name the host: every self-introduction, joined where
 * two overlap — the "I'm Hank" inside "I'm Hank Hardwood", so a cut that keeps "a range" never lands
 * between the two words — and the whole name wherever it is said. Empty with no host name: the
 * callers then have no name to keep. Sorted. Pure.
 */
export function hostNameRanges(
  text: string,
  hostName: string | undefined
): [number, number][] {
  const name = hostName?.trim();
  if (!name) return [];
  const raw = introSpans(text, name);
  const whole = new RegExp(`\\b${escapeName(name)}(?![\\w'’-])`, "gi");
  for (const m of Array.from(text.matchAll(whole))) raw.push([m.index!, m.index! + m[0].length]);
  raw.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: [number, number][] = [];
  for (const [a, b] of raw) {
    const last = out[out.length - 1];
    if (last && a < last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** True when the host's name is said, whole, before character `upTo` of `text`. Pure. */
export function namesHostBefore(
  text: string,
  hostName: string | undefined,
  upTo: number
): boolean {
  return hostNameRanges(text, hostName).some(([, b]) => b <= upTo);
}
