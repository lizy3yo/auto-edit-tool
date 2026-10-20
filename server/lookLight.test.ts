/**
 * A WRITTEN LOOK CARRIES NO LIGHT, WEATHER OR HOUR (round 14, the verification film 412 scene 25). The
 * props list wrote "wild landscape: an open dawn-lit wilderness with low golden light, …", and that
 * golden light reached every picture of it — as the key thing's look and as the props list the prompt
 * writer draws "exactly like this" — so the check called each one staged and no redraw could clear it.
 * Now the props call is told a look never says the light, weather, season or hour (`CONTINUITY_SYSTEM`),
 * and wherever a look reaches a prompt it is cut out (`lookWithoutLight`): the props list the writers
 * read (`sheetWithoutLight`) and every look a picture is drawn by (`pictureLook`). The cases are stored
 * props-list lines; the light a thing HAS, a light colour, and a thing named for a season or the weather
 * must not change.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import { keyThingLookClause, keyThingLookFor, lookWithoutLight, pictureLook, sheetWithoutLight } from "./pictureMemory";
import { CONTINUITY_SYSTEM, parseKeyThings } from "./shotList";

// Job 412's props list as stored.
const SHEET_412 = [
  "bedroom: a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature, calm and tidy surroundings",
  "MAIN cat: a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes",
  "bed: a low wooden-framed bed with white rumpled sheets and a dark grey blanket pushed to one side, positioned centrally in the bedroom",
  "phone: a slim black smartphone with a glass screen and rear camera lens, usually held or resting on the nightstand",
  "cat paws: belonging to the same grey-and-white domestic shorthair cat, small white-tipped paws with pink pads, moving silently across fabric",
  "wild landscape: an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people",
  "nightstand: a small wooden bedside table beside the bed, bare wooden surface, one shallow drawer, dark honey-brown finish",
].join("\n");

// Job 411's props list as stored: the home line's light, and the weather as a thing of its own.
const SHEET_411 = [
  "backyard: a suburban yard with a mowed lawn, holly bushes with red berries along the border, a porch light fixture, storm windows on the house, late fall to winter light",
  "MAIN robin: an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring",
  "kitchen window: a rectangular window with white wooden frame, clear glass panes, looking out over the lawn",
  "holly bush: a dense evergreen shrub with glossy pointed dark green leaves and clusters of bright red berries",
  "porch light: a small wall-mounted light fixture with a frosted glass globe and dark metal base, beside the back door",
  "storm window: a clear glass pane set in a white aluminum frame mounted over the main window",
  "lawn: a wide stretch of short green-to-brown grass covering the backyard",
  "snow: a thin even layer of white snow covering the lawn and holly leaves in late winter",
].join("\n");

describe("a look without its light, weather or hour (lookWithoutLight)", () => {
  it("job 412: the wilderness keeps its brush and hills, loses the dawn and the golden light", () => {
    expect(
      lookWithoutLight(
        "an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people"
      )
    ).toBe("an open wilderness, scattered brush and distant hills, calm and empty of people");
    expect(
      lookWithoutLight(
        "a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature, calm and tidy surroundings"
      )
    ).toBe("a quiet bedroom, an unmade bed as the central feature, calm and tidy surroundings");
  });

  it("the stored looks of things: light through a window, a lamp's evening light, an hour, a season, frost", () => {
    // Job 401's church pew, job 348's lamp, job 405's lamp, job 404's storm window, job 360's coop.
    expect(lookWithoutLight("a long polished wooden bench, empty, light filtering through tall windows")).toBe(
      "a long polished wooden bench, empty"
    );
    expect(
      lookWithoutLight("brass-based lamp with a cream fabric shade, casting warm light over the sewing table in the evening")
    ).toBe("brass-based lamp with a cream fabric shade");
    expect(
      lookWithoutLight("a small bedside lamp with a cream fabric shade and short brass stand, warm low glow at night")
    ).toBe("a small bedside lamp with a cream fabric shade and short brass stand");
    expect(
      lookWithoutLight("a clear glass pane set in a white aluminum frame, fitted outside the regular window, closed tight through winter")
    ).toBe("a clear glass pane set in a white aluminum frame, fitted outside the regular window, closed tight");
    expect(
      lookWithoutLight("small wood-paneled structure with a slanted roof and a roosting bar inside, dim at dusk")
    ).toBe("small wood-paneled structure with a slanted roof and a roosting bar inside");
    // Job 303: the cut leaves nothing dangling ("…, set").
    expect(lookWithoutLight("outdoor canopy tent over the table, set against a cold gray autumn sky")).toBe(
      "outdoor canopy tent over the table"
    );
    // Job 148: a describing word that was all light leaves its noun to the words before it.
    expect(lookWithoutLight("beside a cushioned rocking chair in a modest, dimly lit house.")).toBe(
      "beside a cushioned rocking chair in a modest house."
    );
    // Job 404: frost left on a lawn's colour, and on its roofs.
    expect(lookWithoutLight("a flat suburban backyard lawn, green fading to frost-dusted brown, bordered by a low wooden fence")).toBe(
      "a flat suburban backyard lawn, green fading to brown, bordered by a low wooden fence"
    );
  });

  it("never the light a thing HAS, a light colour or wear, or a thing named for a season or the weather", () => {
    const same = [
      // Jobs 384, 364, 343, 392: an indicator light, light-catching gold, a lit screen, the pearls' glow.
      "round white plastic disc like the main alarm but slightly thicker, with a small blinking indicator light on its face",
      "fine thin gold chain with one small pendant, delicate and light-catching, laid flat on a surface",
      "open laptop with a plain lit screen showing a soft-focus photo of a wooden board, resting on the workbench",
      "single strand of round cream pearls, sixteen to eighteen inches, soft matte glow, worn at the collarbone",
      // Jobs 349, 357, 370: a light colour, a thin or dark thing, a light dusting.
      "round wood discs, thin, light maple tone, smooth finish, grouped in a tidy stack",
      "dark, damp, black leather-textured, low to the ground, always working toward shoes and hands",
      "dark denim jeans, cuffs slightly faded, a light dusting of outdoor residue near the ankle",
      "solid wood top on four sturdy legs, light scratches and sawdust dusting, centered under pegboard",
      // Jobs 366, 411: a winter coat, a frosted glass globe, the video's robin.
      "heavy canvas winter coat, dark olive, hung on a wall hook by the entryway",
      "a small wall-mounted light fixture with a frosted glass globe and dark metal base, beside the back door",
      "an American robin, a reddish-orange breast, a dark gray-brown back, a white lower belly, a white eye ring",
      // A tee in light grey, a board light in colour, a door's strip of light (job 329's kind of
      // look), a bird in winter plumage, a clothes peg held shut with a spring.
      "a plain cotton tee in light grey",
      "plain ash wood, light in color, smooth",
      "a white door, a thin strip of light at its base",
      "a small finch in winter plumage, a pale buff belly",
      "a wooden clothes peg held shut with a spring",
    ];
    for (const look of same) expect(lookWithoutLight(look)).toBe(look);
  });
});

describe("the props list as the writers read it (sheetWithoutLight)", () => {
  it("job 412: the home line and the wilderness lose their light; every other line is byte for byte the same", () => {
    const out = sheetWithoutLight(SHEET_412).split("\n");
    const was = SHEET_412.split("\n");
    expect(out[0]).toBe("bedroom: a quiet bedroom, an unmade bed as the central feature, calm and tidy surroundings");
    // Nor, since round 16, who is in it ("empty of people", `lookWithoutState`).
    expect(out[5]).toBe("wild landscape: an open wilderness, scattered brush and distant hills, calm");
    for (const i of [1, 2, 3, 4, 6]) expect(out[i]).toBe(was[i]);
    // The key things parsed from it keep their names, the MAIN one included.
    expect(parseKeyThings(sheetWithoutLight(SHEET_412)).map(k => k.name)).toEqual(parseKeyThings(SHEET_412).map(k => k.name));
    expect(parseKeyThings(sheetWithoutLight(SHEET_412)).find(k => k.main)?.name).toBe("cat");
  });

  it("job 411: the backyard loses its winter light; the snow is the weather itself and keeps its look", () => {
    const out = sheetWithoutLight(SHEET_411).split("\n");
    const was = SHEET_411.split("\n");
    expect(out[0]).toBe(
      "backyard: a suburban yard with a mowed lawn, holly bushes with red berries along the border, a porch light fixture, storm windows on the house"
    );
    for (let i = 1; i < was.length; i++) expect(out[i]).toBe(was[i]);
  });

  it("a list with no light in it comes back as it was, and so do the people's lines", () => {
    const sheet = [
      "garage workshop: one-car garage, concrete floor, pegboard tool wall, wooden workbench along back wall",
      "MAIN cutting board: walnut and maple board, rectangular, alternating dark and light wood strips",
      "PERSON the neighbour: a tall man in his seventies, thin white hair, a faded green jacket, out at dawn",
    ].join("\n");
    expect(sheetWithoutLight(sheet)).toBe(sheet);
    expect(sheetWithoutLight("")).toBe("");
    expect(sheetWithoutLight(undefined)).toBe("");
  });
});

describe("every look a picture is drawn by (pictureLook, keyThingLookFor)", () => {
  it("a thing's look in its picture's prompt carries no light: job 401's pew, job 409's table", () => {
    const things: KeyThing[] = [
      { name: "church pew", look: "a long polished wooden bench, empty, light filtering through tall windows" },
      { name: "kitchen table", look: "a round wooden table with a smooth pale finish, two plain wooden chairs, dim late-night lighting" },
    ];
    const pew = { index: 3, narration: "n", scriptText: "n", showSubject: "the church pew", keyThing: "church pew" } as StoryboardScene;
    const table = { index: 4, narration: "n", scriptText: "n", showSubject: "the kitchen table", keyThing: "kitchen table" } as StoryboardScene;
    // "empty" goes too since round 16: whether anyone sits on it is each picture's own (`lookWithoutState`).
    expect(keyThingLookFor(pew, things, false)).toBe("a long polished wooden bench");
    expect(keyThingLookFor(table, things, false)).toBe("a round wooden table with a smooth pale finish, two plain wooden chairs");
    const clause = keyThingLookClause({ ...table, keyThingLook: keyThingLookFor(table, things, false) });
    expect(clause).toContain("HOW THE KITCHEN TABLE LOOKS in every picture of this video: a round wooden table");
    expect(clause).not.toMatch(/light|night/i);
  });

  it("a look with no light reaches the old cut untouched", () => {
    // Job 412's cat: nothing taken out, so the cut for the picture is exactly what it was.
    const cat = "a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail held low, pale green eyes";
    expect(lookWithoutLight(cat)).toBe(cat);
    expect(pictureLook(cat)).toBe("a domestic shorthair cat, soft grey-and-white coat, medium build, a long tail, pale green eyes");
  });
});

describe("the props call is told the rule", () => {
  it("a look says what the thing IS — no light, weather, season or hour — with neutral examples", () => {
    expect(CONTINUITY_SYSTEM).toContain("A look says what the thing IS, never the light, weather, season or hour it is seen in");
    expect(CONTINUITY_SYSTEM).toContain("only a line that IS the weather (snow, fog) describes it");
  });
});
