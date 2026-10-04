import { describe, expect, it } from "vitest";
import {
  countScriptWords,
  estimateTestSeconds,
  HEYGEN_TEST_MAX_IMAGES,
  HEYGEN_TEST_MAX_SEC,
  HEYGEN_TEST_MAX_WORDS,
  friendlyHeygenTestError,
  heygenTestInputError,
  heygenTestProgress,
  pageList,
  accountToSlot,
  heygenAccountLabel,
  pickHeygenTestAccount,
  slotToAccount,
  HEYGEN_TEST_ACCOUNT_SLOT,
  type HeygenTestAccount,
} from "../shared/heygenTest";
import { heygenTestCostUsd } from "./heygenTest";
import { RATES } from "./pricing";

const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
const img = (i: number) => `https://cdn.example.com/host-${i}.jpg`;

describe("HeyGen test bench limits", () => {
  it("caps the script at ~30 s of the calibrated read rate", () => {
    expect(HEYGEN_TEST_MAX_WORDS).toBe(84);
    expect(estimateTestSeconds(words(42))).toBeCloseTo(15, 5);
    // Past the cap the estimate stops growing: the audio is cut there before HeyGen sees it.
    expect(estimateTestSeconds(words(500))).toBe(HEYGEN_TEST_MAX_SEC);
  });

  it("counts words on whitespace, ignoring padding", () => {
    expect(countScriptWords("  hello   there\nfriend ")).toBe(3);
    expect(countScriptWords("   ")).toBe(0);
  });

  it("accepts a script at the cap with up to four distinct photos", () => {
    expect(
      heygenTestInputError({
        script: words(HEYGEN_TEST_MAX_WORDS),
        imageUrls: [1, 2, 3, 4].map(img),
      })
    ).toBeNull();
  });

  it("refuses what would waste or overspend a render", () => {
    expect(heygenTestInputError({ script: " ", imageUrls: [img(1)] })).toMatch(
      /script/
    );
    expect(
      heygenTestInputError({
        script: words(HEYGEN_TEST_MAX_WORDS + 1),
        imageUrls: [img(1)],
      })
    ).toMatch(/85 words/);
    expect(heygenTestInputError({ script: "hi", imageUrls: [] })).toMatch(
      /photo/
    );
    expect(
      heygenTestInputError({
        script: "hi",
        imageUrls: Array.from({ length: HEYGEN_TEST_MAX_IMAGES + 1 }, (_, i) =>
          img(i)
        ),
      })
    ).toMatch(/At most/);
    // The same photo twice is two identical paid renders.
    expect(
      heygenTestInputError({ script: "hi", imageUrls: [img(1), img(1)] })
    ).toMatch(/twice/);
  });
});

describe("heygenTestCostUsd", () => {
  it("prices only a render HeyGen accepted, by the seconds rendered", () => {
    expect(heygenTestCostUsd({ audioMs: 30_000, videoId: null })).toBe(0);
    expect(heygenTestCostUsd({ audioMs: null, videoId: "v1" })).toBe(0);
    expect(heygenTestCostUsd({ audioMs: 30_000, videoId: "v1" })).toBeCloseTo(
      30 * RATES.heygenPerSecond,
      6
    );
  });
});

