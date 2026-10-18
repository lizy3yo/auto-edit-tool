/**
 * A LINE WITH NOTHING TO SEE NEVER FALLS BACK TO THE MAIN THING; A SOUND SHOWS WHAT MAKES IT (round
 * 11, 2026-10-18, the review of jobs 401-407). Job 401's main thing was the opening story's sympathy
 * card, and the lines that carry an idea — scene 21 "Your problem is theft…", scene 33 "Then he turns
 * the whole thing over in a single motion: life is not short" — showed the same blank card on the
 * study desk, the scan window a third copy of it: the planner had nothing to draw and reached for the
 * main thing, and the line check read "the whole thing" as the card. Job 404 scene 20 put 15 s of an
 * empty storm window under a line about the winter robin's soft clucking — the sound could not be
 * drawn, so the line's last noun was. The rules are general and sent to both the shot list and the
 * line check; the lines here are the real rows. A word-based marker for "main thing under a line
 * that does not name it" was tried and left out: replayed over the 122 local storyboards with a main
 * thing it fired on 126 to 529 pictures, nearly all right (a step on the thing being made, a line
 * about its label), so only a model reading the lines can tell a fallback from a reference.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KeyThing, StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import { applyPictureFixes, FIT_SYSTEM, fitPicturesToLines, PANEL_FIT_RULES, parsePictureFixes, planShotList } from "./shotList";

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

/** What the cases came from — never in a rulebook (the rules must fit any channel). */
const CHANNEL_OBJECTS = /sympathy|greeting card|seneca|roman|theft|thieves|robin|storm window|cluck|tutting|migrat|stoic/i;

/** Job 401's props list, as written (home line first, MAIN second). */
const SHEET_401 = [
  "study: a quiet room with a wooden desk, a window to outdoors, a chair pulled close, warm late-spring light",
  "MAIN sympathy card: a plain cream card with a simple embossed border, no writing visible, held or resting on the desk",
  "birthday card: a plain pale card with a simple printed border, no writing visible, kept near the sympathy card",
  "chair: a wooden chair with a curved back, pulled close to the desk",
  "kitchen table: a round wooden table with two chairs, a single dim lamp, dark window behind it",
].join("\n");
const ESSAY: KeyThing[] = [
  { main: true, name: "sympathy card", look: "a plain cream card with a simple embossed border, no writing visible, held or resting on the desk" },
  { name: "birthday card", look: "a plain pale card with a simple printed border, no writing visible, kept near the sympathy card" },
  { name: "chair", look: "a wooden chair with a curved back, pulled close to the desk" },
  { name: "kitchen table", look: "a round wooden table with two chairs, a single dim lamp, dark window behind it" },
];
/** Job 404's props list. */
const SHEET_404 = [
  "home kitchen: a cold-climate suburban kitchen with a wide window over the sink looking out onto the lawn and garden",
  "MAIN robin: a plump songbird about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head",
  "lawn: a flat suburban backyard lawn, green fading to frost-dusted brown, bordered by a low wooden fence",
  "storm window: a clear glass pane set in a white aluminum frame, fitted outside the regular window, closed tight through winter",
].join("\n");
const BIRDS: KeyThing[] = [
  { main: true, name: "robin", look: "a plump songbird about ten inches long, brown-grey back, bright orange-red breast, white eye ring, dark head" },
  { name: "lawn", look: "a flat suburban backyard lawn, green fading to frost-dusted brown, bordered by a low wooden fence" },
  { name: "storm window", look: "a clear glass pane set in a white aluminum frame, fitted outside the regular window, closed tight through winter" },
];

// The real lines.
const THEFT = "Your problem is theft, and by the end of this video you will be able to name all seven of the thieves."; // 401 scene 21
const SENECA = "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus,"; // 401 scene 22
const TURN = "Then he turns the whole thing over in a single motion: life is not short."; // 401 scene 33
const CARD_LINE = "a pharmacy on a Tuesday morning, buying his third sympathy card since spring, and doing a kind of arithmetic nobody ever taught him."; // 401 scene 2
const CLUCKING =
  "Once nesting season is over, that job is done, and through the winter a robin hardly sings at all. Mostly you’ll hear a low, soft clucking, a bit like somebody tutting under their breath, and that’s easy to miss with the storm windows shut."; // 404 scene 20
const SPRING_SONG = "cheerily, belongs to spring and summer. It’s a male letting the neighborhood know this patch is his and he’s looking for a mate."; // 404 scene 19
const AROUND = "And that first robin of spring you’ll be so happy to see in March? There’s a fair chance it was around the whole time."; // 404 scene 5

// As shipped.
const CARD_ON_DESK = "a cream sympathy card resting on the wooden desk in the study";
const EMPTY_WINDOW = "a closed storm window pane viewed from inside the kitchen";

beforeEach(() => mockInvoke.mockReset());

