/**
 * PICTURE MEMORY (2026-09-30, the operator: "if we are going scene to scene like a different pov,
 * we can show the same one, like it can have a memory, just a different angle … the same heater").
 * Every picture is drawn from words alone, so Frederick's heater at 0:45 was a different heater
 * from the one at 0:20. A picture of a KEY THING (`scene.keyThing`, from the shot list) is now
 * drawn FROM the earlier pictures of that thing: the first one (its memory) and the latest one
 * before it (so a before → during → after is the same piece further along). Film order is not build
 * order — a build video opens on the finished piece — so a picture of a thing being made
 * (`buildStage`) is drawn only from pictures of it at the same or an earlier stage. Pictures are made in
 * parallel, so a picture whose memory is still being made in this pass waits for it —
 * `MEMORY_WAIT_MS` at most, then it is drawn from words as before. Waits only ever point to an
 * EARLIER scene, and the dispatcher hands scenes out in film order, so the earliest waiting scene's
 * memory is always already running: nothing can wait on itself.
 */
import { insideView } from "./cutOpen";
import { PART_VIEW } from "./namedLooks";
import type { KeyThing, MemoryRef, PlaceLook, StoryboardScene, ThingLook } from "@shared/types";
import { nearCopyCameraIndex, REDRAW_CAMERAS } from "./pictureVariety";
import {
  BUILD_STAGES,
  anotherOfItsKind,
  isPersonLine,
  isViewerLine,
  keyThingsIn,
  namesDevice,
  nearlySameSubject,
  othersOfKindIn,
  repeatsTopic,
  sameSubject,
  saysAbsent,
  showsScreen,
  topicWords,
  viewIndexOf,
  withoutPersonLines,
} from "./shotList";
import { namesSomeone } from "./hostLook";

/** The longest a picture waits for its memory before it is drawn from words alone. */
export const MEMORY_WAIT_MS = 8 * 60_000;

/** A picture others are drawn FROM: any drawn cutaway, the QR background included. */
const source = (s: StoryboardScene) => !s.hostPresent && !s.coverHero && !s.assetImageUrl;
/**
 * A picture drawn from memory: any source, and a split screen's panel too (Hank's job 258: the
 * "that's the whole build" split showed a square holder unlike the one built). A split is never a
 * SOURCE — its panel is drawn after the host take, far later than the b-roll that would wait on it.
 */
const drawn = (s: StoryboardScene) => source(s) || (!!s.hostPresent && !!s.splitVisual);

/**
 * The camera positions a memory picture is drawn from, in turn — never the memory picture's own
 * (that one is drawn as described): Frederick's job 257 came back with the same framing four times.
 */
export const MEMORY_VIEWS = [
  "a close view of one part of it, filling most of the frame",
  "seen from a few steps further back, with the place around it in view",
  "seen from the other side",
  "seen from above, looking down on it",
  "seen from low down, close to its own level",
] as const;

/**
 * The earlier cutaways `s` is drawn from: the first picture of its key thing (the memory) and the
 * latest one before `s` when that is a different picture, then the memory of every other key thing
 * in it — at most `MAX_MEMORY_REFS`. A list item after its list's group picture is drawn from that
 * picture (`listSetFor`), a picture gathering the list just said from its items' pictures
 * (`listGroupFor`), a picture of no key thing from the one it continues (`keylessContinued`). Empty
 * when nothing earlier shows what it shows. Pure — unit-tested.
 */
export function memorySourcesFor(
  scenes: StoryboardScene[],
  s: StoryboardScene
): StoryboardScene[] {
  // A list item after a group picture of its list is drawn FROM that group picture, so the
  // close-up is the same machine, cutter or pile as in the group (`listSetFor`).
  const set = listSetFor(scenes, s);
  if (set) return [set];
  // A picture that GATHERS the items of the list just said is drawn from each item's own picture
  // (`listGroupFor`, job 414 scene 8).
  const group = listGroupFor(scenes, s);
  if (group) return group;
  // A picture of NO key thing is drawn from the picture it CONTINUES, and only that (`keylessContinued`).
  if (!s.keyThing) {
    const from = source(s) ? keylessContinued(scenes, s) : undefined;
    return from ? [from] : [];
  }
  if (!drawn(s)) return [];
  // A LIST ITEM is its own thing: it is drawn from a key thing's memory only when its OWN words name
  // that thing, or it is a part of it (`partOf`). Dale's job 397: "Smalls, about $10 to $40.
  // Coasters, ornaments, small cutting boards." — the coasters and the ornaments both inherited the
  // pile of small pieces as their key thing, were drawn from that pile picture, and came back as the
  // same picture twice. Only the key thing it INHERITED lends nothing: the other key things its own
  // description names still lend theirs, below (job 412 scene 4, "ankle," keeps the bed).
  const own = ownKeyThing(s);
  // A SCREEN picture gets its item's memory for what is ON the screen only (`SCREEN_ITEM_VIEW`): with
  // none, Dale's bookcase listing showed four random items (job 306); told to draw "the SAME" board
  // as an object, the picture maker built the tablet out of it (job 295). A screen is still never a
  // memory SOURCE (below).
  const i = scenes.indexOf(s);
  if (i <= 0) return [];
  // A list item is never drawn from another item's picture: each item is its own thing — but a STEP
  // is drawn from the steps before it in its own list (`sameSteps`): they are done to one thing; and an
  // item of ANOTHER list lends only the thing its own words name (below).
  // …nor is a screen ever a memory SOURCE: the thing on it is a small photo, not the thing.
  // …nor a picture FURTHER ALONG than this one (`laterStage`): build videos open on the finished
  // piece, and Hank's job 268 drew "hands drilling a hole into a charred cedar block" from the hook's
  // "charred cedar incense holder …, finished and oiled". That holds for every source, whatever key
  // thing it was filed under — Ruth's job 348 drew a strip being folded round its cord (key thing:
  // the cord) from a finished bowl filed under the tin of squares.
  // …nor a picture whose own check said the thing is not in it (`memoryUnfit`): stored films had 22
  // first pictures copied after failing their last check, 122 later pictures drawn from them.
  // …nor a picture whose description asks to see a solid thing from inside or cut open
  // (`insideView`): job 403's trapway was first asked for as "close view of the toilet's internal
  // porcelain S-shaped trapway channel", came back a fixture sawn in half, and every later picture of
  // it was drawn from that cut — the host lifting a sliced toilet off its flange (scene 23), an auger
  // pushed through the cut wall (scene 22). A cutaway is never what a real-world shot copies.
  // …nor, for the picture behind the big QR card, a picture with someone in it (`withSomeone`): job
  // 402 scene 33 drew its cookie packet from scene 29's, a hand passing the packet to a passenger, and
  // the hand came along under the card — for 19.6 s a hand held the QR code.
  const backdrop = !!s.qrHero && !s.coverHero && !s.assetImageUrl && !s.hostPresent;
  const fit = scenes
    .slice(0, i)
    .filter(
      x =>
        source(x) &&
        !isScreen(x) &&
        !(s.listCut && x.listCut && sameList(scenes, x, s) && !sameSteps(scenes, x, s)) &&
        !laterStage(x, s) &&
        !x.memoryUnfit &&
        !insideView(x.showSubject) &&
        !insideView(x.visualPrompt) &&
        !(backdrop && withSomeone(x))
    );
  const before = fit.filter(x => !(s.listCut && x.listCut && !sameSteps(scenes, x, s)));
  const out: StoryboardScene[] = [];
  const add = (x: StoryboardScene | undefined) => {
    if (x && !out.includes(x) && out.length < MAX_MEMORY_REFS) out.push(x);
  };
  // Its own thing: the memory (`memoryOf`) and the latest picture before it. Never a PLACE or the
  // weather (`lendsNoPicture`): job 411's lawn handed scene 2's whole yard to every picture set on it.
  // Never the DEVICE a screen picture is filed under: its references are what is ON the screen, and the
  // device is "an ordinary real device" (`SCREEN_ITEM_VIEW`) — job 412 scene 15, the step "run it back,"
  // on the phone's screen, would have been handed the phone's own picture as "the item for sale".
  if (own && !(isScreen(s) && namesDevice(own))) {
    const same = lendsNoPicture(own) ? [] : before.filter(x => shows(x, own));
    add(memoryOf(same, own));
    // …the latest before it, or — marked to continue — the picture its topic continues (`topicPictureBefore`):
    // job 412 scene 8 ("cat continuing steady walk across owner's body in bed") came after a list cut out
    // of its beat, "ankle, knee, hip, ribs", and was drawn from the "ribs" close-up as its latest picture
    // and as the one it continued, so its camera and its checks looked at a paw while it copied scene 3.
    const chain = s.sameShot && !s.listCut ? topicPictureBefore(scenes, s) : undefined;
    add(chain && same.includes(chain) ? chain : same[same.length - 1]);
  }
  // Every other key thing in it: that thing's memory (the heater beside the mattress) — a place's
  // never (job 411 scene 16: "a green lawn in a Gulf Coast yard" drawn from the northern lawn in snow).
  // A LIST ITEM KEEPS THEM whatever its own key thing lends: job 413 scene 31, the step "drain it
  // outside," filed under the gas can, "the host's hands draining gasoline from the mower into the red
  // gas can", gave up the mower's memory with the can's, was drawn from no picture at all and came back
  // with a black-deck mower where every other mower picture had the faded red deck; job 412 scene 4,
  // "ankle," under the cat it only inherited, keeps the bed of scene 2. Never from a picture that shows
  // the thing an item only inherited, though: handed the pile, a coaster is drawn as the pile (Dale's
  // job 397).
  // A list item showing a DEVICE (a phone, a tablet, a laptop, its screen) whose own thing lends it
  // nothing — one it only inherited, or the device itself — keeps only the device's memory: anything
  // else it names may be what the screen shows, and it has no screen view to say so (`memoryViewFor`).
  // Asked of the device in its words, not of `isScreen`: "the wood-grain tablet …, its glowing screen
  // showing an Etsy-style white page: a grid of square product photos with the walnut and maple board"
  // names no app or listing. Job 295 scene 4, that "Etsy," filed under the device with the cutting board
  // in its words, would be told "draw the SAME cutting board … from a different camera position" — the
  // instruction under which the picture maker built the tablet out of the board (job 295); job 412
  // scene 15, the step "run it back," on the phone's screen, would be handed the nightstand, the cat and
  // the bed as "the item for sale". Before list items kept the other things' memory, both had none.
  // An item of ANOTHER list lends a list item the thing its own words name, as any picture of it would:
  // job 414 scene 20, the step "and rived the boards along those same lines," levering a froe, has the
  // froe's item picture ("a froe,", scene 6) to follow when the froe's next picture (scene 17) failed its
  // check — it was drawn from none and came back an all-metal L. Never an item of its own list (above).
  const onDevice =
    !!s.listCut &&
    (!own || namesDevice(own)) &&
    namesDevice(s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "");
  for (const t of s.otherKeyThings ?? []) {
    // Never one its own words say is NOT there (`saysAbsent`): job 368 scene 23, "dim coop interior with
    // hens roosted and no feeder present", was handed the feeder's first picture.
    if (lendsNoPicture(t) || (onDevice && !namesDevice(t)) || saysAbsent(pictureWords(s), t)) continue;
    const lends = (x: StoryboardScene) => before.includes(x) || namesItemThing(x.scriptText ?? x.narration, t);
    add(memoryOf(fit.filter(x => lends(x) && shows(x, t) && (!!own || !shows(x, s.keyThing!))), t));
  }
  return out;
}

/**
 * Whether picture `x` is an earlier STEP of the same spoken list of steps as `s` — every picture from
 * `x` to `s` is an item of that list. Steps are done to one thing, so one is drawn from the steps
 * before it (job 413 scenes 31-32: the gas can drained into, then stored sealed). Pure.
 */
function sameSteps(scenes: StoryboardScene[], x: StoryboardScene, s: StoryboardScene): boolean {
  return x.listKind === "steps" && s.listKind === "steps" && sameList(scenes, x, s);
}

/** Whether picture `x` is an earlier item of the same spoken list as `s`: every picture from `x` to `s` is a list item. Pure. */
function sameList(scenes: StoryboardScene[], x: StoryboardScene, s: StoryboardScene): boolean {
  const [a, b] = [scenes.indexOf(x), scenes.indexOf(s)];
  if (a < 0 || a >= b) return false;
  for (let k = a; k <= b; k++) if (!scenes[k].listCut) return false;
  return true;
}

/**
 * THE PICTURE A TOPIC CONTINUES, BY ITS CHAIN (round 14, job 412 scene 8). A picture marked to continue
 * (`sameShot`) continues the last picture of its topic — not whatever sits right before it. A spoken
 * list cut out of the middle of one beat (`applySpokenLists`) leaves the beat's later part after the
 * list: "She walks the full length of you, | ankle, | knee, | hip, | ribs, | steady as a tightrope
 * walker…" — scene 8 continues scene 3, and the "ribs" close-up right before it is an insert. So the
 * walk back skips the list's items and its group picture (`listSet`), and an operator's image or a book
 * cover set in between; it stops at a host take or a split screen, where a topic ends
 * (`breakTopicsAtHostTakes`). A list item keeps the picture right before it: items are never inserts in
 * their own list.
 * The list's LAST ITEM is still what it continues when the picture's words are about that item, not
 * the picture before the list (`sharedWords`: no fewer of its words). Job 352 scene 170 ("…a rough oak
 * board's side edge with a strip of rough brown-grey bark…", "which is bark edge left along the side")
 * carries on from the item "or a little wane," described as nearly the same close-up; paired with
 * the cull bins before the list, the one copy a viewer could see would go unchecked — so would job 352
 * scene 117 after the end-grain close-up, and job 392 scene 32 after the necklace held to the window.
 * Scene 8 shares five words with scene 3 and two with the "ribs" close-up. With no picture before the
 * list to continue, the last item is it, as before. Undefined when what it reaches is not a drawn
 * full-frame picture. Pure.
 */
export function topicPictureBefore(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0) return undefined;
  let j = i - 1;
  let item: StoryboardScene | undefined;
  if (!s.listCut)
    while (j >= 0 && (scenes[j].listCut || scenes[j].listSet || scenes[j].assetImageUrl || scenes[j].coverHero)) {
      if (!item && scenes[j].listCut && source(scenes[j])) item = scenes[j];
      j--;
    }
  const x = j >= 0 ? scenes[j] : undefined;
  const topic = x && source(x) ? x : undefined;
  if (!item) return topic;
  return topic && sharedWords(topic, s) > sharedWords(item, s) ? topic : item;
}

/** Words that say nothing of what a picture is about: framing, and the little words. */
const FRAMING_WORDS = new Set(
  (
    "a an the of in on at to by for from into onto with and or its it his her their this that one " +
    "up close closer view wide seen shot picture frame filling detail"
  ).split(" ")
);

/** A description's subject words, any view taken off, each cut to its stem ("walking" = "walk"). */
const subjectStems = (text: string): Set<string> =>
  new Set(
    topicWords(text)
      .toLowerCase()
      .replace(/['’]s\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(w => w && !FRAMING_WORDS.has(w))
      .map(w => {
        const stem = w.replace(/(?:ing|ed|s)$/, "");
        return stem.length >= 3 ? stem : w;
      })
  );

/** How many of `s`'s subject words picture `x`'s description shares too (`subjectStems`). Pure. */
export function sharedWords(x: StoryboardScene, s: StoryboardScene): number {
  const theirs = subjectStems(pictureWords(x));
  let n = 0;
  subjectStems(pictureWords(s)).forEach(w => theirs.has(w) && n++);
  return n;
}

/**
 * A CONTINUATION OF NO KEY THING IS DRAWN FROM WHAT IT CONTINUES (round 14, job 413 scenes 15-16). "the
 * host on the phone at the workbench calling the city office" ran past its limit and its second part
 * repeated the words with a view ("…, a close-up of one detail of it filling the frame"). Every
 * continuation safeguard asked for a key thing, and the call named none: no reference to the picture it
 * continued, no concrete camera, and nothing made it wait for that picture — the two were drawn at once.
 * It came back as the same over-the-shoulder shot, and the phone was a corded desk phone in one and a
 * smartphone in the other, in the same call. The picture it continues is the latest earlier picture
 * whose words it repeats once any view is taken off (`repeatsTopic`), else — marked to continue — the
 * last picture of its topic (`topicPictureBefore`). It lends how the people and things in it look, never
 * its framing (`continuedMomentClause` in longformVideo.ts).
 * Never for a list item (each is its own thing), a screen or a split panel. Never from a picture no other
 * picture is drawn from: a screen, one further along, one whose check said its subject is missing, one
 * seen cut open, one filed under a place (a place lends no picture, `lendsNoPicture`), or — behind the QR
 * card — one with someone in it. Never from a picture of SOMEONE ELSE (`samePeople`): job 409 scene 19,
 * "the host speaking thoughtfully at his desk in the study", is marked to continue past a list to scene
 * 14, "a person in their sixties sitting alone in the quiet study" — lent that picture, the host would
 * be drawn in the other person's clothes. Nor from one showing a key thing this picture names only as
 * ANOTHER of its kind (`othersOfKind`): a wild cat is never drawn from the pet's picture. Pure.
 */
export function keylessContinued(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  const memo = keylessMemo?.scenes === scenes ? keylessMemo.of : undefined;
  if (memo?.has(s)) return memo.get(s);
  const out = findKeylessContinued(scenes, s);
  memo?.set(s, out);
  return out;
}

/**
 * `keylessContinued`'s answers while one `attachMemory` pass reads its film. Its sources, camera,
 * partner and own memory each ask again, and every answer is a walk back over the whole film: on a
 * 496-picture film of no key things (job 159) one pass blocked the server for 3.5-4 s where it had
 * taken 0.9 s (1.3 s with this). Read only inside that pass, whose film does not change while it
 * runs; cleared after.
 */
let keylessMemo: { scenes: StoryboardScene[]; of: Map<StoryboardScene, StoryboardScene | undefined> } | undefined;

function findKeylessContinued(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || s.keyThing || s.listCut || !source(s) || isScreen(s)) return undefined;
  const backdrop = !!s.qrHero && !s.coverHero && !s.assetImageUrl && !s.hostPresent;
  const another = (s.othersOfKind ?? []).map(o => o.name).filter(t => !s.otherKeyThings?.includes(t));
  const lends = (x: StoryboardScene) =>
    source(x) &&
    !isScreen(x) &&
    !laterStage(x, s) &&
    !x.memoryUnfit &&
    !insideView(x.showSubject) &&
    !insideView(x.visualPrompt) &&
    !lendsNoPicture(x.keyThing) &&
    !(backdrop && withSomeone(x)) &&
    samePeople(x, s) &&
    !another.some(t => shows(x, t));
  const words = pictureWords(s);
  // The words first: nearly every picture fails there, before the patterns `lends` reads.
  for (let j = i - 1; j >= 0; j--) {
    const x = scenes[j];
    if (source(x) && repeatsTopic(pictureWords(x), words) && lends(x)) return x;
  }
  const chain = s.sameShot ? topicPictureBefore(scenes, s) : undefined;
  return chain && lends(chain) ? chain : undefined;
}

/**
 * Who a picture shows by name: someone else (`otherPerson`, in its own words), the host at work
 * (`brollHostLook` / `brollHostRef`), or undefined — nobody, or someone it does not say.
 */
const whoIsIn = (x: StoryboardScene): string | undefined =>
  x.otherPerson?.trim()
    ? `other:${x.otherPerson.trim().toLowerCase()}`
    : x.brollHostLook || x.brollHostRef
      ? "host"
      : undefined;

/**
 * Whether two pictures can be one moment for the people in them: both name the same person, or at most
 * one of them names anyone. The host and someone else, or two different people, never are (job 409
 * scenes 14 and 19). Pure.
 */
export function samePeople(a: StoryboardScene, b: StoryboardScene): boolean {
  const [x, y] = [whoIsIn(a), whoIsIn(b)];
  return !x || !y || x === y;
}

/** The words a picture is drawn by: a split's panel description, else its own. */
const pictureWords = (s: StoryboardScene) =>
  s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "";

/**
 * A picture with someone in it: marked so (the host at work, someone else, any person) or naming
 * someone or a hand in what it was drawn by (`namesSomeone`). A reference picture of a thing in
 * someone's hands brings the hands.
 */
const withSomeone = (x: StoryboardScene) =>
  !!x.humanPresent ||
  !!x.brollHostLook ||
  !!x.otherPerson ||
  namesSomeone(x.showSubject) ||
  namesSomeone(x.visualPrompt);

/**
 * THE PICTURE RIGHT BEFORE IS A MEMORY, NEVER A TEMPLATE (2026-10-18, job 399 scenes 16-17): "hands
 * pouring soda into an ice-filled plastic cup at the cart" was the memory of the next picture, "a
 * small plastic cup barely filled with ginger ale on a tray table". Handed the picture just shown, the
 * picture maker came back with the same hands tipping the same can into the same cup at the same
 * angle — only the background changed, one picture for 27 s. Told "the same cup, from another spot",
 * it kept everything but the spot. So when the picture shown right before `s` is one of `s`'s memory
 * pictures and is about something else, `s` is told to take only the thing's look from it
 * (`rightBeforeClause`), and the same-thing check compares `s` with THAT picture. "Something else" is
 * told by the words alone, so it also takes the same thing described anew (job 397 scenes 28-29: the
 * board close up on the bench, then leaning against the wall) — where a new photo is right too.
 *
 * "Right before" skips full-frame host takes (`lastPictureBefore`): picture, host, picture reads as
 * the same picture twice just the same (job 404 scenes 5-7: the robin on the lawn, the host's
 * introduction, the robin on the lawn again a little closer).
 *
 * Returns that picture, or undefined: when the picture before is not one of its memories, when `s`
 * continues it (that is `continuedPicture`'s), and for a list item drawn from its list's group
 * picture or a screen, whose framing is set apart already (`SET_ITEM_VIEW`, `SCREEN_ITEM_VIEW`).
 * Pure.
 */
export function rightBeforeToRecompose(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || s.sameShot || listSetFor(scenes, s) || isScreen(s)) return undefined;
  const before = lastPictureBefore(scenes, s);
  if (!before || !sources.includes(before)) return undefined;
  const [a, b] = [pictureWords(before), pictureWords(s)];
  if (!a.trim() || !b.trim() || sameSubject(a, b) || nearlySameSubject(a, b) || repeatsTopic(a, b)) return undefined;
  return before;
}

