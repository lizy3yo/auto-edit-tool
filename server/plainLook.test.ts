import { describe, expect, it } from "vitest";
import {
  GROUND_VIEW,
  GROUND_VIEW_OF_SKY,
  PLAIN_LOOK_START,
  WINDOW_VIEW,
  namedLightKept,
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
    // A key thing that is a light names its own light: lit is its use.
    expect(keep.named).toEqual(["night", "lamp"]);
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

/**
 * OVER THE STORED FILMS (review of the first version): run over every stored description (48,139), the
 * staged redraw's rules changed 687, and many came back broken — "glowing" taken from a lit lantern, a
 * wood-burning pen's tip and a running zipper's shine ("the metal zippers softly"), "no golden light"
 * turned into "no light", "a shoji lantern lit from within" into "a shoji from within", "lit from within
 * by soft amber glow." into "lit from within by.", a list item lantern taken off a craft table, a velvet
 * jewellery box and a marbled roast stripped of what they are. Each case is the stored text as written.
 */
describe("a staged redraw keeps every word it does not take out whole (the stored films)", () => {
  it("what a thing is doing, its own material, and words ruled out stay byte-identical", () => {
    const cases: [string, string, Record<string, unknown>?][] = [
      // job 146 scene 71, job 131 scene 36: a lit lantern is the thing in use.
      ["and it only beat the panel by about 4 bucks an hour.", "shoji-style lantern glowing warm on the nightstand, closer detail"],
      [
        "That comes to about $18 an hour, for the prettiest thing I made all month.",
        "A completed shoji lantern sits on a workshop shelf, its rice paper surface warm cream with fine wooden lattice visible beneath, glowing softly from within. Surrounding finished wooden pieces rest in even, diffused indoor light. The lantern's glow is gentle and contained, casting no dramatic shadows.",
      ],
      // job 113 scene 39: "lantern lit" is the lantern, not a candlelit table.
      [
        "That comes to about $18 an hour, for the prettiest thing I made all month.",
        "A finished shoji lantern lit from within by a battery LED, standing on a shelf in even indoor daylight, the translucent paper soft and cream-colored.",
      ],
      // job 110 scene 111: a tool's glowing tip; job 126 scene 160 and job 133 scene 95: a shine it has.
      [
        "because every wobble from a wood-burning pen stays right there in the wood.",
        "Weathered bare hands grip a wood-burning pen with glowing copper tip pressed against pale pine, scorching a dark line into the grain.",
      ],
      [
        "",
        "A bare weathered hand resting on a stack of three completed small zippered pouches in muted cloth, the metal zippers gleaming softly, the finished pieces neat and ready.",
      ],
      [
        "I glued each leg on, drove a screw down through the top into it,",
        "Weathered bare hands pressing a chamfered wooden leg onto the underside of a stand top, wet glue gleaming at the joint.",
      ],
      // job 110 scene 53, job 127 scene 31: a glow in the middle of a sentence is the thing's own light.
      [
        "so an LED is the only thing that goes inside one of these, whether you keep it",
        "interior cavity holding a small battery-powered LED puck with a matte brass finish, its warm glow diffusing softly through the open grid.",
      ],
      ["Shoji are the sliding doors in Japanese houses", "Soft diffused daylight filtering through the paper creates a gentle glow."],
      // job 146 scene 140: a word ruled out is never turned into its opposite.
      [
        "I cut all of it with the same pull saw from the lattice panel.",
        "Flat indoor daylight, neutral gray-white tone, no golden light. Close framing on the hands and board only.",
      ],
      // job 138 scene 5, job 395 scene 10, job 222 scene 12: what ordinary things are made of.
      [
        "Folks will tell you that to make a dime crocheting you need fancy alpaca",
        "A raw beef roast on a wooden cutting board, its marbled surface cool and pale under even kitchen daylight.",
      ],
      ["The mistake with pearls is saving them.", "pearl strand necklace tucked away in a closed velvet jewelry box in a drawer"],
      [
        "Root to tip, one flat color, refreshed every four weeks, forever.",
        "Hair dyed in a single flat dark tone from root to tip, reflected in the oval vanity mirror above the white marble bathroom counter, the color uniform and even throughout.",
      ],
      // job 152 scene 41, job 175 scene 283: a degree word or an "and" partner keeps its adjective.
      [
        "and that's a big part of why the Japanese look fetches more",
        "contrasting the minimalist Japanese aesthetic with the more ornate farmhouse style.",
      ],
      ["and people can see that from across a parking lot.", "Planter angled slightly to catch the matte and gleaming surfaces, filling the frame."],
      // job 112 scene 51: a lantern in a list of things made; job 216 scene 48: "lantern parts".
      ["", "the craft fair table displaying finished wooden pieces—coasters, incense holders, and a small lantern—arranged on a plain cloth"],
      ["and a battery LED puck light tucked in the bottom.", "A small battery LED puck light on the workbench near the lantern parts"],
      // job 154 scene 17, job 141 scene 155: a light phrase the sentence goes on from.
      ["Mine came from the good parts of two worn bedsheets", "The fabric is lit by warm lamplight that shows every worn detail and texture."],
      ["I stitch a colored line across each end", "the hands positioned as if working by lamplight or window light on a worn wooden surface."],
      // job 110 scene 220, job 138 scene 142: a colour of the wood, and the craft the line claims.
      ["drill the hole about halfway through with a small bit, oil it,", "Wood grain shows warm amber tones close-up."],
      [
        "Give each one a neat even border so it lies flat and doesn't curl,",
        "the border row of tight shell stitches lying perfectly flat, the cotton yarn's slight matte weave visible up close.",
      ],
    ];
    for (const [line, words, scene] of cases) expect(plainPicture(words, keepFor(line, scene, [words]))).toBe(words);
  });

  it("what does go leaves a whole sentence behind", () => {
    const plain = (line: string, words: string) => plainPicture(words, keepFor(line, {}, [words]));
    // job 133 scene 36: a glow the sentence needs keeps its noun, loses only its colour.
    expect(
      plain(
        "The little grid on each side uses the same notch trick",
        "filled with translucent shoji paper, lit from within by soft amber glow. The paper surface shows subtle creases."
      )
    ).toBe("filled with translucent shoji paper, lit from within by soft glow. The paper surface shows subtle creases.");
    // job 142 scene 229, job 152 scene 273: a camera effect goes with the word that brought it, and a
    // sentence whose start went begins with a capital.
    expect(
      plain(
        "none of them was the big fussy handwork",
        "the labor-intensive nature of the work, photographed with shallow depth of field to emphasize the detailed craftsmanship."
      )
    ).toBe("the labor-intensive nature of the work, photographed to emphasize the detailed craftsmanship.");
    expect(plain("", "lying flat on the workshop bench beside a wooden project. Shallow depth of field, natural indoor light.")).toBe(
      "lying flat on the workshop bench beside a wooden project. Natural indoor light."
    );
    // job 134 scenes 63 and 75: a whole sentence of lamplight goes with its full stop; "softly lit" goes whole.
    expect(
      plain(
        "It takes about thirty-five minutes to make one carefully.",
        "needle paused mid-stitch in even rows. Warm lamplight on worn fingertips and textured fabric. Cookstove beside the work."
      )
    ).toBe("needle paused mid-stitch in even rows. Cookstove beside the work.");
    expect(
      plain("It takes about eighteen minutes to sew one on the treadle.", "his hands resting calmly at his sides, the room behind him softly lit by lamplight.")
    ).toBe("his hands resting calmly at his sides, the room behind him.");
    // job 190 scene 26, job 198 scene 20: the lamp's place and its whole name go with it.
    expect(plain("run up the sides,", "stitching up a side seam, in a sewing room lit by an oil lamp on a nearby table, late autumn.")).toBe(
      "stitching up a side seam, in a sewing room, late autumn."
    );
    expect(plain("", "printed fabric scraps on a winter kitchen table, lit by soft oil lamp glow, showing the faded pattern.")).toBe(
      "printed fabric scraps on a winter kitchen table, showing the faded pattern."
    );
    // job 117 scene 17: inside a sentence only the style word goes.
    expect(
      plain("The little notepad I keep by the machine says close to sixty hours,", "the tin's faded label dulled by studio light, scraps slightly overstuffed.")
    ).toBe("the tin's faded label dulled by light, scraps slightly overstuffed.");
    // job 144 scene 41: a lamp set beside the subject goes with its "glowing nearby".
    expect(
      plain(
        "a crib quilt is a thing you make for love more than for wages.",
        "angled slightly toward the viewer with the oil lamp glowing nearby, the woven basket of scraps visible."
      )
    ).toBe("angled slightly toward the viewer, the woven basket of scraps visible.");
    // A "no" rules out only its own clause: the glow after the comma still goes; a negated list keeps all of it.
    expect(plain("Here is what to do.", "a quiet sewing room, no hands visible, warm golden glow")).toBe("a quiet sewing room, no hands visible");
    expect(plain("Here is what to do.", "a plain desk, no glowing lamps, candles or golden light")).toBe("a plain desk, no glowing lamps, candles or golden light");
    // The glow of a light source the line never named: the lamp stays, unlit by the words.
    expect(plain("She finished the letter.", "A glowing oil lamp on a wooden desk beside an open letter.")).toBe(
      "An oil lamp on a wooden desk beside an open letter."
    );
  });

  it("a key thing that IS a light keeps its light: named, and its glow untouched", () => {
    const keep = keepFor("That comes to about $18 an hour.", { keyThing: "shoji lantern" }, ["a lantern glowing on the porch rail"]);
    expect(keep.named).toEqual(["lantern"]);
    expect(plainPicture("a lantern glowing on the porch rail, a glowing lantern beside it", keep)).toBe(
      "a lantern glowing on the porch rail, a glowing lantern beside it"
    );
    expect(plainLookClause(keep.named)).not.toMatch(/no glow from a lamp/);
    // A key thing that only sounds like one is not a light.
    expect(keepFor("Test it monthly.", { keyThing: "fire extinguisher" }).named).toEqual([]);
  });

  it("an operator's own words keep their light in the clause", () => {
    const keep = keepFor("She finished the letter.", {}, ["a desk by candlelight"]);
    expect(keep.named).toEqual([]);
    expect(namedLightKept(keep, "a desk by candlelight")).toEqual(["candlelight"]);
    expect(namedLightKept(keepFor("at night"), "a desk at night")).toEqual(["night"]);
  });
});
