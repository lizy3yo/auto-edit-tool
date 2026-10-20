/**
 * A SEASON OR AN HOUR THE LINE NAMES IS THE PICTURE'S (round 14, the verification film 411 scene 20).
 * "That bright song at first light, the one birders have long remembered as cheer up, cheerily,
 * belongs to spring and summer." The shot list kept "a robin singing on a branch at first light in the
 * backyard" and dropped the season; the prompt writer settled the season the line had left it from the
 * channel's home base — late fall into winter — and wrote "bare trees and patches of brown lawn"; the
 * robin's earlier pictures (a robin on snow, a robin on a bare snowy branch) were sent as references,
 * and `MEMORY_SETTING_CLAUSE` gives the season to "this picture's own words", which named none. The
 * line check passed it: a singing robin is shown. So the film ran winter, summer, winter in twenty
 * seconds, the robin singing in the very season the next line says it is quiet.
 * A season (or the hour) the line sets what it shows in is held like a state: the shot list and the
 * line check are told so (`SEASON_HOUR_RULE`), and whatever they wrote, a picture whose own words name
 * none gets the line's (`holdLineSeasons`) — so the prompt writer is never left to fill it from the
 * home base — and a picture drawn from references is told its season and hour in so many words
 * (`seasonHourClause`), so no reference lends its snow or its daylight against them. That sentence
 * holds a warm season or an hour the picture's OWN words name as well (round 15, job 416 scene 20: "at
 * dawn in spring" under a line naming neither came back in its reference's snow and flat daylight).
 * Only what the line says the picture's moment IS: never a season it is getting ready for ("before
 * winter", "stock up for winter"), a season ruled out ("never in summer"), two that contrast ("sings in
 * summer, clucks in winter"), a name ("Winter Park"), a thing named after one ("a winter coat",
 * "summer squash", "a coiled spring") or "all year". Pure.
 */
import type { KeyThing, StoryboardScene } from "@shared/types";

export type Season = "spring" | "summer" | "autumn" | "winter";
export type Hour = "night" | "dawn" | "dusk";

/** A season the line holds, as it is said ("late winter") and as one of the four. */
export type HeldSeason = { season: Season; said: string };
/** An hour the line holds, as it is said ("at first light") and as one of three. */
export type HeldHour = { hour: Hour; said: string };

/** The shot list's and the line check's rule, one wording for both. Neutral examples. */
export const SEASON_HOUR_RULE =
  "A SEASON OR AN HOUR the line sets what it shows in (\"the garden in late summer\", \"the market is " +
  "busiest in spring\", \"at three in the morning\", \"at first light\") is part of the picture: its " +
  "words say it, and the picture is drawn in that season or at that hour — never the season or hour " +
  "of the pictures around it or of the video's home. A season the line is getting ready for (\"before " +
  "winter\") or rules out is not one.";

const SEASON_WORD = /\b(spring|summer|autumn|fall|winter)(time)?\b/gi;
/** A word after a season that keeps it a time: "winter months", "summer evenings", "spring and summer". */
const STILL_A_TIME = new Set(
  (
    "a an the and or to into through is was are were be been comes came arrives arrived returns " +
    "returned rolls rolled sets set hits hit starts started ends ended can could will would may might " +
    "does did has had i you we he she it they my your our his her their its this that these those " +
    "there here when while if as because so but for at on in with by of from after before until " +
    "every each all most hardly rarely barely never always usually often still just only even then " +
    "months month days day mornings morning evenings evening nights night afternoons afternoon " +
    "weekends weekend weather light sun sunlight sky air time season break holidays heat cold long " +
    "youll youre theyll theyre ive weve"
  ).split(" ")
);
/**
 * Words before a season that make it a time the picture is NOT at: "before winter", "ready for winter",
 * "unlike summer", "since spring" — and a plan for one ("a neighbour expecting in the spring", job
 * 148: the blanket is handed over now).
 */
const NOT_ITS_SEASON =
  /\b(?:before|until|till|by|for|ahead of|after|since|than|unlike|instead of|rather than|compared (?:to|with)|ready for|prepare for|preparing for|get ready for)\s+(?:(?:the|this|next|last|that|another)\s+)?(?:(?:early|late|mid)[-\s]?)?$|\b(?:expecting|expected|due|planned|planning|scheduled|booked)\s+(?:in|this|next|for)\s+(?:the\s+)?(?:(?:early|late|mid)[-\s]?)?$/i;
