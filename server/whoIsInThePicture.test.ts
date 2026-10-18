/**
 * WHO IS IN THE PICTURE (2026-10-18, the audit of 336 jobs). A picture whose words named someone
 * else — "a shopper's hand", "baby's hand", "a woman at home at night" on a man's channel, "two
 * people hugging" — was drawn from the host's photo; "an older man walking…" and "a crowd of people…"
 * were pictures of nobody; a planner's "someone else" that was a hen, or that its picture no longer
 * showed, forced a person in. Every line below is a real stored description.
 */
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  castOfPicture,
  markHostBroll,
  namedPeople,
  SHOWS_PERSON,
  selfRolesOf,
  sexOfLook,
  showsPerson,
  showsSomeoneElse,
  someoneElse,
  withoutAnimalPronouns,
} from "./hostLook";
import {
  applyContextGroups,
  applyPictureFixes,
  applyPictureJoins,
  applyPictureSplits,
  applyShotPlan,
  otherPeopleOf,
  otherPersonOf,
  parsePictureFixes,
  whoOf,
} from "./shotList";
import {
  buildClipChain,
  buildStillPrompt,
  hostWithOthersClause,
  ONE_OTHER_PERSON_SUFFIX,
  otherPeopleSuffix,
  otherPersonClause,
  peopleInShot,
  planHostMinutes,
} from "./longformVideo";
import { enforcePlanRules } from "./planGate";

const MAN = "A man in his late sixties with fair skin, short grey hair, wire-rimmed glasses, wearing a heather grey sweater";
const WOMAN = "A slender woman in her late thirties with fair skin and dark hair pinned back, wearing a white blouse";
const HOST_PHOTO = "https://x/host.png";

const pic = (index: number, show: string, extra: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText: show, narration: show, visualPrompt: show, showSubject: show, ...extra }) as StoryboardScene;

describe("namedPeople — the people a description names, read off its noun phrases", () => {
  it("finds a person by role, by relation and by a plain noun phrase", () => {
    expect(namedPeople("a shopper's hand picking up a coaster from a market table of coasters and ornaments")?.role).toBe("shopper"); // job 341 scene 35
    expect(namedPeople("baby's hand resting on a star blanket with every tail tucked in")?.role).toBe("baby"); // job 351 scene 122
    expect(namedPeople("a farmer leaning on a hoe in a dry field, shaking his head")?.people[0].phrase).toBe("a farmer"); // job 400 scene 30
    expect(namedPeople("an older woman's hand resting on a framed photograph on a table")?.sex).toBe("f"); // job 400 scene 16
    expect(namedPeople("man standing among pharmacy card aisles, thinking")?.people[0].phrase).toBe("a man"); // job 400 scene 4
  });

  it("counts the people: two, a couple, a crowd, two roles, one person named twice", () => {
    expect(namedPeople("medium-sized short-haired tan and white dog squeezing his nose between two people hugging in the entryway")?.count).toBe(2); // job 370 scene 8
    expect(namedPeople("an older couple walking slowly along a quiet path at sunset")?.count).toBe(2); // job 400 scene 18
    expect(namedPeople("a crowd of people in a Roman street gesturing and complaining to each other")).toMatchObject({ count: 3, group: true }); // job 400 scene 29
    expect(namedPeople("a flight attendant speaking quietly with a passenger in the aisle")?.count).toBe(2); // job 399 scene 8
    expect(namedPeople("Two family members seen from behind, sitting close together at the kitchen table")?.count).toBe(2); // job 322 scene 29
    expect(namedPeople("dog sniffing a visitor's legs just inside the front door while the visitor leans away")?.count).toBe(1); // job 358 scene 6
  });

  it("never reads a person noun that describes a thing, a person who is not there, or nobody", () => {
    for (const thing of [
      "hands drilling a slim pilot hole bit into the pine door frame at workbench", // job 225 scene 34
      "hands crocheting baby booties with small tight stitches at the sewing table", // job 219 scene 100
      "hands holding a steam iron a couple inches above the pinned star blanket", // job 351 scene 149
      "hand turning the deadbolt smoothly on customer's front door", // job 280 scene 27
      "hands burning a family name into a tray end piece with a wood-burning pen", // job 216 scene 102
      "baby booties, larger size for older babies, sitting on the sewing table", // job 219 scene 99
      "a busy farmers market stall under a canopy tent",
      "a passenger jet parked at an airport gate", // job 399 scene 11
      "a bottle of water standing on the passenger's tray table", // job 399 scene 6
      "the craft-market table with rows of finished wood pieces, no people in frame", // job 161 scene 55
      "Calm, neutral background; no signage, pricing, or people.", // job 133 scene 152
      "a bare hand paused at rest beside them, framing the work without showing the person.", // job 115 scene 16
      "a finished joinery display shelf resting on a tidy craft market table where it awaits a buyer", // job 127 scene 73
      "scarves displayed in soft natural daylight showing the striped colors to potential buyers", // job 142 scene 156
      "a framed photo of a baby on the mantel",
      "a coffee maker on the counter",
    ])
      expect(namedPeople(thing), thing).toBeUndefined();
    // "mother-of-pearl" is a thing; the woman wearing it is a person.
    expect(namedPeople("chunky strand of shimmering mother-of-pearl beads resting on a woman's bare collarbone")?.people.map(p => p.noun)).toEqual(["woman"]); // job 380 scene 26
  });

  it("a driver is the tool unless the words make it a person (every stored 'driver' was a tool)", () => {
    for (const tool of [
      "Weathered bare hands from forearms down, fingers gripping a drill driver, driving a screw into a wooden cleat", // job 143 scene 100
      "Weathered bare hands from the forearms down, fingers gripping an exterior screw and a driver, pressing the fastener in", // job 162 scene 247
      "A handheld battery-powered drill and impact driver resting on a workbench with fasteners", // job 225 scene 48
      "an impact driver sinking a screw into a pine board on the workbench",
    ])
      expect(namedPeople(tool), tool).toBeUndefined();
    expect(namedPeople("a delivery driver leaving a box on the porch")?.people[0].phrase).toBe("a delivery driver");
    expect(namedPeople("the driver's hands on the steering wheel at night")?.role).toBe("driver");
  });

  it("two person words naming one thing are no people; two people side by side are two", () => {
    expect(namedPeople("a wooden bride and groom cake topper on a white cake")).toBeUndefined();
    expect(namedPeople("the king and queen pieces on a handmade chessboard")).toBeUndefined();
    expect(namedPeople("a bride and groom at the altar, seen from behind")?.count).toBe(2);
    expect(namedPeople("a husband and wife team at their market stall")?.count).toBe(2);
    expect(namedPeople("a mother and young daughter stitching a quilt block at a wooden table")?.count).toBe(2); // job 120 scene 7
  });

  it("a clause about people is no one in the frame, and the phrase never takes a verb", () => {
    // job 149 scene 68: "…demonstrating what customers are purchasing — the lit lantern."
    expect(namedPeople("showing the lantern in its intended use-case and demonstrating what customers are purchasing")).toBeUndefined();
    // jobs 121 scene 94 and 135 scene 19: the phrase is what the prompt asks to draw.
    expect(namedPeople("rows of tables, showing where handmade work meets local buyers")?.people[0].phrase).toBe("local buyers");
    expect(namedPeople("a plain backdrop show whether hours of work drew buyers")?.people[0].phrase).toBe("buyers");
  });
});

