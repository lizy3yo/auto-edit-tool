/**
 * THE PERSON THE LINES FOLLOW, AND "YOU", KEEP ONE LOOK (2026-10-20, the round-14 verification
 * films). Job 415's story follows one man through a pharmacy card aisle and home in his car; the
 * props list wrote him one look ("man in pharmacy": a tan jacket over a plaid shirt), but every
 * picture of him was labelled "a man of sixty-four", which matched no name or role, so he wore a navy
 * work jacket, an olive jacket and a grey sweater in 37 seconds. Job 417 speaks to "you" as a
 * passenger a flight attendant serves, the props list wrote no VIEWER line, and "you" was four
 * different people in 100 s. The scene words below are the real stored ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringPerson, StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import {
  ageRangeOf,
  agesFit,
  linkFollowedPeople,
  markHostBroll,
  matchRecurringPeople,
  settingWordsOf,
  viewerAsk,
} from "./hostLook";
import { acceptViewerLook, describeNamedLooks, NAMED_LOOKS_SYSTEM, parseNamedLooks } from "./namedLooks";
import { buildStillPrompt } from "./longformVideo";

beforeEach(() => mockInvoke.mockReset());

const PHOTO = "https://x/host.png";
type S = Partial<StoryboardScene>;
const board = (rows: S[]) =>
  rows.map((r, k) => ({ index: k + 1, narration: "n", ...r }) as StoryboardScene);

// ─── Job 415: the man in the pharmacy ────────────────────────────────────────────────────

const GIDEON =
  "A man in his sixties with fair skin, grey hair, short beard, wire-rimmed glasses, wearing a grey sweater over a white collared shirt";
const PHARMACY_MAN: RecurringPerson = {
  name: "man in pharmacy",
  look: "A man in his sixties, average build, grey hair, wearing a tan jacket over a plaid shirt and dark trousers",
};
const SIXTY_FOUR = "a man of sixty-four";

/** Job 415's opening, scenes 1-13 as stored (host takes keep only their words). */
const opening415 = () =>
  board([
    { hostPresent: true, scriptText: "There is a man standing in the greeting card aisle of" },
    {
      scriptText: "a pharmacy on a Tuesday morning, buying his third sympathy card since spring,",
      showSubject: "man browsing sympathy cards in pharmacy card aisle",
      visualPrompt:
        "Pharmacy card aisle on a Tuesday morning. A pair of bare hands browsing upright sympathy cards on wooden display racks, fingers pausing on one card. Narrow aisle, waist-high racks, other cards in rows behind.",
      otherPerson: SIXTY_FOUR,
      humanPresent: true,
    },
    {
      scriptText: "and doing a kind of arithmetic nobody ever taught him. He is counting backward. He is sixty-four.",
      showSubject: "man browsing sympathy cards in pharmacy card aisle, a close-up of one detail of it filling the frame",
      visualPrompt: "man browsing sympathy cards in pharmacy card aisle, a close-up of one detail of it filling the frame",
      otherPerson: SIXTY_FOUR,
      humanPresent: true,
    },
    {
      scriptText: "His father made it to eighty-one. And somewhere between the sympathy cards and the cards for new grandbabies,",
      showSubject: "man holding sympathy and birthday cards together in pharmacy aisle",
      visualPrompt:
        "Pharmacy card aisle. A pair of bare hands holding a sympathy card and a birthday card together, comparing them side by side in front of the display racks. Both cards visible, clearly framed.",
      otherPerson: SIXTY_FOUR,
      humanPresent: true,
    },
    {
      scriptText: "he has quietly worked out that if the family average holds, he has about seventeen summers left.",
      showSubject: "man holding sympathy and birthday cards together in pharmacy aisle, a close-up of one detail of it filling the frame",
      visualPrompt: "man holding sympathy and birthday cards together in pharmacy aisle, a close-up of one detail of it filling the frame",
      otherPerson: SIXTY_FOUR,
      humanPresent: true,
    },
    { hostPresent: true, scriptText: "Seventeen. He pays, he walks out to the parking lot," },
    {
      scriptText: "and the number rides home with him in the passenger seat.",
      showSubject: "man sitting in car driving home, cards on passenger seat",
      visualPrompt:
        "Inside a car. A sympathy card and birthday card resting on the passenger seat, sunlight through the windshield. Dashboard and steering wheel at the edges, interior of an ordinary car.",
      otherPerson: SIXTY_FOUR,
      humanPresent: true,
    },
    {
      scriptText: "Maybe you have done that arithmetic. Most people past sixty have — usually in silence, usually in some ordinary place,",
      showSubject: "an older woman sitting silently alone on her front porch steps in the morning, hands folded, lost in thought",
      visualPrompt: "Front porch steps in the morning. Bare hands folded in a lap, a seated figure at rest on the steps, looking out quietly.",
      otherPerson: "an older woman",
      humanPresent: true,
    },
    {
      scriptText: "a waiting room,",
      showSubject: "an older man sitting alone on a cushioned chair in a waiting room, hands folded, staring quietly at the floor, seen from the side",
      visualPrompt: "Waiting room with a row of cushioned chairs along a wall and a low wooden table. A pair of bare hands folded and resting on a lap, seated on one chair.",
      otherPerson: "an older man",
      humanPresent: true,
    },
    {
      scriptText: "a church pew,",
      showSubject: "an older woman sitting alone in a polished wooden church pew, head slightly bowed, seen from behind",
      visualPrompt: "Church pew, rows of polished wooden benches. Bare hands folded and resting, head slightly bowed, seated alone on one pew, seen from behind.",
      otherPerson: "an older woman",
      humanPresent: true,
    },
    {
      scriptText: "the kitchen table at two in the morning when the house is too quiet.",
      showSubject: "an older man sitting alone at a round wooden kitchen table at two in the morning, the single overhead light on, dark windows behind, seen from the side",
      visualPrompt: "Round wooden kitchen table at two in the morning. A pair of bare hands resting on the table surface, seated alone under a single overhead light fixture.",
      otherPerson: "an older man",
      humanPresent: true,
    },
    { hostPresent: true, scriptText: "And the math always presents itself as the problem. Fewer years ahead than behind," },
    {
      scriptText: "and a clock that was background noise at thirty is now the loudest thing in the room.",
      showSubject: "a round wall clock hanging on the wall of a quiet, dim study",
      visualPrompt: "A round wall clock hanging on the wall of a quiet study, its face clearly visible, the room dimly lit and still.",
    },
  ]);
