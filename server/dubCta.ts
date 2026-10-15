/**
 * Dub CTAs (`shared/dubCta.ts`, the "Dub CTAs" page): makes a channel's faceless call-to-action
 * clip in another language, mid-video and end-of-video, and keeps ONE of each — a new one
 * replaces the last.
 *
 * The SCRIPT is saved per channel, language and position (`dub_cta_scripts`): Claude writes it
 * (generic, so the clip fits any video on the channel), a person may read and edit it on the
 * page, and a run speaks it word for word — a language with no script gets one written first.
 * One run: the saved script split into its four parts (`dubScriptLines`) → the channel's SHARED
 * b-roll for the position (`ensureDubBroll` — three pictures drawn once per channel and position
 * and used under every language, so only the voice, the cover and the QR change between
 * languages) → each part voiced on 69Labs in the channel's or the language's voice
 * (`DUB_TTS_MODEL`) → the QR is made from the book's link → `renderDubCtaClip` builds the clip. Runs in the background; the row carries the phase. Not
 * metered into any video's cost (there is no video) — like the HeyGen test and VSL.
 */
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  getDb,
  getAppSetting,
  setAppSetting,
  getBooks,
  getChannelConfig,
} from "./db";
import {
  dubCtaBooks,
  dubCtaBroll,
  dubCtaClips,
  dubCtaScripts,
  type DubCtaBook,
  type DubCtaBrollRow,
  type DubCtaClip,
  type DubCtaScriptRow,
} from "../drizzle/schema";
import {
  DUB_BOOK_TOKEN,
  DUB_BROLL_SLOTS,
  DUB_CTA_PARTS,
  DUB_LANGUAGES_KEY,
  DUB_TTS_MODEL,
  dubClipState,
  dubLanguageBlocker,
  dubPartDurations,
  dubScriptError,
  dubScriptLines,
  dubVoiceFor,
  parseChannelDubVoices,
  parseDubBroll,
  parseDubLanguages,
  type DubBrollSet,
  type DubCtaPosition,
  type DubCtaScript,
  type DubLanguage,
} from "../shared/dubCta";
import { invokeClaude } from "./claude";
import {
  generateSceneVoiceover,
  resolveTTSProvider,
  TTS_SIMILARITY,
  TTS_STABILITY,
  TTS_STYLE,
} from "./longformVideo";
import { generateStillWithFallback } from "./providers/fallback";
import { apimartKey } from "./hostPhoneLook";
import { renderVerifiedQrPng } from "./tracking";
import { probeUrlDurationSec, renderDubCtaClip } from "./videoAssembly";
import { storagePut } from "./storage";

const WRITER_MODEL = () => process.env.DUB_CTA_MODEL || "claude-opus-5-5";
/** A plain translation for the page — an easy step, on the cheaper model. */
const TRANSLATE_MODEL = () =>
  process.env.DUB_CTA_TRANSLATE_MODEL || "claude-sonnet-5-5";

export class DubCtaInputError extends Error {}

export async function getDubLanguages(): Promise<DubLanguage[]> {
  return parseDubLanguages(await getAppSetting(DUB_LANGUAGES_KEY));
}

export async function setDubLanguages(list: DubLanguage[]): Promise<void> {
  await setAppSetting(DUB_LANGUAGES_KEY, JSON.stringify(list));
}

/** A channel's books, scripts, shared b-roll and clips, every language. */
export async function listDubCta(channelKey: string): Promise<{
  books: DubCtaBook[];
  scripts: DubCtaScriptRow[];
  broll: (DubCtaBrollRow & { state: ReturnType<typeof dubClipState> })[];
  clips: (DubCtaClip & { state: ReturnType<typeof dubClipState> })[];
}> {
  const db = await getDb();
  if (!db) return { books: [], scripts: [], broll: [], clips: [] };
  const [books, scripts, broll, clips] = await Promise.all([
    db.select().from(dubCtaBooks).where(eq(dubCtaBooks.channelKey, channelKey)),
    db
      .select()
      .from(dubCtaScripts)
      .where(eq(dubCtaScripts.channelKey, channelKey)),
    db.select().from(dubCtaBroll).where(eq(dubCtaBroll.channelKey, channelKey)),
    db.select().from(dubCtaClips).where(eq(dubCtaClips.channelKey, channelKey)),
  ]);
  return {
    books,
    scripts,
    broll: broll.map(b => ({
      ...b,
      // Drawn in THIS process ⇒ working whatever its age; left "working" by a restart ⇒ interrupted.
      state: _drawing.has(brollKey(channelKey, b.position as DubCtaPosition))
        ? "working"
        : b.status === "working"
          ? "interrupted"
          : b.status,
    })),
    clips: clips.map(c => ({ ...c, state: dubClipState(c) })),
  };
}

