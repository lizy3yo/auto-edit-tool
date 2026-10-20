/**
 * A SETTING TURN ENDS A TOPIC (2026-10-20, the review of job 412 scene 26). One 13.9 s picture of a
 * wild cat stalking through desert brush ran on under "and bigger hunters can't see well, and she
 * inherited that schedule the same way she inherited her whiskers. Indoor life softens it, but it
 * rarely erases it, so plenty of house cats keep one foot in the old rhythm." — 7.4 s about house cats
 * and indoor life over the wilderness. The same-topic pass had given scenes 23-26 one "wild
 * landscape" topic, and the line check's ONE PICTURE, ONE SUBJECT rule split only where a sentence
 * is about "a different thing you can see" and never "an idea about it": "Indoor life softens it [the
 * schedule]" read as more said about the same schedule. Nothing judged the picture's SETTING against
 * the one its words name. (Job 405, an earlier film of the same script, had the same line over "an
 * open grassy wild landscape at dusk".)
 *
 * One photo is in one setting. A sentence that moves the talk to another setting — out in the wild
 * to inside a home, outdoors to indoors, long ago to today, or back — needs a new picture where it
 * starts, even when it goes on about the same thing or idea. The planners are told so in one wording
 * (`SETTING_TURN_RULE`), and the code holds the cases its words make plain: a line that NAMES a
 * setting ("indoor life", "house cats", "out in the wild", "centuries ago", "these days") against a
 * picture whose own words are set in the opposite one ("…across the dawn-lit wild landscape").
 * Only words that say WHERE or WHEN count — never a thing whose name holds one ("forest green",
 * "16:9 landscape framing", "a stack of exotic woods", "a houseplant habit"), and never a setting
 * the picture only implies. Pure — unit-tested.
 */

/** The settings a line can turn between, in pairs. */
export type LineSetting = "indoors" | "outdoors" | "long ago" | "today";

const OPPOSITE: Record<LineSetting, LineSetting> = {
  indoors: "outdoors",
  outdoors: "indoors",
  "long ago": "today",
  today: "long ago",
};

/**
 * The rule as the planners read it: the shot list, the same-topic groups and the line check — one
 * wording, so they cannot disagree. Each says what it does with it.
 */
export const SETTING_TURN_RULE =
  "A SETTING IS PART OF THE PICTURE: one photo is in one setting. A sentence that moves the talk to " +
  "a different SETTING — from out in the wild to inside a home, from outdoors to indoors, from long " +
  "ago to today, or back — needs a new picture where that sentence starts, even when it goes on " +
  "about the same thing or the same idea (a habit an animal has in the wild, then \"indoors it " +
  "fades\"; how a tool was used centuries ago, then \"these days most people…\"). Each picture is " +
  "set where and when its own words are.";

// ── What a spoken LINE names as its setting ─────────────────────────────────────────────────────
// Only words that say where or when the talk is: "indoor life", "house cats", "stays inside", "into
// your home"; "out in the wild", "wild relatives", "outdoors", "in the woods"; "centuries ago", "back
// then", "our ancestors"; "today", "these days", "modern". Never "feel at home", "outside the box",
// or a thing named after a place ("a houseplant habit" is a kind of customer, job 162 scene 280).

const HOME_ROOM =
  "house|home|apartment|flat|cabin|living room|bedroom|kitchen|bathroom|hallway|dining room|sitting room|nursery|basement|attic";