describe("the shot list is told (rules 1f and 1g)", () => {
  it("an idea is an everyday moment, never the main thing by default and never the same picture twice", async () => {
    mockInvoke.mockResolvedValueOnce({ text: JSON.stringify({ beats: [] }) });
    await planShotList([pic(33, TURN, CARD_ON_DESK)], { sheet: SHEET_401 });
    const system: string = mockInvoke.mock.calls[0][0].systemPrompt;
    expect(system).toMatch(/1f\. A LINE WITH NOTHING TO SEE/);
    expect(system).toMatch(/an argument, a turn in the reasoning, a claim, a lesson, a feeling, a promise of what the video will show/);
    expect(system).toMatch(/an everyday moment that carries what it means: a person or a place the script already has/);
    expect(system).toMatch(/or the host at work/);
    expect(system).toMatch(/Never the MAIN thing because nothing else came to mind/);
    expect(system).toMatch(/"the whole thing", "all of it" or "that", summing up what was just said, point at the idea, never at a thing/);
    expect(system).toMatch(/never the same picture for two of them/);
    // A price, count, quality or time is still shown as the thing it is about (rule 5).
    expect(system).toMatch(/by its quality, price, count or time is not one of these: it shows the thing/);
    // Rule 1b, "when a line only refers to the MAIN thing, the MAIN thing", now hands an idea to 1f.
    expect(system).toMatch(/a line with nothing to see follows rule 1f/);
    expect(system).not.toMatch(CHANNEL_OBJECTS);
  });

  it("a sound shows what makes it, never only the window it is heard through", async () => {
    mockInvoke.mockResolvedValueOnce({ text: JSON.stringify({ beats: [] }) });
    await planShotList([pic(20, CLUCKING, EMPTY_WINDOW)], { sheet: SHEET_404 });
    const system: string = mockInvoke.mock.calls[0][0].systemPrompt;
    expect(system).toMatch(/1g\. A SOUND/);
    expect(system).toMatch(/shows what makes it \(an animal, a machine, a person, the weather\) in the moment the line\s+describes/);
    expect(system).toMatch(/quiet when the line says it has gone quiet/);
    expect(system).toMatch(/Never only the window, door or room the sound is heard through, even when the line names it/);
    expect(system).toMatch(/never an empty place the line does not say is empty/);
    // The line reaches the planner whole: the clucking, not only "storm windows".
    expect(mockInvoke.mock.calls[0][0].userMessage).toContain(CLUCKING);
  });

  it("the planner's answers are read as written: an idea shot with no key thing, a sound shot of its source", async () => {
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        beats: [
          {
            beat: 33,
            hostUntil: null,
            shots: [{ from: "Then he turns", show: "a man in a toga at a lamplit desk turning a papyrus scroll over in his hands, seen from the side", motion: "none", thing: null, other: "a Roman writer" }],
          },
        ],
      }),
    });
    const [idea] = await planShotList([pic(33, TURN, CARD_ON_DESK)], { sheet: SHEET_401 });
    expect(idea.shots[0].thing).toBeUndefined();
    expect(idea.shots[0].other).toBe("a Roman writer");
    expect(idea.shots[0].show).not.toMatch(/card/);

    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        beats: [
          {
            beat: 20,
            hostUntil: null,
            shots: [{ from: "Once nesting season", show: "a robin puffed up on the snowy lawn, beak closed, seen through the closed storm window from the kitchen", motion: "none", thing: "robin" }],
          },
        ],
      }),
    });
    const [sound] = await planShotList([pic(20, CLUCKING, EMPTY_WINDOW)], { sheet: SHEET_404 });
    expect(sound.shots[0].thing).toBe("robin");
  });
});

