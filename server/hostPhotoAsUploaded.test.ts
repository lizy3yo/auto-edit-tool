import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { describe, expect, it } from "vitest";

/**
 * Host photos are used AS UPLOADED (2026-10-05): the "phone look" copy and its Phone / Original
 * switch were removed everywhere. Its database columns were kept on purpose, unread — so the one
 * way the feature comes back by accident is code reading them again. This fails if any does.
 */
const ROOT = join(__dirname, "..");
const DIRS = ["server", "shared", "client/src"];
const RETIRED = /\b(phoneImageUrl|useOriginal|phoneLookError)\b/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === "node_modules" ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("host photos are used as uploaded", () => {
  it("no code reads the retired phone-look columns", () => {
    const offenders = DIRS.flatMap(d => sources(join(ROOT, d)))
      .filter(f => !f.endsWith("hostPhotoAsUploaded.test.ts"))
      .filter(f => RETIRED.test(readFileSync(f, "utf8")))
      .map(f => relative(ROOT, f).replace(/\\/g, "/"));
    expect(offenders).toEqual([]);
  });

  it("the columns themselves are still in the schema, so the copies made are not lost", () => {
    const schema = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf8");
    expect(schema).toMatch(/phoneImageUrl: varchar\("phoneImageUrl"/);
    expect(schema).toMatch(/useOriginal: boolean\("useOriginal"\)/);
  });
});