const SAID: Record<LineSetting, RegExp[]> = {
  indoors: [
    /\bindoors?\b/i,
    /\bhouse[- ]?(?:cats?|pets?)\b/i,
    new RegExp(String.raw`\b(?:inside|in|into)\s+(?:the|a|an|your|my|our|their|his|her)\s+(?:own\s+)?(?:${HOME_ROOM})\b`, "i"),
    /\b(?:stay(?:s|ed|ing)?|kept|keep(?:s|ing)?|live(?:s|d)?|living|lock(?:s|ed)?|shut(?:s)?)\s+(?:\w+\s+)?inside\b(?!\s+(?:of|the|a|an|it|them|her|his)\b)/i,
  ],
  outdoors: [
    /\boutdoors?\b/i,
    /\b(?:in|into|of|from|to|for)\s+the\s+wild\b/i,
    /\bwild\s+(?:relatives?|ancestors?|cousins?|kin|counterparts?|forebears?|animals?|cats?|dogs?|birds?|horses?|ones|populations?|species|packs?|herds?)\b/i,
    /\bwilderness\b/i,
    /\bin\s+nature\b/i,
    /\b(?:in|into|through|across|out\s+in|out\s+on)\s+(?:the|a|an|open)\s+(?:woods|forest|desert|jungle|mountains|hills|fields?|meadows?|prairie|savannah?|countryside|open air|bush|backyard|yard|garden|pasture|wild)\b/i,
    /\b(?:go(?:es)?|went|going|stay(?:s|ed|ing)?|kept|keep(?:s|ing)?|live(?:s|d)?|living|let(?:s)?|put(?:s)?|take(?:s)?|took|sleep(?:s|ing)?|slept|play(?:s|ed|ing)?|roam(?:s|ed|ing)?|hunt(?:s|ed|ing)?|run(?:s|ning)?|ran|work(?:s|ed|ing)?)\s+(?:\w+\s+){0,2}?outside\b(?!\s+(?:of|the box|the lines)\b)/i,
  ],
  "long ago": [
    /\b(?:long|centuries|generations|ages|millennia|(?:hundreds|thousands)\s+of\s+years)\s+ago\b/i,
    /\bback\s+then\b/i,
    /\bin\s+(?:the\s+)?(?:old|olden)\s+days\b/i,
    /\bin\s+those\s+days\b/i,
    /\bancestors?\b/i,
    /\bforebears?\b/i,
    /\b(?:ancient|medieval|prehistoric)\b/i,
    /\bin\s+the\s+(?:\d{1,2}(?:st|nd|rd|th)|[a-z]+(?:teenth|eth))\s+century\b/i,
    /\bin\s+the\s+1[0-8]\d0s\b/i,
  ],
  today: [
    /\btoday\b(?!'s\s+(?:video|episode|lesson|project|tip|build|topic)\b)/i,
    /\bnowadays\b/i,
    /\bthese\s+days\b/i,
    /\bmodern\b/i,
    /\bin\s+this\s+day\s+and\s+age\b/i,
  ],
};

// ── What a picture's DESCRIPTION is set in ──────────────────────────────────────────────────────
// A picture writer names the place outright: "in a quiet bedroom", "across the dawn-lit wild
// landscape", "a medieval baker at a brick oven". A thing's own name is never a setting: "forest
// green", "16:9 landscape framing", "exotic woods", "wildflowers", "garden shears".

const SHOWN: Record<LineSetting, RegExp[]> = {
  indoors: [
    /\bindoors?\b/i,
    new RegExp(String.raw`\binside\s+(?:the|a|an|her|his|their|our|my|your)\s+(?:${HOME_ROOM}|room)\b`, "i"),
    /\b(?:bed|living|dining|sitting|laundry|bath|waiting|spare|guest|sewing|craft|utility|class)\s?rooms?\b/i,
    /\b(?:kitchens?|hallways?|apartments?|interior)\b/i,
    /\broom\b/i,
    /\b(?:couch|sofa|armchair|windowsill|window sill|mattress|duvet|carpet|ceiling|staircase)\b/i,
    /\b(?:in|on|onto|across|under)\s+(?:the|a|an|her|his|their|my|your)\s+bed\b/i,
    /\b(?:foot|end|edge|head)\s+of\s+the\s+bed\b/i,
  ],
  outdoors: [
    /\boutdoors?\b/i,
    /\boutside\b(?!\s+(?:of|the box|the lines)\b)/i,
    /\bwild(?:erness)?\b(?![- ](?:flowers?|rice|card|west|life))/i,
    /\blandscape\b(?![- ](?:framing|format|orientation|mode|aspect|ratio|photo(?:graph)?y|painting|architect))/i,
    /\b(?:deserts?|jungles?|savannah?s?|prairies?|meadows?|grasslands?|hillsides?|hilltops?|countryside|mountainsides?|riverbanks?|lakeshores?|shorelines?|seashores?|tundra|marsh(?:es|land)?|swamps?|scrubland|steppes?|woodlands?)\b/i,
    /\bforests?\b(?![- ]green)/i,
    /\b(?:in|into|through|across|out\s+in)\s+(?:the|a|an)\s+(?:\w+\s+)?woods\b/i,
    /\b(?:in|on|across|through|into|over|at)\s+(?:the|a|an|her|his|their|my|your|our|open)\s+(?:[\w-]+\s+){0,2}?(?:yard|backyard|garden|field|fields|park|street|lawn|pasture|orchard|porch|patio|driveway|beach)\b/i,
    /\bunder\s+(?:the|an|a)\s+(?:open\s+)?sky\b/i,
  ],
  "long ago": [
    /\b(?:ancient|medieval|prehistoric|antiquity|bygone|olden)\b/i,
    /\bvictorian\b/i,
    /\b\d{1,2}(?:st|nd|rd|th)[- ]century\b/i,
    /\b1[0-8]\d0s\b/i,
    /\b(?:of\s+)?long\s+ago\b/i,
    /\bperiod\s+(?:dress|costume|clothing|clothes)\b/i,
  ],
  today: [/\b(?:modern|present-day|contemporary|today's|nowadays)\b/i],
};

const KINDS = Object.keys(OPPOSITE) as LineSetting[];
const fold = (t: string | undefined) => (t ?? "").replace(/[’‘]/g, "'");

/** The settings a spoken line names, in a fixed order. Pure. */
export function saidSettings(line: string | undefined): LineSetting[] {
  const text = fold(line);
  return KINDS.filter(k => SAID[k].some(r => r.test(text)));
}

/** The settings a picture's description is set in, in a fixed order. Pure. */
export function shownSettings(picture: string | undefined): LineSetting[] {
  const text = fold(picture);
  return KINDS.filter(k => SHOWN[k].some(r => r.test(text)));
}

/**
 * The setting a line names that a picture's words put it against: the line says "indoor life" and
 * the picture is "…across the dawn-lit wild landscape". Only a picture set in the OPPOSITE setting and
 * not also in the line's ("a cat on the windowsill looking out at the garden" holds both). Undefined
 * when they agree or either says nothing. Pure.
 */
export function settingClash(line: string | undefined, picture: string | undefined): LineSetting | undefined {
  const shown = shownSettings(picture);
  if (!shown.length) return undefined;
  return saidSettings(line).find(k => shown.includes(OPPOSITE[k]) && !shown.includes(k));
}

/** The sentences of a line. A price ("$1.50") or a short form ("St. Louis") is not a break. */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]["'’”)\]]*\s+(?=["'“‘(]?[A-Z0-9])/g;
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sentence = text.slice(from, m.index + 1);
    if (/\b(?:mr|mrs|ms|dr|st|mt|ft|vs|approx|etc|no|jr|sr)\.$/i.test(sentence)) continue;
    out.push(sentence.trim());
    from = m.index + m[0].length;
  }
  if (text.slice(from).trim()) out.push(text.slice(from).trim());
  return out;
}

/** A sentence's opening clause: up to its first comma, colon, semicolon, dash or bracket. */
const openingClause = (sentence: string) => sentence.split(/[,;:—–(]/)[0];

const WORD = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
const wordCount = (t: string) => (t.match(WORD) ?? []).length;

export type SettingTurn = {
  /** The first words of the sentence where the setting turns, copied from the line. */
  from: string;
  /** The setting the line turns to. */
  setting: LineSetting;
};

/**
 * Where a picture's line TURNS to a setting its picture is not in: a later sentence OPENS on a
 * setting (`saidSettings` of its first clause) that the picture's words put it against, no sentence
 * before it names that setting, and the sentence does not name the picture's own setting too (a
 * comparison inside one sentence is that sentence's own). The line starts where the picture is and
 * moves away: "and bigger hunters can't see well, and she inherited that schedule the same way she
 * inherited her whiskers. | Indoor life softens it, …house cats…" over "a wild cat stalking … across
 * the dawn-lit wild landscape" turns indoors at "Indoor life softens it". A setting named late in a
 * sentence about something else is no turn: "I keep a spray bottle of water right next to the torch
 * for flare-ups, and the dog gets shut in the house" (jobs 114-143) is still the spray bottle outside.
 * Both parts at least 4 words, as every split (`applyPictureSplits` also holds them to 3 seconds).
 * Undefined for a line set where its picture is, a picture whose words name no setting, and a one-
 * sentence line. Replayed over the 22,506 local pictures: jobs 405 and 412's line, nothing else. Pure.
 */
export function settingTurn(line: string | undefined, picture: string | undefined): SettingTurn | undefined {
  const text = (line ?? "").trim();
  const sentences = sentencesOf(text);
  if (sentences.length < 2) return undefined;
  const shown = shownSettings(picture);
  if (!shown.length) return undefined;
  const total = wordCount(text);
  const earlier = new Set<LineSetting>(saidSettings(sentences[0]));
  let before = wordCount(sentences[0]);
  for (let k = 1; k < sentences.length; k++) {
    const whole = saidSettings(sentences[k]);
    const turn = saidSettings(openingClause(sentences[k])).find(
      s => shown.includes(OPPOSITE[s]) && !shown.includes(s) && !earlier.has(s) && !whole.includes(OPPOSITE[s])
    );
    if (turn && before >= 4 && total - before >= 4) {
      const words = Array.from(sentences[k].matchAll(WORD)).slice(0, 4);
      const last = words[words.length - 1];
      return { from: sentences[k].slice(0, last.index! + last[0].length), setting: turn };
    }
    whole.forEach(s => earlier.add(s));
    before += wordCount(sentences[k]);
  }
  return undefined;
}

/**
 * What the line check is told about a picture whose line turns to a setting its picture is not in
 * (`settingTurn`): where, so it splits there. Empty otherwise — a whole line set elsewhere is left to
 * the check's own reading (THE LINE'S SETTING in FIT_SYSTEM): by words alone it fired on 11 local
 * pictures (two lines, repeated across their channels' films) and every one was a thing's place, not
 * the talk's — "cloth that was already sitting in our house" over the feed sacks by the burn barrel
 * the same line goes on to name, "and the dog gets shut in the house" over the spray bottle by the
 * torch outside. Pure.
 */
export function settingNote(line: string | undefined, picture: string | undefined): string {
  const turn = settingTurn(line, picture);
  return turn ? ` (its words turn to another setting at "${turn.from}": ${turn.setting})` : "";
}
