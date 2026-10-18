/**
 * The host at work in their own b-roll (2026-09-28, the operator: "if we have b-roll image doing
 * something it should be our character"; "everything should be adaptable to every channel").
 *
 * `deriveHostLook` reads ONE plain description off the host's own photo — hair, head covering,
 * clothes and colours, build — once per video, so any channel (and any channel added later) gets
 * its host into b-roll with no setup. `markHostBroll` then marks every picture that shows someone
 * doing the work as the host (`brollHostLook` for the prompt, `brollHostRef` for the image
 * reference); `buildStillPrompt` draws them from behind or the side with the face never shown —
 * the picture model draws a face a little differently every time, and a b-roll face that did not
 * match the talking host would read as someone else. A split's picture half stays person-free
 * (the host is already on the other half).
 */
import sharp from "sharp";
import type { LongformInputParams, RecurringPerson, StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { presignOwnBucketUrl } from "./storage";

const HOST_LOOK_MODEL = () => process.env.HOST_LOOK_MODEL || "claude-sonnet-5";

// Age range and skin tone are asked for (2026-10-15): a host picture that shows hands, a neck or a
// face — a make-up step on the face — must be that person's, and without them the picture model drew
// Scarlett's routine as "a different woman", younger and smoother. Still never a name or ethnicity.
const HOST_LOOK_SYSTEM =
  "You describe a person's visible appearance for a picture generator that will draw them doing " +
  "a task, usually from the side or behind. Write ONE line of 18-36 plain words: an age range in " +
  "plain words (in his fifties, in her late sixties), skin tone (fair, olive, tan, deep brown), " +
  "build, hair (colour, length, style) and any head covering, every piece of clothing with its " +
  "colour, anything worn over it (an apron, a shawl). Never the expression; never a name, an " +
  "ethnicity or a guess about who they are; never the background. Example: a slim woman in her " +
  "fifties with fair skin and auburn hair under a sheer white head covering, a plain blue dress " +
  "with elbow sleeves and a black apron. Output only the line.";

/** One line describing the host in `photoUrl`, or "" when it cannot be read (the film goes on). */
export async function deriveHostLook(photoUrl: string): Promise<string> {
  try {
    const resp = await fetch(await presignOwnBucketUrl(photoUrl), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`photo ${resp.status}`);
    const small = await sharp(Buffer.from(await resp.arrayBuffer()))
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const r = await invokeClaude({
      systemPrompt: HOST_LOOK_SYSTEM,
      userMessage: "Describe this person for the picture generator.",
      imageInput: { base64: small.toString("base64"), mediaType: "image/png" },
      maxTokens: 4000,
      model: HOST_LOOK_MODEL(),
      step: "Host look",
    });
    return cleanHostLook(r.text);
  } catch (err: any) {
    console.warn(`[HostLook] could not read the host's look: ${err?.message ?? err}`);
    return "";
  }
}

/** The first plain line of the model's answer, no quotes or trailing full stop, ≤ 40 words. Pure. */
export function cleanHostLook(raw: string): string {
  const line = (raw ?? "")
    .split("\n")
    .map(l => l.trim())
    .find(l => l.length > 0) ?? "";
  return line
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\.$/, "")
    .split(/\s+/)
    .slice(0, 40)
    .join(" ");
}

/** A word describing a thing, never a place word ("the dressing room mirror", not "the chest near mirror"). */
const MODIFIER_WORD = String.raw`(?:(?!(?:near|by|beside|on|in|at|over|under|with|and|or|to|from|behind|across|along|against|above|below)\b)[\w-]+\s+)`;

/**
 * A shot description with its MIRRORS taken out. A picture of the host must never show the face,
 * and a mirror in front of them has to: Scarlett's 3-min test (job 234) asked for "her neck and
 * chin catching light in the dressing room mirror" and got a reflection of her BACK (0:19) and a
 * reflection sliced off at the chin (1:14). "…in the mirror" goes; any other mirror becomes a
 * plain wall. The words before "mirror" never run across another place word: "a necklace hanging on
 * the chest near mirror" (job 223 scene 4) became "hanging on the wall" — the chest went with it.
 * Pure — unit-tested.
 */
export function withoutMirrors(text: string): string {
  return text
    .replace(
      new RegExp(
        String.raw`,?\s*(?:reflected\s+)?\b(?:in|into|at|before|facing|toward|towards|near)\s+(?:(?:a|an|the|her|his|their)\s+)?${MODIFIER_WORD}{0,3}mirrors?\b`,
        "gi"
      ),
      ""
    )
    .replace(new RegExp(String.raw`\b(?:a|an|the)\s+${MODIFIER_WORD}{0,3}mirrors?\b`, "gi"), "the wall")
    .replace(/\bmirrors?\b/gi, "wall")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .trim();
}

/**
 * Clothing, shoes or jewellery shown AS WORN or in use, with no word for the wearer (2026-10-11,
 * practice jobs 358 and 362: "a coat sleeve brushing past grocery shelves" came back as a sleeve
 * with no arm in it, "shoes stepping on asphalt" as empty shoes in a car park, "a necklace sitting
 * high on the chest, worn over a plain sweater" as a sweater holding a body's shape with nothing in
 * its collar). Read as person-free, such a picture got the no-people rule, so the picture maker
 * drew the thing filled out by nobody. Worn or in use means someone is wearing it. A thing that
 * hangs, lies folded or sits on a stand names no body and does not match ("a chest of drawers" is
 * furniture, "worn soles" is wear).
 */
export const WORN_ON_BODY =
  /\bworn (?:on|over|with|under|around|at|high|low|long|open|loose|together)\b|\b(?:sit(?:s|ting)?|rest(?:s|ing)?|l(?:ies|ying)|hang(?:s|ing)?|fall(?:s|ing)?|drap(?:ed|es|ing)) (?:(?:high|low|flat|straight|just|right|well|down) )*(?:on|at|against|across|over|below|above|around) (?:(?:the|her|his|their|a) )?(?:chest(?! of)|shoulders?|waist|hips?|lap|chin|jaw|throat|ankles?|body|bust)\b|\b(?:under|beneath|below) (?:the|her|his|their) chin\b|\b(?:shoes?|boots?|sneakers?|slippers?|sandals?|sleeves?|cuffs?|pant legs?|trouser legs?|coat|jacket)\b[^.,;]{0,50}\b(?:stepping|walking|striding|brushing (?:past|against)|reaching)\b/i;

/** The person words themselves (the notes are under `SHOWS_PERSON`). */
const PERSON_WORDS =
  /\b(hands?|fingers?|fingertips?|host|she|he|her|his|herself|himself|someone|a person|a woman|a man|wearing|worn by|collarbone|neck|wrists?|earlobes?|held (?:up|out|near|against|over|to|above|beside|in front)|hold(?:s|ing) (?:up|out)|in use|scalp|skin|nails|fingernails|forehead|cheeks?|eyelashes|eyebrows?|hairline|strands?|hair(?!\s*(?:dryer|brush|clip|tie|spray|band|pin|comb|product|net|cut(?:ting)? scissors)))\b/i;

/**
 * The person's OWN face or a part of it, with a possessive ("her face", "your lips", "under the
 * eyes"). A person is in such a picture, so it is the host's (2026-10-15, the review: Scarlett's
 * concealer video showed "a different woman" — "under the eyes" named no person and was drawn with
 * no host photo). A possessive is required for the bare words so "the face of the board" or "a
 * clock face" is never a person. This alone does NOT show the face (`FACE_ROUTINE` does).
 */
export const OWN_FACE =
  /\b(?:her|his|your|their|my|own)\s+(?:face|eyes|eyelids|lids|lips|chin|jawline|cheekbones?|under-?eyes?|complexion)\b|\bunder(?:-|\s+)(?:(?:the|her|his|your|their)\s+)?eyes\b/i;

/**
 * A make-up or skin-care STEP on the face — an action on a product, or a product on a part of the
 * face. Only these pictures show the host's face (`scene.hostFaceShown`): a routine on the face
 * cannot be shown with it turned away. "her face lit by the glow of a phone" is not a step (Dale's
 * job 372 test, 2026-10-15), and "a tube of concealer on the counter" is a thing.
 */
