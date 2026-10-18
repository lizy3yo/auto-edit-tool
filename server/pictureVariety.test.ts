import { describe, it, expect } from "vitest";
import sharp from "sharp";
import type { StoryboardScene } from "@shared/types";
import {
  assignScreenSetups,
  hashDistance,
  HELD_SCREEN_SETUPS,
  nearCopyCandidates,
  nextScreenSetup,
  pictureHash,
  pictureThumb,
  rememberPicture,
  SCREEN_SETUPS,
  screenPicture,
  screenSells,
  withScreenTurn,
  differentPictureClause,
  fingerprintDistance,
  NEAR_COPY_BITS,
  PANEL_CANDIDATES,
  PANEL_NEAR_COPY_BITS,
  pictureFingerprint,
  SQUARE_WINDOWS,
  PANEL_LANE_WAIT_MS,
  RELATED_NEAR_COPY_BITS,
  rememberShippedPicture,
  varietyLane,
} from "./pictureVariety";
import {
  JUST_SHOWN_COPY_NOTE,
  NEAR_COPY_SYSTEM,
  nearCopyPair,
  parseNearCopyVerdict,
  parseSameHostVerdict,
  SAME_LAYOUT_RULE,
} from "./overlayTextScan";
import { appScreenClause } from "./longformVideo";

const scene = (i: number, visualPrompt: string, extra: Partial<StoryboardScene> = {}) =>
  ({ index: i, visualPrompt, showSubject: visualPrompt, ...extra }) as StoryboardScene;

describe("Dale's repeated phone screens (job 372) — each screen sits somewhere else", () => {
  const film = () => [
    scene(1, "a phone lying on the workbench showing a buy-and-sell app screen"),
    scene(2, "a walnut cutting board on the bench"),
    scene(3, "phone screen showing a listing of the maple board"),
    scene(4, "the host talking", { hostPresent: true }),
    scene(5, "a phone on the workbench showing the app's settings screen"),
    scene(6, "hands holding a phone showing a listing", { humanPresent: true }),
  ];

  it("gives consecutive screens different settings, in film order", () => {
    const s = film();
    expect(assignScreenSetups(s)).toBe(4);
    expect([s[0].screenSetup, s[2].screenSetup, s[4].screenSetup]).toEqual(SCREEN_SETUPS.slice(0, 3));
    expect(new Set([s[0].screenSetup, s[2].screenSetup, s[4].screenSetup]).size).toBe(3);
  });

  it("gives a screen in the host's hands a HELD setting, and leaves other pictures alone", () => {
    const s = film();
    assignScreenSetups(s);
    expect(s[5].screenSetup).toBe(HELD_SCREEN_SETUPS[0]);
    expect(s[1].screenSetup).toBeUndefined();
    expect(s[3].screenSetup).toBeUndefined();
  });

  it("puts the setting into the screen clause, keeping the device-rests rule", () => {
    const s = film();
    assignScreenSetups(s);
    const clause = appScreenClause(s[2]);
    expect(clause).toContain(SCREEN_SETUPS[1]);
    expect(clause).toMatch(/never stands upright by itself/);
    expect(clause).toMatch(/every screen picture of this video is somewhere else/);
  });

  it("a redraw moves to a setting far from the one that came back a copy", () => {
    expect(nextScreenSetup(SCREEN_SETUPS[0], false)).not.toBe(SCREEN_SETUPS[0]);
    expect(nextScreenSetup(HELD_SCREEN_SETUPS[0], true)).not.toBe(HELD_SCREEN_SETUPS[0]);
  });
});

