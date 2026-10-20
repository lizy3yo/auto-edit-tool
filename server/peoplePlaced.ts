/**
 * A PERSON IS PLACED BY WHAT THEY DO, NEVER BY THE CAMERA (2026-10-20, round 16, the verification
 * films on the round-15 code). Round 15 moved every face rule onto the CAMERA — it stands beside them
 * and a little behind, over the shoulder, from the row behind (`NATURAL_POSE_CAMERA_CLAUSE`), and
 * people who talk or hand something over turn toward each other (`FACING_EACH_OTHER_CLAUSE`) — but the
 * picture WRITERS still placed the camera relative to the ROOM in a person picture's own words, and
 * the words won. The picture model kept the room's view and turned the people to fit it:
 * - job 417 scene 2, "Two passengers seated side by side in an airline seat row, blue upholstered
 *   seats with headrests, narrow aisle visible behind them": to show the room behind them the camera
 *   faced them, so to keep their faces out it sat them backwards, facing their own seat backs;
 * - job 417 scene 8, "A passenger seated in row fourteen glancing forward toward an empty seat row
 *   visible ahead in the cabin": the row ahead came back front-on, facing him;
 * - job 421 scene 28, "a passenger seen from behind standing at the galley speaking to a flight
 *   attendant by the counter": a camera behind her, facing the counter, left one way to keep both
 *   faces out — both backs to the camera, talking side by side to the wall.
 * Where the camera stands is the picture rules' job; a description says what the people DO and where
 * they ARE. The writers — the shot list, the line check and its panel pass, the same-topic groups and
 * the prompt writer — are told so in one wording (`PEOPLE_PLACED_RULE`), and the code takes out what
 * a description still says (`withoutRoomPlacement`), right before the prompt, in a picture of someone
 * whose face the camera keeps out. Pure — unit-tested.
 */

/**
 * The rule as the picture writers read it — one wording, so they cannot disagree. No place of any one
 * channel: the cases are in the tests.
 */
export const PEOPLE_PLACED_RULE =
  "PEOPLE ARE PLACED BY WHAT THEY DO, NEVER BY THE CAMERA: a picture of a person says what they are " +
  "doing and where they are — sitting in their seat, standing at the counter, kneeling by the bed — " +
  "and people who talk, listen or hand something to each other are written turned to each other " +
  "(\"a woman handing a parcel across the counter to a clerk\"). Where the camera stands, and how " +
  "every face stays out of the picture, is set by the picture rules, never by the description. So " +
  "never place the room around a person who sits or works by where the camera would see it: no " +
  "wall, window, door, shelf, counter, aisle or row of seats \"behind\" them, \"ahead of\" them or " +
  "\"in front of\" them, nothing \"visible behind\" or \"visible ahead\" — and never write \"seen " +
  "from behind\", \"from behind\" or \"backs to the camera\" of people who talk to or hand something " +
  "to each other. Written into the description, the camera's place wins and the people are turned " +
  "round to fit it: a pair sitting backwards in their seats so the room \"behind them\" shows, two " +
  "people talking side by side to a wall.";

/**
 * The room, or a part of it, a description can place by the camera — words any room has, none of
 * one channel's. Never a table, desk or bench a person works at — "the laptop on the desk in front
 * of her" is her work, which she faces — and never a thing that is not the room ("a child hiding
 * behind her", "a cart in front of him").
 */
const ROOM_PART = String.raw`(?:rooms?|interior|cabin|aisles?|rows?(?:\s+of\s+seats)?|seats?|seat\s*backs?|pews?|booths?|walls?|windows?|doors?|doorways?|entryway|hallways?|halls?|corridors?|counters?|shelf|shelves|shelving|cupboards?|cabinets?|kitchen|stairs|staircase|ceiling|curtains?|blinds|background)`;
/** What may stand between the room and its direction: "visible", "soft", "in soft focus". */
const SEEN_AS = String.raw`(?:\s+(?:clearly|softly|just|partly|dimly|faintly))?(?:\s+(?:visible|seen|showing|in\s+view|in\s+(?:soft\s+)?focus|out\s+of\s+focus|blurred|soft|lit))?`;
/**
 * The person the room is placed by: a pronoun, or a plain word for people. "her" only on its own —
 * "behind her head" is a body part, never the room.
 */
const PERSON = String.raw`(?:them|him|you|her(?=\s*(?:[,.;:!?)]|$|\s+(?:and|as|while|with|in|on|at|where|visible|soft|blurred|out)\b))|(?:the|both)\s+(?:[a-z-]+\s+){0,2}?(?:man|men|woman|women|person|people|pair|couple|two|group))`;
/**
 * A room part that is WHERE someone or something is, never where the camera looks: the object of a
 * place word ("a man sitting in the seat behind her", "the cart rolling down the aisle behind her" —
 * stored film 410 scene 3 — "on the screen in the seat back in front of her", "leaning against the wall
 * behind him") or of a deed ("a child kicking the seat in front of him"). Its "behind her" says which
 * seat, which wall: taken out, the person moves into her own seat, the kick lands on his own seat — and
 * where people are is what `PEOPLE_PLACED_RULE` tells the writers to say. "with" is no such word: "with
 * pale wall behind them" sets the room behind them for the camera, like a clause of its own ("…,
 * narrow aisle visible behind them", job 417 scene 2).
 */