/**
 * The picture a viewer saw last before `s`: the one right before it, or — when full-frame host takes
 * sit between — the last picture before them. A split screen stops the walk: its panel is a picture
 * the viewer sees. Undefined when that is not a drawn full-frame picture. Pure.
 */
export function lastPictureBefore(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  let i = scenes.indexOf(s) - 1;
  while (i >= 0 && scenes[i].hostPresent && !scenes[i].splitVisual) i--;
  const p = i >= 0 ? scenes[i] : undefined;
  return p && source(p) ? p : undefined;
}

/**
 * A CONTINUATION IS A NEW PHOTO OF THE SAME THING (2026-10-18, the review of jobs 401-405: 15
 * near-copies). A topic that runs past its limit, a split picture's later part, or the planner
 * repeating its own words is drawn as "the same words + a view" (`OTHER_VIEWS`) FROM the picture
 * it continues — and the reference pinned the composition while the stock view phrase moved
 * nothing: job 405 scene 8 (the cat lowering its face to the sleeper, "a close-up of one detail of
 * it") came back at scene 7's distance and framing, scene 22 (the cat at the window, close up) was
 * scene 21 a little tighter, job 401 scene 3 was scene 2's over-the-shoulder card shot with other
 * cards in the hands, and job 403 scene 14 was scene 10's pipe run under the house a little closer.
 * So a continuation is told what a picture drawn from the one just shown is told (`rightBeforeClause`):
 * the picture it continues lends only the thing's look, with a concrete camera (`REDRAW_CAMERAS`,
 * `memoryViewFor`), and the same-thing check lays it beside THAT picture (`sameThingReference`),
 * where it used to be laid beside the thing's first picture (scene 22 was compared with scene 7, the
 * cat on the sleeper's chest, and passed).
 *
 * Returns the latest of `s`'s memory pictures whose words `s` repeats once any view is taken off
 * (`repeatsTopic` — job 403 scene 14 repeats scene 10, 11 s and three pictures later), else, for a
 * picture marked to continue (`sameShot`) whose words were rewritten, the last picture of its topic
 * (`topicPictureBefore` — past a list cut out of its beat, job 412 scene 8). A picture of no key thing
 * has that one picture as its memory (`keylessContinued`). Undefined for a list item drawn from its
 * group picture and a screen, whose framing is set apart already. Pure.
 */
export function continuedPicture(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || listSetFor(scenes, s) || isScreen(s)) return undefined;
  const words = pictureWords(s);
  const byWords = sources
    .filter(x => repeatsTopic(pictureWords(x), words))
    .sort((a, b) => scenes.indexOf(b) - scenes.indexOf(a))[0];
  if (byWords) return byWords;
  const before = s.sameShot ? topicPictureBefore(scenes, s) : undefined;
  return before && sources.includes(before) ? before : undefined;
}

/**
 * What `s` is drawn FROM as the picture it must not repeat: the picture it continues
 * (`continuedPicture`, `continues: true`), else the one shown right before it about something else
 * (`rightBeforeToRecompose`). Pure.
 */
export function recomposeFrom(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): { from: StoryboardScene; continues: boolean } | undefined {
  const cont = continuedPicture(scenes, s, sources);
  if (cont) return { from: cont, continues: true };
  const before = rightBeforeToRecompose(scenes, s, sources);
  return before ? { from: before, continues: false } : undefined;
}

/**
 * The picture the near-copy check ALWAYS lays beside `s`, whatever the fingerprints say
 * (`nearCopyCandidates`' `always`): what it is drawn from as the picture it must not repeat
 * (`recomposeFrom`), else — a picture with no memory link — the latest earlier picture whose words it
 * repeats, else, marked to continue (`sameShot`), the last picture of its topic. That is the check a
 * copy drawn from WORDS still meets: job 405 scene 8 and job 401 scenes 3 and 5 copied their memory
 * twice, were drawn from words with no reference, and shipped as the same composition unchecked.
 * Never a split panel: a split is never a memory source, and panels meet the near-copy check through
 * their fingerprints (`nearCopyCandidates`). Marked to continue, it is the last picture of its topic
 * (`topicPictureBefore`), never a list item cut out of the beat in between: job 412 scene 8 was paired
 * with the "ribs" close-up and shipped as scene 3's shot again, unflagged. Pure.
 */
export function nearCopyPartnerFor(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const i = scenes.indexOf(s);
  if (i <= 0 || !source(s) || listSetFor(scenes, s) || isScreen(s)) return undefined;
  const re = recomposeFrom(scenes, s, sources);
  if (re) return re.from;
  const words = pictureWords(s);
  for (let j = i - 1; j >= 0; j--) {
    const x = scenes[j];
    if (source(x) && !isScreen(x) && repeatsTopic(pictureWords(x), words)) return x;
  }
  return s.sameShot ? topicPictureBefore(scenes, s) : undefined;
}

/**
 * Of `continuedPicture`, the picture `s` continues by REPEATING its words, any view aside: nothing in
 * its words sets it apart, so only a concrete camera can (`continuationCameraIndex`). A picture
 * marked to continue (`sameShot`) whose words were rewritten keeps the framing its own words ask for:
 * job 398 scene 10, "close view of hands pressing a thin pale pine strip into the half-depth notches
 * of a crossing strip", marked to continue scene 9's lattice lying flat on the bench, was drawn close
 * up and would have been told "seen from much further back … the subject small in it". It is still
 * drawn from the picture it continues as one (`memoryContinues`) and compared with it. Pure.
 */
export function repeatedPicture(
  scenes: StoryboardScene[],
  s: StoryboardScene,
  sources: StoryboardScene[] = memorySourcesFor(scenes, s)
): StoryboardScene | undefined {
  const from = continuedPicture(scenes, s, sources);
  return from && repeatsTopic(pictureWords(from), pictureWords(s)) ? from : undefined;
}

/**
 * The camera a continuation that repeats its picture's words (`repeatedPicture`) is drawn from, as
 * an index into `REDRAW_CAMERAS` (one per `OTHER_VIEWS` entry, same order): the one its own words'
 * view names, else the next after the camera of the picture it repeats — and never that picture's
 * own. Job 405 scenes 22 and 24 both said "a close-up of one detail of it" (a host glimpse cut one
 * picture in two), were both drawn close up from the same reference, and came back as one picture
 * twice. Any other picture reads its own view (-1 for none).
 * A picture of NO key thing that continues one with words of its own (`keylessContinued`) has no memory
 * view to fall back on (`memoryViewFor`), and drawn from that picture with no camera it would copy its
 * framing, so it too takes a concrete camera, never the one of the picture it continues: the view its
 * own words name, else — a small or close-framed subject (`smallSubject`) — the close-up in turn, else
 * the other side (`SIDE_CAMERA`), which keeps a whole subject whole where a close-up of one detail
 * would leave most of what its words describe out. Pure.
 */
export function continuationCameraIndex(scenes: StoryboardScene[], s: StoryboardScene, depth = 0): number {
  const own = viewIndexOf(pictureWords(s).replace(/[\s.]+$/, ""));
  const from = depth < 8 ? repeatedPicture(scenes, s) : undefined;
  if (!from) {
    const cont = depth < 8 && !s.keyThing ? continuedPicture(scenes, s) : undefined;
    if (!cont) return own - 1;
    const was = continuationCameraIndex(scenes, cont, depth + 1);
    const small = smallSubject(s);
    if (own > 0) return own - 1 !== was ? own - 1 : nearCopyCameraIndex(1, was, small);
    if (small || was === SIDE_CAMERA) return nearCopyCameraIndex(1, was, small);
    return SIDE_CAMERA;
  }
  const prev = continuationCameraIndex(scenes, from, depth + 1);
  const n = REDRAW_CAMERAS.length;
  let k = own > 0 ? own - 1 : (prev + 1) % n;
  if (k === prev) k = (k + 1) % n;
  return k;
}

/** Where the camera from the other side ("seen from the other side, from low down") is in `REDRAW_CAMERAS`. */
const SIDE_CAMERA = REDRAW_CAMERAS.findIndex(c => /\bother side\b/.test(c));

/** What the still loop does with the same-thing check's answer on a memory picture (`sameThingMove`). */
export type SameThingMove = "pass" | "redraw" | "words" | "flag";

/**
 * WHAT THE SAME-THING CHECK'S ANSWER DOES (`scanSameThing`). `before`: what it refused the draw
 * before this one for, if anything.
 * - The first answer: a different thing, or a copy of the reference's framing → "redraw" from memory.
 * - After a DIFFERENT thing it is not asked again (the caller skips it): SAMENESS BEATS THE ANGLE —
 *   the one redraw from memory is kept, since a fallback drawn from words gave Frederick's job 259 a
 *   different heater and mattress.
 * - After a COPY, still a copy → "words": a copy repeats a picture the viewer has just seen, so it is
 *   drawn from words with the thing's written look rather than kept (job 399 scene 17). Now a
 *   different thing → "flag": kept, as before, but on the record — the check said so.
 * A close-up of one part (`partOf`) is a different view of the whole by design: only a copy counts.
 * Pure.
 */
export function sameThingMove(
  verdict: { same: boolean; copy: boolean },
  before: "copy" | "different" | undefined,
  partOf = false
): SameThingMove {
  if (before === "different") return "pass";
  const different = !verdict.same && !partOf;
  if (verdict.copy) return before === "copy" ? "words" : "redraw";
  if (different) return before === "copy" ? "flag" : "redraw";
  return "pass";
}

/**
 * THE MEMORY IS A PICTURE ABOUT THE THING: the earliest of `pictures` whose own key thing is `thing`
 * and that is about it (`isSubject`), else the earliest. The first picture to show a thing is often
 * a wide shot with it small — Dale's job 352 drew every later benchtop planer from "garage workshop
 * with table saw and benchtop planer along back wall", while the very next picture was "man's hands
 * feeding a rough-sawn board into a benchtop planer" (stored films: 123 of 467 memories were not
 * about their thing, copied 390 times). NEVER A PICTURE THAT DOES NOT SHOW IT (`shows`), the earliest
 * included: job 416's robin had no earlier picture about it, so the earliest it was filed beside — the
 * empty lawn whose words say "no robins visible" — was its memory, and every later robin picture was
 * that lawn from that camera spot. With none that shows it there is no memory: the picture is drawn
 * from the thing's written look (`keyThingLookFor`). Pure.
 */
function memoryOf(pictures: StoryboardScene[], thing: string): StoryboardScene | undefined {
  const seen = pictures.filter(x => shows(x, thing));
  return seen.find(x => ownKeyThing(x) === thing && isSubject(x, thing)) ?? seen[0];
}

/** Size and amount words: they say nothing about WHICH thing is meant. */
const NOT_A_NAME_WORD = new Set([
  "small", "smaller", "little", "big", "bigger", "large", "larger", "tiny", "huge", "few", "many",
  "some", "one", "two", "three", "four", "five", "old", "new", "the", "and", "with", "for",
]);

/**
 * Whether a line's own words name key thing `thing`: a word of its name (not a size or amount word),
 * singular or plural, appears in the line. "small cutting boards" names "walnut and maple cutting
 * board"; "Coasters," does not name "small wood pieces pile". Pure.
 */
export function wordsName(line: string, thing: string): boolean {
  const base = (w: string) => w.replace(/(?:es|s)$/, "");
  const have = new Set(nameWords(line).map(base));
  return nameWords(thing).some(w => !NOT_A_NAME_WORD.has(w) && have.has(base(w)));
}

/** A list item as said: "and a stack of sandpaper." → "a stack of sandpaper". */
const itemWords = (t: string) =>
  t.trim().replace(/^(?:and|or|plus|then)\s+/i, "").replace(/[\s,.;:!?—–-]+$/, "").trim();

/**
 * A list item's own words and the other items of its list (the run of list items around it), or
 * undefined for a picture that is not one of two or more items. Pure.
 */
export function listItemsAround(
  scenes: StoryboardScene[],
  s: StoryboardScene
): { own: string; others: string[] } | undefined {
  if (!s.listCut) return undefined;
  const i = scenes.indexOf(s);
  let a = i;
  let b = i;
  while (a > 0 && scenes[a - 1].listCut) a--;
  while (b < scenes.length - 1 && scenes[b + 1].listCut) b++;
  const own = itemWords(s.scriptText ?? "");
  const others = scenes
    .slice(a, b + 1)
    .filter(x => x !== s)
    .map(x => itemWords(x.scriptText ?? ""))
    .filter(t => t && t.toLowerCase() !== own.toLowerCase());
  return own && others.length ? { own, others } : undefined;
}

/**
 * The key thing picture `s` is about, by the rule above: a list item's inherited key thing counts
 * only when the item's own words name it or it is a part of it. The memory step and the picture
 * check both read it, so a coasters picture is neither drawn from nor held to the pile. Pure.
 */
export function ownKeyThing(s: StoryboardScene): string | undefined {
  if (!s.keyThing) return undefined;
  // A thing its own words say is NOT there is not what it is about (`saysAbsent`, job 416 scene 2):
  // neither drawn from that thing's pictures nor held to it by the check.
  if (saysAbsent(pictureWords(s), s.keyThing)) return undefined;
  // A STEP is about the thing it is done to, whatever its words call it ("oil it,", "store it
  // sealed,"): steps are done to ONE thing, never separate things like the items of a list of things.
  // Job 413 scenes 31-32, "drain it outside, store it sealed," — both filed under the gas can, neither
  // naming it — came back as two different cans, the first beside a black-deck mower where every other
  // picture had the faded red one. A step of making the thing is drawn only from pictures of it at the
  // same or an earlier stage (`laterStage`); a step with no stage builds nothing ("and read the label.")
  // and is drawn from the thing as it is.
  if (s.listCut && s.listKind === "steps") return s.keyThing;
  if (s.listCut && !s.partOf && !wordsName(s.scriptText ?? s.narration ?? "", s.keyThing)) return undefined;
  return s.keyThing;
}

/** Where a stage sits, earliest first; undefined for a picture with no stage. */
const stageRank = (s: StoryboardScene) =>
  s.buildStage ? BUILD_STAGES.indexOf(s.buildStage) : undefined;

/**
 * Whether picture `x` shows the thing being made FURTHER ALONG than picture `s` does — both must
 * carry a stage; a picture without one is never judged, so its memory is exactly as before. Pure.
 */
export function laterStage(x: StoryboardScene, s: StoryboardScene): boolean {
  const [a, b] = [stageRank(x), stageRank(s)];
  return a !== undefined && b !== undefined && a > b;
}

/** A picture of the thing being made before it is finished: the raw material, or partly made. */
export const beforeFinished = (s: StoryboardScene) =>
  s.buildStage === "material" || s.buildStage === "making";

/**
 * How a key thing is named to the picture check while something is still being made. Conditional,
 * because the stage belongs to the PICTURE and its key thing may be the bench or a tool it is made
 * with (stored step pictures were filed under "workbench", "oil finish rag", the sewing machine):
 * a workbench "not yet finished" would be failed for being a whole workbench.
 */
export const UNFINISHED_THING =
  "— when it is what is being made: as it is at this stage of being made (raw pieces or partly built, not yet finished)";

/**
 * The key things the picture check holds a picture to (`requiredThingsQuestion`): its own and every
 * other one in it. Before the thing is finished its own is named at that stage — told only "incense
 * holder", the check could fail a correct raw block being drilled as a different object where the
 * holder should be, and push the step back toward the finished piece (on stored films, step
 * pictures drawn from the finished piece were flagged "missing" 5 times in 31, every other
 * key-thing picture 92 in 1,396). Pure.
 */
export function requiredThingsFor(s: StoryboardScene): string[] {
  const own = ownKeyThing(s);
  // Never one its own words say is NOT there: job 416 scene 2, "empty backyard lawn …, no robins
  // visible", was held to the robin and its first check said "missing".
  const others = (s.otherKeyThings ?? []).filter(t => !saysAbsent(pictureWords(s), t));
  return [own && beforeFinished(s) ? `${own} ${UNFINISHED_THING}` : own, ...others].filter(
    (t): t is string => !!t
  );
}

