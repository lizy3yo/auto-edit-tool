import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";

let configured = false;

/**
 * Make the bundled Inter fonts resolvable through fontconfig, independent of
 * the host environment.
 *
 * sharp rasterizes our cover SVGs via librsvg, which can only register an
 * embedded `@font-face` font when a working fontconfig (with a font directory)
 * is present. The production runtime is a minimal Nix container with no
 * `/etc/fonts` and no installed fonts, so the embedded Inter fails to register
 * and every glyph renders as tofu (`.notdef`). Pointing FONTCONFIG_FILE at a
 * config whose `<dir>` is our bundled Inter folder makes `font-family="Inter"`
 * resolve everywhere.
 *
 * Idempotent. Must run before the first sharp text render — fontconfig
 * initializes once per process. NOT enough on its own on Windows: see
 * `interFontReady`, which every text render awaits.
 */
export function ensureFontConfig(): void {
  if (configured) return;
  configured = true;

  // Resolves to server/assets/fonts in dev and dist/assets/fonts in prod
  // (the build copies server/assets -> dist/assets).
  const fontsDir = fileURLToPath(new URL("./assets/fonts", import.meta.url));

  const cacheDir = join(tmpdir(), "garden-flow-fc-cache");
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch {
    // Non-fatal: fontconfig still works without a writable cache (just slower).
  }

  const confPath = join(tmpdir(), "garden-flow-fonts.conf");
  const conf = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir}</dir>
  <cachedir>${cacheDir}</cachedir>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
</fontconfig>
`;

  writeFileSync(confPath, conf, "utf8");
  process.env.FONTCONFIG_FILE = confPath;
}

/** The bundled Inter files, registered one by one with fontconfig by `interFontReady`. */
const INTER_FILES = ["Inter-Regular.ttf", "Inter-Bold.ttf"].map(f =>
  fileURLToPath(new URL(`./assets/fonts/${f}`, import.meta.url))
);

/** Text whose drawn width tells Inter Bold from the fonts a machine falls back to (Times, Arial,
 * Segoe UI, Tahoma and DejaVu all draw it 3% or more wider or narrower). */
const PROBE = "Hamburgefonstiv 0123";
const PROBE_PX = 100;
/** How far the two drawings of the probe may differ and still both be Inter Bold: measured 0.2%
 * apart on one machine; the nearest fallback (Segoe UI) is 3% away. */
const PROBE_TOLERANCE = 0.015;

/** The drawn (ink) width of an image's non-transparent pixels. */
async function inkWidth(png: Buffer): Promise<number> {
  const { info } = await sharp(png).trim().toBuffer({ resolveWithObject: true });
  return info.width;
}

/** The probe as librsvg draws `font-family="Inter"` — the path every card and cover takes. */
async function probeAsSvg(): Promise<number> {
  const w = PROBE_PX * PROBE.length;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${PROBE_PX * 2}">` +
    `<text x="${PROBE_PX / 2}" y="${PROBE_PX * 1.4}" font-size="${PROBE_PX}" font-family="Inter" ` +
    `font-weight="700" fill="white">${PROBE}</text></svg>`;
  return inkWidth(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** The probe drawn straight from the Inter Bold FILE — the reference the SVG drawing must match. */
async function probeFromFile(): Promise<number> {
  return inkWidth(
    await sharp({
      text: { text: PROBE, font: `Inter Bold ${PROBE_PX}`, fontfile: INTER_FILES[1], dpi: 72 },
    })
      .png()
      .toBuffer()
  );
}

let ready: Promise<boolean> | null = null;

/**
 * Make `font-family="Inter"` resolve for librsvg, then check that it does. Every sharp/librsvg text
 * render (the host name card, asset captions, ebook covers) awaits this BEFORE drawing.
 *
 * Why `ensureFontConfig` was not enough: the practice films assembled on Windows (jobs 405 and 407)
 * shipped the host name card in a Times-style serif. librsvg ignores `@font-face` data URIs, so
 * Inter can only come from fontconfig — and on Windows `process.env.FONTCONFIG_FILE` set from Node
 * never reaches the C runtime's `getenv` inside the libvips DLL, so fontconfig never read our
 * config and every family, "Inter" included, fell back to Times New Roman with no error.
 *
 * The fix registers each bundled Inter file with the process's fontconfig directly: sharp's text
 * input with `fontfile` makes libvips call `FcConfigAppFontAddFile` on the current config, which is
 * the one librsvg reads — no environment variable involved, so it works on every platform (and is
 * harmless where the config already found the folder). It must come FIRST: Pango caches a family
 * lookup per thread, and a thread that drew "Inter" before registration keeps its fallback for the
 * life of the process (measured: an SVG drawn before stayed Times, 24 drawn after were all Inter).
 *
 * Then the check: the probe drawn through librsvg must match the probe drawn from the Inter Bold
 * file (an equality test against an unknown family would fail in production, where Inter is the
 * only font installed and every family falls back to it). A miss is logged once, never thrown —
 * a card in the wrong font beats no card. Resolves to whether Inter is in use. Memoised.
 */
export function interFontReady(): Promise<boolean> {
  ready ??= (async () => {
    ensureFontConfig();
    try {
      for (const fontfile of INTER_FILES) {
        await sharp({ text: { text: "Inter", font: "Inter", fontfile } }).png().toBuffer();
      }
      // In this order, never together: drawing from the file registers it as a side effect, and a
      // check run alongside it could pass on that instead of on the registration above.
      const drawn = await probeAsSvg();
      const reference = await probeFromFile();
      const ok = Math.abs(drawn - reference) <= reference * PROBE_TOLERANCE;
      if (!ok)
        console.warn(
          `[fonts] librsvg is not drawing Inter (probe ${drawn}px, Inter Bold ${reference}px) — ` +
            `name cards, captions and covers fall back to another font`
        );
      return ok;
    } catch (err) {
      console.warn(
        `[fonts] could not register Inter: ${err instanceof Error ? err.message : err}`
      );
      return false;
    }
  })();
  return ready;
}
