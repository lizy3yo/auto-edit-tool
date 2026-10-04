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
import { blurredPrint, matchKeyThing, planningEffort, settleVideoKind } from "./shotList";

const NAMED_LOOK_MODEL = () => process.env.NAMED_LOOK_MODEL || "claude-opus-5-5";

export interface NamedKind {
  name: string;
  look: string;
}
export interface NamedLookAnswer {
  kinds: NamedKind[];
  pictures: { id: number; kind?: string; partOf?: string; show?: string; text?: string }[];
}

/** What the script says is shown on a thing: "the box's label: Photoelectric, 10-Year Sealed Battery…". */
export interface ShownFact {
  thing: string;
  words: string[];
}

export const SHOWN_FACTS_SYSTEM = `You read a video script and list what it says is ON things a viewer
could read: what a label, box, package, sign or dial covers or tells you — the script often names it
in passing ("First thing on the label. The type. … Photoelectric", "Second thing. Power. … a sealed
10-year unit") rather than quoting the print. For each thing (its part included, "the smoke alarm
box's label"): the few short items it shows, written the way a real label would print them, using
ONLY the script's own words ("Photoelectric", "Sealed 10-Year Battery", "Interconnected"). A date or
setting the script gives counts too. Never invent a word, a brand, a number or a rating the script
does not say.

Answer with JSON only: {"facts":[{"thing":"…","words":["…","…"]}]} — {"facts":[]} when none.`;

/**
 * A test for "every word of this is the script's own": each word is in the script, or shares its
 * stem with a script word ("Interconnected" ~ "interconnection", "10-Year" ~ "10-year"). Pure.
 */
export function scriptWords(script: string): (text: string) => boolean {
  const words = script.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const exact = new Set(words);
  const stems = new Set(words.filter(w => w.length >= 6).map(w => w.slice(0, 6)));
  return (text: string) =>
    !!script &&
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).every(
      t => exact.has(t) || (t.length >= 6 && stems.has(t.slice(0, 6)))
    );
}

/** Keep a fact's words only when every word of them is the script's own (`scriptWords`). Pure. */
export function parseShownFacts(text: string, script: string): ShownFact[] {
  const r = safeParseJSON<{ facts?: unknown }>(text);
  const d = r.success ? r.data : null;
  if (!d || !Array.isArray(d.facts)) return [];
  const inScript = scriptWords(script);
  return (d.facts as { thing?: unknown; words?: unknown }[])
    .map(f => ({
      thing: String(f?.thing ?? "").trim(),
      words: (Array.isArray(f?.words) ? f.words : []).map(w => String(w ?? "").trim()).filter(w => w && inScript(w)),
    }))
    .filter(f => f.thing && f.words.length);
}

/** One call over the whole script; a failure means none. Never throws. */
export async function collectShownFacts(
  script: string,
  ask: (system: string, user: string) => Promise<string> = async (system, user) =>
    (await invokeClaude({ systemPrompt: system, userMessage: user, maxTokens: 4000, model: NAMED_LOOK_MODEL(), effort: planningEffort("NAMED_LOOK_EFFORT"), step: "Named things" })).text
): Promise<ShownFact[]> {
  try {
    return parseShownFacts(await ask(SHOWN_FACTS_SYSTEM, `${script.slice(0, 60000)}\n\nJSON:`), script);
  } catch {
    return [];
  }
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
small, soft and unreadable: write that into the look. Say where its words sit as "soft grey bars",
never as a title, a name or a price — a look that asks for "a bold price line" gets a readable price.

A BODY PART NEVER LOOKS CUT OFF: hair, a hand, a foot or a face is shown on the person, or on what really holds it — a wig on a mannequin head or wig stand, a practice hand, extensions in their packet. A few loose strands that really fall (in a brush, on a comb or towel, in a drain) are fine. Never hair still shaped like a head or a hairstyle with no head inside it, and never a hand, foot or face on its own. To show a colour or texture, show it on the person's own head or hands.

2. A PART OF A KEY THING. When a picture's line is about ONE PART or detail of a key thing (one block
on the quilt, a knob on the stove, one joint of the frame), name that key thing as part_of: the
picture is then a close-up of just that part, never the whole thing again.

3. For every picture you name a kind or a part for, write "show": a short, plain description of the
picture — what fills the frame, close up when it is a part — using the exact look, one thing only.

4. SHOW EXACTLY WHAT THE LINE POINTS AT: when a line points at a specific thing, or a specific part, side or detail of a thing (the box it comes in, its label, the battery door on the back, the dial, the date on the bottom, the hem), the picture is a close-up of exactly that — never the video's main thing somewhere else, never a plain version without it. What the script says that part shows (the words printed on it, a number, a setting) is shown exactly as the script says it. For such a picture write "show" as that close-up, and "text": the exact words the SCRIPT
says are shown on that part (take them only from WHAT THE SCRIPT SAYS IS SHOWN, never invent, never
add a word); omit text when the script names none.