const params415 = { hostLook: GIDEON, hostName: "Gideon Grant", recurringPeople: [PHARMACY_MAN] };
const looksOf = (scenes: StoryboardScene[]) => scenes.map(s => s.otherPersonLooks?.map(p => p.name).join("+") ?? "");

describe("ageRangeOf / agesFit / settingWordsOf — what a label and a name say", () => {
  it("reads an age said outright, a decade and an age word, most telling first", () => {
    expect(ageRangeOf("a man of sixty-four")).toEqual([64, 64]);
    expect(ageRangeOf(PHARMACY_MAN.look)).toEqual([60, 69]);
    expect(ageRangeOf("a woman in her late fifties, short grey hair")).toEqual([56, 59]);
    expect(ageRangeOf("a 72-year-old neighbour")).toEqual([72, 72]);
    expect(ageRangeOf("an older man in his sixties")).toEqual([60, 69]);
    expect(ageRangeOf("an older man")).toEqual([50, 100]);
    expect(ageRangeOf("a young Roman man")).toEqual([16, 35]);
    expect(ageRangeOf("a middle-aged man, average build")).toEqual([40, 60]);
    // a number that is no age: "a stack of 20 cards" is cards, "row fourteen" a row
    expect(ageRangeOf("a stack of 20 cards")).toBeUndefined();
    expect(ageRangeOf("passenger in row fourteen")).toBeUndefined();
    expect(ageRangeOf("a man")).toBeUndefined();
  });

  it("an unsaid age fits any; a young man is not a man in his sixties", () => {
    expect(agesFit([64, 64], [60, 69])).toBe(true);
    expect(agesFit([65, 100], [60, 69])).toBe(true);
    expect(agesFit(undefined, [60, 69])).toBe(true);
    expect(agesFit([16, 35], [60, 69])).toBe(false);
  });

  it("a name's setting words are where the story has them — never a person, age or sex word", () => {
    expect(settingWordsOf("man in pharmacy")).toEqual(["pharmacy"]);
    expect(settingWordsOf("passenger in row fourteen")).toEqual(["row", "fourteen"]);
    expect(settingWordsOf("the man in the card aisle")).toEqual(["card", "aisle"]);
    expect(settingWordsOf("woman passenger")).toEqual([]);
    expect(settingWordsOf("the older neighbour")).toEqual([]);
  });
});

