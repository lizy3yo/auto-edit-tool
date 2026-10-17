/**
 * Dub CTAs (the "Dub CTAs" page, /dub-ctas, 2026-10-14): a ready-made, FACELESS call to action in
 * another language, for the dubbing team. A dubbed video is the English picture under a new
 * voice; the one part an editor changes is the CTA, which they replace with one of these clips.
 *
 * One clip per channel, language and position (`mid` / `end`), always replaced by the next one
 * made. The language's own book (title, cover, link) is set per channel on the page; the voice
 * is one per language for every channel (the dubbing SOP's narrators), set in Admin.
 *
 * The clip follows the film's CTA layout with b-roll where the host would be:
 * b-roll + small QR → book cover + small QR (the title line) → b-roll + small QR → the big QR
 * over a person-free picture from the scan line to the end.
 */

/** A language the dubbing team voices. `code` is the key books and clips are stored under. */
export interface DubLanguage {
  code: string;
  /** English name — what the page shows and what Claude is asked to write in. */
  name: string;
  /** A 69Labs (ElevenLabs library) voice id, voiced on `DUB_TTS_MODEL`. Empty ⇒ not set yet. */
  voiceId: string;
}

/** app_settings key holding the language list (`DubLanguage[]`, JSON). */
export const DUB_LANGUAGES_KEY = "dub_cta_languages";

/** ElevenLabs v4 through 69Labs — the model the dubbing SOP voices on. */
export const DUB_TTS_MODEL = "eleven_v4";

/**
 * The SOP's narrators. Spanish and French ids are from the SOP; Japanese ("Shohei - Warm, Clear
 * and Husky") was looked up and voiced a test line on 2026-10-14. German ("Leo Marin") has no id
 * the SOP or a search gave — enter it in Admin.
 */
export const DEFAULT_DUB_LANGUAGES: DubLanguage[] = [
  { code: "de", name: "German", voiceId: "" },
  { code: "es", name: "Spanish", voiceId: "W71zT1VwIFFx3mMGH2uZ" },
  { code: "fr", name: "French", voiceId: "fEtpdogpDkBrq53KdupV" },
  { code: "ja", name: "Japanese", voiceId: "8FuuqoKHuM48hIEwni5e" },
];

export const DUB_MAX_LANGUAGES = 20;

export type DubCtaPosition = "mid" | "end";
export const DUB_CTA_POSITIONS: DubCtaPosition[] = ["mid", "end"];
export const DUB_POSITION_LABEL: Record<DubCtaPosition, string> = {
  mid: "Mid-video",
  end: "End of video",
};

/** The saved language list, or the defaults when nothing (or nothing readable) is saved. */
export function parseDubLanguages(
  raw: string | null | undefined
): DubLanguage[] {
  if (!raw) return DEFAULT_DUB_LANGUAGES;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return DEFAULT_DUB_LANGUAGES;
    return list
      .filter(
        (l: any) =>
          l &&
          typeof l.code === "string" &&
          l.code &&
          typeof l.name === "string" &&
          l.name
      )
      .map((l: any) => ({
        code: l.code,
        name: l.name,
        voiceId: typeof l.voiceId === "string" ? l.voiceId.trim() : "",
      }));
  } catch {
    return DEFAULT_DUB_LANGUAGES;
  }
}

/** A stable key for a new language from its name: "Brazilian Portuguese" → "brazilian-portuguese". */
export function dubLanguageCode(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "lang";
  let code = base;
  for (let n = 2; taken.includes(code); n++) code = `${base}-${n}`;
  return code;
}

/** Why a language list cannot be saved, or null. */
export function dubLanguagesError(list: DubLanguage[]): string | null {
  if (list.length > DUB_MAX_LANGUAGES)
    return `At most ${DUB_MAX_LANGUAGES} languages.`;
  const names = new Set<string>();
  const codes = new Set<string>();
  for (const l of list) {
    const name = l.name.trim().toLowerCase();
    if (!name) return "Every language needs a name.";
    if (names.has(name)) return `"${l.name}" is listed twice.`;
    if (codes.has(l.code)) return `"${l.name}" is listed twice.`;
    if (l.voiceId && !/^[A-Za-z0-9_-]{8,64}$/.test(l.voiceId.trim()))
      return `The voice id for ${l.name} does not look like a voice id.`;
    names.add(name);
    codes.add(l.code);
  }
  return null;
}

/**
 * The four parts a clip is made of, in order, and what each shows. The QR is BIG in the middle on
 * every b-roll picture and small in the corner only on the book cover, so it never hides the
 * cover (2026-10-15, the operator: a film's CTA opens on the host with a small corner QR; a
 * faceless one has no host to keep clear, so the card is big from the first word).
 */
