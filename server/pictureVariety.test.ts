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
} from "./pictureVariety";
import { parseNearCopyVerdict, parseSameHostVerdict } from "./overlayTextScan";
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
    expect(parseSameHostVerdict('{"same":false,"what":"younger, dark hair"}')).toEqual({ same: false, what: "younger, dark hair" });
    expect(parseSameHostVerdict("")).toEqual({ same: true, what: "" });
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
