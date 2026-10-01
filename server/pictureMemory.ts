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
import { keyThingsIn } from "./shotList";

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
  if (!s.keyThing || !drawn(s)) return [];
  const i = scenes.indexOf(s);
  if (i <= 0) return [];
  const before = scenes.slice(0, i).filter(source);
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
  if (!s.keyThing || !drawn(s)) return undefined;
  const i = scenes.indexOf(s);
  const before = scenes.slice(0, Math.max(0, i)).filter(x => source(x) && shows(x, s.keyThing!)).length;
  if (before === 0) return undefined;
  // One part of the thing (`partOf`): a close-up of that part, never a new view of the whole.
  return s.partOf ? PART_VIEW : MEMORY_VIEWS[(before - 1) % MEMORY_VIEWS.length];
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
