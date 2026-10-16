/**
 * scripts/host-picture-bench.mts — draw a channel's picture lines exactly as a video does, and
 * report what came back (2026-10-15).
 *
 *   npx tsx scripts/host-picture-bench.mts --channel KEY --lines FILE.txt --out DIR [--before JOB]
 *   npx tsx scripts/host-picture-bench.mts --channel KEY --from-job JOB --screens --out DIR
 *
 * Two of the review's problems are about pictures, not the talking head:
 *   - Scarlett: her routine pictures showed "a different woman";
 *   - Dale: his phone-screen pictures came back almost the same, again and again.
 * Each line becomes a picture beat and goes through the SAME code a film's pictures go through:
 * the host look read off the channel's photo (`deriveHostLook`), the host marks (`markHostBroll`,
 * which now sends a step on the host's own face to `hostFaceClause`), the screen settings
 * (`assignScreenSetups`), and `generateValidatedStill` with every check — the still checks, the new
 * "is it the host?" check and the whole-video near-copy check (run inside a job context, as in a
 * film). Then every picture is judged once more, independently, for the report: is it the host
 * (`scanSameHost`), and which pairs are near-copies (fingerprint + `scanNearCopy`).
 *
 * --lines: one picture description per line ("#" lines are skipped).
 * --from-job JOB --screens: the screen pictures of an earlier job, drawn again (Dale's 372).
 * --before JOB: also judge that job's own pictures of the same kind, as the "before" column.
 */
import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { StoryboardScene } from "../shared/types";
import { getChannelHostPhotos, getLongformVideoJobById } from "../server/db";
import { deriveHostLook, markHostBroll, SHOWS_PERSON } from "../server/hostLook";
import { pickHostPhoto } from "../server/hostPhotoSelection";
import { hostPhotoUrl } from "../shared/hostPhotoLook";
import { buildStillPrompt, generateValidatedStill } from "../server/longformVideo";
import { generateStillWithFallback } from "../server/providers/fallback";
import { apimartKey } from "../server/hostPhoneLook";
import { withCostMeter } from "../server/costMeter";
import { presignOwnBucketUrl, storagePut } from "../server/storage";
import { scanNearCopy, scanSameHost } from "../server/overlayTextScan";
import {
  assignScreenSetups,
  hashDistance,
  NEAR_COPY_BITS,
  pictureHash,
  pictureThumb,
  SCREEN_PICTURE,
} from "../server/pictureVariety";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const CH = opt("--channel")!;
const OUT = opt("--out") ?? `bench/host-fix/${CH}-pictures`;
const LINES = opt("--lines");
const FROM_JOB = opt("--from-job");
const BEFORE = opt("--before") ?? FROM_JOB;
const SCREENS = argv.includes("--screens");
/** With --from-job: only the pictures that show a person (the host at work), at most --limit. */
const PEOPLE = argv.includes("--people");
const LIMIT = +(opt("--limit") ?? 999);
/** Judge pictures already drawn into --out (after-NN.jpg) instead of drawing again. */
const JUDGE_ONLY = argv.includes("--judge-only");
/** With --before: judge EVERY picture of that job for near-copies (not only its person pictures). */
const ALL_BEFORE = argv.includes("--all-pictures");
mkdirSync(OUT, { recursive: true });

const load = async (url: string) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(await presignOwnBucketUrl(url), { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw e;
    }
  }
};
const storyboardOf = async (jobId: number): Promise<StoryboardScene[]> => {
  const job: any = await getLongformVideoJobById(jobId);
  const sb = typeof job.storyboard === "string" ? JSON.parse(job.storyboard) : job.storyboard;
  return (Array.isArray(sb) ? sb : sb.scenes) as StoryboardScene[];
};
const isScreen = (s: StoryboardScene) => SCREEN_PICTURE.test(`${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`);

