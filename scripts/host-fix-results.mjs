// scripts/host-fix-results.mjs — the results page and the zip for the host-fix work (2026-10-16).
//   node scripts/host-fix-results.mjs   → bench/host-fix/results/index.html + media/, and bench/host-fix/host-fix-results.zip
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = "bench/host-fix";
const OUT = path.join(ROOT, "results");
const MEDIA = path.join(OUT, "media");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(MEDIA, { recursive: true });
const rows = f => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const copy = (from, as) => { if (!existsSync(from)) return null; copyFileSync(from, path.join(MEDIA, as)); return `media/${as}`; };
const pill = (ok, t) => `<span class="pill ${ok === true ? "ok" : ok === false ? "bad" : "na"}">${esc(t)}</span>`;
const verdictLines = dir => (existsSync(path.join(ROOT, dir, "run.log")) ? readFileSync(path.join(ROOT, dir, "run.log"), "utf8").split("\n").filter(l => l.startsWith("[combined] ") && !l.includes("takes →")) : []);

// ── 1. the final all-channel round ──
function combinedTable(dir) {
  const comb = existsSync(path.join(ROOT, dir, "combined.json")) ? JSON.parse(readFileSync(path.join(ROOT, dir, "combined.json"), "utf8")) : null;
  if (!comb) return "<p>Not finished.</p>";
  const head = ["words", "noiseInPauses", "mouthOpens", "mouthSync", "lowerMouth", "skin"];
  const names = { words: "Every word", noiseInPauses: "Quiet pauses", mouthOpens: "Mouth closes in silence", mouthSync: "Lip-sync", lowerMouth: "Lower mouth vs Bertha", skin: "Real skin" };
  const body = comb.verdict.map(v => {
    const sample = comb.rows.find(r => r.ch === v.ch && r.tag === v.tag);
    const clip = sample ? copy(path.join(ROOT, dir, `${sample.id}.mp4`), `${dir}-${sample.id}.mp4`) : null;
    return `<tr><th>${esc(v.ch.replace(/_/g, " "))}${v.tag ? ` <small>${esc(v.tag)}</small>` : ""}</th><td>${v.takes}</td>${head.map(k => {
      const c = v.checks[k];
      return `<td>${c ? pill(c.of ? c.ok : null, `${c.passed}/${c.of}`) : ""}</td>`;
    }).join("")}<td>${pill(v.pass, v.pass ? "PASS" : "FAIL")}</td><td>${clip ? `<a href="${clip}">clip</a>` : ""}</td></tr>`;
  }).join("");
  return `<div class="scroll"><table><tr><th>Channel</th><th>Takes</th>${head.map(k => `<th>${names[k]}</th>`).join("")}<th>All</th><th></th></tr>${body}</table></div>`;
}

// ── 2. the base-photo tests per persona ──
function photoTable(key, name) {
  const verdicts = new Map(rows(path.join(ROOT, key, "mouth-vs-bertha.jsonl")).filter(o => o.lowerMouth).map(o => [o.clip, o.lowerMouth]));
  const by = new Map();
  for (const r of rows(path.join(ROOT, key, "results.jsonl"))) by.set(r.id, [...(by.get(r.id) ?? []), r]);
  const body = [...by.entries()].map(([id, list]) => {
    const mouth = list.map(r => verdicts.get(`${r.run.replace(/[#@]/, "-")}.mp4`)).filter(Boolean);
    const mOk = mouth.filter(m => m !== "clearly worse").length;
    const skin = list.map(r => r.clipSkin).filter(x => x != null);
    const sOk = skin.filter(s => s >= 4).length;
    const img = copy(path.join(ROOT, key, `${id}.photo.jpg`), `${key}-${id}.jpg`);
    const sheet = list.map(r => path.join(ROOT, key, `${r.run.replace(/[#@]/, "-")}-mouth.jpg`)).find(existsSync);
    const sheetUrl = sheet ? copy(sheet, `${key}-${id}-mouth.jpg`) : null;
    return `<tr><td>${img ? `<img src="${img}" alt="">` : ""}</td><td><b>${esc(id)}</b><br><small>${esc(list[0].photo)}</small></td><td>${list.length}</td><td>${pill(mouth.length ? mOk === mouth.length : null, `${mOk}/${mouth.length}`)}</td><td>${pill(sOk === skin.length, `${sOk}/${skin.length}`)}</td><td>${sheetUrl ? `<a href="${sheetUrl}">mouth frames</a>` : ""}</td></tr>`;
  }).join("");
  return `<h3>${esc(name)}</h3><div class="scroll"><table><tr><th></th><th>Photo</th><th>Renders</th><th>Lower mouth Bertha-level</th><th>Skin ≥ 4/5</th><th></th></tr>${body}</table></div>`;
}

