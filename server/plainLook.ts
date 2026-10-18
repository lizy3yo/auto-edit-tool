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
 * it in a dark or low hour (a night, a dark room, dusk), so a light source there is what lights it —
 * and the key thing's own light when the thing IS a light (a lamp, a lantern, a candle): lit is its use
 * (the main thing in use), so a staged redraw of a lantern is never told "no glow from a lamp" and
 * drawn dark. Empty: plain light, and every light source the line never named goes.
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
  const base = said.length ? said : own.some(w => !SOURCE_NAME.test(w)) ? own : [];
  const thingLight = namedLight(scene.keyThing).filter(w => !base.some(b => b.toLowerCase() === w.toLowerCase()));
  return { light, thing: [light, ...looks].filter(Boolean).join(" "), named: [...base, ...thingLight] };
}

/**
 * Adjectives a light source carries ("warm lamplight", "a single flickering candle"). "indoor" and the
 * like too: "soft indoor lamplight catching fine dust" lost only its lamplight and left "soft indoor"
 * behind (job 134 scene 11, over the stored films).
 */
const LIGHT_ADJ = String.raw`(?:(?:warm|soft|golden|flickering|dim|gentle|amber|faint|low|orange|single|lone|small|nearby|indoor|pale|yellow|steady|bright|evening|cozy|cosy|quiet|muted|diffused?|even|overhead)\s+)`;
/** A source that glows: the light the staged rule names (a glowing lamp, a candle, firelight). */
const SOURCE = String.raw`(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch|hearth)`;
const POSSESSIVE = String.raw`(?:the|an?|its|his|her|their)`;
/** How something is lit ("softly lit by lamplight") — never a noun that ends the same way ("a family lit by…"). */
const HOW_LIT = String.raw`(?:softly|warmly|gently|dimly|faintly|brightly|evenly|only|partly|barely|just)`;
/**
 * What a sentence stands on, so a light phrase after it stays: "The page is lit by soft lamplight",
 * "two squares, both in warm lamplight" left "The page is," and "both." (jobs 154 and 281 over the
 * stored films).
 */
const STANDS_ON = String.raw`(?<!\b(?:is|are|was|were|be|been|being|remains?|stays?|both|all|each)\s+(?:${HOW_LIT}\s+)?)`;
/** Where a light comes from, which goes with it: "lit by warm lamplight from above" (job 348 scene 18). */
const FROM_WHERE = String.raw`(?:\s+from\s+(?:above|below|behind|overhead|the\s+(?:side|left|right|front|back)))?`;
/**
 * What may follow a light phrase that goes: a stop, a joining word or a place — never a noun it
 * describes ("the needle in the lamplight sewing room" left "the needle sewing room", job 181 scene 15).
 */
const PHRASE_ENDS = String.raw`(?=\s*(?:[,.;:\u2014)]|$|\b(?:on|in|at|from|with|and|or|beside|by|near|under|over|across|through|into|onto|for|to|of|indoors|outdoors|inside|outside|nearby|behind|above|below|beneath|again|still|now|then|alone)\b|\b(?:softly|warmly|gently|quietly|calmly|slowly|steadily)\b))`;
/**
 * The word after an adjective that shows it describes what a thing is DOING, not the thing: an adverb,
 * a preposition, a joining word or an article. "the metal zippers gleaming softly", "wet glue gleaming
 * at the joint" — taking the word out there left "the metal zippers softly" (jobs 126 and 133 over the
 * stored films).
 */
const NOT_A_NOUN = String.raw`(?:[a-z]+ly|in|on|at|under|with|and|or|but|against|as|from|through|into|across|beneath|behind|beside|over|above|below|near|by|to|for|of|the|a|an|its|their|his|her|is|are|was|were|than|when|while|where|that|which)\b`;

/**
 * One rule: what it takes out, and which words keep it. `source` — a light source, kept also while
 * light stays named (`PlainLookKeep.named`); `light` — a glow or lighting style, kept only by the line
 * (light is never a property of the thing); `thing` — a material, finish or grand thing, kept by the
 * line or any look the picture carries. `phrase` — the match is a bare noun phrase, so it stays when
 * what comes before it needs it as an object ("casting deep shadows", `NEEDS_AN_OBJECT`); `clause` —
 * it goes only as a clause of its own, after a stop or its own lead-in (`CLAUSE_BEFORE`). A named
 * group `stay` is put back after the removal: the words the rule reads to decide, not what it takes.
 */