describe("showsPerson — one test for 'someone is in this picture'", () => {
  it("counts a whole person SHOWS_PERSON missed (job 400: eleven pictures of 'nobody')", () => {
    for (const t of [
      "an older man walking across an open parking lot toward a single parked car under a grey sky", // job 400 scene 6
      "a crowd of people in a Roman street gesturing and complaining to each other", // job 400 scene 29
      "two older men at a table turned away from each other, arms crossed", // job 400 scene 17
      "person seen from behind standing at the kitchen stove, flames rising from the pan on the front burner", // job 384 scene 6
    ]) {
      expect(SHOWS_PERSON.test(t), t).toBe(false);
      expect(showsPerson(t), t).toBe(true);
    }
  });

  it("does not count a pronoun that refers to an animal, and keeps every person it should", () => {
    expect(showsPerson("a hen tossing beakfuls of feed over her shoulder at the feeder")).toBe(false); // job 355 scene 17
    expect(showsPerson("medium-sized short-haired tan and white dog poking his nose into an open shopping bag set on the entryway floor")).toBe(false); // job 370 scene 7
    expect(withoutAnimalPronouns("a hen tossing beakfuls of feed over her shoulder")).toBe("a hen tossing beakfuls of feed over its shoulder");
    expect(showsPerson("she pins the hem")).toBe(true);
    expect(showsPerson("a dog asleep in her lap on the sofa")).toBe(true);
    expect(showsPerson("dog sniffing the owner's legs at the open front door")).toBe(true); // job 358 scene 10
    expect(showsPerson("charred cedar incense holder on a table with a lit incense stick burning, smoke rising")).toBe(false);
  });
});

