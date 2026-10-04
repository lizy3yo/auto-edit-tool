/**
 * server/hostPhoneLook.ts — the PHONE-LOOK version of a host photo (2026-09-28).
 *
 * A studio-lit, blurred-background host photo stays "AI" under any filter: HeyGen keeps the
 * photo's look, so the fix is at the source. The phone-look version is the same person in the
 * same room, remade (gpt-image-2 through APIMART, the original as the identity reference) as a
 * frame of a video they recorded themselves on an old iPhone propped up in front of them — the
 * recipe the operator approved on Hannah's, Hank's, Mae's and Ruth's photos, written here for ANY
 * host rather than per channel. It is the default everywhere (shared/hostPhotoLook.ts) and each
 * photo can be switched back to its original.
 *
 * Made ONCE per photo, in the background, the first time the photo is listed or saved
 * (`ensurePhoneLook`); a generate that finds one missing waits for it briefly
 * (`phoneLookWithin`) and otherwise renders the original. A result without a detectable face is
 * refused — a talking head needs one — and recorded as `phoneLookError`, so the original is used
 * and the picker says why. Never blocks anything.
 */
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { ApimartAdapter } from "./providers/apimart";
import sharp from "sharp";
import { storagePut, presignOwnBucketUrl } from "./storage";
import { invokeClaude } from "./claude";
import { detectFace } from "./faceAlign";
import {
  getAppSetting,
  setAppSetting,
  updateChannelHostPhoto,
} from "./db";
import { getApimartEditKey, getApimartSlotKey } from "./longformVideo";
import { PROVIDER_ACCOUNT_MAX } from "../shared/accountPool";
import type { ChannelHostPhoto } from "../drizzle/schema";

/** Where the host sits and what is around them — read off the photo (`describeHostSetting`). */
export interface HostSetting {
  /** "sitting at a workbench in a woodshop" */
  seat: string;
  /** "in the woodshop" */
  place: string;
  /** "a pegboard of hand tools, lumber racks, a table saw, a window" */
  things: string;
}

/** Used when the photo cannot be read — the recipe still works, just less specifically. */
export const PLAIN_SETTING: HostSetting = {
  seat: "sitting in the same room as in the reference photo",
  place: "in that room",
  things: "the same furniture and things as in the reference photo",
};

/**
 * The phone-look recipe — word for word the one that made the four photos the operator chose on
 * 2026-09-28 (`scripts/_tmp/channel-look.mts`), with the setting filled in from the photo instead
 * of written per channel. A first version that only said "the same room" came back as the
 * original again: same wide framing, same golden light. Hands stay down: the talking-head model
 * animates only the face, so a raised hand would stay frozen in the air for the whole take. Pure.
 */
export function phoneLookPrompt(setting: HostSetting): string {
  return (
    "The same person as in the reference photo — same face, hair, glasses if any, age, build and " +
    `the same clothes — ${setting.seat}, talking to the camera, their hands resting still in their ` +
    "lap or on the table — not raised, not gesturing (the talking-head model animates only the " +
    "face, so raised hands would stay frozen in the air). This is a frame from a video they " +
    "recorded themselves on their old iPhone, propped up in front of them at about chest height, " +
    "so it looks straight at them from a little below eye level; they are looking into the phone's " +
    "lens. Framed from the chest up, a little off-centre, with plenty of the real room around them " +
    `${setting.place}. Ordinary daylight from the window beside them, so one side of the face is a ` +
    "little brighter. No studio light, no rim light, no golden glow. The whole room behind them is " +
    `in focus like a phone camera — ${setting.things} — real and lived in, not styled. ` +
    "Phone-camera quality: slightly soft, a little noise, plain colours. Not a portrait photo, not " +
    "a magazine shot. No text, logos or brand names anywhere. Wide 16:9 horizontal frame."
  );
}

const SETTING_SYSTEM =
  "You look at a photo of a video host and describe WHERE they are, for an image generator that " +
  "will re-shoot the same person in the same place. Reply with JSON only: {\"seat\": 5-12 words " +
  "on where they sit or stand, e.g. \"sitting at a workbench in a woodshop\"; \"place\": 2-6 " +
  "words starting with \"in\", e.g. \"in the woodshop\"; \"things\": 8-25 words listing the " +
  "ordinary things around them, e.g. \"a pegboard of hand tools, lumber racks, a table saw, a " +
  "window\"}. Never the person's face, age, name or look; never lighting or mood words; never any " +
  "writing, brand or logo.";

/** Read the host's setting off their photo; `PLAIN_SETTING` when it cannot be read. */
export async function describeHostSetting(photoUrl: string): Promise<HostSetting> {
  try {
    const resp = await fetch(await presignOwnBucketUrl(photoUrl), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`photo ${resp.status}`);
    const small = await sharp(Buffer.from(await resp.arrayBuffer()))
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    const r = await invokeClaude({
      systemPrompt: SETTING_SYSTEM,
      userMessage: "Where is this host?",
      imageInput: { base64: small.toString("base64"), mediaType: "image/png" },
      maxTokens: 2000,
      model: process.env.HOST_LOOK_MODEL || "claude-sonnet-5",
    });
    return parseHostSetting(r.text);
  } catch (err: any) {
    console.warn(`[HostPhoneLook] could not read the setting: ${err?.message ?? err}`);
    return PLAIN_SETTING;
  }
}

