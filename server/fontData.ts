import { readFileSync } from "fs";

let cache: { bold: string; regular: string } | null = null;

export function getInterFontsBase64(): { bold: string; regular: string } {
  if (cache) return cache;
  cache = {
    bold: readFileSync(
      new URL("./assets/fonts/Inter-Bold.ttf", import.meta.url)
    ).toString("base64"),
    regular: readFileSync(
      new URL("./assets/fonts/Inter-Regular.ttf", import.meta.url)
    ).toString("base64"),
  };
  return cache;
}