describe("pickHeygenTestAccount — the account a test or VSL run is given", () => {
  const pick = (
    busy: HeygenTestAccount[],
    o: { testKey?: boolean; pool?: number[]; sharedKey?: boolean } = {}
  ) =>
    pickHeygenTestAccount({
      testKey: o.testKey ?? true,
      pool: o.pool ?? [0, 1, 4],
      sharedKey: o.sharedKey ?? false,
      busy,
    });

  it("takes the test account first — no film renders on it, so no video is slowed", () => {
    expect(pick([])).toBe("test");
    // Every film account idle changes nothing: a tie goes to the test account.
    expect(pick([0, 0, 1])).toBe("test");
  });

  it("goes to the least busy account once the test account is in use", () => {
    expect(pick(["test"])).toBe(0);
    expect(pick(["test", 0, 1])).toBe(4);
    expect(pick(["test", "test", 0, 0, 1, 4])).toBe(1);
  });

  it("takes the lowest number on a tie", () => {
    expect(pick(["test", 0, 1, 4])).toBe("test");
    expect(pick(["test", "test", 0, 1, 4])).toBe(0);
  });

  it("is never refused because every account is busy — the run waits its turn", () => {
    const account = pick(["test", "test", 0, 0, 1, 1, 4, 4]);
    expect(account).not.toBeNull();
    expect(account).toBe("test");
  });

  it("counts films and test clips against the same number", () => {
    // Two films on Account 1, two test clips on Account 2: both are equally busy.
    expect(pick(["test", 0, 0, 1, 1], { pool: [0, 1] })).toBe("test");
    expect(pick(["test", "test", 0, 0, 1], { pool: [0, 1] })).toBe(1);
  });

  it("uses the pool when there is no test account", () => {
    expect(pick([0], { testKey: false })).toBe(1);
  });

  it("falls back to the shared key only when no account has one", () => {
    expect(pick([], { testKey: false, pool: [], sharedKey: true })).toBe(
      "shared"
    );
    expect(pick([], { testKey: false, pool: [0], sharedKey: true })).toBe(0);
  });

  it("returns nothing when there is no HeyGen key at all", () => {
    expect(pick([], { testKey: false, pool: [], sharedKey: false })).toBeNull();
  });

  it("names the account a clip's card shows", () => {
    expect(heygenAccountLabel("test")).toBe("Test account");
    expect(heygenAccountLabel(0)).toBe("Account 1");
    expect(heygenAccountLabel(6)).toBe("Account 7");
    expect(heygenAccountLabel("shared")).toBe("Shared account");
  });
});

describe("heygen_tests.heygenSlot <-> account", () => {
  it("round-trips every account kind", () => {
    for (const a of [0, 4, "shared", "test"] as HeygenTestAccount[])
      expect(slotToAccount(accountToSlot(a))).toBe(a);
  });

  it("keeps the stored values rows already have", () => {
    expect(accountToSlot("shared")).toBeNull();
    expect(accountToSlot(3)).toBe(3);
    expect(accountToSlot("test")).toBe(HEYGEN_TEST_ACCOUNT_SLOT);
    expect(HEYGEN_TEST_ACCOUNT_SLOT).toBeLessThan(0);
  });
});

describe("heygenTestProgress", () => {
  const T0 = Date.parse("2026-09-25T10:00:00Z");
  const at = (sec: number) => T0 + sec * 1000;
  const row = (
    status: string,
    videoId: string | null = null,
    audioMs: number | null = 30_000
  ) => ({ status, videoId, audioMs, phaseStartedAt: new Date(T0) });

  it("maps each stage onto its share of the bar", () => {
    expect(
      heygenTestProgress(row("voicing", null, null), at(0), 30)
    ).toMatchObject({
      phase: "voicing",
      percent: 0,
    });
    expect(heygenTestProgress(row("rendering"), at(0), 30)?.phase).toBe(
      "preparing"
    );
    expect(heygenTestProgress(row("rendering", "v1"), at(0), 30)).toMatchObject(
      {
        phase: "rendering",
        percent: 30,
      }
    );
    expect(heygenTestProgress(row("done", "v1"), at(0), 30)).toBeNull();
    expect(heygenTestProgress(row("failed"), at(0), 30)).toBeNull();
  });

  it("never goes backwards and never reaches 100 before the clip is done", () => {
    let last = -1;
    const stages = [
      row("voicing", null, null),
      row("rendering"),
      row("rendering", "v1"),
    ];
    for (const r of stages)
      for (let sec = 0; sec <= 3_600; sec += 5) {
        const p = heygenTestProgress(r, at(sec), 30)!;
        expect(p.percent).toBeLessThan(100);
        // Within a stage, and across a stage change (the next stage starts where this one ends).
        if (sec > 0) expect(p.percent).toBeGreaterThanOrEqual(last);
        last = p.percent;
      }
  });

  it("estimates time left, and flags a stage running past its typical length", () => {
    // 30 s of audio renders in ~215 s typically.
    const early = heygenTestProgress(row("rendering", "v1"), at(15), 30)!;
    expect(early.etaSec).toBeCloseTo(200, 0);
    expect(early.overdue).toBe(false);
    const late = heygenTestProgress(row("rendering", "v1"), at(600), 30)!;
    expect(late.overdue).toBe(true);
    expect(late.percent).toBeGreaterThan(90);
  });
});

