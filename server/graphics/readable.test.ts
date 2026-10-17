import { describe, expect, it, vi } from "vitest";
import type { ResolvedCue } from "../../graphics/src/cueResolve";
import { MIN_COLOUR, MIN_WHITE } from "../../graphics/src/legibility";
import { themeFor } from "../../graphics/src/palette";

/**
 * The readability fixes (G2). Hank's job 390 left out its "6 hours" number over dimmed b-roll as
 * "text not readable on the picture (colour 4.0:1)" after every fix: a number over the picture
 * cannot move, so nothing was left to try. The last fix draws its coloured words in the plain text
 * colour, judged like any white words, and never touches when the graphic shows.
 */

// Small frames, served by name: the film under the graphic and each drawing of it.
const W = 200, H = 100;
const frames = new Map<string, Uint8Array>();
vi.mock("./media", () => ({
  FRAME_W: 200,
  FRAME_H: 100,
  grabFrame: vi.fn(async (file: string) => {
    const f = frames.get(file);
    if (!f) throw new Error(`no frame for ${file}`);
    return f;
  }),
}));

const { makeReadable, measureCue, plainInkMayHelp, describe: describeReading } = await import("./readable");
type ReadableIo = import("./readable").ReadableIo;
type Reading = import("./readable").Reading;

// Job 390's theme (from its host photo) and its left-out graphic, as the plan had it.
const theme = { bg: "#221710", accent: "#eb9046" };
const lattice = (over: Partial<ResolvedCue> = {}): ResolvedCue => ({
  id: "lattice-six-hours",
  template: "BigNumberOverlay",
  start: 19.4,
  end: 22.6,
  startFrame: 582,
  endFrame: 678,
  props: { durationSec: 3.2, kicker: "Lattice panel", value: 6, unit: "hours", at: 0.9, countSec: 0.6, theme },
  sync: [{ element: "value", word: "6", wordStart: 20.3 }],
  conformed: { start: false, end: true, held: true },
  ...over,
});
const timing = (c: ResolvedCue) => ({ start: c.start, end: c.end, startFrame: c.startFrame, endFrame: c.endFrame, conformed: c.conformed, sync: c.sync });
const box = { x0: 160, y0: 170, x1: 900, y1: 640 };

/** A fake finishing step: every drawing is a new file, each measured by `read` from its props. */
function fakeIo(read: (p: Record<string, unknown>) => Reading) {
  const drawn: Record<string, unknown>[] = [];
  const measured: Record<string, unknown>[] = [];
  const io: ReadableIo = {
    render: async c => {
      drawn.push({ ...c.props });
      return `gfx-${drawn.length}.mov`;
    },
    measure: async c => {
      measured.push({ ...c.props });
      return read(c.props);
    },
    calmest: async () => ({ h: "right", v: "top" }),
  };
  return { io, drawn, measured };
}

/** Job 390's readings: every fix short of the coloured words' minimum, the best "colour 4.0:1". */
const job390 = (plain: Reading) => (p: Record<string, unknown>): Reading =>
  p.plain === true ? plain : { colour: p.lift ? 4.0 : p.shade === 1 ? 3.6 : p.shade === 0.5 ? 3.4 : 3.1, pass: false, box };

