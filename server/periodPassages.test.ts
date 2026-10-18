/**
 * A PASSAGE OF ANOTHER TIME SETS EVERY PICTURE IN IT; A "HE" OF THE STORY IS NEVER THE HOST (round 13,
 * 2026-10-18, the review of job 409). Job 409's essay video tells of a writer of ancient times, and
 * his list "The farmer complains, the senator complains, the old complain, and the young are already
 * rehearsing the complaint" (156-164 s) was drawn from each item's bare words: a farmer in overalls
 * in a cornfield, an old man in a modern jacket on a park bench by a lake, a young man in a hoodie —
 * only the senator came back dressed for the time. The next line, "Then he turns the whole thing over
 * in a single motion: life is not short" (scene 33, the writer reversing his argument), was drawn as
 * the HOST turning a page at the desk: the wrong person, and the idiom drawn as its literal verb.
 *
 * The rules are general and the lines here are the real rows: the list finder (one call, the whole
 * script) now says the time and place a list's sentence is set in (`setting` → `scene.listSetting`),
 * each item's prompt says it (`listItemClause`), the shot list and the line check are told to set
 * every picture of such a passage there and to draw a figure of speech by what it means, and the line
 * check is told when a picture's line says "he"/"she" and nothing in the first person
 * (`fitPictureNotes`). Clean cases (a list of today, a how-to that really turns a thing over, someone
 * already drawn as someone else, a dog's "he") are held unchanged beside them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryboardScene } from "@shared/types";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", () => ({ invokeClaude: mockInvoke }));

import { FIT_SYSTEM, SHOT_LIST_SYSTEM, fitPictureNotes, fitPicturesToLines, storyPersonLine } from "./shotList";
import {
  LISTS_SYSTEM,
  applySpokenLists,
  findSpokenLists,
  listSettingOf,
  parseSpokenLists,
  type SpokenList,
} from "./spokenLists";
import { buildStillPrompt, listItemClause } from "./longformVideo";

const pic = (index: number, scriptText: string, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: scriptText, scriptText, showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;
const host = (index: number, scriptText: string, over: Partial<StoryboardScene> = {}) =>
  pic(index, scriptText, "the host", { hostPresent: true, ...over });

/** What the cases came from — never in a rulebook (the rules must fit any channel). */
const CHANNEL_WORDS = /seneca|\brom(?:e|an)\b|senator|toga|stoic|paulinus|complain|hoodie|overalls/i;

// Job 409's real lines (sentences 18-21 of its script).
const ESSAY = "The essay is called On the Shortness of Life, and it opens by picking a fight with its own title.";
const EVERYONE = "Everyone complains that life is too short, Seneca says.";
const SERIES = "The farmer complains, the senator complains, the old complain, and the young are already rehearsing the complaint.";
const TURN = "Then he turns the whole thing over in a single motion: life is not short.";
const FOUR = ["The farmer complains", "the senator complains", "the old complain", "the young are already rehearsing the complaint"];
const ROME = "ancient Rome, first century AD";

/** Job 409 scenes 28-33 as the shot list planned them (the list items' planner pictures, as shipped). */
const film409 = () => [
  pic(28, `${ESSAY} ${EVERYONE}`, "the host reading a book at the desk in the study", { humanPresent: true }),
  pic(29, "The farmer complains,", "a farmer standing in a field, seen from behind", { humanPresent: true, otherPerson: "a farmer", listCut: true }),
  pic(30, "the senator complains,", "a senator in robes standing in a hall, seen from the side", { humanPresent: true, otherPerson: "a senator", listCut: true }),
  pic(31, "the old complain,", "an old man sitting on a bench, seen from behind", { humanPresent: true, otherPerson: "an old man", listCut: true }),
  pic(32, "and the young are already rehearsing the complaint.", "a young man standing alone in a courtyard, seen from the side", {
    humanPresent: true,
    otherPerson: "a young man",
    listCut: true,
  }),
  pic(33, TURN, "the host turning a page slowly at the desk", { humanPresent: true, hostCandidate: true }),
];

beforeEach(() => mockInvoke.mockReset());