A picture of someone DOING something (hands sewing, stitching, cutting, cooking) keeps the person and
what they are doing: never turn it into a close-up of a part, never give it part_of — only name the
kind it shows, and keep the hands in its "show". A picture marked "list item" is one item of a spoken
list: it is part_of a key thing only when it is a physical PART of that one thing (one block on the
quilt, one drawer of the dresser); items that are separate things of their own (a board, a sign, a
box — even when the key thing names them as a group or pile) are never part_of anything.

Answer with JSON only:
{"kinds":[{"name":"…","look":"…"}],"pictures":[{"id":<number>,"kind":"<a kind's name or omit>","part_of":"<a key thing or omit>","show":"…","text":"<exact script words or omit>"}]}
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
      text: p?.text ? String(p.text).trim() : undefined,
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
  things: KeyThing[] | undefined,
  /** The script's own words: a picture's text is kept only when every word of it is in there. */
  script?: string
): number {
  const inScript = scriptWords(script ?? "");
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
    // A list item may be a PART of one thing ("a churn dash here" on the quilt — Ruth's job 298 drew
    // the whole quilt when this was refused); separate things in a list are kept apart by the model's
    // own rule above and by memory, which never draws an item from the item before it.
    const part = p.partOf && !atWork ? matchKeyThing(p.partOf, things ?? []) : null;
    if (atWork && p.show && !SHOWS_PERSON.test(p.show)) p.show = undefined;
    // Words the SCRIPT says this part shows: readable and exact on it (Frederick's job 329: "First
    // thing on the label. The type." drew a stack of plain boxes).
    if (p.text && inScript(p.text)) {
      s.pictureText = p.text;
      s.blurPrint = undefined;
    }
    if (!kind && !part && !p.show) continue;
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
    /** The whole script: what it says is shown on things, and the check on every picture's text. */
    script?: string;
    facts?: ShownFact[];
    ask?: (system: string, user: string) => Promise<string>;
  } = {}
): Promise<{ kinds: number; pictures: number; parts: number }> {
  const ask =
    opts.ask ??
    (async (system: string, user: string) =>
      (await invokeClaude({ systemPrompt: system, userMessage: user, maxTokens: 16000, model: NAMED_LOOK_MODEL(), effort: planningEffort("NAMED_LOOK_EFFORT"), step: "Named things" })).text);
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
            (opts.facts?.length
              ? `WHAT THE SCRIPT SAYS IS SHOWN: ${opts.facts.map(f => `${f.thing}: ${f.words.map(w => `"${w}"`).join(", ")}`).join(" | ")}\n`
              : "") +
            `\n${lines.join("\n")}\n\nJSON:`
        )
      );
      if (!answer) continue;
      kinds += answer.kinds.length;
      pictures += applyNamedLooks(scenes, ids, answer, opts.keyThings, opts.script);
    } catch {
      /* a failed call changes nothing */
    }
  }
  return { kinds, pictures, parts: scenes.filter(s => s.partOf).length };
}

/** The image-prompt line that carries a picture's exact look. Empty when it has none. */
export function namedLookClause(scene: StoryboardScene): string {
  return scene.namedLook
    ? ` EXACT LOOK — ${scene.namedLook}. Draw it exactly like this, whatever any other words say about its pattern or shape.${SUBJECT_OVER_LOOK}`
    : "";
}

/**
 * SPECIFIC BEATS GENERAL. A named kind has ONE look, written once for all its pictures — the app's
 * front page, the plain board — and a picture is often about a particular page, part or state of
 * it: Dale's job 344 asked for a shop's SETTINGS page under a look that said "a grid of product
 * cards", and for an ENGRAVED board under a look of the plain one. Told both, the picture maker
 * drew the general one and the checker failed it for the particular one, three times running. The
 * look settles how the kind looks; what this picture shows OF it is the picture's own.
 */
export const SUBJECT_OVER_LOOK =
  " That look settles how this kind of thing looks in general — its pattern, shapes, colours and " +
  "style. WHAT this picture shows of it is as the picture's own words say: when they name a " +
  "particular part, page or screen of it, a stage of the work, or something done or added to it, " +
  "show exactly that, in this look's colours and style.";

/** The camera position of a picture about one part of a remembered thing (`partOf`). */
export const PART_VIEW =
  "a close-up that fills the whole frame with just the part this picture is about — the rest of it barely shows";
