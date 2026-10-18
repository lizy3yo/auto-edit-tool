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

import { markHostBroll, matchRecurringPeople, personKey } from "./hostLook";
import {
  CONTINUITY_SYSTEM,
  deriveContinuitySheet,
  isPersonLine,
  MAX_RECURRING_PEOPLE,
  parseKeyThings,
  parseRecurringPeople,
  planShotList,
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
    expect(userMessage).toContain("PEOPLE WHO COME BACK (when a shot shows one of them, other is this name exactly): the woman passenger | the other passenger");
    expect(userMessage).not.toContain(SHE);
    expect(systemPrompt).toMatch(/When that person is one of the PEOPLE WHO COME BACK/);
  });

  it("no line when nobody comes back", async () => {
    mockInvoke.mockResolvedValue({ text: '{"beats":[]}' });
    await planShotList([beat(1, "Two people paid the same fare, boarded the same flight")], { sheet: PROPS_399, people: [] });
    expect(mockInvoke.mock.calls[0][0].userMessage).not.toContain("PEOPLE WHO COME BACK");
  });
});