describe("near-copies are looked for across the WHOLE video", () => {
  const img = (r: number, g: number, b: number, stripe: boolean) =>
    sharp({ create: { width: 320, height: 180, channels: 3, background: { r, g, b } } })
      .composite(stripe ? [{ input: Buffer.from(`<svg width="320" height="180"><rect x="0" y="0" width="160" height="180" fill="white"/></svg>`), left: 0, top: 0 }] : [])
      .png()
      .toBuffer();

  it("finds an earlier near-identical picture, never the scene's own earlier draw", async () => {
    const a = await img(40, 80, 120, true);
    const b = await img(42, 82, 118, true);
    const ha = await pictureHash(a);
    const hb = await pictureHash(b);
    expect(hashDistance(ha, hb)).toBeLessThanOrEqual(4);
    rememberPicture(9001, 3, ha, await pictureThumb(a));
    expect(nearCopyCandidates(9001, 40, hb).map(c => c.index)).toEqual([3]);
    expect(nearCopyCandidates(9001, 3, hb)).toEqual([]);
  });

  it("reads the near-copy and same-host verdicts, failing open", () => {
    expect(parseNearCopyVerdict('{"copy":true,"what":"same bench"}')).toEqual({ copy: true, what: "same bench" });
    expect(parseNearCopyVerdict("nonsense")).toEqual({ copy: false, what: "" });
    expect(parseSameHostVerdict('{"same":false,"what":"younger, dark hair"}')).toEqual({
      same: false,
      face: false,
      what: "younger, dark hair",
    });
    expect(parseSameHostVerdict("")).toEqual({ same: true, face: false, what: "" });
  });
});

describe("a redraw never lands back on the setting it copied (Dale's job 372 test, 2026-10-15)", () => {
  it("skips both its own setting and the copied picture's", () => {
    for (const cur of HELD_SCREEN_SETUPS)
      for (const avoid of HELD_SCREEN_SETUPS) {
        const next = nextScreenSetup(cur, true, avoid);
        expect(next).not.toBe(cur);
        expect(next).not.toBe(avoid);
      }
  });
});