describe("the last readability fix: the coloured words in the plain text colour", () => {
  it("job 390: tried after every other fix, on the most readable drawing, and kept when it reads", async () => {
    const c = lattice();
    const before = timing(c);
    const { io, drawn } = fakeIo(job390({ white: 9.1, pass: true, box }));
    const attempts: string[] = [];
    const made = await makeReadable(c, false, "gfx-designed.mov", io, attempts);
    expect(made.r.pass).toBe(true);
    expect(made.file).toBe("gfx-4.mov");
    expect(made.steps).toEqual([
      "as designed: colour 3.1:1",
      "darker behind the words (0.5): colour 3.4:1",
      "darker behind the words (1): colour 3.6:1",
      "lighter shade of the coloured words: colour 4.0:1",
      "coloured words in the plain text colour: white 9.1:1",
    ]);
    // Built on the best drawing so far (darkest, lifted), with only the ink changed.
    expect(drawn[3]).toMatchObject({ shade: 1, lift: 1, plain: true });
    expect(c.props).toMatchObject({ shade: 1, lift: 1, plain: true, value: 6, unit: "hours", kicker: "Lattice panel" });
    // WHEN it shows is untouched, so no other graphic's timing (or drawing) changes.
    expect(timing(c)).toEqual(before);
    expect(attempts).toEqual(["gfx-1.mov", "gfx-2.mov", "gfx-3.mov", "gfx-4.mov"]);
  });

  it("job 390: still unreadable in the plain colour, it is left out as before", async () => {
    const c = lattice();
    const { io, drawn } = fakeIo(job390({ white: 5.8, pass: false, box }));
    const made = await makeReadable(c, false, "gfx-designed.mov", io, []);
    expect(made.r.pass).toBe(false);
    expect(drawn).toHaveLength(4);
    // The best attempt is what the left-out reason names (the lifted colour scored higher here).
    expect(describeReading(made.r)).toBe("colour 4.0:1");
    expect(c.props.plain).toBeUndefined();
  });

  it("is not drawn when the white words already fail there (the plain colour would too)", async () => {
    const c = lattice();
    const { io, drawn } = fakeIo(() => ({ white: 5.2, colour: 4.0, pass: false, box }));
    const made = await makeReadable(c, false, "gfx-designed.mov", io, []);
    expect(made.r.pass).toBe(false);
    expect(drawn.some(p => p.plain)).toBe(false);
    expect(made.steps.at(-1)).toBe("lighter shade of the coloured words: white 5.2:1, colour 4.0:1");
  });

  it("is not drawn for a graphic that reads, or one with no coloured words failing", async () => {
    const reads = lattice();
    const a = fakeIo(p => (p.shade === 0.5 ? { white: 8.2, colour: 5.1, pass: true, box } : { colour: 3.9, pass: false, box }));
    const ok = await makeReadable(reads, false, "gfx-designed.mov", a.io, []);
    expect(ok.r.pass).toBe(true);
    expect(a.drawn).toEqual([expect.objectContaining({ shade: 0.5 })]);
    expect(reads.props.plain).toBeUndefined();

    const whiteOnly = lattice({ id: "white-only", template: "HostCaption" });
    const b = fakeIo(() => ({ white: 6.1, pass: false, box }));
    await makeReadable(whiteOnly, false, "gfx-designed.mov", b.io, []);
    expect(b.drawn.some(p => p.plain)).toBe(false);
  });

  it("a movable graphic is moved first; the plain colour builds on the best drawing, not a worse move", async () => {
    const c = lattice({ id: "caption", template: "DimCaption" });
    const { io, drawn } = fakeIo(p =>
      p.plain === true ? { white: 7.6, pass: true, box } : p.place ? { colour: 2.0, pass: false, box } : { colour: p.lift ? 4.2 : 3.9, pass: false, box }
    );
    const made = await makeReadable(c, true, "gfx-designed.mov", io, []);
    expect(made.steps.map(s => s.split(":")[0])).toEqual([
      "as designed",
      "darker behind the words (0.5)",
      "darker behind the words (1)",
      "lighter shade of the coloured words",
      "moved to the calmest part of the picture",
      "coloured words in the plain text colour",
    ]);
    expect(drawn.at(-1)).toMatchObject({ shade: 1, lift: 1, plain: true });
    expect(drawn.at(-1)!.place).toBeUndefined();
    expect(made.r.pass).toBe(true);
  });

  it("plainInkMayHelp: only when the coloured words fail and the white words (if any) read", () => {
    expect(plainInkMayHelp({ colour: 4.0, pass: false })).toBe(true); // job 390's left-out reading
    expect(plainInkMayHelp({ colour: 4.0, white: MIN_WHITE, pass: false })).toBe(true);
    expect(plainInkMayHelp({ colour: 4.0, white: 5.2, pass: false })).toBe(false);
    expect(plainInkMayHelp({ white: 6.1, pass: false })).toBe(false);
    expect(plainInkMayHelp({ colour: MIN_COLOUR, pass: true })).toBe(false);
  });
});

describe("the plain colour is judged as white words", () => {
  const rgb = (h: string) => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  /** The graphic as the template draws it with these props: a bar of its accent on the dim ground. */
  const drawing = (props: Record<string, unknown>, scrim = 0.6) => {
    const g = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) g.set([5, 10, 18, Math.round(scrim * 255)], i * 4);
    const ink = rgb(themeFor(props).accent);
    for (let y = 40; y < 60; y++) for (let x = 40; x < 160; x++) g.set([...ink, 255], (y * W + x) * 4);
    return g;
  };
  const measureOn = async (picture: number, props: Record<string, unknown>) => {
    const cue = lattice();
    cue.props = { ...cue.props, ...props };
    frames.set("film.mp4", new Uint8Array(W * H * 3).fill(picture));
    frames.set("gfx.mov", drawing(cue.props));
    return measureCue("film.mp4", "gfx.mov", cue, []);
  };

  it("the same number, lifted orange under the minimum, reads in white on the same picture", async () => {
    const lifted = await measureOn(200, { lift: 1 });
    expect(lifted.white).toBeUndefined();
    expect(lifted.colour!).toBeLessThan(MIN_COLOUR);
    const plain = await measureOn(200, { lift: 1, plain: true });
    expect(plain.colour).toBeUndefined();
    expect(plain.white!).toBeGreaterThanOrEqual(MIN_WHITE);
    expect(plain.pass).toBe(true);
  });

  it("held to the white minimum, it cannot overreach: on a brighter picture it still fails", async () => {
    const plain = await measureOn(240, { lift: 1, plain: true });
    expect(plain.white!).toBeLessThan(MIN_WHITE);
    expect(plain.pass).toBe(false);
  });
});
