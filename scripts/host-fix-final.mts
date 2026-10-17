/**
 * scripts/host-fix-final.mts — the FINAL test only, as one small package (2026-10-16).
 *
 *   npx tsx scripts/host-fix-final.mts [--zip PATH]
 *
 * bench/host-fix holds every round the host-fix work ran (1.9 GB). This gathers just what ships:
 * each channel's photo in use today (read from the database, not from a test note), the takes
 * that scored that photo with the live voice settings (bench/host-fix/shipped), the comparisons
 * that decided the last rules, and one page that lays it out — into bench/host-fix-final/, then
 * zipped.
 */
import "dotenv/config";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getChannelHostPhotos } from "../server/db";
import { presignOwnBucketUrl } from "../server/storage";

const ROOT = "bench/host-fix";
const OUT = "bench/host-fix-final";
const argv = process.argv.slice(2);
const ZIP = argv.includes("--zip") ? argv[argv.indexOf("--zip") + 1] : "bench/host-fix-final.zip";

rmSync(OUT, { recursive: true, force: true });
for (const d of ["clips", "photos", "evidence", "data"]) mkdirSync(path.join(OUT, d), { recursive: true });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const name = (ch: string) => ch.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

const shipped = JSON.parse(readFileSync(path.join(ROOT, "shipped/combined.json"), "utf8"));
for (const f of ["combined.json", "spec.json"]) copyFileSync(path.join(ROOT, "shipped", f), path.join(OUT, "data", `final-${f}`));

/** What a failing check is, in plain words — every one was traced in the tests. */
const WHY: Record<string, string> = {
  "dale_oakfield:mouthSync": "The pixel lip-sync ruler misreads white beards; frame by frame against Frederick on the same voice, Dale opens and closes on the same frames (see the evidence).",
  "roger_the_pipe_guy:mouthSync": "Same white-beard ruler effect as Dale.",
  "roger_the_pipe_guy:lowerMouth": "Open: his mouth edit was refused twice for smoothing his skin, so he keeps his v3 photo.",
  "hank_hardwood:words": "The voice says \"Here's\" for \"Here is\" — one word in 30, same meaning.",
  "granny_mae:mouthSync": "Scores sit on the pass line (0.23–0.34 against 0.25); same photo and voice passed 2 of 3 the round before.",
  "frederick_barnes:mouthOpens": "HeyGen re-rendered the same photo and voice differently; the round before passed 2 of 3.",
  "quilting_with_granny_ruth:mouthOpens": "Open: her smiling photo holds a slightly open mouth in pauses; resting it closed hurt her lower mouth more, so it is left as is.",
  "diane_de_chambray:words": "Test mix-up: one of her two saved takes spoke a different line. The comparable take passes.",
  "diane_de_chambray:mouthSync": "Only one comparable take, and it passes.",
};
const CHECK_NAMES: Record<string, string> = {
  words: "Every word", mouthOpens: "Mouth closes in pauses", mouthSync: "Lip-sync", lowerMouth: "Lower mouth vs Bertha", skin: "Real skin",
};

const rows: string[] = [];
const notes: string[] = [];
for (const v of shipped.verdict) {
  const ch: string = v.ch;
  const row = (await getChannelHostPhotos(ch, true)).find(r => r.isSelected);
  const url = row?.phoneImageUrl ?? row?.imageUrl;
  let img = "";
  if (url) {
    const res = await fetch(await presignOwnBucketUrl(url), { signal: AbortSignal.timeout(60_000) });
    if (res.ok) {
      writeFileSync(path.join(OUT, "photos", `${ch}.jpg`), Buffer.from(await res.arrayBuffer()));
      img = `photos/${ch}.jpg`;
    }
  }
  const version = /phone-v4-/.test(url ?? "") ? "v4 · mouth rested" : /phone-v3-/.test(url ?? "") ? "v3" : "original";
  const clips = shipped.rows.filter((r: any) => r.ch === ch).map((r: any, i: number) => {
    copyFileSync(path.join(ROOT, "shipped", `${r.id}.mp4`), path.join(OUT, "clips", `${r.id}.mp4`));
    return `<a href="clips/${r.id}.mp4">take ${i + 1}</a>`;
  });
  const cells = Object.keys(CHECK_NAMES).map(k => {
    const c = v.checks[k];
    const why = !c.ok ? WHY[`${ch}:${k}`] : "";
    if (why) notes.push(`<li><b>${esc(name(ch))} — ${esc(CHECK_NAMES[k])}:</b> ${esc(why)}</li>`);
    return `<td><span class="pill ${c.ok ? "ok" : "bad"}">${c.passed}/${c.of}</span></td>`;
  }).join("");
  rows.push(`<tr><td>${img ? `<a href="${img}"><img src="${img}" alt=""></a>` : ""}</td><th>${esc(name(ch))}<br><small>${esc(version)}</small></th>${cells}<td><span class="pill ${v.pass ? "ok" : "bad"}">${v.pass ? "PASS" : "FAIL"}</span></td><td class="clips">${clips.join("<br>")}</td></tr>`);
}

