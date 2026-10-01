/**
 * NAMED THINGS, DRAWN EXACTLY (2026-10-01, the operator on Granny Ruth's practice film, job 281:
 * "a churn dash here, a bear paw there, a flying geese row across the middle" came back as three
 * near-copies of one folded quilt, none showing the block it named). Three failures:
 *  1. Nobody knew what the names look like — the shot list wrote "a churn dash block, pinwheel
 *     pattern of triangles" (wrong), and the picture maker does not know the names either.
 *  2. A picture about ONE PART of a remembered thing was drawn as the whole thing again: the
 *     blocks were tied to the sampler quilt, so picture memory copied the quilt.
 *  3. The quick still checker cannot tell a churn dash from any other block, so it passed them.
 *
 * `describeNamedLooks` — one call per film (≤150 pictures a batch), on the final pictures, before
 * anything is paid for — finds every specific NAMED KIND a picture shows (a quilt block, a stitch,
 * a joint, a knot, a braid, a breed, a dish…) and writes exactly how it looks, so it can be drawn
 * without knowing the name; and marks a picture about one part of a key thing (`partOf`). The look
 * rides into the image prompt (`namedLookClause`) and the still checker (`scanStillDefects`'
 * exact-look question, on a stronger model); a part is drawn as a close-up of that part from its
 * thing's memory (`PART_VIEW`). Nothing here names a channel or a craft. Any failure changes nothing.
 */
import type { KeyThing, StoryboardScene } from "@shared/types";
import { invokeClaude } from "./claude";
import { safeParseJSON } from "./jsonRepair";
import { SHOWS_PERSON } from "./hostLook";
import { blurredPrint, matchKeyThing, settleVideoKind } from "./shotList";

const NAMED_LOOK_MODEL = () => process.env.NAMED_LOOK_MODEL || "claude-opus-5-5";

export interface NamedKind {
  name: string;
  look: string;
}
export interface NamedLookAnswer {
  kinds: NamedKind[];
  pictures: { id: number; kind?: string; partOf?: string; show?: string }[];
}

export const NAMED_LOOKS_SYSTEM = `You prepare the pictures of a video for a picture maker that does
not know the names of specific kinds of things. You read the pictures, one per line: "#id: said
<narration> | shows: <planned picture>", and the video's KEY THINGS.

1. NAMED KINDS. Find every specific NAMED KIND a picture is about — a named variety whose look a
picture maker could not draw from its name alone, or would draw wrong: a quilt block or pattern, a
stitch, a knot, a weave, a joint, a braid or haircut, a breed, a plant variety, a dish, a style of
furniture or building. Not everyday things (a saw, a bowl, a chair). For each, write its LOOK
exactly enough to draw it without knowing the name: the shapes, how many of each, how they are
arranged, which parts are light and which dark, its size. Correct any planned description that gets
it wrong. Leave out a kind when you are not sure how it looks — never invent.

A REAL, RECOGNISABLE thing the LINE names — an app, a website, a store, a market or fair, a product
line — is a named kind too, even when the planned picture calls it something generic ("a buy-and-sell
app"): its LOOK is how it really looks — its real colours, layout and style (for an app: the screen
on a phone, its real colour bars, how its items are laid out). Its logo and any words in it are
small, soft and unreadable: write that into the look.

2. A PART OF A KEY THING. When a picture's line is about ONE PART or detail of a key thing (one block
on the quilt, a knob on the stove, one joint of the frame), name that key thing as part_of: the
picture is then a close-up of just that part, never the whole thing again.

3. For every picture you name a kind or a part for, write "show": a short, plain description of the
picture — what fills the frame, close up when it is a part — using the exact look, one thing only.

A picture of someone DOING something (hands sewing, stitching, cutting, cooking) keeps the person and
what they are doing: never turn it into a close-up of a part, never give it part_of — only name the
kind it shows, and keep the hands in its "show". A picture marked "list item" is one item of a spoken
list: it is its own thing, never part_of anything.

Answer with JSON only:
{"kinds":[{"name":"…","look":"…"}],"pictures":[{"id":<number>,"kind":"<a kind's name or omit>","part_of":"<a key thing or omit>","show":"…"}]}
{"kinds":[],"pictures":[]} when nothing applies.`;

/** The pictures the step reads: every drawn cutaway (not the host, a cover or an operator's asset). */
export function namedLookCandidates(scenes: StoryboardScene[]): number[] {
  const out: number[] = [];
  scenes.forEach((s, i) => {
    if (s.hostPresent || s.coverHero || s.assetImageUrl) return;
    if (s.showSubject || s.visualPrompt) out.push(i);
  });
  return out;
}

