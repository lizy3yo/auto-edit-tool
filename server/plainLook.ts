/**
 * A STAGED PICTURE IS REDRAWN PLAINER, NOT THE SAME (2026-10-18, round 13, the review of jobs 409 and
 * 410). The check's "staged" (`STAGED_RULE`) judges a picture's light and finish, and its one redraw
 * (`cleanRerolls` in the still loop) used to change only the seed — so a picture whose own words ask
 * for the staged look was drawn the same way again, came back "staged" again and shipped flagged:
 * - job 409 scene 25, "a wealthy man in a fine off-white toga … standing beside a marble throne in a
 *   grand hall" under "an advisor standing one step from the throne": a glossy marble throne hall,
 *   "staged" on both draws. The line never asked for marble or grandeur;
 * - job 409 scene 22, "writing on a scroll with a reed pen by lamplight", "lamplight on the face of the
 *   scroll" under a line that names no light: the golden oil-lamp glow the rule names;
 * - job 410 scene 13, "a commercial passenger jet flying above a layer of white clouds, seen from the
 *   side": an air-to-air view no phone can take, so the picture maker can only draw a stock render;
 * - job 410 scene 10, the host's hands with a clipboard at a galley counter: nothing to take out of its
 *   words, but the redraw repeated the same advert pose.
 * So the staged redraw goes with what the LINE never asked for: light, grandeur and finish words the
 * line does not say are taken out of the picture's own words (`plainDescription`), a view no person
 * with a phone could take is recast to the nearest one a person could (`possibleView`), and the redraw
 * is told to be an ordinary snapshot (`plainLookClause`). Light the line names stays — the night, a
 * candle, the lamp (`namedLight`, round 11) — and so does the lamp that lights a night the picture's
 * own words are set in (job 400 scene 12, "a wooden kitchen table lit by a single warm lamp at night …
 * rest of the room dark": without its lamp that night has nothing to light it), and a material or
 * finish the thing's own look names (a marble mortar is marble). Nothing is added to the picture: no
 * extra draw, no extra check. General: no channel's things — the words are a rule about light,
 * grandeur and the camera. Pure.
 */
import type { StoryboardScene } from "@shared/types";
import { namedLight } from "./overlayTextScan";

/**
 * Who keeps what. `light` — the words that keep a light, glow or lighting style: the narration line
 * and the key thing's name (a lamp or candle that IS the thing). `thing` — the words that keep a
 * material, finish or grand thing: the line plus every look the picture carries (its key thing's, a
 * named kind's, a recurring person's, the host's clothes). `named` — the light that stays named
 * (`namedLight`): the line's, or — when the line names none — the picture's own words' when they set
 * it in a dark or low hour (a night, a dark room, dusk), so a light source there is what lights it.
 * Empty: plain light, and every light source the line never named goes.
 */
export type PlainLookKeep = { light: string; thing: string; named: string[] };

/** A word `namedLight` found that names a light SOURCE, not an hour or a darkness. */
const SOURCE_NAME = /lamp|candle|lantern|fire|flame|hearth|ember|glow|torch|flash/i;

export function plainLookKeep(
  scene: Pick<
    StoryboardScene,
    "keyThing" | "keyThingLook" | "namedLook" | "pictureText" | "otherPersonLooks" | "brollHostLook"
  >,
  line: string | undefined,
  /** The picture's own words (its subject and its visual). */
  words: (string | undefined)[] = []
): PlainLookKeep {
  const looks = [
    scene.keyThingLook,
    scene.namedLook,
    scene.brollHostLook,
    ...(scene.otherPersonLooks ?? []).map(p => p.look),
  ];
  const light = [line, scene.keyThing, scene.pictureText].filter(Boolean).join(" ");
  const own = namedLight(...words);
  const said = namedLight(line);
  const named = said.length ? said : own.some(w => !SOURCE_NAME.test(w)) ? own : [];
  return { light, thing: [light, ...looks].filter(Boolean).join(" "), named };
}