describe("linkFollowedPeople — the man in the pharmacy keeps his one look (job 415)", () => {
  it("415 scenes 2-5 and 7: every picture of him gets the props list's look; the ordinary places' older people do not", () => {
    const scenes = opening415();
    markHostBroll(scenes, params415, PHOTO);
    expect(looksOf(scenes)).toEqual([
      "",
      "man in pharmacy", // the card aisle — "pharmacy" in its words, "his" in its line
      "man in pharmacy",
      "man in pharmacy", // "His father made it to eighty-one": the aisle still says it is him
      "man in pharmacy",
      "",
      "man in pharmacy", // the car: no pharmacy, but "…rides home with him", the story's own stretch
      "", // "Most people past sixty have": the older woman on her porch is nobody the story follows
      "", // …nor the older man in the waiting room
      "",
      "", // …nor the one at the kitchen table at two in the morning
      "",
      "",
    ]);
    const prompt = buildStillPrompt(scenes[6]);
    expect(prompt).toContain("tan jacket over a plaid shirt");
    expect(prompt).not.toContain("grey sweater over a white collared shirt");
  });

  it("the story stretch alone, with no setting words: a picture whose line follows 'him' takes the look of the one man around it", () => {
    const scenes = opening415().slice(2, 7);
    // The card-aisle pictures already his; the car picture is linked by the line's "him" alone.
    expect(scenes[4].showSubject).not.toMatch(/pharmacy/);
    for (const k of [0, 1, 2]) scenes[k].otherPersonLooks = [PHARMACY_MAN];
    expect(linkFollowedPeople(scenes, [PHARMACY_MAN])).toBe(1);
    expect(scenes[4].otherPersonLooks).toEqual([PHARMACY_MAN]);
    // …and with the stretch broken by a line that never follows him, it is nobody's.
    const broken = opening415().slice(2, 7);
    broken[3] = { ...broken[3], scriptText: "Seventeen. The lot is nearly empty." };
    broken[4] = { ...broken[4], scriptText: "And the number rides home with him in the passenger seat." };
    for (const k of [0, 1, 2]) broken[k].otherPersonLooks = [PHARMACY_MAN];
    expect(linkFollowedPeople(broken, [PHARMACY_MAN])).toBe(0);
    expect(broken[4].otherPersonLooks).toBeUndefined();
  });

  it("never a second man of the story: a line naming him by name, a young man, 'another man', or two men followed at once", () => {
    const named = opening415();
    named[6] = {
      ...named[6],
      scriptText: "and on the drive home he thinks of a letter to a man named Paulinus.",
      showSubject: "an older man reading a letter at a desk",
      visualPrompt: "an older man reading a letter at a desk",
      otherPerson: "an older man",
    };
    markHostBroll(named, params415, PHOTO);
    expect(named[6].otherPersonLooks).toBeUndefined();

    // "His father made it to eighty-one" over an elderly man in the same aisle: the father, maybe —
    // only a label whose own age is the followed man's ("a man of sixty-four", scene 4) stays his.
    const father = opening415();
    father[3] = { ...father[3], otherPerson: "an elderly man", showSubject: "an elderly man in the pharmacy card aisle", visualPrompt: "an elderly man in the pharmacy card aisle" };
    markHostBroll(father, params415, PHOTO);
    expect(father[3].otherPersonLooks).toBeUndefined();
    expect(father[4].otherPersonLooks).toEqual([PHARMACY_MAN]);

    // Someone else brought in after "he" has his man, in the same setting.
    const clerk = opening415();
    clerk[6] = {
      ...clerk[6],
      scriptText: "and on his way out he nods to a man stocking the shelves.",
      showSubject: "a man stocking shelves in the pharmacy",
      visualPrompt: "a man stocking shelves in the pharmacy",
      otherPerson: "a man",
    };
    markHostBroll(clerk, params415, PHOTO);
    expect(clerk[6].otherPersonLooks).toBeUndefined();

    const young = opening415();
    young[6] = { ...young[6], otherPerson: "a young man", showSubject: "a young man sitting in a car", visualPrompt: "a young man sitting in a car" };
    markHostBroll(young, params415, PHOTO);
    expect(young[6].otherPersonLooks).toBeUndefined();

    const another = opening415();
    another[6] = { ...another[6], otherPerson: "another man", showSubject: "another man sitting in a car", visualPrompt: "another man sitting in a car" };
    markHostBroll(another, params415, PHOTO);
    expect(another[6].otherPersonLooks).toBeUndefined();

    // Two recurring men both in the stretch: whose "him" it is cannot be read.
    const NEIGHBOUR: RecurringPerson = { name: "the neighbour", look: "a man in his sixties, tall, white hair, a green cardigan" };
    const two = opening415();
    two[4] = { ...two[4], otherPerson: "the neighbour", showSubject: "the neighbour in the aisle", visualPrompt: "the neighbour in the aisle" };
    markHostBroll(two, { ...params415, recurringPeople: [PHARMACY_MAN, NEIGHBOUR] }, PHOTO);
    expect(two[4].otherPersonLooks?.map(p => p.name)).toEqual(["the neighbour"]);
    expect(two[6].otherPersonLooks).toBeUndefined();
  });
});

