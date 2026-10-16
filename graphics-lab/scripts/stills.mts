// Quick visual review: every template's settled frame (and a mid-animation frame), overlays laid
// on a real frame of our own footage, as one contact sheet. Usage:
//   tsx scripts/stills.mts [--bg path/to/frame.png] [--only Id,Id] [--tag round1] [--theme out/jobs/385/theme.json]
import sharp from "sharp";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { TEMPLATES } from "../src/registry.ts";
import { FPS, WIDTH, HEIGHT } from "../src/theme.ts";
import { outDir, renderFrame } from "./lib.mts";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const tag = arg("--tag") ?? "latest";
const only = arg("--only")?.split(",");
const bg = arg("--bg");
const dir = outDir("stills", tag);
const themeArg = arg("--theme");
const theme = themeArg ? JSON.parse(readFileSync(themeArg, "utf8")).theme : undefined;

const tiles: { file: string; label: string }[] = [];
for (const t of TEMPLATES) {
  if (only && !only.includes(t.id)) continue;
  const total = Math.round(t.defaultProps.durationSec * FPS);
  for (const [name, frame] of [
    ["mid", Math.round(total * 0.3)],
    ["end", total - 12],
  ] as const) {
    const raw = path.join(dir, `${t.id}-${name}-raw.png`);
    await renderFrame(t.id, theme ? { ...t.defaultProps, theme } : t.defaultProps, frame, raw);
    const file = path.join(dir, `${t.id}-${name}.png`);
    if (t.kind === "overlay" && bg && existsSync(bg)) {
      let base = sharp(bg).resize(WIDTH, HEIGHT);
      if (t.underlay === "blur") base = base.blur(18);
      await base.composite([{ input: raw }]).png().toFile(file);
    } else {
      await sharp(raw).flatten({ background: "#808080" }).png().toFile(file);
    }
    tiles.push({ file, label: `${t.id} · ${name}` });
    console.log("still", t.id, name);
  }
}

// Contact sheet, two columns.
const w = 960;
const h = 540;
const lab = 36;
const cols = 2;
const rows = Math.ceil(tiles.length / cols);
const comps = await Promise.all(
  tiles.flatMap((t, i) => {
    const left = (i % cols) * w;
    const top = Math.floor(i / cols) * (h + lab);
    const label = Buffer.from(
      `<svg width="${w}" height="${lab}"><rect width="100%" height="100%" fill="#111"/><text x="12" y="25" font-family="Arial" font-size="20" fill="#ffd400">${t.label}</text></svg>`
    );
    return [
      sharp(label).png().toBuffer().then(input => ({ input, left, top })),
      sharp(t.file).resize(w, h).toBuffer().then(input => ({ input, left, top: top + lab })),
    ];
  })
);
const sheet = path.join(dir, `sheet-${tag}.jpg`);
await sharp({ create: { width: w * cols, height: rows * (h + lab), channels: 3, background: "#000" } })
  .composite(comps)
  .jpeg({ quality: 82 })
  .toFile(sheet);
console.log("sheet", sheet);