type Strip = { re: RegExp; kind: "source" | "light" | "thing"; phrase?: boolean; clause?: boolean };

/**
 * A finish the picture maker reads as an advert's. Never "glossy", "polished" or "sleek": over the
 * stored films those describe the thing itself — glossy holly leaves, a polished church pew. Nor
 * "perfectly": over the stored films it is the craft the line claims ("stitches lying perfectly flat",
 * "the dowel and hole perfectly aligned"), not a finish.
 */
const FINISH = String.raw`(?:gleaming|pristine|spotless|immaculate|flawless|showroom|picture-perfect)`;
/**
 * Grandeur — never a grand piano, a canyon or a prix. Never "velvet" or "marbled" either: over the
 * stored films they are what ordinary things are — a velvet jewellery box (job 395 scene 10), a velvet
 * tray, the marbled surface of a raw roast (jobs 115 and 138). "marble" only for a hall, a throne,
 * columns, a palace floor: a marble bathroom counter is an ordinary home's (jobs 222 and 235 kept
 * theirs through a whole film, so one plain redraw would have stood out from its neighbours).
 */
const GRAND = String.raw`(?:grand(?!\s+(?:piano|canyon|prix|slam|total|opening|jury|central|rapids|marshal|finale)s?\b)|grandiose|opulent|lavish|luxurious|luxury|sumptuous|palatial|majestic|regal|magnificent|ornate|gilded|marble(?=\s+(?:halls?|thrones?|columns?|pillars?|palaces?|floors?|staircases?|stairs|steps|statues?|busts?|arch(?:es|way)?|fountains?|corridors?|chambers?|courtyards?|temples?|niches?)\b)|stately|imposing)`;
/**
 * One of `words` where it describes the word after it: "a grand hall", "an opulent, gilded room" —
 * never a word at the end of a phrase ("made of marble, standing on…"), nor one that says what a
 * thing is doing ("an oil finish gleaming softly", `NOT_A_NOUN`).
 */
const adjectives = (words: string) =>
  new RegExp(String.raw`\b${words}(?:\s+(?=(?!${NOT_A_NOUN})[a-z])|,\s*(?=(?:${FINISH}|${GRAND})\b))`, "gi");
/** A glow adjective: "a warm glow", "a soft golden glow". */
const GLOW_ADJ = String.raw`(?:(?:warm|soft|gentle|faint|cozy|cosy|rich|deep|orange|amber|golden)\s+)`;
/** A lighting style: "dramatic lighting", "studio light", "moody shadows". */
const STYLE = String.raw`(?:dramatic|moody|cinematic|theatrical|atmospheric|studio|professional|chiaroscuro|rim|soft-?box)`;
/** Where a phrase that is a whole clause of its own starts: the start, or after a comma or full stop. */
const CLAUSE_START = String.raw`(?:^|,|(?<=[.;:—]))`;
const CLAUSE_END = String.raw`(?=\s*(?:[,.;:—]|$))`;