// ─── Job 417: the passengers, and "you" ─────────────────────────────────────────────────

const HELENA =
  "A slender woman in her forties with fair skin and brown hair pinned back, wearing a white blouse, navy striped neck scarf, and a navy blazer with a gold pin";
const ROW_14: RecurringPerson = {
  name: "passenger in row fourteen",
  look: "a middle-aged man, average build, short dark hair, wearing a grey collared shirt, seated by the window",
};
const STORY_WOMAN: RecurringPerson = {
  name: "woman passenger",
  look: "an older woman, slender build, grey hair in a bob, wearing a beige cardigan and floral blouse",
};
const YOU: RecurringPerson = {
  name: "the passenger",
  look: "a woman in her late sixties, short wavy silver hair, a soft teal cardigan over a cream top, dark grey trousers",
};
const PAX_ATT = "a passenger and a flight attendant";

/** Job 417 as stored, scenes 2-31 (the story, the self-introduction and the first two asks). */
const film417 = () =>
  board([
    { hostPresent: true, scriptText: "Two people paid the same fare, boarded" },
    { scriptText: "the same flight, and sat in the same row.", showSubject: "two passengers seated together in an airline seat row", otherPerson: "two passengers", otherPeople: 2, humanPresent: true },
    {
      scriptText: "By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding",
      showSubject: "a stainless-steel airline beverage cart being pushed past a woman passenger sitting alone in an empty seat row near the front of the cabin",
      otherPerson: "a woman passenger",
      humanPresent: true,
    },
    { scriptText: "the whole can of ginger ale,", showSubject: "a woman passenger in an empty seat row holding an unopened soda can", otherPerson: "a woman passenger", humanPresent: true },
    { scriptText: "a second bag of pretzels,", showSubject: "two pretzel bags resting on the fold-down tray table of a woman passenger's seat", otherPerson: "a woman passenger", humanPresent: true },
    { scriptText: "and a bottle of water for later.", showSubject: "woman passenger holding a water bottle in her seat", otherPerson: "a woman passenger", humanPresent: true },
    { scriptText: "The other was still in row fourteen with a few inches of soda over ice.", showSubject: "a man passenger in a seat row holding a plastic cup with a few inches of soda over ice", otherPerson: "a man passenger", humanPresent: true },
    { scriptText: "He figures she must know somebody on the crew.", showSubject: "a man passenger in his seat glancing toward a woman passenger seated in an empty row up front", otherPerson: "a man passenger", humanPresent: true },
    {
      scriptText: "She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.",
      showSubject: "woman passenger speaking pleasantly to a flight attendant in the aisle",
      otherPerson: "a woman passenger and a flight attendant",
      otherPeople: 2,
      humanPresent: true,
    },
    { hostPresent: true, hostIntro: true, scriptText: "I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way." },
    {
      scriptText: "Today you're getting fourteen things flight attendants will quietly hand over for free, depending on",
      showSubject: "a flight attendant handing a water bottle to a older passenger in a seat row",
      otherPerson: "a flight attendant and an older passenger",
      otherPeople: 2,
      humanPresent: true,
    },
    { scriptText: "the airline,", showSubject: "several airliners parked at gates seen through a terminal window" },
    { scriptText: "the flight,", showSubject: "the wing of an airliner, seen from a passenger's seat through the cabin window, climbing above clouds" },
    { scriptText: "and what's left in the galley,", showSubject: "a galley storage bin open showing a few remaining snack bags and soda cans" },
    {
      scriptText: "along with the exact words that get each one. None of them is an upgrade, and each of them starts with a single polite sentence.",
      showSubject: "an older passenger politely speaking to a flight attendant leaning down in the aisle",
      otherPerson: "an older passenger and a flight attendant",
      otherPeople: 2,
      humanPresent: true,
    },
    { hostPresent: true, splitVisual: "an unopened soda can sitting on the beverage cart top", scriptText: "Number one. The whole can. On a lot of U." },
    {
      scriptText:
        "S. airlines, the flight attendant pours your soda into a plastic cup packed with ice, fills it about halfway, and the rest of the can rolls off down the aisle on the cart.",
      showSubject: "a flight attendant setting a half-poured soda can back on the beverage cart beside a plastic cup of ice",
      otherPerson: "a flight attendant",
      humanPresent: true,
    },
    { scriptText: "On many of those carriers, you can have the whole thing just by asking.", showSubject: "passenger in row fourteen asking flight attendant at cart for can", otherPerson: PAX_ATT, otherPeople: 2, humanPresent: true },
    {
      scriptText: "I figured that out much too late, after more flights than I care to count spent nursing a thimble of ginger ale.",
      showSubject: "woman passenger holding small plastic cup with little ginger ale",
      otherPerson: "a woman passenger",
      humanPresent: true,
    },
    { scriptText: 'So when the cart reaches your row, speak up. "Could I keep the rest of the can, please?"', showSubject: "passenger in row fourteen speaking to flight attendant beside cart", otherPerson: PAX_ATT, otherPeople: 2, humanPresent: true },
    { scriptText: "Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying.", showSubject: "unopened juice can standing on beverage cart top" },
    { hostPresent: true, splitVisual: "host standing beside beverage cart in aisle, thinking", scriptText: "One more thing about drinks, because it catches good people off guard." },
    {
      scriptText:
        "On a U. S. airline, the only alcohol you're allowed to drink is alcohol the airline serves you, so the little bottles tucked in your carry-on stay closed. That's in the federal aviation rules,",
      showSubject: "small sealed alcohol bottles closed inside a carry-on bag",
    },
    { scriptText: "section one twenty-one point five seventy-five, and it doesn't care how good your intentions were.", showSubject: "small sealed alcohol bottles zipped closed inside a carry-on bag under a seat" },
    {
      scriptText: "That takes care of your thirst. Now for the rumble that shows up somewhere over the middle of the country.",
      showSubject: "a passenger by the window looking down at farmland far below, hand on stomach",
      otherPerson: "a passenger",
      humanPresent: true,
    },
    {
      scriptText: "Number two. A second snack. When the basket of pretzels and cookies comes down the aisle, you're welcome to take one.",
      showSubject: "a flight attendant holding a basket of pretzel bags and cookie bags out to a seat row",
      otherPerson: "a flight attendant",
      humanPresent: true,
    },
    { scriptText: "You're also welcome to ask for another, and the only real trick is when.", showSubject: "passenger in row fourteen asking flight attendant for another snack bag", otherPerson: PAX_ATT, otherPeople: 2, humanPresent: true },
    {
      hostPresent: true,
      splitVisual: "beverage cart midway down the narrow aisle between seat rows",
      scriptText: "Ask while the cart is still working its way back, and you're asking the crew to guess whether the last few rows will come up short. So",
    },
    {
      scriptText: "wait until everyone's been served,",
      showSubject: "a flight attendant pushing the beverage cart back toward the galley past rows of passengers with drinks",
      otherPerson: "a flight attendant and passengers",
      otherPeople: 3,
      humanPresent: true,
    },
    {
      scriptText: "then catch a flight attendant as they pass, or step back to the galley,",
      showSubject: "flight attendant walking down narrow cabin aisle past seated passengers",
      otherPerson: "a flight attendant and passengers",
      otherPeople: 3,
      humanPresent: true,
    },
    { scriptText: "and phrase it as an offer.", showSubject: "a passenger in the galley chatting kindly with a flight attendant beside the counters", otherPerson: PAX_ATT, otherPeople: 2, humanPresent: true },
  ]).map(s => ({ ...s, visualPrompt: s.visualPrompt ?? s.showSubject }));
