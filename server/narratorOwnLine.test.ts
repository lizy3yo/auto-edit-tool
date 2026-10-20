/**
 * THE HOST'S OWN "I" IS THE HOST (2026-10-20, job 417 scene 19). "I figured that out much too late,
 * after more flights than I care to count spent nursing a thimble of ginger ale" is the host telling
 * her own past, and the shot list wrote it as "a woman passenger" — so it was drawn as someone else,
 * and the recurring-people match gave her the look of the woman the opening story had followed (the
 * one who got the whole can), now nursing the small drink a minute later. The mirror of round 13's
 * rule that a story's "he"/"she" is never the host (`storyPersonLine`). The scene words below are the
 * real stored ones; the lines that must NOT change are real lines from other films.
 */
import { describe, expect, it, vi } from "vitest";
import type { RecurringPerson, StoryboardScene } from "@shared/types";

vi.mock("./claude", () => ({ invokeClaude: vi.fn() }));

import { markHostBroll, narratorOwnLine, personAsHost } from "./hostLook";
import { buildStillPrompt } from "./longformVideo";

// Job 417's real host look and recurring people.
const HELENA =
  "A slender woman in her forties with fair skin and brown hair pinned back, wearing a white blouse, navy striped neck scarf, and a navy blazer with a gold pin";
const STORY_WOMAN: RecurringPerson = {
  name: "woman passenger",
  look: "an older woman, slender build, grey hair in a bob, wearing a beige cardigan and floral blouse",
};
const ROW_14: RecurringPerson = {
  name: "passenger in row fourteen",
  look: "a middle-aged man, average build, short dark hair, wearing a grey collared shirt, seated by the window",
};
const PARAMS_417 = { hostLook: HELENA, hostName: "Helena Hart", recurringPeople: [ROW_14, STORY_WOMAN] };
const PHOTO = "https://x/host.png";

const pic = (index: number, line: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: line, scriptText: line, showSubject: show, visualPrompt: show, humanPresent: true, ...over }) as StoryboardScene;

/** Job 417 scenes 18-20, as stored. */
const film417 = () => [
  pic(18, "On many of those carriers, you can have the whole thing just by asking.", "passenger in row fourteen asking flight attendant at cart for can", {
    visualPrompt: "An older passenger in row fourteen speaking to a flight attendant at the beverage cart in the aisle.",
    otherPerson: "a passenger and a flight attendant",
    keyThing: "soda can",
  }),
  pic(
    19,
    "I figured that out much too late, after more flights than I care to count spent nursing a thimble of ginger ale.",
    "woman passenger holding small plastic cup with little ginger ale",
    {
      visualPrompt: "A woman passenger holding a small plastic cup with a little ginger ale, seated in an airline seat.",
      otherPerson: "a woman passenger",
      keyThing: "plastic cup",
    }
  ),
  pic(20, 'So when the cart reaches your row, speak up. "Could I keep the rest of the can, please?"', "passenger in row fourteen speaking to flight attendant beside cart", {
    visualPrompt: "Passenger in row fourteen speaking to flight attendant beside the beverage cart in the cabin aisle.",
    otherPerson: "a passenger and a flight attendant",
  }),
];

