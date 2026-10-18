import { describe, expect, it } from "vitest";
import {
  GROUND_VIEW,
  GROUND_VIEW_OF_SKY,
  PLAIN_LOOK_START,
  WINDOW_VIEW,
  plainDescription,
  plainLight,
  plainLookClause,
  plainLookKeep,
  plainPicture,
  possibleView,
} from "./plainLook";

const keepFor = (line: string, scene: Record<string, unknown> = {}, words: string[] = []) =>
  plainLookKeep(scene as any, line, words);

describe("plainDescription: the staged redraw's words lose what the line never asked for (jobs 409, 410)", () => {
  // Job 409 scene 22, as stored: Seneca writing, "by lamplight" only in the picture's own words.
  const SENECA_LINE =
    "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus,";
  it("409-22: lamplight the line never names goes, the rest word for word", () => {
    // Its words name the lamp and nothing dark for it to light: the lamp is not kept for them.
    const keep = keepFor(SENECA_LINE, {}, [
      "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side",
    ]);
    expect(keep.named).toEqual([]);
    expect(
      plainDescription(
        "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen by lamplight, seen from the side",
        keep
      )
    ).toBe(
      "a man in an off-white wool toga draped over his left shoulder in deep folds, writing on a scroll with a reed pen, seen from the side"
    );
    expect(
      plainDescription(
        "An off-white wool toga draped over a left shoulder in deep folds, a reed pen in hand writing on a scroll, lamplight on the face of the scroll, seen from the side.",
        keep
      )
    ).toBe(
      "An off-white wool toga draped over a left shoulder in deep folds, a reed pen in hand writing on a scroll, seen from the side."
    );
  });

  // Job 409 scene 25: "standing beside a marble throne in a grand hall" under "one step from the throne".
  const ADVISOR_LINE =
    "He was one of the richest men in the empire, an advisor standing one step from the throne, buried under exactly the kind of obligations we are about to talk about —";
  it("409-25: marble and grand go; the throne the line says stays", () => {
    expect(
      plainDescription(
        "A wealthy man in a fine off-white toga draped over his left shoulder, standing beside a marble throne in a grand hall, viewed from behind.",
        keepFor(ADVISOR_LINE)
      )
    ).toBe("A wealthy man in a fine off-white toga draped over his left shoulder, standing beside a throne in a hall, viewed from behind.");
    // A line that never says it: the throne set beside the man goes too.
    expect(
      plainDescription("a man in a toga standing beside a marble throne in a grand hall", keepFor("He gave advice to the emperor."))
    ).toBe("a man in a toga standing in a hall");
  });

  it("job 412 scene 25: golden light goes from the words and from the key thing's look; the wilderness stays", () => {
    const scene = {
      keyThing: "wild landscape",
      keyThingLook: "an open dawn-lit wilderness with low golden light, scattered brush and distant hills, calm and empty of people",
    };
    const words =
      "Wild cat crouched low and moving through scattered dry brush across an open dawn-lit wilderness, golden low light on distant hills, a small mouse ahead on the ground";
    // Its own words set it at dawn in low light: that light stays named, the golden goes.
    const keep = keepFor("when small prey is out moving around", scene, [words]);
    expect(keep.named).toEqual(["dawn", "low light"]);
    expect(plainDescription(words, keep)).toBe(
      "Wild cat crouched low and moving through scattered dry brush across an open dawn-lit wilderness, low light on distant hills, a small mouse ahead on the ground"
    );
    // Light is never the thing: the look keeps its wilderness, brush and hills, loses only the golden.
    expect(plainLight(scene.keyThingLook, keep)).toBe(
      "an open dawn-lit wilderness with low light, scattered brush and distant hills, calm and empty of people"
    );
  });

  it("light the line names stays — a candle by candlelight, a lamp at two in the morning — but an unasked glow still goes", () => {
    const table = "a kitchen table set for two, lit by a single candle, plates and glasses";
    expect(plainDescription(table, keepFor("We ate dinner by candlelight that night."))).toBe(table);
    expect(plainDescription(table, keepFor("She finished the letter."))).toBe("a kitchen table set for two, plates and glasses");
    const night = "a kitchen table under a single lamp, a warm golden glow over the papers";
    expect(plainDescription(night, keepFor("I sat at the kitchen table at two in the morning."))).toBe(
      "a kitchen table under a single lamp"
    );
  });

  it("job 400 scene 12: the lamp that lights a night the picture's own words are set in stays", () => {
    const table =
      "a wooden kitchen table lit by a single warm lamp at night, a wall clock above it, rest of the room dark, a close-up of one detail of it filling the frame";
    const line =
      "Fewer years ahead than behind, and a clock that was background noise at thirty is now the loudest thing in the room.";
    const keep = keepFor(line, {}, [table]);
    expect(keep.named.length).toBeGreaterThan(0);
    expect(plainDescription(table, keep)).toBe(table);
    // The same lamp with no night around it goes.
    expect(plainDescription("a wooden kitchen table lit by a single warm lamp", keepFor(line, {}, ["a wooden kitchen table lit by a single warm lamp"]))).toBe(
      "a wooden kitchen table"
    );
  });

  it("a material the thing's own look names stays: a marble mortar is marble, its showroom counter is not", () => {
    const keep = keepFor("Grind it fine.", { keyThing: "mortar and pestle", keyThingLook: "a white marble mortar and pestle" });
    expect(plainDescription("a white marble mortar and pestle on a gleaming showroom counter", keep)).toBe(
      "a white marble mortar and pestle on a counter"
    );
  });

  it("words that only look like it are never touched — byte-identical", () => {
    const keep = keepFor("Here is what to do.");
    for (const t of [
      "a golden retriever lying on the grass, a golden-brown loaf on the table",
      "a man sitting by the fire in a living room",
      "a grand piano in the corner of a plain room",
      "Bare weathered hands at a galley metal counter holding and reviewing a clipboard with papers.",
      "a user holding an hour glass beside a pile of small finished pieces",
      "the drawer pulled open, no candles or lamps anywhere",
      // Words that describe the thing itself, over the stored films: never taken for a finish.
      "a long empty dark polished wooden church pew seen from the side",
      "A robin tucked deep inside a dense evergreen holly bush with glossy dark green leaves and bright red berry clusters",
      "A smartphone screen displaying a used push mower listing, held at a slight angle to show the product photo and price clearly.",
    ])
      expect(plainDescription(t, keep)).toBe(t);
  });

  it("a lighting style, an advert finish and grand words go, and the articles fit what follows", () => {
    expect(plainDescription("an ornate hall with a chandelier above, cinematic lighting", keepFor("a nice hall"))).toBe("a hall");
    expect(plainDescription("A product shot of a sleek laptop, dramatic lighting", keepFor("my old laptop"))).toBe("A sleek laptop");
    expect(plainDescription("an opulent, gilded room", keepFor("the room"))).toBe("a room");
  });
});