describe("a video's screens are drawn one at a time (Dale's job 372 test)", () => {
  it("starts a screen only after the one before it has finished", async () => {
    const order: string[] = [];
    const draw = (name: string, ms: number) => () =>
      new Promise<void>(res => {
        order.push(`start ${name}`);
        setTimeout(() => (order.push(`end ${name}`), res()), ms);
      });
    await Promise.all([withScreenTurn(77, draw("a", 30)), withScreenTurn(77, draw("b", 1)), withScreenTurn(78, draw("other video", 1))]);
    expect(order.indexOf("end a")).toBeLessThan(order.indexOf("start b"));
    expect(order.indexOf("start other video")).toBeLessThan(order.indexOf("end a"));
  });

  it("a failed draw does not block the next", async () => {
    await expect(withScreenTurn(79, () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(withScreenTurn(79, async () => "ok")).resolves.toBe("ok");
  });
});

describe("a near-copy is redrawn from a named camera view (Frederick's practice job 376)", () => {
  it("gives each redraw a different view, and never stacks clauses", () => {
    const a = differentPictureClause(0), b = differentPictureClause(1);
    expect(a).not.toBe(b);
    expect(a).toMatch(/close-up/);
    expect(b).toMatch(/further back/);
  });
});

describe("a screen sits beside things for sale only when it is about selling (the audit's grid screens)", () => {
  // Production job 235 (an airline app), job 393 (a hand tapping a phone under "Subscribe to…"),
  // production job 260 (a camera app's password page), job 294 (another "Subscribe" tap), and a
  // selling screen like Dale's job 372.
  const airline = scene(1, "mobile phone on the kitchen table showing an airline app screen");
  const sell = scene(2, "a phone lying on the workbench showing a buy-and-sell app screen with handmade listings");
  const sell2 = scene(3, "a laptop showing the online shop page with the board listed");
  const subscribe = scene(4, "a hand tapping a phone screen in a hallway beneath a ceiling smoke alarm", { humanPresent: true });
  const password = scene(5, "hands holding black smartphone changing password in camera app settings", { humanPresent: true });
  const subscribe2 = scene(6, "A bare hand tapping a phone screen beside a white coffee cup on a marble café table", {
    humanPresent: true,
  });
  const selling = new Set<string>([SCREEN_SETUPS[0], HELD_SCREEN_SETUPS[2]]);

  it("never gives a screen not about selling the item-beside-the-phone or market-stall setting", () => {
    const film = [airline, sell, sell2, subscribe, password, subscribe2].map(s => ({ ...s }));
    expect(assignScreenSetups(film)).toBe(6);
    expect(selling.has(film[0].screenSetup!)).toBe(false);
    expect(film[0].screenSetup).toBe(SCREEN_SETUPS[1]);
    for (const s of film.filter(x => !screenSells(x))) expect(selling.has(s.screenSetup!)).toBe(false);
    // The third held screen would have been the market stall: a "Subscribe" tap moves past it.
    expect(film[5].screenSetup).toBe(HELD_SCREEN_SETUPS[3]);
    // Consecutive screens still differ.
    expect(new Set(film.slice(0, 3).map(s => s.screenSetup)).size).toBe(3);
  });

  it("a selling screen may still sit beside the item it shows", () => {
    const film = [{ ...sell }, { ...airline }];
    assignScreenSetups(film);
    expect(film[0].screenSetup).toBe(SCREEN_SETUPS[0]);
    expect(film[1].screenSetup).toBe(SCREEN_SETUPS[1]);
  });

  it("a redraw of a screen not about selling never lands on a selling setting", () => {
    for (const held of [false, true]) {
      const list: readonly string[] = held ? HELD_SCREEN_SETUPS : SCREEN_SETUPS;
      for (const cur of list)
        for (const avoid of [undefined, ...list]) {
          const next = nextScreenSetup(cur, held, avoid, false);
          expect(selling.has(next)).toBe(false);
          expect(next).not.toBe(cur);
        }
    }
    // …while a selling screen can.
    expect(SCREEN_SETUPS.map(c => nextScreenSetup(c, false, undefined, true))).toContain(SCREEN_SETUPS[0]);
  });

  it("a picture with a screen word but no device is no screen at all", () => {
    // Job 151: "the afghan angled and listing to one side"; job 122: the lit lantern "showing why the
    // listing photo sells"; job 230's scan-window picture, "ready for listing or sale".
    const afghan = scene(7, "Finished lace shell afghan, the afghan angled and listing to one side of the table's center.");
    const lantern = scene(8, "A finished andon lantern sits lit on a low table in a darkened room, a settled moment showing why the listing photo sells.");
    const pile = scene(9, "Workbench in the garage workshop, a few finished wooden cutting boards and coasters in a calm pile, ready for listing or sale.");
    // A thing made for a device is no device: it is not moved into a screen setting.
    const stand = scene(10, "A walnut phone stand on the workbench, ready for its listing photo.");
    const film = [afghan, lantern, pile, stand];
    expect(assignScreenSetups(film)).toBe(0);
    for (const s of film) {
      expect(screenPicture(s.visualPrompt!)).toBe(false);
      expect(s.screenSetup).toBeUndefined();
    }
    expect(screenPicture("phone screen showing a listing of the maple board")).toBe(true);
  });
});

describe("a split panel meets the near-copy check like any picture (job 405 scene 9 copied scene 2)", () => {
  // A seeded "photo": a coarse grid of light and dark patches, smoothly enlarged, so its fingerprint is
  // a real one (flat drawn shapes all hash alike).
  const photo = (seed: number, w: number, h: number) => {
    let a = seed >>> 0;
    const rnd = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cols = Math.round((w / h) * 9);
    const px = Buffer.alloc(cols * 9 * 3);
    for (let i = 0; i < cols * 9; i++) px.fill(Math.floor(rnd() * 256), i * 3, i * 3 + 3);
    return sharp(px, { raw: { width: cols, height: 9, channels: 3 } }).resize(w, h, { kernel: "cubic", fit: "fill" }).png().toBuffer();
  };
  // Scene 2's walking cat, full frame; the panel at scene 9 is that picture again, cut square.
  const scene2 = () => photo(2, 1536, 864);
  const panelOf = async (wide: Buffer) =>
    sharp(wide).extract({ left: 336, top: 0, width: 864, height: 864 }).resize(1024, 1024).png().toBuffer();
  const bits = (n: number) => "1".repeat(n) + "0".repeat(64 - n);
  const ZERO = bits(0);

  it("405-9: the panel cut square from scene 2 is found, though the stretched hashes read far apart", async () => {
    const wide = await scene2();
    const [w, p] = [await pictureFingerprint(wide), await pictureFingerprint(await panelOf(wide), true)];
    expect(p.square).toBe(true);
    expect(w.windows).toHaveLength(SQUARE_WINDOWS);
    // The old comparison (both hashes stretched over each other) would never have looked at the pair.
    expect(hashDistance(w.hash, p.hash)).toBeGreaterThan(NEAR_COPY_BITS);
    expect(fingerprintDistance(w, p)).toBeLessThanOrEqual(2);
    rememberPicture(9405, 2, w, await pictureThumb(wide));
    expect(nearCopyCandidates(9405, 9, p).map(c => c.index)).toEqual([2]);
  });

  it("a panel of something else is left alone, and so is a full-frame picture unlike the panel", async () => {
    const wide = await scene2();
    const clock = await photo(52, 1024, 1024);
    rememberPicture(9406, 2, await pictureFingerprint(wide), await pictureThumb(wide));
    const c = await pictureFingerprint(clock, true);
    expect(fingerprintDistance(await pictureFingerprint(wide), c)).toBeGreaterThan(PANEL_NEAR_COPY_BITS);
    expect(nearCopyCandidates(9406, 12, c)).toEqual([]);
    rememberPicture(9406, 12, c, await pictureThumb(clock, true));
    const p = await pictureFingerprint(await panelOf(wide), true);
    expect(nearCopyCandidates(9406, 9, p).map(x => x.index)).toEqual([2]);
  });

  it("a full-frame picture drawn after a panel is compared with it", async () => {
    const clock = await photo(52, 1024, 1024);
    // A later full-frame picture with the panel's picture as its middle square.
    const around = await sharp(await photo(92, 1536, 864))
      .composite([{ input: await sharp(clock).resize(864, 864).png().toBuffer(), left: 336, top: 0 }])
      .png()
      .toBuffer();
    rememberPicture(9407, 12, await pictureFingerprint(clock, true), await pictureThumb(clock, true));
    expect(nearCopyCandidates(9407, 28, await pictureFingerprint(around)).map(x => x.index)).toEqual([12]);
    // …and a bare hash, as callers before panels passed it, still meets only full-frame pictures it is near.
    expect(nearCopyCandidates(9407, 28, await pictureHash(await photo(7, 1536, 864)))).toEqual([]);
  });

  it("the lines: a panel looks up to 24 bits at its three closest; a full-frame picture and two panels keep 20", async () => {
    const thumb = await pictureThumb(await photo(3, 320, 180));
    const wide = (n: number) => ({ hash: bits(40), windows: [bits(n), bits(40)] });
    rememberPicture(9408, 1, wide(23), thumb);
    rememberPicture(9408, 2, wide(25), thumb);
    rememberPicture(9408, 3, { hash: bits(23), square: true }, thumb);
    const panel = { hash: ZERO, square: true };
    // Scene 1 at 23 bits is looked at; scene 2 at 25 is not; the earlier panel at 23 is not (same shape).
    expect(nearCopyCandidates(9408, 9, panel).map(c => [c.index, c.bits])).toEqual([[1, 23]]);
    // A full-frame picture 23 bits from the panel at scene 3 is not looked at; 18 bits is.
    rememberPicture(9409, 3, panel, thumb);
    expect(nearCopyCandidates(9409, 30, wide(23))).toEqual([]);
    expect(nearCopyCandidates(9409, 30, wide(18)).map(c => c.index)).toEqual([3]);
    // At most three for a panel, closest first; two for a full-frame picture, as before.
    for (const [i, n] of [[11, 22], [12, 19], [13, 24], [14, 21], [15, 20]] as const) rememberPicture(9410, i, wide(n), thumb);
    expect(nearCopyCandidates(9410, 9, panel).map(c => c.index)).toEqual([12, 15, 14]);
    expect(PANEL_CANDIDATES).toBe(3);
    for (const [i, n] of [[1, 12], [2, 10], [3, 15]] as const) rememberPicture(9411, i, bits(n), thumb);
    expect(nearCopyCandidates(9411, 9, ZERO).map(c => c.index)).toEqual([2, 1]);
  });

  it("a panel that came back 16:9 is fingerprinted as the centre square its slot shows", async () => {
    const wide = await scene2();
    const centre = await sharp(wide).extract({ left: 336, top: 0, width: 864, height: 864 }).png().toBuffer();
    expect((await pictureFingerprint(wide, true)).hash).toBe(await pictureHash(centre));
    // A full-frame picture's own hash is the one it always had.
    expect((await pictureFingerprint(wide)).hash).toBe(await pictureHash(wide));
  });

  it("the look sees the whole panel: a square thumbnail, laid between black bars", async () => {
    const panel = await panelOf(await scene2());
    const thumb = await pictureThumb(panel, true);
    expect(await sharp(thumb).metadata()).toMatchObject({ width: 360, height: 360 });
    expect(await sharp(await pictureThumb(panel)).metadata()).toMatchObject({ width: 640, height: 360 });
    const white = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const whiteSquare = await sharp({ create: { width: 360, height: 360, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    const pair = await nearCopyPair(white, whiteSquare);
    const { data, info } = await sharp(pair).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1280, 360]);
    const at = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(at(20, 180)).toBeGreaterThan(240); // the full-frame thumbnail fills its half
    expect(at(660, 180)).toBeLessThan(15); // a black bar beside the square
    expect(at(960, 5)).toBeGreaterThan(240); // the square's top edge is kept, not cut to a band
    expect(at(960, 354)).toBeGreaterThan(240);
    expect(NEAR_COPY_SYSTEM).toMatch(/square, with black bars/);
  });
});

describe("a picture is compared with the pictures it was drawn from (round 13, jobs 408-410)", () => {
  // Hashes as strings of 64 bits: `n` ones starting at `from`, so two pictures can sit the same
  // distance from the one drawn and still differ from each other.
  const ones = (n: number, from = 0) =>
    Array.from({ length: 64 }, (_, i) => (i >= from && i < from + n ? "1" : "0")).join("");
  const ZERO = ones(0);
  const thumbOf = () => pictureThumb(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64"));

  it("409-5: scene 3, the picture it was drawn from, 22 bits away, is looked at; an unrelated picture as far is not", async () => {
    const thumb = await thumbOf();
    // Scene 3: the man at the card rack, scene 5's memory picture (22 bits on the film's frames).
    rememberPicture(9501, 3, ones(22), thumb);
    // Scene 9: another picture of the video as far away, drawn from nothing scene 5 was.
    rememberPicture(9501, 9, ones(22, 40), thumb);
    expect(RELATED_NEAR_COPY_BITS).toBe(24);
    expect(nearCopyCandidates(9501, 5, ZERO, undefined, { drawnFrom: [3, 2] }).map(c => [c.index, c.bits])).toEqual([[3, 22]]);
    // Without the relation the 20-bit line holds for both, as before.
    expect(22).toBeGreaterThan(NEAR_COPY_BITS);
    expect(nearCopyCandidates(9501, 5, ZERO)).toEqual([]);
  });

  it("408-4/5: a picture drawn from the same picture is a relative — the panel 24 bits from scene 5, both drawn from scene 2", async () => {
    const thumb = await thumbOf();
    rememberPicture(9502, 2, ones(40), thumb);
    // Scene 4's panel, drawn from scene 2 (24 bits from scene 5 on the frames).
    rememberPicture(9502, 4, { hash: ones(24), square: true }, thumb, undefined, [2]);
    // Another panel as far away, drawn from scene 11: not scene 5's relative.
    rememberPicture(9502, 12, { hash: ones(24, 30), square: true }, thumb, undefined, [11]);
    expect(nearCopyCandidates(9502, 5, ZERO, undefined, { drawnFrom: [2, 3] }).map(c => c.index)).toEqual([4]);
    // A full-frame picture with no relatives keeps the 20-bit line against a panel.
    expect(nearCopyCandidates(9502, 5, ZERO)).toEqual([]);
    // Two full-frame pictures drawn from scene 2 are relatives too: 23 bits apart, looked at — and one
    // drawn from scene 6 as far away is not.
    rememberPicture(9503, 5, ones(23), thumb, undefined, [2, 3]);
    rememberPicture(9503, 7, ones(23, 40), thumb, undefined, [6]);
    expect(nearCopyCandidates(9503, 9, ZERO, undefined, { drawnFrom: [2] }).map(c => c.index)).toEqual([5]);
  });

  it("410-20: kept small beside the subject, no same-thing look — the closest picture it was drawn from is looked at however far", async () => {
    const thumb = await thumbOf();
    // Scene 3 (the seat row it copied) and scene 16, its two references; scene 8, unrelated but close.
    rememberPicture(9504, 3, ones(30), thumb);
    rememberPicture(9504, 16, ones(40, 10), thumb);
    rememberPicture(9504, 8, ones(18, 46), thumb);
    const related = { drawnFrom: [3, 16], lookAtClosest: true };
    expect(nearCopyCandidates(9504, 20, ZERO, undefined, related).map(c => c.index)).toEqual([3, 8]);
    // A same-thing look laid a reference beside it: nothing forced, the relatives keep the wider line.
    expect(nearCopyCandidates(9504, 20, ZERO, undefined, { drawnFrom: [3, 16] }).map(c => c.index)).toEqual([8]);
    // A partner named by its words still comes first, and only one picture is looked at however far.
    rememberPicture(9504, 19, ones(35, 20), thumb);
    expect(nearCopyCandidates(9504, 20, ZERO, 19, related).map(c => c.index)).toEqual([19, 8]);
    // Nothing remembered of what it was drawn from: nothing forced.
    expect(nearCopyCandidates(9504, 20, ZERO, undefined, { drawnFrom: [77], lookAtClosest: true }).map(c => c.index)).toEqual([8]);
  });

  it("the looks per draw stay capped however many relatives qualify", async () => {
    const thumb = await thumbOf();
    for (const [i, n] of [[1, 23], [2, 21], [3, 24], [4, 22]] as const) rememberPicture(9505, i, ones(n), thumb);
    expect(nearCopyCandidates(9505, 9, ZERO, undefined, { drawnFrom: [1, 2, 3, 4] }).map(c => c.index)).toEqual([2, 4]);
    expect(nearCopyCandidates(9505, 9, { hash: ZERO, square: true }, undefined, { drawnFrom: [1, 2, 3, 4] })).toHaveLength(
      PANEL_CANDIDATES
    );
  });

  it("409-3: a picture that shipped as a fallback is remembered, with what it was drawn from", async () => {
    const shippedFrame = await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 90, g: 60, b: 30 } } })
      .composite([{ input: Buffer.from(`<svg width="320" height="180"><rect x="0" y="0" width="120" height="180" fill="white"/></svg>`), left: 0, top: 0 }])
      .png()
      .toBuffer();
    expect(nearCopyCandidates(9506, 5, await pictureHash(shippedFrame))).toEqual([]);
    await rememberShippedPicture(9506, 3, shippedFrame, false, undefined, [2]);
    expect(nearCopyCandidates(9506, 5, await pictureHash(shippedFrame)).map(c => c.index)).toEqual([3]);
    // Remembered with its sources: a later picture drawn from scene 2 counts it as a relative.
    const far = (await pictureHash(shippedFrame)).replace(/./g, (b, i) => (i < 30 ? (b === "1" ? "0" : "1") : b));
    expect(nearCopyCandidates(9506, 6, far)).toEqual([]);
    expect(nearCopyCandidates(9506, 6, far, undefined, { drawnFrom: [2], lookAtClosest: true }).map(c => c.index)).toEqual([3]);
    // A buffer that is no picture is skipped, never thrown.
    await expect(rememberShippedPicture(9506, 4, Buffer.from("not a picture"))).resolves.toBeUndefined();
    expect(nearCopyCandidates(9506, 5, await pictureHash(shippedFrame)).map(c => c.index)).toEqual([3]);
  });
});