describe("narratorOwnLine — a line the host tells of themself, naming nobody else", () => {
  it("the host's own past, body or part they played then", () => {
    expect(narratorOwnLine("I figured that out much too late, after more flights than I care to count spent nursing a thimble of ginger ale.")).toEqual({ we: false }); // job 417 scene 19
    expect(narratorOwnLine("My hands shook the whole way down.")).toEqual({ we: false });
    expect(narratorOwnLine("When I was just a passenger, I always took the window seat.")).toEqual({ we: false });
    expect(narratorOwnLine("I worked as a nurse for twenty years before any of this.")).toEqual({ we: false });
    expect(narratorOwnLine("We'd sit in the back galley between services.")).toEqual({ we: true });
    // the host's own name is the host, never a name of someone else
    expect(narratorOwnLine("I'm Helena Hart, and I read the fine print on every ticket.", "Helena Hart")).toEqual({ we: false });
    expect(narratorOwnLine("I'm Helena Hart, and I read the fine print on every ticket.")).toBeUndefined();
  });

  it("a line naming anyone else, or with no 'I' doing it, is not", () => {
    // what the viewer says, quoted (job 417 scene 20), and the viewer
    expect(narratorOwnLine('So when the cart reaches your row, speak up. "Could I keep the rest of the can, please?"')).toBeUndefined();
    expect(narratorOwnLine('Speak up. "Could I keep the rest of the can, please?"')).toBeUndefined();
    expect(narratorOwnLine("I learned this the hard way so you don't have to.")).toBeUndefined();
    // "they", even of things: the buyer's side as much as the host's (job 350 scene 30)
    expect(narratorOwnLine("They sell for $16 to $24, and I sold every one I had in a single afternoon.")).toBeUndefined();
    // a person word (jobs 111/140/149, 149 scene 151)
    expect(narratorOwnLine("and I sold every one I had in a single afternoon to folks who like to burn incense")).toBeUndefined();
    expect(narratorOwnLine("That changes right here, and my neighbor across the street watched the whole thing from his driveway.")).toBeUndefined();
    expect(narratorOwnLine("A passenger beside me asked for the whole can.")).toBeUndefined();
    expect(narratorOwnLine("I was just a passenger next to a man who drank the whole can.")).toBeUndefined();
    // a name, and "me" only on the receiving end (job 414 scene 3)
    expect(narratorOwnLine("A log restorer in Grayson County, Virginia, let me try it.")).toBeUndefined();
    expect(narratorOwnLine("It took me around twenty hours.")).toBeUndefined();
    // "I" only framing what follows (job 137 scene 114)
    expect(narratorOwnLine("Number three. The potholder loops, no, I'll say it plain, the hemmed dish towels from old bedsheets, and these were the first thing gone every market day.")).toBeUndefined();
    expect(narratorOwnLine("I think it's the best trick on any flight.")).toBeUndefined();
    // the story's "he"/"she" (round 13's rule)
    expect(narratorOwnLine("He figures she must know somebody on the crew.")).toBeUndefined();
    expect(narratorOwnLine("I saw him as a friend from the first day.")).toBeUndefined();
    expect(narratorOwnLine(undefined)).toBeUndefined();
  });
});

describe("personAsHost — the words naming the person become the host", () => {
  it("rewrites the person's phrase, keeps the rest", () => {
    expect(personAsHost("woman passenger holding small plastic cup with little ginger ale", "passenger")).toBe("the host holding small plastic cup with little ginger ale");
    expect(personAsHost("A woman passenger holding a small plastic cup with a little ginger ale, seated in an airline seat.", "passenger")).toBe(
      "The host holding a small plastic cup with a little ginger ale, seated in an airline seat."
    );
    expect(personAsHost("an older passenger's hands around a paper cup", "passenger")).toBe("the host's hands around a paper cup");
    expect(personAsHost("a paper cup on a tray table", "passenger")).toBe("a paper cup on a tray table");
  });
});