export const FACE_ROUTINE =
  /\b(?:appl(?:y|ies|ying|ied)|dab(?:s|bing|bed)?|blend(?:s|ing|ed)?|pat(?:s|ting|ted)?|tap(?:s|ping|ped)?|sweep(?:s|ing)?|swip(?:e|es|ing|ed)|lin(?:e|es|ing|ed)|fill(?:s|ing|ed)?|brush(?:es|ing|ed)?|smooth(?:s|ing|ed)?|press(?:es|ing|ed)?|set(?:s|ting)?)\b[^.;]{0,50}?\b(?:concealer|foundation|blush|bronzer|lipstick|lip liner|lip colou?r|lip balm|mascara|eyeliner|eye ?shadow|setting powder|face powder|primer|highlighter|serum|moisturi[sz]er|face cream|eye cream|brow pencil|brow gel)\b|\b(?:concealer|foundation|blush|bronzer|lipstick|mascara|eyeliner|eye ?shadow|primer|highlighter|serum|moisturi[sz]er)\b[^.;]{0,40}?\b(?:on|under|over|along|across|into)\s+(?:the|her|his|your|their)\s+(?:face|eyes?|lids?|eyelids?|lips|cheeks?|cheekbones?|lashes|brows?|skin|under-?eyes?|jawline)\b/i;

/** Words in a shot description that mean a person is in it, doing something. */
export const SHOWS_PERSON = new RegExp(
  `${PERSON_WORDS.source}|${WORN_ON_BODY.source}|${OWN_FACE.source}|${FACE_ROUTINE.source}`,
  "i"
);
// A BODY PART is always on a person (2026-10-02, Diane's job 309: "dry hair at the bare sink counter"
// drew a head of hair lying on the counter, and "a brush spreading gloss through silver hair" drew
// hair hanging from nothing — read as person-free, those pictures got NO_FIGURES_SUFFIX, which bans
// hair, so the picture maker drew the hair loose). Hair, a scalp, skin, nails or a face now make the
// picture the host's, from behind or the side. A hair dryer, brush or clip is a thing, not hair.
// "Host wearing a long chain" and "a necklace resting at the collarbone" are the host too:
// Scarlett's job 244 knew only "the host", so those pictures got no host look, no one-body rule
// and kept their mirror. ("neck" is whole-word only, so a crewneck or a neckline is not a person.)
// "held near the doorframe" needs a holder: Norbert's 3-min test (job 238, 0:32) asked for a
// "cordless drill … held near the doorframe", read it as person-free, and got a drill floating
// against the frame with no hand on it.

// ─── Who is in the picture ───────────────────────────────────────────────────────────────

/**
 * Nouns for a person by WHAT THEY ARE to the story — a customer, a passenger, a farmer, a baby, a
 * relative. In a picture they are someone else, never the host (`someoneElse`). General words only:
 * the people any channel's lines talk about, never one channel's cast. Makers and hobby words
 * (woodworker, quilter, gardener) are left out on purpose — on a channel about the craft that is
 * the host — and a trade the host gives themself is the host for that video (`selfRolesOf`).
 */
const ROLE_NOUNS = [
  // buying, selling, serving, visiting
  "customer", "buyer", "shopper", "client", "patron", "guest", "visitor", "stranger", "neighbour", "neighbor",
  "friend", "passenger", "traveller", "traveler", "tourist", "commuter", "attendant", "clerk", "cashier",
  "waiter", "waitress", "bartender", "barista", "receptionist", "recipient", "salesman", "saleswoman",
  "salesperson", "merchant", "landlord", "tenant", "roommate",
  // care, trades and services
  "nurse", "doctor", "dentist", "pharmacist", "veterinarian", "caregiver", "nanny", "stylist",
  "hairdresser", "hairstylist", "barber", "plumber", "electrician", "contractor", "technician", "mechanic",
  "inspector", "handyman", "repairman", "locksmith", "courier", "mailman", "postman", "pilot",
  "officer", "policeman", "policewoman", "cop", "firefighter", "fireman", "soldier", "sailor", "farmer",
  "rancher", "fisherman", "hunter", "miner", "labourer", "laborer", "teacher",
  "student", "apprentice", "employee", "coworker", "co-worker", "colleague", "volunteer", "manager",
  "lawyer", "banker", "accountant", "businessman", "businesswoman", "burglar", "thief", "intruder",
  "robber", "prowler", "criminal", "scammer",
  // a story's people
  "senator", "emperor", "king", "queen", "prince", "princess", "knight", "monk", "priest", "nun",
  "pastor", "philosopher", "scholar", "scribe", "servant", "official", "bride", "groom",
  // children and family
  "baby", "infant", "toddler", "child", "kid", "teen", "teenager", "girl", "boy", "mother", "father",
  "mom", "mum", "dad", "mama", "parent", "grandparent", "grandmother", "grandfather", "grandma",
  "grandpa", "grandchild", "grandkid", "grandson", "granddaughter", "husband", "wife", "spouse", "son",
  "daughter", "sister", "brother", "sibling", "aunt", "uncle", "cousin", "niece", "nephew", "boyfriend",
  "girlfriend",
];
/** A person with no role: whether they are the host is left to the planner and the line check. */
const GENERIC_NOUNS = ["man", "woman", "person", "people", "lady", "gentleman", "guy", "folks"];
/** Words naming more than one person at once. */
const GROUP_NOUNS = ["couple", "crowd", "family"];
/**
 * Words for the host themself: the host, an owner, the one at the stall. ("maker", "seller" and
 * "viewer" are not here: "a coffee maker on the counter", "the best seller on the shelf".)
 */
const SELF_NOUNS = ["host", "owner", "homeowner", "narrator", "presenter", "crafter", "vendor"];
/**
 * A word before that makes an ambiguous one a person: "family members", "a travel agent", "a
 * delivery driver". Without it the word is a thing — a bare "driver" in a picture is the TOOL ("an
 * impact driver", "a drill driver", "an exterior screw and a driver": every stored use, jobs 143,
 * 162 and 225) — unless it owns a body part ("the driver's hands on the wheel").
 */
const COMPOUNDS: Record<string, RegExp> = {
  member: /^(?:family|crew|team|staff|church|club)$/,
  agent: /^(?:travel|estate|gate|ticket|booking|insurance|border|customs)$/,
  carrier: /^(?:mail|letter)$/,
  driver:
    /^(?:truck|bus|taxi|cab|delivery|race|racing|rideshare|getaway|lorry|van|train|tractor|school|designated|student|teen|new|older|elderly|young|other|woman|man|lady|careless|distracted|drunk|tired)$/,
};

const IRREGULAR_PLURALS: Record<string, string> = {
  man: "men", woman: "women", child: "children", wife: "wives", thief: "thieves",
  gentleman: "gentlemen", policeman: "policemen", policewoman: "policewomen", fireman: "firemen",
  handyman: "handymen", repairman: "repairmen", mailman: "mailmen", postman: "postmen",
  salesman: "salesmen", saleswoman: "saleswomen", fisherman: "fishermen", businessman: "businessmen",
  businesswoman: "businesswomen", grandchild: "grandchildren", person: "persons",
};
const pluralOf = (n: string) =>
  IRREGULAR_PLURALS[n] ??
  (/(?:ss|ch|sh|x)$/.test(n) ? `${n}es` : /[^aeiou]y$/.test(n) ? `${n.slice(0, -1)}ies` : `${n}s`);

type NounKind = "role" | "generic" | "group" | "self";
/** Every form (singular and plural) of every person noun → its singular and kind. */
const PERSON_NOUN = new Map<string, { lemma: string; kind: NounKind; plural: boolean }>();
for (const [list, kind] of [
  [ROLE_NOUNS, "role"],
  [GENERIC_NOUNS, "generic"],
  [GROUP_NOUNS, "group"],
  [SELF_NOUNS, "self"],
] as const) {
  for (const n of list) {
    const alwaysPlural = n === "people" || n === "folks";
    PERSON_NOUN.set(n, { lemma: n, kind, plural: alwaysPlural });
    if (!alwaysPlural) PERSON_NOUN.set(pluralOf(n), { lemma: n, kind, plural: true });
  }
}
for (const n of Object.keys(COMPOUNDS)) {
  PERSON_NOUN.set(n, { lemma: n, kind: "role", plural: false });
  PERSON_NOUN.set(pluralOf(n), { lemma: n, kind: "role", plural: true });
}

const FEMALE = new Set(
  ("woman women lady ladies girl girls mother mom mum mama wife wives daughter sister aunt niece " +
    "grandmother grandma granddaughter waitress bride queen princess nun policewoman saleswoman " +
    "businesswoman girlfriend female").split(" ")
);
const MALE = new Set(
  ("man men gentleman gentlemen guy guys boy boys father dad husband son brother uncle nephew " +
    "grandfather grandpa grandson groom king prince monk priest policeman salesman businessman fireman " +
    "handyman repairman mailman postman fisherman boyfriend male").split(" ")
);
/** A part of a person's body — what makes "a shopper's hand" a person and "a buyer's porch" not. */
const BODY = new Set(
  ("hand hands finger fingers fingertip fingertips thumb thumbs palm palms wrist wrists arm arms elbow " +
    "elbows shoulder shoulders back head hair face faces eye eyes lap knee knees leg legs foot feet ankle " +
    "ankles toe toes neck collarbone chest body torso silhouette figure profile hip hips waist cheek " +
    "cheeks lips chin nose").split(" ")
);
/** A body word naming a THING when this follows it: "a customer's back door", "a guest hand towel". */
const BODY_COMPOUND =
  /^(?:doors?|porch|yard|gate|steps|stairs|towels?|truck|cart|cream|lotion|soap|wash|lamp|lights?|rest|board|desk|pads?|bags?|mirror|brush|dryer|warmer|piece|rail|seat|cover|stand)$/;