describe("the line check is told", () => {
  it("an idea under the main thing is WRONG unless the line names it or points back at it; never the same fallback twice", () => {
    expect(FIT_SYSTEM).toMatch(/A LINE WITH NOTHING TO SEE/);
    expect(FIT_SYSTEM).toMatch(/It is WRONG when it shows the video's\s+MAIN thing only because nothing else fits/);
    expect(FIT_SYSTEM).toMatch(/the main thing is right only when the line names it or\s+clearly points back at it/);
    expect(FIT_SYSTEM).toMatch(/"The whole thing",\s+"all of it" or "that", summing up what was just said, point at the idea, never at a thing/);
    expect(FIT_SYSTEM).toMatch(/Two lines\s+with nothing to see never share a picture/);
    expect(FIT_SYSTEM).toMatch(/speaks of a thing by its quality, price, count or time is not one of these/);
    // The joined-picture rule, "the main thing when the line is about it", no longer covers an idea.
    expect(FIT_SYSTEM).toMatch(/the main thing when the line is about it \(never\s+for a line with nothing to see\)/);
    expect(FIT_SYSTEM).not.toMatch(CHANNEL_OBJECTS);
  });

  it("a sound is about what makes it, and the 'about' it writes says so", () => {
    expect(FIT_SYSTEM).toMatch(/A SOUND\. A line about a sound/);
    expect(FIT_SYSTEM).toMatch(/is about\s+what makes it: the picture shows that source in the moment the line describes/);
    expect(FIT_SYSTEM).toMatch(/WRONG when it shows only a window, a door or a room the\s+sound is heard through/);
    expect(FIT_SYSTEM).toMatch(/for a\s+sound, what makes it; for an idea, the idea/);
  });

  it("a split panel's moment for an idea is a place or a thing, never a person", () => {
    expect(PANEL_FIT_RULES).toMatch(/On a panel the everyday moment that\s+carries it is a place or a thing from the script, never a person/);
    expect(PANEL_FIT_RULES).not.toMatch(CHANNEL_OBJECTS);
  });
});

describe("the check's rewrites land on the real rows", () => {
  it("job 401: the card leaves the idea lines; the line that names the card keeps it", async () => {
    const scenes = [
      pic(2, CARD_LINE, "man standing in pharmacy card aisle holding a sympathy and birthday card together", { keyThing: "sympathy card" }),
      pic(21, THEFT, "study desk with sympathy card resting near the window light", { keyThing: "sympathy card" }),
      pic(22, SENECA, "a Roman man in a toga writing on a scroll at a wooden desk by lamplight", { humanPresent: true }),
      pic(33, TURN, CARD_ON_DESK, { keyThing: "sympathy card" }),
    ];
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: [
          { id: 0, about: "the man buying a sympathy card in the pharmacy", shows_it: true, who: "the man from the story" },
          {
            id: 1,
            about: "the idea that the viewer's time is being stolen",
            shows_it: false,
            show: "an older man sitting alone at the round kitchen table late at night, hands folded, seen from the side",
            thing: "kitchen table",
            stage: null,
            other: "the man from the story",
          },
          { id: 2, about: "Seneca writing his essay", shows_it: true, who: "a Roman writer" },
          {
            id: 3,
            about: "Seneca reversing the claim that life is short",
            shows_it: false,
            show: "a Roman man in a toga at a lamplit desk, turning a papyrus scroll over in his hands, seen from the side",
            thing: null,
            stage: null,
            other: "a Roman writer",
          },
        ],
      }),
    });
    const r = await fitPicturesToLines(scenes, { keyThings: ESSAY, sheet: SHEET_401 });
    const sent: string = mockInvoke.mock.calls[0][0].userMessage;
    expect(sent).toContain("MAIN sympathy card");
    expect(sent).toContain(`said "${TURN}"`);
    expect(r.fixed).toBe(2);
    // The idea lines no longer show the card, and the two are not the same picture.
    expect(r.scenes[1].showSubject).not.toMatch(/card/);
    expect(r.scenes[3].showSubject).not.toMatch(/card/);
    expect(r.scenes[1].showSubject).not.toBe(r.scenes[3].showSubject);
    expect(r.scenes[1].keyThing).toBe("kitchen table");
    expect(r.scenes[3].keyThing).toBeUndefined();
    // A person from the script carries each, drawn as that person, never the host.
    expect(r.scenes[3].humanPresent).toBe(true);
    expect(r.scenes[3].otherPerson).toBe("a Roman writer");
    expect(r.scenes[1].otherPerson).toBe("the man from the story");
    // The line that names the card keeps it.
    expect(r.scenes[0].showSubject).toMatch(/sympathy and birthday card/);
    expect(r.scenes[0].keyThing).toBe("sympathy card");
  });

  it("job 404 scene 20: the robin it is about, the window only where it is seen from", () => {
    const scenes = [
      pic(19, SPRING_SONG, "a male robin singing with its beak open on a branch at sunrise in spring", { keyThing: "robin" }),
      pic(20, CLUCKING, EMPTY_WINDOW, { keyThing: "storm window" }),
    ];
    const answer = JSON.stringify({
      pictures: [
        { id: 0, about: "the robin's spring song", shows_it: true },
        {
          id: 1,
          about: "the robin, quiet in winter, only clucking softly",
          shows_it: false,
          show: "a robin puffed up on the snowy lawn, beak closed, seen through the closed storm window from the kitchen",
          thing: "robin",
          stage: null,
        },
      ],
    });
    const fixes = parsePictureFixes(answer, scenes);
    expect(fixes.map(f => f.id)).toEqual([1]);
    expect(applyPictureFixes(scenes, fixes, BIRDS)).toBe(1);
    expect(scenes[1].keyThing).toBe("robin");
    // The window stays in the picture as what it is seen through, drawn the same as before.
    expect(scenes[1].otherKeyThings).toEqual(expect.arrayContaining(["storm window", "lawn"]));
    expect(scenes[1].humanPresent).toBeUndefined();
    // The singing robin the check passed is left exactly as it was.
    expect(scenes[0].showSubject).toBe("a male robin singing with its beak open on a branch at sunrise in spring");
  });

  it("a line that points back at the main thing keeps it (job 404 scene 5)", () => {
    const scenes = [pic(5, AROUND, "a robin standing on a green lawn in early spring with patches of melting snow", { keyThing: "robin" })];
    const fixes = parsePictureFixes(JSON.stringify({ pictures: [{ id: 0, about: "the robin that stayed all winter", shows_it: true }] }), scenes);
    expect(fixes).toEqual([]);
    expect(applyPictureFixes(scenes, fixes, BIRDS)).toBe(0);
    expect(scenes[0].keyThing).toBe("robin");
  });
});