// ── 3. the practice videos ──
function auditTable() {
  const list = [["372", "Dale — before (old code)"], ["377", "Dale — new code"], ["376", "Frederick — first run"], ["381", "Frederick — re-run (camera-view fix)"], ["362", "Scarlett — before (old code)"], ["378", "Scarlett — first run"], ["380", "Scarlett — re-run (camera-view fix)"], ["382", "Hank — 90 s practice video, new code"]];
  const body = list.map(([job, label]) => {
    const dir = ["362", "372"].includes(job) ? null : path.join(ROOT, `audit-${job}`, "report.json");
    let b = null;
    if (dir && existsSync(dir)) b = JSON.parse(readFileSync(dir, "utf8")).before;
    if (job === "372" && existsSync(path.join(ROOT, "dale-pictures", "report.json"))) b = JSON.parse(readFileSync(path.join(ROOT, "dale-pictures", "report.json"), "utf8")).before;
    if (job === "362" && existsSync(path.join(ROOT, "scarlett-pictures", "report.json"))) b = JSON.parse(readFileSync(path.join(ROOT, "scarlett-pictures", "report.json"), "utf8")).before;
    if (!b) return "";
    return `<tr><td>${esc(label)}</td><td>job ${job}</td><td>${b.pictures}</td><td>${pill(b.notHost.length === 0, `${b.notHost.length}`)}</td><td>${pill(b.nearCopies.length <= 2, `${b.nearCopies.length}`)}</td></tr>`;
  }).join("");
  return `<div class="scroll"><table><tr><th>Video</th><th>Job</th><th>Pictures checked</th><th>Not the host</th><th>Near-copy pairs</th></tr>${body}</table></div>`;
}