const params417 = { hostLook: HELENA, hostName: "Helena Hart", recurringPeople: [ROW_14, STORY_WOMAN] };
/** The 0-based scenes where 417 speaks to "you" and shows a passenger — 11, 15, 18, 20, 25, 27, 31 on the film. */
const YOU_PICTURES = [10, 14, 17, 19, 24, 26, 30];

describe("a bare role word between two people is never picked blindly (job 417)", () => {
  it("with no viewer, 'a passenger' by the window on a line about 'your thirst' stays nobody's; the story's two keep theirs", () => {
    const scenes = film417();
    markHostBroll(scenes, params417, PHOTO);
    expect(scenes[24].otherPersonLooks).toBeUndefined();
    expect(scenes[3].otherPersonLooks).toEqual([STORY_WOMAN]);
    expect(scenes[6].otherPersonLooks).toEqual([ROW_14]);
    // "He figures she must know somebody": two sexes in one line — the label decides, as before.
    expect(scenes[7].otherPersonLooks).toEqual([ROW_14]);
  });

  it("a sexless 'seated passenger' on the story's 'she' line is the woman the story follows; on a line with both 'he' and 'she', nobody", () => {
    // Scene 8 drawn as its own words ask — "a man passenger … glancing toward a woman passenger" —
    // and scene 9 labelled only by the role the two share.
    const scenes = film417();
    scenes[7] = { ...scenes[7], otherPerson: "two passengers", otherPeople: 2 };
    scenes[8] = { ...scenes[8], otherPerson: "a seated passenger", otherPeople: undefined, showSubject: "a seated passenger by the window", visualPrompt: "a seated passenger by the window" };
    markHostBroll(scenes, params417, PHOTO);
    expect(scenes[7].otherPersonLooks).toEqual([ROW_14, STORY_WOMAN]);
    expect(scenes[8].otherPersonLooks).toEqual([STORY_WOMAN]);

    const both = film417();
    both[7] = { ...both[7], otherPerson: "a seated passenger", showSubject: "a seated passenger looking forward", visualPrompt: "a seated passenger looking forward" };
    markHostBroll(both, params417, PHOTO);
    expect(both[7].otherPersonLooks).toBeUndefined();
  });

  it("matchRecurringPeople: on a line that is the viewer's, two story passengers tied by the role give way to the viewer; otherwise no one", () => {
    const viewerLine = { viewerLine: true };
    expect(matchRecurringPeople("an older passenger and a flight attendant", 2, [ROW_14, STORY_WOMAN], YOU, viewerLine)).toEqual([YOU]);
    // the same picture on a line that also follows a "she": no guess, as before
    expect(matchRecurringPeople("an older passenger and a flight attendant", 2, [ROW_14, STORY_WOMAN], YOU)).toEqual([]);
    expect(matchRecurringPeople("an older passenger and a flight attendant", 2, [ROW_14, STORY_WOMAN], undefined, viewerLine)).toEqual([]);
    // the label's sex still decides between the two, and the story woman by name stays hers
    expect(matchRecurringPeople("a man passenger", 1, [ROW_14, STORY_WOMAN], YOU, viewerLine)).toEqual([ROW_14]);
    expect(matchRecurringPeople("a woman passenger", 1, [ROW_14, STORY_WOMAN], YOU, viewerLine)).toEqual([STORY_WOMAN]);
  });
});