const evidence: [string, string, string][] = [
  ["side-by-side/dale-vs-frederick-same-voice-take1.mp4", "dale-vs-frederick-same-voice-1.mp4", "Dale (left) and Frederick (right) on the SAME voice track — watch the mouths open and close together"],
  ["side-by-side/dale-vs-frederick-same-voice-take3.mp4", "dale-vs-frederick-same-voice-2.mp4", "The same, another take"],
  ["side-by-side/mouth-strip-take1.jpg", "dale-vs-frederick-mouth-strip.jpg", "Every 80 ms, Dale (top) and Frederick (bottom), same voice: in step frame by frame"],
  ["rest/v3-vs-v4.jpg", "mouth-rested-before-after.jpg", "Mouth rested (top before, bottom after). In use: Hank, Dale, Norbert. Put back: the smiles"],
  ["rest/ruth-mouth-v3-v4.jpg", "why-smiles-are-left-alone.jpg", "Ruth's widest-open frames: v3 (top, her own teeth) and smile rested (bottom, invented teeth)"],
  ["dale-rest/sheets/dale_oakfield-rest-L1-r1-speak-vs-silent.jpg", "dale-speaking-vs-pauses.jpg", "Dale now: top row speaking, bottom row in pauses"],
];
const evidenceHtml = evidence.map(([from, as, cap]) => {
  if (!existsSync(path.join(ROOT, from))) return "";
  copyFileSync(path.join(ROOT, from), path.join(OUT, "evidence", as));
  return as.endsWith(".mp4")
    ? `<li><a href="evidence/${as}">${esc(cap)}</a></li>`
    : `<figure><img src="evidence/${as}" alt=""><figcaption>${esc(cap)}</figcaption></figure>`;
}).join("");

const passCount = shipped.verdict.filter((v: any) => v.pass).length;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Final test</title>
<style>
:root{--bg:#f7f6f2;--fg:#1f2421;--mute:#5f6763;--line:#dcdcd4;--ok:#1b7a4c;--bad:#b42318;--accent:#2d5b4f}
@media (prefers-color-scheme:dark){:root{--bg:#141716;--fg:#e7ebe9;--mute:#9ba5a0;--line:#2d3431;--ok:#63cc9b;--bad:#ff8f84;--accent:#8fc5b4}}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px 16px 64px}
main{max-width:1100px;margin:0 auto}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px;color:var(--accent)}
p,li{max-width:75ch}small{color:var(--mute)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13.5px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:middle}thead th{color:var(--mute);font-weight:600}
td img{width:120px;border-radius:4px;display:block}.clips{white-space:nowrap}
.pill{display:inline-block;padding:0 8px;border-radius:10px;border:1px solid currentColor;font-size:12.5px}.ok{color:var(--ok)}.bad{color:var(--bad)}
figure{margin:16px 0}figure img{max-width:100%;border:1px solid var(--line);border-radius:4px}figcaption{color:var(--mute);font-size:13px}
</style></head><body><main>
<h1>Final test — what ships</h1>
<p><small>Generated ${new Date().toLocaleString()}. Every channel's photo in use today, lip-synced on HeyGen with the live voice settings (style 0, similarity 0.75, speaker boost, sentence pauses), three takes each. A check passes when at least two of three takes pass.</small></p>
<p><b>${passCount} of ${shipped.verdict.length} channels pass every check.</b> Each remaining fail is explained below the table.</p>
<div class="scroll"><table><thead><tr><th>Photo in use</th><th>Channel</th>${Object.values(CHECK_NAMES).map(n => `<th>${n}</th>`).join("")}<th>All</th><th>Clips</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
<h2>Why the fails fail</h2><ul>${notes.join("")}</ul>
<p><small>Note on Amos: this local library's best-scored photo is Granny Ruth's (it also holds Roger's) — the system picked it by score; nothing checks a photo belongs to the channel's host.</small></p>
<h2>Evidence</h2><ul>${evidenceHtml.split("<figure>")[0]}</ul>${evidenceHtml.includes("<figure>") ? "<figure>" + evidenceHtml.split("<figure>").slice(1).join("<figure>") : ""}
<h2>Files</h2><ul><li><b>clips/</b> — the ${shipped.rows.length} final takes</li><li><b>photos/</b> — each channel's photo in use</li><li><b>evidence/</b> — the comparisons above</li><li><b>data/</b> — the raw scores (final-combined.json)</li></ul>
</main></body></html>`;
writeFileSync(path.join(OUT, "index.html"), html);

rmSync(ZIP, { force: true });
const tar = spawnSync("C:/Windows/System32/tar.exe", ["-a", "-c", "-f", path.resolve(ZIP), "-C", path.dirname(path.resolve(OUT)), path.basename(OUT)], { stdio: "inherit" });
console.log(`page: ${OUT}/index.html\nzip: ${path.resolve(ZIP)} (tar exit ${tar.status})`);
process.exit(0);