// ── 4. picture sheets ──
const sheets = [
  ["rest/v3-vs-v4.jpg", "Mouth rested, top before, bottom after — everything else kept. Kept in use: Hank, Dale, Norbert (mid-word). Put back to v3: the smiles (Amos's library photo, Hannah, Pearl, Ruth)"],
  ["rest/ruth-mouth-v3-v4.jpg", "Why smiles are left alone: Ruth's widest-open frames on v3 (top, her own teeth) and with her smile rested (bottom, invented teeth)"],
  ["side-by-side/mouth-strip-take1.jpg", "Same voice track, every 80 ms: Dale (top) and Frederick (bottom) open and close on the same frames — the +240 ms the pixel ruler reads on Dale is the beard, not the video"],
  ["dale-rest/sheets/dale_oakfield-rest-L1-r1-speak-vs-silent.jpg", "Dale on v4: top row speaking, bottom row in pauses"],
  ["ruth-check/quilting_with_granny_ruth-L1-r2-speak-vs-silent.jpg", "Before v4, Ruth: in pauses (bottom) the mouth stayed open with teeth"],
  ["scarlett-pictures/sheet.jpg", "Scarlett's routine pictures, new code: her photo, then every picture (green = passed as her)"],
  ["dale-pictures-r3/sheet.jpg", "Dale's phone screens, new code: each in its own setting"],
  ["v3-photos.jpg", "Version-3 phone looks (left original, right v3): real skin, lip-sync-ready mouth where the lips were hidden"],
  ["dale-372/closest-pairs.jpg", "Before: Dale's job 372 near-copies"],
  ["bertha/berthara-diykitchen-0051-mouth.jpg", "The benchmark: Bertha's mouth at its most open"],
].map(([f, cap]) => { const u = copy(path.join(ROOT, f), f.replace(/[\\/]/g, "-")); return u ? `<figure><img src="${u}" alt=""><figcaption>${esc(cap)}</figcaption></figure>` : ""; }).join("");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Host fix results</title>
<style>
:root{--bg:#f7f6f2;--fg:#1f2421;--mute:#5f6763;--line:#dcdcd4;--card:#fff;--ok:#1b7a4c;--bad:#b42318;--na:#8a7a3a;--accent:#2d5b4f}
@media (prefers-color-scheme:dark){:root{--bg:#141716;--fg:#e7ebe9;--mute:#9ba5a0;--line:#2d3431;--card:#1b201e;--ok:#63cc9b;--bad:#ff8f84;--na:#d8c27a;--accent:#8fc5b4}}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px 16px 64px}
main{max-width:1100px;margin:0 auto}h1{font-size:26px;margin:0 0 4px;text-wrap:balance}h2{font-size:19px;margin:36px 0 8px;color:var(--accent)}h3{font-size:16px;margin:22px 0 6px}
p,li{max-width:72ch}small{color:var(--mute)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13.5px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:middle}th{color:var(--mute);font-weight:600}
td img{width:160px;border-radius:4px}figure{margin:16px 0}figure img{max-width:100%;border:1px solid var(--line);border-radius:4px}figcaption{color:var(--mute);font-size:13px}
.pill{display:inline-block;padding:0 8px;border-radius:10px;border:1px solid currentColor;font-size:12.5px}.ok{color:var(--ok)}.bad{color:var(--bad)}.na{color:var(--na)}
.key{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:16px 0}.key div{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px}
</style></head><body><main>
<h1>Host photo, picture and voice fixes — test results</h1>
<p><small>Generated ${new Date().toLocaleString()} · every number below is measured on real renders (HeyGen test account, the real picture pipeline), not estimated.</small></p>

<div class="key">
<div><b>One photo per channel</b><br>Each video uses one photo, picked by score (face, light, sharpness, real skin, visible lips). Phone look only for that photo.</div>
<div><b>Phone look v3 + v4 (all channels)</b><br>Real skin in detail; a lip-sync-ready mouth where the lips were hidden; a photo caught mid-word gets its mouth rested closed (3 of 15).</div>
<div><b>Pictures</b><br>Face and make-up steps are drawn as the host and checked to be the host; screens vary; no near-copies anywhere in a video.</div>
<div><b>Voice</b><br>Winning settings from the voice session, plus a real pause after every sentence (the host's mouth closes).</div>
</div>

<h2>What ships — every channel's photo in use today, all checks</h2>
<p>Dale, Hank and Norbert (photo caught mid-word) on the mouth-rested v4 photo; every smiling host on their v3 photo. Each row is real HeyGen renders of the photo in use. Known causes of the remaining fails: <b>Dale, Roger lip-sync</b> — the pixel ruler misreads white beards (see below); <b>Hank, Mae words</b> — the voice says "Here's" for "Here is"; <b>Diane</b> — one of her two saved takes spoke a different line (a test mix-up), the comparable take passes; <b>Frederick, Ruth mouth closing</b> — HeyGen re-renders of the same photo and voice moved by a take; <b>Roger lower mouth</b> — his photo's mouth edit was refused twice for smoothing his skin.</p>
${combinedTable("shipped")}

<h2>Mouth-at-rest on every open-looking photo (first version)</h2>
<p>The same voice takes as the v3 round, on photos where any open mouth — smiles included — was rested. Smiles gained nothing and Ruth's lower mouth got worse, so the rule now rests only a mouth caught mid-word.</p>
${combinedTable("final-v4")}

<h2>Mouth-at-rest tests</h2>
<p>Ruth and Hannah (Hannah already passed: the edit must not hurt her), then Dale on the exact voice takes he failed on.</p>
${combinedTable("rest-test")}${combinedTable("dale-rest")}

<h2>White beards: the lip-sync ruler, not the video</h2>
<p>Voice and face swapped: Hank's voice on Dale's photo still reads +240 ms; Dale's voice on Frederick's photo passes. Watch the same-voice side by side: ${["1","3"].map(k => { const u = copy(path.join(ROOT, "side-by-side", `dale-vs-frederick-same-voice-take${k}.mp4`), `side-by-side-take${k}.mp4`); return u ? `<a href="${u}">take ${k}</a>` : ""; }).join(" · ")}.</p>
${combinedTable("dale-swap")}

<h2>Previous round — version-3 photos, all 15 channels</h2>
<p>Version-3 photos, the live voice settings and sentence pauses together. Each check passes when at least two thirds of the takes pass it. The lower mouth is judged side by side against Bertha (the brief's benchmark).</p>
${combinedTable("final")}
<h3>Before sentence pauses (same photos and voice settings)</h3>
${combinedTable("all-channels")}

<h2>Practice videos — the real pipeline, pictures only</h2>
<p>Every picture of each video judged twice: is a picture of the host really the host, and does any picture nearly copy another anywhere in the video.</p>
${auditTable()}

<h2>Base-photo tests per persona</h2>
<p>The same 10-second line on each candidate photo, rendered on HeyGen several times. These found the fixes that became the version-3 recipe.</p>
${photoTable("scarlett", "Scarlett")}${photoTable("frederick", "Frederick")}${photoTable("dale", "Dale")}${photoTable("hank", "Hank")}

<h2>Pictures</h2>
${sheets}
</main></body></html>`;
writeFileSync(path.join(OUT, "index.html"), html);

// the zip: the results page and EVERY test file
const zip = path.resolve(ROOT, "host-fix-results.zip");
rmSync(zip, { force: true });
execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${path.resolve(ROOT).replace(/'/g, "''")}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`], { stdio: "inherit" });
console.log(`results: ${path.join(OUT, "index.html")}\nzip: ${zip}`);