/** Words that follow a person noun when the noun IS the person ("a customer at the table"). */
const FOLLOW = new Set(
  ("at in on with without from behind beside by near over under across along through into onto inside " +
    "outside against toward towards around among between beneath below above up down out off past after " +
    "before while as and than during to beyond here there next opposite facing alone together nearby " +
    "again just still is are who whose " +
    "seated seen shown viewed framed photographed dressed wrapped bundled tucked curled bent hunched " +
    "perched gathered huddled crouched knelt lit silhouetted turned caught pictured blurred asleep awake " +
    "holds sits stands walks leans looks reaches picks pays hugs waits gestures smiles laughs browses " +
    "scrolls carries opens kneels turns rests lies sleeps plays reads writes talks speaks asks points " +
    "steps works cooks eats drinks wears tries buys sells shops watches checks takes gives hands passes " +
    "sets puts places pulls pushes lifts touches grabs uses counts signs waves nods shakes sorts packs " +
    "wraps unwraps examines inspects admires compares chooses selects enters leaves arrives knocks calls " +
    "sighs frowns cries hides runs rides drives boards kneads stirs pours serves cleans fixes repairs " +
    "builds plants digs feeds pets strokes brushes combs cuts trims styles dries washes rinses").split(" ")
);
/** -ing words that are things, not something a person is doing ("customer parking", "a wedding"). */
const NOT_DOING =
  /^(?:thing|nothing|something|anything|everything|morning|evening|ceiling|building|clothing|bedding|string|spring|sibling|wedding|during|being|parking|seating|lighting|siding|railing|shipping|pudding|housing|flooring|roofing|plumbing|wiring)$/;
/** -ly words that are not how someone does something ("a family-only…", "a friendly…"). */
const NOT_DOING_LY =
  /^(?:friendly|only|early|daily|weekly|monthly|yearly|lovely|ugly|holy|curly|woolly|wooly|oily|silly|belly|jelly|lily|bully|rally|ally|supply|assembly|reply)$/;
const DETERMINERS = new Set(
  "a an the one another other this that these those her his their my your our its some several few many both every each".split(" ")
);
/** How many a word in the phrase says: 2, or 3 for "several" (a crowd, three or more). */
const NUMBERS = new Map<string, number>(
  Object.entries({ two: 2, both: 2, three: 3, four: 3, five: 3, six: 3, seven: 3, eight: 3, nine: 3, ten: 3, several: 3, many: 3, few: 3 })
);
/** A picture OF someone does not put them in the frame ("a framed photo of her grandchildren"). */
const NOT_IN_FRAME =
  /^(?:photos?|photographs?|pictures?|portraits?|paintings?|drawings?|posters?|images?|prints?|statues?|figurines?|sketch(?:es)?|cards?|carvings?|sculptures?|dolls?|toys?|ornaments?|cutouts?|toppers?)$/;