describe("markHostBroll — the host's own 'I' is the host, never someone else", () => {
  it("job 417 scene 19: the host, from her look and photo — not the story's woman with the whole can", () => {
    const scenes = film417();
    markHostBroll(scenes, PARAMS_417, PHOTO);
    const s = scenes[1];
    expect(s.otherPerson).toBeUndefined();
    expect(s.otherPeople).toBeUndefined();
    expect(s.otherPersonLooks).toBeUndefined();
    expect(s.brollHostLook).toBe(HELENA);
    expect(s.brollHostRef).toBe(PHOTO);
    expect(s.showSubject).toBe("the host holding small plastic cup with little ginger ale");
    expect(s.visualPrompt).toBe("The host holding a small plastic cup with a little ginger ale, seated in an airline seat.");
    const prompt = buildStillPrompt(s);
    expect(prompt).toContain("navy blazer with a gold pin");
    expect(prompt).not.toMatch(/beige cardigan|grey hair in a bob|NOT the video's host/);
    // its neighbours, a line to "you" and the viewer's quoted "I", are exactly as before
    expect(scenes[0].otherPerson).toBe("a passenger and a flight attendant");
    expect(scenes[2].otherPerson).toBe("a passenger and a flight attendant");
    // a second pass reads the new words the same way
    markHostBroll(scenes, PARAMS_417, PHOTO);
    expect(scenes[1].otherPerson).toBeUndefined();
    expect(scenes[1].brollHostLook).toBe(HELENA);
  });

  it("only the planner named someone, over hands: the hands are the host's", () => {
    const scenes = [pic(19, film417()[1].scriptText!, "hands holding a small plastic cup with a little ginger ale", { otherPerson: "a woman passenger" })];
    markHostBroll(scenes, PARAMS_417, PHOTO);
    expect(scenes[0].otherPerson).toBeUndefined();
    expect(scenes[0].brollHostLook).toBe(HELENA);
    expect(scenes[0].showSubject).toBe("hands holding a small plastic cup with a little ginger ale");
  });

  it("the part the host played then, and a planner who got the host's sex wrong", () => {
    const window = [pic(1, "When I was just a passenger, I always took the window seat.", "a passenger looking out an airplane window", { otherPerson: "a passenger" })];
    markHostBroll(window, PARAMS_417, PHOTO);
    expect(window[0].otherPerson).toBeUndefined();
    expect(window[0].showSubject).toBe("the host looking out an airplane window");
    const truck = [pic(1, "I loaded the truck before dawn.", "a man loading crates into a truck", { otherPerson: "a man" })];
    markHostBroll(truck, PARAMS_417, PHOTO);
    expect(truck[0].otherPerson).toBeUndefined();
    expect(truck[0].brollHostLook).toBe(HELENA);
  });

  it("someone the host does it WITH or TO, someone the line names, two people: as before", () => {
    // job 147 scene 326: the host's hands sell to a buyer — the buyer stays
    const sold = [pic(326, "and I sold every last one I brought to the roadside table", "hands exchanging a feed sack tote bag with a buyer at the market table", { otherPerson: "a buyer" })];
    // job 350 scene 30
    const bowl = [
      pic(30, "They sell for $16 to $24, and I sold every one I had in a single afternoon.", "a woman customer picking up a fabric scrap bowl from the market table", { otherPerson: "a woman customer" }),
    ];
    const seatmate = [pic(1, "A passenger beside me asked for the whole can.", "a passenger reaching up toward a soda can on the cart", { otherPerson: "a passenger" })];
    const galley = [
      pic(1, "I spent the whole flight standing in the galley.", "a flight attendant and a passenger talking in the galley", { otherPerson: "a flight attendant and a passenger" }),
    ];
    const story = [pic(8, "He figures she must know somebody on the crew.", "a man passenger glancing at a woman passenger", { otherPerson: "a man passenger" })];
    for (const [scenes, who] of [
      [sold, "a buyer"],
      [bowl, "a woman customer"],
      [seatmate, "a passenger"],
      [galley, "a flight attendant and a passenger"],
      [story, "a man passenger"],
    ] as const) {
      markHostBroll(scenes as StoryboardScene[], { hostLook: HELENA, hostName: "Helena Hart" }, PHOTO);
      expect(scenes[0].otherPerson).toBe(who);
      expect(scenes[0].brollHostLook).toBeUndefined();
    }
  });

  it("'we' is the host and others: a relative or someone of the other sex stays someone else", () => {
    const farm = [pic(1, "We moved to the farm that spring.", "a husband carrying boxes into a farmhouse", { otherPerson: "a husband" })];
    const crates = [pic(1, "We loaded the truck before dawn.", "a man loading crates into a truck", { otherPerson: "a man" })];
    for (const scenes of [farm, crates]) {
      markHostBroll(scenes, { hostLook: HELENA }, PHOTO);
      expect(scenes[0].otherPerson).toBeDefined();
      expect(scenes[0].brollHostLook).toBeUndefined();
    }
    const galley = [pic(1, "We'd sit in the back galley between services.", "a flight attendant sitting on a fold-down jump seat in the galley", { otherPerson: "a flight attendant" })];
    markHostBroll(galley, { hostLook: HELENA }, PHOTO);
    expect(galley[0].otherPerson).toBeUndefined();
    expect(galley[0].brollHostLook).toBe(HELENA);
  });

  it("a film with no host on camera keeps the planner's person, as before", () => {
    for (const [params, photo] of [
      [{ ...PARAMS_417, brollOnly: true }, PHOTO],
      [PARAMS_417, undefined],
      [{ ...PARAMS_417, hostLook: undefined }, PHOTO],
    ] as const) {
      const scenes = film417();
      markHostBroll(scenes, params, photo);
      expect(scenes[1].otherPerson).toBe("a woman passenger");
      expect(scenes[1].showSubject).toBe("woman passenger holding small plastic cup with little ginger ale");
    }
  });
});