/**
 * "spring" and "fall" are a season only in a frame: "in the fall", "this spring", "late fall", "spring
 * and summer", "the first robin of spring". "Of THE spring" / "of the fall" is the coil, the water or the
 * tumble ("the tension of the spring", "the shock of the fall"), never the season.
 */
const SEASON_FRAME_BEFORE =
  /\b(?:(?:in|during|through|throughout|over)\s+(?:the\s+)?|(?:this|last|next|every|each|that|one|all|early|late|mid|of)\s+)(?:(?:early|late|mid)[-\s]?)?$|\b(?:spring|summer|autumn|fall|winter)\s+(?:and|or|to|into|through)\s+$/i;
/**
 * A "fall" that is a TUMBLE: its sentence speaks of falling down or getting hurt ("she broke her hip in
 * the fall", "during the fall she hit her head on the tub"). A home-safety line about a fall is about the
 * tumble, never autumn — and "in autumn" added to a grab bar beside the tub would be a wrong season the
 * picture check then holds the picture to. Read in the sentence that holds the word.
 */
const TUMBLE =
  /\b(?:fell|fallen|slip(?:s|ped|ping|pery)?|tripp(?:ed|ing)|tumbl\w*|stumbl\w*|hips?|wrists?|injur\w*|hurt|broke|broken|fractur\w*|bruis\w*|ladders?|stairs?|staircase|step ?stools?|landed|(?:lose|loses|lost|losing)\s+(?:\w+\s+)?balance|grab bars?|bath ?tubs?|tub|ambulance|hospital)\b/i;