describe("pictures drawn from the same memory share a lane (round 13, job 408 scenes 4 and 5)", () => {
  const ref = (index: number, own = true) => ({ index, ...(own ? { own: true as const } : {}) });

  it("408: the toilet's panel and the bin, both drawn from scene 2, are drawn one after the other", () => {
    const panel = { keyThing: "toilet", memoryRefScenes: [ref(2)] } as StoryboardScene;
    const bin = { keyThing: "bin", memoryRefScenes: [ref(2), ref(3)] } as StoryboardScene;
    expect(varietyLane(panel)).toBe("from:2");
    expect(varietyLane(bin)).toBe(varietyLane(panel));
  });

  it("a thing's first picture keeps its thing's lane; a screen its own; references of other things only take the earliest", () => {
    expect(varietyLane({ keyThing: "Bin " } as StoryboardScene)).toBe("thing:bin");
    expect(varietyLane({ keyThing: "bin", screenSetup: SCREEN_SETUPS[1], memoryRefScenes: [ref(2)] } as StoryboardScene)).toBe("screen");
    expect(varietyLane({ keyThing: "cart", memoryRefScenes: [ref(16, false), ref(3, false)] } as StoryboardScene)).toBe("from:3");
    // Its own thing's first picture decides over an earlier picture lent for another thing beside it.
    expect(varietyLane({ keyThing: "cart", memoryRefScenes: [ref(9), ref(3, false)] } as StoryboardScene)).toBe("from:9");
    expect(varietyLane({} as StoryboardScene)).toBeNull();
  });

  it("drawn from different pictures: different lanes, drawn in parallel as before", () => {
    const a = { keyThing: "bin", memoryRefScenes: [ref(2)] } as StoryboardScene;
    const b = { keyThing: "card", memoryRefScenes: [ref(7)] } as StoryboardScene;
    expect(varietyLane(a)).not.toBe(varietyLane(b));
  });

  it("a panel waits for the draw in front of it only so long, and the draw after it waits for both", async () => {
    const order: string[] = [];
    const draw = (name: string, ms: number) => () =>
      new Promise<void>(res => {
        order.push(`start ${name}`);
        setTimeout(() => (order.push(`end ${name}`), res()), ms);
      });
    // Within its wait the panel goes after the picture in front of it…
    await Promise.all([withScreenTurn(81, draw("bin", 20), "from:2"), withScreenTurn(81, draw("panel", 1), "from:2", 1_000)]);
    expect(order.indexOf("end bin")).toBeLessThan(order.indexOf("start panel"));
    // …past it, it draws anyway, and a later draw still waits for the one the panel cut in front of.
    order.length = 0;
    await Promise.all([
      withScreenTurn(82, draw("slow", 120), "from:2"),
      withScreenTurn(82, draw("panel", 1), "from:2", 10),
      withScreenTurn(82, draw("next", 1), "from:2"),
    ]);
    expect(order.indexOf("start panel")).toBeLessThan(order.indexOf("end slow"));
    expect(order.indexOf("end slow")).toBeLessThan(order.indexOf("start next"));
    expect(order.indexOf("end panel")).toBeLessThan(order.indexOf("start next"));
    expect(PANEL_LANE_WAIT_MS).toBe(3 * 60_000);
  });
});

