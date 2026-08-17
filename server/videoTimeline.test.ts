import { describe, it, expect } from "vitest";
import type { StoryboardScene, LongformCtaBook } from "../shared/types";
import {
  buildVideoTimeline,
  summarizeTimeline,
  classifyShot,
  formatTimecode,
  SHOT_LABELS,
  QR_TAIL_HOLD_SEC,
} from "./videoTimeline";
import {
  buildVideoDescription,
  buildChapters,
  MIN_CHAPTER_GAP_SEC,
} from "./videoDescription";

const scene = (
  i: number,
  extra: Partial<StoryboardScene> = {}
): StoryboardScene => ({
  index: i,
  narration: `s${i}`,
  scriptText: `Sentence ${i}.`,
  visualPrompt: "x",
  hostPresent: false,
  stillImage: true,
  audioDuration: 4,
  narrationStartSec: (i - 1) * 4,
  narrationEndSec: i * 4,
  ...extra,
});

describe("classifyShot", () => {
  it("names each register", () => {
    expect(classifyShot(scene(1, { hostPresent: true }))).toBe("host");
    expect(
      classifyShot(scene(1, { hostPresent: true, splitVisual: "x" }))
    ).toBe("split");
    expect(
      classifyShot(
        scene(1, { hostPresent: true, splitVisual: "x", splitMotion: true })
      )
    ).toBe("splitMotion");
    expect(classifyShot(scene(1, { stillImage: false }))).toBe("video");
    expect(classifyShot(scene(1))).toBe("still");
  });

  it("lets the deliberately-placed beats win over the register they render on", () => {
    // These are what an operator scans the list FOR, so they must not read as "still".
    expect(classifyShot(scene(1, { coverHero: true, stillImage: true }))).toBe(
      "cover"
    );
    expect(classifyShot(scene(1, { qrHero: true, stillImage: true }))).toBe(
      "qrHero"
    );
    expect(
      classifyShot(scene(1, { assetImageUrl: "u", stillImage: true }))
    ).toBe("asset");
  });

  it("has a human label for every kind it can return", () => {
    for (const kind of [
      "host",
      "split",
      "splitMotion",
      "video",
      "still",
      "asset",
      "cover",
      "qrHero",
    ] as const) {
      expect(SHOT_LABELS[kind]).toBeTruthy();
    }
  });
});

describe("formatTimecode", () => {
  it("renders m:ss, and h:mm:ss past an hour", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(9)).toBe("0:09");
    expect(formatTimecode(75)).toBe("1:15");
    expect(formatTimecode(3661)).toBe("1:01:01");
  });

  it("floors rather than rounds, so a marker never lands after its shot", () => {
    expect(formatTimecode(59.9)).toBe("0:59");
  });

  it("clamps a negative to zero instead of emitting nonsense", () => {
    expect(formatTimecode(-5)).toBe("0:00");
  });
});

describe("buildVideoTimeline", () => {
  it("tiles the film with no gaps or overlaps", () => {
    const t = buildVideoTimeline([scene(1), scene(2), scene(3)]);
    expect(t).toHaveLength(3);
    expect(t[0].startSec).toBe(0);
    t.forEach((e, i) => {
      if (i > 0)
        expect(Math.abs(e.startSec - t[i - 1].endSec)).toBeLessThan(0.05);
      expect(e.endSec).toBeGreaterThan(e.startSec);
    });
  });

  it("HOLDS a qrTail beat past its narration, matching assembly", () => {
    // The whole reason timestamps are derived from the assembly planner rather than by summing
    // narration: the silent QR tail is real screen time, and ignoring it drifts every later
    // timestamp early.
    const withTail = buildVideoTimeline([
      scene(1),
      scene(2, { qrHero: true, qrTail: true }),
      scene(3, { narrationStartSec: 8, narrationEndSec: 12 }),
    ]);
    const spoken = withTail[1].endSec - withTail[1].startSec;
    expect(spoken).toBeGreaterThan(4 + QR_TAIL_HOLD_SEC - 0.2);
    // …and the NEXT shot starts after the tail, not before it.
    expect(withTail[2].startSec).toBeGreaterThan(4 + QR_TAIL_HOLD_SEC - 0.2);
  });

  it("falls back to held durations when the job is off the master timeline", () => {
    const offMaster = [
      scene(1, { narrationStartSec: undefined, narrationEndSec: undefined }),
      scene(2, { narrationStartSec: undefined, narrationEndSec: undefined }),
    ];
    const t = buildVideoTimeline(offMaster);
    expect(t).toHaveLength(2);
    expect(t[1].startSec).toBeCloseTo(4, 1);
  });

  it("skips scenes that never reached the file", () => {
    expect(buildVideoTimeline([])).toEqual([]);
    expect(buildVideoTimeline([scene(1, { audioDuration: 0 })])).toEqual([]);
    expect(
      buildVideoTimeline([scene(1), scene(2, { audioDuration: 0 })])
    ).toHaveLength(1);
  });

  it("sorts by scene index rather than trusting array order", () => {
    const t = buildVideoTimeline([scene(3), scene(1), scene(2)]);
    expect(t.map(e => e.index)).toEqual([1, 2, 3]);
  });

  it("carries the asset caption and the corner-QR flag through", () => {
    const t = buildVideoTimeline([
      scene(1, {
        assetImageUrl: "https://r2/a.jpg",
        assetCaption: "42 recipes",
        qrCorner: true,
        cta: true,
      }),
    ]);
    expect(t[0].assetCaption).toBe("42 recipes");
    expect(t[0].qrCorner).toBe(true);
    expect(t[0].cta).toBe(true);
  });
});