/** The sentence holding position `at`. */
const sentenceAt = (text: string, at: number) => {
  const start = Math.max(text.lastIndexOf(".", at), text.lastIndexOf("!", at), text.lastIndexOf("?", at)) + 1;
  const ends = [".", "!", "?"].map(c => text.indexOf(c, at)).filter(i => i >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
};
const SEASON_FRAME_AFTER = /^\s+(?:and|or|to|into|through)\s+(?:(?:early|late)\s+)?(?:spring|summer|autumn|fall|winter)\b/i;
const QUALIFIER = /\b(early|late|mid)[-\s]?$/i;
/** A word ruling it out, a few words back in the same clause: "it never sings in winter", "don't run it at night". */
const RULED_OUT = /(?:\b(?:no|not|never|nor|without|hardly ever)|n['’]t)\b(?:\s+[a-z'’-]+){0,4}\s+$/i;
/** Every season, so none: "all year", "year-round", "whatever the season". */
const ALL_YEAR = /\b(?:all year|year[-\s]round|every season|any season|all seasons|all four seasons|whatever the season|season after season|from season to season)\b/i;

const seasonOf = (w: string): Season => {
  const x = w.toLowerCase();
  return x === "fall" ? "autumn" : (x as Season);
};

/** Where the clause holding position `at` starts: after the last stop or comma before it. */
const clauseBefore = (text: string, at: number) => {
  const before = text.slice(0, at);
  const stop = Math.max(before.lastIndexOf("."), before.lastIndexOf(","), before.lastIndexOf(";"), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("—"));
  return before.slice(stop + 1);
};

/**
 * The outdoor scene a season word stands before in a picture's OWN words, which are a noun phrase and
 * say the season as a describing word: "above a green summer lawn" (job 411 scene 21's own words), "a
 * spring garden", "fall leaves on the path". Read only there (`pictureSeason`) — in a spoken line a
 * season before a noun is read as a thing named after it, and round 14's lines stay as they were.
 */
const SEASON_SCENERY = new Set(
  (
    "lawn lawns garden gardens yard yards backyard meadow meadows field fields pasture pastures grass " +
    "leaves foliage trees woods forest orchard landscape countryside rain shower showers storm storms " +
    "breeze bloom blooms blossom blossoms flowers"
  ).split(" ")
);

/**
 * The season `text` sets what it shows in (`held`), or none: the first one it names, with its "early"
 * / "late" / "mid" ("late winter"), when every season it names agrees — two that contrast, or "all
 * year", hold none. With `scenery`, a season said as a describing word before an outdoor scene ("a
 * green summer lawn") counts too — for a picture's own words. `notNow` is every season it names as
 * ANOTHER time than its moment — one it gets ready for, waits for or sets the moment against
 * ("expecting in the spring", "ready for spring", "since spring", "unlike summer"). A season only ruled
 * out ("never mow it short in summer") is not in it: that is still the moment, with an act ruled out.
 * Pure.
 */
function readSeasons(text: string | undefined, scenery: boolean): { held?: HeldSeason; notNow: Set<Season> } {
  const notNow = new Set<Season>();
  if (!text?.trim() || ALL_YEAR.test(text)) return { notNow };
  const found: HeldSeason[] = [];
  for (const m of Array.from(text.matchAll(SEASON_WORD))) {
    const at = m.index!;
    const word = m[1];
    const before = text.slice(0, at);
    // A name ("Winter Park", "Summer Lane") — a capital that does not start a sentence.
    if (/^[A-Z]/.test(word) && /[a-z,;:]\s*$/.test(before)) continue;
    const after = text.slice(at + m[0].length);
    // A thing named after a season ("a winter coat", "summer squash", "spring steel").
    const next = /^\s+([a-z'’-]+)/i.exec(after)?.[1]?.toLowerCase().replace(/['’]/g, "");
    const outdoors = scenery && !!next && SEASON_SCENERY.has(next);
    if (!m[2] && next && !/^[,.;:!?—)]/.test(after) && !STILL_A_TIME.has(next) && !outdoors) continue;
    const season = seasonOf(word);
    const tumble = /^fall$/i.test(word) && TUMBLE.test(sentenceAt(text, at));
    // Read before the frame: "until spring", "ready for spring" need none to be the season waited for.
    if (NOT_ITS_SEASON.test(before)) {
      if (!tumble) notNow.add(season);
      continue;
    }
    const ambiguous = /^(?:spring|fall)$/i.test(word) && !m[2];
    if (ambiguous && !outdoors && !SEASON_FRAME_BEFORE.test(before) && !SEASON_FRAME_AFTER.test(after)) continue;
    if (tumble) continue;
    if (RULED_OUT.test(clauseBefore(text, at))) continue;
    const q = QUALIFIER.exec(before)?.[1]?.toLowerCase();
    found.push({ season, said: q ? `${q} ${season}` : season });
  }
  if (!found.length) return { notNow };
  const kinds = new Set(found.map(f => f.season));
  // Two that contrast are no one season: summer against winter, spring against autumn.
  if ((kinds.has("summer") && kinds.has("winter")) || (kinds.has("spring") && kinds.has("autumn"))) return { notNow };
  return { held: found[0], notNow };
}

/** The season a spoken line sets what it shows in (`readSeasons`). Pure. */
export function lineSeason(text: string | undefined): HeldSeason | undefined {
  return readSeasons(text, false).held;
}

/**
 * The season a picture's OWN words (`showSubject`, `visualPrompt`) set it in: every exclusion a line
 * has — a fall that is a tumble, "of the spring" the coil, a season only planned for, a name — and a
 * season said as a describing word before an outdoor scene too ("a green summer lawn"). Pure.
 */
export function pictureSeason(words: string | undefined): HeldSeason | undefined {
  return readSeasons(words, true).held;
}

const SMALL_HOURS = "(?:one|two|three|four|1|2|3|4)(?::\\d\\d)?\\s*(?:o['’]clock\\s+)?(?:in the morning|a\\.?\\s?m\\b\\.?)";
/** Before dawn is still the night: dark outside. */
const BEFORE_DAWN = "before (?:the )?(?:dawn|daybreak|sunrise|first light)|pre-?dawn";
const HOURS: { hour: Hour; re: RegExp }[] = [
  {
    hour: "night",
    re: new RegExp(
      `\\b(?:(?:at|by|late at|all|every|each|one|that|last)\\s+night|in the (?:middle|dead) of (?:the )?night|through the night|during the night|after dark|at midnight|${SMALL_HOURS}|${BEFORE_DAWN})\\b`,
      "gi"
    ),
  },
  { hour: "dawn", re: /\b(?:at|around|right at|just after)\s+(?:the\s+)?(?:dawn|daybreak|sunrise|first light)\b/gi },
  { hour: "dusk", re: /\b(?:at|around|right at)\s+(?:dusk|sunset|twilight|nightfall)\b/gi },
];

