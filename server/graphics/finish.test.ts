import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { StoryboardScene } from "@shared/types";
import type { CueSpec } from "../../graphics/src/cueResolve";

/**
 * The finishing step puts a caption over a split INSIDE the host's panel, and draws and measures it
 * there. Gideon's job 400 at 2:18 (scene 27, host left, a blank scroll right): "When a man like that
 * sits down to write about time, I pull my chair in closer." had no panel, so its dark box ran
 * across the seam over the scroll. The lab's composite set the panel; this step never did.
 *
 * Everything that would touch ffmpeg, the transcriber or the renderer is replaced; the plan, the
 * resolver, the rules, the readability steps and the QA are the real ones.
 */

const FILM_SEC = 150;
const h = vi.hoisted(() => ({
  drawn: [] as { id: string; props: Record<string, unknown>; output: string }[],
  measured: [] as { id: string; file: string; panel: unknown; low?: unknown }[],
}));

vi.mock("../db", () => ({ getChannelConfig: vi.fn(async () => undefined) }));
vi.mock("../claude", () => ({ invokeClaude: vi.fn(async () => { throw new Error("no model call: the saved plan is reused"); }) }));
vi.mock("../storage", () => ({ presignOwnBucketUrl: vi.fn(async (u: string) => u) }));
vi.mock("../mediaProbe", () => ({ getMediaDuration: vi.fn(async () => 150) }));
vi.mock("./media", () => ({
  FRAME_W: 1920,
  FRAME_H: 1080,
  frameDiffs: vi.fn(async () => new Array(150 * 30).fill(0)),
  levelsOf: vi.fn(async () => []),
  narrationOf: vi.fn(async () => Buffer.from("job 400 narration")),
  ffmpeg: vi.fn(async () => {}),
  grabFrame: vi.fn(async () => { throw new Error("frames are not read in this test"); }),
}));
vi.mock("./render", async () => {
  const { writeFileSync: write } = await import("node:fs");
  const { resolve } = await import("node:path");
  return {
    GRAPHICS_DIR: resolve(process.cwd(), "graphics"),
    renderGraphic: vi.fn(async (id: string, props: Record<string, unknown>, output: string) => {
      h.drawn.push({ id: String((props as { phrase?: { text?: string } }).phrase?.text), props: structuredClone(props), output });
      write(output, "graphic");
      return { ms: 1, frames: 1 };
    }),
  };
});
vi.mock("./readable", async importOriginal => ({
  ...(await importOriginal<typeof import("./readable")>()),
  measureCue: vi.fn(async (_film: string, file: string, cue: { id: string; props: Record<string, unknown> }) => {
    h.measured.push({ id: cue.id, file, panel: cue.props.panel, low: cue.props.low });
    return { pass: true, white: 9 };
  }),
}));

// Job 400's narration around its two host captions, as the transcriber heard it.
const said = (text: string, start: number, step = 0.2) => text.split(" ").map((w, i) => ({ word: w, start: start + i * step, end: start + i * step + 0.15 }));
const WORDS = [
  ...said("There is a man standing in the greeting card aisle", 0.22),
  ...[
    ["He", 12.95], ["is", 13.126], ["counting", 13.286], ["backward.", 13.887], ["He", 15.427], ["is", 15.608], ["64.", 15.868], ["His", 17.428],
    ["When", 138.312], ["a", 138.472], ["man", 138.552], ["like", 138.813], ["that", 139.113], ["sits", 139.513], ["down", 139.793], ["to", 140.053],
    ["write", 140.193], ["about", 140.394], ["time,", 140.714], ["I", 141.714], ["pull", 141.835], ["my", 142.095], ["chair", 142.255], ["in", 142.555],
    ["closer.", 142.735],
  ].map(([word, start]) => ({ word: word as string, start: start as number, end: (start as number) + 0.14 })),
  ...said("The essay is called On the Shortness of Life", 144.4),
];
vi.mock("../_core/voiceTranscription", () => ({ transcribeWordsFromBuffer: vi.fn(async () => ({ words: WORDS })) }));