const DET = String.raw`(?:a|an|the|their|his|her|its|one|that|this|my|your|our)`;
const ROOM_IS_WHERE =
  String.raw`(?<!\b(?:in|into|inside|on|onto|at|from|to|toward|towards|down|up|along|across|through|under|over|by|near|past|of|beside|between|against|around|behind)\s+(?:${DET}\s+)?(?:[a-z-]+\s+){0,3}` +
  String.raw`|\b(?!(?:with|and|or|as|is|was|has|this|its|his)\b)[a-z]+(?:s|ed|ing)\s+${DET}\s+(?:[a-z-]+\s+){0,3})`;
/** "…, narrow aisle visible behind them" → "…, narrow aisle visible": the room stays, its place goes. */
const ROOM_BY_PERSON = new RegExp(
  String.raw`${ROOM_IS_WHERE}\b(${ROOM_PART})(${SEEN_AS})\s+(?:(?:right|just|directly|far|close)\s+)?(?:behind|ahead\s+of|in\s+front\s+of)\s+${PERSON}(?![a-z-])`,
  "gi"
);
/**
 * A person GOING somewhere: the place ahead is where they go, and the camera behind them is how one
 * walks into a picture — "walking down the hall, the door ahead of her" keeps its words. Never riding
 * or driving: whoever rides a bus or a train, or drives, SITS, in a seat that faces one way — job 417
 * scene 2's very case — so "a passenger riding the bus, the aisle behind her" is placed like any seat.
 */
const GOING =
  /\b(?:walk(?:s|ing|ed)?|stroll(?:s|ing|ed)?|hik(?:e|es|ing)|run(?:s|ning)|jog(?:s|ging)|wander(?:s|ing|ed)?|march(?:es|ing)?|climb(?:s|ing)?|head(?:s|ing|ed)\s+(?:out|off|down|up|into|in|toward|towards|for|back|home|away|along)|leav(?:es|ing)|cycl(?:es|ing)|going|mov(?:es|ing)\s+(?:down|along|through|toward|towards|away))\b/i;

/**
 * A seat a person sits in or on. Never a bench, a row or a stool: "the charred wood sits on the clear
 * bench surface" (stored film 199) and "jars sit in a row on the shelf" are things.
 */
const SEAT = String.raw`(?:seats?|chairs?|armchairs?|pews?|booths?|sofas?|couch(?:es)?|recliners?|wheelchairs?)`;
/**
 * A PERSON sitting or kneeling — in a seat that faces one way, where the room "behind" or "ahead"
 * says which way the camera looks, and so which way the seat is turned. A THING that sits or lies
 * somewhere is no one seated: "the charred wood sits on the clear bench surface, garage wall behind"
 * (stored film 199) and "a thread spool sits nearby" keep the workshop where it is.
 */
const SEATED = new RegExp(
  [
    String.raw`\bseated\b|\bkneel(?:s|ing)?\b|\bknelt\b`,
    String.raw`\b(?:sit|sits|sitting|sat)\s+(?:(?:alone|together|quietly|still|side\s+by\s+side|upright|back)\s+)?(?:in|on|at)\s+(?:(?:a|an|the|their|his|her|one|its)\s+)?(?:[a-z-]+\s+){0,3}?${SEAT}\b`,
    String.raw`\b(?:in|into)\s+(?:a|an|the|their|his|her|one)\s+(?:[a-z-]+\s+){0,3}?(?:seats?|pews?|booths?|armchairs?|wheelchairs?|recliners?|rocking\s+chairs?)\b`,
    String.raw`\b(?:man|men|woman|women|person|people|someone|she|he|they|who|couple|pair|both|passengers?|guests?|customers?)\s+(?:(?:is|are|was|were)\s+)?(?:sitting|sits|sat)\b`,
  ].join("|"),
  "i"
);
/** "an empty seat row visible ahead in the cabin" → "an empty seat row visible in the cabin". */
const SEEN_DIRECTION = /\b(visible|seen|in\s+view|showing)\s+(?:ahead|behind)\b(?!\s+(?:of|the|a|an|her|his|their|them|him|it|its|you)\b)/gi;
/** "Dark windows behind, …" → "Dark windows, …": the room, with only a direction after it. */
const ROOM_THEN_DIRECTION = new RegExp(String.raw`\b(${ROOM_PART})\s+(?:behind|ahead)(?=\s*(?:[,.;:]|$))`, "gi");
/** "Empty rows beside and behind." → "Empty rows beside." */
const AND_DIRECTION =
  /\b(beside|around|nearby|alongside)\s+and\s+(?:behind|ahead)\b|\b(?:behind|ahead)\s+and\s+(beside|around|nearby|alongside)\b/gi;

