/**
 * A KEY THING'S LOOK NAMES ITS EXACT KIND, AND A SPLIT PANEL IS DRAWN BY IT (2026-10-18, job 404
 * scene 4). On a channel about the North American robin, the split panel "a robin perched on a holly
 * bush … snow" — the film's first robin — came back as the European Christmas-card robin, while every
 * robin after it was the American one. The panel had no earlier picture of the robin to follow, so
 * it was drawn by the robin's written look, and that look never said which robin: "a plump songbird
 * about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head, seen on
 * grass, bare branches, and holly shrubs" — cut for the picture to "…dark head, bare branches, and
 * holly shrubs", the place's list left behind. The cases are real rows from stored films; the rules
 * are general.
 */
import { describe, expect, it } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";
import {
  attachMemory,
  memoryFor,
  memoryView,
  pictureLook,
} from "./pictureMemory";
import {
  CONTINUITY_SYSTEM,
  EXACT_KIND_RULE,
  matchKeyThing,
  parseKeyThings,
} from "./shotList";
import {
  attachKeyframeMemory,
  buildSplitRightScene,
  buildStillPrompt,
  memoryFields,
  withSplitMemory,
} from "./longformVideo";

const pic = (
  index: number,
  show: string,
  over: Partial<StoryboardScene> = {}
) =>
  ({
    index,
    narration: "n",
    scriptText: "n",
    showSubject: show,
    visualPrompt: show,
    ...over,
  }) as StoryboardScene;
const split = (
  index: number,
  panel: string,
  over: Partial<StoryboardScene> = {}
) =>
  ({
    index,
    narration: "n",
    scriptText: "n",
    hostPresent: true,
    splitVisual: panel,
    visualPrompt:
      "the channel's host, exactly as in their host photo, seated in a chair talking directly to the camera",
    ...over,
  }) as StoryboardScene;

// Job 404's robin line, as stored.
const STORED_ROBIN =
  "a plump songbird about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head, " +
  "seen on grass, bare branches, and holly shrubs";
// The same line as the props list is now told to write it: the exact kind first, then what sets it apart.
const AMERICAN_ROBIN =
  "an American robin, about ten inches long, dark grey head, yellow bill, broken white ring around the eye, " +
  "brick-orange breast that stops below a streaked white throat, grey-brown back";
const PANEL =
  "A robin perched on a holly bush, its branches laden with bright red berries, snow on the ground nearby in winter.";
const LINE =
  "Across a good part of the country, plenty of those robins never leave at all,";

const things = (robin: string): KeyThing[] => [
  { name: "robin", main: true, look: robin },
  {
    name: "lawn",
    look: "a flat suburban backyard lawn, green fading to frost-dusted brown, bordered by a low wooden fence",
  },
  {
    name: "holly bush",
    look: "a dense evergreen shrub with glossy pointed dark green leaves and clusters of small bright red berries",
  },
];

/** Job 404 scenes 2-5: two lawn pictures, the robin's split panel, then its first full-frame picture. */
function robinFilm(): StoryboardScene[] {
  return [
    pic(2, "a frost-dusted suburban lawn seen from a kitchen window", {
      keyThing: "lawn",
      pictureUrl: "https://r2.test/404/2.png",
    }),
    pic(3, "the lawn under patches of melting snow", {
      keyThing: "lawn",
      pictureUrl: "https://r2.test/404/3.png",
    }),
    split(4, PANEL, { keyThing: "robin", scriptText: LINE }),
    pic(5, "a robin standing on frost-dusted grass in early spring", {
      keyThing: "robin",
    }),
  ];
}