describe("someoneElse — whether the words put someone other than the host in the picture", () => {
  it("is someone else by role, by a sex the host does not have, or by two or more people", () => {
    expect(someoneElse("a shopper's hand picking up a coaster from a market table of coasters and ornaments", { look: MAN })).toEqual({ who: "a shopper", count: 1 }); // job 341 scene 35
    expect(someoneElse("A customer's hand passing cash across a cloth-covered table for a stack of four flat round crocheted discs in mixed-colour ring stripes.", { look: MAN })?.who).toBe("a customer"); // job 327 scene 27
    expect(someoneElse("baby's hand resting on a star blanket with every tail tucked in", { look: WOMAN })?.who).toBe("a baby"); // job 351 scene 122
    expect(someoneElse("a woman's hands holding a glowing smartphone in a dark bedroom at night", { look: MAN })?.who).toBe("a woman"); // job 389 scene 22
    expect(someoneElse("a woman at night lit by a phone screen at her kitchen table", { look: MAN })?.who).toBe("a woman"); // job 397 scene 23
    expect(someoneElse("an older woman's hand resting on a framed photograph on a table", { look: MAN })?.who).toBe("an older woman"); // job 400 scene 16
    expect(someoneElse("medium-sized short-haired tan and white dog squeezing his nose between two people hugging in the entryway", { look: MAN })).toEqual({ who: "two people", count: 2 }); // job 370 scene 8
    expect(someoneElse("a senior passenger standing at a stainless steel galley counter, speaking with a flight attendant", { look: WOMAN })?.count).toBe(2); // job 399 scene 26
    expect(someoneElse("a crowd of people in a Roman street gesturing and complaining to each other", { look: MAN })?.count).toBe(3); // job 400 scene 29
    // The host is one person: other vendors in the background are other people (job 118 scene 65).
    expect(someoneElse("pegged joinery details clear in the foreground, background vendors and shoppers blurred and calm", { look: MAN })?.count).toBe(3);
  });

  it("stays the host: the host, an owner, the host's own sex with no role, and things", () => {
    expect(someoneElse("owner's bare hands hanging low near dog's nose", { look: MAN })).toBeUndefined(); // job 373 scene 27
    expect(someoneElse("chunky strand of shimmering mother-of-pearl beads resting on a woman's bare collarbone", { look: WOMAN })).toBeUndefined(); // job 380 scene 26
    expect(someoneElse("woman wearing pearl necklace over navy crewneck sweater and brown loafers walking down a bright grocery store aisle", { look: WOMAN })).toBeUndefined(); // job 364 scene 12
    expect(someoneElse("a man standing in a narrow pharmacy aisle holding a greeting card", { look: MAN })).toBeUndefined(); // job 400 scene 2
    expect(someoneElse("hand turning the deadbolt smoothly on customer's front door", { look: MAN })).toBeUndefined(); // job 280 scene 27
    expect(someoneElse("the host's hands sanding a board", { look: MAN })).toBeUndefined();
    // No look: a sex alone decides nothing; a role still does.
    expect(someoneElse("a woman at night lit by a phone screen at her kitchen table")).toBeUndefined();
    expect(someoneElse("a shopper's hand picking up a coaster")?.who).toBe("a shopper");
  });

  it("keeps a role the host gives themself, and the host's own name, as the host", () => {
    expect(selfRolesOf("Hi, I'm Ana Ruiz, a retired plumber, and today…")).toEqual(["plumber"]);
    expect(selfRolesOf("after thirty years as a nurse I can tell you")).toEqual(["nurse"]);
    expect(selfRolesOf("", "Master Locksmith")).toEqual(["locksmith"]);
    // A role the host only talks about is not theirs.
    expect(selfRolesOf("I'm Dale, and I've sold to a thousand customers")).toEqual([]);
    expect(selfRolesOf("I'm Helena Hart, and I read the fine print so travelers like us can stop learning")).toEqual([]);
    expect(someoneElse("a plumber's hands tightening a compression fitting", { look: MAN, selfRoles: ["plumber"] })).toBeUndefined();
    expect(someoneElse("a plumber's hands tightening a compression fitting", { look: MAN })?.who).toBe("a plumber");
    expect(someoneElse("Uncle Joe's hands sanding a board", { look: MAN, hostName: "Uncle Joe" })).toBeUndefined();
    // A family title in the host's name is theirs, in any of its words; a name without one gives none.
    const gran = selfRolesOf("", undefined, "Grandma Lou");
    expect(gran).toEqual(expect.arrayContaining(["grandma", "grandmother"]));
    expect(someoneElse("a grandmother's hands working a crochet hook through soft yarn", { look: WOMAN, selfRoles: gran })).toBeUndefined();
    expect(someoneElse("a grandmother's hands working a crochet hook through soft yarn", { look: WOMAN })?.who).toBe("a grandmother");
    expect(someoneElse("her granddaughter's hands on the hook", { look: WOMAN, selfRoles: gran })?.who).toBe("her granddaughter");
    expect(selfRolesOf("", undefined, "Nancy Hart")).toEqual([]);
  });

  it("reads the host's sex off their look", () => {
    expect(sexOfLook(MAN)).toBe("m");
    expect(sexOfLook(WOMAN)).toBe("f");
    expect(sexOfLook("a heavyset person with a white beard")).toBe("m");
    expect(sexOfLook(undefined)).toBeUndefined();
  });
});

