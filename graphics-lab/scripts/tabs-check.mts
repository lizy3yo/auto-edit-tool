// Why renders can differ by ±1 pixel: repeatability of FULL renders by GL backend and render-tab
// concurrency (3 runs each, decoded-frame MD5s). Finding (2026-10-16): only tabs > 1 varies, by
// ≥ 57 dB PSNR — invisible; tabs = 1 is bit-identical at half the speed.  tsx scripts/tabs-check.mts [Id]
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "node:path";
import { templateById } from "../src/registry.ts";
import { ffmpegPath, getBundle, outDir, run } from "./lib.mts";

const serveUrl = await getBundle();
const dir = outDir("glcheck");
const ff = ffmpegPath();
const id = process.argv[2] ?? "BigNumber";
const props = templateById(id).defaultProps;
for (const [gl, concurrency, codec] of [["angle", 4, "h264"], ["angle", 1, "h264"], ["swangle", 4, "h264"], ["angle", 4, "png-seq"]] as const) {
  const sets: string[] = [];
  const t0 = Date.now();
  for (let r = 0; r < 3; r++) {
    const composition = await selectComposition({ serveUrl, id, inputProps: props, chromiumOptions: { gl } });
    if (codec === "png-seq") {
      const out = path.join(dir, `${id}-${gl}-c${concurrency}-seq${r}.mov`);
      await renderMedia({ serveUrl, composition, inputProps: props, codec: "prores", proResProfile: "4444", imageFormat: "png", pixelFormat: "yuva444p10le", outputLocation: out, concurrency, chromiumOptions: { gl }, overwrite: true });
      sets.push(await run(ff, ["-hide_banner", "-loglevel", "error", "-i", out, "-map", "0:v", "-f", "framemd5", "-"]).then(s => s.replace(/^#.*$/gm, "")));
    } else {
      const out = path.join(dir, `${id}-${gl}-c${concurrency}-${r}.mp4`);
      await renderMedia({ serveUrl, composition, inputProps: props, codec: "h264", crf: 16, pixelFormat: "yuv420p", imageFormat: "jpeg", jpegQuality: 95, outputLocation: out, concurrency, chromiumOptions: { gl }, overwrite: true });
      sets.push(await run(ff, ["-hide_banner", "-loglevel", "error", "-i", out, "-map", "0:v", "-f", "framemd5", "-"]).then(s => s.replace(/^#.*$/gm, "")));
    }
  }
  console.log(`${gl.padEnd(8)} tabs=${concurrency} ${codec.padEnd(8)} ${new Set(sets).size === 1 ? "identical x3" : `${new Set(sets).size} different`}  ${((Date.now() - t0) / 3000).toFixed(1)} s/render`);
}
