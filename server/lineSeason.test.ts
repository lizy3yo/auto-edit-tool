/**
 * A SEASON OR AN HOUR THE LINE NAMES IS THE PICTURE'S (round 14, the verification film 411 scene 20).
 * "That bright song at first light … belongs to spring and summer" was planned as "a robin singing on a
 * branch at first light in the backyard": the season gone, the prompt writer settled it from the
 * channel's late-fall-into-winter home base ("bare trees and patches of brown lawn"), and the robin's
 * snowy earlier pictures lent their snow. The line's season is now held in the picture's own words
 * (`holdLineSeasons`), a picture drawn from references is told it in so many words (`seasonHourClause`
 * in `memoryClause`), and the shot list and the line check carry the rule (`SEASON_HOUR_RULE`). The
 * cases are stored rows of jobs 411, 405, 412 and 224; the clean cases must not change.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import { holdLineSeasons, lineHour, lineSeason, pictureSeason, SEASON_HOUR_RULE, seasonHourClause } from "./lineSeason";
import { MEMORY_VIEWS } from "./pictureMemory";
import { buildStillPrompt, MEMORY_SETTING_CLAUSE, memoryClause } from "./longformVideo";
import { FIT_SYSTEM, SHOT_LIST_SYSTEM } from "./shotList";

const pic = (index: number, line: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: line, scriptText: line, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

const count = (text: string, part: string) => text.split(part).length - 1;

// Job 411 scenes 19-22 as stored (the host take, the song, the territorial male, the quiet winter robin).
const LINE_20 =
  "Start with the singing. That bright song at first light, the one birders have long remembered as cheer up, cheerily, belongs to spring and summer.";
const job411 = () => [
  pic(19, "It comes down to two small changes in the robin’s routine.", "a robin perched quietly in the winter backyard", {
    hostPresent: true,
    keyThing: "robin",
  }),
  pic(20, LINE_20, "a robin singing on a branch at first light in the backyard", {
    visualPrompt:
      "An American robin with reddish-orange breast singing from a low branch at first light, backyard with bare trees and patches of brown lawn behind.",
    keyThing: "robin",
  }),
  pic(
    21,
    "It’s a male letting the neighborhood know this patch is his and he’s looking for a mate.",
    "a male American robin singing from the top of a fence post above a green summer lawn",
    { keyThing: "robin" }
  ),
  pic(
    22,
    "Once nesting season is over, that job is done, and through the winter a robin hardly sings at all.",
    "a quiet robin perched silently on a bare branch in winter",
    { keyThing: "robin" }
  ),
];

describe("the season a line sets its picture in (lineSeason)", () => {
  it("job 411 scene 20: 'belongs to spring and summer' is spring — the first it names", () => {
    expect(lineSeason(LINE_20)).toEqual({ season: "spring", said: "spring" });
  });

  it("the stored lines that set one: a winter, a spring, a late winter", () => {
    expect(lineSeason("Once nesting season is over, that job is done, and through the winter a robin hardly sings at all.")?.season).toBe(
      "winter"
    );
    expect(lineSeason("Across most of the lower forty-eight, you can find robins all winter long.")?.season).toBe("winter");
    expect(lineSeason("They were gone before my coffee went cold at the church hall sale in the spring.")?.season).toBe("spring");
    expect(lineSeason("And that first robin of spring you’ll be so happy to see in March?")?.season).toBe("spring");
    expect(lineSeason("The sap only runs in late winter, when the nights still freeze.")).toEqual({ season: "winter", said: "late winter" });
    expect(lineSeason("This fall I finally cleared the shed.")?.season).toBe("autumn");
  });

  it("never a season it is getting ready for, ruled out, set against another, or a name", () => {
    expect(lineSeason("Stock up the feeders before winter, or they go hungry.")).toBeUndefined();
    expect(lineSeason("Get the hose put away ready for winter.")).toBeUndefined();
    expect(lineSeason("nobody sees another robin until spring.")).toBeUndefined();
    expect(lineSeason("buying his third sympathy card since spring")).toBeUndefined();
    // Job 148: the neighbour is expecting a baby in the spring; the blanket is handed over now.
    expect(lineSeason("or a neighbor two doors down expecting in the spring.")).toBeUndefined();
    expect(lineSeason("It never sings in winter.")).toBeUndefined();
    expect(lineSeason("In summer it sings from the fence; in winter it only clucks.")).toBeUndefined();
    expect(lineSeason("winter can be when you see the most robins all year")).toBeUndefined();
    expect(lineSeason("My sister moved down to Winter Park last year.")).toBeUndefined();
  });

  it("never a thing named after a season or the coil a spring is", () => {
    expect(lineSeason("Hang your heavy winter coat on the hook by the door.")).toBeUndefined();
    expect(lineSeason("Slice the summer squash thin.")).toBeUndefined();
    expect(lineSeason("It pulled people right up to my table at the fall bazaar in the church hall.")).toBeUndefined();
    expect(lineSeason("The latch is held shut by a small spring inside.")).toBeUndefined();
    expect(lineSeason("What finally saved me was a little spring-loaded pair of snips.")).toBeUndefined();
    expect(lineSeason("he has quietly worked out that he has about seventeen summers left.")).toBeUndefined();
  });

  it("a fall that is a tumble is never autumn; 'of the spring' is the coil, 'of spring' the season", () => {
    // A home-safety line about a fall is about the tumble: "in autumn" on a grab bar would be held.
    expect(lineSeason("She broke her hip in the fall, and she was alone for two days.")).toBeUndefined();
    expect(lineSeason("During the fall she hit her head on the edge of the tub.")).toBeUndefined();
    expect(lineSeason("Most of them happen on the stairs, and the worst is over in the fall itself.")).toBeUndefined();
    expect(lineSeason("She never got over the shock of the fall.")).toBeUndefined();
    expect(lineSeason("The tension of the spring holds the gate shut.")).toBeUndefined();
    // The season still reads where nothing speaks of a tumble — job 404's robins, a market in the fall.
    expect(lineSeason("Every fall, the robins that worked your lawn all summer seem to vanish.")?.season).toBe("autumn");
    expect(lineSeason("In the fall I sell more of these than anything else.")?.season).toBe("autumn");
    expect(lineSeason("And that first robin of spring you’ll be so happy to see in March?")?.season).toBe("spring");
  });
});

describe("the hour a line sets its picture at (lineHour)", () => {
  it("the night, said any way: at night, at 4 in the morning, before dawn", () => {
    expect(lineHour("Close the bedroom doors at night.")).toEqual({ hour: "night", said: "at night" });
    expect(lineHour("The old 9-volt battery starts chirping at 4 in the morning, somebody yanks it out")).toEqual({
      hour: "night",
      said: "at night",
    });
    // Job 405 scene 28: three in the morning and the pre-dawn window are the same dark hour.
    expect(lineHour("And three in the morning sits close enough to her pre-dawn window")).toEqual({ hour: "night", said: "at night" });
    expect(lineHour("She is up before dawn every day.")).toEqual({ hour: "night", said: "before dawn" });
  });

  it("first light and dusk, as said", () => {
    expect(lineHour(LINE_20)).toEqual({ hour: "dawn", said: "at first light" });
    expect(lineHour("Walk down to the coop at dusk, once the girls have gone up to roost, and bring the feeder inside for the night.")).toEqual({
      hour: "dusk",
      said: "at dusk",
    });
  });

  it("never a figure of speech, a hour ruled out, or two that disagree", () => {
    expect(lineHour("the eye reads light near the face as a good night's sleep you may or may not have had")).toBeUndefined();
    expect(lineHour("We're going to read the night visit from her side of the mattress")).toBeUndefined();
    expect(lineHour("Don't run the dryer at night.")).toBeUndefined();
    expect(lineHour("It hunts at dusk and sleeps through the night.")).toBeUndefined();
    expect(lineHour("It took three evenings, and it paid me about a dollar an hour.")).toBeUndefined();
  });

  it("the night beside the day holds none — but the small hours 'in the morning' are the night", () => {
    // Two moments: the picture is the sanding, by day.
    expect(lineHour("Last night I glued up the panel, and this morning I sanded it smooth.")).toBeUndefined();
    expect(lineHour("It runs all night and shuts off by itself in daylight.")).toBeUndefined();
    // Job 412 scene 27 and job 400 scene 11: "in the morning" is the small hours' own words.
    expect(
      lineHour(
        "And three in the morning sits close enough to her pre-dawn window that her body starts stirring right when yours is at its deepest."
      )
    ).toEqual({ hour: "night", said: "at night" });
    expect(lineHour("the kitchen table at two in the morning when the house is too quiet.")).toEqual({ hour: "night", said: "at night" });
  });
});

describe("a picture whose own words name none gets its line's (holdLineSeasons)", () => {
  it("job 411 scene 20 is held in spring; the host take, the summer lawn and the winter branch are left alone", () => {
    const b = job411();
    expect(holdLineSeasons(b)).toBe(1);
    expect(b[1].showSubject).toBe("a robin singing on a branch at first light in the backyard, in spring");
    expect(b[0].showSubject).toBe("a robin perched quietly in the winter backyard");
    expect(b[2].showSubject).toBe("a male American robin singing from the top of a fence post above a green summer lawn");
    expect(b[3].showSubject).toBe("a quiet robin perched silently on a bare branch in winter");
    // Run again, nothing changes: its words now name the season.
    expect(holdLineSeasons(b)).toBe(0);
  });

  it("the night a line names, on pictures that lost it (jobs 405 and 224)", () => {
    const clock = pic(28, "And three in the morning sits close enough to her pre-dawn window", "the round analog clock on the nightstand pointing near three", {
      keyThing: "clock",
    });
    const alarm = pic(
      27,
      "The old 9-volt battery starts chirping at 4 in the morning, somebody yanks it out, and that alarm is now a plastic disc glued to the ceiling doing absolutely nothing.",
      "An older round white smoke alarm mounted on the ceiling, disconnected and inactive"
    );
    expect(holdLineSeasons([clock, alarm])).toBe(2);
    expect(clock.showSubject).toBe("the round analog clock on the nightstand pointing near three, at night");
    expect(alarm.showSubject).toBe("An older round white smoke alarm mounted on the ceiling, disconnected and inactive, at night");
  });

  it("a picture that names an hour or a season already keeps its own (job 412 scene 12, job 359 scene 8)", () => {
    const bedroom = pic(12, "What happens in your bedroom at three in the morning is an appointment.", "quiet bedroom at pre-dawn with unmade bed and nightstand");
    const heater = pic(8, "A space heater quietly cooking the side of a mattress at 2 in the morning.", "a space heater glowing near a mattress in a dim bedroom at night");
    expect(holdLineSeasons([bedroom, heater])).toBe(0);
    expect(bedroom.showSubject).toBe("quiet bedroom at pre-dawn with unmade bed and nightstand");
    // A picture that set itself in the snow keeps its snow — only the hour it left out is added.
    const snowy = pic(4, LINE_20, "a robin on a snowy fence rail");
    expect(holdLineSeasons([snowy])).toBe(1);
    expect(snowy.showSubject).toBe("a robin on a snowy fence rail, at first light");
  });

  it("never the host, a CTA, a picture with no words of its own, or a season that is a key thing's name", () => {
    const host = pic(1, "Close the bedroom doors at night.", "the host at the desk", { hostPresent: true });
    const cta = pic(2, "Grab it this spring while it's on sale.", "the book on the desk", { cta: true });
    const none = pic(3, "Close the bedroom doors at night.", "", { showSubject: undefined });
    const latch = pic(4, "In the spring the latch swells and sticks.", "the gate latch on the post");
    const things: KeyThing[] = [{ name: "latch spring", look: "a small steel coil spring" }];
    expect(holdLineSeasons([host, cta, none, latch], things)).toBe(0);
    expect(latch.showSubject).toBe("the gate latch on the post");
    // Without that key thing it is the season.
    expect(holdLineSeasons([latch])).toBe(1);
    expect(latch.showSubject).toBe("the gate latch on the post, in spring");
  });

  it("a key thing's name is matched on the season word only — never its 'early' — and 'fall' is autumn", () => {
    const tomato = pic(5, "In early summer the vines need tying every week.", "tomato vines tied to a stake in the bed");
    expect(holdLineSeasons([tomato], [{ name: "early girl tomato", look: "a round red tomato" }])).toBe(1);
    expect(tomato.showSubject).toBe("tomato vines tied to a stake in the bed, in early summer");
    const mat = pic(6, "In the fall I set the mats out by every door.", "a rubber mat by the back door");
    expect(holdLineSeasons([mat], [{ name: "fall mat", look: "a ribbed black rubber mat" }])).toBe(0);
    expect(mat.showSubject).toBe("a rubber mat by the back door");
  });

  it("run again — as it is right before the prompt writer — it adds nothing to a picture it held", () => {
    // Every form the step writes reads as held on the second run: the night, before dawn, dusk, a
    // season with its "late", autumn.
    const b = [
      pic(1, "Close the bedroom doors at night.", "a white bedroom door in the hallway"),
      pic(2, "She is up before dawn every day.", "a kettle on the stove"),
      pic(3, "Walk down to the coop at dusk, once the girls have gone up to roost.", "the coop door"),
      pic(4, "The sap only runs in late winter, when the nights still freeze.", "a bucket hung on a maple tap"),
      pic(5, "In the fall I sell more of these than anything else.", "a folding table of wooden bowls"),
    ];
    expect(holdLineSeasons(b)).toBe(5);
    const after = b.map(s => s.showSubject);
    expect(after).toEqual([
      "a white bedroom door in the hallway, at night",
      "a kettle on the stove, before dawn",
      "the coop door, at dusk",
      "a bucket hung on a maple tap, in late winter",
      "a folding table of wooden bowls, in autumn",
    ]);
    expect(holdLineSeasons(b)).toBe(0);
    expect(b.map(s => s.showSubject)).toEqual(after);
  });
});

describe("a picture drawn from references is told its season and hour (seasonHourClause)", () => {
  const drawnFrom = (s: StoryboardScene): StoryboardScene => ({
    ...s,
    memoryView: MEMORY_VIEWS[0],
    memoryRefUrls: ["https://r2/411/still-src-12.png", "https://r2/411/still-src-14.png"],
  });

  it("job 411 scene 20: spring and first light, right before the setting clause, once", () => {
    const b = job411();
    holdLineSeasons(b);
    const s = drawnFrom(b[1]);
    expect(seasonHourClause(s)).toBe(
      " THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AT FIRST LIGHT (the first low light of the day), AS ITS LINE SAYS — whatever season, weather or light a reference image shows."
    );
    const clause = memoryClause(s);
    expect(clause.endsWith(`${seasonHourClause(s)}${MEMORY_SETTING_CLAUSE}`)).toBe(true);
    expect(count(buildStillPrompt(s), "THIS PICTURE IS IN SPRING")).toBe(1);
  });

  it("a cold season is not said — it is in the words, and winter's look would snow on a mild yard", () => {
    const b = job411();
    expect(seasonHourClause(drawnFrom(b[3]))).toBe("");
    expect(memoryClause(drawnFrom(b[3])).endsWith(MEMORY_SETTING_CLAUSE)).toBe(true);
    expect(memoryClause(drawnFrom(b[3]))).not.toContain("THIS PICTURE IS");
  });

  it("the night a line names, unless the picture's own words set it at another hour", () => {
    const clock = drawnFrom(
      pic(28, "And three in the morning sits close enough to her pre-dawn window", "the round analog clock on the nightstand pointing near three, at night")
    );
    expect(seasonHourClause(clock)).toBe(
      " THIS PICTURE IS AT NIGHT (night-time, no daylight anywhere in it), AS ITS LINE SAYS — whatever season, weather or light a reference image shows."
    );
    const daylit = drawnFrom(pic(5, "Close the bedroom doors at night.", "a bedroom door in bright afternoon daylight"));
    expect(seasonHourClause(daylit)).toBe("");
  });

  it("a picture whose own words hold winter is never told spring, and nothing names a season or hour says nothing", () => {
    expect(seasonHourClause(drawnFrom(pic(4, LINE_20, "a robin singing on a snowy branch")))).toBe(
      " THIS PICTURE IS AT FIRST LIGHT (the first low light of the day), AS ITS LINE SAYS — whatever season, weather or light a reference image shows."
    );
    // Job 411 scene 21's line names neither; with own words that name neither, nothing is said. (Its
    // real words, "above a green summer lawn", are summer — round 15, below.)
    expect(seasonHourClause(drawnFrom(pic(21, job411()[2].scriptText!, "a male American robin singing from the top of a fence post")))).toBe("");
  });
});

// ROUND 15, job 416 scene 20 (Walter Wren's robins, the practice film on the round-14 code): the
// passage's next line, "It's a male letting the neighborhood know this patch is his and he's looking
// for a mate.", names no season or hour; the shot list carried "at dawn in spring" into what the
// picture must show, but the sentence above was said only for a LINE's season — so the robin's one
// reference, a thawing, snow-patched March lawn, lent its snow and its flat daylight, between a leafy
// spring branch (scene 19: the same reference, a line that names spring) and the winter-quiet robin.
const LINE_416_20 = "It’s a male letting the neighborhood know this patch is his and he’s looking for a mate.";
const job416 = () => [
  pic(
    19,
    "Start with the singing. That bright song at first light, the one birders have long remembered as cheer up, cheerily, belongs to spring and summer.",
    "a male American robin singing on a leafy tree branch at first light in spring, chest puffed",
    { keyThing: "robin" }
  ),
  pic(20, LINE_416_20, "a male American robin singing from the top of a wooden fence post at dawn in spring, chest puffed out", {
    visualPrompt: "A male American robin singing from the top of a wooden fence post at dawn in spring, chest puffed out, singing actively.",
    keyThing: "robin",
  }),
  pic(
    21,
    "Once nesting season is over, that job is done, and through the winter a robin hardly sings at all. Mostly you’ll hear a low, soft clucking, a bit like somebody tutting under their breath, and that’s easy to miss with the storm windows shut.",
    "an American robin with beak slightly open on a snow-patched backyard lawn, a house with closed white storm windows behind it",
    { keyThing: "robin" }
  ),
];

describe("the season a picture's own words set it in (pictureSeason)", () => {
  it("said in a frame, as a line says it — job 416 scene 20's 'at dawn in spring'", () => {
    expect(pictureSeason(job416()[1].showSubject)).toEqual({ season: "spring", said: "spring" });
    expect(pictureSeason("tomato vines tied to a stake in the bed in early summer")).toEqual({ season: "summer", said: "early summer" });
  });

  it("and as a describing word before an outdoor scene, which a spoken line never counts", () => {
    // Job 411 scene 21's own words, under the same line as job 416 scene 20.
    expect(pictureSeason("a male American robin singing from the top of a fence post above a green summer lawn")?.season).toBe("summer");
    expect(pictureSeason("a spring garden in full bloom behind the gate")?.season).toBe("spring");
    expect(pictureSeason("fall leaves drifting across the stone path")?.season).toBe("autumn");
    expect(lineSeason("We walked out across the summer lawn to the fence.")).toBeUndefined();
    expect(lineSeason("The spring garden club meets at the library.")).toBeUndefined();
  });

  it("and before the light or the time of day it is seen in (job 332 scenes 14 and 26, job 401 scene 33)", () => {
    // Job 332 scene 14's own words, drawn from two references.
    expect(
      pictureSeason(
        "A foot-square pale pine grid with equal square openings, standing upright on a folding table draped in plain dark cloth outdoors under pale early-spring light."
      )
    ).toEqual({ season: "spring", said: "early spring" });
    expect(pictureSeason("Neat rows of small charred cedar blocks on a dark-cloth-draped folding table outdoors in pale spring light.")?.season).toBe("spring");
    expect(pictureSeason("Plain cream card resting on a wooden desk in a quiet study, late-spring light from a nearby window.")).toEqual({
      season: "spring",
      said: "late spring",
    });
    expect(pictureSeason("a robin on a fence post on a spring morning")?.season).toBe("spring");
    expect(pictureSeason("a market table in even summer daylight")?.season).toBe("summer");
    expect(pictureSeason("finished coasters on the bench in soft fall light")?.season).toBe("autumn");
    // A spoken line reads it as before.
    expect(lineSeason("It was a spring morning like any other.")).toBeUndefined();
    // Never the coil or a tumble beside the light or the hour.
    expect(pictureSeason("the tension of the spring in the morning light")).toBeUndefined();
    expect(pictureSeason("a coiled spring beside the light switch")).toBeUndefined();
    expect(pictureSeason("a spring-loaded light switch on the wall")).toBeUndefined();
    expect(pictureSeason("a fall day at the foot of the stairs where she slipped")).toBeUndefined();
  });

  it("with every one of a line's exclusions: a tumble, the coil, a season planned for, a thing named after one, a name", () => {
    expect(pictureSeason("an aluminium ladder lying at the foot of the stairs after the fall")).toBeUndefined();
    expect(pictureSeason("a grab bar beside the tub where she landed in the fall")).toBeUndefined();
    expect(pictureSeason("a close view of the tension of the spring in the gate latch")).toBeUndefined();
    expect(pictureSeason("a coiled spring in the latch")).toBeUndefined();
    expect(pictureSeason("a spring-loaded clamp on the bench")).toBeUndefined();
    expect(pictureSeason("a crib and a folded blanket, ready for spring")).toBeUndefined();
    expect(pictureSeason("seed packets laid out before spring")).toBeUndefined();
    expect(pictureSeason("sliced summer squash on a cutting board")).toBeUndefined();
    expect(pictureSeason("a heavy winter coat on a hook by the door")).toBeUndefined();
    expect(pictureSeason("a street sign for Winter Park at the corner")).toBeUndefined();
  });
});

describe("a picture drawn from references is told the season and hour its OWN words name (round 15, job 416 scene 20)", () => {
  const drawnFrom = (s: StoryboardScene, view: string = MEMORY_VIEWS[3]): StoryboardScene => ({
    ...s,
    memoryView: view,
    memoryRefUrls: ["https://r2/416/still-src-5.png"],
  });
  const SAY = "— whatever season, weather or light a reference image shows.";

  it("scene 20: spring and dawn from its own words, right before the setting clause, once", () => {
    const b = job416();
    // Its own words hold the season already: the line names none, so nothing is added to them.
    expect(holdLineSeasons(b)).toBe(0);
    const s = drawnFrom(b[1]);
    expect(seasonHourClause(s)).toBe(
      ` THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AT DAWN (the first low light of the day), AS ITS OWN WORDS SAY ${SAY}`
    );
    expect(memoryClause(s).endsWith(`${seasonHourClause(s)}${MEMORY_SETTING_CLAUSE}`)).toBe(true);
    expect(count(buildStillPrompt(s), "THIS PICTURE IS IN SPRING")).toBe(1);
  });

  it("scene 19's line and own words agree, so it reads as before; scene 21's snow and winter say nothing", () => {
    const b = job416();
    expect(seasonHourClause(drawnFrom(b[0], MEMORY_VIEWS[2]))).toBe(
      ` THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AT FIRST LIGHT (the first low light of the day), AS ITS LINE SAYS ${SAY}`
    );
    expect(seasonHourClause(drawnFrom(b[2]))).toBe("");
    expect(memoryClause(drawnFrom(b[2]))).not.toContain("THIS PICTURE IS");
  });

  it("job 411 scene 21, the same line: 'above a green summer lawn' is summer", () => {
    expect(seasonHourClause(drawnFrom(job411()[2]))).toBe(
      ` THIS PICTURE IS IN SUMMER (no snow, frost or ice on anything), AS ITS OWN WORDS SAY ${SAY}`
    );
  });

  it("a season said of the light (job 332 scene 14, job 401 scene 33's rewrite)", () => {
    const grid = pic(
      14,
      "I figured 2 hours. It took 6. It sells for $90 to $130, but once you take out the lumber, that's about $14 for every hour I stood at the bench.",
      "A foot-square pale pine grid with equal square openings, standing upright on a folding table draped in plain dark cloth outdoors under pale early-spring light.",
      { keyThing: "kumiko lattice panel" }
    );
    expect(seasonHourClause(drawnFrom(grid))).toBe(
      ` THIS PICTURE IS IN EARLY SPRING (no snow, frost or ice on anything), AS ITS OWN WORDS SAY ${SAY}`
    );
    // What it must show names no season: the rewrite's is held.
    const card = pic(33, "Then he turns the whole thing over in a single motion: life is not short.", "a cream sympathy card resting on the wooden desk in the study", {
      visualPrompt: "Plain cream sympathy card with simple embossed border resting on a wooden desk in a quiet study, late-spring light from a nearby window.",
      keyThing: "sympathy card",
    });
    expect(seasonHourClause(drawnFrom(card))).toBe(` THIS PICTURE IS IN LATE SPRING (no snow, frost or ice on anything), AS ITS OWN WORDS SAY ${SAY}`);
    // Fall light in its own words keeps a spring line unsaid: its own words beat the line.
    expect(seasonHourClause(drawnFrom(pic(5, "In the spring I set the hens' feeder out by the run.", "the feeder by the coop in soft fall light")))).toBe("");
  });

  it("an hour only the picture names (job 405 scene 20: the night visit, read from the cat's side)", () => {
    const visit = drawnFrom(
      pic(
        20,
        "We’re going to read the night visit from her side of the mattress, what she’s doing, why it works on you, and what to do about it.",
        "the tabby cat walking across the bed at night near the host"
      )
    );
    expect(seasonHourClause(visit)).toBe(` THIS PICTURE IS AT NIGHT (night-time, no daylight anywhere in it), AS ITS OWN WORDS SAY ${SAY}`);
  });

  it("the line's season and the picture's hour together", () => {
    const s = drawnFrom(pic(7, "In the spring I set the hens' feeder out by the run.", "the feeder by the coop at dusk"));
    expect(seasonHourClause(s)).toBe(
      ` THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AT DUSK (the last low light of the day), AS ITS LINE AND ITS OWN WORDS SAY ${SAY}`
    );
  });

  it("what the picture must show outranks its line; the line outranks the prompt writer's rewrite", () => {
    // The shot list chose summer for this half of "spring and summer".
    expect(seasonHourClause(drawnFrom(pic(8, LINE_20, "a robin singing on a fence post in summer")))).toBe(
      ` THIS PICTURE IS IN SUMMER (no snow, frost or ice on anything), AT FIRST LIGHT (the first low light of the day), AS ITS LINE AND ITS OWN WORDS SAY ${SAY}`
    );
    // A rewrite that names spring under a winter line is not told spring — and winter is never said.
    const winter = pic(9, "Through the winter a robin hardly sings at all.", "a quiet robin on a bare branch", {
      visualPrompt: "A quiet robin on a branch in a spring garden.",
    });
    expect(seasonHourClause(drawnFrom(winter))).toBe("");
    // With nothing above it, the rewrite's own words are held (old stories have no showSubject).
    const rewrite = pic(10, LINE_416_20, "", { showSubject: undefined, visualPrompt: "A robin on a fence post at dawn in spring." });
    expect(seasonHourClause(drawnFrom(rewrite))).toBe(
      ` THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AT DAWN (the first low light of the day), AS ITS OWN WORDS SAY ${SAY}`
    );
  });

  it("a cold season is never said, and snow in the picture's own words keeps a spring unsaid", () => {
    expect(seasonHourClause(drawnFrom(pic(11, LINE_416_20, "a robin on a fence post in winter")))).toBe("");
    expect(seasonHourClause(drawnFrom(pic(12, LINE_416_20, "a robin on a fence post in late fall")))).toBe("");
    expect(seasonHourClause(drawnFrom(pic(13, LINE_416_20, "a robin on a snowy fence post at dawn in early spring")))).toBe(
      ` THIS PICTURE IS AT DAWN (the first low light of the day), AS ITS OWN WORDS SAY ${SAY}`
    );
  });

  it("a season the line only plans for is never taken back from the picture's words (job 158 scene 97)", () => {
    const porch = pic(97, "or a neighbor two doors down expecting in the spring.", "the front porch and white picket fence, neighbor's yard next door", {
      visualPrompt: "White picket fence and wooden front porch of a neighbor's house, spring yard beyond, empty and calm.",
    });
    expect(seasonHourClause(drawnFrom(porch))).toBe("");
    expect(seasonHourClause(drawnFrom({ ...porch, showSubject: "the neighbor's front porch in spring" }))).toBe("");
    const beds = pic(14, "Get the beds dug and ready for spring.", "the dug vegetable beds in spring");
    expect(seasonHourClause(drawnFrom(beds))).toBe("");
    // Job 411 scene 3's line: the spring is waited for — its picture is the empty frosty lawn at dawn.
    const until = "and nobody sees another robin until spring. At least, that’s what just about everybody figures.";
    expect(seasonHourClause(drawnFrom(pic(3, until, "an empty backyard lawn in spring")))).toBe("");
    expect(seasonHourClause(drawnFrom(pic(3, until, "an empty frosty backyard lawn at dawn under a pale sky")))).toBe(
      ` THIS PICTURE IS AT DAWN (the first low light of the day), AS ITS OWN WORDS SAY ${SAY}`
    );
    // A season only ruled out is still the moment, with an act ruled out: the summer lawn is said.
    const mower = pic(14, "Never mow it short in summer.", "a push mower on a summer lawn");
    expect(seasonHourClause(drawnFrom(mower))).toBe(` THIS PICTURE IS IN SUMMER (no snow, frost or ice on anything), AS ITS OWN WORDS SAY ${SAY}`);
  });

  it("never a season word that names the picture's key thing, the coil, or a tumble; an hour the picture contradicts", () => {
    const latch = pic(15, LINE_416_20, "the gate latch on a sunny day in spring", { keyThing: "latch spring" });
    expect(seasonHourClause(drawnFrom(latch))).toBe("");
    // The same words about another key thing are the season.
    expect(seasonHourClause(drawnFrom({ ...latch, keyThing: "gate latch" }))).toBe(
      ` THIS PICTURE IS IN SPRING (no snow, frost or ice on anything), AS ITS OWN WORDS SAY ${SAY}`
    );
    expect(seasonHourClause(drawnFrom(pic(16, LINE_416_20, "the tension of the spring in the gate latch")))).toBe("");
    expect(seasonHourClause(drawnFrom(pic(17, "She was alone for two days.", "a grab bar beside the tub where she landed in the fall")))).toBe("");
    // What the picture must show is daylit: the rewrite's night is not said.
    const table = pic(18, LINE_416_20, "a kitchen table in bright afternoon daylight", { visualPrompt: "A kitchen table at night." });
    expect(seasonHourClause(drawnFrom(table))).toBe("");
  });
});

describe("the shot list and the line check hold the season and the hour", () => {
  it("both carry the one rule, with neutral examples", () => {
    expect(SHOT_LIST_SYSTEM).toContain(`1i. ${SEASON_HOUR_RULE}`);
    expect(FIT_SYSTEM).toContain(SEASON_HOUR_RULE);
    expect(FIT_SYSTEM).toContain("the SEASON or HOUR the line sets it in");
    expect(SEASON_HOUR_RULE).not.toMatch(/\b(?:robin|cat|bird|song)\b/i);
  });
});
