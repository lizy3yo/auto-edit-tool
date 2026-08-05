import { createHash } from "crypto";

/**
 * Background-music bed library for longform films, one set PER CHANNEL: each channel's beds are
 * generated to match that persona's voice and niche and stored in THIS app's R2 bucket under
 * `music/beds/<channel>/` (run `node scripts/migrate-music-beds.mjs` once to copy them in).
 * Assembly lays these under the master narration at MUSIC_BED_DUCK_DB on the
 * `planMusicSchedule` music/silence pattern.
 *
 * Common to every set, and driven by the mix rather than taste: instrumental, no
 * drums/percussion/bass (transients raise LRA and fight the static loudnorm duck — there is no
 * sidechain), major key, flat dynamics, nothing harsh in the 1–4 kHz consonant band. Bright and
 * content, never melancholy: the audience skews 50+, and a minor-key underscore reads as a sad
 * film no matter what the narrator says.
 *
 * Two beds per channel, so a long film still reuses each one — a 30-minute film draws ~13
 * blocks. What keeps reuse from sounding like a loop is the reuse offset in videoAssembly
 * (`bedOffsets`): reuse n starts at min(n × 20s, bedSec − 120s). That is why each bed was
 * picked for LENGTH first (169–321s, i.e. 49–201s of offset room) and only then for a low LRA —
 * a bed barely over 120s would restart from the same place every time.
 *
 * Every bed clears the 120s music block, so each block is one continuous take with no in-block
 * looping. Adding another bed per channel is a one-line array push.
 *
 * ponytail: a static map of R2 object keys, not an R2 listing or a DB table. Ten keys change
 * about never, and a manifest fetch would be one more thing that can fail inside assembly.
 * URLs are resolved lazily from R2_PUBLIC_URL so the env can load after this module does.
 *
 * Keys are the `channelKey` values on the ten production `channel_configs` rows that carry a
 * personaProfile. Legacy channels get no set of their own and fall back — the one warn line per
 * job is the right signal if they ever come back.
 */
export const CHANNEL_MUSIC_BEDS: Record<string, string[]> = {
  // Garry Strickland — Midwest lawncare, trusted-neighbor tone. Fingerpicked steel-string.
  garrys_lawn: [
    "music/beds/garrys_lawn/bed-01.mp3",
    "music/beds/garrys_lawn/bed-02.mp3",
  ],
  // Pete Walker — lawncare "secrets". Curious question-and-answer figure; never suspenseful.
  petes_lawn_secrets: [
    "music/beds/petes_lawn_secrets/bed-01.mp3",
    "music/beds/petes_lawn_secrets/bed-02.mp3",
  ],
  // David Wright — retired lawncare pro. Warm guitar with mandolin above it.
  david_wright: [
    "music/beds/david_wright/bed-01.mp3",
    "music/beds/david_wright/bed-02.mp3",
  ],
  // David Yoder — Old Order Amish (Lancaster). Guitar + hammered dulcimer, nothing sacred.
  david_yoder: [
    "music/beds/david_yoder/bed-01.mp3",
    "music/beds/david_yoder/bed-02.mp3",
  ],
  // Elias Miller — Old Order Amish (Holmes). Autoharp instead of dulcimer, so the two Amish
  // channels never sound like the same cue.
  elias_miller: [
    "music/beds/elias_miller/bed-01.mp3",
    "music/beds/elias_miller/bed-02.mp3",
  ],
  // Roy Mullins — eastern Kentucky homestead. Mountain idiom in a MAJOR key: modal reads
  // mournful, and the persona is contented.
  roy_mullins: [
    "music/beds/roy_mullins/bed-01.mp3",
    "music/beds/roy_mullins/bed-02.mp3",
  ],
  // Travis "Tiny" Kolbe — Texas pitmaster. Western-swing lilt with pedal steel, no kit.
  travis_tiny_kolbe: [
    "music/beds/travis_tiny_kolbe/bed-01.mp3",
    "music/beds/travis_tiny_kolbe/bed-02.mp3",
  ],
  // Wes Kingfisher — Cherokee plant medicine and woodcraft. Sustained guitar + wooden flute;
  // no tom-toms, no vocables, no Hollywood-Indian pastiche — his profile rejects it outright.
  wes_kingfisher: [
    "music/beds/wes_kingfisher/bed-01.mp3",
    "music/beds/wes_kingfisher/bed-02.mp3",
  ],
  // Debra Wilson — flowers. The brightest of the ten; lift comes from register, since the
  // bells/celeste that would be the obvious choice are transients.
  debra_wilson: [
    "music/beds/debra_wilson/bed-01.mp3",
    "music/beds/debra_wilson/bed-02.mp3",
  ],
  // Donna Larsen — Northwoods hunting and fishing. Two guitars trading a walking pattern:
  // upbeat here means companionable, not jaunty, under a pre-dawn deer-stand story.
  // bed-02/-03, not -01: the first take came back depressing and was retired.
  donna_larsen: [
    "music/beds/donna_larsen/bed-02.mp3",
    "music/beds/donna_larsen/bed-03.mp3",
  ],
};

/**
 * Channel used when a job's `channelKey` has no set of its own — the most neutral warm-acoustic
 * of the ten, which suits the gardening/lawncare legacy channels that are what actually falls
 * through here.
 */
export const DEFAULT_MUSIC_CHANNEL = "garrys_lawn";

/** Full public URL for a bed's R2 object key. Read lazily so dotenv can load after import. */
export function musicBedUrl(key: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

/**
 * `count` bed URLs for one job, drawn from `channelKey`'s set and shuffled deterministically
 * from `seed` (the job id): the pick feels random across jobs, but a retried assembly rebuilds
 * the SAME soundtrack instead of a different one. Draws without repetition; wraps with a fresh
 * shuffle only when a film needs more blocks than the channel has beds. Pure — unit-tested.
 *
 * An unknown channel falls back to the default set rather than throwing: losing a film's whole
 * soundtrack over a missing config row is out of proportion to the problem. No R2_PUBLIC_URL at
 * all → [] with a warn, and assembly degrades to narration-only.
 */
export function pickMusicBeds(
  count: number,
  seed: string,
  channelKey?: string
): string[] {
  if (!process.env.R2_PUBLIC_URL) {
    console.warn(
      "[music] R2_PUBLIC_URL is not set — skipping music beds (narration only). " +
        "Set it and run scripts/migrate-music-beds.mjs to enable them."
    );
    return [];
  }
  let beds = channelKey ? CHANNEL_MUSIC_BEDS[channelKey] : undefined;
  if (!beds?.length) {
    if (channelKey && channelKey !== DEFAULT_MUSIC_CHANNEL)
      console.warn(
        `[music] no bed set for channel "${channelKey}" — using ${DEFAULT_MUSIC_CHANNEL}`
      );
    beds = CHANNEL_MUSIC_BEDS[DEFAULT_MUSIC_CHANNEL];
  }
  // Belt and braces: the wrap loop below never terminates on an empty pool, and assembly
  // already degrades to narration-only on an empty URL list.
  if (!beds?.length) return [];
  const out: string[] = [];
  for (let round = 0; out.length < count; round++) {
    const shuffled = seededShuffle(beds, `${seed}:${round}`);
    out.push(...shuffled.slice(0, count - out.length));
  }
  return out.map(musicBedUrl);
}

/** Fisher-Yates driven by a sha256 keystream over `seed` — same seed, same order. */
function seededShuffle(items: string[], seed: string): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const h = createHash("sha256").update(`${seed}:${i}`).digest();
    const j = h.readUInt32BE(0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
