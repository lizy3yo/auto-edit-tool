import { readFileSync } from "node:fs";
import { extractBookName } from "./server/ctaDetector.ts";
import { validateCtaMarkers, extractSpokenScript, titleMatcher, splitScriptForNarration } from "./server/longformVideo.ts";
const dir = "C:/Users/User/AppData/Local/Temp/claude/C--00-projects-auto-edit/a3776221-9052-47de-868a-b311319a9e05/scratchpad";
const layer = readFileSync(`${dir}/roger_the_pipe_guy.layer.md`, "utf8");
const raw = readFileSync(`${dir}/script-roger-2min-test.txt`, "utf8");
console.log("CR chars :", (raw.match(/\r/g) ?? []).length, "(must be 0)");
const cta = validateCtaMarkers(raw);
console.log("errors   :", cta.errors.length ? cta.errors : "none");
console.log("spans    :", cta.spans.length);
const spoken = extractSpokenScript(raw);
const w = spoken.split(/\s+/).filter(Boolean).length;
const secs = Math.round((w / 150) * 60);
console.log("words    :", w, `(~${Math.floor(secs/60)}m${String(secs%60).padStart(2,"0")}s)`);
console.log("tts segs :", splitScriptForNarration(spoken).length);
const nb = titleMatcher(extractBookName(layer) ?? undefined);
const all = spoken.replace(/\s+/g, " ").trim().split(" ");
for (const [n, s] of cta.spans.entries()) {
  const b = all.slice(s.start, s.end);
  let f = -1;
  for (let i = 0; i < b.length; i += 20) if (nb(b.slice(i, i + 20).join(" "))) { f = i; break; }
  console.log(`CTA#${n+1}: ${b.length}w at ${((s.start/all.length)*100).toFixed(0)}%, cover ${f<0?"NEVER FIRES":"fires @"+f}`);
}