export const DUB_CTA_PARTS = [
  { key: "lead", picture: "broll", qr: "center" },
  { key: "title", picture: "cover", qr: "corner" },
  { key: "pitch", picture: "broll", qr: "center" },
  { key: "scan", picture: "broll", qr: "center" },
] as const;
export type DubCtaPartKey = (typeof DUB_CTA_PARTS)[number]["key"];

/** What Claude writes for one clip: the spoken lines in the language, the pictures in English. */
export interface DubCtaScript {
  lines: Record<DubCtaPartKey, string>;
  /** One picture per b-roll part (lead, pitch, scan), described in English for the image model. */
  pictures: { lead: string; pitch: string; scan: string };
  /**
   * The drawn pictures the clip was built from — the channel's shared b-roll set for the
   * position (`DubBrollSet`). Absent on clips made before the set was shared.
   */
  pictureUrls?: { lead: string; pitch: string; scan: string };
}

/**
 * THE SHARED B-ROLL (2026-10-15, the operator: "the same b-roll would be in everything and the
 * CTA is the only thing they change"). A channel has ONE set of three pictures per position —
 * mid-video and end-of-video — drawn once and used under EVERY language's clip of that
 * position. What changes between languages is only the voice and its words, the book cover and
 * the QR link. Redrawing a set replaces it; every clip of that position then reads as built
 * from older pictures until it is made again (`clipUsesBroll`).
 */
export const DUB_BROLL_SLOTS = [
  { key: "lead", label: "Before the title" },
  { key: "pitch", label: "After the cover" },
  { key: "scan", label: "Behind the big QR" },
] as const;
export type DubBrollKey = (typeof DUB_BROLL_SLOTS)[number]["key"];
export type DubBrollSet = Record<
  DubBrollKey,
  { description: string; url: string }
>;

/** The stored set (JSON), or null when there is none or it is not whole. */
export function parseDubBroll(
  json: string | null | undefined
): DubBrollSet | null {
  if (!json) return null;
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const out = {} as DubBrollSet;
  for (const { key } of DUB_BROLL_SLOTS) {
    const p = raw?.[key];
    if (
      typeof p?.description !== "string" ||
      typeof p?.url !== "string" ||
      !p.url
    )
      return null;
    out[key] = { description: p.description, url: p.url };
  }
  return out;
}

/** Whether a clip was built from exactly this set's pictures. */
export function clipUsesBroll(
  clipScript: Pick<DubCtaScript, "pictureUrls"> | null | undefined,
  set: DubBrollSet | null
): boolean {
  if (!set) return true; // nothing to match yet
  const used = clipScript?.pictureUrls;
  if (!used) return false;
  return DUB_BROLL_SLOTS.every(({ key }) => used[key] === set[key].url);
}

/** Folds quotes, dashes and case so a title is found however the writer punctuated it. */
const fold = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[«»„“”"'’‘「」『』《》〈〉]/g, "")
    .replace(/[\s　]+/g, " ")
    .trim();

/**
 * Read Claude's answer (JSON, possibly fenced) into a script, or say what is wrong with it. The
 * title line must say the book's title exactly — it is the line the cover is shown on.
 */
export function parseDubCtaScript(
  text: string,
  bookTitle: string
): { script: DubCtaScript } | { error: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "no JSON in the answer" };
  let raw: any;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { error: "the answer's JSON did not parse" };
  }
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const lines = {
    lead: str(raw?.lines?.lead),
    title: str(raw?.lines?.title),
    pitch: str(raw?.lines?.pitch),
    scan: str(raw?.lines?.scan),
  };
  const pictures = {
    lead: str(raw?.pictures?.lead),
    pitch: str(raw?.pictures?.pitch),
    scan: str(raw?.pictures?.scan),
  };
  for (const [k, v] of Object.entries(lines))
    if (!v) return { error: `the "${k}" line is empty` };
  for (const [k, v] of Object.entries(pictures))
    if (!v) return { error: `the "${k}" picture is empty` };
  if (!fold(lines.title).includes(fold(bookTitle)))
    return { error: "the title line does not say the book's title exactly" };
  return { script: { lines, pictures } };
}

/**
 * A language's SCRIPT (2026-10-15): one paragraph per position — what the clip says, with
 * `{book}` where the title goes. Claude writes it, a person may read and edit it on the page
 * (one box per language and position), and Make clips speaks it word for word. The pictures
 * change by SENTENCE, so one paragraph still gives the four parts: the sentences before the one
 * holding `{book}` (picture 1), that sentence (the cover), the ones after it (picture 2), and the
 * last (the big QR). Split on the TEMPLATE, so a title's own punctuation never cuts a sentence.
 */
