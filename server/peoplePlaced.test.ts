import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import { PEOPLE_PLACED_RULE, withoutRoomPlacement } from "./peoplePlaced";
import {
  buildStillPrompt,
  peopleInShot,
  personPlacedWords,
  placedByCamera,
  STILL_BROLL_ENHANCER_SYSTEM,
} from "./longformVideo";
import { CONTEXT_SYSTEM, FIT_SYSTEM, PANEL_FIT_RULES, SHOT_LIST_SYSTEM } from "./shotList";
import { hostLipsCut } from "./hostLook";

const pic = (index: number, scriptText: string, showSubject: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, scriptText, showSubject, visualPrompt: showSubject, stillImage: true, ...over }) as StoryboardScene;

// The pictures as they were stored: job 417 (the operator's case — two passengers sitting backwards in
// forward-facing seats) and job 421, its practice film on the round-15 code.
const S417_2 = "Two passengers seated side by side in an airline seat row, blue upholstered seats with headrests, narrow aisle visible behind them.";
const S417_8 = "A passenger seated in row fourteen glancing forward toward an empty seat row visible ahead in the cabin.";
const S421_28 = {
  show: "a passenger seen from behind standing at the galley speaking to a flight attendant by the counter",
  vp: "Inside an aircraft galley, a pair of bare hands seen from behind at the counter speaking with a flight attendant.",
};