/** Read the model's answer; ids are read as 12, "12" or "#12". Null when it is not JSON. Pure. */
export function parseNamedLooks(text: string): NamedLookAnswer | null {
  const r = safeParseJSON<{ kinds?: unknown; pictures?: unknown }>(text);
  const d = r.success ? r.data : null;
  if (!d || !Array.isArray(d.kinds) || !Array.isArray(d.pictures)) return null;
  const kinds = (d.kinds as { name?: unknown; look?: unknown }[])
    .map(k => ({ name: String(k?.name ?? "").trim(), look: String(k?.look ?? "").trim() }))
    .filter(k => k.name && k.look.split(/\s+/).length >= 6);
  const pictures = (d.pictures as Record<string, unknown>[])
    .map(p => ({
      id: Number(String(p?.id ?? "").replace(/^#/, "")),
      kind: p?.kind ? String(p.kind).trim() : undefined,
      partOf: p?.part_of ? String(p.part_of).trim() : undefined,
      show: p?.show ? String(p.show).trim() : undefined,
    }))
    .filter(p => Number.isInteger(p.id));
  return { kinds, pictures };
}

/**
 * Put an answer on the pictures it was asked about (`asked`, indexes into `scenes`): the exact look
 * of the kind a picture shows (`namedLook`), the key thing it is a part of (`partOf`, a close-up of
 * that part drawn from the thing's memory) and its rewritten description. A kind with no look, or a
 * part of something that is not a key thing, is ignored. Returns how many pictures changed. Pure
 * apart from mutating `scenes`.
 */
export function applyNamedLooks(
  scenes: StoryboardScene[],
  asked: number[],
  answer: NamedLookAnswer,
  things: KeyThing[] | undefined
): number {
  const ok = new Set(asked);
  const lookOf = new Map(answer.kinds.map(k => [k.name.toLowerCase(), k]));
  let n = 0;
  for (const p of answer.pictures) {
    const s = scenes[p.id];
    if (!s || !ok.has(p.id)) continue;
    const kind = p.kind ? lookOf.get(p.kind.toLowerCase()) : undefined;
    // A picture of someone at work keeps the person: it is never made a close-up of a part, and a
    // rewrite that drops the person is not used (only the exact look is kept).
    const atWork = !!s.humanPresent || SHOWS_PERSON.test(s.showSubject ?? s.visualPrompt ?? "");
    // A list item is its own thing, never one part of a group — Dale's job 290 drew "house signs,"
    // from the "engraved boards," picture before it as a "part" of one pile, and got the same board.
    const part = p.partOf && !atWork && !s.listCut ? matchKeyThing(p.partOf, things ?? []) : null;
    if (atWork && p.show && !SHOWS_PERSON.test(p.show)) p.show = undefined;
    if (!kind && !part) continue;
    s.namedLook = kind ? `${kind.name}: ${kind.look}` : undefined;
    if (part) {
      s.partOf = part.name;
      s.keyThing = part.name;
    }
    if (p.show) {
      s.showSubject = p.show;
      s.visualPrompt = p.show;
      s.visualPromptSeed = undefined;
      s.brollVisual = undefined;
      s.humanPresent = SHOWS_PERSON.test(p.show) ? true : undefined;
      // Writing the line does not say is shown soft and unreadable, like every other rewrite.
      s.blurPrint = !s.pictureText && blurredPrint(p.show) ? true : undefined;
      // Judged again on the new description (`judgeSelfMoving`), like any rewritten picture.
      s.selfMoving = undefined;
      settleVideoKind(s);
    }
    n++;
  }
  return n;
}

/**
 * Find the named kinds and parts in the film's pictures and put their exact looks on them. One call
 * per 150 pictures; a failed call changes nothing for its pictures. Never throws.
 */
export async function describeNamedLooks(
  scenes: StoryboardScene[],
  opts: {
    keyThings?: KeyThing[];
    subject?: string;
    ask?: (system: string, user: string) => Promise<string>;
  } = {}
): Promise<{ kinds: number; pictures: number; parts: number }> {
  const ask =
    opts.ask ??
    (async (system: string, user: string) =>
      (await invokeClaude({ systemPrompt: system, userMessage: user, maxTokens: 16000, model: NAMED_LOOK_MODEL() })).text);
  const all = namedLookCandidates(scenes);
  const BATCH = 150;
  let kinds = 0;
  let pictures = 0;
  for (let from = 0; from < all.length; from += BATCH) {
    const ids = all.slice(from, from + BATCH);
    const lines = ids.map(i => {
      const s = scenes[i];
      const said = (s.scriptText ?? "").trim().replace(/\s+/g, " ");
      return `#${i}${s.listCut ? " (list item)" : ""}: said "${said}" | shows: ${s.showSubject ?? s.visualPrompt ?? ""}`;
    });
    try {
      const answer = parseNamedLooks(
        await ask(
          NAMED_LOOKS_SYSTEM,
          (opts.subject ? `VIDEO SUBJECT: ${opts.subject}\n` : "") +
            (opts.keyThings?.length ? `KEY THINGS: ${opts.keyThings.map(k => `${k.name}: ${k.look}`).join(" | ")}\n` : "") +
            `\n${lines.join("\n")}\n\nJSON:`
        )
      );
      if (!answer) continue;
      kinds += answer.kinds.length;
      pictures += applyNamedLooks(scenes, ids, answer, opts.keyThings);
    } catch {
      /* a failed call changes nothing */
    }
  }
  return { kinds, pictures, parts: scenes.filter(s => s.partOf).length };
}

/** The image-prompt line that carries a picture's exact look. Empty when it has none. */
export function namedLookClause(scene: StoryboardScene): string {
  return scene.namedLook
    ? ` EXACT LOOK — ${scene.namedLook}. Draw it exactly like this, whatever any other words say about its pattern or shape.`
    : "";
}

/** The camera position of a picture about one part of a remembered thing (`partOf`). */
export const PART_VIEW =
  "a close-up that fills the whole frame with just the part this picture is about — the rest of it barely shows";