describe("markHostBroll — someone else is never drawn from the host photo", () => {
  it("job 400 scene 16: an older woman's hand on a man's channel is someone else", () => {
    const s = pic(16, "an older woman's hand resting on a framed photograph on a table", { humanPresent: true });
    markHostBroll([s], { hostLook: MAN }, HOST_PHOTO);
    expect(s.otherPerson).toBe("an older woman");
    expect(s.brollHostRef).toBeUndefined();
    expect(s.brollHostLook).toBeUndefined();
    expect(s.humanPresent).toBe(true);
  });

  it("job 370 scene 8: two people are never drawn from one photo", () => {
    const s = pic(8, "medium-sized short-haired tan and white dog squeezing his nose between two people hugging in the entryway");
    markHostBroll([s], { hostLook: MAN }, HOST_PHOTO);
    expect(s.brollHostRef).toBeUndefined();
    expect(s.otherPerson).toBe("two people");
    expect(s.otherPeople).toBe(2);
  });

  it("a whole person the old words missed is drawn — the host when nothing says otherwise", () => {
    const s = pic(6, "an older man walking across an open parking lot toward a single parked car under a grey sky");
    markHostBroll([s], { hostLook: MAN }, HOST_PHOTO);
    expect(s.humanPresent).toBe(true);
    expect(s.brollHostRef).toBe(HOST_PHOTO);
    expect(s.otherPerson).toBeUndefined();
  });

  it("a planner's someone-else lives and dies with the words: stale on a thing, an animal, a host take", () => {
    const stale = pic(32, "charred cedar incense holder on a table with a lit incense stick burning, smoke rising", {
      otherPerson: "a woman customer",
      humanPresent: true,
    }); // job 361 scene 32
    const hen = pic(17, "a hen with head in the feeder tossing pellets over her shoulder", {
      otherPerson: "a hen",
      humanPresent: true,
    }); // job 371 scene 17
    const take = pic(34, "a woman customer holding a coaster at the craft fair table", {
      otherPerson: "a woman customer",
      hostPresent: true,
    });
    const kept = pic(23, "a woman seen from behind on a sofa at night, scrolling a shopping app on her phone", {
      otherPerson: "a woman customer",
      humanPresent: true,
    });
    markHostBroll([stale, hen, take, kept], { hostLook: MAN }, HOST_PHOTO);
    for (const s of [stale, hen]) {
      expect(s.otherPerson).toBeUndefined();
      expect(s.humanPresent).toBeUndefined();
      expect(s.brollHostRef).toBeUndefined();
    }
    expect(take.otherPerson).toBeUndefined();
    expect(kept.otherPerson).toBe("a woman customer");
    expect(kept.brollHostRef).toBeUndefined();
  });

  it("the host stays the host — and a self-introduced trade is the host", () => {
    const intro = pic(1, "talking", { hostPresent: true, hostIntro: true, scriptText: "I'm Ana Ruiz, a retired plumber, and this one's for you." });
    const own = pic(2, "a plumber's hands tightening a compression fitting under the sink");
    const owner = pic(3, "owner's bare hands hanging low near dog's nose"); // job 373 scene 27
    markHostBroll([intro, own, owner], { hostLook: MAN }, HOST_PHOTO);
    expect(own.brollHostRef).toBe(HOST_PHOTO);
    expect(own.otherPerson).toBeUndefined();
    expect(owner.brollHostRef).toBe(HOST_PHOTO);
  });
});