export const DUB_BOOK_TOKEN = "{book}";
/** A clip past this is a pitch, not a call to action — the box refuses it. */
export const DUB_SCRIPT_MAX_SEC = 30;
/** What a script should land in (the clips made so far read 22-23 s). */
export const DUB_SCRIPT_AIM_SEC = { min: 15, max: 25 } as const;

/** Japanese, Chinese and Korean script characters — counted one by one, not as words. */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/g;

/** How long a script reads: spaced languages ~2.6 words/s, Japanese ~7 characters/s. */
export function dubScriptLength(text: string): {
  count: number;
  unit: "words" | "characters";
  sec: number;
} {
  const spoken = text.split(DUB_BOOK_TOKEN).join(" ").trim();
  const cjk = (spoken.match(CJK) ?? []).length;
  if (cjk > spoken.length / 3)
    return { count: cjk, unit: "characters", sec: cjk / 7 };
  const words = spoken ? spoken.split(/\s+/).length : 0;
  // `{book}` is said too: count a title as about four words.
  const titleWords = (text.split(DUB_BOOK_TOKEN).length - 1) * 4;
  return { count: words, unit: "words", sec: (words + titleWords) / 2.6 };
}

/** A script's sentences, in order: cut after . ! ? and a space, or after 。！？. */
export function dubScriptSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+|(?<=[。！？])/)
    .map(s => s.trim())
    .filter(Boolean);
}

export type DubScriptParts = Record<DubCtaPartKey, string>;

/** The four parts of a script (still holding `{book}`), or why it cannot be split. */
export function splitDubScript(
  template: string
): { parts: DubScriptParts } | { error: string } {
  const sentences = dubScriptSentences(template);
  const titleAt = sentences.findIndex(s => s.includes(DUB_BOOK_TOKEN));
  const tokens = template.split(DUB_BOOK_TOKEN).length - 1;
  if (tokens === 0)
    return { error: `Put ${DUB_BOOK_TOKEN} where the book's title is said.` };
  if (tokens > 1)
    return {
      error: `Say ${DUB_BOOK_TOKEN} once — it is the line the cover shows on.`,
    };
  if (titleAt < 1)
    return {
      error: `Start with a sentence before the one that says ${DUB_BOOK_TOKEN}.`,
    };
  const after = sentences.slice(titleAt + 1);
  if (after.length < 2)
    return {
      error: `After the ${DUB_BOOK_TOKEN} sentence, add what the reader gets, then a last sentence telling them to scan the QR code.`,
    };
  const join = (list: string[]) => list.join(" ");
  return {
    parts: {
      lead: join(sentences.slice(0, titleAt)),
      title: sentences[titleAt],
      pitch: join(after.slice(0, -1)),
      scan: after[after.length - 1],
    },
  };
}

/** Why a script cannot be saved or spoken, or null. */
export function dubScriptError(template: string): string | null {
  if (!template.trim()) return "The script is empty.";
  if (template.length > 2000)
    return "That script is far too long for a call to action.";
  const split = splitDubScript(template);
  if ("error" in split) return split.error;
  const { sec } = dubScriptLength(template);
  if (sec > DUB_SCRIPT_MAX_SEC)
    return `That reads in about ${Math.round(sec)} s — keep it under ${DUB_SCRIPT_MAX_SEC} s.`;
  return null;
}

/** The script as it is spoken: `{book}` replaced by the language's title. */
export function fillDubScript(template: string, bookTitle: string): string {
  return template.split(DUB_BOOK_TOKEN).join(bookTitle.trim());
}

/** The lines a clip speaks, from a saved script and the language's book title. */
export function dubScriptLines(
  template: string,
  bookTitle: string
): { lines: DubScriptParts } | { error: string } {
  const error = dubScriptError(template);
  if (error) return { error };
  const { parts } = splitDubScript(template) as { parts: DubScriptParts };
  const lines = { ...parts };
  for (const key of Object.keys(lines) as DubCtaPartKey[])
    lines[key] = fillDubScript(lines[key], bookTitle);
  return { lines };
}

/** Whether a made clip still says what the saved script says (whitespace ignored). */
export function clipMatchesScript(
  clipLines: Partial<DubScriptParts> | null | undefined,
  template: string,
  bookTitle: string
): boolean {
  if (!clipLines) return false;
  const squash = (s: string) => s.replace(/\s+/g, "");
  const said = DUB_CTA_PARTS.map(p => clipLines[p.key] ?? "").join("");
  return squash(said) === squash(fillDubScript(template, bookTitle));
}