// the channel's ONE photo, in the look a video uses
const photos = await getChannelHostPhotos(CH, true);
const chosen = pickHostPhoto(photos.filter(p => p.isSelected).length === 1 ? photos.filter(p => p.isSelected) : photos)!;
const hostPhoto = hostPhotoUrl(chosen);
const hostLook = await deriveHostLook(hostPhoto);
console.log(`[pictures] ${CH}: photo #${chosen.id}, look: ${hostLook}`);

// the beats
let scenes: StoryboardScene[];
if (FROM_JOB) {
  const old = await storyboardOf(+FROM_JOB);
  scenes = old
    .filter(s => !s.hostPresent && (!SCREENS || isScreen(s)) && (!PEOPLE || !!s.humanPresent || SHOWS_PERSON.test(`${s.showSubject ?? ""} ${s.visualPrompt ?? ""}`)))
    .slice(0, LIMIT)
    .map((s, i) => ({
      index: i + 1,
      visualPrompt: s.visualPrompt,
      showSubject: s.showSubject,
      scriptText: s.scriptText,
      humanPresent: s.humanPresent,
      otherPerson: s.otherPerson,
      keyThing: s.keyThing,
      partOf: s.partOf,
      namedLook: s.namedLook,
      pictureText: s.pictureText,
    }) as StoryboardScene);
} else if (!LINES) {
  scenes = [];
} else {
  scenes = readFileSync(LINES!, "utf8")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"))
    .map((line, i) => ({ index: i + 1, visualPrompt: line, showSubject: line, scriptText: line }) as StoryboardScene);
}
markHostBroll(scenes, { hostLook }, hostPhoto);
assignScreenSetups(scenes);

// draw them as a film does, in a job context (the near-copy check is per video)
const key = await apimartKey();
const BENCH_JOB = 900_000 + Math.floor(Math.random() * 99_999);
const rows: any[] = [];
const hostBuf = await load(hostPhoto);
await sharp(hostBuf).resize(640).jpeg({ quality: 85 }).toFile(path.join(OUT, "host-photo.jpg"));
if (JUDGE_ONLY) {
  const { existsSync } = await import("node:fs");
  for (const s of scenes) {
    const file = `after-${String(s.index).padStart(2, "0")}.jpg`;
    if (!existsSync(path.join(OUT, file))) continue;
    rows.push({ index: s.index, line: s.showSubject, host: !!s.brollHostRef, faceShown: !!s.hostFaceShown, screenSetup: s.screenSetup ?? null, file, buffer: readFileSync(path.join(OUT, file)), prompt: buildStillPrompt(s) });
  }
} else await withCostMeter(BENCH_JOB, async () => {
  for (let i = 0; i < scenes.length; i += 3)
    await Promise.all(
      scenes.slice(i, i + 3).map(async s => {
        try {
          const { buffer } = await generateValidatedStill(s, 4, undefined, inp => generateStillWithFallback({ ...inp, apimartKey: key }), undefined);
          const file = `after-${String(s.index).padStart(2, "0")}.jpg`;
          await sharp(buffer).resize(960).jpeg({ quality: 85 }).toFile(path.join(OUT, file));
          rows.push({ index: s.index, line: s.showSubject, host: !!s.brollHostRef, faceShown: !!s.hostFaceShown, screenSetup: s.screenSetup ?? null, file, buffer, prompt: buildStillPrompt(s) });
          console.log(`[pictures] ${s.index} drawn${s.brollHostRef ? (s.hostFaceShown ? " (host, face)" : " (host)") : ""}${s.screenSetup ? ` (screen: ${s.screenSetup.slice(0, 40)}…)` : ""}`);
        } catch (e: any) {
          console.error(`[pictures] ${s.index}: ${e?.message ?? e}`);
        }
      })
    );
});
rows.sort((a, b) => a.index - b.index);

