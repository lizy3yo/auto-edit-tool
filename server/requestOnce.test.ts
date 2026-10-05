import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetOnceForTest, once } from "./requestOnce";

beforeEach(() => _resetOnceForTest());

describe("once — a paid click asked twice runs once", () => {
  it("gives a repeat of the same click the first one's result", async () => {
    let started = 0;
    const start = async () => ({ jobId: ++started });
    const first = await once("generate", 7, "click-a", start);
    const again = await once("generate", 7, "click-a", start);
    expect(started).toBe(1);
    expect(again).toEqual(first);
  });

  it("covers two that land together, before the first has finished", async () => {
    let started = 0;
    const start = () =>
      new Promise<number>(r => setTimeout(() => r(++started), 5));
    const [a, b] = await Promise.all([
      once("generate", 7, "click-a", start),
      once("generate", 7, "click-a", start),
    ]);
    expect(started).toBe(1);
    expect(a).toBe(b);
  });

  it("runs a different click, another person's click, and another route", async () => {
    let started = 0;
    const start = async () => ++started;
    await once("generate", 7, "click-a", start);
    await once("generate", 7, "click-b", start);
    await once("generate", 8, "click-a", start);
    await once("vsl.start", 7, "click-a", start);
    expect(started).toBe(4);
  });

  it("forgets a click that failed, so trying again really tries again", async () => {
    let tries = 0;
    const start = async () => {
      if (++tries === 1) throw new Error("no credits");
      return "ok";
    };
    await expect(once("generate", 7, "click-a", start)).rejects.toThrow();
    expect(await once("generate", 7, "click-a", start)).toBe("ok");
  });

  it("forgets after a while — an id is not a lock on the account", async () => {
    let started = 0;
    const start = async () => ++started;
    await once("generate", 7, "click-a", start, () => 0);
    await once("generate", 7, "click-a", start, () => 16 * 60_000);
    expect(started).toBe(2);
  });

  it("changes nothing for a page that sends no id", async () => {
    let started = 0;
    const start = async () => ++started;
    await once("generate", 7, undefined, start);
    await once("generate", 7, undefined, start);
    expect(started).toBe(2);
  });
});

describe("tripwire", () => {
  it("every route that starts a paid run from nothing goes through once()", () => {
    const routers = readFileSync(
      path.resolve(import.meta.dirname, "routers.ts"),
      "utf8"
    );
    for (const route of ["generate", "heygenTest.start", "vsl.start"])
      expect(routers).toContain(`once("${route}"`);
  });
});