/** The whole script as it is spoken, for showing on the page. */
export function dubCtaSpokenText(script: DubCtaScript): string {
  return DUB_CTA_PARTS.map(p => script.lines[p.key]).join(" ");
}

/** Silence after each part, so the cuts are not on the last syllable; the last holds the big QR. */
export const DUB_PART_GAP_SEC = 0.25;
export const DUB_END_HOLD_SEC = 1.5;

/** How long each part stays on screen: its voice plus the gap after it. */
export function dubPartDurations(audioSec: number[]): number[] {
  return audioSec.map(
    (sec, i) =>
      sec + (i === audioSec.length - 1 ? DUB_END_HOLD_SEC : DUB_PART_GAP_SEC)
  );
}

/**
 * A channel's own dub voice per language (`channel_configs.dubVoices`): `{ [code]: voiceId }`.
 * A channel sounds like ITS host in every language (Roger's French is an older calm man, not
 * the default narrator), and a language it has no voice for falls back to the default.
 */
export type ChannelDubVoices = Record<string, string>;

const VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The stored map, keeping only well-formed non-empty ids (anything else reads as unset). */
export function parseChannelDubVoices(raw: unknown): ChannelDubVoices {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ChannelDubVoices = {};
  for (const [code, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === "string" && VOICE_ID.test(id.trim()))
      out[code] = id.trim();
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Why a channel's dub voices cannot be saved, or null. Blank entries are allowed (= default). */
export function channelDubVoicesError(voices: ChannelDubVoices): string | null {
  const entries = Object.entries(voices);
  if (entries.length > DUB_MAX_LANGUAGES)
    return `At most ${DUB_MAX_LANGUAGES} languages.`;
  for (const [code, id] of entries) {
    if (!code.trim() || code.length > 32) return "A dub voice has no language.";
    if (id.trim() && !VOICE_ID.test(id.trim()))
      return `The ${code} dub voice id does not look like a voice id.`;
  }
  return null;
}

/** The map as it is stored: trimmed, blanks dropped; null when nothing is set. */
export function cleanChannelDubVoices(
  voices: ChannelDubVoices
): ChannelDubVoices | null {
  const out: ChannelDubVoices = {};
  for (const [code, id] of Object.entries(voices))
    if (id.trim()) out[code] = id.trim();
  return Object.keys(out).length ? out : null;
}

export type DubVoiceSource = "channel" | "none";

/**
 * The voice a channel's clip in `language` is spoken in: ONLY the channel's own (Admin →
 * Channels → Dub voices). There is no fallback to the language's voice in Admin → Dub voices —
 * a channel with no voice for a language makes no clips in it (the operator's call, 2026-10-15).
 */
export function dubVoiceFor(
  language: DubLanguage,
  channelVoices: ChannelDubVoices | null | undefined
): { voiceId: string; source: DubVoiceSource } {
  const own = channelVoices?.[language.code]?.trim();
  if (own) return { voiceId: own, source: "channel" };
  return { voiceId: "", source: "none" };
}

/** Why a language cannot be made for a channel yet, or null — the page and the server ask this. */
export function dubLanguageBlocker(
  language: DubLanguage | undefined,
  book:
    | { title: string; coverImageUrl: string | null; shopUrl: string | null }
    | null
    | undefined,
  channelVoices?: ChannelDubVoices | null
): string | null {
  if (!language) return "That language is not set up.";
  if (!dubVoiceFor(language, channelVoices).voiceId)
    return `${language.name} has no voice for this channel — enter one in Admin → Channels → Dub voices.`;
  if (!book?.title) return `Add the ${language.name} book first.`;
  if (!book.coverImageUrl) return `Add the ${language.name} book's cover.`;
  if (!book.shopUrl)
    return `Add the ${language.name} book's link — the QR is made from it.`;
  return null;
}

/** A clip still "working" this long after its last update was cut off (a restart) — say so. */
export const DUB_STALE_MS = 30 * 60 * 1000;

export type DubClipStatus = "working" | "done" | "failed";

/** What the page shows for a clip's state: a stale "working" row is a failed one. */
export function dubClipState(
  row: { status: DubClipStatus; updatedAt: Date | string },
  now = Date.now()
): DubClipStatus | "interrupted" {
  if (row.status !== "working") return row.status;
  return now - new Date(row.updatedAt).getTime() > DUB_STALE_MS
    ? "interrupted"
    : "working";
}