describe("friendlyHeygenTestError", () => {
  // The raw strings the runner and the HeyGen adapter actually produce.
  const cases: [string, RegExp][] = [
    [
      "HeyGen API error (409): This avatar is still processing. Wait for avatar creation to complete, then try again. (resource_not_ready)",
      /took too long to prepare this photo/,
    ],
    [
      'HeyGen API error (400): {"error":{"message":"Talking photo has missing image dimensions"}}',
      /took too long to prepare this photo/,
    ],
    [
      "HeyGen avatar group abc not ready within 180000ms",
      /took too long to prepare this photo/,
    ],
    [
      'HeyGen avatar registration failed (400): {"error":{"message":"No face detected in image"}}',
      /couldn't find a clear face/,
    ],
    [
      'HeyGen avatar registration failed (400): {"error":{"message":"bad image"}}',
      /couldn't use this photo/,
    ],
    [
      "HeyGen avatar registration failed (503): upstream unavailable",
      /Couldn't reach HeyGen/,
    ],
    ["HeyGen API error (401): Unauthorized", /key isn't working/],
    ["HeyGen API error (402): insufficient credits", /out of credits/],
    ["HeyGen API error (429): too many requests", /busy right now/],
    ["fetch failed", /Couldn't reach HeyGen/],
    ["the HeyGen account's key has been removed", /no longer has a key/],
    [
      'Voicing failed: 69Labs rejected voice ID "abc" — not found. Fix the voice in Admin → Channels.',
      /voice couldn't be found/,
    ],
    ["Voicing failed: TTS censored", /wouldn't read this script/],
    ["Voicing failed: the voiced audio came back empty", /couldn't be voiced/],
    [
      "Interrupted by a server restart before HeyGen accepted the render — run it again.",
      /Nothing was charged/,
    ],
    ["render exploded", /Something went wrong/],
    ["HeyGen render failed", /couldn't finish this video/],
  ];
  it.each(cases)("%s", (raw, expected) => {
    const friendly = friendlyHeygenTestError(raw);
    expect(friendly).toMatch(expected);
    // Nothing technical leaks through.
    expect(friendly).not.toMatch(/\(\d{3}\)|HeyGen API|resource_not_ready|\{/);
  });
});

describe("pageList", () => {
  it("shows every page when there are seven or fewer", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("collapses the far pages into … around the current one", () => {
    expect(pageList(1, 12)).toEqual([1, 2, 3, 4, 5, "…", 12]);
    expect(pageList(6, 12)).toEqual([1, "…", 5, 6, 7, "…", 12]);
    expect(pageList(12, 12)).toEqual([1, "…", 8, 9, 10, 11, 12]);
  });

  it("always shows the first, last and current page, in a fixed-width row", () => {
    for (let total = 8; total <= 30; total++)
      for (let current = 1; current <= total; current++) {
        const list = pageList(current, total);
        expect(list).toHaveLength(7);
        expect(list).toContain(1);
        expect(list).toContain(total);
        expect(list).toContain(current);
      }
  });
});