describe("viewerAsk — 'you' drawn as someone else with no look (job 417)", () => {
  it("417: the pictures of 'you' as a passenger are found, with the roles they give 'you'", () => {
    const ask = viewerAsk(film417(), params417, PHOTO);
    expect(ask?.roles.sort()).toEqual(["attendant", "passenger"]);
    for (const id of YOU_PICTURES) expect(ask?.ids).toContain(id);
    // the host's own "I … nursing a thimble of ginger ale" and the story's "she" are never "you"
    expect(ask?.ids).not.toContain(18);
    expect(ask?.ids).not.toContain(8);
  });

  it("nothing is asked with a viewer already written, with no host on camera, or with one picture only", () => {
    expect(viewerAsk(film417(), { ...params417, viewerPerson: YOU }, PHOTO)).toBeUndefined();
    expect(viewerAsk(film417(), params417, undefined)).toBeUndefined();
    expect(viewerAsk(film417(), { ...params417, brollOnly: true }, PHOTO)).toBeUndefined();
    expect(viewerAsk(film417().slice(0, 12), params417, PHOTO)).toBeUndefined();
  });

  it("a seller's 'your customers' are never 'you'", () => {
    const sold = board([
      { scriptText: "Your customers want to see the grain before they pay you.", showSubject: "a customer turning a cutting board over at a market table", otherPerson: "a customer", humanPresent: true },
      { scriptText: "Let your regular customers pick theirs first, and you'll sell the rest by noon.", showSubject: "a customer handing cash across a market table", otherPerson: "a customer", humanPresent: true },
    ]);
    expect(viewerAsk(sold, { hostLook: GIDEON, hostName: "Dale" }, PHOTO)).toBeUndefined();
  });
});

