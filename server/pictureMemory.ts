/**
 * PICTURE MEMORY (2026-09-30, the operator: "if we are going scene to scene like a different pov,
 * we can show the same one, like it can have a memory, just a different angle … the same heater").
 * Every picture is drawn from words alone, so Frederick's heater at 0:45 was a different heater
 * from the one at 0:20. A picture of a KEY THING (`scene.keyThing`, from the shot list) is now
 * drawn FROM the earlier pictures of that thing: the first one (its memory) and the latest one
 * before it (so a before → during → after is the same piece further along). Pictures are made in
 * parallel, so a picture whose memory is still being made in this pass waits for it —
 * `MEMORY_WAIT_MS` at most, then it is drawn from words as before. Waits only ever point to an
 * EARLIER scene, and the dispatcher hands scenes out in film order, so the earliest waiting scene's
 * memory is always already running: nothing can wait on itself.
 */
import { PART_VIEW } from "./namedLooks";
import type { KeyThing, StoryboardScene } from "@shared/types";
import { keyThingsIn, SHOWS_SCREEN } from "./shotList";

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
 * latest one before `s` when that is a different picture. Empty when `s` shows no key thing or is
 * its first picture. Pure — unit-tested.
 */
export function memorySourcesFor(
  scenes: StoryboardScene[],
  s: StoryboardScene
): StoryboardScene[] {
  // A list item after a group picture of its list is drawn FROM that group picture, so the
  // close-up is the same machine, cutter or pile as in the group (`listSetFor`).
  const set = listSetFor(scenes, s);
  if (set) return [set];
  if (!s.keyThing || !drawn(s)) return [];
  // A SCREEN picture gets its item's memory for what is ON the screen only (`SCREEN_ITEM_VIEW`): with
  // none, Dale's bookcase listing showed four random items (job 306); told to draw "the SAME" board
  // as an object, the picture maker built the tablet out of it (job 295). A screen is still never a
  // memory SOURCE (below).
  const i = scenes.indexOf(s);
  if (i <= 0) return [];
  // A list item is never drawn from another item's picture: each item is its own thing.
  // …nor is a screen ever a memory SOURCE: the thing on it is a small photo, not the thing.
  const before = scenes.slice(0, i).filter(x => source(x) && !isScreen(x) && !(s.listCut && x.listCut));
  const out: StoryboardScene[] = [];
  const add = (x: StoryboardScene | undefined) => {
    if (x && !out.includes(x) && out.length < MAX_MEMORY_REFS) out.push(x);
  };
  // Its own thing: the first picture (the memory) and the latest before it.
  const same = before.filter(x => shows(x, s.keyThing!));
  add(same[0]);
  add(same[same.length - 1]);
  // Every other key thing in it: that thing's first picture (the heater beside the mattress).
  for (const t of s.otherKeyThings ?? []) add(before.find(x => shows(x, t)));
  return out;
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

/** A picture of a phone, tablet or laptop screen (its own words, or a split panel's). */
const isScreen = (s: StoryboardScene) =>
  SHOWS_SCREEN.test(s.hostPresent ? s.splitVisual ?? "" : s.showSubject ?? s.visualPrompt ?? "");

/** At most this many memory pictures go with one picture (the host photo may follow them). */
export const MAX_MEMORY_REFS = 3;

/** Whether a picture shows key thing `t` — as its own thing, or beside it. */
const shows = (x: StoryboardScene, t: string) =>
  x.keyThing === t || !!x.otherKeyThings?.includes(t);

/**
 * The camera position of `s` when it is drawn from memory: the next of `MEMORY_VIEWS` after the
 * pictures of its key thing before it, so two in a row never share one. Undefined for the memory
 * picture itself, and for a picture of no key thing. Pure.
 */
export function memoryViewFor(scenes: StoryboardScene[], s: StoryboardScene): string | undefined {
  if (listSetFor(scenes, s)) return SET_ITEM_VIEW;
  if (isScreen(s) && s.keyThing && drawn(s)) return SCREEN_ITEM_VIEW;
  if (!s.keyThing || !drawn(s)) return undefined;
  const i = scenes.indexOf(s);
  const before = scenes.slice(0, Math.max(0, i)).filter(x => source(x) && shows(x, s.keyThing!)).length;
  if (before === 0) return undefined;
  // A remembered thing beside what the picture is about stays beside it (`isSubject`): the same
  // thing, at its natural size — never the close view the rotation would give the subject.
  // A picture of one PART of it (`partOf`) is about that part, whatever order the words name them in.
  if (!s.partOf && !isSubject(s, s.keyThing)) return BACKGROUND_VIEW;
  // The picture's OWN framing decides first (`shotFraming`): one part of the thing, or a close view
  // its words ask for, is a close-up — never "a few steps further back" or "the other side", which
  // drew Ruth's "a bear paw there" as the whole quilt (job 298) while its words said "close view".
  // Printing that must stay unreadable is never a close-up of the print (`BLUR_PRINT_VIEW`).
  if (shotFraming(s) === "close") return s.blurPrint ? BLUR_PRINT_VIEW : PART_VIEW;
  return MEMORY_VIEWS[(before - 1) % MEMORY_VIEWS.length];
}

/**
 * Tag every drawn picture the shot list did not tag with the key thing its description names —
 * a split's panel (`splitVisual`), the QR background, a storyboard picture (`keyThingIn`). Returns
 * how many it tagged. Pure apart from mutating `scenes`.
 */
export function tagKeyThings(scenes: StoryboardScene[], things: KeyThing[] | undefined): number {
  if (!things?.length) return 0;
  let n = 0;
  for (const s of scenes) {
    if (!drawn(s)) continue;
    const text = s.hostPresent ? s.splitVisual : (s.showSubject ?? s.visualPrompt);
    const named = keyThingsIn(text, things).map(t => t.name);
    if (!s.keyThing && named[0]) {
      s.keyThing = named[0];
      n++;
    }
    // Every other key thing the picture names is remembered too.
    const others = named.filter(name => name !== s.keyThing);
    s.otherKeyThings = others.length ? others : undefined;
  }
  return n;
}

const sourcesOf = new WeakMap<StoryboardScene, StoryboardScene[]>();
const viewOf = new WeakMap<StoryboardScene, string | undefined>();
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
 * Before a pass renders `rendering` out of the film `board`: remember each scene's memory, and
 * which scenes' pictures are about to be made.
 */
export function attachMemory(
  board: StoryboardScene[],
  rendering: StoryboardScene[] = board,
  keyThings?: KeyThing[]
): void {
  tagKeyThings(board, keyThings);
  for (const s of board) {
    sourcesOf.set(s, memorySourcesFor(board, s));
    viewOf.set(s, memoryViewFor(board, s));
  }
  for (const s of rendering) {
    if (!source(s) || s.pictureUrl) continue;
    pending.add(s);
    gates.delete(s); // a fresh gate for this pass
  }
}

/** The camera position `s` is drawn from when it has a memory (`memoryViewFor`). */
export function memoryView(s: StoryboardScene): string | undefined {
  return viewOf.get(s);
}

/** `s`'s picture is made — or its render ended without one: anything drawn from it may go on. */
export function pictureSettled(s: StoryboardScene): void {
  pending.delete(s);
  gate(s).open();
}

/**
 * The pictures `s` is drawn from, waiting (at most `timeoutMs`) for one still being made in this
 * pass. A memory that never came is skipped — the picture is then drawn from words, as before.
 */
export async function memoryPicturesFor(
  s: StoryboardScene,
  timeoutMs = MEMORY_WAIT_MS
): Promise<string[]> {
  const urls: string[] = [];
  for (const src of sourcesOf.get(s) ?? []) {
    if (!src.pictureUrl && pending.has(src)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        gate(src).promise,
        new Promise<void>(r => (timer = setTimeout(r, timeoutMs))),
      ]);
      if (timer) clearTimeout(timer);
    }
    if (src.pictureUrl && !urls.includes(src.pictureUrl)) urls.push(src.pictureUrl);
  }
  return urls;
}