describe("the props list writes a living thing or a named kind as that exact kind", () => {
  it("asks for the species, breed or variety as the script's own region says it, then 2-3 features that set it apart", () => {
    expect(CONTINUITY_SYSTEM).toContain(EXACT_KIND_RULE);
    expect(EXACT_KIND_RULE).toMatch(
      /A LIVING THING \(an animal, bird, fish, insect, plant, tree or flower\)/
    );
    expect(EXACT_KIND_RULE).toMatch(/a species, breed, variety or type/);
    expect(EXACT_KIND_RULE).toMatch(/its look STARTS with that exact kind/);
    expect(EXACT_KIND_RULE).toMatch(
      /as people in the script's own country or region say it/
    );
    expect(EXACT_KIND_RULE).toMatch(
      /one common name can mean different kinds in different countries/
    );
    expect(EXACT_KIND_RULE).toMatch(
      /the 2-3 features a viewer tells it apart from its look-alikes by/
    );
  });

  it("says the features as what it has, never the look-alike, and never where it is seen", () => {
    // A picture generator draws what it reads: "not a European robin" would ask for one.
    expect(EXACT_KIND_RULE).toMatch(
      /each said as what it HAS, never naming the look-alike/
    );
    // Job 404's look ran on into "seen on grass, bare branches, and holly shrubs".
    expect(EXACT_KIND_RULE).toMatch(/never where it is seen/);
  });

  it("keeps the script's own word as the name, the word the pictures are matched by", () => {
    expect(EXACT_KIND_RULE).toMatch(/its name stays the word the script uses/);
    const sheet = `home kitchen: a suburban kitchen, white cabinets\nMAIN robin: ${AMERICAN_ROBIN}`;
    const [robin] = parseKeyThings(sheet);
    expect(robin).toMatchObject({
      name: "robin",
      main: true,
      look: AMERICAN_ROBIN,
    });
    expect(matchKeyThing("robin", parseKeyThings(sheet))?.name).toBe("robin");
  });

  it("gives a neutral example, and the example survives the cut its own looks go through", () => {
    expect(EXACT_KIND_RULE).not.toMatch(
      /\b(?:robin|holly|songbird|tabby|cat)\b/i
    );
    const example = /`(deer: [^`]+)`/.exec(EXACT_KIND_RULE)![1];
    const [deer] = parseKeyThings(`home field: an open meadow\n${example}`);
    expect(deer.name).toBe("deer");
    expect(deer.look.startsWith("a white-tailed deer")).toBe(true);
    expect(pictureLook(deer.look)).toBe(deer.look);
  });
});

describe("a key thing's look cut for the picture", () => {
  it("job 404: a place's list goes with it — the robin's look no longer ends on 'bare branches, and holly shrubs'", () => {
    expect(pictureLook(STORED_ROBIN)).toBe(
      "a plump songbird about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head"
    );
  });

  it("job 328: a rack 'holding a hand sander, clamps, and a square' is not told it looks like 'clamps, and a square'", () => {
    expect(
      pictureLook(
        "wall-mounted rack holding a hand sander, clamps, and a square, hung above the workbench."
      )
    ).toBe("");
  });

  it("keeps the exact kind and every feature that sets it apart", () => {
    expect(pictureLook(AMERICAN_ROBIN)).toBe(AMERICAN_ROBIN);
    expect(pictureLook(AMERICAN_ROBIN, "noStage")).toBe(AMERICAN_ROBIN);
  });

  it("never cuts on past a dropped clause unless what follows is that clause's list", () => {
    // Job 400: no item opens on "and" — no list.
    expect(
      pictureLook(
        "a plain beige passenger seat and dashboard, seen from the side, quiet and empty"
      )
    ).toBe("a plain beige passenger seat and dashboard, quiet and empty");
    // Job 395: a place listing what it HAS is the thing itself.
    expect(
      pictureLook(
        "bright indoor store with wide aisles, pale flooring, and tall open shelves, softly lit"
      )
    ).toBe("pale flooring, and tall open shelves, softly lit");
    // A colour is the thing's own look, and so is a clause too long to be one item of a list.
    expect(
      pictureLook(
        "small tin toy truck, seen from the front, a red cab, and blue trim"
      )
    ).toBe("small tin toy truck, a red cab, and blue trim");
    expect(
      pictureLook(
        "a garden gnome, kept by the pond, a pointed hat over a round face, and a long beard"
      )
    ).toBe("a garden gnome, a pointed hat over a round face, and a long beard");
  });

  it("a living thing marked with colours keeps them; anything marked with writing still goes", () => {
    expect(
      pictureLook(
        "a small brown songbird, wings marked with two white bars, a pale belly"
      )
    ).toBe(
      "a small brown songbird, wings marked with two white bars, a pale belly"
    );
    expect(
      pictureLook("a slim fish, sides marked with dark vertical bands")
    ).toBe("a slim fish, sides marked with dark vertical bands");
    // Norbert's job 351 and Ruth's job 304, as stored.
    expect(
      pictureLook(
        "5.5mm aluminum hook marked with letter I, smooth silver finish, rests on the table"
      )
    ).toBe("smooth silver finish");
    expect(
      pictureLook(
        "green self-healing mat, rectangular, marked with faint grid lines, lies flat on the table"
      )
    ).toBe("green self-healing mat, rectangular");
    expect(pictureLook("a plain metal tag, marked with a black number")).toBe(
      "a plain metal tag"
    );
  });
});

describe("a split panel with no earlier picture of its thing is drawn by the thing's written look", () => {
  it("job 404 scene 4: the robin panel carries 'an American robin' and what sets it apart", async () => {
    const film = robinFilm();
    attachMemory(film, [], things(AMERICAN_ROBIN));
    const panel = await withSplitMemory(
      film[2],
      buildSplitRightScene(film[2]),
      0
    );
    expect(panel.memoryRefUrls).toBeUndefined();
    expect(panel.keyThingLook).toBe(AMERICAN_ROBIN);
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).toContain(
      `HOW THE ROBIN LOOKS in every picture of this video: ${AMERICAN_ROBIN}. Draw this same one`
    );
    // The host take beside it is not touched.
    expect(film[2].keyThingLook).toBeUndefined();
  });

  it("job 404 scene 4 as stored: the look reaches the panel without the place's list", async () => {
    const film = robinFilm();
    attachMemory(film, [], things(STORED_ROBIN));
    const panel = await withSplitMemory(
      film[2],
      buildSplitRightScene(film[2]),
      0
    );
    const prompt = buildStillPrompt(panel, false, undefined, undefined, true);
    expect(prompt).toContain(
      "HOW THE ROBIN LOOKS in every picture of this video: a plump songbird"
    );
    expect(prompt).not.toContain("holly shrubs");
    expect(prompt).not.toContain("bare branches");
  });

  it("a panel that has an earlier picture of its thing follows that picture, its look kept only for a redraw from words", async () => {
    const film = robinFilm();
    film[1] = pic(3, "a robin standing on the snowy lawn near the fence", {
      keyThing: "robin",
      pictureUrl: "https://r2.test/404/3-robin.png",
    });
    attachMemory(film, [], things(AMERICAN_ROBIN));
    const panel = await withSplitMemory(
      film[2],
      buildSplitRightScene(film[2]),
      0
    );
    expect(panel.memoryRefUrls).toContain("https://r2.test/404/3-robin.png");
    expect(panel.keyThingLook).toBeUndefined();
    expect(panel.memoryWordsLook).toBe(AMERICAN_ROBIN);
  });
});

describe("a moving split panel's start frame keeps the look its caller gave it (attachKeyframeMemory)", () => {
  it("the panel copy keeps its written look — asking memoryFor again would have wiped it", async () => {
    const film = robinFilm();
    attachMemory(film, [], things(AMERICAN_ROBIN));
    const panel = await withSplitMemory(
      film[2],
      buildSplitRightScene(film[2]),
      0
    );
    // What the keyframe step used to assign: nothing known of the copy, so no look.
    expect(
      memoryFields(await memoryFor(panel, 0), memoryView(panel)).keyThingLook
    ).toBeUndefined();
    await attachKeyframeMemory(panel, 0);
    expect(panel.keyThingLook).toBe(AMERICAN_ROBIN);
    expect(buildStillPrompt(panel)).toContain(
      `HOW THE ROBIN LOOKS in every picture of this video: ${AMERICAN_ROBIN}`
    );
  });

  it("a full-frame picture the pass has seen still gets its memory and look on its first clip only", async () => {
    const film = robinFilm();
    attachMemory(film, [], things(AMERICAN_ROBIN));
    const later = film[3];
    await attachKeyframeMemory(later, 1);
    expect(later.keyThingLook).toBeUndefined();
    await attachKeyframeMemory(later, 0);
    expect(later.keyThingLook).toBe(AMERICAN_ROBIN);
    // One with reference pictures already is left as it is.
    const drawnFrom = {
      ...pic(6, "a robin on a branch", { keyThing: "robin" }),
      memoryRefUrls: ["https://r2.test/404/5.png"],
    };
    attachMemory([...film, drawnFrom], [], things(AMERICAN_ROBIN));
    await attachKeyframeMemory(drawnFrom, 0);
    expect(drawnFrom.memoryRefUrls).toEqual(["https://r2.test/404/5.png"]);
    expect(drawnFrom.keyThingLook).toBeUndefined();
  });
});