const cacheDir = mkdtempSync(path.join(os.tmpdir(), "graphics-panel-test-"));
process.env.GRAPHICS_CACHE_DIR = cacheDir;
const { addGraphics } = await import("./finish");
const { filmLayoutOf } = await import("./apply");
afterAll(() => rmSync(cacheDir, { recursive: true, force: true }));

// The two captions as job 400 saved them.
const plan: CueSpec[] = [
  { id: "host-sixty-four", template: "HostCaption", start: "He is sixty-four.", end: "He is sixty-four.", startPad: -0.15, endPad: 0.3, props: { phrase: { text: "He is sixty-four.", words: true }, emphasis: ["sixty-four."] } },
  {
    id: "host-chair-closer",
    template: "HostCaption",
    start: "When a man like that sits",
    end: "pull my chair in closer.",
    startPad: -0.15,
    endPad: 0,
    props: { phrase: { text: "When a man like that sits down to write about time, I pull my chair in closer.", words: true }, emphasis: ["closer."] },
  },
] as unknown as CueSpec[];

// Job 400's scenes as stored (scenes 5-26 folded into one picture).
const R2 = "https://pub-x.r2.dev/longform/400";
const scenes = (layout?: StoryboardScene["splitLayout"]) =>
  [
    { index: 1, narrationStartSec: 0, narrationEndSec: 2.5, hostPresent: true, hostOpener: true, clipUrls: [`${R2}/clip-1-0.mp4`] },
    { index: 2, narrationStartSec: 2.5, narrationEndSec: 12.88, clipUrls: [`${R2}/still-2-0.mp4`] },
    // a split whose picture never came: the film plays the host take full frame
    { index: 3, narrationStartSec: 12.88, narrationEndSec: 17.32, hostPresent: true, sceneStatus: "completed", splitVisual: "A sympathy card", clipUrls: [`${R2}/clip-3-0-tcI0x8.mp4`], hostClipUrls: [`${R2}/clip-3-0-tcI0x8.mp4`] },
    { index: 4, narrationStartSec: 17.32, narrationEndSec: 138.19, clipUrls: [`${R2}/still-4-0.mp4`] },
    {
      index: 27,
      narrationStartSec: 138.19,
      narrationEndSec: 144.12,
      hostPresent: true,
      sceneStatus: "completed",
      splitVisual: "An aged papyrus scroll",
      splitRightUrl: `${R2}/still-27-a.mp4`,
      splitLayout: layout,
      clipUrls: [`${R2}/split-27-0-weCNwc.mp4`],
      hostClipUrls: [`${R2}/clip-27-0-k0tiiz.mp4`],
    },
    { index: 28, narrationStartSec: 144.12, narrationEndSec: FILM_SEC, clipUrls: [`${R2}/still-28-0.mp4`] },
  ] as unknown as StoryboardScene[];

const run = (layout?: StoryboardScene["splitLayout"], savedPlan: CueSpec[] = plan) => {
  const dir = mkdtempSync(path.join(cacheDir, "film-"));
  const filmPath = path.join(dir, "film.mp4");
  writeFileSync(filmPath, "film");
  return addGraphics({ jobId: 400, filmPath, outPath: path.join(dir, "out.mp4"), film: filmLayoutOf(scenes(layout)), savedPlan });
};
const CHAIR = "When a man like that sits down to write about time, I pull my chair in closer.";

beforeEach(() => {
  h.drawn.length = 0;
  h.measured.length = 0;
  // every test draws its graphics afresh (the step reuses a drawing it already made)
  rmSync(path.join(cacheDir, "gfx"), { recursive: true, force: true });
});