/** Adjectives a light source carries ("warm lamplight", "a single flickering candle"). */
const LIGHT_ADJ = String.raw`(?:(?:warm|soft|golden|flickering|dim|gentle|amber|faint|low|orange|single|lone|small|nearby)\s+)`;
/** A source that glows: the light the staged rule names (a glowing lamp, a candle, firelight). */
const SOURCE = String.raw`(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch|hearth)`;
const POSSESSIVE = String.raw`(?:the|an?|its|his|her|their)`;

/**
 * One rule: what it takes out, and which words keep it. `source` — a light source, kept also while
 * light stays named (`PlainLookKeep.named`); `light` — a glow or lighting style, kept only by the line
 * (light is never a property of the thing); `thing` — a material, finish or grand thing, kept by the
 * line or any look the picture carries.
 */
type Strip = { re: RegExp; kind: "source" | "light" | "thing" };

/**
 * A finish the picture maker reads as an advert's. Never "glossy", "polished" or "sleek": over the
 * stored films those describe the thing itself — glossy holly leaves, a polished church pew.
 */
const FINISH = String.raw`(?:gleaming|pristine|spotless|immaculate|flawless|showroom|picture-perfect|perfectly)`;
/** Grandeur — never a grand piano, a canyon or a prix. */
const GRAND = String.raw`(?:grand(?!\s+(?:piano|canyon|prix|slam|total|opening|jury|central|rapids|marshal|finale)s?\b)|grandiose|opulent|lavish|luxurious|luxury|sumptuous|palatial|majestic|regal|magnificent|ornate|gilded|marble|marbled|velvet|stately|imposing)`;
/**
 * One of `words` where it describes the word after it: "a grand hall", "an opulent, gilded room" —
 * never a word at the end of a phrase ("made of marble, standing on…").
 */
const adjectives = (words: string) =>
  new RegExp(String.raw`\b${words}(?:\s+(?=[a-z])|,\s*(?=(?:${FINISH}|${GRAND})\b))`, "gi");

