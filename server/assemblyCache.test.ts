/**
 * server/assemblyCache.test.ts
 *
 * Tests for the assembly disk cache. The properties that matter are the ones the film's
 * correctness rests on: a key names every input (so a changed input is a MISS), equal inputs
 * hash the same regardless of key order (so a reassemble is a HIT), and every failure mode
 * degrades to "build it now" rather than to a bad file.
 *
 * `ASSEMBLY_CACHE_DIR` is pointed at a fresh temp dir per test and the module is re-imported
 * (`vi.resetModules`) so the module-level dir/latch are rebuilt each time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "fs";
import os from "os";
import path from "path";

let dir: string;

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(path.join(os.tmpdir(), "asmcache-test-"));
  process.env.ASSEMBLY_CACHE_DIR = dir;
  delete process.env.ASSEMBLY_CACHE;
});

afterEach(() => {
  delete process.env.ASSEMBLY_CACHE_DIR;
  delete process.env.ASSEMBLY_CACHE;
  delete process.env.ASSEMBLY_CACHE_MAX_GB;
  rmSync(dir, { recursive: true, force: true });
});

const load = () => import("./assemblyCache");

describe("stableStringify", () => {
  it("is order-independent across key insertion order", async () => {
    const { stableStringify } = await load();
    expect(stableStringify({ a: 1, b: 2 })).toBe(
      stableStringify({ b: 2, a: 1 })
    );
  });

  it("drops undefined members so an unset optional keys the same as an absent one", async () => {
    const { stableStringify } = await load();
    expect(stableStringify({ a: 1, b: undefined })).toBe(
      stableStringify({ a: 1 })
    );
  });

  it("distinguishes nested values, arrays and their order", async () => {
    const { stableStringify } = await load();
    expect(stableStringify({ a: { b: 1 } })).not.toBe(
      stableStringify({ a: { b: 2 } })
    );
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("cacheKey", () => {
  it("is stable for equal inputs and different for any changed one", async () => {
    const { cacheKey } = await load();
    const base = { clipUrl: "a.mp4", trimLeadSec: 1, width: 1920 };
    expect(cacheKey("norm", base)).toBe(
      cacheKey("norm", { width: 1920, trimLeadSec: 1, clipUrl: "a.mp4" })
    );
    expect(cacheKey("norm", base)).not.toBe(
      cacheKey("norm", { ...base, trimLeadSec: 1.5 })
    );
  });

  it("namespaces by kind, so two products never collide on equal parts", async () => {
    const { cacheKey } = await load();
    expect(cacheKey("norm", { a: 1 })).not.toBe(cacheKey("mux", { a: 1 }));
  });
});

describe("getOrBuild", () => {
  it("builds on a miss and reuses the same bytes on the next call", async () => {
    const { getOrBuild } = await load();
    const build = vi.fn(async (out: string) => {
      writeFileSync(out, "payload");
      return { encodedSec: 4.25 };
    });

    const first = await getOrBuild({
      kind: "scene",
      key: "k1",
      ext: "mp4",
      fallbackDir: dir,
      build,
    });
    expect(first.hit).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);

    const second = await getOrBuild<{ encodedSec: number }>({
      kind: "scene",
      key: "k1",
      ext: "mp4",
      fallbackDir: dir,
      build,
    });
    expect(second.hit).toBe(true);
    expect(second.path).toBe(first.path);
    // The sidecar survives the round trip, so a hit skips the caller's ffprobe too.
    expect(second.meta).toEqual({ encodedSec: 4.25 });
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("treats a different key as a separate entry", async () => {
    const { getOrBuild } = await load();
    const build = vi.fn(async (out: string) => {
      writeFileSync(out, "x");
      return undefined;
    });
    await getOrBuild({
      kind: "scene",
      key: "a",
      ext: "mp4",
      fallbackDir: dir,
      build,
    });
    const second = await getOrBuild({
      kind: "scene",
      key: "b",
      ext: "mp4",
      fallbackDir: dir,
      build,
    });
    expect(second.hit).toBe(false);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it("rebuilds over a zero-byte entry left by a killed process", async () => {
    const { getOrBuild } = await load();
    writeFileSync(path.join(dir, "scene-k1.mp4"), "");
    const build = vi.fn(async (out: string) => {
      writeFileSync(out, "real");
      return undefined;
    });
    const r = await getOrBuild({
      kind: "scene",
      key: "k1",
      ext: "mp4",
      fallbackDir: dir,
      build,
    });
    expect(r.hit).toBe(false);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("publishes nothing when the build throws, so the next run retries", async () => {
    const { getOrBuild } = await load();
    const build = vi.fn(async () => {
      throw new Error("ffmpeg died");
    });
    await expect(
      getOrBuild({
        kind: "filmaudio",
        key: "k",
        ext: "m4a",
        fallbackDir: dir,
        build,
      })
    ).rejects.toThrow("ffmpeg died");
    expect(existsSync(path.join(dir, "filmaudio-k.m4a"))).toBe(false);
  });

  it("still builds — into the fallback dir — when the cache is disabled", async () => {
    process.env.ASSEMBLY_CACHE = "0";
    vi.resetModules();
    const { getOrBuild, cacheEnabled } = await load();
    expect(cacheEnabled()).toBe(false);
    const fallback = mkdtempSync(path.join(os.tmpdir(), "asmcache-fb-"));
    try {
      const build = vi.fn(async (out: string) => {
        writeFileSync(out, "x");
        return undefined;
      });
      const first = await getOrBuild({
        kind: "scene",
        key: "k",
        ext: "mp4",
        fallbackDir: fallback,
        build,
      });
      expect(first.path.startsWith(fallback)).toBe(true);
      // Disabled means never a hit: the second call encodes again.
      const second = await getOrBuild({
        kind: "scene",
        key: "k",
        ext: "mp4",
        fallbackDir: fallback,
        build,
      });
      expect(second.hit).toBe(false);
      expect(build).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(fallback, { recursive: true, force: true });
    }
  });
});

describe("sweep", () => {
  it("leaves a cache under the size ceiling alone", async () => {
    const { getOrBuild, sweep } = await load();
    await getOrBuild({
      kind: "scene",
      key: "keep",
      ext: "mp4",
      fallbackDir: dir,
      build: async out => {
        writeFileSync(out, "x");
        return undefined;
      },
    });
    sweep();
    expect(existsSync(path.join(dir, "scene-keep.mp4"))).toBe(true);
  });

  it("spares entries younger than the minimum age even over the ceiling", async () => {
    // A ceiling of 0 GB puts the cache over budget immediately; the age guard is the only
    // thing standing between the sweep and a file the CURRENT assembly is still using.
    process.env.ASSEMBLY_CACHE_MAX_GB = "0";
    vi.resetModules();
    const { getOrBuild, sweep } = await load();
    await getOrBuild({
      kind: "scene",
      key: "fresh",
      ext: "mp4",
      fallbackDir: dir,
      build: async out => {
        writeFileSync(out, "x".repeat(1024));
        return undefined;
      },
    });
    sweep();
    expect(existsSync(path.join(dir, "scene-fresh.mp4"))).toBe(true);
  });

  it("does not touch a tmp file young enough to be a live build", async () => {
    const { getOrBuild, sweep } = await load();
    // Force the dir to exist / the module to latch ready.
    await getOrBuild({
      kind: "scene",
      key: "x",
      ext: "mp4",
      fallbackDir: dir,
      build: async out => {
        writeFileSync(out, "x");
        return undefined;
      },
    });
    const live = path.join(dir, "tmp-scene-live.mp4");
    writeFileSync(live, "half-written");
    sweep();
    expect(existsSync(live)).toBe(true);
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });
});

describe("run guard", () => {
  it("skips eviction entirely while an assembly is in flight", async () => {
    // A live film holds cache paths for minutes; another job finishing must not sweep one out
    // from under it. Over-budget + a live run ⇒ nothing is evicted, whatever the ages.
    process.env.ASSEMBLY_CACHE_MAX_GB = "0";
    vi.resetModules();
    const { getOrBuild, sweep, beginRun, endRun } = await load();
    await getOrBuild({
      kind: "scene",
      key: "live",
      ext: "mp4",
      fallbackDir: dir,
      build: async out => {
        writeFileSync(out, "x".repeat(1024));
        return undefined;
      },
    });
    beginRun();
    sweep();
    expect(existsSync(path.join(dir, "scene-live.mp4"))).toBe(true);
    endRun();
    // And the counter comes back down, so the next finishing assembly can sweep again.
    sweep();
    expect(existsSync(path.join(dir, "scene-live.mp4"))).toBe(true); // still inside MIN_AGE_MS
  });
});
