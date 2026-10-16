// Inter (SIL OFL 1.1), served from the project's own `public/` — never fetched from a font CDN
// at render time, so a render is the same offline, on the server and in a year.
import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

const WEIGHTS = [500, 600, 700, 800, 900] as const;

let loaded: Promise<unknown> | null = null;

export function loadInter(): Promise<unknown> {
  loaded ??= Promise.all(
    WEIGHTS.map(weight =>
      loadFont({
        family: "Inter",
        url: staticFile(`fonts/inter-latin-${weight}-normal.woff2`),
        weight: String(weight),
        format: "woff2",
      })
    )
  );
  return loaded;
}