/** The model's JSON, each field trimmed and capped; a missing field falls back. Pure. */
export function parseHostSetting(raw: string): HostSetting {
  const m = /\{[\s\S]*\}/.exec(raw ?? "");
  let j: Partial<HostSetting> = {};
  try {
    j = m ? JSON.parse(m[0]) : {};
  } catch {
    j = {};
  }
  const clean = (v: unknown, fallback: string, words: number) => {
    const t = typeof v === "string" ? v.replace(/["“”]/g, "").replace(/\.$/, "").trim() : "";
    return t ? t.split(/\s+/).slice(0, words).join(" ") : fallback;
  };
  return {
    seat: clean(j.seat, PLAIN_SETTING.seat, 16),
    place: clean(j.place, PLAIN_SETTING.place, 8),
    things: clean(j.things, PLAIN_SETTING.things, 30),
  };
}

/** The APIMART key for a job-less image: the Edit key, else the first account that has one. */
async function apimartKey(): Promise<string> {
  const edit = await getApimartEditKey();
  if (edit) return edit;
  for (let slot = 0; slot < PROVIDER_ACCOUNT_MAX; slot++) {
    const key = await getApimartSlotKey(slot);
    if (key) return key;
  }
  throw new Error("no APIMART key — add one in Admin → Provider Keys");
}

/**
 * Make the phone-look version of the photo at `sourceUrl` and store it. Throws when the image
 * model fails or the result has no face.
 */
export async function makePhoneLookPhoto(sourceUrl: string): Promise<string> {
  const adapter = new ApimartAdapter(await apimartKey());
  const [r] = await adapter.generateImage({
    prompt: phoneLookPrompt(await describeHostSetting(sourceUrl)),
    model: "gpt-image-2",
    aspectRatio: "16:9",
    count: 1,
    // Providers get the PUBLIC url (CLAUDE.md: server-side READS presign, providers never do).
    imageUrls: [sourceUrl],
  } as any);
  if (!r?.success || !r.fileData?.length) throw new Error(r?.error || "the image model returned nothing");
  const buf = Buffer.from(r.fileData);
  if (!(await detectFace(buf))) throw new Error("no face in the phone-look result");
  const { url } = await storagePut(`host-photos/phone-${nanoid(10)}.png`, buf, "image/png");
  return url;
}

/** One make per photo at a time — a second list call joins the first. */
const inflight = new Map<number, Promise<string | null>>();

/**
 * Make a library photo's phone look if it has none (and was not switched to the original, and
 * has not already failed). Returns the phone-look URL, or null when there is none to use.
 * Records the outcome on the row. Never throws.
 */
export function ensurePhoneLook(row: ChannelHostPhoto): Promise<string | null> {
  if (row.phoneImageUrl) return Promise.resolve(row.phoneImageUrl);
  if (row.useOriginal || row.phoneLookError) return Promise.resolve(null);
  const running = inflight.get(row.id);
  if (running) return running;
  const job = (async () => {
    try {
      const url = await makePhoneLookPhoto(row.imageUrl);
      await updateChannelHostPhoto(row.id, { phoneImageUrl: url, phoneLookError: null });
      console.log(`[HostPhoneLook] photo ${row.id} (${row.channelKey}): phone look made`);
      return url;
    } catch (err: any) {
      const why = String(err?.message ?? err).slice(0, 250);
      await updateChannelHostPhoto(row.id, { phoneLookError: why }).catch(() => {});
      console.warn(`[HostPhoneLook] photo ${row.id} (${row.channelKey}): kept the original — ${why}`);
      return null;
    } finally {
      inflight.delete(row.id);
    }
  })();
  inflight.set(row.id, job);
  return job;
}

/** Start the phone look for every listed photo that still needs one — fire and forget. */
export function ensurePhoneLooks(rows: ChannelHostPhoto[]): void {
  for (const r of rows) if (r.isActive) void ensurePhoneLook(r);
}

/**
 * The phone look for a video that is starting now: wait up to `ms` for it, else null (the
 * caller renders the original and says so).
 */
export async function phoneLookWithin(row: ChannelHostPhoto, ms: number): Promise<string | null> {
  return Promise.race([
    ensurePhoneLook(row),
    new Promise<null>(res => setTimeout(() => res(null), ms)),
  ]);
}

/**
 * The phone look for ANY photo URL — the HeyGen test's uploads, which are not in a library.
 * Cached by the source URL in `app_settings`, so a photo is remade only once however many runs
 * test it.
 */
export async function phoneLookForUrl(sourceUrl: string): Promise<string> {
  const key = `phone_look:${createHash("sha1").update(sourceUrl).digest("hex")}`;
  const cached = await getAppSetting(key);
  if (cached) return cached;
  const url = await makePhoneLookPhoto(sourceUrl);
  await setAppSetting(key, url);
  return url;
}