/*
 * ONE LOOK PER KEY THING (2026-10-18). Every key thing has a look written from the script before
 * anything is drawn (`KeyThing.look`, the props list), but it reached the picture maker only through
 * the prompt writer: Ruth's job 305 drew its first straight-stitch machine from "a straight-stitch
 * machine, a rotary cutter and a mountain of scraps … at a kitchen table" — no colour, no material —
 * while the look said "small black and chrome sewing machine", and 5 later pictures were drawn from
 * that one. A picture drawn FROM memory has its thing's own earlier picture to follow, and a text
 * look beside that reference only sets up a conflict, so the look goes ONLY into a picture with no
 * picture of its own thing to follow (`keyThingLookFor`, `memoryFor`). It is cut down first: where
 * the thing sits belongs to the picture (581 of 1229 stored looks name a place — "sits centered on
 * work table" would put a work table into every picture of the machine), and so does how far along
 * it is.
 */

/** Verbs that say where a thing is kept or left: with a place word after them, always its place. */
const STORING =
  "sitting|sat|resting|rested|placed|kept|stored|stacked|piled|hanging|hung|leaning|leaned|propped|" +
  "standing|lying|laid|displayed|positioned|tucked|perched|parked|located|pushed|staged|grouped|" +
  "left|lined";
/** Verbs that also say how a part sits on the thing itself ("a felt dot centered on the bottom"). */
const ATTACHING =
  "set|mounted|centered|centred|fixed|pinned|tacked|nailed|tied|clipped|held|arranged|spread|" +
  "scattered|draped|folded|pressed";
/** Verbs that say where it is with no place word after them ("sits upright", "resting open"). */
const ALWAYS_PLACE = "sits|rests|hangs|stands|lies|leans|lives|waits|perches";
const STARTS_RESTING = `${ALWAYS_PLACE}|sitting|resting|hanging|standing|lying|leaning|propped|perched|parked|positioned|displayed|located`;
/** What follows a placing verb when it places ("set apart on", "clipped to", "lies flat under"). */
const PLACE_PREPS =
  "on|onto|in|inside|into|at|by|near|nearby|beside|next to|against|along|across|over|under|" +
  "underneath|beneath|below|above|behind|in front of|among|amid|within|around|outside|off|atop|" +
  "upon|to|from|up|down|together|apart|upright|flat|flush|evenly|loosely|neatly|tightly|closely|" +
  "directly|away|out|open|closed|ready|high|low";
/** The places a look puts its thing ("on the work table", "in the garage", "by the table leg"). */
const PLACE_NOUNS =
  "tables?|bench(?:es)?|workbench(?:es)?|shel(?:f|ves)|counters?|countertops?|desks?|floors?|walls?|" +
  "garage|kitchen|workshop|shop|studio|room|corner|porch|yard|garden|barn|shed|stands?|sawhorses?|" +
  "windows?|windowsills?|sills?|doors?|doorways?|driveway|pegboard|racks?|stalls?|fair|market|" +
  "trays?|baskets?|hooks?|ceiling|mantel|hearth|chairs?|beds?|couch|sofa|steps|stairs|lawn|" +
  "field|street|road|curb|belt|station|area|spot|mat|vise|pockets?";
/**
 * A part of the thing itself, not followed by a place: "a felt dot centered on the bottom", "a
 * button set into the center of its face" are its look — "the front door" is a place.
 */
const OWN_PART =
  `(?!\\s+(?:(?:the|its|a|an|one)\\s+)?(?:(?:front|back|top|bottom)\\s+)?(?:bottom|top|underside|front|back|sides?|ends?|edges?|faces?|lid|base|middle|cent(?:er|re)|rim|surface|handle)\\b(?!(?:\\s+[\\w'-]+){0,3}\\s+(?:${PLACE_NOUNS})\\b))`;
const ADVERB = `(?:\\s+(?:[a-z]+ly|just|right))?`;
const PLACING =
  `(?:(?:${STORING})${ADVERB}\\s+(?:${PLACE_PREPS})\\b` + `|(?:${ATTACHING})${ADVERB}\\s+(?:${PLACE_PREPS})\\b${OWN_PART})`;
const PLACE_CLAUSE = new RegExp(
  `^(?:[a-z]+ly\\s+)?(?:` +
    `(?:[a-z]+-)?(?:(?:${STARTS_RESTING})\\b|${PLACING})` +
    `|(?:[a-z]+-)?(?:${STORING}|${ATTACHING})\\b.*\\b(?:${PLACE_NOUNS})\\b` +
    `|(?:beside|near|nearby|next to|against|under|underneath|beneath|behind|above|below|outside|` +
    `inside|outdoors?|indoors?|atop|within reach)\\b` +
    `|(?:on|in|at|by|along|off)\\s+(?:the|a|an|its|his|her|their)?\\s*(?:[\\w'-]+\\s+){0,3}(?:${PLACE_NOUNS}|hands?)\\b` +
    `|(?:cent(?:er|re)|middle|corner|edge|end|side|top) of (?:the|a|an)\\s+(?:[\\w'-]+\\s+){0,2}(?:${PLACE_NOUNS})\\b)`,
  "i"
);
/** Where a place starts INSIDE a clause ("neatly folded quilts stacked in a row"). */
const PLACE_INSIDE = new RegExp(
  `\\s(?:(?:${ALWAYS_PLACE})\\b|(?:[a-z]+-)?${PLACING}` +
    `|(?:near|nearby|beside|next to|against|behind)\\b${OWN_PART}` +
    `|(?:on|in|at|by|under|beneath|underneath|outside|inside|along|above|below|atop)\\s+` +
    `(?:the|a|an|its|his|her|their)?\\s*(?:[\\w'-]+\\s+){0,2}(?:${PLACE_NOUNS})\\b)`,
  "i"
);
/** A clause about the light, the time or the scene around the thing, what it is for, or another thing. */
const NOT_ITS_LOOK =
  /\b(?:outdoors?|indoors?|setting|lighting|daylight|sunlight|lamplight|sky|casting|glow(?:ing)?|in the (?:evening|morning|afternoon|night)|at night|visible beyond|in the background|backdrop|shown|seen|used (?:for|to|as)|for comparison|where|than)\b/i;
/** What a cut leaves dangling: a placing word with nothing after it ("furniture piece sitting ready"). */
const DANGLING = new RegExp(
  `(?:\\s+(?:${STORING}|${ATTACHING}|${ALWAYS_PLACE})(?:\\s+(?:or|and)\\s+[a-z]+)*(?:\\s+(?:[a-z]+ly|together|ready|open|closed))*)+$`,
  "i"
);
/** A clause left starting on a placing word ("hanging or grouped together") says only where it is. */
const PLACING_START = new RegExp(`^(?:${STORING}|${ATTACHING}|${STARTS_RESTING})\\b`, "i");

/**
 * Words of how far along a thing is — what has been done or added to it. A first picture of a thing
 * being made has no picture of it to follow (`memorySourcesFor` drops the finished ones), and the
 * MAIN thing's look describes it finished: Hank's job 258 — "single angled hole drilled halfway
 * through, thin coat of oil giving a soft sheen, round felt dot centered on the bottom" — put onto
 * "hands drilling an angled hole into a charred cedar scrap" would draw the finished holder again.
 * SURFACE work changes the colour as well (charred black, oiled, painted), so its colours are not the
 * raw thing's; SHAPE work (coiled, stitched, drilled, a felt dot added) leaves the material's colour
 * as it was.
 */
const SURFACE_STAGE =
  /\b(?:(?:un)?finish(?:ed|es|ing)?|oil(?:ed|s|y)?|coat(?:ed|ing|s)?|sheen|glossy|sanded|polish\w*|paint(?:ed)?|stain(?:ed)?|dyed|bleached|varnish\w*|lacquer\w*|waxed|glazed|fired|baked|charred|scorched|blackened|burn(?:t|ed)|brushed|sealed|cured)\b/i;
const SHAPE_STAGE =
  /\b(?:drill(?:ed|ing)|holes?|felt (?:dots?|pads?)|dots?|carv\w*|routed|glue[ds]?|quilt(?:ed|ing)|stitch(?:ed|es|ing)?|sewn|seams?|hemmed|binding|coil(?:ed|s)?|wrapped|crochet\w*|knit(?:ted)?|woven|pieced|braided|assembled|joined|joints?|fitted|attached|installed|upholstered|trimmed|completed?|framed|mounted)\b/i;
/** A part added to the thing: its material is the part's, not the thing's ("a felt dot"). */
const ADDED_PART = /^(?:dots?|pads?|patch(?:es)?|trim|binding|edging|backing|lining|tassels?|fringe|buttons?|tags?)$/;
/**
 * Writing on the thing: a picture carries none unless its line says it (`pictureText`), and the
 * props list is told to list nothing with marks — yet "marked with letter I" and "routed lettering"
 * are stored looks, and would ask for writing in every picture of the thing. A living thing is
 * marked with COLOURS, though ("wings marked with two white bars"), and those are the very features
 * that tell it from a look-alike (`EXACT_KIND_RULE`): "marked with" a colour within two words is its
 * look. A writing word in the clause still drops it ("marked with a black number").
 */
const MARK_COLOURS =
  "black|white|grey|gray|brown|red|orange|yellow|green|blue|buff|rust|chestnut|tan|cream|olive|dark|pale|light|bright";
const WRITING = new RegExp(
  "\\b(?:letter(?:s|ing|ed)?|labell?ed|labels?|text|words?|numbers?|numbered|writing|written|handwritten|" +
    "logo|brand(?:ed)?|monogram\\w*|initials?|date code|" +
    `marked with(?!\\s+(?:[a-z-]+\\s+){0,2}(?:${MARK_COLOURS})\\b)|` +
    "engrav\\w*|last-name|names?)\\b",
  "i"
);

/** Colour and material words: the part of a look that holds at every stage of making. */
const COLOUR_MATERIAL = new Set(
  (
    "black white grey gray silver chrome gold golden brass bronze copper red orange yellow green blue " +
    "navy teal turquoise purple violet pink brown tan beige cream ivory khaki olive maroon burgundy " +
    "rust amber charcoal two-tone multicolored multicoloured colour colours color colors coloured " +
    "colored colorful colourful striped stripes plaid checked floral print prints patterned " +
    "wood wooden timber oak walnut maple cedar pine cherry ash birch beech mahogany teak poplar " +
    "plywood mdf melamine bamboo cork metal metallic steel iron cast-iron aluminium aluminum tin " +
    "zinc plastic vinyl rubber silicone glass ceramic porcelain clay stone marble granite slate " +
    "concrete brick leather suede fabric cloth cotton wool woollen woolen yarn linen denim felt " +
    "canvas burlap silk velvet fleece flannel paper cardboard wicker rattan straw cord rope twine " +
    "string thread wire mesh resin acrylic"
  ).split(" ")
);
/** Words that shade a colour or material ("dark walnut", "mixed scrap colors") — never alone. */
const SHADES = new Set(
  "dark pale light deep bright soft muted mixed varied assorted natural warm cool dull matte scrap and".split(" ")
);
const lookWords = (clause: string) =>
  clause
    .toLowerCase()
    .split(/\s+/)
    .flatMap(w => {
      const bare = w.replace(/[^a-z-]/g, "");
      return COLOUR_MATERIAL.has(bare) ? [bare] : bare.split("-");
    })
    .filter(Boolean);
const hasColourMaterial = (clause: string) => lookWords(clause).some(w => COLOUR_MATERIAL.has(w));

/**
 * The colour and material words of one clause, in their own runs ("dark walnut and pale maple"),
 * leaving out a material that belongs to an added part ("round felt dot" is not felt all over).
 */
function colourMaterialRuns(clause: string): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  const close = (next?: string) => {
    while (run.length && SHADES.has(run[run.length - 1])) run.pop();
    if (run.some(w => COLOUR_MATERIAL.has(w)) && !(next && ADDED_PART.test(next))) runs.push(run.join(" "));
    run = [];
  };
  for (const w of lookWords(clause)) {
    if (COLOUR_MATERIAL.has(w) || (SHADES.has(w) && (w !== "and" || run.length))) run.push(w);
    else close(w);
  }
  close();
  return runs;
}

/** The longest item of a place's list ("bare branches", "and holly shrubs") — a longer clause is a look. */
const PLACE_LIST_ITEM_WORDS = 4;
/**
 * A part or mark the thing itself HAS: an animal's ears, tail or bill, a plant's leaves or bark, a
 * tool's blade or handle, a spot, band or patch. These are exactly the 2-3 features `EXACT_KIND_RULE`
 * asks a look to name, and they are short and often colourless ("tufted ears, and a bushy tail"), so
 * after a dropped comparison or place ("larger than a house cat, tufted ears, and a short bobbed
 * tail", "seen at dusk, pointed ears, and a bushy tail") they read just like a place's list, and the
 * look was cut to "a bobcat". An item naming one is the thing's look and stops the list. Never a word
 * a living thing's place is listed in (branches, berries, flowers — job 404's "bare branches, and
 * holly shrubs" are where the robin is seen). A stop only keeps what the cut kept before.
 */
const OWN_FEATURE =
  /\b(?:heads?|faces?|ears?|eyes?|bills?|beaks?|crests?|combs?|tufts?|throats?|necks?|breasts?|chests?|bell(?:y|ies)|backs?|rumps?|wings?|tails?|legs?|feet|foot|paws?|claws?|talons?|hoo(?:f|fs|ves)|snouts?|muzzles?|noses?|manes?|horns?|antlers?|whiskers?|coats?|fur|feathers?|plumage|scales?|fins?|gills?|shells?|antennae|spots?|bands?|bars?|patch(?:es)?|rings?|markings?|masks?|bod(?:y|ies)|frame|leaf|leaves|petals?|bark|stems?|stalks?|trunks?|needles?|blossoms?|buds?|cones?|thorns?|spines?|blades?|handles?|teeth|tooth|grips?|tips?)\b/i;

/**
 * A PLACE'S LIST GOES WITH IT (2026-10-18, job 404 scene 4). The look is cut clause by clause at its
 * commas, so a place that runs on as a list lost only its first item: "…, dark head, seen on grass,
 * bare branches, and holly shrubs" dropped "seen on grass" and told every picture of the robin it
 * looks like "bare branches, and holly shrubs" — holly that pulled its first picture, a robin on a
 * holly bush in snow, further toward the Christmas-card robin of another continent. The rest of that
 * list is what follows the dropped clause up to and including an item opening on "and" or "or",
 * each of a few words with no colour or material in it (job 328's rack: "holding a hand sander,
 * clamps, and a square" left the rack looking like "clamps, and a square"). Anything else stops it:
 * a colour or material is the thing's own look ("seen from the front, a red cab, and blue trim"), so
 * is a part or mark it has (`OWN_FEATURE`: "seen at dusk, pointed ears, and a bushy tail"), a
 * longer clause is too, and a clause that never reaches an "and" was no list (job 400's seat: "seen
 * from the side, quiet and empty"). A place listing what it has (job 395: "bright indoor store with
 * wide aisles, pale flooring, and tall open shelves") is the thing itself, never cut on.
 * Returns the index of the list's last item, or `i` when nothing follows as its list. Pure.
 */
function placeListEnd(clauses: string[], i: number): number {
  if (/\bwith\b/i.test(clauses[i])) return i;
  for (let j = i + 1; j < clauses.length; j++) {
    const c = clauses[j];
    const and = /^(?:and|or)\s+/i.test(c);
    const words = c.replace(/^(?:and|or)\s+/i, "").split(/\s+/).length;
    if (words > PLACE_LIST_ITEM_WORDS || hasColourMaterial(c) || OWN_FEATURE.test(c)) return i;
    if (and) return j;
  }
  return i;
}

/**
 * A PART IS KEPT WHEN "WHERE" SAYS HOW IT SITS ON THE THING (2026-10-18, job 408 scenes 23-24). Any
 * clause holding "where" read as a place (`NOT_ITS_LOOK`) and went whole, which is right for "where
 * furniture waits before pickup" but took the parts a tool is told apart by: a look written by its
 * parts (`SPECIALISED_TOOL_RULE`) says "a black rubber sleeve where the tube bends" or "a fixed lower
 * jaw where it meets the handle", and the first picture lost the sleeve and the jaw. Stored looks lost
 * the same way — job 376's smoke alarm "with a small center test button and a thin seam where the
 * cover separates from the base". A clause that opens on a part ("a …", "the …", "with a …") keeps
 * what comes before "where"; the place cut then runs on what is left. A "where" that names a place
 * ("… where the coats hang by the door"), or a clause that opens any other way ("warm wood table in
 * a bright kitchen corner, where knitting talk … happen", "exposed where plate is removed"), goes
 * whole as before. Pure.
 */
const PART_BEFORE_WHERE = /^((?:with\s+)?(?:a|an|the|its|one|two)\s+.+?)\s+where\s+(.+)$/i;
const NAMES_PLACE = new RegExp(`\\b(?:${PLACE_NOUNS})\\b`, "i");
function partBeforeWhere(clause: string): string {
  const m = PART_BEFORE_WHERE.exec(clause);
  if (!m || NAMES_PLACE.test(m[2]) || NOT_ITS_LOOK.test(m[1])) return clause;
  return m[1];
}

/**
 * A key thing's look cut down for ONE picture. Every mode drops where it sits, the light and
 * setting around it, what it is used for, comparisons with other things and any writing on it.
 * "noStage" also drops every clause about what has been done or added to it. "colourMaterial" keeps
 * only its colours and materials, the one part of a look that holds at every stage of making — Ruth's
 * coiled bowl, "roughly six inches across, smooth rounded shape", is not the strip it starts as: a
 * clause of plain colour or material stays whole ("striped in rounds of color"), a clause about
 * shaping keeps only its colour and material words, a clause about the surface keeps nothing. Pure.
 */
export function pictureLook(look: string, mode: "full" | "noStage" | "colourMaterial" = "full"): string {
  // Never its light, weather or hour (`lookWithoutLight`, job 412 scene 25's "low golden light").
  const raw = lookWithoutLight(look)
    .replace(/[.\s]+$/, "")
    .split(/\s*[,;]\s*|\s+[—–]\s+/)
    .map(c => c.trim())
    .filter(Boolean)
    .map(partBeforeWhere);
  const placed = raw.map(c => PLACE_CLAUSE.test(c) || NOT_ITS_LOOK.test(c));
  const gone = new Set(raw.flatMap((c, i) => (placed[i] || WRITING.test(c) ? [i] : [])));
  for (let i = 0; i < raw.length; i++) {
    if (!placed[i]) continue;
    for (let j = i + 1; j <= placeListEnd(raw, i); j++) gone.add(j);
  }
  const clauses = raw
    .filter((_, i) => !gone.has(i))
    .map(c => {
      const m = PLACE_INSIDE.exec(c);
      if (!m) return c;
      // What is left before the place, minus a placing word left dangling ("hanging or grouped
      // together near the coasters" leaves nothing of the look) and an article left hanging ("knit
      // sweater with a folded high neck" read "folded high" as a place and left "… with a").
      const left = c
        .slice(0, m.index)
        .replace(DANGLING, "")
        .replace(/(?:\s+(?:a|an|the|its|his|her|their))+$/i, "")
        .replace(/\s+(?:or|and|with)$/i, "")
        .trim();
      return PLACING_START.test(left) ? "" : left;
    })
    .filter(c => c && !/^(?:and|or|with)$/i.test(c));
  if (mode === "full") return clauses.join(", ");
  if (mode === "noStage") return clauses.filter(c => !SURFACE_STAGE.test(c) && !SHAPE_STAGE.test(c)).join(", ");
  const kept = clauses.flatMap(c =>
    SURFACE_STAGE.test(c) ? [] : SHAPE_STAGE.test(c) ? colourMaterialRuns(c) : hasColourMaterial(c) ? [c] : []
  );
  return Array.from(new Set(kept)).join(", ");
}