describe("the prompt draws each of several people, none of them the host", () => {
  it("asks for two people by count, and keeps the one-person wording for one", () => {
    expect(otherPersonClause("two passengers", 2)).toMatch(/^The people in this shot are two passengers — two different/);
    expect(otherPersonClause("two passengers", 2)).toMatch(/NONE of them the video's host/);
    expect(otherPersonClause("two passengers", 2)).toMatch(/Each person has exactly two arms/);
    expect(otherPersonClause("two passengers", 2)).not.toMatch(/The only person|no second person/);
    expect(otherPersonClause("a woman customer")).toMatch(/^The only person in this shot is a woman customer/);
    expect(otherPeopleSuffix(1)).toBe(ONE_OTHER_PERSON_SUFFIX);
    expect(otherPeopleSuffix(2)).toMatch(/Apart from those two people/);
  });

  it("job 399 scene 2: two passengers are drawn as two, with no 'nobody else' beside them", () => {
    const prompt = buildStillPrompt(
      pic(2, "two passengers seated in the same cabin row", { humanPresent: true, otherPerson: "two airline passengers", otherPeople: 2, stillImage: true })
    );
    expect(prompt).toContain(otherPersonClause("two airline passengers", 2));
    expect(prompt).toContain(otherPeopleSuffix(2));
    expect(prompt).not.toContain(ONE_OTHER_PERSON_SUFFIX);
  });
});

describe("someone else is carried by every step that rewrites, splits or groups a picture", () => {
  it("drops an animal from the planner, and counts people", () => {
    expect(otherPersonOf("a hen")).toBeUndefined(); // job 371 scene 17
    expect(otherPersonOf("a woman customer")).toBe("a woman customer");
    expect(otherPersonOf("a scribe")).toBe("a scribe"); // a story's people are too many for a list
    expect(otherPeopleOf("two airline passengers")).toBe(2);
    expect(otherPeopleOf("a woman customer")).toBeUndefined();
  });

  it("a planned shot of a hen is a picture of a hen, with no person in it", () => {
    const beat = pic(17, "A hen will stick her head in the feeder and sweep it side to side.", { scriptText: "A hen will stick her head in the feeder and sweep it side to side." });
    const { scenes } = applyShotPlan(
      [beat],
      [{ scene: 17, hostUntil: null, shots: [{ from: "A hen will", show: "a hen tossing beakfuls of feed over her shoulder at the feeder", other: otherPersonOf("a hen") }] }]
    );
    expect(scenes[0].otherPerson).toBeUndefined();
    expect(scenes[0].humanPresent).toBeUndefined();
  });

  it("the line check says who: someone else's line is never the host's hands (job 369 scene 22)", () => {
    expect(whoOf("host")).toBeNull();
    expect(whoOf("the viewer")).toBeNull();
    expect(whoOf("you")).toBeNull();
    expect(whoOf("your hands")).toBeNull();
    // A viewer's customer is not the viewer.
    expect(whoOf("your customer")).toBe("the customer");
    expect(whoOf("the host's neighbour")).toBe("a neighbour");
    expect(whoOf("a buyer at home")).toBe("a buyer at home");
    expect(whoOf("a hen")).toBeUndefined();
    expect(whoOf("")).toBeUndefined();
    const scenes = [
      pic(22, "hands holding a glowing phone in a dark bedroom at night", { humanPresent: true, scriptText: "a buyer three states away can find yours while you sleep" }),
      pic(23, "a maple coaster on the table", { scriptText: "Coasters sell." }),
      pic(24, "hands holding a coaster", { humanPresent: true, otherPerson: "a passenger", scriptText: "You're also welcome to ask for another." }),
    ];
    const fixes = parsePictureFixes(
      JSON.stringify({
        pictures: [
          { id: 0, about: "a buyer far away", shows_it: true, who: "a buyer at home" },
          { id: 1, about: "coasters", shows_it: true, who: "a customer" },
          { id: 2, about: "asking", shows_it: true, who: "host" },
        ],
      }),
      scenes
    );
    expect(fixes.map(f => f.who)).toEqual(["a buyer at home", "a customer", null]);
    expect(applyPictureFixes(scenes, fixes, [])).toBe(0); // nothing rewritten
    expect(scenes[0].otherPerson).toBe("a buyer at home");
    expect(scenes[1].otherPerson).toBeUndefined(); // a picture of things stays one
    expect(scenes[2].otherPerson).toBeUndefined();
  });

  it("a split part keeps the person only when its own words show them", () => {
    const s = pic(1, "a woman customer picking up an incense holder at the market table", {
      scriptText: "Every one comes out a little different, the kind you see in an old temple garden.",
      otherPerson: "a woman customer",
      humanPresent: true,
      stillImage: true,
    });
    const thing = applyPictureSplits([{ ...s }], [{ id: 0, split: [{ from: "the kind you see", show: "an old temple garden with stone lanterns" }] }], []);
    expect(thing.scenes[0].otherPerson).toBe("a woman customer");
    expect(thing.scenes[1].otherPerson).toBeUndefined();
    const person = applyPictureSplits([{ ...s }], [{ id: 0, split: [{ from: "the kind you see", show: "a woman customer holding one up to the light" }] }], []);
    expect(person.scenes[1].otherPerson).toBe("a woman customer");
  });

  it("a joined picture keeps someone else from either half", () => {
    const a = pic(1, "a woman at a kitchen table", { scriptText: "A buyer three states away", humanPresent: true, otherPerson: "a woman buyer", audioDuration: 2 });
    const b = pic(2, "a laptop", { scriptText: "can find your shop at night.", audioDuration: 2 });
    const r = applyPictureJoins([a, b], [{ id: 1, join: true, show: "a woman at a kitchen table at night browsing a laptop" }], [], s => s.audioDuration ?? 0);
    expect(r.joined).toBe(1);
    expect(r.scenes[0].otherPerson).toBe("a woman buyer");
  });

  it("a same-topic group of someone else's pictures stays theirs, never 'the host's hands'", () => {
    const scenes = [
      pic(1, "a woman customer picking up a coaster", { otherPerson: "a woman customer", humanPresent: true, stillImage: true }),
      pic(2, "a woman customer turning the coaster over", { otherPerson: "a woman customer", humanPresent: true, stillImage: true }),
    ];
    applyContextGroups(scenes, [{ ids: [0, 1], show: "coasters along the front edge of the craft fair table" }]);
    expect(scenes[0].showSubject).toBe("coasters along the front edge of the craft fair table, with a woman customer in the picture");
    expect(scenes.every(s => s.otherPerson === "a woman customer")).toBe(true);
  });
});

describe("a picture of someone else is never turned into a host check-in", () => {
  it("planHostMinutes leaves a line about someone else on its picture", () => {
    const film = (show: (i: number) => string) =>
      Array.from({ length: 40 }, (_, i) => ({
        index: i,
        narration: `line ${i}.`,
        visualPrompt: i === 0 || i === 39 ? "host talks" : show(i),
        hostPresent: i === 0 || i === 39,
        audioDuration: 6,
        ...(i === 0 ? { hostOpener: true as const } : {}),
      })) as StoryboardScene[];
    const plain = film(i => `b-roll ${i}`);
    expect(planHostMinutes(plain, 60, { canPromote: true }).promoted.length).toBeGreaterThan(0);
    const shoppers = film(() => "a shopper's hand picking up a coaster from the market table");
    expect(showsSomeoneElse(shoppers[5])).toBe(true);
    expect(planHostMinutes(shoppers, 60, { canPromote: true }).promoted).toEqual([]);
  });

  it("the plan gate never picks one to bring the host back", () => {
    const rows: [boolean, number, string, string][] = [[true, 5, "Line number 0 says a thing.", "host"]];
    let n = 1;
    for (let t = 0; t < 200; t += 28) {
      for (let k = 0; k < 4; k++) rows.push([false, 6, `Line number ${n++} says a thing.`, `thing ${n}`]);
      rows.push([true, 4, `Line number ${n++} says a thing.`, "host"]);
    }
    // 84 s with no host; every picture in it is of a customer.
    for (let k = 0; k < 14; k++) rows.push([false, 6, `Line number ${n++} says a thing.`, "a customer's hand passing cash across the table"]);
    rows.push([true, 6, `Line number ${n++} says a thing.`, "host"]);
    let at = 0;
    const scenes = rows.map(([host, sec, text, show], k) => {
      const s = {
        index: k + 1,
        scriptText: text,
        narration: text,
        visualPrompt: show,
        showSubject: show,
        hostPresent: host || undefined,
        stillImage: host ? undefined : true,
        narrationStartSec: at,
        narrationEndSec: at + sec,
        audioDuration: sec,
        audioUrl: `https://example.com/${k}.mp3`,
      } as StoryboardScene;
      at += sec;
      return s;
    });
    const r = enforcePlanRules(scenes, { faceImageUrl: "https://example.com/host.jpg" } as any);
    const customers = r.scenes.filter(s => /customer's hand/.test(s.showSubject ?? ""));
    expect(customers.filter(s => s.hostPresent && s.scriptText && /^Line number \d+ says a thing\.$/.test(s.scriptText))).toEqual([]);
  });
});

describe("everyone in a picture of someone else gets a person clause (job 399 scenes 8 and 14)", () => {
  // The planner's `other` named only the passenger, the description named a flight attendant AND a
  // passenger, and the prompt said "the only person … no face anywhere": the flight attendant was
  // drawn by no rule — her face in profile (scene 8), a different smiling woman (scene 14).
  const LOOK_399 =
    "A slender woman in her late thirties with fair skin and dark hair pinned back, wearing a white blouse, navy blazer with gold pin, and striped scarf";
  const INTRO_399 = "I'm Helena Hart, and I read the fine print so travelers like us can stop learning these things the hard way.";
  const scene8 = () =>
    pic(8, "a flight attendant speaking quietly with a passenger in the aisle", {
      scriptText: "He figures she must know somebody on the crew. She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.",
      visualPrompt: "Bare weathered hands of a flight attendant and a passenger meeting in the narrow aisle between rows, speaking quietly, blue seats and grey carpet visible.",
      humanPresent: true,
      otherPerson: "a male passenger",
      stillImage: true,
    });
  const scene14 = () =>
    pic(14, "a flight attendant speaking politely to a seated passenger", {
      scriptText: "along with the exact words that get each one. None of them is an upgrade, and each of them starts with a single polite sentence.",
      visualPrompt: "Bare hands from the forearms down, adjusting a beverage cup on the cart tray in the aircraft aisle galley during service.",
      humanPresent: true,
      otherPerson: "a seated passenger",
      stillImage: true,
    });
  const intro = (scriptText: string) => pic(9, "talking", { hostPresent: true, hostIntro: true, scriptText });

  it("castOfPicture names everyone the description names, in the planner's words for its own", () => {
    const opts = { look: LOOK_399, hostLed: true, selfRoles: selfRolesOf(INTRO_399) };
    expect(castOfPicture(scene8().showSubject, "a male passenger", opts)).toEqual({ who: "a flight attendant and a male passenger", count: 2 });
    expect(castOfPicture(scene14().showSubject, "a seated passenger", opts)).toEqual({ who: "a flight attendant and a seated passenger", count: 2 });
    // "a man" is the planner's "a male passenger"; "a man" is never the planner's woman.
    expect(castOfPicture("a flight attendant speaking with a man in the aisle", "a male passenger", opts)?.who).toBe("a flight attendant and a male passenger");
    expect(castOfPicture("a woman talking with a man at the counter", "a woman customer", opts)?.who).toBe("a woman customer and a man");
    // A name the planner gave ("Seneca") is one of the people; the description's second is added.
    expect(castOfPicture("a man at his desk talking with a student", "Seneca", opts)).toEqual({ who: "Seneca and a student", count: 2 });
    // The picture's own count stands over a planner's one passenger.
    expect(castOfPicture("two passengers chatting in the aisle", "a male passenger", opts)).toEqual({ who: "two passengers", count: 2 });
  });

  it("a description naming only the planner's people is asked for exactly as before", () => {
    const opts = { look: LOOK_399, hostLed: true };
    expect(castOfPicture("a passenger in row fourteen holding a cup with a little soda over ice", "a male passenger", opts)).toEqual({ who: "a male passenger", count: 1 }); // job 399 scene 7
    expect(castOfPicture("two passengers seated in the same cabin row", "two airline passengers", opts)).toEqual({ who: "two airline passengers", count: 2 }); // job 399 scene 2
    const s26 = "a senior passenger standing at a stainless steel galley counter, speaking with a flight attendant"; // job 399 scene 26
    expect(castOfPicture(s26, undefined, opts)).toEqual(someoneElse(s26, { look: LOOK_399 }));
    expect(castOfPicture("the host sanding a board at the bench", undefined, opts)).toBeUndefined();
    expect(castOfPicture("an older man walking across an open parking lot", undefined, { look: MAN, hostLed: true })).toBeUndefined(); // job 400 scene 6
  });

  it("the host's own job beside someone else is the host — never the planner's someone else, never 'another' one", () => {
    const roles = selfRolesOf("", "Flight Attendant");
    expect(roles).toEqual(["attendant"]);
    const on = { look: LOOK_399, hostLed: true, selfRoles: roles };
    expect(castOfPicture(scene8().showSubject, "a male passenger", on)).toEqual({ who: "a male passenger", count: 1, host: "a flight attendant" });
    expect(castOfPicture("a senior passenger standing at a stainless steel galley counter, speaking with a flight attendant", undefined, on)).toEqual({
      who: "a senior passenger",
      count: 1,
      host: "a flight attendant",
    });
    // The host by name beside someone else.
    expect(castOfPicture("Helena talking with a passenger at the cart", "a passenger", { ...on, hostName: "Helena Hart" })).toEqual({ who: "a passenger", count: 1, host: "the host" });
    // Two people the words both make the host are one host and one someone else.
    expect(castOfPicture("a plumber explaining the repair to a homeowner at the sink", undefined, { look: MAN, hostLed: true, selfRoles: ["plumber"] })).toEqual({
      who: "a homeowner",
      count: 1,
      host: "a plumber",
    });
    // Not the host: the planner named the role as someone else, "another" one, or no host on camera.
    expect(castOfPicture("a flight attendant handing a cup to a passenger", "a flight attendant", on)).toEqual({ who: "a flight attendant and a passenger", count: 2 });
    expect(castOfPicture("another nurse checking a chart beside an older man", "an older man", { look: WOMAN, hostLed: true, selfRoles: ["nurse"] })?.host).toBeUndefined();
    expect(castOfPicture(scene8().showSubject, "a male passenger", { ...on, hostLed: false })).toEqual({ who: "a flight attendant and a male passenger", count: 2 });
    expect(castOfPicture("Helena talking with a passenger at the cart", "a passenger", { ...on, hostLed: false, hostName: "Helena Hart" })).toEqual({ who: "a person and a passenger", count: 2 });
  });

  it("markHostBroll on job 399's real scenes: both people, no host photo, no host look", () => {
    const s8 = scene8();
    const s14 = scene14();
    markHostBroll([intro(INTRO_399), s8, s14], { hostLook: LOOK_399, hostName: "Helena Hart" }, HOST_PHOTO);
    expect([s8.otherPerson, s8.otherPeople]).toEqual(["a flight attendant and a male passenger", 2]);
    expect([s14.otherPerson, s14.otherPeople]).toEqual(["a flight attendant and a seated passenger", 2]);
    for (const s of [s8, s14]) {
      expect(s.hostAmongOthers).toBeUndefined();
      expect(s.brollHostRef).toBeUndefined();
      expect(s.brollHostLook).toBeUndefined();
    }
    const prompt = buildStillPrompt(s14);
    expect(prompt).toContain(otherPersonClause("a flight attendant and a seated passenger", 2));
    expect(prompt).toContain(otherPeopleSuffix(2));
    expect(prompt).not.toContain(ONE_OTHER_PERSON_SUFFIX);
    expect(prompt).not.toMatch(/The only person in this shot/);
  });

  it("with the host's job known, the flight attendant is the host from her look in words, face never shown", () => {
    const s8 = scene8();
    markHostBroll([intro("I'm Ana Ruiz, a flight attendant, and I read the fine print."), s8], { hostLook: LOOK_399 }, HOST_PHOTO);
    expect(s8.hostAmongOthers).toEqual({ who: "a flight attendant", look: LOOK_399 });
    expect([s8.otherPerson, s8.otherPeople]).toEqual(["a male passenger", undefined]);
    expect(s8.brollHostRef).toBeUndefined(); // never the photo beside a second person
    expect(s8.brollHostLook).toBeUndefined();
    expect(peopleInShot(s8)).toBe(2);
    const prompt = buildStillPrompt(s8);
    expect(prompt).toContain(hostWithOthersClause({ who: "a flight attendant", look: LOOK_399 }, "a male passenger"));
    expect(prompt).toContain(`The flight attendant is the video's host — ${LOOK_399} —`);
    expect(prompt).toContain("The other person is a male passenger — NOT the video's host");
    expect(prompt).toContain(otherPeopleSuffix(2));
    expect(prompt).not.toContain(ONE_OTHER_PERSON_SUFFIX);
    expect(prompt).not.toMatch(/The only person in this shot|Apart from that one person/);
    const clip = buildClipChain({ ...s8, stillImage: undefined }, { script: "x", lockMode: "ingredients", channelKey: "demo", voiceId: "v1" })[0].prompt;
    expect(clip).toContain(otherPeopleSuffix(2));
    expect(clip).toContain("The flight attendant is the video's host");
    // A re-run with no host on camera takes the host out again.
    markHostBroll([s8], { hostLook: LOOK_399, brollOnly: true }, HOST_PHOTO);
    expect(s8.hostAmongOthers).toBeUndefined();
  });

  it("the host-and-others clause: the host drawn from words, every face hidden, no photo named", () => {
    const one = hostWithOthersClause({ who: "a flight attendant", look: LOOK_399 }, "a male passenger");
    expect(one).toMatch(/^The people in this shot are a flight attendant and a male passenger, and no face is shown anywhere\./);
    expect(one).toMatch(/so the face is never shown\. The other person is a male passenger/);
    expect(one).toMatch(/Each person has exactly two arms/);
    expect(one).not.toMatch(/reference photo|The only person|no second person/);
    const many = hostWithOthersClause({ who: "the host", look: MAN }, "two passengers", 2);
    expect(many).toContain(`The host — ${MAN} — is always drawn`);
    expect(many).toMatch(/The others are two passengers — two different, ordinary people/);
    expect(peopleInShot({ otherPeople: 2, hostAmongOthers: { who: "the host", look: MAN } })).toBe(3);
    expect(peopleInShot({ otherPeople: undefined, hostAmongOthers: undefined })).toBe(1);
  });

  it("a picture of a film marked before, regenerated, names both people too (job 399 as stored)", () => {
    // Stored exactly as job 399 has them: `otherPerson` the passenger alone, no count.
    const s8 = scene8();
    const prompt = buildStillPrompt(s8);
    expect(prompt).toContain(otherPersonClause("a flight attendant and a male passenger", 2));
    expect(prompt).toContain(otherPeopleSuffix(2));
    expect(prompt).not.toContain(ONE_OTHER_PERSON_SUFFIX);
    expect(peopleInShot(scene14())).toBe(2);
    // A picture of the passenger alone is asked for word for word as before (399-7).
    const s7 = pic(7, "a passenger in row fourteen holding a cup with a little soda over ice", { humanPresent: true, otherPerson: "a male passenger", stillImage: true });
    expect(buildStillPrompt(s7)).toContain(otherPersonClause("a male passenger"));
    expect(buildStillPrompt(s7)).toContain(ONE_OTHER_PERSON_SUFFIX);
  });

  it("no face is asked for anyone in a picture of someone else", () => {
    const s = pic(30, "an older woman at the window, face looking worried, photographed from the shoulders up", { humanPresent: true });
    markHostBroll([s], { hostLook: MAN }, HOST_PHOTO);
    expect(s.otherPerson).toBe("an older woman");
    expect(s.showSubject).toBe("an older woman at the window, framed from the chin down");
  });

  it("the host among others is never someone the words give the other sex, nor the planner's plain person when another fits", () => {
    const nurse = { look: WOMAN, hostLed: true, selfRoles: ["nurse"] };
    // A man in the host's own job on a woman's channel is a colleague: drawn from her look he would
    // be a man with her hair and clothes.
    expect(castOfPicture("a male nurse helping an older woman out of bed", "an older woman", nurse)).toEqual({
      who: "a male nurse and an older woman",
      count: 2,
    });
    const attendant = { look: WOMAN, hostLed: true, selfRoles: ["attendant"] };
    expect(castOfPicture("a male flight attendant serving a woman passenger", undefined, attendant)?.host).toBeUndefined();
    // The same job with no sex in its words, or the sex the host has, is still the host.
    expect(castOfPicture("a nurse helping an older man out of bed", "an older man", nurse)).toEqual({ who: "an older man", count: 1, host: "a nurse" });
    expect(castOfPicture("a woman nurse helping an older man out of bed", "an older man", nurse)?.host).toBe("a woman nurse");
    // A look that gives no sex keeps no one out.
    expect(castOfPicture("a male nurse helping an older woman out of bed", "an older woman", { ...nurse, look: "dark hair, navy scrubs" })?.host).toBe("a male nurse");
    // The planner's plain "a man" is someone else, so it is the passenger, not the host's own job
    // (job 399 scene 8 with a plainer planner): the attendant is left to be the host.
    expect(castOfPicture("a flight attendant speaking quietly with a passenger in the aisle", "a man", attendant)).toEqual({
      who: "a man",
      count: 1,
      host: "a flight attendant",
    });
    // With nobody else it could be, the host's job still takes the planner's person (it said so).
    expect(castOfPicture("a flight attendant speaking with a man", "a woman", attendant)).toEqual({ who: "a woman and a man", count: 2 });
  });
});