describe("the list finder says where and when a list's sentence is set", () => {
  const answer = (items: string[], setting: unknown, kind = "things") =>
    JSON.stringify({ lists: [{ sentence: 0, kind, items, setting }] });

  it("is asked for it, in words that name no channel", () => {
    expect(LISTS_SYSTEM).toMatch(/For each list also give setting: when its sentence is set in ANOTHER TIME or a FARAWAY PLACE/);
    expect(LISTS_SYSTEM).toMatch(/a list counts as inside such a passage even when its own sentence names no time or place/);
    expect(LISTS_SYSTEM).toMatch(/setting is null when the list is\s+about the video's own here and now/);
    expect(LISTS_SYSTEM).toMatch(/"setting":null/);
    expect(LISTS_SYSTEM).not.toMatch(CHANNEL_WORDS);
  });

  it("job 409: the farmer-senator list keeps its four items and gains the passage's time and place", () => {
    expect(parseSpokenLists(answer(FOUR, ROME), [SERIES])).toEqual([{ sentence: 0, items: FOUR, setting: ROME }]);
    // The model stopping one member early still gets "the young…" back, setting and all.
    expect(parseSpokenLists(answer(FOUR.slice(0, 3), `"${ROME}."`), [SERIES])).toEqual([{ sentence: 0, items: FOUR, setting: ROME }]);
    // Clean: a list of STEPS never takes one — each step is drawn as the host's own hands doing it,
    // here and now, and a setting would dress the host's sleeves for another age.
    const steps = ["Knead the dough", "shape the loaf", "bake it in the stone oven"];
    expect(parseSpokenLists(answer(steps, "a medieval town, about 1300", "steps"), ["Knead the dough, shape the loaf, and bake it in the stone oven."])).toEqual([
      { sentence: 0, items: steps, kind: "steps" },
    ]);
  });

  it("clean: a list of the video's own here and now gets no setting, whatever the model wrote", () => {
    const tools = "You'll need some glue, a clamp, and a rag.";
    const items = ["some glue", "a clamp", "a rag"];
    for (const said of [null, undefined, "", "null", "None", "today", "the present day", "Modern times.", "the video's own here and now", 7])
      expect(parseSpokenLists(answer(items, said), [tools])).toEqual([{ sentence: 0, items }]);
    expect(parseSpokenLists(answer(items, null), [tools])![0]).not.toHaveProperty("setting");
  });

  it("listSettingOf keeps a short phrase of a time or a faraway place and nothing else", () => {
    expect(listSettingOf(ROME)).toBe(ROME);
    expect(listSettingOf("  “a fishing village in Norway in the 1890s.”  ")).toBe("a fishing village in Norway in the 1890s");
    expect(listSettingOf("a fishing village in Japan today")).toBe("a fishing village in Japan today");
    expect(listSettingOf("the present day")).toBeUndefined();
    expect(listSettingOf("today's ordinary world")).toBeUndefined();
    expect(listSettingOf("n/a")).toBeUndefined();
    expect(
      listSettingOf("it is set in the same place as the rest of the passage which is about a writer who lived a very long time ago")
    ).toBeUndefined();
    expect(listSettingOf({ when: ROME })).toBeUndefined();
  });

  it("in the whole script, as the pipeline asks it — and a list the shape makes longer keeps the model's setting", async () => {
    const text = `${ESSAY} ${EVERYONE} ${SERIES} ${TURN}`;
    const r = await findSpokenLists(text, {
      ask: async () => JSON.stringify({ lists: [{ sentence: 2, kind: "things", items: FOUR, setting: ROME }] }),
    });
    expect(r.lists).toEqual([{ sentence: 2, items: FOUR, setting: ROME }]);
    // Job 401's places: the model gave two of the three, the shape found the third before "when…"
    // (`endsEarly`) — the longer list takes the model's place and its setting with it.
    const places =
      "Most people past sixty have — usually in silence, usually in some ordinary place, a waiting room, a church pew, the kitchen table at two in the morning when the house is too quiet.";
    const longer = await findSpokenLists(places, {
      ask: async () =>
        JSON.stringify({ lists: [{ sentence: 0, kind: "things", items: ["a waiting room", "a church pew"], setting: "a small town in the 1950s" }] }),
    });
    expect(longer.lists).toEqual([
      { sentence: 0, items: ["a waiting room", "a church pew", "the kitchen table at two in the morning"], setting: "a small town in the 1950s" },
    ]);
  });
});

describe("every item of the list is set where its sentence is (job 409, 156-164 s)", () => {
  const LIST: SpokenList = { sentence: 2, items: FOUR, setting: ROME };

  it("job 409: each item picture carries the setting, and its prompt says it", () => {
    const r = applySpokenLists(film409(), [LIST]);
    const items = r.scenes.filter(s => s.listCut);
    expect(items.map(s => s.scriptText)).toEqual([
      "The farmer complains,",
      "the senator complains,",
      "the old complain,",
      "and the young are already rehearsing the complaint.",
    ]);
    expect(items.map(s => s.listSetting)).toEqual([ROME, ROME, ROME, ROME]);
    // The pictures around the list are not list items and get nothing.
    expect(r.scenes.filter(s => !s.listCut).map(s => s.listSetting)).toEqual([undefined, undefined]);
    for (const s of items) {
      const prompt = buildStillPrompt(s);
      expect(prompt).toContain(`Like the sentence it is said in, this picture is set in ${ROME}:`);
      expect(prompt).toMatch(/anyone in it is dressed as people were there and then/);
      expect(prompt).toMatch(/nothing from another time or place/);
    }
    // The planner's own picture is kept: the setting rides beside it, it does not replace it.
    expect(items[0].showSubject).toBe("a farmer standing in a field, seen from behind");
  });

  it("clean: a list with no setting gets none, and a setting an earlier pass left is cleared", () => {
    const stale = film409().map(s => (s.listCut ? { ...s, listSetting: ROME } : s));
    const r = applySpokenLists(stale, [{ sentence: 2, items: FOUR }]);
    expect(r.scenes.map(s => s.listSetting)).toEqual(r.scenes.map(() => undefined));
    expect(buildStillPrompt(r.scenes.find(s => s.listCut)!)).not.toMatch(/Like the sentence it is said in/);
  });

  it("clean: a list of steps sets nothing, even one saved with a setting — each step is the host's own hands", () => {
    const said = "Knead the dough, shape the loaf, and bake it in the stone oven.";
    const r = applySpokenLists([pic(1, said, "the host's hands kneading dough on the counter", { humanPresent: true })], [
      { sentence: 0, items: ["Knead the dough", "shape the loaf", "bake it in the stone oven"], kind: "steps", setting: "a medieval town, about 1300" },
    ]);
    const items = r.scenes.filter(s => s.listCut);
    expect(items.length).toBeGreaterThanOrEqual(3);
    for (const s of items) {
      expect(s.listKind).toBe("steps");
      expect(s.listSetting).toBeUndefined();
      expect(buildStillPrompt(s)).not.toMatch(/Like the sentence it is said in/);
    }
  });

  it("listItemClause: the setting follows the tell-apart clause; with none the clause is exactly as before", () => {
    const listItems = { own: "The farmer complains", others: ["the senator complains", "the old complain", "the young are already rehearsing the complaint"] };
    const before =
      ` This picture is one item of a list said one after another — it shows "The farmer complains", drawn so ` +
      `it is clearly that, by the shape and features that make it what it is, and could never be ` +
      `taken for the other items of the list ("the senator complains", "the old complain", "the young are already rehearsing the complaint"), which each get their own picture.`;
    const farmer = pic(29, "The farmer complains,", "a farmer standing in a field, seen from behind", { listCut: true, listItems });
    expect(listItemClause(farmer)).toBe(before);
    expect(listItemClause({ ...farmer, listSetting: `${ROME}.` })).toBe(
      `${before} Like the sentence it is said in, this picture is set in ${ROME}: anyone in it is dressed as people were ` +
        `there and then, and the tools, buildings and land belong to that time and place — nothing from another time or place.`
    );
    // Dale's job 397 list of today: unchanged.
    const coasters = pic(5, "ornaments,", "a few small wooden ornaments", {
      listCut: true,
      listItems: { own: "ornaments", others: ["Coasters", "small cutting boards"] },
    });
    expect(listItemClause(coasters)).not.toMatch(/Like the sentence/);
    expect(listItemClause(pic(6, "a plain picture", "a bowl on a table"))).toBe("");
  });
});

describe("a 'he' of the story is never the host, and a figure of speech is drawn by what it means (job 409 scene 33)", () => {
  it("storyPersonLine: a line told about someone, never one the host says about themself", () => {
    expect(storyPersonLine(TURN)).toBe(true);
    expect(storyPersonLine("Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat.")).toBe(true); // job 400 scene 6
    expect(storyPersonLine("She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.")).toBe(true); // job 410 scene 8
    // The host in the line: not one.
    expect(storyPersonLine("When a man like that sits down to write about time, I pull my chair in closer.")).toBe(false); // job 409 scene 27
    expect(storyPersonLine("He was one of the richest men in the empire, buried under exactly the kind of obligations we are about to talk about")).toBe(false);
    expect(storyPersonLine("He told me to wait.")).toBe(false);
    expect(storyPersonLine("I turn it over every morning.")).toBe(false);
    // A how-to said to the viewer has no "he" at all.
    expect(storyPersonLine("Turn it over and sand the other side.")).toBe(false);
    expect(storyPersonLine("The theme of the essay is time.")).toBe(false);
    expect(storyPersonLine(undefined)).toBe(false);
  });

  it("job 409 scene 33: the line check is told its he/she is not the host", () => {
    const [, , , , , turn] = film409();
    expect(fitPictureNotes(turn)).toBe(" (its he/she is not the host)");
    // Job 400 scene 6, the man from the opening story, drawn with the host's look.
    expect(
      fitPictureNotes(
        pic(6, "Seventeen. He pays, he walks out to the parking lot, and the number rides home with him in the passenger seat.", "an older man walking across an open parking lot toward a single parked car")
      )
    ).toBe(" (its he/she is not the host)");
  });

  it("clean: no note for someone already drawn as someone else, a picture of things, a dog's 'he' or a how-to", () => {
    expect(fitPictureNotes(pic(33, TURN, "an older man in a draped robe pausing at a writing table, pen lifted", { humanPresent: true, otherPerson: "an ancient writer" }))).toBe("");
    expect(fitPictureNotes(pic(33, TURN, "an open book lying on the desk by the window"))).toBe("");
    // Job 357 scene 20: the "he" is the dog.
    expect(fitPictureNotes(pic(20, "You can't smell any of that. He can smell every bit of it.", "dog's nose sniffing closely at the host's coat near the door"))).toBe("");
    expect(fitPictureNotes(pic(9, "Turn it over and sand the other side.", "the host's hands turning a board over on the workbench", { humanPresent: true }))).toBe("");
    // Job 410 scene 8: the passenger is already someone else.
    expect(
      fitPictureNotes(
        pic(8, "She doesn't. What she knows is which questions flight attendants like hearing, and when to ask them.", "an older woman seen from the side nodding politely up at a flight attendant", {
          humanPresent: true,
          otherPerson: "an older woman passenger and a flight attendant",
        })
      )
    ).toBe("");
  });

  it("the shot list is told: the moment is that person's, a figure of speech by what it means, and the passage's time and place", () => {
    expect(SHOT_LIST_SYSTEM).toMatch(/"he" or "she" for a person the script is talking about \(a writer, a figure from history, a neighbour\) — the moment is THAT person's, never the host's/);
    expect(SHOT_LIST_SYSTEM).toMatch(/the host only ever speaks of themself as "I"/);
    expect(SHOT_LIST_SYSTEM).toMatch(/A FIGURE OF SPEECH is shown by what it means, never by its literal words/);
    expect(SHOT_LIST_SYSTEM).toMatch(/nobody upside down, no page or object turned over/);
    expect(SHOT_LIST_SYSTEM).toMatch(/Only a how-to that really turns, opens or lifts a thing \("turn the board over and sand the other side"\) is shown literally/);
    expect(SHOT_LIST_SYSTEM).toMatch(/a person of the story the line calls "he" or "she" \(rule 1f\); never the host/);
    expect(SHOT_LIST_SYSTEM).toMatch(/1h\. ANOTHER TIME OR PLACE/);
    // A passage AWAY from the video's own here and now — never a whole video about another country.
    expect(SHOT_LIST_SYSTEM).toMatch(/a faraway place, away from the video's own here and now — history/);
    expect(SHOT_LIST_SYSTEM).toMatch(/names that time and place in show and dresses its people, tools and buildings for it/);
    expect(SHOT_LIST_SYSTEM).toMatch(/the shots of a spoken list and a shot of a bare word too/);
    expect(SHOT_LIST_SYSTEM).toMatch(/A line inside it about today is today/);
    // Rule 11 no longer sends a shot with no place of its own straight to the home setting.
    expect(SHOT_LIST_SYSTEM).toMatch(/else the time and place of the passage it is in \(rule 1h\), else the props list's home setting/);
    // What the earlier rounds pinned is still there.
    expect(SHOT_LIST_SYSTEM).toMatch(/or the host at work/);
    expect(SHOT_LIST_SYSTEM).toMatch(/Someone who is not the host is shown as rule 6a says, with other set to who they are/);
    expect(SHOT_LIST_SYSTEM).not.toMatch(CHANNEL_WORDS);
  });

  it("the line check is told the same, and asks what a figure of speech MEANS", () => {
    expect(FIT_SYSTEM).toMatch(/A FIGURE OF SPEECH is about what it means, never its literal words/);
    expect(FIT_SYSTEM).toMatch(/A picture that draws a figure of\s+speech literally is WRONG/);
    expect(FIT_SYSTEM).toMatch(/is literal, and so is its picture/);
    expect(FIT_SYSTEM).toMatch(/for an idea, the idea; for a figure of speech, what it MEANS, never its literal\s+verb/);
    expect(FIT_SYSTEM).toMatch(/"He" or "she"\s+in a line is never the host, who speaks of themself as "I"/);
    expect(FIT_SYSTEM).toMatch(/or an animal the script is about/);
    expect(FIT_SYSTEM).toMatch(/A picture marked "its he\/she is not the host" has such a line/);
    expect(FIT_SYSTEM).toMatch(/ANOTHER TIME OR PLACE\. A stretch of lines may be set in another time or a faraway place/);
    // Only a stretch away from the video's own world: a host showing a household of their own country
    // is not a video of "another country" whose every picture must name it.
    expect(FIT_SYSTEM).toMatch(/a faraway place, away from the\s+video's own here and now/);
    expect(FIT_SYSTEM).toMatch(/A video whose own world is that time or place has no such stretch/);
    expect(FIT_SYSTEM).toMatch(/A picture there whose words give no sign of that time or place, so it would be drawn as\s+today, is WRONG/);
    expect(FIT_SYSTEM).toMatch(/A picture marked "inside a passage set in …" is in such a stretch/);
    // Earlier pins, kept.
    expect(FIT_SYSTEM).toMatch(/for a\s+sound, what makes it; for an idea, the idea/);
    expect(FIT_SYSTEM).toMatch(/When THE\s+VIEWER is given, the viewer the line speaks to is never the host/);
    expect(FIT_SYSTEM).not.toMatch(CHANNEL_WORDS);
  });
});

describe("the line check gets the notes and its rewrites land (job 409 scenes 29 and 33)", () => {
  it("job 409: the list item is marked with its passage, scene 33 with its he; the rewrites keep the list", async () => {
    const listed = applySpokenLists(film409(), [{ sentence: 2, items: FOUR, setting: ROME }]).scenes;
    const farmer = listed.findIndex(s => s.scriptText === "The farmer complains,");
    const turn = listed.findIndex(s => s.scriptText === TURN);
    mockInvoke.mockResolvedValueOnce({
      text: JSON.stringify({
        pictures: [
          {
            id: farmer,
            about: "a farmer of the writer's time complaining",
            shows_it: false,
            show: "a farmer of ancient Rome in a rough wool tunic, standing in a wheat field, seen from behind",
            thing: null,
            stage: null,
            other: "a Roman farmer",
          },
          {
            id: turn,
            about: "the writer reversing his argument: life is not short",
            shows_it: false,
            show: "an older man in an off-white toga at a writing table, his reed pen lifted, pausing mid-thought, seen from the side",
            thing: null,
            stage: null,
            other: "Seneca",
          },
        ],
      }),
    });
    const r = await fitPicturesToLines(listed, {});
    const sent: string = mockInvoke.mock.calls[0][0].userMessage;
    expect(sent).toContain(`#${farmer} PICTURE (inside a passage set in ${ROME}): said "The farmer complains,"`);
    expect(sent).toContain(`#${turn} PICTURE (its he/she is not the host): said "${TURN}" | shows: the host turning a page slowly at the desk`);
    // The senator, already someone else, gets no he/she note — only its passage.
    expect(sent).toContain(`PICTURE (inside a passage set in ${ROME}): said "the senator complains,"`);
    expect(r.fixed).toBe(2);
    const fixedTurn = r.scenes[turn];
    expect(fixedTurn.showSubject).not.toMatch(/host|page/);
    expect(fixedTurn.otherPerson).toBe("Seneca");
    expect(fixedTurn.humanPresent).toBe(true);
    const fixedFarmer = r.scenes[farmer];
    expect(fixedFarmer.listCut).toBe(true);
    expect(fixedFarmer.listSetting).toBe(ROME);
    expect(fixedFarmer.otherPerson).toBe("a Roman farmer");
  });

  it("clean: a picture of today with a first-person line goes to the check exactly as before", async () => {
    mockInvoke.mockResolvedValueOnce({ text: JSON.stringify({ pictures: [] }) });
    const scenes = [
      host(1, "When a man like that sits down to write about time, I pull my chair in closer."),
      pic(2, "I turn the board over and sand the other side.", "the host's hands turning a board over on the workbench", { humanPresent: true }),
    ];
    await fitPicturesToLines(scenes, {});
    const sent: string = mockInvoke.mock.calls[0][0].userMessage;
    expect(sent).toContain(`#1 PICTURE: said "I turn the board over and sand the other side." | shows: the host's hands turning a board over on the workbench`);
  });
});