describe("possibleView: a view no phone can take is brought down to a person's (job 410 scene 13)", () => {
  it("410-13: an airliner above the clouds seen from beside it → its wing through a cabin window", () => {
    expect(possibleView("a passenger jet flying above the clouds")).toBe(
      `the wing of a passenger jet, ${WINDOW_VIEW}, flying above the clouds`
    );
    expect(possibleView("A commercial passenger jet flying above a layer of white clouds, seen from the side against blue sky.")).toBe(
      `The wing of a commercial passenger jet, ${WINDOW_VIEW}, flying above a layer of white clouds against blue sky.`
    );
  });

  it("job 402 scene 11: the same line in another film, a plane climbing through clouds seen from outside", () => {
    expect(possibleView("Commercial airplane climbing through white clouds in flight, seen from outside the aircraft.")).toBe(
      `The wing of a commercial airplane, ${WINDOW_VIEW}, climbing through white clouds in flight.`
    );
  });

  it("lower down, a plane in flight is seen from the ground; any other machine's view from standing height", () => {
    expect(possibleView("a small plane flying over the farm fields")).toBe(`a small plane, ${GROUND_VIEW_OF_SKY}, flying over the farm fields`);
    expect(possibleView("An aerial view of a small town with red roofs")).toBe(`A small town with red roofs, ${GROUND_VIEW}`);
    expect(possibleView("a highway at rush hour, drone shot")).toBe(`a highway at rush hour, ${GROUND_VIEW}`);
    expect(possibleView("the coastline seen from space")).toBe(`the coastline, ${GROUND_VIEW}`);
  });

  it("a view a person takes is left alone — byte-identical", () => {
    for (const t of [
      "a plane seen through a window on the runway",
      "the wing of the plane through the cabin window above the clouds",
      "a jet taking off over the airport fence",
      "a hand plane gliding along the edge of a board",
      "a drone flying over a field, seen from the ground",
      "the aerial roots of an orchid on a windowsill",
      "a satellite dish on a roof",
      "a cross-section of a pipe", // a view from inside a solid thing already has its own rule
      "a jet of water flying up from the hose in the air",
    ])
      expect(possibleView(t)).toBe(t);
  });
});

describe("plainPicture and the clause", () => {
  it("does both, in order", () => {
    expect(plainPicture("A gleaming passenger jet flying above the clouds, cinematic lighting", keepFor("the flight,"))).toBe(
      `The wing of a passenger jet, ${WINDOW_VIEW}, flying above the clouds`
    );
  });

  it("the clause keeps the light the line names, and asks for plain light when it names none", () => {
    const named = plainLookClause(keepFor("We ate dinner by candlelight that night.").named);
    expect(named.startsWith(PLAIN_LOOK_START)).toBe(true);
    expect(named).toMatch(/"candlelight"/);
    expect(named).toMatch(/"night"/);
    expect(named).not.toMatch(/no glow from a lamp, candle or fire/);
    const plain = plainLookClause([]);
    expect(plain).toMatch(/no glow from a lamp, candle or fire/);
    expect(plain).toMatch(/no glossy, polished or showroom finish/);
  });

  it("names no channel's things", () => {
    for (const c of [plainLookClause([]), plainLookClause(["night"]), WINDOW_VIEW, GROUND_VIEW, GROUND_VIEW_OF_SKY])
      expect(c).not.toMatch(/\b(?:toga|throne|marble|scroll|galley|clipboard|airliner|cat|toilet|board)\b/i);
  });

  it("keep: the line and the key thing keep light; every look the picture carries keeps a material", () => {
    const keep = plainLookKeep(
      {
        keyThing: "oil lamp",
        keyThingLook: "a brass oil lamp",
        namedLook: "velvet curtains",
        otherPersonLooks: [{ name: "the king", look: "an old man in a gilded crown" }],
      } as any,
      "at night"
    );
    expect(keep.named).toEqual(["night"]);
    expect(keep.light).toMatch(/oil lamp/);
    expect(keep.light).not.toMatch(/velvet|gilded/);
    expect(keep.thing).toMatch(/velvet/);
    expect(keep.thing).toMatch(/gilded/);
    // A lamp that IS the key thing stays even when the line names no light.
    expect(plainDescription("a kitchen shelf with a brass oil lamp on it", plainLookKeep({ keyThing: "oil lamp" } as any, "Clean it once a year."))).toBe(
      "a kitchen shelf with a brass oil lamp on it"
    );
  });
});