/**
 * People who TALK, LISTEN OR HAND SOMETHING to each other. "Hand" only as a verb: never "bare hands",
 * "hand in hand" or "left-handed".
 */
const DEALING =
  /\b(?:talk(?:s|ing|ed)?|speak(?:s|ing)?|spoke|chat(?:s|ting|ted)?|convers\w*|ask(?:s|ing|ed)?|tell(?:s|ing)|told|listen(?:s|ing|ed)?|greet(?:s|ing|ed)?|explain(?:s|ing|ed)?|(?<!-)hand(?:ed|ing)|hands?\s+(?:over|back|across)|handover|pass(?:es|ing|ed)?\b[^,.;]{0,40}\bto\b|giv(?:e|es|ing)|gave|offer(?:s|ing|ed)?|serv(?:e|es|ing|ed)|exchang\w*|show(?:s|ing|ed)?\b[^,.;]{0,40}\bto\b)\b/i;
/**
 * The camera behind them, said as a view — never light from behind ("lit from behind", "sunlight
 * from behind") nor a place someone comes out from ("stepping out from behind the counter"). The whole
 * view goes, with what it was paired with: "seen from behind or from the side" — the old wording of
 * the writers' own rule — left "a passenger or from the side, speaking to…", and "seen from behind at an
 * angle" left two people "talking at an angle".
 */
const FROM_BEHIND =
  /,?\s*(?:(?:and|or)\s+)?(?:both\s+|each\s+)?(?<!\b(?:light|lit|lighting|glow|sun|sunlight|daylight|lamp|backlit|coming|falling|streaming|shining|out)\s)(?:(?:seen|viewed|shown|shot|photographed|framed)\s+)?from\s+behind\b(?!\s+(?:the|a|an|her|his|their|its|this|that|my|your|one)\b)(?:\s*,?\s*(?:or|and)\s+(?:from\s+|to\s+)?(?:the\s+|one\s+)?sides?\b)?(?:,?\s+(?:and\s+)?(?:slightly\s+|a\s+little\s+|partly\s+)?(?:above|at\s+an\s+angle|over\s+(?:the|one|her|his|their)\s+shoulders?|to\s+(?:the|one)\s+side)\b)?/gi;
/** "…, their backs to the camera", "with her back to the camera", "…, back to the camera". */
const BACKS_TO_CAMERA =
  /,?\s*(?:with\s+)?(?:(?:their|his|her|both)\s+|(?<=,\s*))backs?\s+(?:turned\s+)?to\s+(?:the\s+)?(?:camera|lens|viewer)\b/gi;

/** The words tidied where a phrase came out: no double spaces or commas, no comma before a stop. */
function tidy(text: string, was: string): string {
  const out = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.;:])/g, "$1")
    .replace(/^\s*[,;:]\s*/, "")
    .replace(/([.;:])\s*,/g, "$1")
    .trim();
  return /^[A-Z]/.test(was.trim()) && /^[a-z]/.test(out) ? out.charAt(0).toUpperCase() + out.slice(1) : out;
}

/**
 * A description of a person with the camera's place taken out (`PEOPLE_PLACED_RULE`):
 * - the room placed by the person — "narrow aisle visible behind them" → "narrow aisle visible",
 *   "the aisle behind her" → "the aisle" — unless they are going somewhere, or the room part is where
 *   someone or something IS ("sitting in the seat behind her", "kicking the seat in front of him",
 *   `ROOM_IS_WHERE`);
 * - for a person sitting, the room placed by the camera with no person named — "an empty seat row
 *   visible ahead in the cabin" → "an empty seat row visible in the cabin", "Dark windows behind" →
 *   "Dark windows";
 * - and, when two or more people are drawn (`together`) and they talk to or hand something to each
 *   other, "seen from behind" and "backs to the camera" — "a passenger seen from behind standing at
 *   the galley speaking to a flight attendant" → "a passenger standing at the galley speaking to a
 *   flight attendant".
 * The room itself stays in the picture: only where the camera would see it goes. One person seen
 * from behind keeps it ("a woman seen from behind walking away down the hall"), and so does a place
 * that is no part of the room ("the laptop on the desk in front of her"). Untouched words come back
 * byte-identical. Pure.
 */
export function withoutRoomPlacement(text: string, together: boolean): string {
  if (!text) return text;
  let out = text;
  if (!GOING.test(out)) out = out.replace(ROOM_BY_PERSON, "$1$2");
  if (SEATED.test(out))
    out = out.replace(SEEN_DIRECTION, "$1").replace(ROOM_THEN_DIRECTION, "$1").replace(AND_DIRECTION, "$1$2");
  if (together && DEALING.test(out)) out = out.replace(FROM_BEHIND, "").replace(BACKS_TO_CAMERA, "");
  return out === text ? text : tidy(out, text);
}