describe("the room is never placed behind or ahead of a person who sits or works (withoutRoomPlacement)", () => {
  it("417 #2: 'narrow aisle visible behind them' loses its place, the aisle stays", () => {
    expect(withoutRoomPlacement(S417_2, true)).toBe(
      "Two passengers seated side by side in an airline seat row, blue upholstered seats with headrests, narrow aisle visible."
    );
  });

  it("417 #8: 'an empty seat row visible ahead' loses 'ahead', the row stays where he glances", () => {
    expect(withoutRoomPlacement(S417_8, false)).toBe(
      "A passenger seated in row fourteen glancing forward toward an empty seat row visible in the cabin."
    );
  });

  it("402 #23, 399 #2, 415 #11: the same for a seated person in any wording", () => {
    // 402 #23 sat a passenger sideways across her seat under "aisle and overhead bins visible behind".
    expect(
      withoutRoomPlacement(
        "A pair of bare hands, one palm pressed flat against a stomach in the lap of a passenger seated in a blue fabric aircraft seat, aisle and overhead bins visible behind.",
        false
      )
    ).toBe(
      "A pair of bare hands, one palm pressed flat against a stomach in the lap of a passenger seated in a blue fabric aircraft seat, aisle and overhead bins visible."
    );
    expect(
      withoutRoomPlacement(
        "Two passengers seated side by side in blue fabric airplane seats in the cabin, row fourteen visible, aisle-side positions, both looking forward, aircraft cabin behind them.",
        true
      )
    ).toBe(
      "Two passengers seated side by side in blue fabric airplane seats in the cabin, row fourteen visible, aisle-side positions, both looking forward, aircraft cabin."
    );
    expect(
      withoutRoomPlacement(
        "an older man sitting alone at a round wooden kitchen table at two in the morning, the single overhead light on, dark windows behind, seen from the side",
        false
      )
    ).toBe(
      "an older man sitting alone at a round wooden kitchen table at two in the morning, the single overhead light on, dark windows, seen from the side"
    );
    expect(withoutRoomPlacement("seated alone on one pew, seen from behind. Empty rows beside and behind.", false)).toBe(
      "seated alone on one pew, seen from behind. Empty rows beside."
    );
  });

  it("421 #28: 'seen from behind' goes from two people who talk to each other, the rest of the words stay", () => {
    expect(withoutRoomPlacement(S421_28.show, true)).toBe(
      "a passenger standing at the galley speaking to a flight attendant by the counter"
    );
    expect(withoutRoomPlacement(S421_28.vp, true)).toBe(
      "Inside an aircraft galley, a pair of bare hands at the counter speaking with a flight attendant."
    );
    // 410 #30, the same line in an earlier film of the script.
    expect(withoutRoomPlacement("an older passenger seen from behind standing at the galley speaking to a flight attendant", true)).toBe(
      "an older passenger standing at the galley speaking to a flight attendant"
    );
    // A handover, and backs said to the camera.
    expect(withoutRoomPlacement("Seen from behind, a neighbour handing a jar of jam over the fence to an older man.", true)).toBe(
      "A neighbour handing a jar of jam over the fence to an older man."
    );
    expect(withoutRoomPlacement("two friends chatting at the kitchen counter, their backs to the camera", true)).toBe(
      "two friends chatting at the kitchen counter"
    );
    expect(withoutRoomPlacement("a buyer, back to the camera, talking with the seller", true)).toBe(
      "a buyer, talking with the seller"
    );
  });

  it("the whole view goes, never half of it: 'seen from behind or from the side' leaves no 'or from the side'", () => {
    // The writers' own old wording; taken out by halves it read "a passenger or from the side, speaking…".
    expect(withoutRoomPlacement("a passenger, seen from behind or from the side, speaking to a flight attendant", true)).toBe(
      "a passenger, speaking to a flight attendant"
    );
    expect(withoutRoomPlacement("a customer seen from behind or the side handing cash to a clerk", true)).toBe(
      "a customer handing cash to a clerk"
    );
    expect(withoutRoomPlacement("two people talking, each seen from behind or from the side", true)).toBe("two people talking");
    expect(withoutRoomPlacement("a passenger seen from the side or from behind, talking to a flight attendant", true)).toBe(
      "a passenger seen from the side, talking to a flight attendant"
    );
    // …and nothing it was paired with is left to mean something else ("talking at an angle").
    expect(withoutRoomPlacement("two coworkers talking, seen from behind at an angle", true)).toBe("two coworkers talking");
    expect(withoutRoomPlacement("two neighbours talking over a fence, viewed from behind and slightly above", true)).toBe(
      "two neighbours talking over a fence"
    );
    expect(withoutRoomPlacement("two people talking, shot from behind over the shoulder", true)).toBe("two people talking");
  });

  it("a room part that is WHERE someone or something is keeps its place: a seat, a cart, a kick (410 #3)", () => {
    for (const t of [
      // Stored film 410 scene 3: the cart is behind her in the aisle — where it is, not where the camera stands.
      "an older woman seen from the side sitting alone in an empty row of three blue seats near the front of the cabin, the beverage cart rolling away down the aisle behind her",
      // A second person's seat: taken out, he would sit in hers.
      "a man sitting in the seat behind her, leaning forward to talk",
      "a child seated in the row behind her kicking the seat back",
      // What a deed is done to: taken out, the kick lands on his own seat.
      "a passenger kicking the seat in front of him",
      "a passenger watching a movie on the screen in the seat back in front of her",
      "a woman kneading dough on the counter in front of her",
      "a woman leaning against the wall behind her, talking on the phone",
    ])
      expect(withoutRoomPlacement(t, true), t).toBe(t);
  });

  it("riding or driving is sitting: the bus aisle behind a passenger goes like any seat's", () => {
    expect(withoutRoomPlacement("a passenger riding the bus, seated by the window, the aisle behind her", false)).toBe(
      "a passenger riding the bus, seated by the window, the aisle"
    );
  });

  it("one person seen from behind keeps it — walking away, or seated alone", () => {
    for (const t of [
      "a woman seen from behind walking away down the aisle toward the galley",
      "an old man sitting alone on a wooden bench, seen from behind", // job 409 #31
      "an older woman standing by a grave with a small bunch of flowers, seen from behind", // job 401 #17
    ]) {
      expect(withoutRoomPlacement(t, false), t).toBe(t);
      // A second person drawn changes nothing either while nobody talks or hands anything over.
      expect(withoutRoomPlacement(t, true), t).toBe(t);
    }
    // Two people who only walk or sit together (job 401 #19, job 410 #2).
    for (const t of [
      "an older man walking hand in hand with a small grandchild along a sunny park path, seen from behind",
      "two older passengers seated side by side in the same row of plane seats, seen from behind",
    ])
      expect(withoutRoomPlacement(t, true), t).toBe(t);
  });

  it("a person going somewhere keeps the place ahead of them", () => {
    const t = "a man walking down the hallway toward the front door, the door ahead of him";
    expect(withoutRoomPlacement(t, false)).toBe(t);
  });

  it("a thing that sits, a workbench's wall, a desk at work and a body part are no room placed by the camera", () => {
    for (const t of [
      // Stored film 199: a thing sitting is no one seated.
      "Bare weathered hands holding a wire brush, bristles pressing against a blackened cedar block on the wooden workbench, brushing away soot. The charred wood sits on the clear bench surface, garage wall behind.",
      // Stored film 356: the host at the bench, the wall beyond the work.
      "Bare hands wiping wood oil onto a blackened cedar incense holder with a cloth, workbench surface behind.",
      "a woman typing on the laptop on the desk in front of her",
      "a woman sitting in her armchair, hands clasped behind her head",
      "a child hiding behind her as she talks to the shopkeeper",
    ])
      expect(withoutRoomPlacement(t, true), t).toBe(t);
  });

  it("light from behind, and coming out from behind a counter, are no camera", () => {
    for (const t of [
      "two neighbours talking over the garden fence, lit from behind by the low sun",
      "a shopkeeper stepping out from behind the counter to hand a parcel to a customer",
    ])
      expect(withoutRoomPlacement(t, true), t).toBe(t);
  });

  it("words with nothing to take out come back byte-identical", () => {
    const t = "A passenger seated in row fourteen holding a clear plastic cup about three-quarters full with soda and ice cubes."; // 417 #7
    expect(withoutRoomPlacement(t, false)).toBe(t);
    expect(withoutRoomPlacement("", true)).toBe("");
  });
});