describe("the viewer's one look rides the named-things call (job 417)", () => {
  const answer = (viewer?: object) =>
    JSON.stringify({ kinds: [], pictures: [], ...(viewer ? { viewer } : {}) });

  it("the system prompt asks for a viewer only when the message has THE VIEWER block", () => {
    expect(NAMED_LOOKS_SYSTEM).toContain("5. THE VIEWER — only when the message has a THE VIEWER block");
    expect(NAMED_LOOKS_SYSTEM).toContain("never the host's uniform, badge or work clothes");
  });

  it("417: asked once, in the batch holding the pictures of 'you', and the look is kept for every one of them", async () => {
    const scenes = film417();
    const ask = viewerAsk(scenes, params417, PHOTO)!;
    const calls: string[] = [];
    const out = await describeNamedLooks(scenes, {
      viewer: { ...ask, hostLook: HELENA, hostName: "Helena Hart", people: params417.recurringPeople },
      ask: async (_system, user) => {
        calls.push(user);
        return answer({ name: YOU.name, look: YOU.look });
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('THE VIEWER: these pictures are on lines spoken to "you"');
    expect(calls[0]).toContain("#24 a passenger");
    expect(calls[0]).toContain(`THE HOST (never "you"): ${HELENA}`);
    expect(calls[0]).toContain("PEOPLE ALREADY WRITTEN: passenger in row fourteen:");
    expect(out.viewer).toEqual(YOU);

    markHostBroll(scenes, { ...params417, viewerPerson: out.viewer }, PHOTO);
    for (const id of YOU_PICTURES) expect(scenes[id].otherPersonLooks, `picture #${id + 1}`).toEqual([YOU]);
    // the story's people keep theirs, the host's own line stays the host, a crew-only picture no one
    expect(scenes[3].otherPersonLooks).toEqual([STORY_WOMAN]);
    expect(scenes[6].otherPersonLooks).toEqual([ROW_14]);
    expect(scenes[18].otherPerson).toBeUndefined();
    expect(scenes[16].otherPersonLooks).toBeUndefined();
    const prompt = buildStillPrompt(scenes[24]);
    expect(prompt).toContain("soft teal cardigan");
    expect(prompt).not.toContain("beige cardigan");
  });

  it("no block, no viewer — even when the answer writes one; and a look that cannot keep one person is refused", async () => {
    const scenes = film417();
    const calls: string[] = [];
    const out = await describeNamedLooks(scenes, {
      ask: async (_s, user) => {
        calls.push(user);
        return answer({ name: YOU.name, look: YOU.look });
      },
    });
    expect(calls[0]).not.toContain("THE VIEWER");
    expect(out.viewer).toBeUndefined();

    const ask = { ...viewerAsk(scenes, params417, PHOTO)!, hostName: "Helena Hart", people: params417.recurringPeople };
    // job 412's look: no man or woman, no age, no hair
    expect(acceptViewerLook({ name: "the passenger", look: "an adult of average build, wearing plain clothes" }, ask)).toBeUndefined();
    // a role the pictures never gave "you", a story person's own name, the host
    expect(acceptViewerLook({ name: "the patient", look: YOU.look }, ask)).toBeUndefined();
    expect(acceptViewerLook({ name: "woman passenger", look: YOU.look }, ask)).toBeUndefined();
    expect(acceptViewerLook({ name: "the host", look: YOU.look }, ask)).toBeUndefined();
    expect(acceptViewerLook({ name: "the passenger", look: YOU.look }, ask)).toEqual(YOU);
  });

  it("parseNamedLooks reads a viewer beside the kinds, and nothing when it is missing or empty", () => {
    expect(parseNamedLooks(answer({ name: "the passenger", look: YOU.look }))?.viewer).toEqual({ name: "the passenger", look: YOU.look });
    expect(parseNamedLooks(answer())?.viewer).toBeUndefined();
    expect(parseNamedLooks(answer({ name: "", look: "" }))?.viewer).toBeUndefined();
  });
});