/**
 * The look picture `s` is drawn by when nothing earlier of its own thing is there to follow, or
 * undefined: its own key thing's look (`ownKeyThing` — a list item that only inherited a key thing
 * gets none), cut down by its stage. Before the thing is finished, only colours and materials. In a
 * video that MAKES something (`makes`: some picture of it carries a stage), the MAIN thing's look
 * describes the finished piece, so on a picture not marked finished ("done") its finish and added
 * parts go too. A video that makes nothing has no stage to protect, so its MAIN look is kept whole:
 * stripping it took the colours off job 373's dog ("a medium-sized tan and white dog with a short
 * coat" — the coat read as a coat of oil) and left job 397's board only "rounded corners, medium
 * size"; 48 of 113 stored MAIN looks lost colour or material words that way. Pure.
 */
export function keyThingLookFor(
  s: StoryboardScene,
  things: KeyThing[] | undefined,
  makes = true
): string | undefined {
  const own = ownKeyThing(s);
  // A place's look goes in only where the picture is set in that same place (`placeLookClause`): told
  // "HOW THE LAWN LOOKS", a lawn in another region would be drawn as the northern one (job 411 scene 16).
  const thing = own && !lendsNoPicture(own) ? things?.find(k => k.name === own) : undefined;
  // A look that describes an INSIDE (`insideView`) is no look a camera can hold: job 403's main thing
  // was written "the toilet's internal porcelain passage behind the bowl, a smooth curved S-shaped
  // channel", and a picture drawn by it — the toilet lifted off the floor included — was told to show
  // that channel. Such a picture is drawn from outside instead (`hiddenInside`, `seenFromOutside`).
  if (!thing?.look?.trim() || insideView(thing.look)) return undefined;
  const mode = beforeFinished(s)
    ? "colourMaterial"
    : makes && thing.main && s.buildStage !== "done"
      ? "noStage"
      : "full";
  return pictureLook(thing.look, mode) || undefined;
}

/**
 * The written look of key thing `name` for picture `s` when it is NOT the picture's own thing, or
 * undefined: the sympathy card in a man's hands in a picture about the pharmacy aisle (job 409 scene
 * 3). Cut down like the own thing's (`pictureLook`), but by the picture's stage only when it is the
 * MAIN thing of a video that makes something: the stage belongs to what is being made, never to the
 * card or the bench beside it. Never a look that describes an inside (`insideView`). Pure.
 */
export function otherThingLookFor(
  s: StoryboardScene,
  name: string,
  things: KeyThing[] | undefined,
  makes = true
): string | undefined {
  const thing = things?.find(k => k.name === name);
  if (!thing?.look?.trim() || insideView(thing.look)) return undefined;
  const mode =
    !makes || !thing.main
      ? "full"
      : beforeFinished(s)
        ? "colourMaterial"
        : s.buildStage !== "done"
          ? "noStage"
          : "full";
  return pictureLook(thing.look, mode) || undefined;
}

/**
 * The written look of every key thing but `s`'s own, cut down for `s` (`otherThingLookFor`), by name:
 * what a redraw from words keeps for the things beside its own (`lentLooks`). Pure.
 */
export function otherThingLooksFor(
  s: StoryboardScene,
  things: KeyThing[] | undefined,
  makes = true
): Map<string, string> {
  const looks = new Map<string, string>();
  for (const k of things ?? []) {
    // A place's look is held to the place the picture is set in (`placeLooks`), never lent for words.
    if (k.name === s.keyThing || lendsNoPicture(k.name)) continue;
    const look = otherThingLookFor(s, k.name, things, makes);
    if (look) looks.set(k.name, look);
  }
  return looks;
}

/**
 * Whether the picture's named kind's exact look (`namedLook`, "kind: look") is the look of `name`: it
 * wins over that thing's written look, as it does over its own (`keyThingLookClause`). Pure.
 */
const namedKindIs = (scene: StoryboardScene, name: string) =>
  !!scene.namedLook && wordsName(scene.namedLook.split(":")[0], name);

/**
 * EVERY KEY THING DRAWN FROM WORDS KEEPS ITS LOOK (2026-10-18, job 409 scenes 2, 3 and 5). A picture
 * with no reference pictures used to carry the written look of its OWN key thing only: job 409 scene
 * 3, the pharmacy aisle with the sympathy card in a man's hands, copied its memory (scene 2) twice and
 * was drawn from words (`memoryToWords`) with the aisle's look alone, and the card — "a plain cream
 * greeting card with a muted gray ribbon print" in the props list and in scene 2 — came back a white
 * card with a painted lily spray; scene 5, drawn from scene 3 as the aisle's memory, carried the lily
 * card on. So a picture without references carries the look of every other key thing its own words
 * name too (`otherThingLooks`). A named kind's exact look wins. With references it is empty: they
 * carry the things they show, and the memory clause says the rest — a picture drawn from memory reads
 * exactly as before. Only the things its OWN words name: a thing that only stood in a reference is
 * never written in (`lentLooks` says why). Pure.
 */
export function otherThingLooksClause(scene: StoryboardScene): string {
  if (scene.memoryRefUrls?.length) return "";
  // A thing that stands in the place the picture is set in says its look there already (`placeLooks`).
  const placed = new Set((scene.placeLooks ?? []).map(p => p.name));
  const named = (scene.otherThingLooks ?? []).filter(t => !namedKindIs(scene, t.name) && !placed.has(t.name));
  if (!named.length) return "";
  const list = named.map(t => `the ${t.name}: ${t.look}`).join("; ");
  return named.length > 1
    ? ` HOW THE OTHER THINGS IN IT LOOK in every picture of this video — ${list}. Draw those same ones, where this picture's own words put them.`
    : ` HOW THE OTHER THING IN IT LOOKS in every picture of this video — ${list}. Draw that same one, where this picture's own words put it.`;
}

/**
 * Whether a key thing in `s` — its own or one beside it — is a part HIDDEN INSIDE something: its
 * props-list look describes an inside (`insideView`). Job 403's main thing, "toilet trapway: the
 * toilet's internal porcelain passage behind the bowl", was on 12 scenes; "close-up of the smooth
 * white curved S-shaped porcelain channel, water flowing up and over its curve" (scene 13) names no
 * inside in its own words, and came back sawn open like the rest. Such a picture is drawn from the
 * outside (`seenFromOutside`). Pure.
 */
export function hiddenInside(s: StoryboardScene, things: KeyThing[] | undefined): boolean {
  const names = [s.keyThing, ...(s.otherKeyThings ?? [])].filter(Boolean);
  return !!things?.some(k => names.includes(k.name) && insideView(k.look));
}

/**
 * The image-prompt line that carries a key thing's look (`scene.keyThingLook`, set only on a picture
 * with no picture of its own thing to follow). A named kind's exact look (`namedLook`) wins. The
 * picture's own words still decide where it is, which part shows and how far along it is. On a
 * picture with no references, the looks of the other key things in it follow
 * (`otherThingLooksClause`). Pure.
 */
export function keyThingLookClause(scene: StoryboardScene): string {
  return `${ownThingLookClause(scene)}${otherThingLooksClause(scene)}`;
}

/**
 * ANOTHER ONE OF ITS KIND, TOLD APART (`scene.othersOfKind`, job 412 scenes 23-26). A picture whose
 * words name a key thing only as another one of its kind — "a wild cat" in a video about one house
 * cat — gets none of that thing's pictures or look, and is told in so many words that it is not the
 * one shown before: drawn from its own words, the prompt writer's rewrite may still carry the props
 * list's coat and markings. Never for a thing the picture also shows plainly. Pure.
 */
export function anotherOfItsKindClause(scene: StoryboardScene): string {
  const shown = new Set([scene.keyThing, ...(scene.otherKeyThings ?? [])]);
  return (scene.othersOfKind ?? [])
    .filter(o => !shown.has(o.name) && o.said.trim())
    .map(
      o =>
        ` ANOTHER ONE OF ITS KIND: this picture shows ${o.said.trim()} — not the ${o.name} shown in this ` +
        `video's other pictures, nor a copy of it. Draw only what this picture's own words describe, ` +
        `with a look of its own.`
    )
    .join("");
}

/** The line for its OWN key thing's look (`keyThingLook`), as it always was. */
function ownThingLookClause(scene: StoryboardScene): string {
  if (scene.namedLook || !scene.keyThingLook || !scene.keyThing) return "";
  const own = " — where it is, which part of it shows and how far along it is are as this picture's own words say.";
  return beforeFinished(scene)
    ? ` THE ${scene.keyThing.toUpperCase()}'S COLOURS AND MATERIALS, the same in every picture of this video: ${scene.keyThingLook}${own}`
    : ` HOW THE ${scene.keyThing.toUpperCase()} LOOKS in every picture of this video: ${scene.keyThingLook}. Draw this same one${own}`;
}

/**
 * A SPLIT PANEL WEARS ITS THING'S NAMED LOOK (2026-10-18, job 400 scene 27). The named-things step
 * (`describeNamedLooks`) reads only full-frame pictures, so a panel never carried the exact look of
 * the kind its key thing is: the essay scroll at scenes 20, 28 and 34 was drawn by "papyrus scroll:
 * … rolled into a cylinder … a thin brown cord tied around its middle", while the panel at 27, six
 * seconds before 28, had only its own words ("an aged papyrus scroll laid flat on a wooden desk, the
 * surface worn and darkened") and came back a blank parchment on two dark rollers — another object.
 * So a panel takes the look the pictures ABOUT its key thing carry — the one more than half of them
 * carry — when that kind is a kind of the thing (its name names the thing, or the panel's own words
 * name the kind). Counted from pictures whose own thing it is and that are about it (`isSubject`):
 * never a close-up of one part (a block on a quilt is a kind of its own), a screen (an app's look),
 * or a picture with the thing beside its subject. Never onto a panel that has a look of its own, or
 * a screen panel. Undefined for anything that is not a split. Pure.
 */
export function panelNamedLook(scenes: StoryboardScene[], s: StoryboardScene): string | undefined {
  if (!s.hostPresent || !s.splitVisual || s.namedLook || isScreen(s)) return undefined;
  const thing = ownKeyThing(s);
  if (!thing) return undefined;
  const about = scenes.filter(
    x => x !== s && source(x) && ownKeyThing(x) === thing && !x.partOf && !isScreen(x) && isSubject(x, thing)
  );
  const carried = new Map<string, number>();
  for (const x of about) if (x.namedLook) carried.set(x.namedLook, (carried.get(x.namedLook) ?? 0) + 1);
  for (const [look, n] of Array.from(carried)) {
    const kind = look.split(":")[0];
    if (n * 2 > about.length && (wordsName(thing, kind) || wordsName(s.splitVisual, kind))) return look;
  }
  return undefined;
}

/** How a SCREEN picture uses its item's memory: only as the photo inside the listing. */
export const SCREEN_ITEM_VIEW =
  "the item appears only as the photo inside the listing on the screen";

/** The camera position of a list item drawn from its list's group picture. */
export const SET_ITEM_VIEW =
  "a close-up that fills the frame with just this one item, the very one from the group in the reference";

/**
 * The group picture a list item is drawn from: the `listSet` picture right before its list (walking
 * back over the other items). Undefined for anything else. Pure.
 */