describe("only a picture of someone whose face the camera keeps out (placedByCamera, personPlacedWords)", () => {
  const LOOK = "a woman in her sixties with a silver bob, wearing a navy crewneck sweater";

  it("a person-free picture of an aisle keeps 'the aisle stretching ahead' and every 'behind'", () => {
    const aisle = pic(5, "The cabin was nearly empty by then.", "an empty cabin aisle between rows of seats, the aisle stretching ahead toward the galley", {
      visualPrompt: "An empty cabin aisle between rows of blue seats, overhead bins visible behind, the aisle stretching ahead toward the galley.",
    });
    expect(placedByCamera(aisle)).toBe(false);
    expect(personPlacedWords(aisle, aisle.visualPrompt!)).toBe(aisle.visualPrompt);
    expect(buildStillPrompt(aisle)).toContain(aisle.visualPrompt!);
  });

  it("anonymous hands and the host's own face keep their words; a chin line faces the camera, its room is really behind", () => {
    const words = "The host seated in an armchair wearing a short gold chain at the neck, a window behind her.";
    const hands = pic(3, "Hold it up to the light.", words, { humanPresent: true });
    expect(placedByCamera(hands)).toBe(false);
    const face = pic(3, "Dab it under the eyes.", words, { humanPresent: true, brollHostLook: LOOK, hostFaceShown: true });
    expect(placedByCamera(face)).toBe(false);
    const chin = pic(3, "A short chain draws the eye up to your chin and jaw.", words, { humanPresent: true, brollHostLook: LOOK });
    expect(hostLipsCut(chin)).toBe(true);
    expect(placedByCamera(chin)).toBe(false);
    expect(personPlacedWords(chin, words)).toBe(words);
  });

  it("someone else, and the host at work, are placed by what they do", () => {
    const seats = pic(2, "the same flight, and sat in the same row.", "two passengers seated together in an airline seat row", {
      visualPrompt: S417_2,
      humanPresent: true,
      otherPerson: "two passengers",
      otherPeople: 2,
    });
    expect(placedByCamera(seats)).toBe(true);
    expect(personPlacedWords(seats, S417_2)).not.toMatch(/behind them/);
    const host = pic(4, "I sat with it for an hour.", "the host sitting in a rocking chair by the window", {
      visualPrompt: "The host sitting in a rocking chair, crochet hook in hand, the kitchen behind her.",
      humanPresent: true,
      brollHostLook: LOOK,
    });
    expect(placedByCamera(host)).toBe(true);
    expect(personPlacedWords(host, host.visualPrompt!)).toBe("The host sitting in a rocking chair, crochet hook in hand, the kitchen.");
  });

  it("'seen from behind' goes only where two or more people are drawn, counted off the words too (peopleInShot)", () => {
    // Marked for one person by an older film, its words name the attendant as well — both are drawn.
    const named = pic(28, "then catch a flight attendant as they pass,", "a passenger seen from behind speaking to a flight attendant", {
      humanPresent: true,
      otherPerson: "a passenger",
    });
    expect(peopleInShot(named)).toBe(2);
    expect(personPlacedWords(named, named.showSubject!)).toBe("a passenger speaking to a flight attendant");
    const alone = pic(31, "and he stays there till dark.", "an old man sitting on a bench, seen from behind", {
      humanPresent: true,
      otherPerson: "an old man",
    });
    expect(personPlacedWords(alone, alone.showSubject!)).toBe(alone.showSubject);
  });
});