/**
 * The hour line `text` sets what it shows in, or undefined: night ("at night", "at three in the
 * morning", "after dark", "before dawn"), dawn ("at first light", "at sunrise") or dusk ("at sunset"),
 * as said — every night hour reads "at night" or "before dawn", which is what the picture shows. Job
 * 405 scene 28, "three in the morning sits close enough to her pre-dawn window", is the night twice.
 * Dawn and dusk together are the low light of either, held as the first; the night beside another
 * hour holds none ("it hunts at dusk and sleeps through the night"), and neither does the night beside
 * the day ("last night I glued it up, and this morning I sanded it": the picture is the sanding, by
 * day) — the small hours "in the morning" are the night's own words, not the day. Pure.
 */
export function lineHour(text: string | undefined): HeldHour | undefined {
  if (!text?.trim()) return undefined;
  const found: (HeldHour & { at: number })[] = [];
  for (const { hour, re } of HOURS)
    for (const m of Array.from(text.matchAll(re))) {
      if (RULED_OUT.test(clauseBefore(text, m.index!))) continue;
      const said =
        hour !== "night" ? m[0].toLowerCase() : new RegExp(`^(?:${BEFORE_DAWN})$`, "i").test(m[0]) ? "before dawn" : "at night";
      found.push({ hour, said, at: m.index! });
    }
  if (!found.length) return undefined;
  found.sort((a, b) => a.at - b.at);
  const kinds = new Set(found.map(f => f.hour));
  if (kinds.has("night") && kinds.size > 1) return undefined;
  if (kinds.has("night") && DAY_WORDS.test(text.replace(SMALL_HOURS_ALL, " "))) return undefined;
  return { hour: found[0].hour, said: found[0].said };
}

/** The day said beside the night: "this morning", "that afternoon", "by day", "in daylight" — never bare "day". */
const DAY_WORDS = /\b(?:mornings?|afternoons?|noon|midday|daylight|daytime|by day|during the day)\b/i;

/**
 * Signs of a warm or a cold season in a picture's own words, said any way at all ("a green summer
 * lawn", "frost-dusted grass", "snowy"). A thing named after one ("snow boots", "a coiled spring")
 * reads as a sign too: the picture is then left as it is, never changed on a guess.
 */
const WARM_SIGNS = /\b(?:spring(?:time)?|summer(?:time)?|midsummer|blossom\w*|in bloom|in full leaf)\b/i;
const COLD_SIGNS =
  /\b(?:winter(?:time|y)?|wintry|midwinter|snow\w*|frost\w*|icy|frozen|autumn(?:al)?|fall (?:leaves|colou?rs?|foliage)|(?:in|this|late|early) fall)\b/i;
/** Signs of an hour in a picture's own words: never "dark walnut" or a nightstand. */
const HOUR_SIGNS: [Hour | "day", RegExp][] = [
  [
    "night",
    /\b(?:night(?:time)?|nights|overnight|midnight|in the dark|darkness|dark (?:room|bedroom|kitchen|house|hallway|yard|outside)|moon\w*|in the small hours|pre-?dawn|before (?:the )?(?:dawn|daybreak|sunrise))\b/i,
  ],
  ["dawn", /\b(?<!pre-|pre|before |before the )(?:dawn|daybreak|sunrise)\b|\bfirst light\b/i],
  ["dusk", /\b(?:dusk|sunset|twilight|nightfall|evening)\b/i],
  ["day", /\b(?:daylight|daytime|midday|noon|afternoon|morning|sunlit|sunny)\b/i],
];
const SMALL_HOURS_ANY = new RegExp(SMALL_HOURS, "i");
const SMALL_HOURS_ALL = new RegExp(SMALL_HOURS, "gi");