// independent judging for the report
const judge = async (items: { index: number; buffer: Buffer; host: boolean; faceShown: boolean }[]) => {
  const who = await Promise.all(items.map(async it => (it.host ? await scanSameHost(hostPhoto, it.buffer, it.faceShown) : null)));
  const hashes = await Promise.all(items.map(it => pictureHash(it.buffer)));
  const thumbs = await Promise.all(items.map(it => pictureThumb(it.buffer)));
  const copies: { a: number; b: number; what: string }[] = [];
  for (let b = 0; b < items.length; b++)
    for (let a = 0; a < b; a++)
      if (hashDistance(hashes[a], hashes[b]) <= NEAR_COPY_BITS) {
        const v = await scanNearCopy(thumbs[a], thumbs[b]);
        if (v.copy) copies.push({ a: items[a].index, b: items[b].index, what: v.what });
      }
  return { who, copies };
};
const after = await judge(rows);
rows.forEach((r, i) => (r.isHost = after.who[i] ? after.who[i]!.same : null, r.notHost = after.who[i]?.what || ""));

let before: any = null;
if (BEFORE) {
  const old = (await storyboardOf(+BEFORE)).filter(s => !s.hostPresent && ((s as any).stillSourceUrl || (s as any).pictureUrl) && (ALL_BEFORE ? true : FROM_JOB && SCREENS ? isScreen(s) : !!s.humanPresent || !!s.brollHostRef));
  const loaded = await Promise.all(
    old.map(async s => {
      try {
        const buffer = await load((s as any).stillSourceUrl || (s as any).pictureUrl);
        await sharp(buffer).resize(960).jpeg({ quality: 85 }).toFile(path.join(OUT, `before-${String(s.index).padStart(2, "0")}.jpg`));
        return { index: s.index, buffer, host: !!s.brollHostRef && !s.otherPerson, faceShown: !!s.hostFaceShown, line: s.showSubject ?? s.visualPrompt };
      } catch (e: any) {
        console.warn(`[pictures] before ${s.index}: ${e?.message ?? e}`);
        return null;
      }
    })
  );
  const items = loaded.filter((x): x is NonNullable<typeof x> => !!x);
  const j = await judge(items);
  before = {
    job: +BEFORE,
    pictures: items.length,
    notHost: items.filter((_, i) => j.who[i] && !j.who[i]!.same).map((it, k) => ({ index: it.index, line: it.line })),
    nearCopies: j.copies,
  };
}

// contact sheet: the host photo, then every picture with its verdict
const W = 480, Hh = 270;
const tiles = [{ input: await sharp(hostBuf).resize(W, Hh, { fit: "cover" }).toBuffer(), left: 0, top: 0 }];
for (const [k, r] of rows.entries()) {
  const label = `${r.index}${r.host ? (r.isHost === false ? " NOT HOST" : " host OK") : ""}`;
  const svg = Buffer.from(`<svg width="${W}" height="28"><rect width="${W}" height="28" fill="black" opacity="0.6"/><text x="8" y="20" font-size="18" fill="${r.isHost === false ? "#ff6b6b" : "#9be29b"}" font-family="Arial">${label}</text></svg>`);
  tiles.push({ input: await sharp(r.buffer).resize(W, Hh, { fit: "cover" }).composite([{ input: svg, left: 0, top: 0 }]).toBuffer(), left: ((k + 1) % 3) * W, top: Math.floor((k + 1) / 3) * Hh });
}
await sharp({ create: { width: W * 3, height: Hh * Math.ceil((rows.length + 1) / 3), channels: 3, background: "#111" } })
  .composite(tiles)
  .jpeg({ quality: 85 })
  .toFile(path.join(OUT, "sheet.jpg"));

const report = {
  channel: CH,
  photo: hostPhoto,
  hostLook,
  after: {
    pictures: rows.length,
    hostPictures: rows.filter(r => r.host).length,
    faceShown: rows.filter(r => r.faceShown).length,
    notHost: rows.filter(r => r.isHost === false).map(r => ({ index: r.index, line: r.line, what: r.notHost })),
    nearCopies: after.copies,
    screens: rows.filter(r => r.screenSetup).map(r => ({ index: r.index, setting: r.screenSetup })),
  },
  before,
  pictures: rows.map(({ buffer, ...r }) => r),
};
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ after: report.after, before }, null, 1));
void storagePut;
process.exit(0);