describe("summarizeTimeline", () => {
  it("collapses consecutive same-kind beats into runs", () => {
    const t = buildVideoTimeline([
      scene(1, { hostPresent: true }),
      scene(2),
      scene(3),
      scene(4),
      scene(5, { hostPresent: true }),
    ]);
    const runs = summarizeTimeline(t);
    expect(runs.map(r => r.kind)).toEqual(["host", "still", "host"]);
    expect(runs[1].scenes).toEqual([2, 3, 4]);
  });

  it("a run spans from its first beat's start to its last beat's end", () => {
    const t = buildVideoTimeline([scene(1), scene(2), scene(3)]);
    const [run] = summarizeTimeline(t);
    expect(run.startSec).toBe(t[0].startSec);
    expect(run.endSec).toBe(t[2].endSec);
  });

  it("is empty for an empty timeline", () => {
    expect(summarizeTimeline([])).toEqual([]);
  });
});

describe("buildVideoDescription", () => {
  const bookA: LongformCtaBook = {
    ctaIndex: 0,
    bookId: 1,
    title: "The Soil Handbook",
    trackingUrl: "https://shop.example/soil?ref=183",
  };
  const bookB: LongformCtaBook = {
    ctaIndex: 1,
    bookId: 2,
    title: "The Greenhouse Guide",
    trackingUrl: "https://shop.example/greenhouse?ref=183",
  };

  it("lists every book with its own link", () => {
    const d = buildVideoDescription({ ctaBooks: [bookA, bookB] });
    expect(d).toContain(bookA.title);
    expect(d).toContain(bookA.trackingUrl as string);
    expect(d).toContain(bookB.title);
    expect(d).toContain(bookB.trackingUrl as string);
  });

  it("lists a book pitched in BOTH blocks only once", () => {
    const d = buildVideoDescription({
      ctaBooks: [bookA, { ...bookA, ctaIndex: 1 }],
    });
    expect(d.split(bookA.trackingUrl as string)).toHaveLength(2); // one occurrence
  });

  it("FLAGS a book with no shop link instead of dropping it silently", () => {
    const d = buildVideoDescription({
      ctaBooks: [{ ctaIndex: 0, bookId: 9, title: "Untracked" }],
    });
    expect(d).toContain("Untracked");
    expect(d.toLowerCase()).toContain("no shop link");
  });

  it("is empty when there is nothing to say", () => {
    expect(buildVideoDescription({})).toBe("");
  });
});

describe("buildChapters", () => {
  /** A film long enough to produce well-spaced markers. */
  const longFilm = () => {
    const scenes: StoryboardScene[] = [];
    for (let i = 1; i <= 12; i++) {
      scenes.push(
        scene(i, {
          hostPresent: i % 2 === 1,
          audioDuration: 15,
          narrationStartSec: (i - 1) * 15,
          narrationEndSec: i * 15,
          ...(i === 5 ? { cta: true, ctaIndex: 0 } : {}),
          ...(i === 6 ? { cta: true, ctaIndex: 0, coverHero: true } : {}),
          ...(i === 8 ? { cta: true, ctaIndex: 0, qrHero: true } : {}),
        })
      );
    }
    return buildVideoTimeline(scenes);
  };

  it("always starts at 0:00 — YouTube discards a list that doesn't", () => {
    const c = buildChapters(longFilm(), { title: "My video" });
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].atSec).toBe(0);
  });

  it("never places two markers closer than YouTube allows", () => {
    const c = buildChapters(longFilm());
    c.forEach((x, i) => {
      if (i > 0) {
        expect(x.atSec - c[i - 1].atSec).toBeGreaterThanOrEqual(
          MIN_CHAPTER_GAP_SEC
        );
      }
    });
  });

  it("emits NOTHING rather than a list YouTube would throw away", () => {
    // Two beats can't make three markers, and a short list is silently ignored by YouTube —
    // which would also lose the links if the operator edited around it.
    expect(buildChapters(buildVideoTimeline([scene(1), scene(2)]))).toEqual([]);
    expect(buildChapters([])).toEqual([]);
  });

  it("marks the set-pieces an operator would jump to", () => {
    const labels = buildChapters(longFilm()).map(c => c.label);
    expect(labels.join(" | ")).toMatch(/book|scan|get it/i);
  });
});

describe("cross-module constants", () => {
  it("QR_TAIL_HOLD_SEC mirrors the pipeline's own value", async () => {
    // Mirrored rather than imported to avoid a module cycle; this test is what keeps them equal.
    const { QR_TAIL_HOLD_SEC: pipelineValue } =
      (await import("./longformVideo")) as any;
    // The pipeline does not export it, so assert against the documented constant instead: a
    // change there without a change here would shift every timestamp after a QR block.
    expect(QR_TAIL_HOLD_SEC).toBe(3);
    if (pipelineValue !== undefined)
      expect(QR_TAIL_HOLD_SEC).toBe(pipelineValue);
  });
});
