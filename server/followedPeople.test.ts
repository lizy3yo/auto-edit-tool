/**
 * WHO THE STORY FOLLOWS, and what the host does (2026-10-18, the review of jobs 410 and 412).
 *
 * Job 410's script follows two passengers ("one of them … The other was still in row fourteen … He
 * figures she must know somebody on the crew. She doesn't."), and the props call — asked for a
 * `PERSON` line for exactly such a she and he — wrote none: the man was a balding head in an olive
 * jacket in scene 2 and a blue checked shirt in scene 7. It also echoed the host block back as a
 * prop ("THE HOST: a slender woman…"), which became a key thing. And with no host title and a look
 * that never names the job, it wrote no `VIEWER` line, so "you" asking the crew politely (scene 15)
 * was the host in uniform talking to a colleague. Job 412's `VIEWER` look, "an adult of average
 * build, wearing plain pajamas", gave no man or woman, age or hair, and the sleeper changed from
 * shot to shot. The words below are the real stored ones.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurringPerson } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import { followedPeople, hostOwnWords, lookGaps, scriptSentences, uncoveredPeople } from "./followedPeople";
import {
  CONTINUITY_SYSTEM,
  deriveContinuitySheet,
  hostBlockFor,
  isHostEchoLine,
  MAX_RECURRING_PEOPLE,
  mergeRepairedPeople,
  parseKeyThings,
  parseRecurringPeople,
  parseViewerPerson,
  peopleOwed,
  peopleRepairMessage,
  PEOPLE_REPAIR_SYSTEM,
  splitPropsReply,
} from "./shotList";

beforeEach(() => mockInvoke.mockReset());

// Job 410's opening, word for word (the same script as job 399).
const SCRIPT_410 = `Two people paid the same fare, boarded the same flight, and sat in the same row. By the time the beverage cart had come and gone, one of them was sitting in an empty row closer to the front, holding the whole can of ginger ale, a second bag of pretzels, and a bottle of water for later.

The other was still in row fourteen with a few inches of soda over ice. He figures she must know somebody on the crew. She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them. I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way.

Today you're getting fourteen things flight attendants will quietly hand over for free, depending on the airline, the flight, and what's left in the galley, along with the exact words that get each one. None of them is an upgrade, and each of them starts with a single polite sentence.`;
const HOST_LOOK_410 =
  "A slender woman in her forties with fair skin and brown hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
// Job 410's real props reply: no PERSON line, and the host block echoed back as the last "prop".
const SHEET_410 = [
  "aircraft cabin: narrow rows of blue upholstered seats, a center aisle, overhead bins, a galley area with metal counters at the front",
  "MAIN beverage cart: a metal service cart with wheels, a flat top holding plastic cups, ice, aluminum cans, and small bottles, pushed down the aisle",
  "soda cup: a clear plastic cup packed with ice, filled about halfway with soda",
  "pretzel bag: a small sealed foil bag, silver with blue print, holding mini pretzels",
  "empty row: a row of three blue seats near the front of the cabin, unoccupied, tray tables closed",
  "THE HOST: a slender woman in her forties, fair skin, brown hair pinned back, white blouse, navy blazer with gold pin, striped scarf",
].join("\n");
const WOMAN_410 = "a woman in her seventies, short white hair, a cream cardigan over a blue floral blouse, grey slacks";
const MAN_410 = "a man in his seventies, balding grey hair, an olive-green jacket over a checked shirt, khaki trousers";
const PEOPLE_REPLY_410 = `PERSON the woman passenger: ${WOMAN_410}\nPERSON the man passenger: ${MAN_410}`;

// Job 412's opening, word for word: the "she" is the cat.
const SCRIPT_412 = `Three in the morning. The house is dark, the street outside has gone quiet, and somewhere in that quiet, a small set of paws has just landed on the foot of your bed. She doesn’t hurry. She walks the full length of you, ankle, knee, hip, ribs, steady as a tightrope walker, because she has made this crossing a hundred times before.

Then she stops on your chest, lowers her face to yours, and waits. A lot of people call this random, a cat just being a cat. A few people, half awake and fully annoyed, call it revenge. Here’s the thing, though. It’s neither.`;
const VIEWER_412 = "an adult of average build, wearing plain pajamas, lying in the unmade bed in the dim pre-dawn bedroom";
const PROPS_412 = [
  "bedroom: a dim pre-dawn bedroom, a low wooden platform bed with a white duvet and a dark grey blanket, a wooden dresser",
  "MAIN cat: a grey-and-white tabby cat, white bib and white paws, green eyes",
].join("\n");
const SLEEPER_412 = "a woman in her thirties, shoulder-length brown hair, slim build, a plain grey long-sleeved sleep top and grey pajama trousers";

// Openings with nobody followed (the real stored scripts of jobs 411, 413 and 408).
const SCRIPT_411 =
  "Every fall, the robins that worked your lawn all summer pack up and head for Florida. The song at first light goes quiet, the grass sits empty in the mornings, and nobody sees another robin until spring. At least, that’s what just about everybody figures. Across a good part of the country, plenty of those robins never leave at all, and some will spend the whole winter within a short walk of your back door. And that first robin of spring you’ll be so happy to see in March? There’s a fair chance it was around the whole time. I’m Walter, and if you keep an eye on the yard from the kitchen window, this one’s for you.";
const SCRIPT_413 =
  "Somewhere along the line, everybody agreed that starting a business costs ten thousand dollars. A loan, a lease, a logo, and a lawyer — all before the first customer ever shows up. That one belief keeps more good tools hanging silent on more garage walls than rust ever has. Tonight we’re taking it apart: seventeen real businesses that start for under five hundred dollars, most of them with gear you already own. I’m Gary, and Gary’s Garage Secrets is for working people who want extra income with numbers a neighbor would believe — no apps, no coins, no course-sellers.";
const SCRIPT_408 =
  "Look at the floor beside your toilet. That little stretch of tile between the bowl and the wall. In most American bathrooms, it is empty. In a German bathroom, usually, a small bin stands there, with a lid. It is the answer to one plain sentence the water utilities in Germany have repeated for years: the toilet is not a trash can. And besides what your own body sends there, exactly one thing is allowed in the bowl. It was built on purpose to do something the nine cannot. I am Werner Finkbeiner. This channel is for people in older houses and apartments who would rather understand the cause than pay for the visit.";

describe("followedPeople — who the script keeps talking about", () => {
  it("job 410: the woman (she, over four sentences) and the man ('The other' then 'He')", () => {
    const followed = followedPeople(SCRIPT_410, { hostName: "Helena Hart" });
    expect(followed).toEqual([
      { cue: "she", sex: "f", sentences: [2, 3, 4, 5] },
      { cue: "he", sex: "m", sentences: [2, 3] },
    ]);
    expect(scriptSentences(SCRIPT_410)[3]).toBe("He figures she must know somebody on the crew.");
  });

  it("job 409: the man in the card aisle, followed over the whole opening", () => {
    const opening =
      "There is a man standing in the greeting card aisle of a pharmacy on a Tuesday morning, buying his third sympathy card since spring, and doing a kind of arithmetic nobody ever taught him. He is counting backward. He is sixty-four. His father made it to eighty-one.";
    expect(followedPeople(opening, { hostName: "Gideon Grant" })).toEqual([{ cue: "he", sex: "m", sentences: [0, 1, 2, 3] }]);
  });

  it("job 412: the cat's 'she' is found too — words cannot tell it from a woman's, the model says who", () => {
    expect(followedPeople(SCRIPT_412, { hostName: "Luca Marino" }).map(f => f.cue)).toEqual(["she"]);
  });

  it("nobody followed: jobs 411, 413 and 408 (a neighbour said once, the host's own introduction)", () => {
    expect(followedPeople(SCRIPT_411, { hostName: "Walter Wren" })).toEqual([]);
    expect(followedPeople(SCRIPT_413, { hostName: "Gary" })).toEqual([]);
    expect(followedPeople(SCRIPT_408, { hostName: "Werner Finkbeiner" })).toEqual([]);
  });

  it("a role or relation pointed at in two sentences is followed; one the host gives themself is not", () => {
    const story = "My husband built that shelf the winter we married. Forty years on, it still holds. My husband says it leans, and he is right.";
    expect(followedPeople(story).find(f => f.cue === "husband")).toEqual({ cue: "husband", sex: "m", sentences: [0, 2] });
    const nurse = "I'm Ana, a nurse. The nurse on nights sees things the day shift misses. Ask the nurse who checks on you at three.";
    expect(followedPeople(nurse, { hostName: "Ana" }).map(f => f.cue)).not.toContain("nurse");
    expect(followedPeople(nurse, { hostName: "Ana", hostTitle: "Night Nurse" }).map(f => f.cue)).not.toContain("nurse");
  });

  it("a 'she' twenty sentences on is a new story's, and 'the driver' is a tool as often as a person", () => {
    const filler = Array.from({ length: 6 }, (_, i) => `Step ${i + 1} is plain work.`).join(" ");
    expect(followedPeople(`She sanded it once. ${filler} She oiled it later.`)).toEqual([]);
    expect(followedPeople("Grab the driver from the bench. Set the driver to its lowest clutch.")).toEqual([]);
  });
});

describe("uncoveredPeople — a followed person no PERSON line covers", () => {
  const followed = followedPeople(SCRIPT_410, { hostName: "Helena Hart" });
  const woman: RecurringPerson = { name: "the woman passenger", look: WOMAN_410 };
  const man: RecurringPerson = { name: "the man passenger", look: MAN_410 };

  it("job 410's real reply had no PERSON line: both are owed", () => {
    expect(uncoveredPeople(followed, []).map(f => f.cue)).toEqual(["she", "he"]);
  });

  it("a line for the woman covers her 'she', never his 'he'; both lines cover both", () => {
    expect(uncoveredPeople(followed, [woman]).map(f => f.cue)).toEqual(["he"]);
    expect(uncoveredPeople(followed, [woman, man])).toEqual([]);
  });

  it("the viewer is 'you', never a 'she' — but may be the role said twice", () => {
    expect(uncoveredPeople(followed, [], woman).map(f => f.cue)).toEqual(["she", "he"]);
    const role = [{ cue: "passenger", sentences: [1, 4] }];
    expect(uncoveredPeople(role, [], { name: "the passenger", look: WOMAN_410 })).toEqual([]);
    expect(uncoveredPeople(role, [woman])).toEqual([]);
    expect(uncoveredPeople(role, [])).toEqual(role);
  });
});

describe("lookGaps — man or woman, an age range and hair", () => {
  it("job 412's viewer look gives none of the three", () => {
    expect(lookGaps(VIEWER_412)).toEqual(["man or woman", "an age range", "hair"]);
  });

  it("the looks that kept one person are whole (jobs 399 and 410, the prompt's own example)", () => {
    expect(lookGaps(WOMAN_410)).toEqual([]);
    expect(lookGaps(MAN_410)).toEqual([]);
    expect(lookGaps("a tall man in his seventies, thin white hair combed back, a faded green zip-up jacket")).toEqual([]);
    expect(lookGaps("an older woman, grey curls, a blue raincoat")).toEqual([]);
    expect(lookGaps("a balding man in his sixties, a navy quarter-zip")).toEqual([]);
  });

  it("names what is missing", () => {
    expect(lookGaps("a man in a straw hat and a denim shirt")).toEqual(["an age range", "hair"]);
    expect(lookGaps("a person in their fifties, short brown hair, a plain blue shirt")).toEqual(["man or woman"]);
  });
});

describe("hostOwnWords and the host block — what the host does, in their own words", () => {
  it("job 410: the introduction and the sentence after it (no host title on the channel)", () => {
    expect(hostOwnWords(SCRIPT_410, { hostName: "Helena Hart" })).toEqual([
      "I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way.",
      "Today you're getting fourteen things flight attendants will quietly hand over for free, depending on the airline, the flight, and what's left in the galley, along with the exact words that get each one.",
    ]);
  });

  it("job 408: a bare introduction gets the sentence that says who the channel is for", () => {
    expect(hostOwnWords(SCRIPT_408, { hostName: "Werner Finkbeiner" })).toEqual([
      "I am Werner Finkbeiner.",
      "This channel is for people in older houses and apartments who would rather understand the cause than pay for the visit.",
    ]);
  });

  it("a sentence where the host says what they were joins them; 'I'm going to show you' does not", () => {
    const script =
      "Most people never ask. I'm going to show you why they should. I'm Ana Ruiz, and this is for anyone who travels. I spent nineteen years as a hotel housekeeper before I ever wrote a word.";
    expect(hostOwnWords(script, { hostName: "Ana Ruiz" })).toEqual([
      "I'm Ana Ruiz, and this is for anyone who travels.",
      "I spent nineteen years as a hotel housekeeper before I ever wrote a word.",
    ]);
    expect(hostOwnWords("No introduction here. Just the work.")).toEqual([]);
  });

  it("the block is written with dashes — never a `name: look` line the call can echo as a prop", () => {
    const block = hostBlockFor(HOST_LOOK_410, undefined, hostOwnWords(SCRIPT_410, { hostName: "Helena Hart" }));
    expect(block).toBe(
      `THE HOST (the narrator, on camera; never a line of the list) looks — ${HOST_LOOK_410}; in their own words — "I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way." "Today you're getting fourteen things flight attendants will quietly hand over for free, depending on the airline, the flight, and what's left in the galley, along with the exact words that get each one."\n`
    );
    expect(block).not.toMatch(/THE HOST[^—]*\):/);
    expect(hostBlockFor(undefined, "Cat Trainer")).toBe("THE HOST (the narrator, on camera; never a line of the list) title — Cat Trainer\n");
    expect(hostBlockFor()).toBe("");
  });

  it("the prompt reads the host's job from title, own words, or clothes against the video's work", () => {
    expect(CONTINUITY_SYSTEM).toMatch(/THE HOST block \(never a line of the list\)/);
    expect(CONTINUITY_SYSTEM).toMatch(/The host's JOB is the one their title\s+or own words name/);
    expect(CONTINUITY_SYSTEM).toMatch(/whose uniform\s+or work clothes THE HOST's clothes could be/);
    expect(CONTINUITY_SYSTEM).toMatch(/is written like a PERSON look — man or woman, an age range/);
    // Neutral examples only.
    expect(CONTINUITY_SYSTEM + PEOPLE_REPAIR_SYSTEM).not.toMatch(/passenger|flight|crew|\bcats?\b|sleep|pajama/i);
  });
});

describe("the host block echoed back is no prop (job 410)", () => {
  it("drops 'THE HOST: …', the narrator, 'you' and the host by name; keeps what the host owns", () => {
    expect(isHostEchoLine("THE HOST: a slender woman in her forties")).toBe(true);
    expect(isHostEchoLine("THE HOST (the narrator, on camera): a slender woman")).toBe(true);
    expect(isHostEchoLine("narrator: a man in a denim shirt")).toBe(true);
    expect(isHostEchoLine("you: a person in a grey coat")).toBe(true);
    expect(isHostEchoLine("Helena Hart: a slender woman", "Helena Hart")).toBe(true);
    expect(isHostEchoLine("THE HOST Helena Hart: a slender woman", "Helena Hart")).toBe(true);
    expect(isHostEchoLine("host's desk: a wooden desk by a window")).toBe(false);
    expect(isHostEchoLine("camera: an old film camera with a brown leather strap")).toBe(false);
    // One word of a "<thing> <name>" channel name is that channel's thing, never the host.
    expect(isHostEchoLine("backyard: a small fenced backyard with a coop", "Backyard Brenda")).toBe(false);
    expect(isHostEchoLine("MAIN hardwood boards: rough-sawn oak and walnut", "Hank Hardwood")).toBe(false);
    expect(isHostEchoLine("wren: a small brown bird, cocked tail", "Walter Wren")).toBe(false);
    expect(isHostEchoLine("Helena: a slender woman", "Helena Hart")).toBe(false);
    expect(isHostEchoLine("MAIN beverage cart: a metal service cart")).toBe(false);
    expect(isHostEchoLine("empty row: a row of three blue seats")).toBe(false);
  });

  it("job 410's stored list: 'THE HOST' is never a key thing, the props are kept", () => {
    expect(parseKeyThings(SHEET_410).map(k => k.name)).toEqual(["beverage cart", "soda cup", "pretzel bag", "empty row"]);
    expect(splitPropsReply(SHEET_410).props).toHaveLength(5);
  });
});

describe("peopleOwed, the repair question and the merge", () => {
  it("job 410: both passengers owed; job 412: the cat's 'she' and the viewer's look", () => {
    const owed410 = peopleOwed(SCRIPT_410, { people: [], viewer: [] }, { hostName: "Helena Hart" });
    expect(owed410.uncovered.map(f => f.cue)).toEqual(["she", "he"]);
    expect(owed410.incomplete).toEqual([]);
    const owed412 = peopleOwed(SCRIPT_412, { people: [], viewer: [`VIEWER the cat owner: ${VIEWER_412}`] }, { hostName: "Luca Marino", hostTitle: "Cat Trainer" });
    expect(owed412.uncovered.map(f => f.cue)).toEqual(["she"]);
    expect(owed412.incomplete).toMatchObject([{ kind: "VIEWER", person: { name: "the cat owner" }, gaps: ["man or woman", "an age range", "hair"] }]);
  });

  it("nothing owed when the lines are whole and cover who the story follows", () => {
    const people = [`PERSON the woman passenger: ${WOMAN_410}`, `PERSON the man passenger: ${MAN_410}`];
    expect(peopleOwed(SCRIPT_410, { people, viewer: [] }, { hostName: "Helena Hart" })).toEqual({ uncovered: [], incomplete: [] });
    expect(peopleOwed(SCRIPT_411, { people: [], viewer: [] }, { hostName: "Walter Wren" })).toEqual({ uncovered: [], incomplete: [] });
  });

  it("the question shows the followed sentences with their neighbours and what each look leaves out", () => {
    const owed = peopleOwed(SCRIPT_412, { people: [], viewer: [`VIEWER the cat owner: ${VIEWER_412}`] });
    const msg = peopleRepairMessage(SCRIPT_412, { people: [], viewer: [`VIEWER the cat owner: ${VIEWER_412}`] }, owed, {
      hostBlock: hostBlockFor(undefined, "Cat Trainer"),
    });
    expect(msg).toContain(`LINES TO REWRITE WHOLE:\nVIEWER the cat owner: ${VIEWER_412}  (leaves out: man or woman, an age range, hair)`);
    expect(msg).toContain("#3 She doesn’t hurry.");
    expect(msg).toContain("#2 The house is dark");
    expect(msg).toContain("PEOPLE LINES ALREADY WRITTEN:\nnone");
    expect(msg).toContain("title — Cat Trainer");
  });

  it("an incomplete line takes the rewrite of the same person, keeping its own kind and name", () => {
    const lines = { people: [], viewer: [`VIEWER the cat owner: ${VIEWER_412}`] };
    const owed = peopleOwed(SCRIPT_412, lines);
    // Renamed by the model: the one VIEWER line is still the viewer, under the name every shot uses.
    const merged = mergeRepairedPeople(lines, owed.incomplete, `VIEWER the sleeper: ${SLEEPER_412}`);
    expect(merged.viewer).toEqual([`VIEWER the cat owner: ${SLEEPER_412}`]);
    expect(merged.rewritten).toEqual(["the cat owner"]);
    // A rewrite that leaves out as much is not taken; NONE changes nothing.
    expect(mergeRepairedPeople(lines, owed.incomplete, `VIEWER the cat owner: a person in plain pajamas, in bed`).viewer).toEqual(lines.viewer);
    expect(mergeRepairedPeople(lines, owed.incomplete, "NONE")).toEqual({ ...lines, added: [], rewritten: [] });
  });

  it("new PERSON lines are added — never a VIEWER, never someone already written under a new name", () => {
    const merged = mergeRepairedPeople({ people: [], viewer: [] }, [], `${PEOPLE_REPLY_410}\nVIEWER the passenger: ${WOMAN_410}`);
    expect(merged.people).toEqual([`PERSON the woman passenger: ${WOMAN_410}`, `PERSON the man passenger: ${MAN_410}`]);
    expect(merged.viewer).toEqual([]);
    const renamed = mergeRepairedPeople(
      { people: [`PERSON the woman passenger: ${WOMAN_410}`], viewer: [] },
      [],
      `PERSON the older woman passenger: a woman in her eighties, white hair in a bun, a navy coat`
    );
    expect(renamed.added).toEqual([]);
    // A look that says neither man nor woman nor age is not worth a line.
    expect(mergeRepairedPeople({ people: [], viewer: [] }, [], "PERSON the neighbour: someone in a green jacket and dark trousers").people).toEqual([]);
  });

  it("at most MAX_RECURRING_PEOPLE in all", () => {
    const four = ["the baker", "the farmer", "the mechanic", "the teacher"].map(
      n => `PERSON ${n}: a man in his fifties, short brown hair, a plain blue shirt, dark trousers`
    );
    const merged = mergeRepairedPeople({ people: four, viewer: [] }, [], PEOPLE_REPLY_410);
    expect(merged.people).toHaveLength(MAX_RECURRING_PEOPLE);
    expect(merged.added).toEqual([]);
  });
});

describe("deriveContinuitySheet asks once more, only for what is owed", () => {
  it("job 410: the echo goes, the host's own words are sent, and the passengers are asked for", async () => {
    mockInvoke.mockResolvedValueOnce({ text: SHEET_410 }).mockResolvedValueOnce({ text: PEOPLE_REPLY_410 });
    const notes: string[] = [];
    const sheet = await deriveContinuitySheet(SCRIPT_410, {
      host: HOST_LOOK_410,
      hostName: "Helena Hart",
      onNote: m => notes.push(m),
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    const first = mockInvoke.mock.calls[0][0];
    expect(first.userMessage).toContain("in their own words — \"I'm Helena Hart, and I read the fine print");
    const repair = mockInvoke.mock.calls[1][0];
    expect(repair.systemPrompt).toBe(PEOPLE_REPAIR_SYSTEM);
    expect(repair.step).toBe("Props list (people)");
    expect(repair.userMessage).toContain("#3 The other was still in row fourteen with a few inches of soda over ice.");
    expect(repair.userMessage).toContain("#4 He figures she must know somebody on the crew.");
    expect(sheet).not.toMatch(/^THE HOST/m);
    expect(parseKeyThings(sheet).map(k => k.name)).not.toContain("THE HOST");
    expect(parseRecurringPeople(sheet, { hostName: "Helena Hart" })).toEqual([
      { name: "the woman passenger", look: WOMAN_410 },
      { name: "the man passenger", look: MAN_410 },
    ]);
    expect(notes).toEqual(["people lines asked for again (followed with no line: she, he) — added the woman passenger, the man passenger"]);
  });

  it("job 412: the viewer's look is rewritten whole; the cat gets no line", async () => {
    mockInvoke
      .mockResolvedValueOnce({ text: `${PROPS_412}\nVIEWER the cat owner: ${VIEWER_412}` })
      .mockResolvedValueOnce({ text: `VIEWER the cat owner: ${SLEEPER_412}` });
    const sheet = await deriveContinuitySheet(SCRIPT_412, { host: "a man in his late thirties", hostTitle: "Cat Trainer", hostName: "Luca Marino" });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(parseViewerPerson(sheet, { hostName: "Luca Marino" })).toEqual({ name: "the cat owner", look: SLEEPER_412 });
    expect(parseRecurringPeople(sheet)).toEqual([]);
  });

  it("one call only when nothing is owed (job 411's robins; job 410 with both passengers written)", async () => {
    mockInvoke.mockResolvedValue({ text: "yard: a back lawn with a bird bath\nMAIN robin: an American robin, grey-brown back, brick-red breast" });
    await deriveContinuitySheet(SCRIPT_411, { host: "a man in his late sixties", hostName: "Walter Wren" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: `${SHEET_410}\n${PEOPLE_REPLY_410}` });
    await deriveContinuitySheet(SCRIPT_410, { host: HOST_LOOK_410, hostName: "Helena Hart" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it("a failed repair keeps the list as written", async () => {
    mockInvoke.mockResolvedValueOnce({ text: SHEET_410 }).mockRejectedValueOnce(new Error("overloaded"));
    const notes: string[] = [];
    const sheet = await deriveContinuitySheet(SCRIPT_410, { host: HOST_LOOK_410, hostName: "Helena Hart", onNote: m => notes.push(m) });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(sheet.split("\n")).toHaveLength(5);
    expect(parseRecurringPeople(sheet)).toEqual([]);
    expect(notes[0]).toMatch(/repair failed \(overloaded\) — kept as written/);
  });

  it("no host (a b-roll-only video): no host block, and nobody's own words", async () => {
    mockInvoke.mockResolvedValue({ text: `${SHEET_410}\n${PEOPLE_REPLY_410}` });
    await deriveContinuitySheet(SCRIPT_410);
    expect(mockInvoke.mock.calls[0][0].userMessage).not.toContain("THE HOST");
  });
});