describe("every picture writer carries the one wording (PEOPLE_PLACED_RULE)", () => {
  it("the shot list, the line check (and its panel pass), the same-topic groups and the prompt writer", () => {
    expect(SHOT_LIST_SYSTEM).toContain(`6c. ${PEOPLE_PLACED_RULE}`);
    expect(FIT_SYSTEM).toContain(PEOPLE_PLACED_RULE);
    // The panel pass is the line check's rulebook with its own rules after it.
    expect(`${FIT_SYSTEM}${PANEL_FIT_RULES}`).toContain(PEOPLE_PLACED_RULE);
    expect(CONTEXT_SYSTEM).toContain(PEOPLE_PLACED_RULE);
    // The cutaway and split-panel prompt writer.
    expect(STILL_BROLL_ENHANCER_SYSTEM).toContain(`- ${PEOPLE_PLACED_RULE}`);
  });

  it("no writer tells itself to write the camera into show any more", () => {
    // 421 #28's "a passenger seen from behind standing at the galley…" was the instruction copied.
    expect(FIT_SYSTEM).not.toMatch(/write them into show, seen from behind or from the side/);
    expect(FIT_SYSTEM).toMatch(/write them into show by what they do and where they are/);
    expect(SHOT_LIST_SYSTEM).not.toMatch(/from behind or from the side, the face never shown\. Write them into show/);
    expect(SHOT_LIST_SYSTEM).toMatch(/Write into show what they do and where they are \(rule 6c\)/);
  });

  it("the rule says what the people do and where they are, and names no channel's place", () => {
    expect(PEOPLE_PLACED_RULE).toMatch(/says what they are doing and where they are/);
    expect(PEOPLE_PLACED_RULE).toMatch(/written turned to each other/);
    expect(PEOPLE_PLACED_RULE).toMatch(/never place the room around a person who sits or works/);
    expect(PEOPLE_PLACED_RULE).toMatch(/"behind" them, "ahead of" them or "in front of" them/);
    expect(PEOPLE_PLACED_RULE).toMatch(/never write "seen from behind", "from behind" or "backs to the camera" of people who talk to or hand something/);
    expect(PEOPLE_PLACED_RULE).not.toMatch(/passenger|flight|galley|cabin|plane|airline|attendant|tray/i);
  });
});
