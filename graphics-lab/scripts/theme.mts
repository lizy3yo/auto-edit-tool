// A video's graphics theme, from the HOST PHOTO that video was made with (the job's own
// `faceImageUrl`, so the colours match what is on screen — the phone-look copy when that was used).
//   tsx scripts/theme.mts --job 385
// Writes out/jobs/<job>/theme.json and theme-swatch.png (the card ground, the accent, every text
// colour, and the contrast each one reaches).
import path from "node:path";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { argbFromRgb } from "@material/material-color-utilities";
import { MIN_CONTRAST, themeFromPixels } from "../src/palette.ts";
import { outDir } from "./lib.mts";

const jobId = Number(process.argv[process.argv.indexOf("--job") + 1]);
const container = process.env.MYSQL_CONTAINER ?? "auto-edit-tool-mysql-1";
const photoUrl = execFileSync(
  "docker",
  ["exec", container, "mysql", "-ulongform", "-plongform", "longform", "-N", "-B", "-e",
    `select json_unquote(json_extract(inputParams,'$.faceImageUrl')) from longform_video_jobs where id=${jobId}`],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
).trim();
if (!/^https?:\/\//.test(photoUrl)) throw new Error(`job ${jobId} has no host photo (${photoUrl})`);

const buf = Buffer.from(await (await fetch(photoUrl)).arrayBuffer());
// 160 px wide is plenty to find a colour and keeps quantizing instant.
const { data, info } = await sharp(buf).resize(160).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const pixels: number[] = [];
for (let i = 0; i < data.length; i += info.channels) pixels.push(argbFromRgb(data[i], data[i + 1], data[i + 2]));
const { theme, report } = themeFromPixels(pixels);
const dir = outDir("jobs", String(jobId));
writeFileSync(path.join(dir, "theme.json"), JSON.stringify({ photoUrl, theme, report }, null, 1));

// Swatch: the photo beside a mini card in the theme, and the contrast table.
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const ok = (v: number, min: number) => (v >= min ? "#5BD18B" : "#FF5A4E");
const svg = `<svg width="960" height="540" xmlns="http://www.w3.org/2000/svg">
<rect width="960" height="540" fill="${theme.bg}"/>
<radialGradient id="g" cx="50%" cy="45%" r="45%"><stop offset="0" stop-color="${theme.glow}"/><stop offset="1" stop-color="${theme.bg}" stop-opacity="0"/></radialGradient>
<rect width="960" height="540" fill="url(#g)"/>
<text x="60" y="80" font-family="Arial" font-weight="700" font-size="18" letter-spacing="4" fill="${theme.accent}">THE WRONG ALARM</text>
<rect x="60" y="92" width="70" height="3" fill="${theme.accent}"/>
<text x="60" y="160" font-family="Arial" font-weight="800" font-size="52" fill="${theme.text}">It isn't broken.</text>
<text x="60" y="222" font-family="Arial" font-weight="800" font-size="52" fill="${theme.text}">It isn't <tspan fill="${theme.accent}">dead.</tspan></text>
<text x="60" y="270" font-family="Arial" font-weight="600" font-size="22" fill="${theme.textMuted}">Quiet secondary text</text>
<text x="60" y="340" font-family="Arial" font-size="17" fill="#FFFFFF">Text on ground ${report.contrast.text}:1 (min ${MIN_CONTRAST.text}) <tspan fill="${ok(report.contrast.text, MIN_CONTRAST.text)}">●</tspan></text>
<text x="60" y="366" font-family="Arial" font-size="17" fill="#FFFFFF">Accent on ground ${report.contrast.accent}:1 (min ${MIN_CONTRAST.accent}) <tspan fill="${ok(report.contrast.accent, MIN_CONTRAST.accent)}">●</tspan></text>
<text x="60" y="392" font-family="Arial" font-size="17" fill="#FFFFFF">Muted on ground ${report.contrast.muted}:1 (min ${MIN_CONTRAST.muted}) <tspan fill="${ok(report.contrast.muted, MIN_CONTRAST.muted)}">●</tspan></text>
<text x="60" y="418" font-family="Arial" font-size="17" fill="#FFFFFF">Accent on label plate ${report.contrast.accentOnPlate}:1 (min ${MIN_CONTRAST.accentOnPlate}) <tspan fill="${ok(report.contrast.accentOnPlate, MIN_CONTRAST.accentOnPlate)}">●</tspan></text>
<text x="60" y="470" font-family="Arial" font-size="15" fill="${theme.textMuted}">${esc(report.note)}</text>
<text x="60" y="494" font-family="Arial" font-size="15" fill="${theme.textMuted}">ground ${theme.bg} · glow ${theme.glow} · accent ${theme.accent} · muted ${theme.textMuted}</text>
</svg>`;
const card = await sharp(Buffer.from(svg)).png().toBuffer();
const photo = await sharp(buf).resize(540, 540, { fit: "cover" }).toBuffer();
await sharp({ create: { width: 1500, height: 540, channels: 3, background: "#000" } })
  .composite([{ input: photo, left: 0, top: 0 }, { input: card, left: 540, top: 0 }])
  .png()
  .toFile(path.join(dir, "theme-swatch.png"));
console.log(JSON.stringify({ theme, report }, null, 1));
