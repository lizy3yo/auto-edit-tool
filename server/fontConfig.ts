import { fileURLToPath } from "url";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

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
 * initializes once per process.
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