describe("a caption over a split is drawn and measured inside the host's panel", () => {
  it("400 host-chair-closer: drawn in the host's 840 px on the left, and every readability measure is of that drawing", async () => {
    const r = await run();
    expect(r.placed.map(p => p.id)).toEqual(["host-sixty-four", "host-chair-closer"]);
    const chair = h.drawn.find(d => d.id === CHAIR)!;
    expect(chair.props.panel).toEqual({ x: 0, w: 840 });
    const measures = h.measured.filter(m => m.id === "host-chair-closer");
    expect(measures.length).toBeGreaterThan(0);
    expect(measures.every(m => m.file === chair.output && JSON.stringify(m.panel) === JSON.stringify({ x: 0, w: 840 }))).toBe(true);
    // decided at each assembly from the film as it is — never written into the saved plan
    expect(JSON.stringify(r.plan)).not.toContain("panel");
  });

  it("400 host-sixty-four over the split that shipped as the host alone stays on the full frame", async () => {
    await run();
    const sixty = h.drawn.find(d => d.id === "He is sixty-four.")!;
    expect(sixty.props.panel).toBeUndefined();
    expect(h.measured.filter(m => m.id === "host-sixty-four").every(m => m.panel === undefined)).toBe(true);
  });

  it("a Reassemble after the operator turned the split round reuses the plan and moves the caption to the host's side", async () => {
    await run({ hostSide: "right" });
    expect(h.drawn.find(d => d.id === CHAIR)!.props.panel).toEqual({ x: 1080, w: 840 });
  });
});

/**
 * A chapter label over a host take is drawn below the host's chin, and measured there. Job 407's
 * "Number two squared the walls…" (host scene 21) was drawn where it sits over b-roll and its band
 * cut across the host's beard for 3 s; job 402's on a split also crossed the seam onto the picture.
 * Here on job 400's film: one label over the full-frame host take (scene 3), one over the split
 * (scene 27), one over b-roll (scene 28).
 */
describe("a chapter label over a host take is drawn and measured below the chin", () => {
  const chapter = (id: string, start: string, number: number, title: string) =>
    ({ id, template: "ChapterLabel", start, durationSec: 2.5, props: { kicker: `Parts · ${number} of 3`, number, title } }) as unknown as CueSpec;
  const chapters = [
    chapter("chapter-host", "He is counting backward.", 1, "The count"),
    chapter("chapter-split", "When a man like that sits", 2, "The essay"),
    chapter("chapter-broll", "The essay is called On the Shortness of Life", 3, "The title"),
  ];
  const drawnAs = (title: string) => h.drawn.filter(d => d.props.title === title).map(d => d.props);

  it("over the full-frame host take: low, and every readability measure is of the low drawing", async () => {
    const r = await run(undefined, chapters);
    expect(r.placed.map(p => p.id)).toEqual(["chapter-host", "chapter-split", "chapter-broll"]);
    expect(drawnAs("The count").length).toBeGreaterThan(0);
    expect(drawnAs("The count").every(p => p.low === true && p.panel === undefined && p.side === undefined)).toBe(true);
    const measures = h.measured.filter(m => m.id === "chapter-host");
    expect(measures.length).toBeGreaterThan(0);
    expect(measures.every(m => m.low === true)).toBe(true);
  });

  it("over the split: inside the host's panel, low; over b-roll: as designed; none of it saved in the plan", async () => {
    const r = await run(undefined, chapters);
    expect(drawnAs("The essay").length).toBeGreaterThan(0);
    expect(drawnAs("The essay").every(p => p.low === true && JSON.stringify(p.panel) === JSON.stringify({ x: 0, w: 840 }))).toBe(true);
    expect(drawnAs("The title").length).toBeGreaterThan(0);
    expect(drawnAs("The title").every(p => p.low === undefined && p.panel === undefined)).toBe(true);
    expect(JSON.stringify(r.plan)).not.toMatch(/"low"|"panel"|"side"/);
  });
});