export async function getDubScript(
  channelKey: string,
  language: string,
  position: DubCtaPosition
): Promise<DubCtaScriptRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(dubCtaScripts)
    .where(
      and(
        eq(dubCtaScripts.channelKey, channelKey),
        eq(dubCtaScripts.language, language),
        eq(dubCtaScripts.position, position)
      )
    )
    .limit(1);
  return row ?? null;
}

/** One script per channel, language and position — saving again replaces it. */
async function saveDubScriptRow(input: {
  channelKey: string;
  language: string;
  position: DubCtaPosition;
  text: string;
  english: string | null;
  userId: number | null;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const set = {
    text: input.text,
    english: input.english,
    updatedBy: input.userId,
  };
  await db
    .insert(dubCtaScripts)
    .values({
      channelKey: input.channelKey,
      language: input.language,
      position: input.position,
      ...set,
    })
    .onDuplicateKeyUpdate({ set });
}

export async function getDubBook(
  channelKey: string,
  language: string
): Promise<DubCtaBook | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(dubCtaBooks)
    .where(
      and(
        eq(dubCtaBooks.channelKey, channelKey),
        eq(dubCtaBooks.language, language)
      )
    )
    .limit(1);
  return row ?? null;
}

/** Save a channel's book for one language (one row per channel and language). */
export async function saveDubBook(input: {
  channelKey: string;
  language: string;
  title: string;
  coverImageUrl: string | null;
  shopUrl: string | null;
  userId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const set = {
    title: input.title.trim(),
    coverImageUrl: input.coverImageUrl,
    shopUrl: input.shopUrl?.trim() || null,
  };
  await db
    .insert(dubCtaBooks)
    .values({
      channelKey: input.channelKey,
      language: input.language,
      createdBy: input.userId,
      ...set,
    })
    .onDuplicateKeyUpdate({ set });
}

async function writeClip(
  channelKey: string,
  language: string,
  position: DubCtaPosition,
  set: Partial<typeof dubCtaClips.$inferInsert>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(dubCtaClips)
    .values({ channelKey, language, position, ...set })
    .onDuplicateKeyUpdate({ set: { ...set, updatedAt: new Date() } });
}

/**
 * Start making the mid and end clips for each language. Everything is checked first, so a click
 * either starts every clip asked for or none. A clip already being made is left to finish.
 */
export async function startDubCtas(input: {
  channelKey: string;
  languages: string[];
  userId: number;
}): Promise<{ started: number }> {
  const channel = await getChannelConfig(input.channelKey);
  if (!channel) throw new DubCtaInputError("That channel no longer exists.");
  if (!input.languages.length)
    throw new DubCtaInputError("Pick at least one language.");
  const all = await getDubLanguages();
  const { books, clips } = await listDubCta(input.channelKey);
  // Only the channel's own voice per language is used — no language default (`dubVoiceFor`).
  const channelVoices = parseChannelDubVoices(channel.dubVoices);
  const jobs: {
    language: DubLanguage;
    voiceId: string;
    book: DubCtaBook;
    position: DubCtaPosition;
  }[] = [];
  for (const code of input.languages) {
    const language = all.find(l => l.code === code);
    const book = books.find(b => b.language === code);
    const blocker = dubLanguageBlocker(language, book, channelVoices);
    if (blocker) throw new DubCtaInputError(blocker);
    const { voiceId } = dubVoiceFor(language!, channelVoices);
    for (const position of ["mid", "end"] as const) {
      const busy = clips.some(
        c =>
          c.language === code &&
          c.position === position &&
          c.state === "working"
      );
      if (!busy)
        jobs.push({ language: language!, voiceId, book: book!, position });
    }
  }
  for (const j of jobs)
    await writeClip(input.channelKey, j.language.code, j.position, {
      status: "working",
      phase: "Starting",
      error: null,
      userId: input.userId,
    });
  for (const j of jobs)
    void makeDubCta({ channel, ...j, userId: input.userId }).catch(
      async err => {
        console.warn(
          `[DubCTA] ${input.channelKey}/${j.language.code}/${j.position} failed: ${err?.message}`
        );
        await writeClip(input.channelKey, j.language.code, j.position, {
          status: "failed",
          phase: null,
          error: String(err?.message ?? err).slice(0, 2000),
        }).catch(() => {});
      }
    );
  return { started: jobs.length };
}

type ChannelRow = NonNullable<Awaited<ReturnType<typeof getChannelConfig>>>;

const SCRIPT_SYSTEM = `You write a short call to action for a YouTube channel whose videos are dubbed into another language. The dubbing editor cuts it into a finished video in place of the original call to action, so it must fit ANY video on the channel: never mention the video's topic, a story, a step, or anything that happened in it.

It is spoken by the channel's narrator in the first person ("my book"), warm and natural, written the way a native speaker of the language talks — never a word-for-word translation of English. Keep it SHORT: 15-25 seconds spoken in all (about 45-60 words, or the same length in a language without spaces).

Write ONE paragraph of four short sentences, in this order — the picture changes at each:
1. The narrator has a book that goes further on what this channel is about. Do NOT name the book yet.
2. The sentence that names the book. Write the exact placeholder ${DUB_BOOK_TOKEN} where the title goes — never the title itself, never quotes around it — and use ${DUB_BOOK_TOKEN} only in this sentence. The book's cover is on screen during it.
3. What the reader gets from the book.
4. Tell the viewer to scan the QR code on the screen with their phone's camera, or use the link in the description. A big QR code is on screen during it.

End every sentence with the language's own full stop (. ! ? or 。！？). No prices, discounts, dates or deadlines. No promises a book cannot keep. No stage directions, brackets or emoji.

Also give its plain English meaning, sentence for sentence, keeping ${DUB_BOOK_TOKEN} as it is.

Answer with JSON only: {"script":"…","english":"…"}`;

const PICTURES_SYSTEM = `You describe three still photos, in ENGLISH, for a short faceless call to action that sells a book. They are shown, in order, under the first sentence (before the book is named), under what the reader gets, and under "scan the QR code".

Each is an ordinary real-life scene about the book's subject and the channel's world. Never a person, face, hands or body part; no writing, signs, labels or logos; no phones, screens, QR codes or books. A large QR card sits over the MIDDLE of all three pictures, so each keeps its middle calm and plain and puts what matters around it, never only in the centre. One plain sentence each; name one scene, never "X or Y".

Answer with JSON only: {"lead":"…","pitch":"…","scan":"…"}`;

const POSITION_BRIEF: Record<DubCtaPosition, string> = {
  mid: "MID-VIDEO: it interrupts the video partway through. Open the lead with a brief, natural pause in the video (like 'before we go on'), and end the scan line by going back to the video. No goodbye.",
  end: "END OF VIDEO: the video is over. End the scan line with thanks for watching and a short goodbye.",
};

/**
 * What the channel is about, for Claude. It comes from the channel's own English BOOK TITLES:
 * `nicheSlug` / `defaultNiche` still hold the "gardening" default on most channels, which turned
 * a woodworking pitch into a garden one.
 */
async function channelAbout(channel: ChannelRow): Promise<string> {
  const englishBooks = (await getBooks(channel.channelKey, true)).map(
    b => b.title
  );
  return [
    `Channel: ${channel.displayName ?? channel.channelKey}`,
    englishBooks.length
      ? `The channel's books in English (what the channel is about): ${englishBooks.join("; ")}`
      : "",
    channel.personaProfile
      ? `The narrator: ${channel.personaProfile.slice(0, 800)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The first JSON object in an answer (Claude sometimes fences it). */
function jsonIn(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Claude writes a language's script for one position and it is SAVED — "Write with Claude" on
 * the page, and Make clips for a language that has none. A script that breaks a rule
 * (`dubScriptError`: no `{book}`, a missing part, too long) is asked for once more.
 */
export async function writeDubScript(input: {
  channelKey: string;
  language: string;
  position: DubCtaPosition;
  userId: number | null;
}): Promise<DubCtaScriptRow> {
  const channel = await getChannelConfig(input.channelKey);
  if (!channel) throw new DubCtaInputError("That channel no longer exists.");
  const language = (await getDubLanguages()).find(
    l => l.code === input.language
  );
  if (!language) throw new DubCtaInputError("That language is not set up.");
  const about = [
    await channelAbout(channel),
    `Language to write in: ${language.name}`,
    POSITION_BRIEF[input.position],
  ].join("\n");
  let userMessage = about;
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await invokeClaude({
      systemPrompt: SCRIPT_SYSTEM,
      userMessage,
      model: WRITER_MODEL(),
      maxTokens: 2000,
      step: "Dub CTA script",
    });
    const raw = jsonIn(r.text);
    const text = typeof raw?.script === "string" ? raw.script.trim() : "";
    const english = typeof raw?.english === "string" ? raw.english.trim() : "";
    const error = text ? dubScriptError(text) : "no script in the answer";
    if (!error) {
      await saveDubScriptRow({ ...input, text, english: english || null });
      return (await getDubScript(
        input.channelKey,
        input.language,
        input.position
      ))!;
    }
    lastError = error;
    userMessage = `${about}\n\nYour last answer was refused: ${error} Answer again, JSON only.`;
  }
  throw new Error(
    `Could not write the ${language.name} script (${lastError}).`
  );
}

/** Plain English for an edited script, so a reader who does not speak the language can check it. */
async function translateDubScript(
  text: string,
  languageName: string
): Promise<string | null> {
  try {
    const r = await invokeClaude({
      systemPrompt: `Translate this ${languageName} call to action into plain English, sentence for sentence. Keep ${DUB_BOOK_TOKEN} exactly as it is. Answer with the translation only.`,
      userMessage: text,
      model: TRANSLATE_MODEL(),
      maxTokens: 800,
      step: "Dub CTA translation",
    });
    return r.text.trim() || null;
  } catch (err: any) {
    console.warn(`[DubCTA] translation failed: ${err?.message}`);
    return null;
  }
}

/**
 * Save a person's edit of a script. A changed script gets a fresh English line; an unchanged one
 * keeps the one it has.
 */
export async function saveDubScript(input: {
  channelKey: string;
  language: string;
  position: DubCtaPosition;
  text: string;
  userId: number;
}): Promise<DubCtaScriptRow> {
  const text = input.text.trim();
  const error = dubScriptError(text);
  if (error) throw new DubCtaInputError(error);
  const language = (await getDubLanguages()).find(
    l => l.code === input.language
  );
  if (!language) throw new DubCtaInputError("That language is not set up.");
  const before = await getDubScript(
    input.channelKey,
    input.language,
    input.position
  );
  const english =
    before && before.text === text
      ? before.english
      : await translateDubScript(text, language.name);
  await saveDubScriptRow({ ...input, text, english });
  return (await getDubScript(
    input.channelKey,
    input.language,
    input.position
  ))!;
}

const PICTURE_POSITION: Record<DubCtaPosition, string> = {
  mid: "MID-VIDEO: the call to action interrupts a video partway through, then the video goes on.",
  end: "END OF VIDEO: the video is over; the pictures can feel calm and settled.",
};

/**
 * Three picture descriptions for a channel's SHARED set (the cover is each language's own book).
 * Written from the channel, never from one language's words: the same pictures go under every
 * language's version of the lines. The other position's set, when there is one, is named so
 * the two do not repeat a scene.
 */
async function describeBroll(
  channel: ChannelRow,
  position: DubCtaPosition,
  other: DubBrollSet | null
): Promise<DubCtaScript["pictures"]> {
  const userMessage = [
    await channelAbout(channel),
    PICTURE_POSITION[position],
    "The same three pictures are used under the call to action in EVERY language, so each must " +
      "suit any wording: show the channel's world, not one sentence.",
    other
      ? `The ${position === "mid" ? "end-of-video" : "mid-video"} call to action already uses ` +
        `these scenes, so choose different ones: ` +
        DUB_BROLL_SLOTS.map(s => other[s.key].description).join(" | ")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await invokeClaude({
      systemPrompt: PICTURES_SYSTEM,
      userMessage,
      model: WRITER_MODEL(),
      maxTokens: 800,
      step: "Dub CTA pictures",
    });
    const raw = jsonIn(r.text);
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const pictures = {
      lead: str(raw?.lead),
      pitch: str(raw?.pitch),
      scan: str(raw?.scan),
    };
    if (pictures.lead && pictures.pitch && pictures.scan) return pictures;
    lastError = "a picture description was missing";
  }
  throw new Error(`Could not describe the pictures (${lastError}).`);
}

const brollKey = (channelKey: string, position: DubCtaPosition) =>
  `${channelKey}/${position}`;
/** Sets being drawn now, by channel and position — every run of that position waits on it. */
const _drawing = new Map<string, Promise<DubBrollSet>>();

async function getDubBroll(
  channelKey: string,
  position: DubCtaPosition
): Promise<DubCtaBrollRow | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(dubCtaBroll)
    .where(
      and(
        eq(dubCtaBroll.channelKey, channelKey),
        eq(dubCtaBroll.position, position)
      )
    )
    .limit(1);
  return row ?? null;
}

async function writeBroll(
  channelKey: string,
  position: DubCtaPosition,
  set: Partial<typeof dubCtaBroll.$inferInsert>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(dubCtaBroll)
    .values({ channelKey, position, ...set })
    .onDuplicateKeyUpdate({ set: { ...set, updatedAt: new Date() } });
}

/**
 * Draw a channel's set for one position and save it, replacing the last. One draw per channel
 * and position at a time: a second call while one runs gets the same promise. A failed draw
 * keeps the pictures the row had.
 */
function drawDubBroll(
  channel: ChannelRow,
  position: DubCtaPosition,
  userId: number | null
): Promise<DubBrollSet> {
  const key = brollKey(channel.channelKey, position);
  const running = _drawing.get(key);
  if (running) return running;
  const draw = (async () => {
    await writeBroll(channel.channelKey, position, {
      status: "working",
      error: null,
      updatedBy: userId,
    });
    try {
      const other = parseDubBroll(
        (
          await getDubBroll(
            channel.channelKey,
            position === "mid" ? "end" : "mid"
          )
        )?.pictures
      );
      const described = await describeBroll(channel, position, other);
      const imageKey = await apimartKey().catch(() => null);
      const dir = `dub-cta/${channel.channelKey}/broll-${position}`;
      const urls = await Promise.all(
        DUB_BROLL_SLOTS.map(s => drawPicture(described[s.key], imageKey, dir))
      );
      const set = Object.fromEntries(
        DUB_BROLL_SLOTS.map((s, i) => [
          s.key,
          { description: described[s.key], url: urls[i] },
        ])
      ) as DubBrollSet;
      await writeBroll(channel.channelKey, position, {
        status: "done",
        error: null,
        pictures: JSON.stringify(set),
      });
      return set;
    } catch (err: any) {
      await writeBroll(channel.channelKey, position, {
        status: "failed",
        error: String(err?.message ?? err).slice(0, 2000),
      }).catch(() => {});
      throw err;
    }
  })().finally(() => _drawing.delete(key));
  _drawing.set(key, draw);
  return draw;
}

/**
 * The set a clip is built from: the one being drawn now, else the saved one, else a new one
 * drawn on the spot (the first clip of that position on the channel).
 */
async function ensureDubBroll(
  channel: ChannelRow,
  position: DubCtaPosition,
  userId: number | null
): Promise<DubBrollSet> {
  const running = _drawing.get(brollKey(channel.channelKey, position));
  if (running) return running;
  const saved = parseDubBroll(
    (await getDubBroll(channel.channelKey, position))?.pictures
  );
  return saved ?? drawDubBroll(channel, position, userId);
}

/**
 * "Draw again" on the page: draw a channel's set for one position again, in the background.
 * Every clip of that position made from the old set says so until it is made again.
 */
export async function startDubBrollRedraw(input: {
  channelKey: string;
  position: DubCtaPosition;
  userId: number;
}): Promise<{ started: boolean }> {
  const channel = await getChannelConfig(input.channelKey);
  if (!channel) throw new DubCtaInputError("That channel no longer exists.");
  if (_drawing.has(brollKey(input.channelKey, input.position)))
    return { started: false };
  void drawDubBroll(channel, input.position, input.userId).catch(err =>
    console.warn(
      `[DubCTA] ${input.channelKey}/${input.position} b-roll failed: ${err?.message}`
    )
  );
  return { started: true };
}

const PICTURE_STYLE =
  " A quick, ordinary photo someone took themselves on a phone: plain daylight, a real used place, " +
  "nothing staged or styled. No people, faces, hands or body parts. No readable writing, letters, " +
  "numbers, labels or logos. No phones, screens, QR codes or books.";

async function drawPicture(
  description: string,
  key: string | null,
  dir: string
): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await generateStillWithFallback({
      prompt: description.replace(/\.?\s*$/, ".") + PICTURE_STYLE,
      apimartKey: key,
    });
    if (r.success && r.fileData) {
      const { url } = await storagePut(
        `${dir}/picture-${nanoid(8)}.png`,
        Buffer.from(r.fileData as Buffer),
        "image/png"
      );
      return url;
    }
    if (r.success && r.fileUrl) return r.fileUrl;
    lastError = r.error ?? "no image";
  }
  throw new Error(`A picture could not be drawn (${lastError}).`);
}

/**
 * Voice one line, sharing a read already under way for the same words and voice: the mid and
 * end clips are made side by side and often say the same title line, and 69Labs refuses the
 * second identical request while the first runs (409, a 45 s wait each time).
 */
const _voicing = new Map<string, Promise<string>>();
function voiceLine(
  providerType: string,
  apiKey: string,
  text: string,
  voiceId: string
): Promise<string> {
  const key = `${voiceId}\n${text}`;
  let read = _voicing.get(key);
  if (!read) {
    read = generateSceneVoiceover(
      providerType,
      apiKey,
      text,
      voiceId,
      DUB_TTS_MODEL,
      undefined,
      undefined,
      TTS_STABILITY,
      TTS_STYLE,
      TTS_SIMILARITY
    ).finally(() => _voicing.delete(key));
    _voicing.set(key, read);
  }
  return read;
}

async function makeDubCta(job: {
  channel: ChannelRow;
  language: DubLanguage;
  /** The voice this clip is spoken in: the channel's own for the language, else the default. */
  voiceId: string;
  book: DubCtaBook;
  position: DubCtaPosition;
  userId: number;
}): Promise<void> {
  const { channel, language, voiceId, book, position } = job;
  const channelKey = channel.channelKey;
  const phase = (p: string) =>
    writeClip(channelKey, language.code, position, {
      status: "working",
      phase: p,
    });

  // The SAVED script, word for word; a language with none gets one written and saved first, so
  // what the clip says is always on the page.
  let saved = await getDubScript(channelKey, language.code, position);
  if (!saved) {
    await phase("Writing the script");
    saved = await writeDubScript({
      channelKey,
      language: language.code,
      position,
      userId: job.userId,
    });
  }
  const split = dubScriptLines(saved.text, book.title);
  if ("error" in split)
    throw new Error(`The ${language.name} script: ${split.error}`);
  // The channel's shared b-roll for this position: the same three pictures under every language.
  const drawing =
    _drawing.has(brollKey(channelKey, position)) ||
    !parseDubBroll((await getDubBroll(channelKey, position))?.pictures);
  if (drawing) await phase("Drawing the shared b-roll");
  const broll = await ensureDubBroll(channel, position, job.userId);
  const script: DubCtaScript = {
    lines: split.lines,
    pictures: {
      lead: broll.lead.description,
      pitch: broll.pitch.description,
      scan: broll.scan.description,
    },
    pictureUrls: {
      lead: broll.lead.url,
      pitch: broll.pitch.url,
      scan: broll.scan.url,
    },
  };

  await phase("Voicing");
  const { providerType, apiKey } = await resolveTTSProvider(null);
  const dir = `dub-cta/${channelKey}/${language.code}`;
  const [voices, qr] = await Promise.all([
    Promise.all(
      DUB_CTA_PARTS.map(p =>
        voiceLine(providerType, apiKey, script.lines[p.key], voiceId)
      )
    ),
    renderVerifiedQrPng(book.shopUrl!),
  ]);
  if (!qr.verified)
    throw new Error(
      `The QR for "${book.shopUrl}" did not scan back to its link — check the link.`
    );
  const audioSec = await Promise.all(
    voices.map(url => probeUrlDurationSec(url, "mp3"))
  );
  if (audioSec.some(s => !(s > 0)))
    throw new Error("A voiced line came back empty.");
  const durations = dubPartDurations(audioSec);
  // Only the cover is the language's own; the three b-roll pictures are the channel's shared set.
  const imageFor = {
    lead: broll.lead.url,
    title: book.coverImageUrl!,
    pitch: broll.pitch.url,
    scan: broll.scan.url,
  };

  await phase("Building the clip");
  const clip = await renderDubCtaClip({
    parts: DUB_CTA_PARTS.map((p, i) => ({
      imageUrl: imageFor[p.key],
      audioUrl: voices[i],
      durationSec: durations[i],
      picture: p.picture,
      qr: p.qr,
    })),
    qrPng: qr.png,
  });
  const { url } = await storagePut(
    `${dir}/${position}-${nanoid(8)}.mp4`,
    clip,
    "video/mp4"
  );
  await writeClip(channelKey, language.code, position, {
    status: "done",
    phase: null,
    error: null,
    script: JSON.stringify(script),
    bookTitle: book.title,
    videoUrl: url,
    durationMs: Math.round(durations.reduce((a, b) => a + b, 0) * 1000),
  });
}