export function listSetFor(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene | undefined {
  if (!s.listCut) return undefined;
  let i = scenes.indexOf(s) - 1;
  while (i >= 0 && scenes[i].listCut) i--;
  return i >= 0 && scenes[i].listSet ? scenes[i] : undefined;
}

/*
 * THE GROUP AFTER A LIST IS DRAWN FROM ITS ITEMS (round 14, job 414 scene 8). "But on the back wall hung
 * | an axe, | a froe, | and a drawknife, | and the steel in those three was the one thing that homestead
 * could not grow." Each item had its own picture — the froe correct, a flat blade with an upright wooden
 * handle at one end — and the picture under "those three" was filed under the key thing all three were
 * filed under ("steel tools"). Its memory was that thing's first picture about it and the latest one,
 * both the drawknife close-up: the axe and the froe were drawn from the words alone, and the froe came
 * back a bare flat bar two seconds after the viewer saw it right. The list's items are the very things
 * the group shows, so the group is drawn from each item's own picture (`listGroupFor`), told to draw
 * each as that same one (`LIST_GROUP_VIEW`). Replayed over the 350 stored storyboards: two pictures —
 * this one, and job 407 scene 7 under the same words (whose items were key things of their own, so it
 * was drawn from them already).
 */

/** The camera position of a picture that gathers a list's items, drawn from each item's own picture. */
export const LIST_GROUP_VIEW =
  "the items together in one picture, where this picture's own words put them — never one of the item pictures again";

/**
 * Words of a line that gather the items just said: "those three", "all four", "all of them", "each of
 * them", "the two of them". Never a bare "both" ("both hands") or "none of those", which says the
 * opposite.
 */
const GATHERS =
  /\b(?:those|these|all|both)\s+(?:two|three|four|five|six|seven|eight|nine|ten)\b|\b(?:all|each|both)\s+of\s+(?:them|those|these)\b|\bthem\s+all\b|\bthe\s+(?:two|three|four|five|six|seven|eight|nine|ten)\s+of\s+them\b/i;

/** Words in front of a list item that say nothing of what it is: joining words, articles, counts, owners. */
const ITEM_LEAD =
  /^(?:(?:and|or|plus|then|a|an|the|some|any|one|two|three|four|five|six|my|your|his|her|their|our|its|this|that|these|those|each|every)\s+)+/i;

/** One word, singular: "coasters" → "coaster", "boxes" → "box", "berries" → "berry". */
const singular = (w: string) =>
  /(?:ss|us|is)$/.test(w)
    ? w
    : /ies$/.test(w)
      ? `${w.slice(0, -3)}y`
      : /(?:ches|shes|xes|zes|sses)$/.test(w)
        ? w.slice(0, -2)
        : /s$/.test(w)
          ? w.slice(0, -1)
          : w;

/**
 * The THING a list item's own words name, singular: "and a drawknife," → "drawknife", "Coasters," →
 * "coaster", "two keepsake boxes" → "keepsake box". Undefined when the words are no short name of a
 * thing: more than three words that name it, a number, or a clause ("the star looks fine"). Pure.
 */
export function itemThingName(said: string): string | undefined {
  const rest = itemWords(said).toLowerCase().replace(ITEM_LEAD, "").trim();
  if (!rest || !/^[a-z][a-z' -]*$/.test(rest)) return undefined;
  const words = rest.split(/\s+/);
  const meaningful = nameWords(rest).filter(w => !NOT_A_NAME_WORD.has(w));
  if (!meaningful.length || meaningful.length > 3 || words.length > 4) return undefined;
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
}

/** Whether two words are one, singular or plural: "axe"/"axes", "box"/"boxes", "coaster"/"coasters". */
const sameWord = (a: string, b: string) =>
  a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`;

/**
 * What a tool or thing LEAVES, said right after its name: "scalloped axe marks", "saw lines", "drill
 * holes" are no axe, saw or drill (job 414 scene 29: "a hewn poplar log wall with scalloped axe marks").
 */
const LEFT_BY = /^(?:marks?|cuts?|chips?|shavings?|dust|scratch(?:es)?|dents?|nicks?|prints?|tracks?|stains?|burns?|scars?|grooves?|strokes?|holes?|kerfs?|lines?|scrapes?)$/;

/**
 * Whether `text` names the thing `name` (`itemThingName`) as that thing: every word of its name that
 * says which thing it is, singular or plural, with its last word somewhere not followed by what the
 * thing leaves (`LEFT_BY`). Pure.
 */
export function namesItemThing(text: string | undefined, name: string): boolean {
  const toks = (text ?? "").toLowerCase().replace(/['’]s\b/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  const want = nameWords(name).filter(w => !NOT_A_NAME_WORD.has(w));
  if (!want.length || !want.every(w => toks.some(t => sameWord(t, w)))) return false;
  const head = want[want.length - 1];
  return toks.some((t, k) => sameWord(t, head) && !LEFT_BY.test(toks[k + 1] ?? ""));
}

/**
 * The items of the spoken list a picture GATHERS right after it, whose own pictures it is drawn from;
 * undefined for any other picture. The picture's line gathers them ("those three", "all of them",
 * `GATHERS`); the list ends right before it (only host takes between); two or more of its items are
 * drawn pictures of a thing (`itemThingName`) — never a list of steps, which are done to one thing —
 * and the picture is about them: filed under the very key thing every item was filed under (job 414
 * scene 8, "steel tools"), or its own words name two or more of them (job 407 scene 7, "the steel blades
 * of the axe, the froe and the drawknife"). At most `MAX_MEMORY_REFS`, the ones its words name first,
 * in film order. Never a list item, a list's own group picture, a close-up of one part, or a screen.
 * Pure.
 */
export function listGroupFor(scenes: StoryboardScene[], s: StoryboardScene): StoryboardScene[] | undefined {
  if (!drawn(s) || s.listCut || s.listSet || s.partOf || isScreen(s)) return undefined;
  if (!GATHERS.test(s.scriptText ?? s.narration ?? "")) return undefined;
  const i = scenes.indexOf(s);
  let j = i - 1;
  while (j >= 0 && !scenes[j].listCut && !drawn(scenes[j])) j--;
  if (j < 0 || !scenes[j].listCut) return undefined;
  let a = j;
  while (a > 0 && scenes[a - 1].listCut) a--;
  const run = scenes.slice(a, j + 1);
  if (run.some(x => x.listKind === "steps")) return undefined;
  const items = run.filter(x => source(x) && !isScreen(x) && !!itemThingName(x.scriptText ?? x.narration ?? ""));
  if (items.length < 2) return undefined;
  const words = s.hostPresent ? s.splitVisual ?? "" : `${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`;
  const named = items.filter(x => namesItemThing(words, itemThingName(x.scriptText ?? x.narration ?? "")!));
  const filed = !!s.keyThing && items.every(x => x.keyThing === s.keyThing);
  if (named.length < 2 && !filed) return undefined;
  const picked = [...named, ...items.filter(x => !named.includes(x))].slice(0, MAX_MEMORY_REFS);
  return items.filter(x => picked.includes(x));
}

/**
 * How a remembered thing is drawn when it is NOT what the picture is about (2026-10-02, Frederick's
 * job 335 at 0:07: "the one kind of fire that likes to start while the house is asleep" drew the
 * smoke alarm on the ceiling filling the frame, the smouldering bed a dark corner — the alarm was the
 * picture's key thing only because the description named it last, and memory's camera rotation gave
 * it "a close view … filling most of the frame").
 */
export const BACKGROUND_VIEW =
  "kept where the description puts it, at its natural size beside what the picture is about — never close up and never the centre of the picture";

/**
 * A picture about printing the line talks about without saying the words (`blurPrint`): near enough
 * to see it is printing, too far to read a word. A close-up of print is drawn sharp whatever the
 * prompt says (job 335's label at 1:05, refused for readable writing four times, then shipped).
 */
export const BLUR_PRINT_VIEW =
  "the part this picture is about turned toward the camera, in the middle of the frame and clearly its subject, seen from about an arm's length away — near enough to see there is printing on it, too far for any word to be read";

/** Where a description's LEAD ends: what it names first is what the picture is about. */
const LEAD_END =
  /[,;:]|\s[—–-]\s|\b(?:with|beside|next to|behind|above|below|beneath|underneath|in the background|in front of|while|near|nearby)\b/i;

const nameWords = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(w => w.length > 2);

/**
 * Whether key thing `thing` is what picture `s` is ABOUT rather than something beside it: its name
 * is matched in the description's lead (up to the first comma or "with / beside / above …") and in
 * the rest, and it is in the background only when the rest names it more fully than the lead ("thin
 * smoke rising from a smouldering mattress …, a smoke alarm on the ceiling above"). Any picture,
 * any thing, any channel — no word list of things. Pure.
 */
export function isSubject(s: StoryboardScene, thing: string): boolean {
  const text = s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "";
  const m = LEAD_END.exec(text);
  if (!m) return true;
  const name = nameWords(thing);
  if (!name.length) return true;
  const hits = (part: string) => {
    const have = new Set(nameWords(part));
    return name.filter(w => have.has(w) || have.has(`${w}s`) || have.has(w.replace(/s$/, ""))).length;
  };
  return hits(text.slice(m.index)) <= hits(text.slice(0, m.index));
}

/**
 * "on the", "atop a", "on top of its small metal …": what comes next is the surface something sits
 * on. The words between the article and the thing describe it — never another article or a place
 * word, so "on the floor beside a bed" does not put anything on the bed.
 */
const SITS_ON =
  /\b(?:on\s+top\s+of|on|onto|upon|atop)\s+(?:the|a|an|its|their|his|her|this|that|my|your|our|one)\s+(?:(?!(?:the|a|an|of|and|or|with|beside|near|next|by|in|on|at|under|behind|above|below|from|to|for|its|their|his|her)\s)[a-z'’-]+\s+){0,3}$/i;
/**
 * Words ending in -ing that are things or times, not something being done ("a ceiling", "in the
 * evening", "something").
 */
const ING_THING =
  /^(?:\w*thing|morning|evening|ceiling|building|clothing|bedding|railing|siding|string|spring|icing|frosting|topping|stuffing|filling|lining|padding|wiring|tubing|flooring|shelving|awning|setting|painting|drawing|wedding|pudding|earring|sapling|seedling|duckling)$/i;
const PLACED_ING = new RegExp(`^(?:${STARTS_RESTING}|${STORING})$`, "i");
/**
 * A part a thing has: "a point on the star blanket", "the test button on the smoke alarm face", "the
 * end grain on a rough-sawn board" are close-ups OF the thing, not things put down on it.
 */
const PART_OF_IT =
  /\b(?:points?|buttons?|grain|stitch(?:es)?|seams?|edges?|corners?|sides?|faces?|tops?|bottoms?|underside|ends?|labels?|dials?|notch(?:es)?|joints?|holes?|handles?|lids?|knobs?|switch(?:es)?|tips?|rims?|spouts?|hinges?|latch(?:es)?|valleys?|blocks?|patch(?:es)?|squares?|loops?|threads?|beads?|grille)\b/i;

/**
 * Whether key thing `thing` is only the SURFACE what picture `s` is about sits on: its description
 * first names it (by its last word, "the beverage CART") right after "on (top of) the …", with
 * something named before that which only sits, rests or stands there. Job 410 scene 20: "a small
 * plastic cup of orange juice beside a juice can on the beverage cart" was filed under the cart;
 * `isSubject` put the cart beside the subject, and the view meant for a thing beside it
 * (`BACKGROUND_VIEW`) pushed the cart — and the juice on it — to the back of an empty row of seats.
 * Never a thing being worked on: "hands brushing oil onto the incense holder", "a finger pressing the
 * test button on the smoke alarm", "hands cutting a notch on the lattice panel" are about the holder,
 * the alarm and the panel (replayed over the local storyboards, every such step kept its thing). A
 * thing the description names first, or before any surface ("the cart with a cup on it"), is not one.
 * By the description's words alone — any picture, any thing. Pure.
 */
export function holdsSubject(s: StoryboardScene, thing: string | undefined): boolean {
  const text = pictureWords(s);
  const head = nameWords(thing ?? "")
    .filter(w => !NOT_A_NAME_WORD.has(w))
    .pop();
  if (!text.trim() || !head) return false;
  const first = new RegExp(`\\b${head.replace(/s$/, "")}(?:s|es)?\\b`, "i").exec(text);
  if (!first) return false;
  const before = text.slice(0, first.index);
  const on = SITS_ON.exec(before);
  if (!on) return false;
  const lead = before.slice(0, on.index);
  if (!/[a-z]{3,}/i.test(lead.replace(/\b(?:the|and|with)\b/gi, "")) || PART_OF_IT.test(lead)) return false;
  // Something DONE to it before the "on" makes it what is worked on, not where something sits.
  return !(lead.toLowerCase().match(/[a-z]{2,}ing\b/g) ?? []).some(w => !ING_THING.test(w) && !PLACED_ING.test(w));
}

/**
 * THE ITEM, NOT WHAT IT SITS ON: whether key thing `thing` is filed on picture `s` only as the surface
 * its subject sits on (`holdsSubject`) while the LINE never names it — so the picture is about the
 * item, and the surface is only beside it (`tagKeyThings`). A line that names the surface ("that's the
 * board I cut bread on every morning") is about it, and keeps it. A close-up of one part (`partOf`) is
 * about that part. Pure.
 */
export function onlyItsSurface(s: StoryboardScene, thing: string | undefined): boolean {
  return !!thing && !s.partOf && holdsSubject(s, thing) && !wordsName(s.scriptText ?? s.narration ?? "", thing);
}

/** Words that ask for a close view: "close-up", "close view", "detail", "filling the frame", "macro". */
const CLOSE_WORDS = /\bclose[- ]?(?:up|view|shot)\b|\bdetail\b|\bfilling (?:most of )?the (?:whole )?frame\b|\bmacro\b/i;

/**
 * The ONE place a memory picture's framing is decided, from the picture itself: "close" for a part
 * of its key thing (`partOf`) or a picture whose own words ask for a close view, otherwise
 * undefined (memory rotates through its views). Pure.
 */
export function shotFraming(s: StoryboardScene): "close" | undefined {
  if (s.partOf) return "close";
  const words = s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "";
  return CLOSE_WORDS.test(words) ? "close" : undefined;
}

/**
 * Words that say the subject is ONE SMALL THING: "a single white cotton swab", "a small plastic cup",
 * "a tiny screw". "little" only as a size — never "a little to one side" or "a little closer".
 */
const SMALL_THING =
  /\b(?:single|lone|tiny|small|miniature)\b|\blittle\b(?!\s+(?:to|closer|further|farther|more|less|bit|off|higher|lower|way|while|later|earlier)\b)/i;

/**
 * Whether a far camera would lose this picture's subject: one its own words frame close or about one
 * part (`shotFraming`), or one naming a single small thing (`SMALL_THING`). Job 408 scene 16's panel,
 * "close view of a single white cotton swab", came back a speck when a near-copy redraw sent it "much
 * further back", and scene 19's look down into the bowl at "a single white cotton swab" across the
 * drain is a part close-up. Read off the picture's own words (a split's panel's). Pure.
 */
export function smallSubject(s: StoryboardScene): boolean {
  if (shotFraming(s) === "close") return true;
  return SMALL_THING.test(s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "");
}

/** A picture of a phone, tablet or laptop screen (its own words, or a split panel's). */
const isScreen = (s: StoryboardScene) =>
  showsScreen(s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "");

/** At most this many memory pictures go with one picture (the host photo may follow them). */
export const MAX_MEMORY_REFS = 3;

/**
 * Whether a picture shows key thing `t` — as its own thing, or beside it — and its own words never say
 * the thing is NOT there (`saysAbsent`): job 416 scene 2, "empty backyard lawn at quiet morning, no
 * robins visible", was filed with the robin beside it and became the robin's memory. Asked of the
 * filing a board already carries too: a pass over a film filed before (read back from the database)
 * or one with no key things listed keeps the old tags.
 */
const shows = (x: StoryboardScene, t: string) =>
  (x.keyThing === t || !!x.otherKeyThings?.includes(t)) && !saysAbsent(pictureWords(x), t);

/**
 * The camera position of `s` when it is drawn from memory: the next of `MEMORY_VIEWS` after the
 * pictures of its key thing before it, so two in a row never share one. Undefined for the memory
 * picture itself, and for a picture of no key thing unless it continues one (`keylessContinued`). Pure.
 */
export function memoryViewFor(scenes: StoryboardScene[], s: StoryboardScene): string | undefined {
  if (listSetFor(scenes, s)) return SET_ITEM_VIEW;
  if (listGroupFor(scenes, s)) return LIST_GROUP_VIEW;
  // A list item whose key thing was only inherited is drawn from the OTHER things in it alone, as a first
  // picture beside them is (`memoryOthersOnly`): no camera of its own thing to move — and never the
  // screen's view, which would call a reference of another thing "the item for sale".
  if (s.listCut && s.keyThing && !ownKeyThing(s)) return undefined;
  if (isScreen(s) && s.keyThing && drawn(s)) return SCREEN_ITEM_VIEW;
  // A picture of NO key thing has a camera only as a continuation, drawn from the picture it continues
  // (`keylessContinued`): a concrete one (`REDRAW_CAMERAS`) — job 413 scene 16 had only its words' "a
  // close-up of one detail of it", which meant nothing for a man seen from behind, and came back as
  // scene 15's over-the-shoulder shot.
  if (!s.keyThing) {
    if (!source(s) || !continuedPicture(scenes, s)) return undefined;
    const k = continuationCameraIndex(scenes, s);
    if (k < 0) return undefined;
    return s.blurPrint && k === 0 ? BLUR_PRINT_VIEW : REDRAW_CAMERAS[k];
  }
  // A place is never drawn from a picture of itself (`lendsNoPicture`), so it has no camera to move —
  // nor is a picture whose words say its thing is NOT there (`saysAbsent`) drawn from that thing's.
  if (!drawn(s) || lendsNoPicture(s.keyThing) || saysAbsent(pictureWords(s), s.keyThing)) return undefined;
  const i = scenes.indexOf(s);
  const before = scenes.slice(0, Math.max(0, i)).filter(x => source(x) && shows(x, s.keyThing!)).length;
  if (before === 0) return undefined;
  // A remembered thing beside what the picture is about stays beside it (`isSubject`): the same
  // thing, at its natural size — never the close view the rotation would give the subject.
  // A picture of one PART of it (`partOf`) is about that part, whatever order the words name them in.
  // Never the SURFACE the subject sits on (`holdsSubject`, job 410 scene 20): kept small, it takes what
  // sits on it to the back of the picture with it. One the line does not name is filed beside its
  // item before this is asked (`tagKeyThings`); one the line names is what the line is about.
  if (!s.partOf && !isSubject(s, s.keyThing) && !holdsSubject(s, s.keyThing)) return BACKGROUND_VIEW;
  // A CONTINUATION that repeats the words of the picture it is drawn from gets a concrete camera
  // (`REDRAW_CAMERAS`), never the stock memory views: told "a close view of one part of it", job 403
  // scene 14 came back as scene 10 a little closer, and job 405 scene 22 as scene 21 a little tighter
  // (`repeatedPicture`). One whose own words were rewritten keeps the framing they ask for, below.
  // Printing that must stay unreadable is never a close-up of the print here either.
  if (!s.partOf && repeatedPicture(scenes, s)) {
    const camera = REDRAW_CAMERAS[continuationCameraIndex(scenes, s)];
    return s.blurPrint && camera === REDRAW_CAMERAS[0] ? BLUR_PRINT_VIEW : camera;
  }
  // The picture's OWN framing decides first (`shotFraming`): one part of the thing, or a close view
  // its words ask for, is a close-up — never "a few steps further back" or "the other side", which
  // drew Ruth's "a bear paw there" as the whole quilt (job 298) while its words said "close view".
  // Printing that must stay unreadable is never a close-up of the print (`BLUR_PRINT_VIEW`).
  if (shotFraming(s) === "close") return s.blurPrint ? BLUR_PRINT_VIEW : PART_VIEW;
  return MEMORY_VIEWS[(before - 1) % MEMORY_VIEWS.length];
}

/**
 * Tag every drawn picture the shot list did not tag with the key thing its description names —
 * a split's panel (`splitVisual`), the QR background, a storyboard picture (`keyThingIn`) — never a
 * surface its subject only sits on (`onlyItsSurface`), which a picture filed under one gives up to
 * its other key things. Returns how many it tagged. Pure apart from mutating `scenes`.
 */
export function tagKeyThings(scenes: StoryboardScene[], things: KeyThing[] | undefined): number {
  let n = 0;
  const members = groupMembersOf(scenes, things);
  const at = new Map(scenes.map((x, k) => [x, k] as const));
  for (const s of scenes) {
    if (!drawn(s)) continue;
    // THE ITEM, NOT WHAT IT SITS ON (job 410 scene 20): the juice under "Juice works the same way"
    // was filed under the beverage cart it sat on, drawn from the cart's first picture (a wide shot
    // of a row of seats with the cart far down the aisle) and kept small with it — the juice came
    // back a speck and shipped "subject missing". A surface the line never names is only beside the
    // picture's item, so the picture is the item's (or nobody's, drawn from its words).
    const surface = onlyItsSurface(s, s.keyThing) ? s.keyThing : undefined;
    if (surface) s.keyThing = undefined;
    // …and one an earlier pass gave up is still only a surface. Every pass over a board — a retry's,
    // a regenerate's, a resume's, each read back from the database with the last pass's filing on it
    // — must file the picture the same way: asked only of `s.keyThing`, the second pass no longer saw
    // the cart under job 399 scene 18's juice carton, filed it under the cup BESIDE it, and the view
    // that keeps a thing beside the subject small (`BACKGROUND_VIEW`) came back.
    const surfaces = [surface, ...(s.otherKeyThings ?? []).filter(t => onlyItsSurface(s, t))].filter(
      (t, k, all): t is string => !!t && all.indexOf(t) === k
    );
    if (!things?.length) {
      if (surfaces.length)
        s.otherKeyThings = [...surfaces, ...(s.otherKeyThings ?? []).filter(t => !surfaces.includes(t))];
      s.othersOfKind = undefined;
      continue;
    }
    const text = s.hostPresent ? s.splitVisual : (s.showSubject ?? s.visualPrompt);
    // ANOTHER OF ITS KIND IS NOT THE KEY THING (`anotherOfItsKind`, job 412 scenes 23-26): "a wild cat
    // stalking low through scattered brush" was filed beside its landscape under the video's own cat
    // and drawn from the pet's first picture — the pet in the desert. `keyThingsIn` no longer names it;
    // a planner's or a check's filing under it is given up here too (with the stage, which belongs to
    // the picture of that thing), and the prompt is told it is not the one shown before.
    const another = othersOfKindIn(text, things);
    s.othersOfKind = another.length ? another : undefined;
    if (s.keyThing && another.some(a => a.name === s.keyThing)) {
      s.keyThing = undefined;
      s.buildStage = undefined;
    }
    if (s.partOf && another.some(a => a.name === s.partOf)) s.partOf = undefined;
    // A THING ITS WORDS SAY IS NOT THERE IS NOT ITS THING (`saysAbsent`, job 416 scene 2): a planner's
    // or a check's filing under it is given up, with the stage, and the picture is filed anew under
    // what it does show ("empty backyard lawn …, no robins visible" → the lawn).
    if (s.keyThing && saysAbsent(text, s.keyThing)) {
      s.keyThing = undefined;
      s.buildStage = undefined;
    }
    if (s.partOf && saysAbsent(text, s.partOf)) s.partOf = undefined;
    const named = keyThingsIn(text, things).map(t => t.name);
    // Filed anew only under a key thing the picture is ABOUT (or the item a screen shows): one beside
    // the subject would take the view that keeps its memory small (`BACKGROUND_VIEW`), and the surface
    // with it — job 399 scene 18's juice carton on the cart tray, beside a cup. Asked whenever the
    // picture names a surface at all, filed under it or not, so the answer never depends on the pass.
    const onSurface = surfaces.length > 0 || named.some(name => onlyItsSurface(s, name));
    const own = named.find(
      name => !onlyItsSurface(s, name) && (!onSurface || isSubject(s, name) || isScreen(s))
    );
    if (!s.keyThing && own) {
      s.keyThing = own;
      n++;
    }
    // Every other key thing the picture names is remembered too, and every surface it gave up.
    const others = named.filter(name => name !== s.keyThing);
    for (const t of surfaces) if (!others.includes(t)) others.push(t);
    // …and every member of a group it shows (`groupMembersOf`): its own item picture, and every picture
    // after it whose words name it as that thing — never another item of its own list, each of which is
    // its own thing, and never where a key thing the picture names already holds the name ("kitchen
    // knife" for a "knife"). A picture filed under nothing is filed under the member, as under any key
    // thing it names (job 414 scene 13, "a student … pulling a drawknife", after the drawknife's item).
    const shown = members.filter(m => {
      if (m.item === s) return true;
      const [k, item] = [at.get(s)!, at.get(m.item)!];
      if (k <= item || (s.listCut && scenes.slice(item, k + 1).every(x => x.listCut))) return false;
      return (
        namesItemThing(text, m.name) &&
        !saysAbsent(text, m.name) &&
        !named.some(name => namesItemThing(name, m.name))
      );
    });
    for (const m of shown)
      if (m.name !== s.keyThing && !others.includes(m.name)) {
        if (!s.keyThing && m.item !== s) {
          s.keyThing = m.name;
          n++;
        } else others.push(m.name);
      }
    s.otherKeyThings = others.length ? others : undefined;
  }
  return n;
}

/*
 * A GROUP'S MEMBERS ARE THINGS OF THEIR OWN (round 14, job 414 scenes 6, 17 and 20). The props list may
 * write ONE key thing for things the script then lists one by one — "steel tools: an axe, a froe, and a
 * drawknife hanging together" — and "an axe, | a froe, | and a drawknife," was cut one picture per item,
 * each filed under that group. Later pictures named the froe ("the host's hands holding a froe upright
 * by its wooden handle…", "…levering a froe's handle sideways…") but were filed under the oak bolt and
 * the shingle: the froe was no key thing, so no picture of it was ever a reference, and it changed shape
 * from one picture to the next — right at scene 17, a hatchet-like bar at scene 20, ten seconds later.
 * So when two or more items of one list are filed under one key thing whose written look names each of
 * them, each of those items is a MEMBER: a thing of its own, first shown by its item picture, and every
 * picture from there on whose own words name it is drawn from its pictures like any other key thing
 * (`tagKeyThings`, `otherKeyThings`). Never a part of a thing ("face, | edge, | length", job 352), a
 * place, a screen, the group itself, a thing that is a key thing already, or the colours of ONE thing
 * (jobs 354 and 378: "Ivory, | oat, | a warm coral," the beads of one necklace). Replayed over the 350
 * stored storyboards: 7 groups in 5 films, 15 members — the steel tools, and the coasters, ornaments,
 * engraved boards and keepsake boxes of a woodworker's piles of pieces.
 */

/** Words that name a collection of things: "smalls pile", "tool set", "sewing kit". */
const COLLECTION = /^(?:pile|heap|set|collection|kit|stack|group|assortment|bundle|batch|selection|trio|array)$/;

/** A member of a group key thing (`groupMembersOf`): its name, the item picture that first shows it, and its group. */
export type GroupMember = { name: string; item: StoryboardScene; of: string };

/**
 * The members of the group key things of `scenes` (see above), in film order: from each run of a list
 * of things, the items filed under one key thing that has a written look, two or more of them, whose
 * own words name a thing (`itemThingName`) that look names (`namesItemThing`) — never the group itself
 * (the item's words name it), a part of a thing (`PART_OF_IT`), a place or the weather
 * (`lendsNoPicture`), a screen, or a thing that is a key thing of its own. Pure.
 */
export function groupMembersOf(scenes: StoryboardScene[], things: KeyThing[] | undefined): GroupMember[] {
  const out: GroupMember[] = [];
  if (!things?.length) return out;
  // A group names MANY things — "steel tools", "small wood pieces", "smalls pile" — never one thing
  // whose look lists its colours ("light bead necklace: … beads in ivory, oat, warm coral", jobs 354,
  // 364, 380, 395: "Ivory, | oat, | a warm coral," are that one necklace's beads).
  const isGroup = (name: string) => {
    const head = nameWords(name).pop() ?? "";
    return COLLECTION.test(head) || (singular(head) !== head && !/(?:ss|us|is)$/.test(head));
  };
  // An item whose own picture names the group's last word is the group itself in one variant, no
  // member of it: job 378's "chunky light beads in ivory finish" under "chunky light beads". The
  // "(for the …)" a list adds to a bare item names its group, not what the picture shows.
  const showsGroup = (x: StoryboardScene, of: string) => {
    const head = nameWords(of).pop() ?? "";
    const words = (x.showSubject ?? x.visualPrompt ?? "").replace(/\(for the [^)]*\)/gi, " ");
    return !!head && nameWords(words).some(w => sameWord(w, head));
  };
  const isKeyThing = (name: string) => {
    const w = nameWords(name).filter(x => !NOT_A_NAME_WORD.has(x));
    return things.some(k => {
      const v = nameWords(k.name).filter(x => !NOT_A_NAME_WORD.has(x));
      return v.length === w.length && v.every((x, i) => sameWord(x, w[i]));
    });
  };
  let a = 0;
  while (a < scenes.length) {
    if (!scenes[a].listCut) {
      a++;
      continue;
    }
    let b = a;
    while (b + 1 < scenes.length && scenes[b + 1].listCut) b++;
    const run = scenes.slice(a, b + 1);
    a = b + 1;
    if (run.some(x => x.listKind === "steps")) continue;
    const byThing = new Map<string, GroupMember[]>();
    for (const x of run) {
      const of = x.keyThing;
      const look = of ? things.find(k => k.name === of)?.look : undefined;
      if (!of || !look?.trim() || lendsNoPicture(of) || !isGroup(of) || !source(x) || isScreen(x)) continue;
      if (showsGroup(x, of)) continue;
      const said = x.scriptText ?? x.narration ?? "";
      const name = itemThingName(said);
      if (!name || wordsName(said, of) || lendsNoPicture(name) || isKeyThing(name)) continue;
      if (PART_OF_IT.test(name.split(" ").pop()!) || !namesItemThing(look, name)) continue;
      const ms = byThing.get(of) ?? [];
      if (!ms.some(m => m.name === name)) ms.push({ name, item: x, of });
      byThing.set(of, ms);
    }
    for (const ms of Array.from(byThing.values())) if (ms.length >= 2) out.push(...ms);
  }
  return out.sort((x, y) => scenes.indexOf(x.item) - scenes.indexOf(y.item));
}

/*
 * A PLACE LENDS NO PICTURE (round 14, the verification films 411 and 412). The props list is told to
 * list "the recurring places", and a place key thing was remembered like an object. Job 411's "lawn"
 * (the northern backyard's) lent scene 2's whole yard — the same tree, fence and house, framing and
 * all — to the robin on the lawn (scene 5), the kitchen window (scene 7), the robin in the snow (scene
 * 12) and the empty lawn in November (scene 18): one yard view five times in two minutes, which the
 * fingerprint check missed because the foreground changed. And the Gulf Coast panel, "a green lawn in a
 * Gulf Coast yard", was matched to that lawn by its word and drawn from it: snow under the palms, the
 * northern fence behind. `MEMORY_SETTING_CLAUSE` and `memoryNotShown` never applied, because the
 * references DID show "a lawn". Job 412's "wild landscape" lent its first wilderness to the pictures
 * after it. A thing has one shape to keep; a place has no shape a picture must repeat, only what it is
 * made of — and a reference of a place hands the picture maker its composition. So a place, setting or
 * surroundings never lends a reference picture (`memorySourcesFor`), nor does the weather. A place
 * keeps a WRITTEN look instead, cut to what it is made of (`placeLook`), used only where the picture's
 * own words set it in that same place (`placesSetIn`) — the props list's home setting too, which is no
 * key thing. And a key thing that stands in such a place (the bed in the bedroom) keeps its look in
 * every picture set there that no reference of it reaches: job 412's "ankle" list item, drawn from
 * nothing as every list item is, came back in another bedroom with a black metal bed and cream bedding.
 * Replayed over the 129 stored storyboards: 26 pictures in 10 films had been drawn from a place's
 * picture for that place, and 923 of 3,916 drawn pictures are set in a place with a written look.
 */

/** Places, settings and surroundings, as the head word of a name ("buyer's driveway", "wild landscape"). */
const PLACE_WORDS = new Set(
  (
    "yard backyard lawn garden field meadow pasture paddock prairie orchard vineyard farm farmyard " +
    "farmland landscape wilderness countryside scenery woods woodland woodlot forest jungle desert beach " +
    "shore coast coastline park street road roadside alley sidewalk driveway lot room bedroom bathroom " +
    "kitchen basement attic cellar closet pantry hallway corridor entryway foyer porch patio balcony " +
    "garage workshop studio office store shop aisle market stall booth interior setting " +
    "surroundings backdrop stairwell home town city village neighborhood neighbourhood campsite " +
    "campground river riverbank lake lakeshore pond creek valley hillside mountainside church classroom " +
    "restaurant cafe café space area"
  ).split(" ")
);
/**
 * Place words that name no place of their own — whatever place the words are about ("Gulf Coast
 * setting", "the surroundings"): never another place (`placesSetIn`).
 */
const ANY_PLACE = new Set("setting surroundings scenery backdrop area space interior home".split(" "));
/** The weather and the sky: a setting too — what a picture's own words say, never a reference or a look. */
const WEATHER_WORDS = new Set("snow frost fog mist rain sky sunset sunrise weather storm".split(" "));
/** A body part makes "collarbone area" the host's skin, never a place. */
const BODY_NAME =
  /\b(?:neck|collarbones?|chest|shoulders?|face|lips?|mouth|hands?|wrists?|arms?|legs?|feet|foot|knees?|hips?|scalp|skin|hair|ears?|cheeks?|chin|forehead|ankles?|fingers?|nails?)\b/i;

/** A word as said, lower case and bare: "Yard," → "yard", "buyer's" → "buyer". */
const bareWord = (w: string) =>
  w.toLowerCase().replace(/[’‘]/g, "'").replace(/^[^a-zé]+|[^a-zé'-]+$/g, "").replace(/'s?$/, "");

/** The place word `w` is, in its base form ("bedrooms" → "bedroom", "cities" → "city"), or undefined. */
function placeBase(w: string): string | undefined {
  const x = bareWord(w);
  if (PLACE_WORDS.has(x)) return x;
  const one = x.endsWith("ies") ? `${x.slice(0, -3)}y` : x.replace(/e?s$/, "");
  return PLACE_WORDS.has(one) ? one : PLACE_WORDS.has(x.replace(/s$/, "")) ? x.replace(/s$/, "") : undefined;
}

/** Where a name's head ends: "kitchen with stove", "bedroom at night", "coffee can of burnt scraps". */
const NAME_TAIL = /\s+(?:of|with|on|in|at|for|from|under|beside|near|by|during|held|inside)\s+/i;

/**
 * The head word of a key thing's name — the last word before "of / with / on / in …", a parenthesis or
 * a comma: "coffee can of burnt scraps" → can, "bedroom at night" → bedroom, "kitchen with stove" →
 * kitchen, "parking lot (recalled)" → lot. Pure.
 */
function nameHead(name: string): string {
  const t = name.replace(/\([^)]*\)/g, " ").split(",")[0].split(NAME_TAIL)[0];
  return bareWord(t.trim().split(/\s+/).pop() ?? "");
}

/**
 * Whether a key thing's name is a PLACE, setting or surroundings: its head word names one ("lawn",
 * "wild landscape", "buyer's driveway", "pharmacy aisle", "bedroom at night") — never a thing named
 * after where it is ("kitchen window", "garage door", "market table", "porch light"), and never a
 * part of the body ("collarbone area"). Over the 626 key-thing names of the 129 stored films it picks
 * out 50 — the lawns, yards, driveways, aisles, rooms, lots and landscapes — and nothing else. Pure.
 */
export function isPlaceName(name: string | undefined): boolean {
  if (!name?.trim() || BODY_NAME.test(name)) return false;
  return !!placeBase(nameHead(name));
}

/** Whether a key thing's name is the weather or the sky ("snow"). Pure. */
export function isWeatherName(name: string | undefined): boolean {
  if (!name?.trim()) return false;
  const head = nameHead(name);
  return WEATHER_WORDS.has(head) || WEATHER_WORDS.has(head.replace(/s$/, ""));
}

/** Whether key thing `name` never lends a reference picture: a place, a setting or the weather. Pure. */
export function lendsNoPicture(name: string | undefined): boolean {
  return isPlaceName(name) || isWeatherName(name);
}

/**
 * A props-list label as a name: no "MAIN" / "HOME", no dash, no article, no markdown, lower case, and
 * nothing after its head ("… at night"). The dash after "HOME" may be an en dash, and the name the
 * prompt says carries no hour: job 252's "HOME – single-family house interior at night" was named
 * "– single-family house interior at night" and would have put the night in every picture set there.
 */
const labelName = (label: string) =>
  label
    .replace(/^(?:MAIN|HOME)\b/i, "")
    .replace(/^[\s:\-–—]+/, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[*_`]/g, "")
    .split(NAME_TAIL)[0]
    .trim()
    .toLowerCase();

/**
 * The props list's HOME setting (its first line, `deriveContinuitySheet`) as a place, or undefined: no
 * key thing (`parseKeyThings` starts after it), yet the place most pictures are set in — job 412's
 * "bedroom: a quiet bedroom at pre-dawn hours, …, an unmade bed as the central feature". Only when its
 * name is a place ("garage workshop", "backyard", "dressing room"); a home written as a thing ("kitchen
 * table", "hallway ceiling") is none. A line labelled only "HOME" is named by its description's lead
 * (job 299: "HOME: one-car garage workshop: uncluttered concrete-floor space…"; job 327: "HOME: a modest
 * kitchen with an adjoining living room, warm lamp light, …"). Pure.
 */
export function homePlaceOf(sheet: string | undefined): KeyThing | undefined {
  const line = withoutPersonLines(sheet)
    .split("\n")
    .map(l => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .find(l => l.includes(":"));
  if (!line) return undefined;
  const at = line.indexOf(":");
  let name = labelName(line.slice(0, at));
  let look = line.slice(at + 1).trim();
  if (!name) {
    const lead = /^(.+?)\s*(?::|,|;|\s[—–]\s)/.exec(look)?.[1] ?? look;
    name = labelName(lead.split(NAME_TAIL)[0]);
    look = look.replace(/\s*:\s*/, ", ");
  }
  return name && look && isPlaceName(name) ? { name, look } : undefined;
}

/** A word after a place word saying the place word IS the place, not one describing a thing after it. */
const AFTER_PLACE = new Set(
  (
    "a an the and or but nor with without in on at by of to from for under over near beside behind above " +
    "below beneath into onto inside outside across along through around among between before after while " +
    "as where that which who whose its his her their this these those is are was were be been being has " +
    "have had sits stands lies rests hangs seen shown visible beyond toward towards against there here " +
    "full lit"
  ).split(" ")
);
type Token = { raw: string; w: string };
const tokensOf = (text: string): Token[] =>
  text
    .replace(/\b(?:a lot|lots) of\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(raw => ({ raw, w: bareWord(raw) }));

/**
 * Whether the place word at `i` is said AS a place: last in its phrase ("in the backyard."), before a
 * word that is no noun ("the lawn under palm trees", "the lawn visible beyond it"), or before another
 * place ("the backyard lawn" is in the backyard) — never a word naming a thing ("the kitchen window",
 * "a lawn chair", "a field guide"). Pure.
 */
function saidAsPlace(toks: Token[], i: number): boolean {
  if (/[,.;:!?)"']$/.test(toks[i].raw)) return true;
  const next = toks[i + 1];
  if (!next || !next.w) return true;
  if (placeBase(next.w)) return true;
  return AFTER_PLACE.has(next.w) || /(?:ly|ed|ing|ible|able)$/.test(next.w);
}

/** Months and weekdays: a time, never another place ("in January"). */
const TIME_NAME =
  /^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/;
/** A region named after "in / across / along …": "in a Gulf Coast yard", "down in Florida". */
const NAMED_REGION =
  /\b(?:in|across|throughout|along|on)\s+(?:(?:the|a|an|some|most|many)\s+)*([A-Z][a-z]+)/g;

/** A name's words, without a parenthesis ("parking lot (recalled)" → parking, lot). */
const placeNameWords = (name: string) => nameWords(name.replace(/\([^)]*\)/g, " "));
const baseOf = (w: string) => placeBase(w) ?? w.replace(/(?:es|s)$/, "");

/**
 * Whether `text` names every word of `name` (singular or plural): "holly bushes" names "holly bush",
 * "storm windows" names "storm window". Pure.
 */
function namesAll(text: string, name: string): boolean {
  const have = new Set(nameWords(text).map(baseOf));
  const want = placeNameWords(name).filter(w => !NOT_A_NAME_WORD.has(w));
  return want.length > 0 && want.every(w => have.has(baseOf(w)));
}

/**
 * Whether two places are one inside the other: either's look names the other's head word ("lawn: …
 * covering the backyard", "backyard: a suburban yard with a mowed lawn"). Pure.
 */
function linkedPlaces(a: KeyThing, b: KeyThing): boolean {
  const [ha, hb] = [placeBase(nameHead(a.name)), placeBase(nameHead(b.name))];
  const said = (look: string, head: string | undefined) =>
    !!head && tokensOf(look).some(t => placeBase(t.w) === head);
  return said(a.look, hb) || said(b.look, ha);
}

/** Words that never tell two descriptions are of one picture: joiners and sizes. */
const NOT_A_SHARED_WORD = new Set([
  ...Array.from(NOT_A_NAME_WORD),
  "from", "into", "onto", "its", "her", "his", "their", "this", "that", "over", "under", "near",
  "close", "view", "seen", "shot", "frame", "filling",
]);

/**
 * The words picture `s` is set by: a split's panel, else what it must show and the prompt writer's
 * words — those only when they rewrite what it must show (a word of it in common). A prompt left from
 * another picture says nothing of where this one is: job 411 scene 17, "close-up of an open bird field
 * guide page showing a painted American robin", still carried scene 18's prompt "the empty backyard
 * lawn in late November light", and would have been set on the lawn. Pure.
 */
function setWords(s: StoryboardScene): string {
  if (s.hostPresent) return s.splitVisual ?? "";
  const show = s.showSubject ?? "";
  const prompt = s.visualPrompt ?? "";
  if (!show.trim()) return prompt;
  const own = new Set(nameWords(show).filter(w => !NOT_A_SHARED_WORD.has(w)).map(baseOf));
  const rewrite = nameWords(prompt).some(w => !NOT_A_SHARED_WORD.has(w) && own.has(baseOf(w)));
  return rewrite ? `${show} ${prompt}` : show;
}

/**
 * The places picture `s` is SET IN, of `places` (the place key things and the home): those its own
 * words (`setWords`) name AS a place (`saidAsPlace`; every word of a key thing's name, the head word
 * of the home's), unless those words set it SOMEWHERE ELSE: another place said as a place that is
 * neither this one, the shorter word for it ("the room" of a bedroom, "the yard" of a backyard), nor
 * one inside or around it (`linkedPlaces`), or a region named after "in / across / along". Job 411
 * scene 16's panel, "a green lawn in a Gulf Coast yard", is set somewhere else than the backyard's
 * lawn; scene 12's "a snow-covered lawn in the backyard" is not, and neither is job 412 scene 21's "in
 * the dim pre-dawn bedroom, …, the quiet room barely lit". Never a screen: what a screen shows is not
 * where it is. Pure.
 */
export function placesSetIn(s: StoryboardScene, places: KeyThing[], home?: KeyThing): KeyThing[] {
  if (!drawn(s) || isScreen(s)) return [];
  const text = setWords(s);
  if (!text.trim()) return [];
  const toks = tokensOf(text);
  // The home once: a props list that also lists its home setting as a key thing would say it twice.
  const sameName = (p: KeyThing) => !!home && p.name.trim().toLowerCase() === home.name.trim().toLowerCase();
  const all = [...places, ...(home && !places.some(sameName) ? [home] : [])];
  const regions = Array.from(text.matchAll(NAMED_REGION), m => m[1]).filter(n => !TIME_NAME.test(n));
  const named = (p: KeyThing) => {
    const head = placeBase(nameHead(p.name));
    if (!head || !toks.some((t, i) => placeBase(t.w) === head && saidAsPlace(toks, i))) return false;
    return p === home || namesAll(text, p.name);
  };
  return all.filter(p => {
    if (!named(p)) return false;
    const head = placeBase(nameHead(p.name)) ?? "";
    const related = new Set([
      ...placeNameWords(`${p.name} ${p.look}`).map(baseOf),
      ...all.filter(q => q !== p && linkedPlaces(p, q)).flatMap(q => placeNameWords(q.name).map(baseOf)),
    ]);
    const same = (b: string) => related.has(b) || head.endsWith(b);
    const elsewhere =
      toks.some((t, i) => {
        const b = placeBase(t.w);
        return !!b && !ANY_PLACE.has(b) && !same(b) && saidAsPlace(toks, i);
      }) || regions.some(n => !related.has(n.toLowerCase()));
    return !elsewhere;
  });
}

/**
 * Season, weather, the hour and the climate — and light as a NOUN, said last or before where it falls
 * ("winter light", "low golden light on distant hills", job 400's "soft fluorescent light overhead"),
 * and the chill of a cold season (job 184's "autumn/winter chill"): never a place's own look. "light"
 * before another word describes it ("light wear", "light grey walls", "a porch light fixture") and
 * stays.
 */
const PLACE_TIME =
  /\b(?:lighting|sunlight|daylight|lamplight|moonlight|candlelight|glow(?:ing)?|shadows?|dawns?|dusks?|sunrises?|sunsets?|mornings?|evenings?|afternoons?|nights?|nighttime|midday|noon|twilight|hours?|seasons?|winters?|summers?|autumns?|wintry|weather|climate|sky|skies|snow|frost|rain|fog|mist|drafts?|chill(?:y|ed)?)\b|\blight\b(?=\s*$|\s+(?:from|through|in|on|of|across|over|at|into|onto|overhead|above|throughout|everywhere|falling|coming|streaming|pouring|filtering|spilling|shining|that|which)\b)/i;
/**
 * What lights the place ("lit by a warm desk lamp in the evenings", job 302; "lit by a single overhead
 * bulb", job 272): the light, which is each picture's own — a lamp glow in every picture set there is
 * the staged look the picture check refuses. Cut from where it starts.
 */
const LIT_BY = /\s*\b(?:lit|lighted|illuminated)\s+(?:only\s+)?(?:by|with|from)\b.*$/i;
/** A part that only says how the place is lit or warmed: job 207's "lit warm at evening". */
const LIT_ONLY = /^\s*(?:lit|lighted|illuminated|warmed)\b/i;
/**
 * A clause about the video rather than the place ("a stretch that the story keeps returning to", job
 * 263), or about one moment in it — something put there ready for what happens next ("furniture
 * staged near the curb for pickup", job 283; "empty except for the furniture piece", job 288): what
 * happens there is each picture's own words'. Never a house's storeys ("single-story house interior
 * with hallway, bedroom, …", job 259, lost its whole first part) nor a waiting room.
 */
const NOT_THE_PLACE =
  /\b(?:(?<!\b(?:one|two|three|four|single|multi|split)[-\s])stor(?:y|ies)|video|script|scenes?|narrat\w*|ready|staged|waiting(?!\s+(?:rooms?|areas?|lounges?)\b)|waits|awaiting|except for|for (?:pickup|sale|delivery|collection))\b/i;
/** Light, weather and season said as describing words: "dawn-lit", "frost-dusted", "snow-topped", "winter". */
const PLACE_TIME_WORDS =
  /\b(?:(?:late|early|mid)-(?:autumn|fall|winter|summer|spring|morning|evening|afternoon|night|day|dawn|dusk)|[a-z]+-(?:lit|dusted)|(?:snow|frost|sun|moon|lamp|rain|ice)-[a-z]+|(?:cold|warm|mild|temperate)-(?:climate|weather)|(?:softly|dimly|brightly|evenly|warmly)\s+lit|sunlit|moonlit|lamplit|dim|snowy|frosty|frosted|icy|rainy|foggy|misty|sunny|overcast|wintry|winter|summer|autumn|autumnal|springtime|nighttime|daytime|pre-dawn|predawn)\b/gi;
/**
 * The words a light or weather cut leaves dangling: "a window letting (in daylight)", "dusted (with
 * frost)", job 198's "adjoining rooms warmed (by lamplight)".
 */
const DANGLING_CUT =
  /(?:(?:^|\s+)(?:letting|coming|streaming|falling|pouring|filtering|shining|glowing|spilling|bathed|flooded|washed|dusted|covered|topped|bordered|edged|lined|lit|warmed))+$/i;
/** Where the camera is, and what the place is used for or returned to: never its look. */
const PLACE_CAMERA =
  /\s*\b(?:seen|viewed|shown|photographed|visible|used\s+(?:for|to|as|during|by|in)|returned\s+to)\b.*$/i;

/**
 * A place's written look cut to WHAT IT IS MADE OF, for any picture set there (`placeLooks`): its
 * ground, walls, furniture and plants. Gone: the season, the weather, the light and the hour — what each
 * picture's own words say, as `MEMORY_SETTING_CLAUSE` holds them for references (job 411's backyard
 * says "late fall to winter light", and a line about spring is set in that backyard too); where the
 * camera stands ("viewed from the kitchen window" would pin every picture's framing); and any writing.
 * "a quiet bedroom at pre-dawn hours, soft dim blue-grey light, an unmade bed as the central feature"
 * → "a quiet bedroom, an unmade bed as the central feature". What lights it (`LIT_BY`) and what is
 * put there for one moment of the story (`NOT_THE_PLACE`) go too. Pure.
 */
export function placeLook(look: string): string {
  const kept = look
    .replace(/[.\s]+$/, "")
    .split(/\s*[,;]\s*|\s+[—–]\s+/)
    .map(c => {
      if (NOT_THE_PLACE.test(c) || LIT_ONLY.test(c)) return "";
      let x = c.replace(PLACE_CAMERA, "").replace(LIT_BY, "").trim();
      // A trailing "at pre-dawn hours", "with low golden light", "under a layer of fresh snow" — read
      // from the end, so "a yard with a mowed lawn in the evening" keeps its lawn.
      const preps = Array.from(x.matchAll(/\s+(?:at|in|during|on|under|across|through|with|by)\s+/gi), m => m.index!);
      const whole = x;
      for (let k = preps.length - 1; k >= 0 && PLACE_TIME.test(x.slice(preps[k])); k--) x = x.slice(0, preps[k]);
      // …and what the cut leaves dangling: "a single window letting (in daylight)", "dusted (with frost)".
      if (x !== whole) x = x.replace(DANGLING_CUT, "");
      x = x
        .replace(PLACE_TIME_WORDS, "")
        .replace(/\s{2,}/g, " ")
        .trim()
        .replace(/^(?:and|or|with)\s+|\s+(?:and|or|with)$/gi, "")
        .replace(/\ba (?=(?!one\b|one-|uni|use)[aeiou])/gi, "an ")
        // What joined two words cut away: job 184's "autumn/winter chill" left a bare "/".
        .replace(/^[\s/&+]+|[\s/&+]+$/g, "")
        .trim();
      // "where furniture waits before pickup": what happens there is each picture's own words'.
      return PLACE_TIME.test(x) || WRITING.test(x) || /^where\b/i.test(x) ? "" : x;
    })
    .filter(c => /[a-z]{3,}/i.test(c));
  return kept.join(", ");
}

/*
 * A WRITTEN LOOK CARRIES NO LIGHT, WEATHER OR HOUR (round 14, the verification film 412 scene 25). The
 * props list wrote "wild landscape: an open dawn-lit wilderness with low golden light, scattered brush
 * and distant hills", and that look reached the pictures of it twice over: as the key thing's look
 * ("HOW THE WILD LANDSCAPE LOOKS in every picture of this video: … low golden light") and as the props
 * list the prompt writer is told to draw "exactly like this" — "golden low light on distant hills". The
 * check's staged rule (`STAGED_RULE`) counts a golden glow as staged, so no redraw could clear it: four
 * draws for a 2-second shot, shipped flagged. The light, the weather, the season and the hour change
 * from picture to picture and are each picture's own words' (`MEMORY_SETTING_CLAUSE` holds them so for
 * references, `placeLook` for places); a look says what the thing IS. Round 13's staged redraw takes the
 * golden out of a look only once a picture has failed (`plainLight`); this keeps it out of the look
 * itself, wherever a look reaches a prompt — the props list as the writers read it
 * (`sheetWithoutLight`) and every look a picture is drawn by (`pictureLook`). What stays: light the
 * thing HAS ("a small blinking indicator light on its face", "light-catching", "a plain lit screen",
 * "soft matte glow" on pearls), a light colour or wear ("light grey", "light wear", "a light dusting of
 * outdoor residue"), a thing named for a season or the weather ("a heavy canvas winter coat", "a
 * frosted glass globe", "winter plumage"), and a look whose thing IS the weather or the light ("snow:
 * …"). Over the stored films it changes 86 of 1,375 key-thing looks and 107 home lines, every cut
 * light, sky, weather or an hour.
 */
/** Words that only say how light, the sky or the weather is. Never a plain colour: "in light grey" is the thing's. */
const LOOK_LIGHT_QUALITY =
  "soft|softly|dim|dimmed|low|warm|cool|cold|bright|pale|golden|natural|harsh|gentle|faint|diffused?|even|flat|" +
  "fading|dappled|muted|hazy|slanting|ambient|fluorescent|overhead|indoor|outdoor|window|lamp|candle|street|" +
  "sun|moon|blue-gr[ae]y|gr[ae]y-blue|dark|deep|long|early|late|mid|dawn|dusk|twilight|morning|evening|" +
  "afternoon|night|nighttime|night-time|overnight|daytime|pre-dawn|predawn|winter|wintry|summer|autumn|" +
  "autumnal|fall|spring|light|thin|fresh|heavy|clear|open|cloudy|overcast|stormy|temperate|mild|gr[ae]y|silvery|silver|" +
  "sunlight|daylight|lamplight|moonlight|candlelight|firelight";
/** What a light, sky or weather clause is about: the light itself, or the weather — and a cold season's chill. */
const LOOK_LIGHT_HEAD =
  "light|lighting|sunlight|sunshine|daylight|lamplight|moonlight|candlelight|firelight|starlight|glow|shadows?|" +
  "sun|snow|snowfall|frost|rain|rainfall|drizzle|sleet|fog|sky|skies|weather|climate|chill";
/** The hour and the season, said as a time ("at dawn and dusk", "at pre-dawn hours", "through winter"). */
const LOOK_TIME_WORDS =
  "dawn|dusk|sunrise|sunset|daybreak|nightfall|twilight|mornings?|evenings?|afternoons?|nights?|nighttime|" +
  "midnight|midday|noon|daytime|hours?|seasons?|winter|summer|spring|autumn|fall|first|golden hour";
/** What follows the light or weather a clause is about: where it falls, or nothing. */
const LOOK_LIGHT_AFTER =
  "streaming|filtering|spilling|falling|pouring|coming|shining|glowing|flooding|slanting|casting|washing|" +
  "bathing|rising|setting|visible|from|through|in|on|onto|into|across|over|at|above|throughout|everywhere|" +
  "that|which|behind|beyond|around|along|outside|overhead";
/**
 * A clause that is only light, sky or weather: "low golden light", "light filtering through tall
 * windows", "grey sky above". Never a light colour or weight: "light in colour", "light in weight".
 */
const LOOK_LIGHT_CLAUSE = new RegExp(
  `^(?:(?:and|with|in|under|bathed in|lit by)\\s+)?(?:(?:a|an|the|some|its)\\s+)?` +
    `(?:(?:${LOOK_LIGHT_QUALITY})(?:\\s+(?:and|to|or|into)\\s+|\\s+|-|/))*` +
    `(?:${LOOK_LIGHT_HEAD})(?!\\s+in\\s+(?:colou?rs?|tones?|weight|shades?|hues?)\\b)(?:\\s*$|\\s+(?:${LOOK_LIGHT_AFTER})\\b)`,
  "i"
);
/** A clause that only says what light the thing gives off: "casting warm light over the sewing table" (job 348). */
const LOOK_CASTS_LIGHT = new RegExp(
  `^(?:casting|throwing|giving off|shedding|spreading)\\s+(?:(?:${LOOK_LIGHT_QUALITY})\\s+)*(?:light|glow|shadows?)\\b`,
  "i"
);
/** A word of a light, time or weather tail ("with low golden light", "at pre-dawn hours", "under a clear sky"). */
const LOOK_TAIL_WORD = new RegExp(
  `^(?:${LOOK_LIGHT_QUALITY}|${LOOK_LIGHT_HEAD}|${LOOK_TIME_WORDS}|a|an|the|and|or|to|of|its|this|that|layer|blanket|dusting|coat|sheet|blue|gr[ae]y|white|silver|orange|amber|pink)$`,
  "i"
);
/** What a tail must end on to be one: the light, the weather or the time itself — never "in light grey". */
const LOOK_TAIL_END = new RegExp(`^(?:${LOOK_LIGHT_HEAD}|${LOOK_TIME_WORDS})$`, "i");
/**
 * Light said as one describing word: "dawn-lit", "sunlit"; weather left on it: "frost-dusted",
 * "snow-topped" — before what it describes or on its own. "softly lit", "pre-dawn" and the like only
 * before a word: "the screen softly lit" is a screen that is on.
 */
const LOOK_LIT_WORD =
  /\b(?:[a-z]+-lit|sunlit|moonlit|lamplit|candlelit|firelit|starlit|(?:snow|frost|rain|ice|dew)-(?:dusted|covered|topped|capped|soaked|slicked|kissed|crusted|glazed|laden))\b|\b(?:(?:softly|dimly|brightly|warmly|evenly|gently|faintly|barely|well)[\s-]+lit|pre-?dawn|night-?time|(?:late|early|mid)-(?:night|morning|evening|afternoon))\b(?=\s+[a-z])/gi;
/**
 * What lights it: "lit by oil lamp in evening and daylight in afternoon" (job 150), "lit by a warm desk
 * lamp in the evenings" (job 302), a clause "lit warm at evening" (job 207) — never a thing's own light
 * ("a paper lantern lit from within").
 */
const LOOK_LIT_BY = /(?:^|\s+)(?:[a-z]+ly\s+)?(?:lit|lighted|illuminated|warmed)\s+(?:only\s+)?(?:by|with)\b.*$/i;
const LOOK_LIT_ONLY =
  /^(?:[a-z]+ly\s+)?(?:lit|lighted|illuminated)(?:\s+(?:warm|warmly|softly|dimly|brightly|low|only|by|with|at|in|from(?!\s+within))\b|\s*$)/i;
/** What a light or weather cut leaves dangling, besides `DANGLING_CUT`'s: "set (against a cold gray autumn sky)", job 303. */
const LOOK_DANGLING = /(?:(?:^|\s+)(?:set|seen|shown|viewed|framed|placed))+$/i;
/** A clause left only saying how lit or how cold it is ("dim" of "dim at dusk"). */
const ONLY_LIGHT_QUALITY = new RegExp(`^(?:(?:${LOOK_LIGHT_QUALITY})\\s*)+$`, "i");

/**
 * Whether a clause's last words, from a joining word on, are only light, weather or the hour: "with low
 * golden light", "at pre-dawn hours", "through winter", "in fading blue evening light". A season after "a"
 * is a thing ("held shut with a spring"); the tail must end on the light, the weather or the time itself.
 */
function lightTail(tail: string): boolean {
  const words = tail.trim().toLowerCase().split(/\s+/).slice(1);
  if (!words.length || !LOOK_TAIL_END.test(words[words.length - 1])) return false;
  return words.every((w, i) => LOOK_TAIL_WORD.test(w) && !(/^(?:spring|fall)$/.test(w) && /^an?$/.test(words[i - 1] ?? "")));
}

/**
 * A written look without the light, the weather, the season or the hour it was written in (see above):
 * "an open dawn-lit wilderness with low golden light, scattered brush and distant hills" → "an open
 * wilderness, scattered brush and distant hills"; "a quiet bedroom at pre-dawn hours, soft dim
 * blue-grey light, an unmade bed as the central feature" → "a quiet bedroom, an unmade bed as the
 * central feature". A clause that is only light or weather goes ("bright natural light streaming in",
 * "pale morning sky"), a light, weather or time tail is cut from a clause ("closed tight through
 * winter", "dim at dusk"), and so is light said as one word ("dawn-lit", "frost-dusted"). Unchanged —
 * byte for byte — when there is none, and when nothing would be left. Pure.
 */
export function lookWithoutLight(look: string): string {
  if (!look?.trim()) return look;
  const parts = look.split(/(\s*[,;]\s*|\s+[—–]\s+)/);
  let changed = false;
  const kept: { text: string; sep: string }[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sep = i > 0 ? parts[i - 1] : "";
    const clause = parts[i].replace(/[.\s]+$/, "");
    const bare = clause.trim();
    if (LOOK_LIGHT_CLAUSE.test(bare) || LOOK_CASTS_LIGHT.test(bare) || LOOK_LIT_ONLY.test(bare)) {
      changed = true;
      continue;
    }
    // What lights it, then a trailing light, weather or time tail, read from the end ("…, at dawn and dusk").
    let x = clause.replace(LOOK_LIT_BY, "");
    const joins = Array.from(
      x.matchAll(/\s+(?:at|in|during|under|through|throughout|with|by|across|against|beneath|below|before|after)\s+/gi),
      m => m.index!
    );
    for (let k = joins.length - 1; k >= 0 && lightTail(x.slice(joins[k])); k--) x = x.slice(0, joins[k]);
    if (x !== clause) x = x.replace(DANGLING_CUT, "").replace(LOOK_DANGLING, "");
    // A describing word after a comma that was all light leaves its noun to the words before it: "in a
    // modest, dimly lit house" (job 148) → "in a modest house", never "in a modest, house".
    const ledByLight = new RegExp(`^(?:${LOOK_LIT_WORD.source})\\s+[a-z'-]+$`, "i").test(x.trim());
    // An article before a word taken out fits the word now after it: "an early-morning field" → "a field".
    x = x
      .replace(LOOK_LIT_WORD, "\u0001")
      .replace(/\b([Aa])n?\s+\u0001\s*(?=([A-Za-z]))/g, (_m, a: string, next: string) => `${a}${/[aeiou]/i.test(next) ? "n" : ""} `)
      .replace(/\s*\u0001\s*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (x === clause.trim()) {
      kept.push({ text: parts[i].replace(/[.\s]+$/, ""), sep });
      continue;
    }
    changed = true;
    // A clause the cut left with only how lit it is ("dim" of "dim at dusk") is no look either — but a
    // clause that was only ever "thin" or "dark" is the thing's own (job 345's coasters, job 357's dog).
    const left = x.replace(/^(?:and|or|with)\s+|\s+(?:and|or|with)$/gi, "").trim();
    if (!/[a-z]{3,}/i.test(left) || ONLY_LIGHT_QUALITY.test(left)) continue;
    kept.push({ text: x, sep: ledByLight && kept.length && /,/.test(sep) ? " " : sep });
  }
  if (!changed || !kept.length) return look;
  const out = kept.map((k, i) => (i === 0 ? k.text : `${k.sep}${k.text}`)).join("");
  return /\.\s*$/.test(look) ? `${out}.` : out;
}

/** Whether a key thing's name IS a light ("window light", "candle glow"): its look is that light. Pure. */
export function isLightName(name: string | undefined): boolean {
  return !!name?.trim() && /^(?:light|lighting|sunlight|sunshine|daylight|lamplight|moonlight|candlelight|firelight|starlight|glow|shadows?|sun)$/i.test(nameHead(name));
}

/**
 * The props list as the shot list, the line check and the prompt writer read it: every line's look
 * without its light, weather or hour (`lookWithoutLight`) — the home setting's too (job 411's
 * "backyard: …, late fall to winter light", read beside a line about spring). A line whose thing IS
 * the weather or the light ("snow: a thin even layer of white snow …") keeps its look, and so do the
 * people's lines. Unchanged when there is nothing to take out. Pure.
 */
export function sheetWithoutLight(sheet: string | undefined): string {
  if (!sheet?.trim()) return sheet ?? "";
  return sheet
    .split("\n")
    .map(line => {
      const at = line.indexOf(":");
      if (at < 0 || isPersonLine(line) || isViewerLine(line)) return line;
      const name = labelName(line.slice(0, at).replace(/^[-*•\d.)\s]+/, ""));
      if (isWeatherName(name) || isLightName(name)) return line;
      const look = line.slice(at + 1).trim();
      const cut = lookWithoutLight(look);
      return cut === look ? line : `${line.slice(0, at + 1)} ${cut}`;
    })
    .join("\n");
}

/** At most this many things standing in a place are named with it. */
export const MAX_PLACE_THINGS = 3;

/**
 * Whether key thing `t` stands in place `p`: its own look puts it there ("a low wooden-framed bed …,
 * positioned centrally in the bedroom"), or the place's look names it ("an unmade bed as the central
 * feature"). Pure.
 */
function standsIn(t: KeyThing, p: KeyThing): boolean {
  const head = placeBase(nameHead(p.name));
  if (!head) return false;
  const inIt = new RegExp(`\\b(?:in|inside|within)\\s+(?:the|a|an|its|their|his|her)?\\s*(?:[\\w'-]+\\s+){0,2}${head}s?\\b`, "i");
  return inIt.test(t.look) || namesAll(p.look, t.name);
}

/**
 * The written looks picture `s` is held to for where it is set (`placeLooks`): each place it is set in
 * (`placesSetIn`), cut to what it is made of (`placeLook`), then up to `MAX_PLACE_THINGS` key things
 * that stand in one of those places (`standsIn`) and that its own words name — never its own key thing
 * (its look is its own, `keyThingLookFor`), a part it is a close-up of, a place or the weather, a
 * named kind (its exact look wins) or an inside no camera sees. Which of those things a reference
 * picture already shows is for `memoryFor` to say. Pure.
 */
export function placeLooksFor(
  s: StoryboardScene,
  things: KeyThing[] | undefined,
  home?: KeyThing,
  makes = true
): PlaceLook[] {
  const places = (things ?? []).filter(k => isPlaceName(k.name));
  const setIn = placesSetIn(s, places, home);
  if (!setIn.length) return [];
  // A thing standing there is named by what the picture must show (a split's panel), never only by the
  // prompt writer's rewrite: job 409 scene 2's rewrite calls the sympathy card "a plain cream greeting
  // card", the name of the video's OTHER card, whose look must never come along.
  const text = pictureWords(s);
  const out: PlaceLook[] = setIn.flatMap(p => {
    const look = placeLook(p.look);
    return look ? [{ name: p.name, look }] : [];
  });
  let n = 0;
  const own = ownKeyThing(s);
  for (const t of things ?? []) {
    if (n >= MAX_PLACE_THINGS) break;
    if (t.name === own || t.name === s.partOf || lendsNoPicture(t.name) || namedKindIs(s, t.name)) continue;
    // Another one of its kind ("a stray cat on the bed") stands there with no look of the thing's own.
    if (!namesAll(text, t.name) || anotherOfItsKind(text, t)) continue;
    const where = setIn.find(p => standsIn(t, p));
    // Held to the place's rule too: no hour or light of its own ("a tall bedroom window …, framing the
    // quiet night street outside", job 405) — the clause gives those to the picture's own words.
    const look = where ? placeLook(otherThingLookFor(s, t.name, things, makes) ?? "") : "";
    if (!where || !look) continue;
    out.push({ name: t.name, look, in: where.name });
    n++;
  }
  return out;
}

/**
 * The image-prompt line for where a picture is set (`placeLooks`): each place's look, then the looks of
 * the things standing in it. Everything that changes from picture to picture — how much of the place is
 * in view and from where, the season, the weather, the light and the hour — is the picture's own words'.
 * It says so, and that no more of the place is shown than they show: a place's look lists what it holds
 * (job 411's backyard: the lawn, the holly border, the porch light, the storm windows), and every
 * picture drawn with all of it in view would be the one wide yard again — the very copy a reference of
 * the place made. Empty with no place. Pure.
 */
export function placeLookClause(scene: StoryboardScene): string {
  const looks = scene.placeLooks ?? [];
  if (!looks.length) return "";
  const list = looks.map(p => (p.in ? `the ${p.name} in the ${p.in}: ${p.look}` : `the ${p.name}: ${p.look}`)).join("; ");
  return (
    ` WHERE THIS PICTURE IS SET, the same place in every picture of this video set there — ${list}. ` +
    "This says only how that place looks: how much of it is in view and from where, and its season, " +
    "weather, light and time of day, are as this picture's own words say — never more of it than they show."
  );
}

const sourcesOf = new WeakMap<StoryboardScene, StoryboardScene[]>();
const viewOf = new WeakMap<StoryboardScene, string | undefined>();
/** Of `sourcesOf`, the pictures of the scene's OWN thing — its key thing's, or its list's group picture. */
const ownSourcesOf = new WeakMap<StoryboardScene, StoryboardScene[]>();
/** The look a scene is drawn by when no picture of its own thing comes (`keyThingLookFor`). */
const lookOf = new WeakMap<StoryboardScene, string | undefined>();
/** The written looks of every key thing but the scene's own, cut down for it (`otherThingLooksFor`). */
const otherLooksOf = new WeakMap<StoryboardScene, Map<string, string>>();
/** The named kind's look a split's panel takes from the pictures of its thing (`panelNamedLook`). */
const panelLookOf = new WeakMap<StoryboardScene, string | undefined>();
/** The looks of where the scene is set, and of the things standing there (`placeLooksFor`). */
const placeLooksOf = new WeakMap<StoryboardScene, PlaceLook[]>();
/**
 * Of `sourcesOf`, the picture the scene must not repeat (`recomposeFrom`): the one it continues, or
 * the one shown right before it about something else.
 */
const rightBeforeOf = new WeakMap<StoryboardScene, StoryboardScene | undefined>();
/** Scenes whose `rightBeforeOf` picture is one they CONTINUE as the same topic (`continuedPicture`). */
const continuesOf = new WeakSet<StoryboardScene>();
/** The picture the near-copy check always lays beside the scene (`nearCopyPartnerFor`). */
const partnerOf = new WeakMap<StoryboardScene, StoryboardScene | undefined>();
/** Pictures a later picture is drawn from for their OWN key thing (`copiedLater`). */
const copied = new WeakSet<StoryboardScene>();
/** Scenes whose picture is being made in the current pass — only those are worth waiting for. */
const pending = new WeakSet<StoryboardScene>();
const gates = new WeakMap<StoryboardScene, { promise: Promise<void>; open: () => void }>();

function gate(s: StoryboardScene) {
  let g = gates.get(s);
  if (!g) {
    let open!: () => void;
    const promise = new Promise<void>(r => (open = r));
    g = { promise, open };
    gates.set(s, g);
  }
  return g;
}

/**
 * Before a pass renders `rendering` out of the film `board`: remember each scene's memory, the look
 * it is drawn by when it has none, the looks of where it is set (`home`: the props list's home
 * setting, `homePlaceOf`), which pictures later ones copy, and which scenes' pictures are about to be
 * made.
 */
export function attachMemory(
  board: StoryboardScene[],
  rendering: StoryboardScene[] = board,
  keyThings?: KeyThing[],
  home?: KeyThing
): void {
  tagKeyThings(board, keyThings);
  // Whether the video makes something: the shot list stages only pictures of a thing being made.
  const makes = board.some(x => !!x.buildStage);
  keylessMemo = { scenes: board, of: new Map() };
  try {
    attachEach(board, keyThings, home, makes);
  } finally {
    keylessMemo = undefined;
  }
  // A picture is COPIED when a later picture is drawn from it for the thing it is itself about — not
  // a list's group picture its items are cut from, and not a picture lent only for a thing beside it.
  for (const s of board) {
    if (listSetFor(board, s)) continue;
    const things = [s.keyThing, ...(s.otherKeyThings ?? [])];
    for (const src of sourcesOf.get(s) ?? []) {
      const own = ownKeyThing(src);
      if (own && !lendsNoPicture(own) && things.includes(own)) copied.add(src);
    }
  }
  for (const s of rendering) {
    if (!source(s) || s.pictureUrl) continue;
    pending.add(s);
    gates.delete(s); // a fresh gate for this pass
  }
}

/** `attachMemory`'s reading of each scene of `board`. */
function attachEach(board: StoryboardScene[], keyThings: KeyThing[] | undefined, home: KeyThing | undefined, makes: boolean): void {
  for (const s of board) {
    const items = listItemsAround(board, s);
    if (items) s.listItems = items;
    else delete s.listItems;
    const sources = memorySourcesFor(board, s);
    const set = listSetFor(board, s);
    const group = listGroupFor(board, s);
    if (group) s.groupItems = group.map(x => itemWords(x.scriptText ?? x.narration ?? ""));
    else delete s.groupItems;
    sourcesOf.set(s, sources);
    // A reference is never a picture of a PLACE the picture is about (`lendsNoPicture`), whatever it
    // was filed under: told "this exact pharmacy aisle" it would hand its aisle on (job 409 scene 3).
    // A list item's INHERITED key thing is not its own (`ownKeyThing`): a reference that shows it was
    // picked for another thing in it, never for the item. A group picture's items are what it shows.
    // A picture of no key thing has only the picture it continues (`keylessContinued`): its own subject.
    const own = ownKeyThing(s);
    ownSourcesOf.set(
      s,
      sources.filter(
        x =>
          x === set ||
          !!group?.includes(x) ||
          (own ? !lendsNoPicture(own) && shows(x, own) : !s.keyThing && x === keylessContinued(board, s))
      )
    );
    viewOf.set(s, memoryViewFor(board, s));
    lookOf.set(s, keyThingLookFor(s, keyThings, makes));
    otherLooksOf.set(s, otherThingLooksFor(s, keyThings, makes));
    placeLooksOf.set(s, placeLooksFor(s, keyThings, home, makes));
    // Never cleared here: the still loop sets it too, on a picture the check saw cut open.
    if (hiddenInside(s, keyThings)) s.seenFromOutside = true;
    panelLookOf.set(s, panelNamedLook(board, s));
    const re = recomposeFrom(board, s, sources);
    rightBeforeOf.set(s, re?.from);
    if (re?.continues) continuesOf.add(s);
    else continuesOf.delete(s);
    partnerOf.set(s, nearCopyPartnerFor(board, s, sources));
    copied.delete(s);
  }
}

/**
 * Whether a pass over the film has seen `s` (`attachMemory`): only then does `memoryFor` know its
 * pictures and its look. A copy made after — a split's panel, drawn as a scene of its own — is known
 * to nobody, and its memory is what its caller gave it (`withSplitMemory`).
 */
export function memoryAttached(s: StoryboardScene): boolean {
  return sourcesOf.has(s);
}

/** The camera position `s` is drawn from when it has a memory (`memoryViewFor`). */
export function memoryView(s: StoryboardScene): string | undefined {
  return viewOf.get(s);
}

/**
 * The named kind's look the panel of split `s` is drawn by (`panelNamedLook`), as the last
 * `attachMemory` over its film found it; undefined for a scene no pass has seen.
 */
export function panelLook(s: StoryboardScene): string | undefined {
  return panelLookOf.get(s);
}

/**
 * The picture the near-copy check always lays beside `s` (`nearCopyPartnerFor`), as the last
 * `attachMemory` over its film found it; undefined for a scene no pass has seen.
 */
export function nearCopyPartner(s: StoryboardScene): StoryboardScene | undefined {
  return partnerOf.get(s);
}

/** Whether a later picture is drawn from `s` for the key thing `s` is about (`attachMemory`). */
export function copiedLater(s: StoryboardScene): boolean {
  return copied.has(s);
}

/**
 * The look the picture CHECK holds `s` to, or undefined: only a picture that later pictures copy and
 * that had no picture of its own thing to follow (`scene.keyThingLook` set at render) — the look is
 * then the only thing that decides how every copy looks, so a first picture that misses it is drawn
 * again on the check it already gets (`requiredThingsQuestion`), not copied into every later one.
 * Never a named kind's picture: its exact look wins in the prompt (`keyThingLookClause`), and a
 * check holding it to a look its prompt never carried would fail it for not drawing what was not
 * asked (the exact-look question holds it instead).
 */
export function lookToHold(s: StoryboardScene): { thing: string; look: string } | undefined {
  const own = ownKeyThing(s);
  return own && s.keyThingLook && !s.namedLook && copied.has(s)
    ? { thing: own, look: s.keyThingLook }
    : undefined;
}

/** `s`'s picture is made — or its render ended without one: anything drawn from it may go on. */
export function pictureSettled(s: StoryboardScene): void {
  pending.delete(s);
  gate(s).open();
}

/** Wait — at most `timeoutMs` — for `src`'s picture when it is still being made in this pass. */
async function madeOrTimedOut(src: StoryboardScene, timeoutMs: number): Promise<void> {
  if (src.pictureUrl || !pending.has(src)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([gate(src).promise, new Promise<void>(r => (timer = setTimeout(r, timeoutMs)))]);
  if (timer) clearTimeout(timer);
}

/**
 * The pictures `s` is drawn from, waiting (at most `timeoutMs`) for one still being made in this
 * pass. A memory that never came is skipped — the picture is then drawn from words, as before — and
 * so is one whose own check said its thing is not in it (`memoryUnfit`, set when it settled in this
 * same pass). `own` says whether any of them is a picture of `s`'s own thing; when none is, `look`
 * is the look it is drawn by instead (`keyThingLookFor`). When one is, `wordsLook` is that same look,
 * kept for a redraw from words should the picture copy its memory (`memoryToWords`). `before` is
 * where in `urls` the picture `s` must not repeat is (`recomposeFrom`): the one shown right before
 * it about something else, or — `continues` — the one it continues as the same topic. `notShown` is
 * the other key things of `s` that none of them shows (`memoryNotShown`). `otherLooks` is the written
 * looks of the other key things its own words name, kept for a redraw from words (`lentLooks`).
 * `placeLooks` is the looks of where it is set (`placeLooksFor`), with or without references — less any
 * thing standing there that one of them shows, which the reference carries.
 */
export async function memoryFor(
  s: StoryboardScene,
  timeoutMs = MEMORY_WAIT_MS
): Promise<{
  urls: string[];
  own: boolean;
  look?: string;
  wordsLook?: string;
  before?: number;
  continues?: boolean;
  notShown?: string[];
  refs?: MemoryRef[];
  otherLooks?: ThingLook[];
  placeLooks?: PlaceLook[];
}> {
  const urls: string[] = [];
  const refs: MemoryRef[] = [];
  const used: StoryboardScene[] = [];
  const mine = ownSourcesOf.get(s) ?? [];
  const prev = rightBeforeOf.get(s);
  let own = false;
  let before: number | undefined;
  // THE PICTURE IT MUST NOT REPEAT IS MADE FIRST (round 14, job 413 scenes 15-16): the near-copy check
  // lays it beside this one (`nearCopyPartner`) but only once it is drawn and remembered, and two
  // pictures of one phone call, neither drawn from the other, were drawn at the same moment. A partner
  // that is no memory picture of this one is waited for the same way — always an earlier scene
  // (`nearCopyPartnerFor`), so nothing waits on itself. Only while that check runs (`PICTURE_VARIETY`).
  const partner = partnerOf.get(s);
  if (partner && process.env.PICTURE_VARIETY !== "0") await madeOrTimedOut(partner, timeoutMs);
  for (const src of sourcesOf.get(s) ?? []) {
    await madeOrTimedOut(src, timeoutMs);
    if (!src.pictureUrl || src.memoryUnfit) continue;
    used.push(src);
    // Which of this picture's other key things the reference shows: a redraw that drops one reference
    // (`withoutMemoryRef`) knows which of them no reference shows any more. Never a place: job 411
    // scene 12's robin references stand on the lawn, and "draw the SAME robin and lawn" would copy the
    // yard they stand in — a place is drawn as this picture's own words describe it (`notShownClause`).
    const shown = (s.otherKeyThings ?? []).filter(t => !lendsNoPicture(t) && shows(src, t));
    const at = urls.indexOf(src.pictureUrl);
    if (at >= 0) {
      const more = shown.filter(t => !refs[at].shows?.includes(t));
      if (more.length) refs[at] = { ...refs[at], shows: [...(refs[at].shows ?? []), ...more] };
      continue;
    }
    urls.push(src.pictureUrl);
    refs.push({
      index: src.index,
      ...(mine.includes(src) ? { own: true as const } : {}),
      ...(shown.length ? { shows: shown } : {}),
    });
    if (mine.includes(src)) own = true;
    if (src === prev) before = urls.length - 1;
  }
  const look = lookOf.get(s);
  // A key thing beside it that no picture among these shows (job 404 scene 14: the robin's two lawn
  // pictures, and "gulf coast yard" in its own words) is not one the references can lend.
  const notShown = urls.length
    ? (s.otherKeyThings ?? []).filter(t => lendsNoPicture(t) || !used.some(x => shows(x, t)))
    : [];
  const otherLooks = urls.length ? lentLooks(s) : [];
  // A thing standing where it is set that a reference shows is carried by that reference: a written
  // look beside it only sets up a conflict (`keyThingLookFor`).
  const placeLooks = (placeLooksOf.get(s) ?? []).filter(p => !p.in || !used.some(x => shows(x, p.name)));
  return {
    urls,
    own,
    look: own ? undefined : look,
    wordsLook: own ? look : undefined,
    before,
    ...(before != null && continuesOf.has(s) ? { continues: true } : {}),
    ...(notShown.length ? { notShown } : {}),
    ...(refs.length ? { refs } : {}),
    ...(otherLooks.length ? { otherLooks } : {}),
    ...(placeLooks.length ? { placeLooks } : {}),
  };
}

/**
 * The written looks a picture drawn from memory keeps for a redraw from words (`otherThingLooks`,
 * `memoryToWords`): those of the other key things its OWN words name (`otherKeyThings`), looked up on
 * the looks the last pass over the film cut for it (`otherThingLooksFor`); a thing with no written look
 * is left out.
 * NEVER A THING THAT ONLY STOOD IN A REFERENCE (round 13 review). Job 408's toilet panels (scenes 12 and
 * 16) were drawn from the toilet's pictures with the white lidded bin beside it and came back with a
 * pedal bin, but writing in the look of every key thing a reference showed — even said as "should it be
 * in this picture" — changed the prompt of half the memory pictures of the stored films (131 of 260 in
 * jobs 395-414), and many of those things are PLACES or the video's main thing: job 404 scene 14, "a
 * robin standing in a mild gulf coast yard with palm trees", would have been handed the northern lawn's
 * "green fading to frost-dusted brown" — the snow under palms the setting rule took out
 * (`MEMORY_SETTING_CLAUSE`) — job 411 scene 18, "the empty backyard lawn", the robin, and job 412
 * scene 31's "unmade bed … empty and unattended" the cat. What is in a picture is up to its own words.
 * Pure apart from that lookup.
 */
function lentLooks(s: StoryboardScene): ThingLook[] {
  const looks = otherLooksOf.get(s);
  if (!looks?.size) return [];
  return (s.otherKeyThings ?? []).flatMap(name => (looks.has(name) ? [{ name, look: looks.get(name)! }] : []));
}

/** The pictures `s` is drawn from (`memoryFor`). */
export async function memoryPicturesFor(
  s: StoryboardScene,
  timeoutMs = MEMORY_WAIT_MS
): Promise<string[]> {
  return (await memoryFor(s, timeoutMs)).urls;
}
