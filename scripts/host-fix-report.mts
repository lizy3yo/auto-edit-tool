/**
 * scripts/host-fix-report.mts — gather every host-fix test into one folder: the numbers, the
 * clips, the mouth contact sheets and the pictures (2026-10-16).
 *
 *   npx tsx scripts/host-fix-report.mts [--root bench/host-fix] [--out bench/host-fix/report]
 *
 * Reads what the benches wrote — host-photo-bench (<persona>/results.jsonl), host-picture-bench
 * (<persona>-pictures/report.json), combined-bench (combined/combined.json) — and writes
 * <out>/summary.json (per persona: each photo's medians over its renders, the winner, the picture
 * checks before and after) plus a media/ folder the results page and the zip are built from.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = opt("--root") ?? "bench/host-fix";
const OUT = opt("--out") ?? path.join(ROOT, "report");
const MEDIA = path.join(OUT, "media");
mkdirSync(MEDIA, { recursive: true });

const PERSONAS = [
  { key: "scarlett", ch: "scarlett_sterling", name: "Scarlett Sterling" },
  { key: "frederick", ch: "frederick_barnes", name: "Frederick Barnes" },
  { key: "dale", ch: "dale_oakfield", name: "Dale Oakfield" },
  { key: "hank", ch: "hank_hardwood", name: "Hank Hardwood" },
];
const TEETH_MIN = 0.85;
const SKIN_MIN = 4;

const median = (a: number[]) => {
  const s = a.filter(n => n != null && !Number.isNaN(n)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(3);
};
const readJsonl = (f: string) =>
  existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
const copy = (from: string, as: string) => {
  if (!existsSync(from)) return null;
  copyFileSync(from, path.join(MEDIA, as));
  return `media/${as}`;
};

const summary: any = { generatedAt: new Date().toISOString(), teethMin: TEETH_MIN, skinMin: SKIN_MIN, personas: [] };
for (const p of PERSONAS) {
  const dir = path.join(ROOT, p.key);
  // the lower-mouth verdict against Bertha (scripts/remeasure-mouths.mts), merged by clip
  const verdicts = new Map(readJsonl(path.join(dir, "mouth-vs-bertha.jsonl")).filter(o => o.lowerMouth).map(o => [o.clip, o]));
  const rows = readJsonl(path.join(dir, "results.jsonl")).map(r => {
    const v = verdicts.get(`${r.run.replace(/[#@]/, "-")}.mp4`);
    return v ? { ...r, mouthVsBertha: v.lowerMouth, mouthWhat: v.lowerMouthWhat, mouthPass: v.lowerMouth !== "clearly worse" } : r;
  });
  const byPhoto = new Map<string, any[]>();
  for (const r of rows) byPhoto.set(r.id, [...(byPhoto.get(r.id) ?? []), r]);
  const photos = [...byPhoto.entries()].map(([id, rs]) => {
    const teeth = rs.map(r => r.teethEdges).filter((x: any) => x != null);
    const skins = rs.map(r => r.clipSkin).filter((x: any) => x != null);
    const judged = rs.filter(r => r.mouthVsBertha);
    const mouthPassN = judged.filter(r => r.mouthPass).length;
    const teethPass = teeth.filter((t: number) => t >= TEETH_MIN).length;
    const skinPass = skins.filter((s: number) => s >= SKIN_MIN).length;
    const best = [...rs].sort((a, b) => (b.teethEdges ?? 0) - (a.teethEdges ?? 0))[0];
    return {
      id,
      photo: rs[0].photo,
      renders: rs.length,
      photoScore: rs[0].photoScore,
      photoSkin: rs[0].photoSkin,
      photoLips: rs[0].photoMouth,
      mouthVsBertha: judged.map(r => r.mouthVsBertha),
      mouthPass: `${mouthPassN}/${judged.length}`,
      teethMedian: median(teeth),
      teethMin: teeth.length ? Math.min(...teeth) : null,
      teethPass: `${teethPass}/${teeth.length}`,
      skinMedian: median(skins),
      skinPass: `${skinPass}/${skins.length}`,
      // the judged mouth (vs Bertha) decides when there is one; the teeth reading is reported only
      allPass: judged.length > 0 ? mouthPassN === judged.length && skinPass === skins.length : teeth.length > 0 && teethPass === teeth.length && skinPass === skins.length,
      image: copy(path.join(dir, `${id}.photo.jpg`), `${p.key}-${id}-photo.jpg`),
      clips: rs.map(r => copy(path.join(dir, `${r.run.replace(/[#@]/, "-")}.mp4`), `${p.key}-${r.run.replace(/[#@]/, "-")}.mp4`)).filter(Boolean),
      mouthSheet: best ? copy(path.join(dir, `${best.run.replace(/[#@]/, "-")}-mouth.jpg`), `${p.key}-${best.run.replace(/[#@]/, "-")}-mouth.jpg`) : null,
    };
  });
  // the winner: every render passes every check, then the highest worst-case teeth, then skin
  // the winner: the most renders passing BOTH checks, then the best worst-case teeth, then skin
  const passRate = (x: any) => {
    const [tp, tn] = (x.mouthPass !== "0/0" ? x.mouthPass : x.teethPass).split("/").map(Number);
    const [sp, sn] = x.skinPass.split("/").map(Number);
    return (tn ? tp / tn : 0) + (sn ? sp / sn : 0);
  };
  const winner = [...photos].sort(
    (a, b) =>
      Number(b.allPass) - Number(a.allPass) ||
      passRate(b) - passRate(a) ||
      (b.teethMin ?? 0) - (a.teethMin ?? 0) ||
      (b.skinMedian ?? 0) - (a.skinMedian ?? 0)
  )[0];
  let pictures: any = null;
  const picDir = [`${p.key}-pictures-r2`, `${p.key}-pictures`].map(d => path.join(ROOT, d)).find(d => existsSync(path.join(d, "report.json")));
  if (picDir) {
    const rep = JSON.parse(readFileSync(path.join(picDir, "report.json"), "utf8"));
    pictures = {
      after: rep.after,
      before: rep.before,
      hostLook: rep.hostLook,
      sheet: copy(path.join(picDir, "sheet.jpg"), `${p.key}-pictures-sheet.jpg`),
      afterImages: readdirSync(picDir).filter(f => /^after-\d+\.jpg$/.test(f)).sort().map(f => copy(path.join(picDir, f), `${p.key}-pic-${f}`)),
      beforeImages: readdirSync(picDir).filter(f => /^before-\d+\.jpg$/.test(f)).sort().map(f => copy(path.join(picDir, f), `${p.key}-pic-${f}`)),
    };
  }
  summary.personas.push({ ...p, photos, winner: winner?.id ?? null, pictures });
}
const combinedFile = path.join(ROOT, "combined", "combined.json");
if (existsSync(combinedFile)) {
  const c = JSON.parse(readFileSync(combinedFile, "utf8"));
  summary.combined = c.verdict;
  for (const r of c.rows) copy(path.join(ROOT, "combined", `${r.id}.mp4`), `combined-${r.id}.mp4`);
}
writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
for (const p of summary.personas)
  console.log(
    `${p.name}: winner ${p.winner} | ` +
      p.photos.map((x: any) => `${x.id} mouth ${x.mouthPass} ${JSON.stringify(x.mouthVsBertha)} skin ${x.skinPass}`).join(" · ")
  );