/** The hours a picture's own words set it at: "at 4 in the morning" is the night, not the morning. */
function hoursIn(words: string): Set<Hour | "day"> {
  const out = new Set<Hour | "day">();
  if (SMALL_HOURS_ANY.test(words)) out.add("night");
  const rest = words.replace(SMALL_HOURS_ALL, " ");
  for (const [hour, re] of HOUR_SIGNS) if (re.test(rest)) out.add(hour);
  return out;
}

/** A full-frame picture with its own line: a cutaway the shot list wrote, never the host, a CTA's, the cover or an asset. */
const holdsItsLine = (s: StoryboardScene) =>
  !s.hostPresent && !s.cta && !s.qrHero && !s.coverHero && !s.assetImageUrl && !!s.showSubject?.trim();

/**
 * Every picture whose line sets it in a season or at an hour (`lineSeason`, `lineHour`) and whose own
 * words (`showSubject` — what the picture must show, and what the check holds it to) name none, gets
 * the line's at the end of them: job 411 scene 20's "a robin singing on a branch at first light in the
 * backyard" → "…, in spring". A picture that names one already keeps it — the shot list or the line
 * check chose. Never a season word that is also a key thing's name (a "spring" in a video about a door
 * latch is that spring). Run after every writer of descriptions, before the prompt writer. Over the 352
 * stored films it changes 83 of 16,012 pictures: the battery chirping "at 4 in the morning" and the
 * heater "at 2 in the morning" (at night), job 405 scene 28's clock (the one that came back daylit),
 * "close the bedroom doors at night", the church hall sale "in the spring", the storm window "through
 * the winter". Returns how many pictures changed. Pure apart from writing `showSubject`.
 */
export function holdLineSeasons(scenes: StoryboardScene[], keyThings?: KeyThing[]): number {
  const thingWords = new Set(
    (keyThings ?? []).flatMap(k => k.name.toLowerCase().split(/[^a-z]+/)).filter(Boolean)
  );
  let n = 0;
  for (const s of scenes) {
    if (!holdsItsLine(s)) continue;
    const line = s.scriptText ?? s.narration;
    const own = s.showSubject!.trim();
    const add: string[] = [];
    const season = lineSeason(line);
    if (
      season &&
      !WARM_SIGNS.test(own) &&
      !COLD_SIGNS.test(own) &&
      // The season word itself, as the line may say it ("fall" is autumn), never its "early"/"late".
      ![season.season, ...(season.season === "autumn" ? ["fall"] : [])].some(w => thingWords.has(w))
    )
      add.push(`in ${season.said}`);
    const hour = lineHour(line);
    if (hour && !hoursIn(own).size) add.push(hour.said);
    if (!add.length) continue;
    s.showSubject = `${own.replace(/[.,;\s]+$/, "")}, ${add.join(", ")}`;
    n++;
  }
  return n;
}

/** What a reference image must not lend a picture at each hour. */
const AT_HOUR: Record<Hour, string> = {
  night: "night-time, no daylight anywhere in it",
  dawn: "the first low light of the day",
  dusk: "the last low light of the day",
};

/** Where the season or hour a picture is told was said: its line, or its own words. */
type SaidBy = "line" | "own";

/**
 * The season a picture drawn from references is in, and who said it. What it must show
 * (`showSubject`) comes first — the shot list or the line check chose it, and the check holds the
 * picture to it — then its line, then the prompt writer's rewrite (`visualPrompt`), which never
 * outranks the line: round 14's prompt writer filled a season the line had left it from the channel's
 * winter home base. Only a WARM season is said, and never on a picture whose own words hold snow,
 * frost, winter or autumn, nor one about a key thing named with that season word (a "latch spring" —
 * `holdLineSeasons` keeps it out the same way). Nor is a season the LINE names as another time than
 * its moment (`readSeasons`' `notNow`) taken back from the picture's words: a writer copies it from the
 * line, as job 158 scene 97's prompt drew a "spring yard beyond" for "a neighbor two doors down
 * expecting in the spring" — the blanket is handed over now. Undefined otherwise. Pure.
 */