describe("a tighter crop of one layout, or one layout with a person taken out, is a copy (round 13, job 410)", () => {
  it("410-23 and 410-20: both side-by-side checks say it, in the same words", () => {
    expect(SAME_LAYOUT_RULE).toMatch(/only closer or further back/);
    expect(SAME_LAYOUT_RULE).toMatch(/a person or a hand taken out or put in/);
    expect(NEAR_COPY_SYSTEM).toContain(SAME_LAYOUT_RULE);
    expect(JUST_SHOWN_COPY_NOTE).toContain(SAME_LAYOUT_RULE);
    expect(NEAR_COPY_SYSTEM).toMatch(/a person added or taken away does not make another subject/);
    // The old escape is gone: "a clearly different distance" alone no longer clears a punch-in.
    expect(NEAR_COPY_SYSTEM).not.toMatch(/from a clearly different distance or side/);
  });

  it("a real new view is still one: one small part filling the frame, another side or height, a much wider place", () => {
    expect(SAME_LAYOUT_RULE).toMatch(/one small part filling the frame with the rest out of it/);
    expect(SAME_LAYOUT_RULE).toMatch(/another side or height/);
    expect(SAME_LAYOUT_RULE).toMatch(/the place is most of the picture/);
    // …and the panel's frame shape is still never what makes a copy.
    expect(NEAR_COPY_SYSTEM).toMatch(/never the shape of their frames/);
  });
});
