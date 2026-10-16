// scripts/host-fix-live.mjs — a live progress page for the host-fix tests (2026-10-16).
//   node scripts/host-fix-live.mjs    → rewrites bench/host-fix/live.html every 20 s (the page reloads itself)
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "bench/host-fix";
const rows = f => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : []);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = f => (existsSync(f) ? `${Math.round((Date.now() - statSync(f).mtimeMs) / 60000)} min ago` : "—");
const pill = (ok, text) => `<span class="pill ${ok === true ? "ok" : ok === false ? "bad" : "wait"}">${esc(text)}</span>`;

function photoSection(key, name) {
  const verdicts = new Map(rows(path.join(ROOT, key, "mouth-vs-bertha.jsonl")).filter(o => o.lowerMouth).map(o => [o.clip, o.lowerMouth]));
  const rs = rows(path.join(ROOT, key, "results.jsonl"));
  const by = new Map();
  for (const r of rs) by.set(r.id, [...(by.get(r.id) ?? []), r]);
  const lines = [...by.entries()].map(([id, list]) => {
    const mouth = list.map(r => verdicts.get(`${r.run.replace(/[#@]/, "-")}.mp4`)).filter(Boolean);
    const mouthOk = mouth.filter(m => m !== "clearly worse").length;
    const skin = list.map(r => r.clipSkin).filter(x => x != null);
    const skinOk = skin.filter(s => s >= 4).length;
    const all = mouth.length && mouthOk === mouth.length && skinOk === skin.length;
    return `<tr><td>${esc(id)}</td><td>${list.length}</td><td>${mouth.length ? pill(mouthOk === mouth.length, `${mouthOk}/${mouth.length} Bertha-level`) : pill(null, "judging")}</td><td>${pill(skinOk === skin.length, `${skinOk}/${skin.length} skin ≥ 4`)}</td><td>${all ? pill(true, "PASSES") : ""}</td></tr>`;
  });
  return `<section><h3>${esc(name)} — base photos <small>${rs.length} renders, updated ${ago(path.join(ROOT, key, "results.jsonl"))}</small></h3><table><tr><th>Photo</th><th>Renders</th><th>Lower mouth</th><th>Skin</th><th></th></tr>${lines.join("") || "<tr><td colspan=5>none yet</td></tr>"}</table></section>`;
}

function combinedSection(dir, title) {
  const rs = rows(path.join(ROOT, dir, "results.jsonl"));
  const log = existsSync(path.join(ROOT, dir, "run.log")) ? readFileSync(path.join(ROOT, dir, "run.log"), "utf8") : "";
  const verdicts = log.split("\n").filter(l => l.startsWith("[combined] ") && !l.includes("takes →"));
  const errs = [...new Set(log.split("\n").filter(l => /^[a-z_]+-[a-z0-9-]+-L\d-r\d: /.test(l)).map(l => l.slice(0, 160)))];
  const body = rs.map(o => `<tr><td>${esc(o.id)}</td><td>${o.wer === 0 ? "all" : esc(o.wer)}</td><td>${esc(o.lufs)}</td><td>${esc(o.gapDb)} dB</td><td>${pill(o.syncPass, `r ${o.syncR} · ${o.syncLagMs} ms`)}</td></tr>`).join("");
  return `<section><h3>${esc(title)} <small>${rs.length} takes, updated ${ago(path.join(ROOT, dir, "results.jsonl"))}</small></h3>
  <table><tr><th>Take</th><th>Words said</th><th>LUFS</th><th>Noise in pauses</th><th>Lip-sync</th></tr>${body || "<tr><td colspan=5>rendering…</td></tr>"}</table>
  ${verdicts.map(v => `<p class="verdict">${esc(v.replace("[combined] ", ""))}</p>`).join("")}
  ${errs.length ? `<p class="err">${errs.map(esc).join("<br>")}</p>` : ""}</section>`;
}

function rehearsalSection() {
  const items = ["frederick", "dale", "scarlett", "hank", "scarlett2", "frederick2", "hank2"].map(k => {
    const f = path.join(ROOT, "rehearsal", `${k}.log`);
    if (!existsSync(f)) return null;
    const stages = readFileSync(f, "utf8").split("\n").filter(l => l.startsWith("[stress]"));
    const last = stages.at(-1) ?? "starting";
    return `<tr><td>${esc(k)}</td><td>${esc(last.replace("[stress] ", ""))}</td><td>${ago(f)}</td></tr>`;
  }).filter(Boolean);
  const audits = ["376", "377", "378", "380", "381"].map(j => {
    const f = path.join(ROOT, `audit-${j}`, "report.json");
    if (!existsSync(f)) return null;
    const b = JSON.parse(readFileSync(f, "utf8")).before;
    return `<tr><td>job ${j}</td><td>${b.pictures} pictures</td><td>${pill(b.notHost.length === 0, `${b.notHost.length} not the host`)}</td><td>${pill(b.nearCopies.length <= 1, `${b.nearCopies.length} near-copy pairs`)}</td></tr>`;
  }).filter(Boolean);
  return `<section><h3>Practice videos (real pipeline, pictures only)</h3><table><tr><th>Run</th><th>Stage</th><th>Last activity</th></tr>${items.join("")}</table>
  <table><tr><th>Video</th><th>Pictures</th><th>Identity</th><th>Variety</th></tr>${audits.join("")}</table></section>`;
}

function build() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="20"><title>Host fix tests</title>
<style>
:root{--bg:#f6f7f5;--fg:#1c2421;--mute:#5d6b66;--line:#d9dfdc;--ok:#1d7a4f;--bad:#b3261e;--wait:#8a6d1f}
@media (prefers-color-scheme:dark){:root{--bg:#141917;--fg:#e6ece9;--mute:#9aa8a2;--line:#2c3532;--ok:#5cc999;--bad:#ff8a80;--wait:#e0c069}}
body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:16px}
h1{font-size:20px;margin:0 0 4px}h3{font-size:15px;margin:22px 0 6px}small{color:var(--mute);font-weight:400}
table{border-collapse:collapse;width:100%;margin:6px 0;font-variant-numeric:tabular-nums}td,th{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;font-size:13px}th{color:var(--mute);font-weight:600}
.pill{padding:1px 8px;border-radius:10px;font-size:12px;border:1px solid currentColor}.ok{color:var(--ok)}.bad{color:var(--bad)}.wait{color:var(--wait)}
.verdict{font-family:ui-monospace,monospace;font-size:12px;margin:3px 0}.err{color:var(--bad);font-size:12px}
section{overflow-x:auto}
</style></head><body>
<h1>Host fix tests — live</h1><p style="color:var(--mute)">Refreshes every 20 s · built ${new Date().toLocaleTimeString()}</p>
${combinedSection("final", "FINAL: all 15 channels, everything combined (v3 photos + live voice + sentence pauses)")}
${combinedSection("all-channels", "Before: all 15 channels, v3 photos + live voice, no sentence pauses")}
${combinedSection("dale-combined", "Dale: winning voice + new photos, with and without sentence pauses")}
${combinedSection("combined2", "Combined round 2: photos + voice (breath cleaning — ruled out)")}
${combinedSection("combined", "Combined round 1: photos + voice")}
${rehearsalSection()}
${photoSection("scarlett", "Scarlett")}${photoSection("frederick", "Frederick")}${photoSection("hank", "Hank")}${photoSection("dale", "Dale")}
</body></html>`;
  writeFileSync(path.join(ROOT, "live.html"), html);
}
build();
setInterval(build, 20000);