const STRIPS: Strip[] = [
  // "lit by a lantern", "bathed in the glow of an oil lamp", "illuminated by candles".
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*\b(?:lit|illuminated|bathed|warmed)\s+(?:only\s+)?(?:by|with|in)\s+(?:${POSSESSIVE}\s+)?${LIGHT_ADJ}{0,2}(?:(?:glow|light)\s+of\s+(?:${POSSESSIVE}\s+)?${LIGHT_ADJ}{0,2})?${SOURCE}(?:[- ]?light)?s?\b`,
      "gi"
    ),
  },
  // "by lamplight", "in the warm candlelight" — never "by the fire" (sitting by it is a place).
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*\b(?:by|in|under|beneath)\s+(?:the\s+)?${LIGHT_ADJ}{0,2}(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?light\b`,
      "gi"
    ),
  },
  // "by the soft glow of a candle", "in the light of the fire".
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*\b(?:by|in|under|beneath)\s+the\s+${LIGHT_ADJ}{0,2}(?:glow|light)\s+of\s+(?:${POSSESSIVE}\s+)?${LIGHT_ADJ}{0,2}${SOURCE}s?\b`,
      "gi"
    ),
  },
  // "lamplight on the face of the scroll" (job 409 scene 22), "candlelight flickering across the wall".
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*${LIGHT_ADJ}{0,2}(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?(?:light|glow)\s+(?:on|over|across|onto|upon|falling\s+(?:on|onto|across|over)|spilling\s+(?:on|onto|over|across)|catching|filling|flickering\s+(?:on|over|across))\s+[^,.;]+`,
      "gi"
    ),
  },
  // "…, warm lamplight, …" as a phrase of its own.
  {
    kind: "source",
    re: new RegExp(String.raw`(?<=^|,)\s*${LIGHT_ADJ}{0,2}(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?(?:light|glow)\s*(?=[,.;]|$)`, "gi"),
  },
  // "a candlelit table", "a lamp-lit desk".
  { kind: "source", re: new RegExp(String.raw`\b(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?lit\s+(?=[a-z])`, "gi") },
  // "with a glowing oil lamp beside it", "beside two candles burning on the shelf" — a lamp the line never
  // named, set beside the subject. A lamp that IS the subject has no word before it and stays.
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*\b(?:with|beside|next to|near|and|under)\s+(?:an?|the|one|two|three|several|a few|some)\s+(?:(?:glowing|lit|burning|flickering|small|single|lone|brass|clay|bronze|ceramic|terracotta|old|antique|tall|thin|white|little)\s+){0,3}(?:oil[- ]?)?(?:lamps?|candles?|lanterns?)\b(?:\s+(?:burning|glowing|flickering|lit))?(?:\s+(?:on|beside|by|near|next to|behind|at|in)\s+${POSSESSIVE}\s+[a-z-]+(?:\s+[a-z-]+)?(?=\s*(?:[,.;]|$)))?`,
      "gi"
    ),
  },
  { kind: "source", re: /\bglowing\s+(?=[a-z])/gi },
  // "a warm glow", "a soft golden glow over the room".
  {
    kind: "light",
    re: /,?\s*(?:\b(?:an?|the)\s+)?\b(?:(?:warm|soft|gentle|faint|cozy|cosy|rich|deep|orange|amber|golden)\s+){1,2}glow\b(?:\s+(?:on|over|across|from|filling|bathing)\s+[^,.;]+)?/gi,
  },
  // Golden light: "golden low light on distant hills" (job 412 scene 25), "at golden hour", "golden-lit".
  // Only as light — never "a golden retriever" or "a golden-brown crust".
  { kind: "light", re: /,?\s*\b(?:at|during|in)\s+(?:the\s+)?golden hour\b/gi },
  { kind: "light", re: /\b(?:golden|amber|honeyed)[- ]lit\s+(?=[a-z])/gi },
  {
    kind: "light",
    re: /\b(?:golden|amber|honeyed)(?:[- ]hour)?\s+(?=(?:(?:low|warm|soft|late|evening|morning|afternoon|sun|sunset|sunrise|dawn|dusk|early|hazy|setting)\s+){0,2}(?:light|glow|sunlight|sunshine|haze|hue|tones?|rays?|lighting|backlight(?:ing)?)\b)/gi,
  },
  // A lighting style: "dramatic lighting", "moody shadows", "studio light", "perfectly lit".
  {
    kind: "light",
    re: /,?\s*\b(?:dramatic|moody|cinematic|theatrical|atmospheric|studio|professional|chiaroscuro|rim|soft-?box)\s*[- ]?(?:light(?:ing|s)?|lit|shadows?)\b/gi,
  },
  { kind: "light", re: /,?\s*\b(?:perfectly|beautifully|dramatically|professionally)\s+lit\b/gi },
  {
    kind: "light",
    re: /,?\s*\b(?:lens flares?|sun flares?|god rays|light rays|(?:shafts|beams) of (?:golden |warm |soft )?(?:sun)?light|bokeh|shallow depth of field|(?:dark,?\s+)?moody corners|deep shadows|vignett(?:e|ing))\b/gi,
  },
  // A finish or a style the picture maker reads as "make it an advert": "a product shot of …" — never
  // a listing's "product photo and price" on a screen (job 406 scene 25), which is what the screen shows.
  {
    kind: "thing",
    re: /\b(?:an?\s+)?(?:advert(?:ising|isement)?|commercial|stock|catalog(?:ue)?|magazine|studio|product)(?:[- ]style)?\s+(?:photo(?:graph)?|shot|image|still)\s+of\s+/gi,
  },
  { kind: "thing", re: /\b(?:advert(?:ising|isement)?|commercial|catalog(?:ue)?|magazine|editorial)[- ]style\s+/gi },
  // A grand thing set beside the subject; one that IS the subject has no word before it and stays.
  {
    kind: "thing",
    re: /,?\s*\b(?:beside|by|near|next to|under|beneath|before|in front of|below|with|and)\s+(?:an?|the)\s+(?:[a-z-]+,?\s+){0,2}?(?:throne|chandelier)s?\b(?:\s+(?:above|overhead|behind|nearby|beside it))?/gi,
  },
  {
    kind: "light",
    re: /\b(?:cinematic|dramatic|moody|epic|stunning|breathtaking|ethereal|atmospheric|hyper-?realistic|photo-?realistic|ultra-?detailed|highly detailed|high-end|award-winning|editorial)\s+(?=[a-z])/gi,
  },
  { kind: "thing", re: adjectives(FINISH) },
  // Grandeur: "a marble throne in a grand hall" (job 409 scene 25). Words last: a phrase rule above
  // reads the words as written.
  { kind: "thing", re: adjectives(GRAND) },
];

/**
 * The words in a match that would keep it: the light source, glow or grand word itself, cut to a
 * stem so "lamp" keeps "lamplight" and "polish" keeps "polished".
 */
const TRIGGER =
  /\b(?:oil[- ]?)?(lamp|candle|lantern|fire|torch|hearth|glow|golden|amber|honeyed|dramatic|moody|cinematic|theatrical|atmospheric|studio|professional|chiaroscuro|rim|soft-?box|flares?|rays|bokeh|shadows?|vignett\w*|depth|epic|stunning|breathtaking|ethereal|hyper\w*|photo-?realistic|ultra\w*|detailed|high-end|award\w*|editorial|glossy|high-gloss|polished|gleaming|pristine|spotless|immaculate|flawless|sleek|showroom|picture-perfect|perfect\w*|beautifully|dramatically|professionally|grand\w*|opulent|lavish|luxur\w*|sumptuous|palatial|majestic|regal|magnificent|ornate|gilded|marble\w*|velvet|stately|imposing|throne|chandelier|advert\w*|commercial|stock|catalog\w*|magazine|product)/gi;

const stemOf = (w: string) => {
  const s = w.toLowerCase();
  return s.length > 5 ? s.slice(0, 5) : s;
};
const says = (text: string, word: string) =>
  new RegExp(String.raw`\b${stemOf(word).replace(/[^a-z-]/g, "")}`, "i").test(text);

/** Where a rule took words out, so the article before it is fitted to the word now after it. */
const GONE = "\u0001";

/**
 * The spaces, commas and articles a removal leaves behind, put right: "a marble throne" → "a throne",
 * "an ornate hall" → "a hall". Only an article right before a removal changes — "a user" or "an hour"
 * anywhere else are never touched.
 */
function tidy(text: string, original: string): string {
  let out = text
    .replace(/\b([Aa])n?\s*(?:\u0001\s*)+(?=([A-Za-z]))/g, (_m, a: string, next: string) =>
      `${a}${/[aeiou]/i.test(next) ? "n" : ""} `
    )
    .replace(/\s*\u0001\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/,\s*([.;:])/g, "$1")
    .replace(/^\s*[,;:]\s*/, "")
    .replace(/[,;:]\s*$/, "")
    .trim();
  if (/^[A-Z]/.test(original.trim()) && /^[a-z]/.test(out)) out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}

/** One kind of rule over a text; what a rule takes out leaves `GONE` behind for `tidy`. */
function applyStrips(text: string, keep: PlainLookKeep, kinds: Strip["kind"][]): string {
  let out = text;
  for (const rule of STRIPS) {
    if (!kinds.includes(rule.kind)) continue;
    out = out.replace(rule.re, m => {
      if (rule.kind === "source" && keep.named.length) return m;
      const words = Array.from(m.matchAll(TRIGGER)).map(t => t[1]);
      const by = rule.kind === "thing" ? keep.thing : keep.light;
      return words.some(w => says(by, w)) ? m : GONE;
    });
  }
  return out;
}

/**
 * A picture's own words without the light, grandeur and finish its line never asked for. "…writing
 * on a scroll with a reed pen by lamplight, seen from the side" → "…writing on a scroll with a reed
 * pen, seen from the side"; "standing beside a marble throne in a grand hall" under "one step from
 * the throne" → "standing beside a throne in a hall". Untouched when there is nothing to take out
 * (byte-identical). Pure.
 */
export function plainDescription(text: string, keep: PlainLookKeep): string {
  if (!text?.trim()) return text;
  const out = applyStrips(text, keep, ["source", "light", "thing"]);
  return out === text ? text : tidy(out, text);
}

/**
 * Only the LIGHT taken out — for a key thing's written look, whose materials are the thing itself
 * ("an open dawn-lit wilderness with low golden light" keeps its wilderness, loses its golden). Pure.
 */
export function plainLight(text: string, keep: PlainLookKeep): string {
  if (!text?.trim()) return text;
  const out = applyStrips(text, keep, ["source", "light"]);
  return out === text ? text : tidy(out, text);
}

// ——— A view no phone can take ———

/** A flying machine, never a woodworker's plane, a toy or a geometric plane. */
const AIRCRAFT_NP = String.raw`(?:\b(?:an?|the|one)\s+(?:[a-z-]+\s+){0,3}?|^\s*(?:[A-Za-z-]+\s+){0,3}?|\b)(?:jet(?:liner)?|airliner|air ?plane|aeroplane|plane|aircraft)s?\b`;
const NOT_AN_AIRCRAFT =
  /\b(?:hand|block|jack|smoothing|bench|jointer|wood(?:en)?|low-angle|rabbet|shoulder|paper|toy|model|scrub|router)\s+planes?\b|\bplanes?\s+(?:iron|blade|shavings?)\b|\b(?:inclined|flat|horizontal|vertical|picture|focal|image)\s+planes?\b|\bjets?\s+(?:of|black|ski|stream|lag|spray|nozzle)\b|\b(?:water|air|steam|gas|spray|pressure|massage)\s+jets?\b|\bjet-black\b/i;
/** In the air: flying, cruising, above or among the clouds. */
const IN_FLIGHT =
  /\b(?:flying|in flight|mid-?flight|mid-?air|in the air|airborne|cruising|soaring|at altitude|air-to-air)\b|\b(?:above|over|through|among)\s+(?:an?\s+|the\s+)?(?:(?:layer|sea|blanket|bank|deck)\s+of\s+)?(?:(?:white|grey|gray|fluffy|thick|puffy|scattered)\s+)?clouds\b/i;
/** A view of a plane a person really takes: from a seat, through a window, from the ground or the gate. */
const A_PERSON_SEES_IT =
  /\bwindows?\b|\bcabin\b|\bcockpit\b|\bseat\b|\baisle\b|\bfrom (?:the |a )?(?:ground|runway|tarmac|terminal|airport|beach|field|yard|street|road|below)\b|\boverhead\b|\bon the (?:runway|tarmac|ground|apron)\b|\bat the gate\b|\btak(?:ing|es) off\b|\blanding\b|\btaxiing\b|\bparked\b|\bhangar\b/i;
/** High enough that a passenger's window is the nearest view; lower, it is the ground's. */
const HIGH_UP = /\b(?:clouds|cruising|altitude|air-to-air|over the (?:ocean|sea))\b/i;
/** A view only a machine has: aerial, drone, satellite, helicopter, air-to-air, from space or orbit. */
const MACHINE_VIEW =
  /\b(?:aerial|drone|satellite|helicopter)[- ](?:view|shot|photo(?:graph)?|image|footage|perspective|angle|picture)s?\b|\bair-to-air\b|\b(?:from|by)\s+(?:a\s+)?(?:drone|satellite|helicopter)\b|\bfrom\s+(?:space|orbit|the air)\b/i;
const MACHINE_VIEW_WORDS =
  /(?:,\s*)?(?:\b(?:an?|the)\s+)?\b(?:aerial|drone|satellite|helicopter|air-to-air)[- ](?:view|shot|photo(?:graph)?|image|footage|perspective|angle|picture)s?(?:\s+of)?\s*|(?:,\s*)?\b(?:(?:seen|viewed|shot|photographed|taken|captured)\s+)?(?:from|by)\s+(?:a\s+)?(?:drone|satellite|helicopter|space|orbit|the air)\b|\bair-to-air\s+/gi;
/** "seen from the side", "in profile" — a view from beside a plane in flight is another plane's. */
const BESIDE_IT =
  /,?\s*\b(?:seen|viewed|shown|shot|photographed|captured)\s+(?:from\s+)?(?:the\s+side|alongside|outside(?:\s+(?:the|an?)\s+(?:plane|aircraft|jet|airliner|air ?plane|aeroplane))?|in profile|side-on|(?:another|a chase)\s+(?:plane|aircraft|jet))\b|,?\s*\bin\s+(?:side|profile)\s+view\b/gi;

/** What a passenger with a phone sees of the plane in flight. */
export const WINDOW_VIEW = "seen from a passenger's seat through the cabin window";
/** What a person below sees of a plane in flight. */
export const GROUND_VIEW_OF_SKY = "seen from the ground far below";
/** Any other machine's view, brought down to a person's. */
export const GROUND_VIEW = "seen from the ground at a person's standing height, the way someone there would take it";

/**
 * A picture's own words asking for a view no person with a phone could take — an aircraft in flight
 * from beside it (job 410 scene 13: "a commercial passenger jet flying above a layer of white clouds,
 * seen from the side"), or an aerial, drone, satellite or helicopter view, or one from space — recast
 * to the nearest view a person could: high up, the plane's wing through a cabin window from a
 * passenger's seat; lower, the plane from the ground; anything else from the ground at standing
 * height. A view from inside a solid thing is not this: every prompt already draws it from outside
 * (`withoutCutaway`, `SEEN_FROM_OUTSIDE_CLAUSE`). Untouched when the view is one a person takes (a
 * plane through the window, on the runway, overhead from the ground). Pure.
 */
export function possibleView(text: string): string {
  if (!text?.trim()) return text;
  const aircraft = new RegExp(AIRCRAFT_NP, "i");
  const plane = aircraft.test(text) && !NOT_AN_AIRCRAFT.test(text);
  const flying = plane && IN_FLIGHT.test(text) && !A_PERSON_SEES_IT.test(text);
  if (!flying && !MACHINE_VIEW.test(text)) return text;
  let out = text.replace(MACHINE_VIEW_WORDS, " ").replace(BESIDE_IT, "");
  if (flying) {
    const high = HIGH_UP.test(text);
    out = out.replace(aircraft, np => {
      // "Commercial airplane …" at the start of the words reads on as "the wing of a commercial airplane".
      const bare = np.replace(/^\s*(?:an?|the|one)\s+/i, "").replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
      const withArticle = `${/^[aeiou]/i.test(bare) ? "an" : "a"} ${bare}`;
      return high ? `the wing of ${withArticle}, ${WINDOW_VIEW},` : `${withArticle}, ${GROUND_VIEW_OF_SKY},`;
    });
  } else out = `${out.trim().replace(/[.\s]+$/, "")}, ${GROUND_VIEW}`;
  return tidy(out, text);
}

/** Both, in order: what the line never asked for out, then the camera brought down to a person's. */
export function plainPicture(text: string, keep: PlainLookKeep): string {
  return possibleView(plainDescription(text, keep));
}

/** How the staged redraw's clause starts — found again so it is never added twice. */
export const PLAIN_LOOK_START = "DRAWN AGAIN, PLAINER:";

/**
 * Told on the staged redraw, after the picture's words lost what the line never asked for. With light
 * that stays named (`PlainLookKeep.named`), that light stays and only what goes beyond it is refused,
 * the way the check judges it (`namedLightQuestion`); without, plain light. Neutral words only. Pure.
 */
export function plainLookClause(named: string[]): string {
  const light = named.length
    ? `the light the words name (${named.map(w => `"${w.replace(/"/g, "'")}"`).join(", ")}) as a phone ` +
      "really catches it, and nothing beyond it — no golden glow, no dramatic or cinematic light"
    : "the plain light the place really has at that time, as a phone catches it — flat and a little dull, " +
      "no glow from a lamp, candle or fire, no golden, dramatic or cinematic light";
  return (
    `${PLAIN_LOOK_START} the last picture looked styled — like an advert or a render, not a photo someone ` +
    `took. Make it an ordinary phone snapshot: ${light}; no glossy, polished or showroom finish — surfaces ` +
    "look used and real and nothing gleams; nobody poses for the camera; the place is as plain and lived-in " +
    "as a real one, framed casually from where a person would really stand."
  );
}

