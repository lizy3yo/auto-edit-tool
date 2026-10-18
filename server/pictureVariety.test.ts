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
} from "./pictureVariety";
import { NEAR_COPY_SYSTEM, nearCopyPair, parseNearCopyVerdict, parseSameHostVerdict } from "./overlayTextScan";
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
