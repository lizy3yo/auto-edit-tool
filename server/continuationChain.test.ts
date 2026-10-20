/**
 * A CONTINUATION KNOWS WHAT IT CONTINUES (round 14, the review of the verification films 408-414).
 * (a) Job 413 scenes 15-16: two views of one phone call came back as one over-the-shoulder shot, the
 * phone a corded desk phone in one and a smartphone in the other. Neither named a key thing, so the
 * second had no reference to the first, no concrete camera, and was drawn at the same moment. Now a
 * continuation of no key thing is drawn from the picture it continues (`keylessContinued`) for how the
 * people and things in it look, takes a camera from `REDRAW_CAMERAS`, and is drawn after it.
 * (b) Job 412 scene 8 repeated scene 3 (the same tabby walking at the camera): a list cut out of the
 * middle of its beat left the "ribs" close-up right before it, and the picture it continued, its camera
 * and its near-copy partner were all read off that close-up. The topic chain skips the list
 * (`topicPictureBefore`). The rows are those films'; the rules are general.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  attachMemory,
  continuationCameraIndex,
  continuedPicture,
  keylessContinued,
  memoryFor,
  memorySourcesFor,
  memoryView,
  memoryViewFor,
  nearCopyPartner,
  nearCopyPartnerFor,
  pictureSettled,
  recomposeFrom,
  samePeople,
  sharedWords,
  topicPictureBefore,
} from "./pictureMemory";
import { buildStillPrompt, continuedMomentClause, memoryClause, memoryFields } from "./longformVideo";
import { OTHER_VIEWS } from "./shotList";
import { REDRAW_CAMERAS, varietyLanes } from "./pictureVariety";

const pic = (index: number, show: string, over: Partial<StoryboardScene> = {}) =>
  ({ index, narration: "n", scriptText: "n", showSubject: show, visualPrompt: show, ...over }) as StoryboardScene;

const HOST_LOOK =
  "A lean man in his late fifties with fair, weathered skin, graying hair under a woven straw cowboy hat, wearing a light blue denim button-up shirt";
const HOST_REF = "https://r2/host-photos/phone-v4-413.jpg";
const atWork = { humanPresent: true, brollHostLook: HOST_LOOK, brollHostRef: HOST_REF } as const;

// Job 413's rows as stored: a list item, then the phone call past its limit and its second view.
const CALL = "the host on the phone at the workbench calling the city office";
const job413 = () => [
  pic(14, "the host leaning on the workbench with arms crossed, looking at a worn tool in his hand", {
    listCut: true,
    ...atWork,
  }),
  pic(15, CALL, atWork),
  pic(16, `${CALL}${OTHER_VIEWS[0]}`, atWork),
];

// Job 412's rows as stored: "She walks the full length of you, | ankle, | knee, | hip, | ribs, | steady
// as a tightrope walker…" — the list cut out of the middle of one beat.
const owner = { humanPresent: true, otherPerson: "the cat owner" } as const;
const job412 = () => [
  pic(2, "cat paws stepping silently onto the foot of the bed", { keyThing: "cat paws" }),
  pic(3, "cat walking across sleeping owner's legs in bed", { keyThing: "cat", ...owner }),
  pic(4, "cat stepping along owner's body from ankle toward ribs in bed", { keyThing: "cat", listCut: true, ...owner }),
  pic(5, "close-up of the cat's white-tipped paw pressing onto the sleeping owner's knee under the dark grey blanket", {
    keyThing: "cat paws",
    listCut: true,
    ...owner,
  }),
  pic(6, "close-up of the cat's white-tipped paw stepping onto the sleeping owner's hip under the white sheet", {
    keyThing: "cat paws",
    listCut: true,
    ...owner,
  }),
  pic(7, "close-up of the cat's white-tipped paw pressing on the sleeping owner's ribs under the dark grey blanket", {
    keyThing: "cat paws",
    listCut: true,
  }),
  pic(8, "cat continuing steady walk across owner's body in bed", { keyThing: "cat", sameShot: true, ...owner }),
  pic(9, "cat lowering face close to owner's face in bed", { keyThing: "cat", ...owner }),
];

// Job 409's rows: someone else in the study, the list "money, grief, difficult people, and what the
// remaining years are actually for", then the host marked to continue.
const job409 = () => [
  pic(14, "a person in their sixties sitting alone in the quiet study", {
    humanPresent: true,
    otherPerson: "a person in their sixties",
  }),
  pic(15, "a few folded bills and an open checkbook on the wooden desk by the window", { listCut: true }),
  pic(16, "close-up of the plain cream sympathy card with a muted gray ribbon print, standing open beside a framed photo on a wooden desk", {
    keyThing: "sympathy card",
    listCut: true,
  }),
  pic(17, "two older neighbours standing apart at a garden fence, arms crossed, seen from the side", {
    listCut: true,
    humanPresent: true,
    otherPerson: "two neighbours",
  }),
  pic(18, "an older man planting a young tree in a backyard on a sunny morning, seen from behind", {
    listCut: true,
    humanPresent: true,
    otherPerson: "an older man",
  }),
  pic(19, "the host speaking thoughtfully at his desk in the study", { sameShot: true, ...atWork }),
];

afterEach(() => {
  delete process.env.PICTURE_VARIETY;
});

describe("the picture a topic continues, by its chain (topicPictureBefore)", () => {
  it("412-8: past the list cut out of its beat, scene 3 — never the 'ribs' close-up right before it", () => {
    const b = job412();
    expect(topicPictureBefore(b, b[6])?.index).toBe(3);
    expect(continuedPicture(b, b[6])?.index).toBe(3);
    expect(recomposeFrom(b, b[6])).toEqual({ from: b[1], continues: true });
    expect(nearCopyPartnerFor(b, b[6])?.index).toBe(3);
    // Drawn from scene 3 alone: the ankle close-up (filed under the cat too) is an insert, not its latest.
    expect(memorySourcesFor(b, b[6]).map(s => s.index)).toEqual([3]);
  });

  it("a list item keeps the picture right before it; a picture after a picture is unchanged", () => {
    const b = job412();
    expect(topicPictureBefore(b, b[3])?.index).toBe(4); // "knee," after "ankle,"
    const plain = [pic(3, "cat walking across sleeping owner's legs in bed", { keyThing: "cat" }), pic(4, "cat curling up beside the pillow", { keyThing: "cat", sameShot: true })];
    expect(topicPictureBefore(plain, plain[1])).toBe(plain[0]);
    expect(nearCopyPartnerFor(plain, plain[1])).toBe(plain[0]);
    expect(continuedPicture(plain, plain[1])).toBe(plain[0]);
  });

  it("a host take or a split ends the chain: nothing past it is continued", () => {
    const host = pic(5, "", { showSubject: undefined, visualPrompt: "the host talking to the camera", hostPresent: true });
    const b = [pic(3, "cat walking across the bed", { keyThing: "cat" }), host, pic(6, "cat stretching on the pillow", { keyThing: "cat", sameShot: true })];
    expect(topicPictureBefore(b, b[2])).toBeUndefined();
    const split = { ...host, splitVisual: "the cat asleep on the blanket" } as StoryboardScene;
    const s = [b[0], split, b[2]];
    expect(topicPictureBefore(s, s[2])).toBeUndefined();
  });

  it("412-8 at render: drawn from scene 3 as the picture it continues, and laid beside it", async () => {
    const b = job412();
    b[1].pictureUrl = "https://r2/412/still-src-3.png";
    attachMemory(b, [b[6]]);
    expect(nearCopyPartner(b[6])).toBe(b[1]);
    const m = await memoryFor(b[6], 0);
    expect(m).toMatchObject({ urls: ["https://r2/412/still-src-3.png"], own: true, before: 0, continues: true });
  });

  // The other side of the same rule (review of round 14): a continuation whose words are about the
  // list's LAST ITEM carries on from that item, and is laid beside it — the copy a viewer could see.
  it("352-170: 'which is bark edge left along the side' continues the wane close-up, never the cull bins", () => {
    const board = "rough-sawn board";
    const b = [
      pic(165, "culls and shorts bins at the end of the lumber yard racks", { keyThing: "culls and shorts bins" }),
      pic(166, "close-up of a rough oak board face with a round dark brown knot about the size of a coin, the grain lines curving around it", {
        keyThing: "culls and shorts bins",
        listCut: true,
      }),
      pic(168, "close-up of a rough oak board with a pale cream band along one edge, clearly lighter than the darker tan-brown wood beside it", {
        keyThing: board,
        partOf: board,
        listCut: true,
      }),
      pic(169, "close-up of one long edge of a rough oak board where a strip of rough brown-grey bark replaces the square corner", {
        keyThing: board,
        partOf: board,
        listCut: true,
      }),
      pic(170, "close-up of a rough oak board's side edge with a strip of rough brown-grey bark and rounded log surface left along it in place of a square corner", {
        keyThing: board,
        partOf: board,
        sameShot: true,
      }),
    ];
    expect(topicPictureBefore(b, b[4])?.index).toBe(169);
    expect(continuedPicture(b, b[4])?.index).toBe(169);
    expect(nearCopyPartnerFor(b, b[4])?.index).toBe(169);
    expect(memorySourcesFor(b, b[4]).map(s => s.index)).toContain(169);
  });

  it("352-117 and 392-32: the end grain and the necklace at the window carry on from the last item", () => {
    const board = "rough-sawn board";
    const grain = [
      pic(114, "planer shavings piled loosely beneath the benchtop planer in the garage", { keyThing: "planer shavings" }),
      pic(115, "host sighting down a rough-sawn board held at eye level in the yard", { keyThing: board, listCut: true, ...atWork }),
      pic(116, "close-up of the end grain on a rough-sawn board end", { keyThing: board, listCut: true }),
      pic(117, "close-up of end grain showing growth rings running straight up and down through the board thickness", {
        keyThing: board,
        sameShot: true,
      }),
    ];
    expect(topicPictureBefore(grain, grain[3])?.index).toBe(116);
    expect(nearCopyPartnerFor(grain, grain[3])?.index).toBe(116);
    const neck = [
      pic(29, "pearl strand necklace held against a sweater neckline, close view", { keyThing: "Pearl strand", humanPresent: true }),
      pic(30, "hands holding a necklace up near the face beside a bright window", {
        keyThing: "necklace collection",
        listCut: true,
        humanPresent: true,
      }),
      pic(31, "necklace held at the neck beside a bright window, daylight bouncing off it onto the skin under the chin, close view", {
        keyThing: "Window",
        listCut: true,
        humanPresent: true,
      }),
      pic(32, "a necklace held under the chin catching light from the window, close view", {
        keyThing: "necklace collection",
        sameShot: true,
        humanPresent: true,
      }),
    ];
    expect(topicPictureBefore(neck, neck[3])?.index).toBe(31);
    expect(nearCopyPartnerFor(neck, neck[3])?.index).toBe(31);
  });

  it("with nothing before the list to continue, the last item is it, as before (346-14 after the quilt's blocks)", () => {
    const quilt = "sampler quilt";
    const host = pic(10, "", { showSubject: undefined, visualPrompt: "the host talking to the camera", hostPresent: true });
    const b = [
      host,
      pic(13, "close-up of a horizontal row of dark triangles on light backgrounds, all pointing the same way, running across the middle of the quilt", {
        keyThing: quilt,
        partOf: quilt,
        listCut: true,
      }),
      pic(14, "sampler quilt spread out showing twelve pieced blocks", { keyThing: quilt, sameShot: true }),
    ];
    expect(topicPictureBefore(b, b[2])?.index).toBe(13);
  });

  it("subject words: views, framing and little words aside, each word by its stem", () => {
    const b = job412();
    expect(sharedWords(b[1], b[6])).toBe(5); // cat, walk, across, owner, bed
    expect(sharedWords(b[5], b[6])).toBe(2); // cat, owner
    expect(sharedWords(pic(1, `a dog asleep on the porch${OTHER_VIEWS[0]}`), pic(2, "a close view of the frame"))).toBe(0);
  });
});

describe("a continuation of no key thing is drawn from what it continues (keylessContinued)", () => {
  it("413-16: the phone call's second view is drawn from the first, with a concrete camera", () => {
    const b = job413();
    expect(keylessContinued(b, b[2])).toBe(b[1]);
    expect(memorySourcesFor(b, b[2])).toEqual([b[1]]);
    expect(continuedPicture(b, b[2])).toBe(b[1]);
    expect(nearCopyPartnerFor(b, b[2])).toBe(b[1]);
    // The camera its words' view names, the concrete one (`REDRAW_CAMERAS`), not the words alone.
    expect(continuationCameraIndex(b, b[2])).toBe(0);
    expect(memoryViewFor(b, b[2])).toBe(REDRAW_CAMERAS[0]);
  });

  it("413-15, the first view, and a list item continue nothing and get no camera", () => {
    const b = job413();
    expect(keylessContinued(b, b[1])).toBeUndefined();
    expect(memorySourcesFor(b, b[1])).toEqual([]);
    expect(memoryViewFor(b, b[1])).toBeUndefined();
    expect(keylessContinued(b, b[0])).toBeUndefined();
  });

  it("different words and no mark: nothing lent, no camera — as before", () => {
    const b = [pic(1, "a quiet farmhouse kitchen at dawn, a kettle on the old stove"), pic(2, "a dog asleep on the porch steps")];
    expect(keylessContinued(b, b[1])).toBeUndefined();
    expect(memorySourcesFor(b, b[1])).toEqual([]);
    expect(memoryViewFor(b, b[1])).toBeUndefined();
  });

  it("409-19: never from a picture of someone else — the check still looks at the pair", () => {
    const b = job409();
    expect(samePeople(b[0], b[5])).toBe(false);
    expect(keylessContinued(b, b[5])).toBeUndefined();
    expect(memorySourcesFor(b, b[5])).toEqual([]);
    expect(memoryViewFor(b, b[5])).toBeUndefined();
    expect(nearCopyPartnerFor(b, b[5])?.index).toBe(14);
  });

  it("409-19 had the host been in scene 14: drawn from it, from the other side — a close view only if its words ask", () => {
    const b = job409();
    b[0] = pic(14, "the host sitting alone in the quiet study", atWork);
    expect(samePeople(b[0], b[5])).toBe(true);
    expect(keylessContinued(b, b[5])).toBe(b[0]);
    // Words of its own, a whole subject: the other side keeps it whole.
    expect(memoryViewFor(b, b[5])).toBe(REDRAW_CAMERAS[2]);
    b[5] = pic(19, "close view of the host's hands resting on the desk in the study", { sameShot: true, ...atWork });
    expect(memoryViewFor(b, b[5])).toBe(REDRAW_CAMERAS[0]);
    // Never the camera of the picture it continues.
    b[0] = pic(14, `the host sitting alone in the quiet study${OTHER_VIEWS[2]}`, atWork);
    b[5] = pic(19, "the host speaking thoughtfully at his desk in the study", { sameShot: true, ...atWork });
    expect(continuationCameraIndex(b, b[0])).toBe(2);
    expect(continuationCameraIndex(b, b[5])).toBe(0);
  });

  it("another of its kind is never drawn from the video's own; the same wild one is", () => {
    const another = [{ name: "cat", said: "a wild cat" }];
    const b = [
      pic(2, "a grey-and-white cat walking across the bed", { keyThing: "cat" }),
      pic(23, "a wild cat stalking low through scattered brush at dawn", { othersOfKind: another }),
      pic(24, "a wild cat crouched in the brush, eyes on a small mouse", { othersOfKind: another, sameShot: true }),
    ];
    expect(keylessContinued(b, b[2])).toBe(b[1]);
    const pet = [b[0], b[2]];
    expect(keylessContinued(pet, pet[1])).toBeUndefined();
  });

  it("who is in a picture: the same person, or only one of them named, can be one moment", () => {
    expect(samePeople(pic(1, "a", atWork), pic(2, "b", atWork))).toBe(true);
    expect(samePeople(pic(1, "a", { otherPerson: "a woman buyer" }), pic(2, "b", { otherPerson: "A woman buyer " }))).toBe(true);
    expect(samePeople(pic(1, "a", { otherPerson: "a woman buyer" }), pic(2, "b", { otherPerson: "two neighbours" }))).toBe(false);
    expect(samePeople(pic(1, "a", { otherPerson: "a woman buyer" }), pic(2, "b", atWork))).toBe(false);
    expect(samePeople(pic(1, "a telephone on the bench"), pic(2, "b", atWork))).toBe(true);
  });
});

describe("413-16 at render: after scene 15, from it, told what it lends", () => {
  it("waits for scene 15, then is drawn from it as the picture it continues", async () => {
    const b = job413();
    attachMemory(b, [b[1], b[2]]);
    let done = false;
    const waiting = memoryFor(b[2], 5_000).then(m => ((done = true), m));
    await new Promise(r => setTimeout(r, 20));
    expect(done).toBe(false); // drawn in turn, never beside it
    b[1].pictureUrl = "https://r2/413/still-src-15.png";
    pictureSettled(b[1]);
    const m = await waiting;
    expect(m).toMatchObject({ urls: ["https://r2/413/still-src-15.png"], own: true, before: 0, continues: true });
    const fields = memoryFields(m, memoryView(b[2]));
    expect(fields).toMatchObject({
      memoryRightBefore: 0,
      memoryContinues: true,
      memoryView: REDRAW_CAMERAS[0],
      memoryOthersOnly: undefined,
    });
    const s = { ...b[2], ...fields };
    const clause = memoryClause(s);
    expect(clause).toMatch(/The first reference image is the earlier picture this one CONTINUES — the same moment/);
    expect(clause).toMatch(/the same clothes and the very same objects, a thing in someone's hand the same thing/);
    expect(clause).toContain(`Camera position for THIS picture: ${REDRAW_CAMERAS[0]} — clearly different from the reference's.`);
    expect(clause).toContain("The last reference image is the host, only for how they look.");
    expect(clause).not.toMatch(/RIGHT BEFORE/);
    expect(buildStillPrompt(s)).toContain(clause);
    // Pictures drawn from scene 15 are drawn one after another, each compared with the others.
    expect(varietyLanes(s)).toEqual(["from:15"]);
  });

  it("a pass keeps its answers only while it reads the film; a call after it reads the film afresh", () => {
    const b = job413();
    attachMemory(b, []);
    expect(memoryView(b[2])).toBe(REDRAW_CAMERAS[0]);
    b[2].showSubject = b[2].visualPrompt = "a dog asleep on the porch steps";
    expect(keylessContinued(b, b[2])).toBeUndefined();
    attachMemory(b, []);
    expect(memoryView(b[2])).toBeUndefined();
  });

  it("drawn with nobody in it, the clause takes the things alone and no person from the reference", () => {
    const s = {
      ...job413()[2],
      memoryRefUrls: ["https://r2/413/still-src-15.png"],
      memoryRightBefore: 0,
      memoryContinues: true,
      memoryView: REDRAW_CAMERAS[0],
    } as StoryboardScene;
    const nobody = continuedMomentClause({ ...s, humanPresent: false, brollHostRef: undefined, brollHostLook: undefined });
    expect(nobody).toMatch(/the very same objects, and no person or hand from it/);
    expect(nobody).not.toMatch(/clothes|the host/);
    // Not a continuation (no `memoryContinues`): nothing to say.
    expect(continuedMomentClause({ ...s, memoryContinues: undefined })).toBe("");
  });

  it("405-17: a partner that is no memory of it is waited for too — only while the near-copy check runs", async () => {
    // "a tabby cat's white-socked paw stepping across the bed sheets" (the cat's paws) is marked to
    // continue, and its words are closer to the list item right before it (tabby, cat, bed) than to
    // scene 13, the wide bedroom (cat, bed): it continues the item, a picture of another key thing, so
    // no memory of it — only the near-copy check lays the two side by side.
    const run = async (variety: boolean) => {
      if (variety) delete process.env.PICTURE_VARIETY;
      else process.env.PICTURE_VARIETY = "0";
      const b = [
        pic(13, "wide view of bedroom at night with cat on the bed", { keyThing: "cat" }),
        pic(16, "a small tabby cat standing on the bed at night, ears forward, looking toward the pillows", {
          keyThing: "cat",
          listCut: true,
        }),
        pic(17, "a tabby cat's white-socked paw stepping across the bed sheets", { keyThing: "cat's paws", sameShot: true }),
      ];
      attachMemory(b, b);
      expect(memorySourcesFor(b, b[2])).toEqual([]);
      expect(nearCopyPartner(b[2])).toBe(b[1]);
      let done = false;
      const waiting = memoryFor(b[2], 5_000).then(m => ((done = true), m));
      await new Promise(r => setTimeout(r, 20));
      const before = done;
      b[1].pictureUrl = "https://r2/405/still-src-16.png";
      pictureSettled(b[1]);
      pictureSettled(b[0]);
      expect((await waiting).urls).toEqual([]);
      return before;
    };
    expect(await run(true)).toBe(false);
    expect(await run(false)).toBe(true);
  });
});
