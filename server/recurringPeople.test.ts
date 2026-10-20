/**
 * PEOPLE WHO COME BACK keep one look (2026-10-18, the review of job 399). The story follows two
 * passengers: "she" is a short-haired blonde in a puffer jacket in scene 2, a young dark-haired woman
 * in scene 4 and a grey-blonde with older hands in scene 5 — 13 s apart — and "he" changes in scenes
 * 2, 7 and 8, because every picture of them was drawn from a label ("a woman passenger") alone. The
 * props-list call now also writes `PERSON name: look` for anyone the story comes back to, and each
 * picture of them is drawn with that look. Someone the story shows once gets nothing new. The scene
 * words below are the real stored ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringPerson, StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import { hostWordsAsViewer, markHostBroll, matchRecurringPeople, personKey, picturesTheViewer } from "./hostLook";
import {
  CONTINUITY_SYSTEM,
  deriveContinuitySheet,
  FIT_SYSTEM,
  fitPicturesToLines,
  isPersonLine,
  isViewerLine,
  MAX_RECURRING_PEOPLE,
  otherPersonFor,
  parseKeyThings,
  parsePictureFixes,
  parseRecurringPeople,
  parseViewerPerson,
  planShotList,
  whoOf,
  withoutPersonLines,
} from "./shotList";
import { buildStillPrompt, otherPersonClause } from "./longformVideo";

beforeEach(() => mockInvoke.mockReset());

// Job 399's real props list (things only — written before PERSON lines existed).
const PROPS_399 = [
  "aircraft cabin interior: narrow rows of blue upholstered seats, grey plastic overhead bins, dim carpeted aisle, front galley with metal counters",
  "MAIN beverage cart: metal trolley with two tiers, rows of soda cans and small liquor bottles lined on top, stocked with ice-filled plastic cups",
  "plastic cup: clear hard plastic, filled with ice cubes, half-filled with soda, no markings",
  "soda can: aluminum can, plain silver body, condensation beads, sits upright on cart tray",
  "pretzel basket: small woven plastic basket, shallow, holding individual pretzel bags",
  "row fourteen seat: blue fabric seat, fold-down tray table, worn armrests, aisle-side position",
].join("\n");
const SHE = "a woman in her late sixties, short silver hair in a neat bob, a lilac cardigan over a white blouse, grey slacks";
const HE = "a man in his late sixties, thinning grey hair, a navy quarter-zip sweater over a collared shirt, khaki trousers";
const PEOPLE_LINES_399 = [`PERSON the woman passenger: ${SHE}`, `PERSON the other passenger: ${HE}`].join("\n");
const WOMAN: RecurringPerson = { name: "the woman passenger", look: SHE };
const OTHER: RecurringPerson = { name: "the other passenger", look: HE };
const PASSENGERS = [WOMAN, OTHER];

const HOST_LOOK =
  "A slender woman in her late thirties with fair skin and dark hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

describe("parseRecurringPeople — the PERSON lines of a props list", () => {
  it("reads job 399's two passengers and leaves the props list exactly as it was", () => {
    const sheet = `${PROPS_399}\n${PEOPLE_LINES_399}`;
    expect(parseRecurringPeople(sheet)).toEqual(PASSENGERS);
    expect(withoutPersonLines(sheet)).toBe(PROPS_399);
    expect(parseKeyThings(sheet)).toEqual(parseKeyThings(PROPS_399));
    expect(parseKeyThings(sheet).map(k => k.name)).not.toContain("the woman passenger");
  });

  it("a PERSON line written first never takes the home line's place", () => {
    const sheet = `${PEOPLE_LINES_399}\n${PROPS_399}`;
    expect(parseKeyThings(sheet)).toEqual(parseKeyThings(PROPS_399));
    expect(parseKeyThings(sheet)[0]).toMatchObject({ name: "beverage cart", main: true });
  });

  it("a props list written before has no people (job 399's real list)", () => {
    expect(parseRecurringPeople(PROPS_399)).toEqual([]);
    expect(parseRecurringPeople(undefined)).toEqual([]);
  });

  it("reads bullets, a colon after PERSON and markdown, and trims the look", () => {
    expect(parseRecurringPeople(`- PERSON: **the neighbour**: a tall man in his seventies, thin white hair combed back, a green jacket.`)).toEqual([
      { name: "the neighbour", look: "a tall man in his seventies, thin white hair combed back, a green jacket" },
    ]);
    expect(isPersonLine("3. PERSON my sister: a woman in her forties")).toBe(true);
    expect(isPersonLine("personal shopper bag: a paper bag")).toBe(false);
    expect(isPersonLine("person-sized crate: a tall slatted pine crate")).toBe(false);
    expect(isPersonLine("MAIN beverage cart: metal trolley")).toBe(false);
  });

  it("drops the host, the viewer, an animal, a group, a too-short look and a repeated name", () => {
    const sheet = [
      `PERSON the host: ${HOST_LOOK}`,
      `PERSON you: a person in a grey coat and jeans`,
      `PERSON Helena: ${HOST_LOOK}`,
      `PERSON Helena Hart: ${HOST_LOOK}`,
      `PERSON the dog: a scruffy brown terrier with a red collar`,
      `PERSON the passengers: people in casual travel clothes`,
      `PERSON the neighbour: tall`,
      `PERSON the woman passenger: ${SHE}`,
      `PERSON The woman passenger: a young woman in a red coat`,
    ].join("\n");
    expect(parseRecurringPeople(sheet, { hostName: "Helena Hart" })).toEqual([WOMAN]);
  });

  it("keeps someone named after the host, who is not the host", () => {
    const sister = `PERSON Helena's sister: a woman in her forties, long auburn hair, a green raincoat, dark jeans`;
    expect(parseRecurringPeople(sister, { hostName: "Helena Hart" })).toHaveLength(1);
  });

  it("keeps at most MAX_RECURRING_PEOPLE", () => {
    const many = ["the baker", "the farmer", "the mechanic", "the teacher", "the nurse"]
      .map(n => `PERSON ${n}: a person in their fifties, short brown hair, a plain blue shirt, dark trousers`)
      .join("\n");
    expect(parseRecurringPeople(many)).toHaveLength(MAX_RECURRING_PEOPLE);
  });
});

describe("deriveContinuitySheet — the same call writes the people, last", () => {
  it("asks for PERSON lines only for someone the story comes back to", () => {
    expect(CONTINUITY_SYSTEM).toMatch(/PERSON name: look/);
    expect(CONTINUITY_SYSTEM).toMatch(/two or more different sentences/);
    expect(CONTINUITY_SYSTEM).toMatch(/never\s+someone in only one sentence/);
    expect(CONTINUITY_SYSTEM).toMatch(/No PERSON line when nobody comes back/);
    expect(CONTINUITY_SYSTEM).toMatch(/no people in these lines/);
  });

  it("puts the PERSON lines after the props, caps them on their own and drops a heading", async () => {
    mockInvoke.mockResolvedValue({
      text: `PEOPLE:\n${PEOPLE_LINES_399}\n${PROPS_399}\nPERSON the pilot: a man in his fifties, short dark hair, a white shirt with epaulettes, dark trousers\nPERSON the gate agent: a woman in her thirties, a dark ponytail, a navy cardigan, grey trousers\nPERSON the cleaner: a woman in her fifties, grey curls, a blue tabard over a white tee, black trousers`,
    });
    const sheet = await deriveContinuitySheet("script");
    const lines = sheet.split("\n");
    expect(lines.slice(0, 6).join("\n")).toBe(PROPS_399);
    expect(lines.slice(6).every(isPersonLine)).toBe(true);
    expect(lines.slice(6)).toHaveLength(MAX_RECURRING_PEOPLE);
    expect(sheet).not.toMatch(/^PEOPLE:/m);
    expect(parseRecurringPeople(sheet).slice(0, 2)).toEqual(PASSENGERS);
  });

  it("a list with no props is no list, PERSON lines or not", async () => {
    mockInvoke.mockResolvedValue({ text: PEOPLE_LINES_399 });
    expect(await deriveContinuitySheet("script")).toBe("");
  });
});

describe("matchRecurringPeople — which recurring person a picture's someone-else is", () => {
  it("job 399 scenes 5 and 7: the woman and the man, by role and by the sex their look gives", () => {
    expect(matchRecurringPeople("a woman passenger", 1, PASSENGERS)).toEqual([WOMAN]); // scenes 4, 5
    expect(matchRecurringPeople("a male passenger", 1, PASSENGERS)).toEqual([OTHER]); // scene 7
    expect(matchRecurringPeople("the other passenger", 1, PASSENGERS)).toEqual([OTHER]); // the planner given the names
  });

  it("job 399 scene 2: two passengers are both of them; scene 8: the man beside an attendant", () => {
    expect(matchRecurringPeople("two airline passengers", 2, PASSENGERS)).toEqual([WOMAN, OTHER]);
    expect(matchRecurringPeople("a male passenger", 2, PASSENGERS)).toEqual([OTHER]);
    expect(matchRecurringPeople("a flight attendant and a male passenger", 2, PASSENGERS)).toEqual([OTHER]);
  });

  it("never guesses: a passenger who fits both, a role nobody has, a sex against the look", () => {
    expect(matchRecurringPeople("a seated passenger", 1, PASSENGERS)).toEqual([]); // scene 14
    expect(matchRecurringPeople("a passenger", 1, PASSENGERS)).toEqual([]); // scene 23
    expect(matchRecurringPeople("a flight attendant", 1, PASSENGERS)).toEqual([]);
    expect(matchRecurringPeople("a woman customer", 1, PASSENGERS)).toEqual([]);
    expect(matchRecurringPeople("a woman passenger", 1, [OTHER])).toEqual([]);
    expect(matchRecurringPeople("two airline passengers", 2, [...PASSENGERS, { name: "the third passenger", look: SHE }])).toEqual([]);
  });

  it("one recurring passenger is any passenger the pictures name", () => {
    expect(matchRecurringPeople("a seated passenger", 1, [WOMAN])).toEqual([WOMAN]);
  });

  it("a bare man or woman is not a story's person; the same name or noun phrase is (job 400)", () => {
    const man: RecurringPerson = { name: "the man in the card aisle", look: "a man of sixty-four, short grey hair, a tan raincoat over a blue shirt" };
    const old: RecurringPerson = { name: "the old man", look: "a man in his eighties, white hair, a brown cardigan, grey trousers" };
    expect(matchRecurringPeople("the man in the card aisle", 1, [man])).toEqual([man]);
    expect(matchRecurringPeople("a man", 1, [man])).toEqual([]);
    expect(matchRecurringPeople("a young man", 1, [man])).toEqual([]); // job 400 scene 33
    expect(matchRecurringPeople("an old man", 1, [old])).toEqual([old]);
    expect(matchRecurringPeople("a man", 1, [old])).toEqual([]);
  });

  it("a proper name is found in the label; a relation by its noun", () => {
    const seneca: RecurringPerson = { name: "Seneca", look: "a Roman man in his sixties, close-cropped grey hair, a cream wool toga with a dark border" };
    expect(matchRecurringPeople("Seneca", 1, [seneca])).toEqual([seneca]);
    expect(matchRecurringPeople("Seneca writing at his desk", 1, [seneca])).toEqual([seneca]);
    expect(matchRecurringPeople("a Roman senator", 1, [seneca])).toEqual([]); // job 400 scene 31
    const sister: RecurringPerson = { name: "my sister", look: "a woman in her forties, long auburn hair, a green raincoat, dark jeans" };
    expect(matchRecurringPeople("the host's sister", 1, [sister])).toEqual([sister]);
    expect(matchRecurringPeople("an older brother", 1, [sister])).toEqual([]);
  });

  it("nothing without people or a name", () => {
    expect(matchRecurringPeople("a woman passenger", 1, [])).toEqual([]);
    expect(matchRecurringPeople("a woman passenger", 1, undefined)).toEqual([]);
    expect(matchRecurringPeople(undefined, 1, PASSENGERS)).toEqual([]);
    expect(personKey("The woman passenger's")).toBe("woman passenger");
  });
});

describe("otherPersonClause — the look in the picture prompt", () => {
  it("one recurring person: their look, the same in every picture, face still never shown", () => {
    const c = otherPersonClause("a woman passenger", 1, [WOMAN]);
    expect(c).toMatch(/^The only person in this shot is a woman passenger — NOT the video's host, and the same person in every picture of them in this video, always drawn exactly like this: a woman in her late sixties, short silver hair/);
    expect(c).toContain(`${SHE}. Seen from behind or from the side`);
    expect(c).toMatch(/so it is never shown/);
    expect(c).not.toMatch(/a different, ordinary person/);
  });

  it("without a look the clause is word for word what it was", () => {
    expect(otherPersonClause("a woman customer", 1, [])).toBe(otherPersonClause("a woman customer"));
    expect(otherPersonClause("a woman customer")).toMatch(/^The only person in this shot is a woman customer — NOT the video's host, a different, ordinary person of that description: seen from behind/);
    expect(otherPersonClause("two passengers", 2)).not.toMatch(/same people|One of them is/);
  });

  it("two people: each one's look, or the one who comes back", () => {
    const both = otherPersonClause("two airline passengers", 2, PASSENGERS);
    expect(both).toMatch(/NONE of them the video's host/);
    expect(both).toContain(`the woman passenger: ${SHE}; the other passenger: ${HE}.`);
    const one = otherPersonClause("a male passenger", 2, [OTHER]);
    expect(one).toContain(`One of them is the other passenger, the same person in every picture of them in this video, always drawn exactly like this: ${HE}.`);
    expect(one).toMatch(/Each person has exactly two arms/);
  });
});

describe("markHostBroll stamps the look; every picture of her gets the same one (job 399)", () => {
  const scenes = () => [
    pic(2, "two passengers seated in the same cabin row", {
      visualPrompt: "Two passengers seated side by side in blue fabric airplane seats in the cabin, row fourteen visible, aisle-side positions, both looking forward, aircraft cabin behind them.",
      humanPresent: true,
      otherPerson: "two airline passengers",
    }),
    pic(5, "a second pretzel bag held in a passenger's hand", {
      visualPrompt: "Bare weathered hands holding a sealed clear plastic pretzel bag, fingers gripping the wrapper, seated in the aircraft cabin with a blue seat visible behind.",
      humanPresent: true,
      otherPerson: "a woman passenger",
    }),
    pic(7, "a passenger in row fourteen holding a cup with a little soda over ice", {
      visualPrompt: "Bare weathered hands holding a clear plastic cup filled with ice cubes and a half-cup of soda, seated in row fourteen of the aircraft cabin.",
      humanPresent: true,
      otherPerson: "a male passenger",
    }),
    pic(14, "a flight attendant speaking politely to a seated passenger", {
      visualPrompt: "Bare hands from the forearms down, adjusting a beverage cup on the cart tray in the aircraft aisle galley during service.",
      humanPresent: true,
      otherPerson: "a seated passenger",
    }),
    pic(16, "hands pouring soda into an ice-filled plastic cup at the cart", { humanPresent: true }),
  ];

  it("scene 2 gets both, scene 5 hers, scene 7 his; scene 14 and the host's hands get none", () => {
    const s = scenes();
    markHostBroll(s, { hostLook: HOST_LOOK, recurringPeople: PASSENGERS }, "https://x/host.png");
    expect(s[0].otherPersonLooks).toEqual(PASSENGERS);
    expect(s[1].otherPersonLooks).toEqual([WOMAN]);
    expect(s[2].otherPersonLooks).toEqual([OTHER]);
    expect(s[3].otherPersonLooks).toBeUndefined();
    expect(s[4].otherPersonLooks).toBeUndefined();
    expect(s[4].brollHostLook).toBe(HOST_LOOK);
    expect(buildStillPrompt(s[0])).toContain(SHE);
    expect(buildStillPrompt(s[0])).toContain(HE);
    expect(buildStillPrompt(s[1])).toContain(SHE);
    expect(buildStillPrompt(s[1])).not.toContain(HE);
    expect(buildStillPrompt(s[2])).toContain(HE);
    expect(buildStillPrompt(s[3])).not.toContain(SHE);
    expect(buildStillPrompt(s[4])).not.toContain(SHE);
  });

  it("a video with no recurring people draws exactly as before, and a re-run leaves no stale look", () => {
    const before = scenes();
    markHostBroll(before, { hostLook: HOST_LOOK }, "https://x/host.png");
    expect(before.every(x => x.otherPersonLooks === undefined)).toBe(true);
    const plain = scenes();
    markHostBroll(plain, { hostLook: HOST_LOOK, recurringPeople: [] }, "https://x/host.png");
    expect(plain.map(x => buildStillPrompt(x))).toEqual(before.map(x => buildStillPrompt(x)));
    const again = scenes();
    markHostBroll(again, { hostLook: HOST_LOOK, recurringPeople: PASSENGERS }, "https://x/host.png");
    markHostBroll(again, { hostLook: HOST_LOOK }, "https://x/host.png");
    expect(again.every(x => x.otherPersonLooks === undefined)).toBe(true);
  });
});

describe("planShotList hands the planner the NAMES of the people who come back, never their looks", () => {
  const beat = (index: number, scriptText: string) =>
    ({ index, narration: scriptText, scriptText, visualPrompt: "a cabin", showSubject: "a cabin" }) as StoryboardScene;

  it("lists the names, so a shot of one says it the same way every time", async () => {
    mockInvoke.mockResolvedValue({ text: '{"beats":[]}' });
    await planShotList([beat(1, "Two people paid the same fare, boarded the same flight"), beat(2, "The other was still in row fourteen with a few inches of soda")], {
      sheet: PROPS_399,
      people: PASSENGERS,
    });
    const { userMessage, systemPrompt } = mockInvoke.mock.calls[0][0];
    expect(userMessage).toContain("PEOPLE WHO COME BACK (never the host; when a shot's other person under rule 6a is one of them, other is this name exactly): the woman passenger | the other passenger");
    expect(userMessage).not.toContain(SHE);
    expect(systemPrompt).toMatch(/When that person is one of the PEOPLE WHO COME BACK/);
  });

  it("no line when nobody comes back", async () => {
    mockInvoke.mockResolvedValue({ text: '{"beats":[]}' });
    await planShotList([beat(1, "Two people paid the same fare, boarded the same flight")], { sheet: PROPS_399, people: [] });
    expect(mockInvoke.mock.calls[0][0].userMessage).not.toContain("PEOPLE WHO COME BACK");
  });
});

describe("the review's follow-ups: a label that sets someone apart, a crowd, a vague name", () => {
  const MAN: RecurringPerson = { name: "the man passenger", look: HE };
  const WOMAN_ROLE: RecurringPerson = { name: "the woman passenger", look: SHE };

  it("the props call asks for names that say WHAT the person is, never 'the other'", () => {
    expect(CONTINUITY_SYSTEM).toMatch(/name is 1-5 plain words saying WHAT they are/);
    expect(CONTINUITY_SYSTEM).toMatch(/never only a pronoun, "one of them" or "the other"/);
  });

  it("job 399 with role names (what the prompt asks): each label finds its own passenger", () => {
    const both = [WOMAN_ROLE, MAN];
    expect(matchRecurringPeople("a woman passenger", 1, both)).toEqual([WOMAN_ROLE]);
    expect(matchRecurringPeople("a male passenger", 1, both)).toEqual([MAN]);
    expect(matchRecurringPeople("a flight attendant and a male passenger", 2, both)).toEqual([MAN]);
    expect(matchRecurringPeople("two airline passengers", 2, both)).toEqual(both);
    expect(matchRecurringPeople("a seated passenger", 1, both)).toEqual([]);
    expect(matchRecurringPeople("the other passenger", 1, both)).toEqual([]); // could be either: no guess
  });

  it("a label that says it is someone ELSE never takes the one recurring look", () => {
    expect(matchRecurringPeople("another passenger", 1, [WOMAN])).toEqual([]);
    expect(matchRecurringPeople("a second passenger", 1, [WOMAN])).toEqual([]);
    expect(matchRecurringPeople("a different passenger", 1, [WOMAN])).toEqual([]);
    const buyer: RecurringPerson = { name: "the woman buyer", look: SHE };
    expect(matchRecurringPeople("a new buyer", 1, [buyer])).toEqual([]);
    expect(matchRecurringPeople("the next buyer", 1, [buyer])).toEqual([]);
    // …unless the name sets them apart the same way, and a plain role still matches.
    const other: RecurringPerson = { name: "the other woman customer", look: SHE };
    expect(matchRecurringPeople("the other customer", 1, [other])).toEqual([other]);
    expect(matchRecurringPeople("a buyer", 1, [buyer])).toEqual([buyer]);
    expect(matchRecurringPeople("the other passenger", 1, PASSENGERS)).toEqual([OTHER]);
    // "next to" is a place, not a second one.
    expect(matchRecurringPeople("a flight attendant next to a passenger", 2, [WOMAN])).toEqual([WOMAN]);
  });

  it("only a stated two is the story's two: a crowd, 'several' or a bare plural takes nobody", () => {
    expect(matchRecurringPeople("both passengers", 2, PASSENGERS)).toEqual(PASSENGERS);
    expect(matchRecurringPeople("two passengers", 2, [WOMAN])).toEqual([WOMAN]);
    expect(matchRecurringPeople("several passengers", 3, PASSENGERS)).toEqual([]);
    expect(matchRecurringPeople("three passengers", 3, PASSENGERS)).toEqual([]);
    expect(matchRecurringPeople("passengers boarding the plane", 2, PASSENGERS)).toEqual([]);
    expect(matchRecurringPeople("a crowd of passengers", 3, PASSENGERS)).toEqual([]);
  });

  it("a vague name matches only its own words; a proper name is found inside a label", () => {
    const vague: RecurringPerson = { name: "the other", look: HE };
    expect(matchRecurringPeople("the other customer", 1, [vague])).toEqual([]);
    expect(matchRecurringPeople("the other", 1, [vague])).toEqual([vague]); // the planner copied it
    const joe: RecurringPerson = { name: "Grandpa Joe", look: "a man in his eighties, white hair, a red flannel shirt, braces, grey trousers" };
    expect(matchRecurringPeople("Grandpa Joe at his bench", 1, [joe])).toEqual([joe]);
    expect(matchRecurringPeople("a grandfather", 1, [joe])).toEqual([]);
  });

  it("two looks beside a third person are two of them, not all of them", () => {
    expect(matchRecurringPeople("a flight attendant and two passengers", 3, PASSENGERS)).toEqual(PASSENGERS);
    const three = otherPersonClause("a flight attendant and two passengers", 3, PASSENGERS);
    expect(three).toMatch(/Two of them are the same people in every picture of them/);
    expect(three).not.toMatch(/They are the same people/);
    expect(otherPersonClause("two airline passengers", 2, PASSENGERS)).toMatch(/They are the same people in every picture of them/);
  });
});

// ─── THE VIEWER: "you" when the host's job serves them (round 11, jobs 402 and 405) ─────────

// Job 402's host (her look as stored) and the viewer its props call would now write.
const CREW_LOOK =
  "A slender woman in her forties with fair skin and brown hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
const FLYER = "a woman in her seventies, short silver hair, a cream knit cardigan over a pale blue blouse, grey slacks";
const PASSENGER: RecurringPerson = { name: "the passenger", look: FLYER };
// Job 405: the sleeper the cat walks across.
const SLEEPER_LOOK = "a woman in her thirties, shoulder-length brown hair, a plain grey sleep shirt";
const OWNER: RecurringPerson = { name: "the cat owner", look: SLEEPER_LOOK };
const LUCA_LOOK =
  "A man in his forties with olive skin, dark wavy hair and a full beard, wearing a white t-shirt under an open olive-green shirt";

const line = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  pic(index, show, { scriptText, narration: scriptText, ...over });
// Job 402 scenes 17 and 20, as stored.
const s402_17 = () =>
  line(17, "On many of those carriers, you can have the whole thing just by asking.", "a full soda can held upright near a passenger's tray", {
    visualPrompt: "Bare hands holding a slim aluminum soda can upright, positioned near a passenger's lap tray in an aircraft seat. Aircraft cabin interior visible in background.",
    humanPresent: true,
  });
const s402_20 = () =>
  line(
    20,
    "Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying. One more thing about drinks, because it catches good people off guard.",
    "plastic cup filled with juice-colored drink on a lap tray",
    {
      visualPrompt: "Clear plastic cup filled with juice-colored drink sitting on a passenger's lap tray in an aircraft seat. Aircraft cabin interior visible in background.",
      humanPresent: true,
    }
  );
// Job 405 scenes 1-10 (the host's opening line, the cat's walk across "you", the split, the annoyed few).
const film405 = () => [
  line(1, "Three in the morning. The house is dark, the street outside has gone quiet, and somewhere in that quiet,", "the host", { hostPresent: true }),
  line(2, "a small set of paws has just landed on the foot of your bed. She doesn’t hurry. She walks the full length of you,", "a tabby cat with white-socked paws walking slowly across the bed sheets at night"),
  line(3, "ankle,", "a small short-haired tabby cat stepping onto the ankle of a sleeping person under pale grey sheets at night", {
    visualPrompt: "A small grey and brown tabby cat with white paws stepping onto the ankle area of pale grey sheets on a bed at night.",
    humanPresent: true, otherPerson: "a sleeping person", listCut: true,
  }),
  line(4, "knee,", "a tabby cat's white-socked paw pressing onto a blanketed knee on the bed at night", { listCut: true }),
  line(5, "hip,", "a small tabby cat balancing on the hip of a person sleeping on their side under pale grey sheets at night", {
    visualPrompt: "A small grey and brown tabby cat balancing on the hip area of a person lying on their side under pale grey sheets at night.",
    humanPresent: true, otherPerson: "a sleeping person", listCut: true,
  }),
  line(6, "ribs,", "a tabby cat's white-socked paws stepping across the blanketed ribs of a sleeping person at night", {
    visualPrompt: "A small tabby cat's white-socked paws stepping across the ribs area of a blanketed sleeping body at night on pale grey sheets.",
    humanPresent: true, otherPerson: "a sleeping person", listCut: true,
  }),
  line(7, "steady as a tightrope walker, because she has made this crossing a hundred times before.", "a small tabby cat standing on a sleeping person's chest in the dark bedroom, head lowered close to their face, waiting", {
    visualPrompt: "A small grey and brown tabby cat standing on a person's chest in a dark bedroom, head lowered close to the sleeping person's face, waiting still.",
    humanPresent: true, otherPerson: "a sleeping person",
  }),
  line(8, "Then she stops on your chest, lowers her face to yours, and waits.", "a small tabby cat standing on a sleeping person's chest in the dark bedroom, head lowered close to their face, waiting", {
    humanPresent: true, otherPerson: "a sleeping person",
  }),
  line(9, "A lot of people call this random, a cat just being a cat.", "a tabby cat resting calmly on the bed in soft lamp light", { hostPresent: true }),
  line(10, "A few people, half awake and fully annoyed, call it revenge. Here’s the thing, though. It’s neither.", "a person half sitting up in the bed at night, seen from the side, frowning at the tabby cat sitting on the blanket", {
    visualPrompt: "A person half sitting up in bed at night viewed from the side, frowning at a grey and brown tabby cat sitting on the pale blanket beside them.",
    humanPresent: true, otherPerson: "a half awake annoyed person",
  }),
];

describe("parseViewerPerson — the props list's VIEWER line", () => {
  const sheet = `${PROPS_399}\n${PEOPLE_LINES_399}\nVIEWER the passenger: ${FLYER}`;

  it("reads who 'you' is and keeps the line out of the props, the key things and the people", () => {
    expect(parseViewerPerson(sheet)).toEqual(PASSENGER);
    expect(isViewerLine(`VIEWER the passenger: ${FLYER}`)).toBe(true);
    expect(isViewerLine("- VIEWER: the patient: a man in his eighties, thin white hair, a grey cardigan")).toBe(true);
    expect(isViewerLine("viewer-facing shelf: a pine shelf at eye height")).toBe(false);
    expect(isViewerLine("Viewer seat: a padded folding chair at the front row")).toBe(false);
    expect(isViewerLine("Viewer: the patient: a man in his eighties, thin white hair, a grey cardigan")).toBe(true);
    expect(withoutPersonLines(sheet)).toBe(PROPS_399);
    expect(parseKeyThings(sheet)).toEqual(parseKeyThings(PROPS_399));
    expect(parseRecurringPeople(sheet)).toEqual(PASSENGERS);
  });

  it("an owner may be the viewer (it reads as the host anywhere else)", () => {
    expect(parseViewerPerson(`${PROPS_399}\nVIEWER the cat owner: ${SLEEPER_LOOK}`)).toEqual(OWNER);
  });

  it("no line, 'you', the viewer, the host, a group, an animal or a look too short: you stay the host", () => {
    expect(parseViewerPerson(PROPS_399)).toBeUndefined();
    expect(parseViewerPerson(undefined)).toBeUndefined();
    expect(parseViewerPerson(`VIEWER you: ${FLYER}`)).toBeUndefined();
    expect(parseViewerPerson(`VIEWER the viewer: ${FLYER}`)).toBeUndefined();
    expect(parseViewerPerson(`VIEWER the host: ${FLYER}`)).toBeUndefined();
    expect(parseViewerPerson(`VIEWER Helena Hart: ${FLYER}`, { hostName: "Helena Hart" })).toBeUndefined();
    expect(parseViewerPerson(`VIEWER the passengers: ${FLYER}`)).toBeUndefined();
    expect(parseViewerPerson(`VIEWER a hen: ${FLYER}`)).toBeUndefined();
    expect(parseViewerPerson("VIEWER the passenger: a woman")).toBeUndefined();
  });
});

describe("deriveContinuitySheet asks who 'you' is, from how the host looks", () => {
  it("the prompt: the host's job serving 'you' makes a VIEWER line; a how-to never does", () => {
    expect(CONTINUITY_SYSTEM).toMatch(/VIEWER name: look/);
    expect(CONTINUITY_SYSTEM).toMatch(/someone the HOST'S OWN JOB SERVES/);
    expect(CONTINUITY_SYSTEM).toMatch(/never the host's\s+uniform, badge or work clothes/);
    expect(CONTINUITY_SYSTEM).toMatch(/No VIEWER line\s+when "you" does the host's own kind of work \(a how-to/);
    // Neutral examples only.
    expect(CONTINUITY_SYSTEM).not.toMatch(/passenger|flight|crew|\bcats?\b|sleep/i);
  });

  it("sends the host's look, keeps the VIEWER line last, one only", async () => {
    mockInvoke.mockResolvedValue({
      text: `${PROPS_399}\nVIEWER the passenger: ${FLYER}\n${PEOPLE_LINES_399}\nVIEWER the traveller: ${SHE}`,
    });
    const sheet = await deriveContinuitySheet("script", { host: CREW_LOOK });
    // Written with dashes, never as a `name: look` line the model can echo back as a prop (job 410).
    expect(mockInvoke.mock.calls[0][0].userMessage).toContain(
      `THE HOST (the narrator, on camera; never a line of the list) looks — ${CREW_LOOK}`
    );
    expect(mockInvoke).toHaveBeenCalledTimes(1); // nothing owed, no second call
    const lines = sheet.split("\n");
    expect(lines.slice(0, 6).join("\n")).toBe(PROPS_399);
    expect(lines.slice(6, 8).every(isPersonLine)).toBe(true);
    expect(lines.slice(8)).toEqual([`VIEWER the passenger: ${FLYER}`]);
    expect(parseViewerPerson(sheet)).toEqual(PASSENGER);
  });

  it("no host line without a host look", async () => {
    mockInvoke.mockResolvedValue({ text: PROPS_399 });
    await deriveContinuitySheet("script");
    expect(mockInvoke.mock.calls[0][0].userMessage).not.toContain("THE HOST");
  });
});

describe("the planner and the line check name the viewer, never the host", () => {
  const beat = (index: number, scriptText: string) =>
    ({ index, narration: scriptText, scriptText, visualPrompt: "a cabin", showSubject: "a cabin" }) as StoryboardScene;

  it("planShotList: THE VIEWER by name, rule 6a lets 'you' be them; 'you' comes back as their name", async () => {
    mockInvoke.mockResolvedValue({
      text: JSON.stringify({
        beats: [
          { beat: 17, shots: [{ from: "On many", show: "a passenger holding a full soda can over the tray", other: "you", held: true }] },
          { beat: 20, shots: [{ from: "Juice works", show: "a cup of juice on a passenger's tray", other: "the viewer" }] },
        ],
      }),
    });
    const plans = await planShotList([beat(17, "On many of those carriers, you can have the whole thing just by asking."), beat(20, "Juice works the same way.")], {
      sheet: PROPS_399,
      hostLook: CREW_LOOK,
      viewer: PASSENGER,
    });
    const { userMessage, systemPrompt } = mockInvoke.mock.calls[0][0];
    expect(userMessage).toContain(`THE VIEWER ("you" in this script — someone the host's work serves, never the host; rule 6a: in every shot of "you", other is this name exactly): the passenger`);
    expect(userMessage).not.toContain(FLYER);
    expect(systemPrompt).toMatch(/never "you" \(the viewer's work is\s+shown as the host's\) unless THE VIEWER is given below/);
    expect(systemPrompt).toMatch(/When THE VIEWER is given\s+below, "you" is that person and never the host/);
    expect(plans.map(p => p.shots[0].other)).toEqual(["the passenger", "the passenger"]);
  });

  it("planShotList without a viewer: no line, and 'you' is no one else (the host, as before)", async () => {
    mockInvoke.mockResolvedValue({ text: JSON.stringify({ beats: [{ beat: 1, shots: [{ from: "You charge", show: "the host sharpening a blade", other: "you" }] }] }) });
    const plans = await planShotList([beat(1, "You charge five to ten dollars a knife.")], { sheet: PROPS_399 });
    expect(mockInvoke.mock.calls[0][0].userMessage).not.toContain("THE VIEWER");
    expect(plans[0].shots[0].other).toBeUndefined();
  });

  it("otherPersonFor / whoOf: 'you' is the viewer when there is one, the host when not", () => {
    expect(otherPersonFor("you", PASSENGER)).toBe("the passenger");
    expect(otherPersonFor("The viewer.", PASSENGER)).toBe("the passenger");
    expect(otherPersonFor("you (the viewer)", PASSENGER)).toBe("the passenger");
    expect(otherPersonFor("an older passenger", PASSENGER)).toBe("an older passenger");
    expect(otherPersonFor("the host", PASSENGER)).toBeUndefined();
    expect(otherPersonFor("you")).toBeUndefined();
    expect(whoOf("you", PASSENGER)).toBe("the passenger");
    expect(whoOf("your hands", PASSENGER)).toBe("the passenger");
    expect(whoOf("the viewer", PASSENGER)).toBe("the passenger");
    expect(whoOf("yourself", PASSENGER)).toBe("the passenger");
    expect(whoOf("the passenger", PASSENGER)).toBe("the passenger");
    expect(whoOf("host", PASSENGER)).toBeNull();
    expect(whoOf("the host's hands", PASSENGER)).toBeNull();
    // A viewer's customer is still not the viewer.
    expect(whoOf("your customer", PASSENGER)).toBe("the customer");
    // No viewer: exactly as before.
    expect(whoOf("you")).toBeNull();
    expect(whoOf("your hands")).toBeNull();
    expect(whoOf("yourself")).toBeNull();
  });

  it("the line check is told the viewer, and its 'you' becomes their name on the picture (job 402 scene 20)", async () => {
    expect(FIT_SYSTEM).toMatch(/When THE\s+VIEWER is given, the viewer the line speaks to is never the host/);
    expect(FIT_SYSTEM).not.toMatch(/passenger|flight|crew|\bcats?\b/i);
    const scenes = [s402_17(), s402_20()];
    mockInvoke.mockResolvedValue({
      text: JSON.stringify({
        pictures: [
          { id: 0, about: "keeping the whole can", shows_it: true, who: "you" },
          { id: 1, about: "asking for juice", shows_it: true, who: "your hands" },
        ],
      }),
    });
    const r = await fitPicturesToLines(scenes, { viewer: PASSENGER });
    expect(mockInvoke.mock.calls[0][0].userMessage).toContain(`THE VIEWER ("you" in this script — someone the host's work serves, never "host"): the passenger`);
    expect(r.scenes.map(s => s.otherPerson)).toEqual(["the passenger", "the passenger"]);
    // Without the viewer the same answers are the host's, as before.
    const fixes = parsePictureFixes(
      JSON.stringify({ pictures: [{ id: 0, about: "x", shows_it: true, who: "you" }] }),
      [s402_17()]
    );
    expect(fixes[0].who).toBeNull();
  });
});

describe("markHostBroll draws the viewer as one ordinary person, never the host (jobs 402 and 405)", () => {
  it("job 402 scenes 17 and 20: the passenger with her one look, not the host in her crew uniform", () => {
    const scenes = [s402_17(), s402_20()];
    markHostBroll(scenes, { hostLook: CREW_LOOK, hostName: "Helena Hart", viewerPerson: PASSENGER }, "https://x/host.png");
    for (const s of scenes) {
      expect(s.otherPerson).toBe("the passenger");
      expect(s.otherPersonLooks).toEqual([PASSENGER]);
      expect(s.brollHostLook).toBeUndefined();
      expect(s.brollHostRef).toBeUndefined();
      const prompt = buildStillPrompt(s);
      expect(prompt).toContain(FLYER);
      expect(prompt).not.toMatch(/blazer|gold pin|striped scarf/);
      expect(prompt).toMatch(/NOT the video's host/);
    }
  });

  it("the same pictures with no viewer are the host's, exactly as before", () => {
    const scenes = [s402_17(), s402_20()];
    markHostBroll(scenes, { hostLook: CREW_LOOK, hostName: "Helena Hart" }, "https://x/host.png");
    for (const s of scenes) {
      expect(s.otherPerson).toBeUndefined();
      expect(s.brollHostLook).toBe(CREW_LOOK);
    }
  });

  it("job 405 scenes 3-8: every 'sleeping person' on a sentence to 'you' is the one viewer; the annoyed few stay strangers", () => {
    const scenes = film405();
    markHostBroll(scenes, { hostLook: LUCA_LOOK, hostName: "Luca Marino", hostTitle: "Cat Trainer", viewerPerson: OWNER }, "https://x/host.png");
    const byIndex = (k: number) => scenes.find(s => s.index === k)!;
    for (const k of [3, 5, 6, 7, 8]) {
      expect(byIndex(k).otherPerson, `scene ${k}`).toBe("the cat owner");
      expect(byIndex(k).otherPersonLooks, `scene ${k}`).toEqual([OWNER]);
      expect(buildStillPrompt(byIndex(k)), `scene ${k}`).toContain(SLEEPER_LOOK);
    }
    // "A few people, half awake and fully annoyed, call it revenge." is not said to "you".
    expect(byIndex(10).otherPerson).toBe("a half awake annoyed person");
    expect(byIndex(10).otherPersonLooks).toBeUndefined();
    // A picture of the paw and a host take are untouched.
    expect(byIndex(4).otherPerson).toBeUndefined();
    expect(byIndex(1).otherPerson).toBeUndefined();
  });

  it("job 405 without a viewer: the sleepers stay as the planner named them, no look", () => {
    const scenes = film405();
    markHostBroll(scenes, { hostLook: LUCA_LOOK, hostName: "Luca Marino", hostTitle: "Cat Trainer" }, "https://x/host.png");
    expect(scenes.filter(s => s.otherPerson === "a sleeping person")).toHaveLength(5);
    expect(scenes.every(s => !s.otherPersonLooks)).toBe(true);
  });

  it("job 405 scene 29: the line check's 'you' turns 'the sleeping host' into the viewer, in its words too", () => {
    const s = line(29, "that her body starts stirring right when yours is at its deepest.", "the tabby cat stirring awake on the bed beside the sleeping host", {
      visualPrompt: "Grey and brown tabby cat with white paws stirring awake on pale grey sheets, a low wooden bed frame visible, dim bedroom at night, bare weathered hands resting on the sheet nearby at rest.",
      humanPresent: true,
      otherPerson: whoOf("you", OWNER)!,
    });
    markHostBroll([s], { hostLook: LUCA_LOOK, hostName: "Luca Marino", viewerPerson: OWNER }, "https://x/host.png");
    expect(s.otherPerson).toBe("the cat owner");
    expect(s.otherPersonLooks).toEqual([OWNER]);
    expect(s.showSubject).toBe("the tabby cat stirring awake on the bed beside the sleeping cat owner");
    expect(s.brollHostLook).toBeUndefined();
    // Left alone (no line check answer), the host's own word keeps the host — the planner decides.
    const host = line(29, "that her body starts stirring right when yours is at its deepest.", "the tabby cat stirring awake on the bed beside the sleeping host", { humanPresent: true });
    markHostBroll([host], { hostLook: LUCA_LOOK, hostName: "Luca Marino", viewerPerson: OWNER }, "https://x/host.png");
    expect(host.brollHostLook).toBe(LUCA_LOOK);
    expect(host.showSubject).toBe("the tabby cat stirring awake on the bed beside the sleeping host");
  });

  it("a how-to's 'you' stays the host — with no viewer, and even beside a viewer when the words name the host (job 406)", () => {
    const GARAGE = "A lean man in his late fifties with fair, weathered skin, graying hair under a woven straw cowboy hat, wearing a light blue denim button-up shirt";
    const how = () => [
      line(20, "You charge five to ten dollars a knife and ten to twenty a mower blade, and the work takes minutes once your hands learn it.", "the host sharpening a mower blade on a benchtop belt sharpening setup", {
        visualPrompt: "Bare weathered hands guiding a dull mower blade against a spinning abrasive belt on a benchtop belt sharpening setup bolted to a garage workbench.",
        humanPresent: true,
      }),
      line(28, "Two rules before your hands go near one: pull the spark plug wire first, every time, because a mower that turns over with your fingers under the deck will not apologize.", "hands pulling the black rubber-coated spark plug wire off the spark plug cap on a red and black push mower engine", {
        visualPrompt: "On a red and black push mower engine, bare weathered hands gripping and pulling a black rubber-coated spark plug wire away from the spark plug cap.",
        humanPresent: true,
      }),
    ];
    const plain = how();
    markHostBroll(plain, { hostLook: GARAGE, hostName: "Gary" }, "https://x/host.png");
    expect(plain.every(s => s.brollHostLook === GARAGE && !s.otherPerson)).toBe(true);
    // Even a viewer (a mistaken one) never takes the host's own work: no viewer's thing, no plain stranger.
    const guarded = how();
    markHostBroll(guarded, { hostLook: GARAGE, hostName: "Gary", viewerPerson: { name: "the customer", look: FLYER } }, "https://x/host.png");
    expect(guarded.every(s => s.brollHostLook === GARAGE && !s.otherPerson)).toBe(true);
  });
});

describe("picturesTheViewer and the viewer's look — the general rules, their edges", () => {
  it("a plain person on a line that says 'I', names that person, or is not said to 'you' is not the viewer", () => {
    const at = (scriptText: string, other = "a woman") => [
      line(1, scriptText, "a woman at the counter holding a paper cup", { humanPresent: true, otherPerson: other }),
    ];
    expect(picturesTheViewer(at("Then you hand the cup across and wait."), 0, PASSENGER)).toBe(true);
    expect(picturesTheViewer(at("Then you hand the cup across and wait."), 5, PASSENGER)).toBe(false); // no such picture
    expect(picturesTheViewer(at("Then I hand you the cup and wait."), 0, PASSENGER)).toBe(false);
    expect(picturesTheViewer(at("Ask the woman at the counter and you'll get one."), 0, PASSENGER)).toBe(false);
    expect(picturesTheViewer(at("The counter opens at six."), 0, PASSENGER)).toBe(false);
    expect(picturesTheViewer(at("Then you hand the cup across and wait.", "a man"), 0, PASSENGER)).toBe(false); // the viewer is a woman
    expect(picturesTheViewer(at("Then you hand the cup across and wait.", "a woman customer"), 0, PASSENGER)).toBe(false); // a role decides
  });

  it("the viewer by their own words, a thing of theirs, never someone else's", () => {
    const one = (show: string, scriptText = "You keep it.") => [line(1, scriptText, show, { humanPresent: true })];
    expect(picturesTheViewer(one("a sleeping cat owner under the sheets"), 0, OWNER)).toBe(true);
    expect(picturesTheViewer(one("the shop owner behind the till"), 0, OWNER)).toBe(false);
    expect(picturesTheViewer(one("hands near a passenger's tray"), 0, PASSENGER)).toBe(true);
    expect(picturesTheViewer(one("hands near a passenger's tray", "I keep it."), 0, PASSENGER)).toBe(false);
    expect(picturesTheViewer(one("a flight attendant's hands setting a cup on a passenger's lap tray"), 0, PASSENGER)).toBe(false);
    expect(picturesTheViewer(one("the host's hands near a passenger's tray"), 0, PASSENGER)).toBe(false);
    // A role the person words do not know is read by its own word.
    const patient: RecurringPerson = { name: "the patient", look: "a man in his eighties, thin white hair, a grey cardigan, brown trousers" };
    expect(picturesTheViewer(one("hands resting on a patient's blanket", "You can ask for a second one."), 0, patient)).toBe(true);
    expect(matchRecurringPeople("the patient", 1, [], patient)).toEqual([patient]);
  });

  it("the viewer's look goes only where no recurring person is taken (job 399's passengers first)", () => {
    expect(matchRecurringPeople("a passenger", 1, PASSENGERS, PASSENGER)).toEqual([PASSENGER]); // 399-23, the line to "you"
    expect(matchRecurringPeople("a woman passenger", 1, PASSENGERS, PASSENGER)).toEqual([WOMAN]);
    expect(matchRecurringPeople("a male passenger", 1, PASSENGERS, PASSENGER)).toEqual([OTHER]);
    expect(matchRecurringPeople("an older passenger", 1, PASSENGERS, PASSENGER)).toEqual([]); // fits all three: no guess
    expect(matchRecurringPeople("a seated passenger", 1, PASSENGERS, PASSENGER)).toEqual([PASSENGER]); // reads "a passenger"
    expect(matchRecurringPeople("an older passenger", 1, [], PASSENGER)).toEqual([PASSENGER]);
    expect(matchRecurringPeople("an older man passenger", 1, [], PASSENGER)).toEqual([]); // her look says a woman
    expect(matchRecurringPeople("another passenger", 1, [], PASSENGER)).toEqual([]);
    expect(matchRecurringPeople("several passengers", 3, [], PASSENGER)).toEqual([]);
    expect(matchRecurringPeople("a flight attendant and an older passenger", 2, [], PASSENGER)).toEqual([PASSENGER]);
    expect(matchRecurringPeople("the cat owner", 1, [], OWNER)).toEqual([OWNER]);
    expect(matchRecurringPeople("a sleeping person", 1, [], OWNER)).toEqual([]);
    // No viewer: exactly as before.
    expect(matchRecurringPeople("a passenger", 1, PASSENGERS)).toEqual([]);
  });

  it("host words become the viewer's role; nothing else is touched", () => {
    expect(hostWordsAsViewer("the host's hands on the sheet", OWNER)).toBe("the cat owner's hands on the sheet");
    expect(hostWordsAsViewer("a cat curled up beside the sleeping host", OWNER)).toBe("a cat curled up beside the sleeping cat owner");
    expect(hostWordsAsViewer("a host of birds at the window", OWNER)).toBe("a host of birds at the window");
    expect(hostWordsAsViewer("a cup on a lap tray", PASSENGER)).toBe("a cup on a lap tray");
  });
});

describe("the viewer's look: the viewer's own name first, only on pictures about 'you' (review of round 11)", () => {
  it("the viewer's exact name beats a recurring person who only shares the role", () => {
    // The planner writes the viewer's name in every shot of "you"; with ONE recurring passenger
    // that name used to fit her by role and every picture of "you" was drawn as her.
    expect(matchRecurringPeople("the passenger", 1, [WOMAN], PASSENGER)).toEqual([PASSENGER]);
    expect(matchRecurringPeople("a passenger", 1, [WOMAN], PASSENGER)).toEqual([PASSENGER]);
    // Her own name, or her sex, still takes her.
    expect(matchRecurringPeople("the woman passenger", 1, [WOMAN], PASSENGER)).toEqual([WOMAN]);
    expect(matchRecurringPeople("a woman passenger", 1, [WOMAN], PASSENGER)).toEqual([WOMAN]);
    // No viewer: the one passenger by role, exactly as before.
    expect(matchRecurringPeople("the passenger", 1, [WOMAN])).toEqual([WOMAN]);
  });

  it("a label that names 'you' beside its person is someone the viewer meets, never the viewer", () => {
    expect(matchRecurringPeople("the passenger next to you", 1, [], PASSENGER)).toEqual([]);
    expect(matchRecurringPeople("a passenger beside you", 1, [], PASSENGER)).toEqual([]);
    expect(matchRecurringPeople("your seatmate", 1, [], PASSENGER)).toEqual([]);
    expect(matchRecurringPeople("an older passenger", 1, [], PASSENGER)).toEqual([PASSENGER]);
  });

  it("job 402: the story's own passengers keep no viewer look; the passengers of lines to 'you' get it", () => {
    const scenes = [
      line(3, "the whole can of ginger ale,", "an older woman passenger in an empty row holding a whole silver and red soda can upright", {
        humanPresent: true, otherPerson: "an older woman passenger", listCut: true,
      }),
      line(7, "He figures she must know somebody on the crew. She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.", "a flight attendant leaning down to speak quietly with an older woman passenger in her seat", {
        humanPresent: true, otherPerson: "a flight attendant and an older woman passenger",
      }),
      line(19, "So when the cart reaches your row, speak up. \"Could I keep the rest of the can, please?\"", "a passenger's hand reaching up toward a soda can held by a flight attendant at the beverage cart stopped at a row", {
        humanPresent: true, otherPerson: "a passenger and a flight attendant",
      }),
      line(25, "You're also welcome to ask for another, and the only real trick is when.", "a passenger's hand reaching for a second pretzel bag from a snack basket held by a flight attendant", {
        humanPresent: true, otherPerson: "a passenger and a flight attendant",
      }),
    ];
    markHostBroll(scenes, { hostLook: CREW_LOOK, hostName: "Helena Hart", viewerPerson: PASSENGER }, "https://x/host.png");
    const looksOf = (k: number) => scenes.find(s => s.index === k)!.otherPersonLooks;
    expect(looksOf(3)).toBeUndefined();
    expect(looksOf(7)).toBeUndefined();
    expect(looksOf(19)).toEqual([PASSENGER]);
    expect(looksOf(25)).toEqual([PASSENGER]);
    // The story's passengers are still drawn as someone else, never the host.
    expect(scenes.every(s => !s.brollHostLook && !!s.otherPerson)).toBe(true);
  });

  it("hands at a viewer's thing are the viewer's only when 'you' does something, never when 'you' only receives", () => {
    const one = (scriptText: string, show = "hands pouring juice into a plastic cup on a passenger's tray") => [
      line(1, scriptText, show, { humanPresent: true }),
    ];
    // Job 402 scenes 17 and 20: "you" is the one asking.
    expect(picturesTheViewer(one("On many of those carriers, you can have the whole thing just by asking."), 0, PASSENGER)).toBe(true);
    expect(picturesTheViewer(one("Juice works the same way. If they're running short, they'll tell you, and you're no worse off for trying."), 0, PASSENGER)).toBe(true);
    // The crew pours FOR you: the hands are the worker's — the host's on a crew host's channel.
    expect(picturesTheViewer(one("They'll pour it for you."), 0, PASSENGER)).toBe(false);
    expect(picturesTheViewer(one("If they're running short, they'll tell you."), 0, PASSENGER)).toBe(false);
    const served = one("They'll pour it for you.");
    markHostBroll(served, { hostLook: CREW_LOOK, hostName: "Helena Hart", viewerPerson: PASSENGER }, "https://x/host.png");
    expect(served[0].brollHostLook).toBe(CREW_LOOK);
    expect(served[0].otherPerson).toBeUndefined();
  });

  it("the viewer's role in the words is the viewer only on a line to 'you'", () => {
    const one = (scriptText: string) => [line(1, scriptText, "a passenger reaching up for a bag in the overhead bin", { humanPresent: true })];
    expect(picturesTheViewer(one("Reach up for your bag before the aisle fills."), 0, PASSENGER)).toBe(true);
    expect(picturesTheViewer(one("She reached up for her bag before the aisle filled."), 0, PASSENGER)).toBe(false);
    const story = one("She reached up for her bag before the aisle filled.");
    markHostBroll(story, { hostLook: CREW_LOOK, hostName: "Helena Hart", viewerPerson: PASSENGER }, "https://x/host.png");
    expect(story[0].otherPerson).toBe("a passenger");
    expect(story[0].otherPersonLooks).toBeUndefined();
  });
});

describe("the line check's 'you and someone' keeps the viewer beside them", () => {
  it("'you and a flight attendant' is the viewer and the attendant; with no viewer, as before", () => {
    expect(whoOf("you and a flight attendant", PASSENGER)).toBe("the passenger and a flight attendant");
    expect(whoOf("the viewer and a flight attendant", PASSENGER)).toBe("the passenger and a flight attendant");
    expect(matchRecurringPeople(whoOf("you and a flight attendant", PASSENGER)!, 2, [], PASSENGER)).toEqual([PASSENGER]);
    // A viewer's customer is still only the customer, and the host's answer is unchanged.
    expect(whoOf("your customer", PASSENGER)).toBe("the customer");
    expect(whoOf("host and a customer", PASSENGER)).toBe("a customer");
    expect(whoOf("you and a flight attendant")).toBe("a flight attendant");
  });
});