const STRIPS: Strip[] = [
  // "lit by a lantern", "bathed in the glow of an oil lamp", "illuminated by candles" — with the word
  // that said how ("the room behind him softly lit by lamplight" left "softly."), the lamp's own place
  // ("lit by an oil lamp on a nearby table" left "a sewing room on a nearby table") and its whole name
  // ("lit by soft oil lamp glow" left "glow"). Never what a sentence stands on (`STANDS_ON`), nor a
  // phrase the words go on from ("lit by warm lamplight that shows the seams" left "that shows"; jobs
  // 134, 154, 190 and 198 over the stored films).
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*${STANDS_ON}(?:\b${HOW_LIT}\s+)?\b(?:lit|illuminated|bathed|warmed)\s+(?:only\s+)?(?:by|with|in)\s+(?:${POSSESSIVE}\s+)?${LIGHT_ADJ}{0,3}(?:(?:glow|light)\s+of\s+(?:${POSSESSIVE}\s+)?${LIGHT_ADJ}{0,3})?${SOURCE}(?:[- ]?(?:light|glow))?s?\b(?:\s+(?:on|at|beside|near)\s+${POSSESSIVE}\s+(?:[a-z'\u2019-]+\s+){0,2}?[a-z'\u2019-]+(?=\s*(?:[,.;]|$)))?${FROM_WHERE}${PHRASE_ENDS}`,
      "gi"
    ),
  },
  // "by lamplight", "in the warm candlelight" — never "by the fire" (sitting by it is a place).
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*${STANDS_ON}\b(?:by|in|under|beneath)\s+(?:the\s+)?${LIGHT_ADJ}{0,3}(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?light\b${FROM_WHERE}${PHRASE_ENDS}`,
      "gi"
    ),
  },
  // "by the soft glow of a candle", "in the light of the fire".
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*${STANDS_ON}\b(?:by|in|under|beneath)\s+the\s+${LIGHT_ADJ}{0,3}(?:glow|light)\s+of\s+(?:${POSSESSIVE}\s+)?${LIGHT_ADJ}{0,3}${SOURCE}s?\b${FROM_WHERE}${PHRASE_ENDS}`,
      "gi"
    ),
  },
  // "lamplight on the face of the scroll" (job 409 scene 22), "candlelight flickering across the wall" —
  // only as a clause of its own (`clause`): after "soft overhead" it left "soft overhead;" (job 178
  // scene 357). Never across a dash: "lamplight catching the mixed-print patches—churn dash, bear paw,
  // flying geese blocks" took the first named block with it and left the others hanging (job 281 scene
  // 16). Whole words only: inside "campfire glow on the faces" it left "camp" behind.
  {
    kind: "source",
    clause: true,
    re: new RegExp(
      String.raw`,?\s*(?:\b${LIGHT_ADJ}){0,3}\b(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?(?:light|glow)\s+(?:on|over|across|onto|upon|falling\s+(?:on|onto|across|over)|spilling\s+(?:on|onto|over|across)|catching|filling|flickering\s+(?:on|over|across))\s+[^,.;\u2014]+(?=\s*(?:[,.;]|$))`,
      "gi"
    ),
  },
  // "…, warm lamplight, …" as a phrase of its own.
  {
    kind: "source",
    re: new RegExp(String.raw`(?<=^|,)\s*${LIGHT_ADJ}{0,2}(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)[- ]?(?:light|glow)\s*(?=[,.;]|$)`, "gi"),
  },
  // "a candlelit table", "a lamp-lit desk" — one word, before what it lights. Never "a shoji lantern lit
  // from within by a battery LED" (job 113 scene 39 over the stored films): that took the lantern itself
  // away; nor "lamp-lit from the side" (job 181 scene 10), which left "from the side" hanging.
  {
    kind: "source",
    re: new RegExp(String.raw`\b(?:oil[- ]?)?(?:lamp|candle|lantern|fire|torch)-?lit\s+(?=(?!${NOT_A_NOUN})[a-z])`, "gi"),
  },
  // "with a glowing oil lamp beside it", "beside two candles burning on the shelf" — a lamp the line never
  // named, set beside the subject. A lamp that IS the subject has no word before it and stays. Never
  // after "and": in "coasters, incense holders, and a small lantern" the lantern is one of the things
  // made (job 112 scene 51); never a lamp whose light the words go on about ("under the oil lamp's pale
  // glow" left "'s pale glow" behind, job 144 scene 281); never a lamp that only names another thing
  // ("near the lantern parts" left "on the workbench parts", job 216 scene 48).
  {
    kind: "source",
    re: new RegExp(
      String.raw`,?\s*\b(?:with|beside|next to|near|under)\s+(?:an?|the|one|two|three|several|a few|some)\s+(?:(?:glowing|lit|burning|flickering|small|single|lone|brass|clay|bronze|ceramic|terracotta|old|antique|tall|thin|white|little)\s+){0,3}(?:oil[- ]?)?(?:lamps?|candles?|lanterns?)\b(?!['’]s)(?:\s+(?:burning|glowing|flickering|lit))?(?:\s+(?:softly|warmly|gently|faintly|brightly|dimly))?(?:\s+nearby)?(?:\s+(?:on|beside|by|near|next to|behind|at|in)\s+${POSSESSIVE}\s+[a-z-]+(?:\s+[a-z-]+)?(?=\s*(?:[,.;]|$)))?(?=\s*(?:[,.;:—]|$|\b(?:on|in|at|beside|by|near|behind|under)\b))`,
      "gi"
    ),
  },
  // "a glowing oil lamp" → "an oil lamp": the glow of a light source the line never named. Only before
  // a light source: a glowing lantern that is the thing made, a wood-burning pen's glowing tip, a
  // glowing incense stick, a lantern "glowing softly on a nightstand" — what a thing is doing, its
  // use — stayed over the stored films only because they are not this (jobs 110-175, 245 of them).
  // The source is read (a lamp that is the key thing keeps its glow) and put back.
  {
    kind: "source",
    re: new RegExp(
      String.raw`\bglowing\s+(?<stay>(?:\b${LIGHT_ADJ}){0,2}(?:oil[- ]?)?(?:lamps?|candles?|lanterns?|fires?|torch(?:es)?|hearths?)\b(?!['’]s))`,
      "gi"
    ),
  },
  // "…, a warm glow over the room" — a glow as a clause of its own, or "with a soft golden glow" at a
  // clause's end. Never a glow in the middle of a sentence ("its warm glow diffusing softly through the
  // grid", "creates a gentle glow", "a faint warm glow from a battery LED inside"): taking it out left
  // "its diffusing softly" and "creates." (jobs 110, 127 over the stored films) — and that glow is the
  // light of the thing itself.
  {
    kind: "light",
    re: new RegExp(
      String.raw`${CLAUSE_START}\s*(?:(?:an?|the|its|their)\s+)?${GLOW_ADJ}{1,2}glow\b(?:\s+(?:on|over|across|filling|bathing)\s+[^,.;]+)?${CLAUSE_END}`,
      "gi"
    ),
  },
  { kind: "light", re: new RegExp(String.raw`,?\s*\bwith\s+(?:an?\s+)?${GLOW_ADJ}{1,2}glow\b${CLAUSE_END}`, "gi") },
  // Golden light: "golden low light on distant hills" (job 412 scene 25), "at golden hour", "golden-lit".
  // Only as light — never "a golden retriever", "a golden-brown crust", or wood "in warm amber tones"
  // (job 110 scene 220): a colour is the thing's own.
  { kind: "light", re: /,?\s*\b(?:at|during|in)\s+(?:the\s+)?golden hour\b/gi },
  { kind: "light", re: /\b(?:golden|amber|honeyed)[- ]lit\s+(?=[a-z])/gi },
  {
    kind: "light",
    re: /\b(?:golden|amber|honeyed)(?:[- ]hour)?\s+(?=(?:(?:low|warm|soft|late|evening|morning|afternoon|sun|sunset|sunrise|dawn|dusk|early|hazy|setting)\s+){0,2}(?:light|glow|sunlight|sunshine|haze|rays?|lighting|backlight(?:ing)?)\b)/gi,
  },
  // A lighting style: ", dramatic lighting," as a clause of its own goes whole; inside a sentence only
  // the style word goes ("dulled by studio light" → "dulled by light", never "dulled by,"; jobs 117, 171
  // and 175 over the stored films).
  { kind: "light", re: new RegExp(String.raw`${CLAUSE_START}\s*${STYLE}\s*[- ]?(?:light(?:ing|s)?|lit|shadows?)${CLAUSE_END}`, "gi") },
  { kind: "light", re: new RegExp(String.raw`\b${STYLE}(?:\s*-\s*|\s+)(?=(?:light(?:ing|s)?|lit|shadows?)\b)`, "gi") },
  { kind: "light", re: /\b(?:perfectly|beautifully|dramatically|professionally)\s+(?=lit\b)/gi },
  // A camera effect, with the "with" that brought it ("photographed with shallow depth of field to …").
  {
    kind: "light",
    phrase: true,
    re: /,?\s*(?:\b(?:with|and|using)\s+(?:an?\s+)?)?\b(?:lens flares?|sun flares?|god rays|light rays|(?:shafts|beams) of (?:golden |warm |soft )?(?:sun)?light|bokeh|shallow depth of field|(?:dark,?\s+)?moody corners|deep shadows|vignett(?:e|ing))\b/gi,
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
    re: new RegExp(
      String.raw`\b(?:cinematic|dramatic|moody|epic|stunning|breathtaking|ethereal|atmospheric|hyper-?realistic|photo-?realistic|ultra-?detailed|highly detailed|high-end|award-winning|editorial)\s+(?=(?!${NOT_A_NOUN})[a-z])`,
      "gi"
    ),
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

/**
 * Words ruled out stay: "no golden light" lost its "golden" and asked for "no light", and "casting no
 * dramatic shadows" became "casting no." (jobs 146 and 131 over the stored films). Up to four words
 * back in the same clause — never across a comma: "no hands visible, warm golden glow" is two clauses
 * and the glow is not ruled out (a list "no lamps, candles or golden light" keeps its last item by its
 * "or", `DEGREE`).
 */
const RULED_OUT =
  /\b(?:no|not|never|without|nor|neither|avoid(?:s|ing)?|instead of|rather than|free of|none of)\b(?:\s+[a-z'’-]+){0,4}\s*$/i;
/**
 * A word whose partner it is: a degree word ("the more ornate farmhouse style" never becomes "the more
 * farmhouse style"), or one side of an "and" or "or" ("the matte and gleaming surfaces" left "the matte
 * and surfaces", job 175 scene 283) — before it, or after it ("working by lamplight or window light"
 * left "working or window light", job 141 scene 155).
 */
const DEGREE = /\b(?:more|most|less|least|very|so|too|quite|rather|how|as|and|or|nor)\s*$/i;
const PAIRED_AFTER = /^\s*(?:or|and|nor|that|which|who|whose)\b/i;
/** A clause of its own starts after a stop (or the start). */
const CLAUSE_BEFORE = /(?:^|[,.;:\u2014(])\s*$/;
/** What needs the noun phrase after it: "casting deep shadows" never becomes "casting". */
const NEEDS_AN_OBJECT =
  /\b(?:casting|creating|throwing|showing|adding|catching|giving|casts|creates|throws|shows|adds|catches|gives|of|by|in|under|beneath|through|into|from|for|to|the|an?|its|their|his|her)\s*$/i;
/** A phrase match that carries its own lead-in (a comma, or the word that brought it) needs nothing before it. */
const OWN_LEAD = /^\s*(?:,|\b(?:with|and|using)\b)/i;

/** Where a rule took words out, so the article before it is fitted to the word now after it. */
const GONE = "\u0001";

/**
 * The spaces, commas and articles a removal leaves behind, put right: "a marble throne" → "a throne",
 * "an ornate hall" → "a hall". Only an article right before a removal changes — "a user" or "an hour"
 * anywhere else are never touched. A sentence whose opening words went starts with a capital again
 * ("…a wooden project. Shallow depth of field, natural indoor light." → "…a wooden project. Natural
 * indoor light.", job 152 scene 273 over the stored films).
 */
function tidy(text: string, original: string): string {
  let out = text
    .replace(/\b([Aa])n?\s*(?:\u0001\s*)+(?=([A-Za-z]))/g, (_m, a: string, next: string) =>
      `${a}${/[aeiou]/i.test(next) ? "n" : ""} `
    )
    // A whole sentence gone leaves its full stop beside the one before ("…in even rows.. Cookstove", job 134 scene 63).
    .replace(/([.!?;:])\s*(?:\u0001\s*)+[.!?;:]/g, "$1")
    .replace(/([.!?])\s*(?:\u0001\s*)+[,;]?\s*([a-z])/g, (_m, p: string, c: string) => `${p} ${c.toUpperCase()}`)
    .replace(/\s*\u0001\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/,\s*([.;:])/g, "$1")
    .replace(/([.;:])\s*,/g, "$1")
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
    out = out.replace(rule.re, (m: string, ...rest: unknown[]) => {
      // replace() hands the captures, then the offset, the whole text and (with named groups) the groups.
      const at = rest.findIndex(x => typeof x === "number");
      const offset = rest[at] as number;
      const whole = rest[at + 1] as string;
      const groups = rest[at + 2] as Record<string, string | undefined> | undefined;
      if (rule.kind === "source" && keep.named.length) return m;
      const before = whole.slice(Math.max(0, offset - 80), offset);
      // A match that starts at its own comma is a clause of its own: a "no" before it is another clause's.
      const ruledOut = !/^\s*,/.test(m) && RULED_OUT.test(before);
      if (ruledOut || DEGREE.test(before) || PAIRED_AFTER.test(whole.slice(offset + m.length))) return m;
      if (rule.phrase && !OWN_LEAD.test(m) && NEEDS_AN_OBJECT.test(before)) return m;
      if (rule.clause && !OWN_LEAD.test(m) && !CLAUSE_BEFORE.test(before)) return m;
      const words = Array.from(m.matchAll(TRIGGER)).map(t => t[1]);
      const by = rule.kind === "thing" ? keep.thing : keep.light;
      if (words.some(w => says(by, w))) return m;
      return `${GONE}${groups?.stay ?? ""}`;
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

/**
 * The light that stays named when the picture's words stay as they are (an operator's own words,
 * rendered as typed): `keep.named` and whatever light those words name, each once — so the clause
 * never refuses the candle the words themselves ask for. Pure.
 */
export function namedLightKept(keep: PlainLookKeep, ...words: (string | undefined)[]): string[] {
  const out = [...keep.named];
  for (const w of namedLight(...words)) if (!out.some(o => o.toLowerCase() === w.toLowerCase())) out.push(w);
  return out;
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