const DASH_OR_STOP = /^[,.;:!?()[\]—–"”-]$/;
/**
 * Words that never describe a person, so the phrase ends before them — a question word or a verb
 * ("hours of work drew buyers", "where handmade work meets local buyers": jobs 135 and 121). The
 * phrase is what the prompt tells the picture maker to draw ("The only person in this shot is …").
 */
const NOT_A_MODIFIER =
  /^(?:what|which|whose|where|when|why|how|whether|if|than|then|so|but|drew|met|saw|told|brought|caught|sold|showed|gave|took|got|let|made|[a-z]*[^su'’]s)$/;
/** "no people in the frame", "no clutter or shoppers", "empty of people": nobody is in it. */
const NEGATION = /^(?:no|not|without|never|nobody|none|zero|empty|free|devoid|absent)$/;
/** Someone a picture is FOR or WAITING for is not in it: "awaits a buyer", "to potential buyers". */
const NOT_THERE_YET =
  /^(?:for|awaits?|awaiting|potential|prospective|future|would-be|imagined|imaginary|implied|unseen|invisible|hypothetical)$/;

/** One person (or group) a description names. */
export type NamedPerson = {
  /** The words naming them, as written, without a possessive ("an older woman", "two passengers"). */
  phrase: string;
  /** The noun, singular ("woman", "passenger", "family member"). */
  noun: string;
  kind: NounKind;
  /** How many: 1, 2, or 3 for several (a crowd, "several shoppers"). */
  count: number;
  sex?: "f" | "m";
};
/** Who a description names: the people, and how many in all (1, 2, or 3 = several). */
export type NamedPeople = {
  people: NamedPerson[];
  count: number;
  /** The first role or relation named (customer, passenger, baby). */
  role?: string;
  /** The sex the words give, when they give one. */
  sex?: "f" | "m";
  /** A couple, a crowd, a family, or any plural. */
  group?: boolean;
  /** Only the host (or an owner) is named. */
  self?: boolean;
};

const tokensOf = (text: string): string[] =>
  text.match(/[A-Za-z]+(?:[-'’][A-Za-z]+)*(?:['’]s?)?|[^\sA-Za-z]/g) ?? [];
const isWord = (t: string | undefined): t is string => !!t && /^[A-Za-z]/.test(t);
const bare = (t: string) => t.toLowerCase().replace(/['’]s?$/, "");

/** Whether the possessive at `h` owns a body part: "a shopper's hand", "the baby's tiny fingers". */
function ownsBodyPart(tokens: string[], h: number): boolean {
  for (let k = 1; k <= 3; k++) {
    const t = tokens[h + k];
    if (!isWord(t)) return false;
    const b = bare(t);
    if (BODY.has(b)) return !(isWord(tokens[h + k + 1]) && BODY_COMPOUND.test(bare(tokens[h + k + 1]!)));
    if (FOLLOW.has(b)) return false;
  }
  return false;
}

/** Whether the person noun at `h` (not a possessive) IS a person, not a word describing a thing. */
function headsPerson(tokens: string[], h: number, kind: NounKind, lemma: string): boolean {
  const next = tokens[h + 1];
  if (next === undefined) return true;
  // A dash or a stop ends the phrase; a digit is a size ("baby 0-3 months").
  if (!isWord(next)) return DASH_OR_STOP.test(next);
  const n = next.toLowerCase();
  // Two person words naming a THING together ("a bride and groom cake topper", "the king and queen
  // pieces"): the first is a person only when the second is one.
  const second = tokens[h + 2];
  if ((n === "and" || n === "or") && isWord(second) && !/['’]s?$/.test(second)) {
    const pair = PERSON_NOUN.get(second.toLowerCase());
    if (pair && !COMPOUNDS[pair.lemma] && !headsPerson(tokens, h + 2, pair.kind, pair.lemma)) return false;
  }
  return (
    FOLLOW.has(n) ||
    // People working together: "a husband and wife team", "a mother-daughter duo".
    /^(?:team|duo|pair|crew)$/.test(n) ||
    (n === "of" && kind === "group" && lemma !== "couple") ||
    (/^[a-z]{4,}ing$/.test(n) && !NOT_DOING.test(n)) ||
    (/^[a-z]{3,}ly$/.test(n) && !NOT_DOING_LY.test(n))
  );
}

/**
 * The PEOPLE a picture's description names, read off its noun phrases (2026-10-18, the audit of 336
 * jobs): "a shopper's hand", "an older man walking across a parking lot", "two people hugging", "a
 * crowd of people in a street". `SHOWS_PERSON` knew only "a man", "a woman", "a person", pronouns
 * and body words, so "an older man …", "man standing …" and "a crowd of people …" were pictures of
 * NOBODY and got "No person is visible" (job 400 had eleven), and no role was ever read. A noun is a
 * person only when it IS the person, never a word describing a thing: "a baby blanket", "a pilot
 * hole", "a couple inches", "a farmers market", "a family name", "mother-of-pearl", "a passenger jet"
 * and "a customer's front door" name nobody (a possessive counts only before a body part); nor do
 * "a size for older babies" or "a photo of a baby". Pure.
 */
export function namedPeople(text: string | undefined): NamedPeople | undefined {
  const tokens = tokensOf(text ?? "");
  const found: NamedPerson[] = [];
  for (let h = 0; h < tokens.length; h++) {
    const tok = tokens[h];
    if (!isWord(tok)) continue;
    const word = bare(tok);
    const entry = PERSON_NOUN.get(word);
    if (!entry) continue;
    const possessive = word !== tok.toLowerCase();
    let noun = entry.lemma;
    const compound = COMPOUNDS[entry.lemma];
    const before = tokens[h - 1];
    const joined = !!compound && isWord(before) && compound.test(bare(before));
    if (compound) {
      if (!joined && !(possessive && ownsBodyPart(tokens, h))) continue;
      if (joined) noun = `${bare(before!)} ${entry.lemma}`;
    }
    const next = tokens[h + 1];
    // A person noun right before another one describes it: "a woman customer", "a baby girl".
    if (!possessive && isWord(next)) {
      const after = PERSON_NOUN.get(bare(next));
      if (after && !COMPOUNDS[after.lemma]) continue;
    }
    if (possessive ? !ownsBodyPart(tokens, h) : !headsPerson(tokens, h, entry.kind, entry.lemma)) continue;
    // The noun phrase: up to two describing words and a determiner before the noun.
    let start = joined ? h - 1 : h;
    for (let mods = 0; start > 0; ) {
      const prev = tokens[start - 1];
      if (!isWord(prev)) break;
      const p = prev.toLowerCase();
      if (DETERMINERS.has(p) || NUMBERS.has(p)) {
        start--;
        if (p === "few" && tokens[start - 1]?.toLowerCase() === "a") start--;
        break;
      }
      if (mods >= 2 || FOLLOW.has(p) || p === "of" || p === "or" || NEGATION.test(p) || NOT_THERE_YET.test(p) || /ing$/.test(p) || /['’]s?$/.test(prev) || NOT_A_MODIFIER.test(p) || p.length < 2) break;
      start--;
      mods++;
    }
    // A thing's "neighbours" ("its neighbors" — the pieces beside it) are no people.
    if (tokens[start]?.toLowerCase() === "its") continue;
    // Made FOR someone or waiting for them ("a size for older babies", "awaits a buyer"), nobody
    // ("no people in the frame", "empty of people", "no signage, pricing, or people"), or a
    // picture OF someone: not in the frame.
    if (NOT_THERE_YET.test(tokens[start - 1]?.toLowerCase() ?? "")) continue;
    // A clause ABOUT people, not people in the frame: "demonstrating what customers are purchasing"
    // (job 149 scene 68), "to see how buyers react".
    if (/^(?:what|whether|how|why)$/.test(tokens[start - 1]?.toLowerCase() ?? "")) continue;
    const listed = /^(?:or|and)$/i.test(tokens[start - 1] ?? "");
    let absent = false;
    for (let k = start - 1; k >= Math.max(0, start - (listed ? 8 : 4)); k--) {
      const t = tokens[k];
      if (!isWord(t) && !(listed && t === ",")) break;
      const w = t.toLowerCase();
      if (NEGATION.test(w) || (w === "of" && NOT_IN_FRAME.test(bare(tokens[k - 1] ?? "")))) absent = true;
      // A doing word ends the clause — unless it is itself denied ("without showing the person").
      if (/ing$/.test(w) && !listed) {
        if (NEGATION.test(tokens[k - 1]?.toLowerCase() ?? "")) absent = true;
        break;
      }
    }
    if (absent) continue;
    const words = tokens
      .slice(start, h + 1)
      .map((t, k, all) => (k === all.length - 1 ? t.replace(/['’]s?$/, "") : t))
      .map(t => (PERSON_NOUN.has(t.toLowerCase()) || DETERMINERS.has(t.toLowerCase()) || NUMBERS.has(t.toLowerCase()) ? t.toLowerCase() : t));
    const numberWord = words.find(w => NUMBERS.has(w));
    const count =
      entry.kind === "group" ? (entry.lemma === "couple" ? 2 : 3) : numberWord ? NUMBERS.get(numberWord)! : entry.plural ? 2 : 1;
    const sexWord = words.map(w => w.toLowerCase()).find(w => FEMALE.has(w) || MALE.has(w));
    // "a crowd of people", "a family of four": one group, not a second set of people.
    if (entry.kind === "group" && next?.toLowerCase() === "of" && isWord(tokens[h + 2]) && PERSON_NOUN.has(bare(tokens[h + 2]))) {
      words.push("of", bare(tokens[h + 2]));
      h += 2;
    }
    const opened = DETERMINERS.has(words[0]) || NUMBERS.has(words[0]);
    const phrase = opened || count > 1 ? words.join(" ") : `${/^[aeiou]/i.test(words[0]) ? "an" : "a"} ${words.join(" ")}`;
    // The host is one person: "background vendors" are other people.
    const kind: NounKind = entry.kind === "self" && count > 1 ? "generic" : entry.kind;
    found.push({ phrase, noun, kind, count, sex: sexWord ? (FEMALE.has(sexWord) ? "f" : "m") : undefined });
  }
  if (!found.length) return undefined;
  // The same person named twice ("a visitor's legs … while the visitor leans away") is one person;
  // "another" or "a second" one is not.
  const byNoun = new Map<string, NamedPerson>();
  found.forEach((p, k) => {
    const key = /^(?:another|other|second)\b/.test(p.phrase) ? `${p.noun}#${k}` : p.noun;
    const had = byNoun.get(key);
    if (!had) byNoun.set(key, p);
    else byNoun.set(key, { ...had, count: Math.max(had.count, p.count), sex: had.sex ?? p.sex });
  });
  const people = Array.from(byNoun.values());
  const sexes = Array.from(new Set(people.map(p => p.sex).filter((s): s is "f" | "m" => !!s)));
  return {
    people,
    count: Math.min(3, people.reduce((n, p) => n + p.count, 0)),
    role: people.find(p => p.kind === "role")?.noun,
    sex: sexes.length === 1 ? sexes[0] : undefined,
    group: people.some(p => p.kind === "group" || p.count > 1) || undefined,
    self: people.every(p => p.kind === "self") || undefined,
  };
}

/** Animals: a pronoun right after one is the animal's ("a hen … over her shoulder"). */
const ANIMAL =
  /\b(?:dogs?|pupp(?:y|ies)|cats?|kittens?|hens?|chickens?|chicks?|roosters?|ducks?|ducklings?|geese|goose|horses?|pon(?:y|ies)|foals?|cows?|calf|calves|bulls?|goats?|sheep|lambs?|pigs?|piglets?|birds?|parrots?|rabbits?|bunn(?:y|ies)|deer|fox(?:es)?|squirrels?|mice|mouse|rats?|hamsters?|bees?|owls?|hawks?|turtles?|snakes?|lizards?|raccoons?|bears?|wol(?:f|ves)|cattle|donkeys?|mules?|llamas?|alpacas?|turkeys?|pigeons?|doves?|crows?)\b/gi;
/** A part only a person has: "her lap", "his hands" stay a person's even right after a dog. */
const HUMAN_ONLY_PART = /^\s+(?:own\s+)?(?:hands?|fingers?|fingertips?|thumbs?|palms?|wrists?|lap|knees?|arms?)\b/i;

/**
 * The description with every he/she/her/his that refers to an ANIMAL turned into "its" (2026-10-18,
 * the audit: "a hen tossing beakfuls of feed over her shoulder" and "a dog poking his nose into a
 * shopping bag" were host pictures because of the pronoun). A pronoun is the animal's when an
 * animal is named before it with no person named in between, and no part only a person has follows
 * it ("a dog asleep in her lap" keeps its person). Pure.
 */
export function withoutAnimalPronouns(text: string): string {
  if (!text.match(ANIMAL)) return text;
  return text.replace(/\b(?:she|he|her|his|herself|himself)\b/gi, (pronoun: string, at: number) => {
    const before = text.slice(0, at);
    const animals = Array.from(before.matchAll(ANIMAL));
    if (!animals.length) return pronoun;
    const since = before.slice(animals[animals.length - 1].index ?? 0);
    if (namedPeople(since) || /\b(?:hands?|fingers?|host|someone|a person)\b/i.test(since)) return pronoun;
    if (HUMAN_ONLY_PART.test(text.slice(at + pronoun.length))) return pronoun;
    return /self$/i.test(pronoun) ? "itself" : "its";
  });
}

/**
 * Whether a description shows a person — the one test every step uses for "is someone in this
 * picture": a person a noun phrase names (`namedPeople`), or the person words of `SHOWS_PERSON` with
 * pronouns that refer to an animal not counted. Pure.
 */
export function showsPerson(text: string | undefined): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  return !!namedPeople(t) || SHOWS_PERSON.test(withoutAnimalPronouns(t));
}

/** The host's sex as their own look gives it, or undefined when it does not say. */
export function sexOfLook(look: string | undefined): "f" | "m" | undefined {
  if (!look) return undefined;
  const f = /\b(?:woman|lady|girl|she|her)\b/i.test(look);
  const m = /\b(?:man|gentleman|boy|he|his|beard(?:ed)?|moustache|mustache)\b/i.test(look);
  return f && !m ? "f" : m && !f ? "m" : undefined;
}

/** A family title a host may go by in their name, and the role words that mean the same person. */
const NAME_TITLES: [RegExp, string[]][] = [
  [/^(?:granny|grandma|gran|nana|nan|grammy|grandmother)$/, ["grandma", "grandmother", "grandparent"]],
  [/^(?:grandpa|grandad|granddad|gramps|grandfather)$/, ["grandpa", "grandfather", "grandparent"]],
  [/^(?:aunt|auntie|aunty)$/, ["aunt"]],
  [/^uncle$/, ["uncle"]],
  [/^(?:mama|mom|mum|mother)$/, ["mother", "mom", "mum", "mama", "parent"]],
  [/^(?:papa|dad|father)$/, ["father", "dad", "parent"]],
];

/**
 * The roles the host gives THEMSELF — their on-screen title and their self-introduction ("I'm Ana,
 * a hairdresser", "after thirty years as a plumber"): for that video a picture of "a plumber's
 * hands" is the host, never someone else. Only a role right after "I'm <Name>," / "I was" / "years
 * as" counts — "I'm Dale, and I've sold to a thousand customers" makes nobody a customer. A family
 * title in the host's NAME is theirs too, with its other words ("Granny <Name>": a grandmother's
 * hands at the hook are the host's, not a stranger's). Pure.
 */
export function selfRolesOf(intro: string | undefined, title?: string, hostName?: string): string[] {
  const roles = new Set<string>();
  const take = (t: string) => {
    for (const w of t.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? []) {
      const e = PERSON_NOUN.get(w);
      if (e?.kind === "role") roles.add(e.lemma);
    }
  };
  if (title) take(title);
  for (const w of hostName?.toLowerCase().match(/[a-z]+/g) ?? [])
    for (const [family, same] of NAME_TITLES) if (family.test(w)) same.forEach(r => roles.add(r));
  const said =
    /\b(?:[Ii]['’]?m|[Ii] am|[Ii] was|[Ii]['’]?ve been|[Ii] have been|[Yy]ears as|[Cc]areer as|[Ww]ork(?:ed|s)? as)\s+(?:[A-Z][\w'’-]*,?\s+){0,3}(?:an?|the)\s+((?:[a-z][\w'’-]*\s+){0,2}[a-z][\w'’-]*)/g;
  for (const m of Array.from((intro ?? "").matchAll(said))) take(m[1]);
  return Array.from(roles);
}

/** The host's own name in a description becomes "the host": "<Name>'s hands" are the host's. */
function withHostNamed(text: string, hostName: string | undefined): string {
  const name = hostName?.trim();
  if (!name) return text;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text.replace(new RegExp(`\\b${esc(name)}\\b`, "g"), "the host");
  for (const w of name.split(/\s+/))
    if (w.length >= 3 && /^[A-Z]/.test(w)) out = out.replace(new RegExp(`\\b${esc(w)}\\b`, "g"), "the host");
  return out;
}

/** Someone other than the host in a picture: who, and how many people in all (1, 2, or 3 = several). */
export type SomeoneElse = { who: string; count: number };

/**
 * Whether a description's words put SOMEONE OTHER THAN THE HOST in the picture — what `markHostBroll`
 * decides before it gives a picture the host's photo (2026-10-18, the audit of 336 jobs: 17 pictures
 * named someone else and were drawn from the host's photo — "a shopper's hand picking up a coaster",
 * "baby's hand resting on a star blanket", "a woman at home at night lit by her laptop" on a man's
 * channel, "two people hugging" from ONE photo — and job 400 scene 16, "an older woman's hand resting
 * on a framed photograph", from a man's). Someone else when:
 *   - a role or relation names them (a customer, a passenger, a farmer, a baby), or
 *   - the words give a sex the host's look does not have, or
 *   - two or more people are in it (a couple, a crowd, a family) — never two from one photo.
 * The host and an owner are always the host, and so is a role the host gives themself
 * (`selfRoles`). A plain "a man" / "a woman" of the host's own sex is left to the planner and the
 * line check: decided in code from the line's grammar it was wrong on 8-10 of 37 pictures ("Wear
 * them with a navy crewneck…" speaks to the viewer and shows the host). Pure.
 */
export function someoneElse(
  text: string | undefined,
  opts: { look?: string; hostName?: string; selfRoles?: string[] } = {}
): SomeoneElse | undefined {
  const named = namedPeople(withHostNamed(text ?? "", opts.hostName));
  if (!named) return undefined;
  const isSelf = (p: NamedPerson) => p.kind === "self" || (p.kind === "role" && !!opts.selfRoles?.includes(p.noun));
  const others = named.people.filter(p => !isSelf(p));
  if (!others.length) return undefined;
  const hostSex = sexOfLook(opts.look);
  const other =
    named.count >= 2 ||
    others.some(p => p.kind === "role" || p.kind === "group") ||
    (!!hostSex && others.some(p => !!p.sex && p.sex !== hostSex));
  if (!other) return undefined;
  // The host named beside someone else is drawn as one more ordinary person, never from the photo.
  const who = named.people
    .map(p => (isSelf(p) && /\b(?:host|narrator|presenter)$/i.test(p.phrase) ? "a person" : p.phrase))
    .join(" and ");
  return { who, count: named.count };
}

// ─── People who come back ────────────────────────────────────────────────────────────────

/** Words that say nothing about WHICH person is meant ("the", "her"), dropped when names are compared. */
const NAME_FILLER = new Set("a an the this that these those her his their my your our its some".split(" "));
/**
 * The words in a label that set its `noun` APART from someone already named — "another passenger",
 * "a second customer", "the next buyer", "a new client" — read off the label itself, since the
 * noun phrase stops at "next" ("next to a passenger" is a place, not a second one). Pure.
 */
function elseWordsFor(who: string, noun: string): string[] {
  const last = noun.split(" ").pop() ?? noun;
  const forms = [last, pluralOf(last)].map(f => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(
    `\\b(another|other|second|third|different|new|next)\\s+(?!to\\b)(?:(?!(?:and|or|to|with|of)\\b)[a-z'’-]+\\s+){0,2}(?:${forms})\\b`,
    "gi"
  );
  return Array.from(who.matchAll(re), m => m[1].toLowerCase());
}

/**
 * A person's name reduced to the words that tell them apart: "The woman passenger." → "woman
 * passenger", "the passenger's" → "passenger". "other" and "one" stay: "the other passenger" is not
 * "the passenger". Pure.
 */
export function personKey(name: string | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(w => w && !NAME_FILLER.has(w))
    .join(" ");
}

/**
 * The recurring people (`inputParams.recurringPeople`) a picture's someone-else (`otherPerson`)
 * is, so each is drawn with the one look the video gave them (2026-10-18, job 399: the woman
 * passenger the story follows was a short-haired blonde in a puffer jacket in scene 2, a young
 * dark-haired woman in scene 4 and a grey-blonde with older hands in scene 5 — 13 s apart — and the
 * man beside her changed in scenes 2, 7 and 8, because each picture was drawn from the label "a
 * woman passenger" alone). Matched by the words that say who they are, each person the label names
 * on its own ("a flight attendant and a male passenger" is two):
 *   - the same name ("a woman passenger" is "the woman passenger"), or the name's own noun phrase
 *     when that is more than a bare "man"/"woman" ("an old man" is "the old man"; "a man" is not
 *     "the man in the card aisle");
 *   - the same ROLE noun (passenger, neighbour, sister) with no sex against it — "a male
 *     passenger" is the passenger the look calls a man, never the one it calls a woman;
 *   - a PROPER name (no role or person word, a capital letter) when every word of it is in the
 *     label ("Seneca at his desk"); a vague name like "the other" only by the same words.
 * One person the label names that fits two recurring people equally ("a seated passenger" beside a
 * man and a woman passenger) is left as it was: guessing would give a stranger someone's look. So is
 * a label that says it is someone ELSE ("another passenger", "a new customer", "the next buyer"),
 * unless the name says the same. "Two passengers" takes the two passengers, never three; a crowd,
 * "several passengers" or a bare "passengers" takes nobody — who is in a crowd is a guess. Empty
 * when nothing fits. Pure.
 */
export function matchRecurringPeople(
  who: string | undefined,
  count: number | undefined,
  people: RecurringPerson[] | undefined
): RecurringPerson[] {
  if (!who?.trim() || !people?.length) return [];
  const facts = people.map(person => {
    const named = namedPeople(person.name);
    const first = named?.people[0];
    const head = first ? personKey(first.phrase) : undefined;
    return {
      person,
      key: personKey(person.name),
      head: head && (head.includes(" ") || head === personKey(person.name)) ? head : undefined,
      roles: (named?.people ?? []).filter(p => p.kind === "role").map(p => p.noun),
      sex: named?.sex ?? sexOfLook(person.look),
      // A name with a capital letter once a leading "the"/"my" is set aside ("Seneca", "Grandpa
      // Joe"): found inside a label. A vague one ("the other", "one of them") is not — "the other"
      // is in "the other customer" of any later story.
      proper: !named && /\b[A-Z]/.test(person.name.replace(/^\W*(?:the|a|an|my|our|your|her|his|their)\b/i, "")),
    };
  });
  type Fact = (typeof facts)[number];
  const whoKey = personKey(who);
  const whoWords = new Set(whoKey.split(" "));
  const picked: Fact[] = [];
  const take = (f: Fact) => {
    if (!picked.includes(f)) picked.push(f);
  };
  for (const part of namedPeople(who)?.people ?? []) {
    const key = personKey(part.phrase);
    const exact = (f: Fact) => f.key === key || f.key === whoKey || (!!f.head && f.head === key);
    // "another passenger", "a second customer", "the next buyer": by its own words NOT the one the
    // story follows — with one recurring passenger, a role match alone would hand her look to the
    // person the line sets apart from her.
    const elseWords = elseWordsFor(who, part.noun);
    const fits = facts.filter(
      f =>
        exact(f) ||
        (part.kind === "role" &&
          f.roles.includes(part.noun) &&
          !(part.sex && f.sex && part.sex !== f.sex) &&
          elseWords.every(w => f.key.split(" ").includes(w)))
    );
    if (part.count > 1) {
      // Only a stated two ("two passengers", "both passengers") is the story's two; "several
      // passengers", "three passengers" or a bare plural is a crowd, and who is in it is a guess.
      const two = part.count === 2 && /\b(?:two|both)\b/i.test(part.phrase);
      if (two && fits.length <= part.count) fits.forEach(take);
      continue;
    }
    if (fits.length === 1) {
      take(fits[0]);
      continue;
    }
    const exacts = fits.filter(exact);
    const sexed = fits.filter(f => !!part.sex && f.sex === part.sex);
    if (exacts.length === 1) take(exacts[0]);
    else if (sexed.length === 1) take(sexed[0]);
  }
  // The label IS the name (the planner was given the names and copied one), or holds a proper one.
  for (const f of facts)
    if (f.key && (f.key === whoKey || (f.proper && f.key.split(" ").every(w => whoWords.has(w))))) take(f);
  return picked.slice(0, Math.max(1, count ?? 1)).map(f => f.person);
}

/** Whether a picture shows someone other than the host — named by the planner, or by its own words. */
export function showsSomeoneElse(s: Pick<StoryboardScene, "otherPerson" | "showSubject" | "visualPrompt">): boolean {
  return !!s.otherPerson || !!someoneElse(s.showSubject ?? s.visualPrompt);
}

/**
 * Whether the words name an animal and no person — a planner's "someone else" that is "a hen"
 * (job 371) is not a person at all. Pure.
 */
export function namesOnlyAnimal(text: string): boolean {
  return !!text.match(ANIMAL) && !namedPeople(text) && !SHOWS_PERSON.test(withoutAnimalPronouns(text));
}

/** Words naming a part of the body (not a thing used on it — a hair dryer is a thing). */
export const BODY_PART_WORDS =
  /\b(?:scalp|skin|nails|fingernails|forehead|cheeks?|eyelashes|eyebrows?|hairline|strands?|hair(?!\s*(?:dryer|brush|clip|tie|spray|band|pin|comb|product|net)))\b/i;

/** A description asking for a body part OFF the body: "a lock of hair laid across a towel". */
export const DETACHED_BODY_PART =
  /\b(?:locks?|strands?|swatch(?:es)?|hanks?|tress(?:es)?|clumps?|sections?|pieces?|tufts?)\s+of\s+(?:[a-z-]+\s+){0,2}hair\b|\b(?:hair|nails?|fingernails?)\b[^.;]{0,60}?\b(?:lying|laid|lies|spread|draped|resting|rests|placed|arranged)\s+(?:flat\s+)?(?:on|across|over|out on)\b/i;

/** What really holds a loose body part: a wig stand, a mannequin head, a practice hand, a packet. */
export const REAL_HOLDER =
  /\b(?:wigs?|mannequin|wig stand|wig head|practice (?:hand|head)|training head|extensions?|swatch (?:ring|book|card)|packet|package|packaging)\b/i;
/** A few strands that really fall loose: in a brush, on a comb, in a drain, on a towel or a floor. */
const FALLEN_STRANDS =
  /\b(?:a few|some|stray|loose|fallen|shed)?\s*(?:strands?|hairs)\b[^.;]{0,40}\b(?:in|on|caught in|stuck in|around)\s+(?:a|an|the|her|his|their)?\s*(?:[a-z-]+\s+){0,2}(?:brush|hairbrush|comb|drain|sink|towel|pillow|floor|shower)/i;

/**
 * Whether a description asks for a body part that would look CUT OFF: a loose lock or hair lying on a
 * surface, with neither a real holder (wig stand, mannequin head, practice hand, packet) nor the few
 * fallen strands that really happen (the operator, 2026-10-02: "strands of hair can be not in the
 * mannequin … just don't generate hair that looks like it has no head"). Pure.
 */
export function looksCutOff(text: string): boolean {
  if (!DETACHED_BODY_PART.test(text)) return false;
  return !REAL_HOLDER.test(text) && !FALLEN_STRANDS.test(text);
}

/**
 * Put a loose body part back on the body (2026-10-02, the operator on Diane's job 315: "any part of
 * the body should stay on the body" — "a lock of hair dyed one flat dark brown … laid across a white
 * towel" and "hair with gray roots … lying on a white towel" came back as hair with no head). The
 * lock/strand words and the "lying on the towel" placement are taken out and the hair is put on the
 * person's own head. Unchanged when nothing asks for a loose body part. Pure.
 */
export function onTheBody(text: string): string {
  if (!looksCutOff(text)) return text;
  const out = text
    .replace(/\b(?:a|an|the|one|some)?\s*(?:locks?|strands?|swatch(?:es)?|hanks?|tress(?:es)?|clumps?|sections?|pieces?|tufts?)\s+of\s+/gi, " ")
    .replace(/,?\s*\b(?:lying|laid|lies|spread|draped|resting|rests|placed|arranged)\s+(?:flat\s+)?(?:on|across|over|out on)\s+(?:a|an|the|her|his|their)\s+[^,.;]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.,;]?\s*$/, "");
  return `${out}, on the person's own head and body — never loose or lying on a surface.`;
}

/**
 * A description of the HOST with what asks for the face taken out. A picture of the host never
 * shows the face — a drawn one would not match the host on camera — but the description can ask
 * for it anyway: practice job 362 asked for "shadows under her chin, face looking tired …
 * photographed from the shoulders up" and got a full face that is not the host's. The expression
 * goes, and a "from the shoulders up" framing stops at the chin. Pure — unit-tested.
 */
export function withoutFaceAsks(text: string): string {
  return text
    .replace(
      /,?\s*(?:and\s+)?(?:(?:the|her|his|their|a)\s+)?face\s+(?:look(?:s|ing)?|appear(?:s|ing)?|seem(?:s|ing)?|show(?:s|ing)?)\s+[a-z-]+(?:\s+and\s+[a-z-]+)?/gi,
      ""
    )
    .replace(
      /,?\s*(?:photographed|framed|seen|shot|shown)\s+from\s+the\s+(?:shoulders|chest|neck|collarbones?)\s+up\b/gi,
      ", framed from the chin down"
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim();
}

// ─── The chin, the jaw and the neck in view ──────────────────────────────────────────────

/**
 * A line about the CHIN, JAWLINE, NECK or COLLARBONE of the one spoken to (or the speaker), or about
 * a piece held up NEAR THE FACE (2026-10-18, the audit): "that same necklace drags your chin and your
 * jawline down with it", "does it brighten the skin under your chin", "a single strand sitting right
 * at the collarbone", "hold the piece up near your face by a window". Its host picture used to be
 * drawn turned away or from behind (job 244 scene 3: fingertips at a necklace, the chin nowhere),
 * or with nobody in it at all (job 223 scene 5: the pendant draped over a dressing table) — while
 * the look the line talks about sits on the chin and neck, which the host rule can show without a
 * face: the body facing the camera, the frame cut at the lips (`hostLipsCut`).
 * The neck needs "your" or "my" (the neck of a drawstring bag, the side of a dog's neck), a jaw
 * counts only as a jawline (a vise has jaws), "near the face" never as the face OF something (a
 * board's face, a face frame), and sayings never count ("in my neck of the woods", "a pain in the
 * neck"). Pure.
 */
const CHIN_LINE =
  /\b(?:(?:your|my|the)\s+chins?|(?:your|my)\s+necks?|jawlines?|collarbones?|near\s+(?:your|my|the)\s+face(?![\s-]+(?:of|edges?|frames?|grain|sides?|boards?|plates?|veneer|joints?|down|up)\b))\b/i;
/** Words that name the chin or neck and mean something else ("keep your chin up", "the back of your neck"). */
const CHIN_SAYINGS =
  /\b(?:keep(?:s|ing)?|kept)\s+(?:your|my|the)\s+chins?\s+up\b|\bchins?[\s-]+(?:straps?|rests?|guards?|bars?|ups?|length)\b|\b(?:take|takes|took|taking|taken)\s+(?:it|that|this|one)\s+on\s+the\s+chin\b|\b(?:back|nape)\s+of\s+(?:your|my|the)\s+necks?\b|\bnecks?\s+of\s+the\s+woods\b|\b(?:pain|crick|kink)s?\s+in\s+(?:your|my|the)\s+necks?\b|\bbreath(?:e|es|ing)?\s+down\s+(?:your|my)\s+necks?\b|\b(?:stick|sticks|sticking|stuck|risk(?:s|ing|ed)?|sav(?:e|es|ing|ed)|break(?:s|ing)?|broke|wring)\s+(?:your|my)\s+necks?\b|\b(?:down|up\s+to)\s+(?:your|my)\s+necks?\b|\b(?:broke|broken|break(?:s|ing)?|fractur(?:e|ed|es|ing)|crack(?:ed|s)?)\s+(?:(?:a|my|your|the)\s+)?collarbones?\b/gi;
/**
 * A line that COUNTS several things is an overview — its picture shows them all, laid out (job 223
 * scene 8, "Three necklaces today that read expensive…"), never one of them worn. A measure ("two
 * inches lower") or a count of ideas ("two things") is not one.
 */
const COUNTS_THINGS =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|several)\s+(?:[a-z'-]+\s+)?(?!(?:inch(?:es)?|feet|foot|seconds?|minutes?|hours?|days?|weeks?|months?|years?|times|percent|quarters|halves|thirds|dollars?|cents?|pounds?|ounces?|miles?|hands|fingers|things|ways|rules|steps|tips|reasons|mistakes|questions|points|parts)\b)[a-z]{3,}s\b/i;

/** Whether a line is about the chin, jaw or neck (see `CHIN_LINE`). Pure. */
export function looksAtChinLine(line: string | undefined): boolean {
  const t = (line ?? "").replace(CHIN_SAYINGS, " ");
  return CHIN_LINE.test(t) && !t.match(ANIMAL) && !COUNTS_THINGS.test(t);
}

/** Hair in a picture: a hair line keeps its side or back view, where the hair is seen. */
const HAIR_PICTURE = /\b(?:hair(?!\s*(?:dryer|brush|clip|tie|spray|band|pin|comb|product|net))|scalp|hairline)\b/i;
/** A picture of several pieces at once — the overview's picture, never worn ("several beads" is one piece). */
const SEVERAL_PIECES =
  /\b(?:necklaces|pendants|chains|chokers|lockets|scarves|scarfs)\b|\b(?:rows? of|side by side|laid (?:out )?together|next to each other)\b/i;

/**
 * Whether a picture is framed for its chin line: the line is about the chin, jaw or neck
 * (`looksAtChinLine`), and the picture is not an overview of several pieces, not about hair (seen
 * from behind or the side, where the hair is) and not of an animal. Pure.
 */
export function chinFramed(
  scene: Pick<StoryboardScene, "scriptText" | "showSubject" | "visualPrompt" | "listSet">
): boolean {
  if (scene.listSet || !looksAtChinLine(scene.scriptText)) return false;
  const words = `${scene.showSubject ?? ""} ${scene.visualPrompt ?? ""}`;
  return !HAIR_PICTURE.test(words) && !words.match(ANIMAL) && !SEVERAL_PIECES.test(words);
}

/**
 * A HOST picture framed from the lips down (`HOST_LIPS_CUT_CLAUSE` in longformVideo): the host's
 * own picture (not someone else's, not a step on the face, which shows the face) of a chin line.
 * Read off the scene each time, so a picture regenerated on an older film gets it too. Pure.
 */
export function hostLipsCut(scene: StoryboardScene): boolean {
  return !!scene.brollHostLook && !scene.hostFaceShown && !scene.otherPerson && chinFramed(scene);
}

/** Something worn at the neck: what a chin line's picture shows on the person. */
const NECK_PIECE =
  /\b(?:necklaces?|pendants?|chokers?|lockets?|chains?|pearls?|beads?|scarf|scarves|neckerchiefs?)\b/i;
/** A neck piece on a display stand: the one place a piece that is already worn is taken off. */
const ON_A_STAND = String.raw`,?\s*\b(?:on|over)\s+(?:(?:a|an|the)\s+)?(?:dress form|mannequin|necklace stand|jewel(?:le)?ry stand|display stand|display bust)\b[^,.;]*`;
/** A neck piece set down — on a table, in a box, over a mirror, on a stand — rather than worn. */
const SET_DOWN_SOURCE = String.raw`,?\s*\b(?:draped|laid|lying|lies|resting|rests|displayed|arranged|spread|coiled|placed|sitting|sits|hanging|hangs|propped|tucked)\s+(?:out\s+|flat\s+)?(?:over|across|on|onto|in|inside|along|atop)\s+(?![^,.;]*\b(?:chest|neck|collarbones?|skin|throat|shoulders?|body|hands?|palms?|fingers?|sweater|crewneck|turtleneck|blouse|shirt|neckline|dress(?!\s+form))\b)[^,.;]+|${ON_A_STAND}|,?\s*\b(?:on|onto|in|inside|atop)\s+(?:a|an|the|its)\s+${MODIFIER_WORD}{0,3}(?:tables?|tabletops?|dressers?|vanit(?:y|ies)|nightstands?|desks?|counters?|countertops?|shelf|shelves|trays?|dish(?:es)?|box(?:es)?|drawers?|rugs?|cloths?|towels?|velvet|linings?|cushions?|pillows?|beds?|bedspreads?|surfaces?|mats?)\b[^,.;]*`;
/**
 * Words saying the piece is already on someone ("worn at the collarbone", "on the chest"). "Host" or
 * "woman" alone is not one: "the host's pearl necklace laid on the dresser" is set down.
 */
const ON_A_PERSON = new RegExp(
  `${WORN_ON_BODY.source}|\\b(?:worn|wearing|collarbones?|neck|chest|chin|jawline|throat)\\b`,
  "i"
);
/** What `wornAtTheNeck` adds (and how it knows it already has). */
const WORN_TAIL = "worn at the host's own neck, the chin and jaw in view above it";
/** A hand on the piece: the picture is of someone doing something with it, and stays as it is. */
const HAND_ON_IT =
  /\b(?:hands?|fingers?|fingertips?|palms?|hold(?:s|ing)?|held|lift(?:s|ing)?|pick(?:s|ing)|tak(?:es|ing)|adjust(?:s|ing)?|fasten(?:s|ing)?)\b/i;

/**
 * A chin line's picture of the piece alone, put on the host (2026-10-18, the audit): job 223 scene 5,
 * "and your jawline down with it", drew the pendant draped over a dressing table, and job 392 scene
 * 23 a host picture of the dark beads "laid on the soft cloth surface". The look the line is about is
 * the piece AT THE NECK, so where it was set down is taken out and it is worn — and the picture check,
 * which holds the frame to these words, then asks for that. Unchanged when no neck piece is named or
 * a hand is on it. A piece already worn loses only a display stand (job 364 scene 22, "worn at
 * collarbone on dress form"): the chair, the bed or the dresser in the room is its setting. Pure.
 */
export function wornAtTheNeck(text: string): string {
  if (!NECK_PIECE.test(text) || HAND_ON_IT.test(text) || text.includes(WORN_TAIL)) return text;
  const worn = ON_A_PERSON.test(text);
  if (worn && !new RegExp(ON_A_STAND, "i").test(text)) return text;
  const out = text
    .replace(new RegExp(worn ? ON_A_STAND : SET_DOWN_SOURCE, "gi"), "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .trim()
    .replace(/[.,;]?\s*$/, "");
  return worn || ON_A_PERSON.test(out) ? `${out}.` : `${out}, ${WORN_TAIL} — never set down.`;
}

/**
 * A view that turns the host AWAY — from behind, from the side, over the shoulder, the face or head
 * turned away, the back to the camera — the opposite of the lips-cut framing. The shot list is told
 * to draw the host that way ("seen from behind or from the side … face turned away"), so a chin
 * line's description carries it (job 395 scene 25: "woman wearing dark beaded necklace at
 * collarbone, soft shadow under the chin above the dark beads, face turned away"), and beside
 * `HOST_LIPS_CUT_CLAUSE` the prompt would ask for both. Light from behind or the side is light, not
 * a view, and "the face out of frame" agrees with a frame cut at the lips.
 */
const NOT_LIGHT = String.raw`(?<!\b(?:light|lit|lighting|glow|sun|sunlight|daylight|window|lamp|backlit|coming|falling|streaming|shining)\s)`;
const TURNED_AWAY = new RegExp(
  String.raw`,?\s*(?:and\s+)?(?:` +
    [
      String.raw`(?:(?:the|her|his|their)\s+)?(?:face|head)\s+(?:turned|angled|looking|facing)\s+away(?:\s+from\s+(?:the\s+)?(?:camera|lens|viewer))?`,
      String.raw`(?:with\s+)?(?:(?:her|his|their|the)\s+)?back\s+(?:turned\s+)?to\s+(?:the\s+)?(?:camera|lens|viewer)`,
      String.raw`turned\s+away(?:\s+from\s+(?:the\s+)?(?:camera|lens|viewer))?`,
      String.raw`(?:an?\s+)?over[- ]the[- ]shoulder(?:\s+(?:view|shot|angle)(?:\s+of)?)?`,
      String.raw`(?:(?:seen|shot|viewed|photographed|framed|shown)\s+(?:from\s+)?|from\s+)over\s+(?:the|her|his|their)\s+shoulder`,
      String.raw`${NOT_LIGHT}(?:(?:seen|shot|viewed|photographed|framed|shown)\s+)?from\s+(?:behind|the\s+rear|the\s+back(?!\s+of\b)|the\s+side(?!\s+of\b))`,
      String.raw`(?:(?:seen|shot|viewed|photographed|framed|shown)\s+)?in\s+profile`,
      String.raw`(?:an?\s+)?side\s+view(?:\s+of)?`,
    ].join("|") +
    String.raw`)\b`,
  "gi"
);

/**
 * A lips-cut host picture's description with every view that turns the host away taken out, and a
 * "from the chin down" framing (`withoutFaceAsks`) moved up to the lips — so the description and
 * `HOST_LIPS_CUT_CLAUSE` ask for the same picture. Pure.
 */
export function facingTheCamera(text: string): string {
  return text
    .replace(TURNED_AWAY, "")
    .replace(/\bframed\s+from\s+the\s+chin\s+down\b/gi, "framed from the lips down")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/^\s*,\s*/, "")
    .trim();
}

/**
 * Mark the pictures that show someone doing the work as the HOST (see the file comment), and the
 * ones that show SOMEONE ELSE as that person (`otherPerson`, `otherPeople`) — never the host photo.
 * Pictures that show no one are cleared, so a re-run never leaves a stale mark. With no host look,
 * no host photo, or a b-roll-only film, no picture is the host's and the anonymous-hands lane is
 * used as before. Returns how many pictures now show the host. Pure apart from mutating `scenes`.
 */
export function markHostBroll(
  scenes: StoryboardScene[],
  params: Pick<LongformInputParams, "hostLook" | "brollOnly" | "hostName" | "hostTitle" | "recurringPeople">,
  hostPhotoUrl: string | undefined
): number {
  const look = params.hostLook?.trim();
  const on = !!look && !!hostPhotoUrl && !params.brollOnly;
  // A role the host gives themself ("I'm <Name>, a plumber") is the host in their own pictures.
  const intro = scenes
    .filter((s, i) => s.hostIntro || i < 3)
    .map(s => s.scriptText ?? "")
    .join(" ");
  const selfRoles = selfRolesOf(intro, params.hostTitle, params.hostName);
  let n = 0;
  for (const s of scenes) {
    const eligible =
      !s.hostPresent &&
      !s.splitVisual &&
      !s.coverHero &&
      !s.assetImageUrl &&
      !s.qrHero &&
      !s.showsBook;
    const text = s.showSubject ?? s.visualPrompt ?? "";
    const words = `${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`;
    s.otherPersonLooks = undefined;
    // A planner's "someone else" lives and dies with the words it came from (2026-10-18, the
    // audit): "a woman customer" left on a picture of an incense holder (job 361 scene 32), "a
    // woman passenger" on a close-up of a soda can (job 399 scene 4), "a hen" (job 371) — each
    // forced a person into a picture of a thing or an animal. Gone when the words show nobody, when
    // it names an animal, and on a host take (the host is the one on screen).
    if (s.otherPerson && (!eligible || namesOnlyAnimal(s.otherPerson) || !showsPerson(words))) {
      if (eligible && !showsPerson(words)) s.humanPresent = undefined;
      s.otherPerson = undefined;
      s.otherPeople = undefined;
    }
    // A chin line whose picture shows only the piece worn there is the host wearing it
    // (`wornAtTheNeck`, below): job 223 scene 5 drew the pendant on a dressing table under "your
    // jawline down with it". A picture of anything else keeps no one in it.
    const toWear = on && eligible && !s.otherPerson && NECK_PIECE.test(words) && chinFramed(s);
    const person = !!s.humanPresent || showsPerson(text) || toWear;
    // SOMEONE ELSE in the picture: named by the planner, or by the picture's own words — a role, a
    // sex the host does not have, two or more people (`someoneElse`).
    const other =
      eligible && person
        ? s.otherPerson
          ? { who: s.otherPerson, count: Math.max(namedPeople(s.otherPerson)?.count ?? 1, namedPeople(text)?.count ?? 1) }
          : someoneElse(text, { look, hostName: params.hostName, selfRoles })
        : undefined;
    if (other) {
      // A line about SOMEONE ELSE (a customer, a neighbour): that person is drawn, from behind,
      // without the host's look or photo — Dale's "a buyer three states away, hunting for a board
      // with her parents' name on it" came back as Dale himself at his bench, run after run. Two or
      // more people are never drawn from the one host photo (job 370 scene 8: "two people hugging").
      s.otherPerson = other.who;
      s.otherPeople = other.count > 1 ? other.count : undefined;
      // Someone the story comes back to keeps one look in every picture of them (job 399: the same
      // passenger was three different women in scenes 2, 4 and 5) — `matchRecurringPeople`.
      const looks = matchRecurringPeople(other.who, other.count, params.recurringPeople);
      s.otherPersonLooks = looks.length ? looks : undefined;
      s.humanPresent = true;
      s.brollHostLook = undefined;
      s.brollHostRef = undefined;
      s.hostFaceShown = undefined;
      if (s.showSubject) s.showSubject = withoutMirrors(s.showSubject);
      if (s.visualPrompt) s.visualPrompt = withoutMirrors(s.visualPrompt);
    } else if (on && eligible && person) {
      s.humanPresent = true;
      s.brollHostLook = look;
      // A step on the host's OWN FACE (make-up, skin care) shows that face — hers, drawn from her
      // photo and checked against it (`hostFaceClause`, `scanSameHost`) — since a routine on the face
      // cannot be shown with the face turned away (the operator, 2026-10-15). Everything else keeps
      // the face out of the picture, as before.
      s.hostFaceShown = FACE_ROUTINE.test(`${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`) || undefined;
      // A chin line's picture is framed from the lips down (`hostLipsCut`), facing the camera, with
      // the piece worn.
      const chin = !s.hostFaceShown && chinFramed(s);
      const tidy = (t: string) => {
        const out = s.hostFaceShown ? withoutMirrors(t) : withoutFaceAsks(withoutMirrors(t));
        return chin ? wornAtTheNeck(facingTheCamera(out)) : out;
      };
      if (s.showSubject) s.showSubject = tidy(s.showSubject);
      if (s.visualPrompt) s.visualPrompt = tidy(s.visualPrompt);
      s.brollHostRef = hostPhotoUrl;
      n++;
    } else if (on && s.hostPresent && s.splitVisual && BODY_PART_WORDS.test(s.splitVisual) && !REAL_HOLDER.test(s.splitVisual)) {
      // A split panel about a body part (hair, nails, skin) shows it on the host: it gets the host's
      // look for the panel (`buildSplitRightScene`); the take on the left is untouched.
      s.brollHostLook = look;
      s.brollHostRef = hostPhotoUrl;
    } else {
      s.brollHostLook = undefined;
      s.brollHostRef = undefined;
    }
  }
  return n;
}