function seasonToSay(
  line: string | undefined,
  own: string,
  prompt: string,
  thingWords: Set<string>
): { said: string; by: SaidBy } | undefined {
  const byOwn = pictureSeason(own);
  const { held: byLine, notNow } = readSeasons(line, false);
  const byPrompt = byOwn || byLine ? undefined : pictureSeason(prompt);
  const held = byOwn ?? byLine ?? byPrompt;
  if (!held || (held.season !== "spring" && held.season !== "summer") || thingWords.has(held.season)) return undefined;
  if (held !== byLine && byLine?.season !== held.season && notNow.has(held.season)) return undefined;
  if (COLD_SIGNS.test(own) || (byPrompt && COLD_SIGNS.test(prompt))) return undefined;
  return { said: held.said, by: byPrompt || (byOwn && byLine?.season !== byOwn.season) ? "own" : "line" };
}

/**
 * The hour a picture drawn from references is at, and who said it — in the same order as its season
 * (`seasonToSay`), each read strictly (`lineHour`: "at dawn", "at night" — never "dark walnut" or an
 * "evening gown"). Undefined when the words it must show (and the rewrite, when the hour is the
 * rewrite's) set it at another hour; dawn and dusk are the same low light. Pure.
 */
function hourToSay(line: string | undefined, own: string, prompt: string): { held: HeldHour; by: SaidBy } | undefined {
  const byOwn = lineHour(own);
  const byLine = lineHour(line);
  const byPrompt = byOwn || byLine ? undefined : lineHour(prompt);
  const held = byOwn ?? byLine ?? byPrompt;
  if (!held) return undefined;
  const signs = new Set([...Array.from(hoursIn(own)), ...(byPrompt ? Array.from(hoursIn(prompt)) : [])]);
  const others = Array.from(signs).filter(h => h !== held.hour);
  const twilight = held.hour !== "night" && others.every(h => h === "dawn" || h === "dusk");
  if (others.length && !twilight) return undefined;
  return { held, by: byPrompt || (byOwn && byLine?.hour !== byOwn.hour) ? "own" : "line" };
}

/**
 * The season and hour a picture drawn from references is in, said in so many words (`memoryClause`,
 * right before `MEMORY_SETTING_CLAUSE`). `MEMORY_SETTING_CLAUSE` gives the season to the picture's own
 * words, and job 411 scene 20's named none, so its snowy references lent their snow to a song that
 * "belongs to spring and summer": " THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AS
 * ITS LINE SAYS — whatever season, weather or light a reference image shows." The picture's OWN words
 * are held the same way (round 15, job 416 scene 20): "It's a male letting the neighborhood know this
 * patch is his" names no season, the shot list carried the passage's "at dawn in spring" into what the
 * picture must show, and with nothing said in so many words the robin's one reference — a thawing,
 * snow-patched March lawn — lent its snow and its flat daylight, while the line before, drawn from the
 * same reference under a line that names spring, came back leafy. Only a WARM season is said: a cold
 * one is in the picture's own words already (`holdLineSeasons`), and asking for winter's look would put
 * snow back on a mild Gulf Coast lawn "in winter" (job 411 scene 16). Empty when neither holds one. Pure.
 */
export function seasonHourClause(scene: StoryboardScene): string {
  const line = scene.scriptText ?? scene.narration;
  const own = scene.showSubject ?? "";
  const prompt = scene.visualPrompt ?? "";
  const thingWords = new Set(
    [scene.keyThing, scene.partOf, ...(scene.otherKeyThings ?? [])].flatMap(t => (t ?? "").toLowerCase().split(/[^a-z]+/)).filter(Boolean)
  );
  const parts: string[] = [];
  const by = new Set<SaidBy>();
  const season = seasonToSay(line, own, prompt, thingWords);
  if (season) {
    parts.push(`IN ${season.said.toUpperCase()} (no snow, frost or ice on anything)`);
    by.add(season.by);
  }
  const hour = hourToSay(line, own, prompt);
  if (hour) {
    parts.push(`${hour.held.said.toUpperCase()} (${AT_HOUR[hour.held.hour]})`);
    by.add(hour.by);
  }
  if (!parts.length) return "";
  const as = by.size > 1 ? "AS ITS LINE AND ITS OWN WORDS SAY" : by.has("own") ? "AS ITS OWN WORDS SAY" : "AS ITS LINE SAYS";
  return ` THIS PICTURE IS ${parts.join(", ")}, ${as} — whatever season, weather or light a reference image shows.`;
}
