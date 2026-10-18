import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";

// Mock the Claude client so nothing here hits the live model. Braces are load-bearing on any
// beforeEach/afterEach that resets a mock: a braceless arrow returns the mock, and vitest calls
// that return value as a teardown hook.
vi.mock("./claude", async importOriginal => {
  const actual = await importOriginal<typeof import("./claude")>();
  return { ...actual, invokeClaude: vi.fn() };
});
import { invokeClaude } from "./claude";
const mockInvoke = vi.mocked(invokeClaude);

import {
  hasOverlayText,
  parseOverlayVerdict,
  parseStillDefectVerdict,
  scanStillDefects,
  STILL_DEFECT_SYSTEM,
} from "./overlayTextScan";

describe("parseStillDefectVerdict", () => {
  it("parses both bits independently", () => {
    expect(
      parseStillDefectVerdict(
        '{"overlay":false,"broken":true,"what":"board floating above the table"}'
      )
    ).toEqual({
      overlay: false,
      broken: true,
      writing: false,
      missing: false,
      messy: false,
      wrongPlace: false, staged: false,
      what: "board floating above the table",
    });
  });

  it("parses the readable-writing bit, and keeps its what", () => {
    expect(
      parseStillDefectVerdict(
        '{"overlay":false,"broken":false,"writing":true,"what":"chalkboard reading $93/hour"}'
      )
    ).toEqual({
      overlay: false,
      broken: false,
      writing: true,
      missing: false,
      messy: false,
      wrongPlace: false, staged: false,
      what: "chalkboard reading $93/hour",
    });
    expect(parseStillDefectVerdict('{"writing":"yes"}').writing).toBe(false);
  });

  it("a verdict missing one bit still counts for the other", () => {
    // The old overlay-only shape must keep working — and vice versa.
    expect(parseStillDefectVerdict('{"overlay":true}')).toEqual({
      overlay: true,
      broken: false,
      writing: false,
      missing: false,
      messy: false,
      wrongPlace: false, staged: false,
      what: "",
    });
    expect(parseStillDefectVerdict('{"broken":true}')).toEqual({
      overlay: false,
      broken: true,
      writing: false,
      missing: false,
      messy: false,
      wrongPlace: false, staged: false,
      what: "",
    });
  });

  it("treats prose and off-shape values as no defect, never a re-roll", () => {
    expect(parseStillDefectVerdict("looks broken to me").broken).toBe(false);
    expect(parseStillDefectVerdict('{"broken":"yes"}').broken).toBe(false);
    expect(
      parseStillDefectVerdict('{"overlay":false,"broken":false,"what":"x"}')
        .what
    ).toBe("");
  });
});

describe("parseOverlayVerdict", () => {
  it("parses a fenced verdict", () => {
    expect(
      parseOverlayVerdict(
        '```json\n{"overlay":true,"what":"caption bar across the bottom"}\n```'
      )
    ).toEqual({ overlay: true, what: "caption bar across the bottom" });
  });

  it("reads a clean frame as no overlay", () => {
    expect(parseOverlayVerdict('{"overlay":false,"what":""}')).toEqual({
      overlay: false,
      what: "",
    });
  });

  it("treats prose and off-shape objects as no overlay, never a re-roll", () => {
    // A re-roll costs an image and possibly a grok render — an unparseable answer must not buy one.
    expect(parseOverlayVerdict("I think there might be text?").overlay).toBe(
      false
    );
    expect(parseOverlayVerdict('{"overlay":"yes"}').overlay).toBe(false);
    expect(parseOverlayVerdict('{"what":"a caption"}').overlay).toBe(false);
  });

  it("tolerates a missing/non-string `what` on a real overlay verdict", () => {
    expect(parseOverlayVerdict('{"overlay":true}')).toEqual({
      overlay: true,
      what: "",
    });
    expect(parseOverlayVerdict('{"overlay":true,"what":42}').what).toBe("");
  });
});

/** A real image — sharp runs unmocked here, so these can't be fake bytes. */
const imageOf = (w: number, h: number, format: "png" | "jpeg" = "png") =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: 3,
      background: { r: 120, g: 140, b: 90 },
    },
  })
    [format]()
    .toBuffer();

/** The bytes actually handed to Claude on the Nth call. */
const sentImage = (n = 0) => {
  const input = mockInvoke.mock.calls[n][0].imageInput as {
    base64: string;
    mediaType: string;
  };
  return {
    buf: Buffer.from(input.base64, "base64"),
    mediaType: input.mediaType,
  };
};

describe("hasOverlayText", () => {
  it("fails open when the vision call throws — a dead check never costs a render", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error("529 overloaded"));
    expect(await hasOverlayText(await imageOf(1280, 720))).toBe(false);
  });

  it("fails open when the buffer isn't a decodable image, without calling the model", async () => {
    mockInvoke.mockReset();
    expect(await hasOverlayText(Buffer.from("not-an-image"))).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("downscales to 768x432 — pixels are ~72% of this call's cost", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":false,"what":""}',
    } as any);
    await hasOverlayText(await imageOf(1280, 720));
    const meta = await sharp(sentImage().buf).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual({
      width: 768,
      height: 432,
    });
  });

  it("declares png over png bytes whatever the input format was", async () => {
    // media_type must match the bytes actually sent: declaring jpeg over png 400s, which fails
    // open and would ship the text silently. sharp re-encodes, so the two cannot drift — feed it
    // jpeg and the call must still be a truthful png.
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":false,"what":""}',
    } as any);
    await hasOverlayText(await imageOf(1280, 720, "jpeg"));
    const { buf, mediaType } = sentImage();
    expect(mediaType).toBe("image/png");
    expect((await sharp(buf).metadata()).format).toBe("png");
  });

  it("reports stamped text when the judge finds it", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":true,"what":"title across the top"}',
    } as any);
    expect(await hasOverlayText(await imageOf(1280, 720))).toBe(true);
  });
});

describe("scanStillDefects", () => {
  it("asks whether the frame shows the named thing only when told what that is", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":false,"broken":false,"writing":false,"missing":true,"what":"a sanding block, not a stack"}',
    } as any);
    const asked = await scanStillDefects(await imageOf(1280, 720), "a stack of sandpaper");
    expect(asked.missing).toBe(true);
    // The per-picture questions ride AFTER the cached rulebook, never inside it — glued on, every
    // check re-wrote the cache instead of reading it.
    expect(mockInvoke.mock.calls[0][0].systemSuffix).toContain("a stack of sandpaper");
    expect(mockInvoke.mock.calls[0][0].systemPrompt.startsWith(STILL_DEFECT_SYSTEM)).toBe(true);
    expect(mockInvoke.mock.calls[0][0].systemPrompt).not.toContain("a stack of sandpaper");
    // Without a subject the question is never asked, and a stray "missing" is ignored.
    mockInvoke.mockClear();
    const plain = await scanStillDefects(await imageOf(1280, 720));
    expect(plain.missing).toBe(false);
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toContain("QUESTION 4");
  });

  it("holds a copied first picture to its thing's look inside the same question, on the careful checker", async () => {
    // Ruth's job 305: the first straight-stitch machine, copied by 5 later pictures. No extra call:
    // the look rides QUESTION 4, and a miss is an ordinary "missing".
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"missing":true,"what":"a white machine"}' } as any);
    const look = { thing: "straight-stitch machine", look: "small black and chrome sewing machine, compact size" };
    const v = await scanStillDefects(await imageOf(1280, 720), "a straight-stitch machine", undefined, undefined, undefined, [look.thing], false, look);
    expect(v.missing).toBe(true);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const call = mockInvoke.mock.calls[0][0];
    expect(call.systemSuffix).toContain("small black and chrome sewing machine, compact size");
    expect(call.systemPrompt).not.toContain("black and chrome");
    expect(call.model).not.toBe("claude-haiku-4-5-20251001");
    // A picture nothing copies is asked for the thing only.
    mockInvoke.mockClear();
    await scanStillDefects(await imageOf(1280, 720), "a straight-stitch machine", undefined, undefined, undefined, [look.thing]);
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toContain("black and chrome");
  });

  it("reports broken geometry when the judge finds it", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":false,"broken":true,"what":"shelf merging into the wall"}',
    } as any);
    expect(await scanStillDefects(await imageOf(1280, 720))).toEqual({
      overlay: false,
      broken: true,
      writing: false,
      missing: false,
      messy: false,
      wrongPlace: false, staged: false,
      what: "shelf merging into the wall",
    });
  });

  it("asks the other checker, then reports UNCHECKED (never a pass) when both calls throw", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error("529 overloaded"));
    expect(await scanStillDefects(await imageOf(1280, 720))).toEqual({
      overlay: false,
      broken: false,
      writing: false,
      missing: false,
      messy: false,
      wrongPlace: false, staged: false,
      unchecked: true,
      what: "",
    });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[0][0].model).not.toBe(mockInvoke.mock.calls[1][0].model);
  });

  it("a failed first call answered by the other checker is a normal verdict", async () => {
    mockInvoke.mockReset();
    mockInvoke
      .mockRejectedValueOnce(new Error("Claude returned no text content"))
      .mockResolvedValueOnce({ text: '{"overlay":false,"broken":false,"writing":true,"what":"label"}' });
    const v = await scanStillDefects(await imageOf(1280, 720));
    expect(v.writing).toBe(true);
    expect(v.unchecked).toBeUndefined();
  });
});

describe("still checks for rules 3 and 4", () => {
  it("reads the brand/clutter and wrong-place bits", async () => {
    const { parseStillDefectVerdict } = await import("./overlayTextScan");
    const v = parseStillDefectVerdict(
      '{"overlay":false,"broken":false,"writing":false,"messy":true,"wrong_place":true,"what":"logo on the drill"}'
    );
    expect(v.messy).toBe(true);
    expect(v.wrongPlace).toBe(true);
    expect(v.what).toBe("logo on the drill");
  });

  it("asks the place question only with a line, and lists every key it asks", async () => {
    const { verdictShape, placeQuestion } = await import("./overlayTextScan");
    expect(verdictShape()).not.toContain("wrong_place");
    expect(verdictShape("a saw", "sold at the market")).toContain('"wrong_place"');
    expect(verdictShape("a saw")).toContain('"missing"');
    expect(placeQuestion("sold at the fair")).toContain("sold at the fair");
  });
});

describe("the thing the way its description says — the detail verdict (2026-10-18, the audit's picture-vs-line rows)", () => {
  // Hand-sampled rows whose description already named the detail the picture missed.
  const OPEN = "padlock hanging open on a mesh gate latch"; // 305-118, drawn shut
  const LUMPY = "a bobbin wound lumpy and uneven beside the machine"; // 285-125, drawn neat
  const RAISED = "the host from behind, both arms raised over her head"; // 233-134, drawn arms down

  // Off until it is measured: these cases turn it on; the last ones check it is off by default.
  beforeEach(() => {
    process.env.PICTURE_DETAIL_CHECK = "1";
  });
  afterEach(() => {
    delete process.env.PICTURE_DETAIL_CHECK;
  });

  it("asks it beside 'missing', in the uncached part, and reads it back with what came out otherwise", async () => {
    const { verdictShape } = await import("./overlayTextScan");
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":false,"broken":false,"writing":false,"missing":false,"detail":true,"detail_what":"padlock shut, should hang open","what":"padlock closed"}',
    } as any);
    const v = await scanStillDefects(await imageOf(1280, 720), OPEN, "and a padlock that just hangs there open,");
    expect(v.detail).toBe(true);
    expect(v.detailWhat).toBe("padlock shut, should hang open");
    expect(v.missing).toBe(false); // the thing is there — `missing` keeps its meaning
    const call = mockInvoke.mock.calls[0][0];
    expect(call.systemSuffix).toContain("QUESTION 4b — detail");
    expect(call.systemSuffix).toContain(OPEN);
    expect(call.systemSuffix).toContain('"detail":true|false');
    expect(call.systemPrompt).not.toContain("QUESTION 4b");
    expect(verdictShape(OPEN, undefined, true)).toContain('"detail_what"');
    expect(verdictShape(OPEN)).not.toContain("detail");
  });

  it("names the state, the action, the number and the position — in neutral words, for any description", async () => {
    const { detailQuestion } = await import("./overlayTextScan");
    for (const d of [OPEN, LUMPY, RAISED]) expect(detailQuestion(d)).toContain(d);
    const fixed = detailQuestion("X");
    expect(fixed).toMatch(/STATE/);
    expect(fixed).toMatch(/NUMBER/);
    expect(fixed).toMatch(/POSITION/);
    expect(fixed).toMatch(/someone is\s+doing something/);
    // Never about the camera, the place, the light or printing; never the missing thing's question.
    expect(fixed).toMatch(/Never answer about the camera/);
    expect(fixed).toMatch(/that is question 4/);
    expect(fixed).not.toMatch(/padlock|bobbin|arms raised/i);
  });

  it("holds the picture to its DESCRIPTION, never to the line — a person the line only mentions is never asked for", async () => {
    const { detailQuestion } = await import("./overlayTextScan");
    // 144-99: "and they go to women setting up a kitchen" rightly shows the cloths.
    const q = detailQuestion("bread cloths sitting in a farmhouse kitchen near the cookstove");
    expect(q).not.toMatch(/women/);
    // 153-296: a safety line is drawn the safe way, and that is the description it is held to.
    expect(detailQuestion("rags kept spread out flat, not wadded, drying safely outside")).toContain("spread out flat, not wadded");
  });

  it("is never asked, and a stray answer ignored, without a description", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"detail":true,"detail_what":"x"}' } as any);
    const v = await scanStillDefects(await imageOf(1280, 720));
    expect(v.detail).toBeUndefined();
    expect(v.detailWhat).toBeUndefined();
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toContain("QUESTION 4b");
  });

  it("off by default (and with PICTURE_DETAIL_CHECK=0): exactly the check it was before", async () => {
    const img = await imageOf(1280, 720);
    for (const setting of [undefined, "0"]) {
      if (setting === undefined) delete process.env.PICTURE_DETAIL_CHECK;
      else process.env.PICTURE_DETAIL_CHECK = setting;
      mockInvoke.mockReset();
      mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"missing":false,"detail":true}' } as any);
      const v = await scanStillDefects(img, OPEN, "and a padlock that just hangs there open,");
      expect(v).toEqual({
        overlay: false,
        broken: false,
        writing: false,
        missing: false,
        messy: false,
        wrongPlace: false,
        staged: false,
        what: "",
      });
      const off = mockInvoke.mock.calls[0][0];
      expect(off.systemSuffix).not.toContain("detail");
      expect(off.userMessage).not.toMatch(/the way it is described/);
    }
  });

  it("parses detail only when it is true, and its words only beside it", async () => {
    const { parseStillDefectVerdict } = await import("./overlayTextScan");
    const v = parseStillDefectVerdict('{"detail":true,"what":"arms down"}');
    expect(v.detail).toBe(true);
    expect(v.detailWhat).toBeUndefined();
    expect(v.what).toBe("arms down");
    const no = parseStillDefectVerdict('{"detail":false,"detail_what":"arms down"}');
    expect("detail" in no).toBe(false);
    expect(no.detailWhat).toBeUndefined();
    expect(parseStillDefectVerdict('{"detail":"yes"}').detail).toBeUndefined();
  });
});

describe("what the line rules out — the forbidden verdict (R5, the audit, 2026-10-18)", () => {
  // prod 203-143: "and away from the furnace." drawn with the stack beside the furnace.
  const STACK = "a stickered board stack on a dry garage floor";
  const RULED_OUT = "the board stack near the furnace";

  it("asks it only with what the line check marked, after the cached rulebook, and reads it back", async () => {
    const { verdictShape } = await import("./overlayTextScan");
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({
      text: '{"overlay":false,"broken":false,"writing":false,"missing":false,"forbidden":true,"what":"furnace right beside the stack"}',
    } as any);
    const line = "and away from the furnace.";
    const v = await scanStillDefects(await imageOf(1280, 720), STACK, line, undefined, undefined, undefined, false, undefined, RULED_OUT);
    expect(v.forbidden).toBe(true);
    expect(v.what).toBe("furnace right beside the stack");
    expect(v.missing).toBe(false);
    const call = mockInvoke.mock.calls[0][0];
    expect(call.systemSuffix).toContain("QUESTION 8 — forbidden");
    expect(call.systemSuffix).toContain(RULED_OUT);
    expect(call.systemSuffix).toContain('"forbidden":true|false');
    expect(call.systemPrompt).not.toContain("QUESTION 8");
    expect(call.userMessage).toMatch(/what the line rules out/);
    // The place question keeps the piece's own words: the ruled-out phrase is never fed to it.
    expect(call.systemSuffix).toContain(`narration line: "${line}"`);
    expect(verdictShape(STACK, line, false, true)).toContain('"forbidden"');
    expect(verdictShape(STACK, line)).not.toContain("forbidden");
  });

  it("is never asked on a picture the line check did not mark, and a stray answer is ignored", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"missing":false,"forbidden":true}' } as any);
    // A real line a word list flagged that rules nothing out: no forbids, so no question.
    const v = await scanStillDefects(
      await imageOf(1280, 720),
      "a hand-built lattice panel hanging on a living-room wall",
      "build it anyway for your own wall, just don't count on it to buy next month's pickets."
    );
    expect(v).toEqual({
      overlay: false,
      broken: false,
      writing: false,
      missing: false,
      messy: false,
      wrongPlace: false,
      staged: false,
      what: "",
    });
    const call = mockInvoke.mock.calls[0][0];
    expect(call.systemSuffix).not.toContain("QUESTION 8");
    expect(call.systemSuffix).not.toContain("forbidden");
    // An empty mark is no mark.
    mockInvoke.mockClear();
    await scanStillDefects(await imageOf(1280, 720), STACK, undefined, undefined, undefined, undefined, false, undefined, "  ");
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toContain("QUESTION 8");
  });

  it("judges the act, the placement or the thing exactly as named — the right way and the thing alone pass", async () => {
    const { forbiddenQuestion } = await import("./overlayTextScan");
    const q = forbiddenQuestion("a lit candle in the room");
    expect(q).toContain('"a lit candle in the room"');
    expect(q).toMatch(/When\s+it names an act, answer true only if the act is being done/);
    expect(q).toMatch(/only if the thing is there, in that place or beside it/);
    expect(q).toMatch(/The same task done the right way, a different thing in\s+its place, or the thing on its own away from that place is false/);
    expect(q).toMatch(/When unsure, answer false/);
    // Neutral: the fixed wording names no channel's objects.
    expect(forbiddenQuestion("X")).not.toMatch(/furnace|vault|shampoo|fence|candle/i);
    expect(forbiddenQuestion('the "wrong" way')).toContain("the 'wrong' way");
  });

  it("one picture of a joined sentence is held to any one of its marks", async () => {
    const { forbiddenQuestion } = await import("./overlayTextScan");
    expect(forbiddenQuestion("a lit candle in the room; a lit cigarette in the room")).toMatch(
      /exactly that — any one of the things listed\? When/
    );
    expect(forbiddenQuestion("a lit candle in the room")).not.toContain("any one of");
  });

  // prod 225-83: "Never in | the garage, | the basement, | the shed, | or on the porch," — the piece
  // "or on the porch," names the porch only to rule it out, and the place question used to call a
  // picture drawn the right way (out in the open) the wrong place for it.
  it("the place question never holds a marked picture to the place its sentence rules out", async () => {
    const { placeQuestion } = await import("./overlayTextScan");
    expect(placeQuestion("or on the porch,", true)).toMatch(
      /a place it says to keep something\s+away from, out of, or never to use is NOT where the frame must be/
    );
    expect(placeQuestion("or on the porch,", true)).toMatch(/If the line names no such place, or you are unsure, answer false\.$/);
    // Unmarked, the question is exactly as before: a place a line names is where the frame belongs.
    expect(placeQuestion("sold at the fair")).not.toMatch(/rules something out/);
    expect(placeQuestion("sold at the fair")).toMatch(/never make it wrong\. If the line names no such place/);
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"missing":false}' } as any);
    const run = "a portable generator running on an open gravel driveway";
    await scanStillDefects(await imageOf(1280, 720), run, "or on the porch,", undefined, undefined, undefined, false, undefined, "the generator running inside a building");
    expect(mockInvoke.mock.calls[0][0].systemSuffix).toMatch(/rules something out here/);
    mockInvoke.mockClear();
    await scanStillDefects(await imageOf(1280, 720), "a quilt folded on a market stall", "sold at the fair");
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toMatch(/rules something out here/);
  });

  it("parses forbidden only when it is true", () => {
    expect(parseStillDefectVerdict('{"forbidden":true,"what":"hand on belly"}')).toMatchObject({ forbidden: true, what: "hand on belly" });
    expect("forbidden" in parseStillDefectVerdict('{"forbidden":false}')).toBe(false);
    expect(parseStillDefectVerdict('{"forbidden":"yes"}').forbidden).toBeUndefined();
  });
});

/**
 * LIGHT THE WORDS NAME IS NOT STAGED (2026-10-18, the review of jobs 401-407). The picture check was
 * never told what its line or description asked for, so night and lamplight the words named were
 * called staged on both draws and shipped with the warning.
 */
describe("namedLight / namedLightQuestion", () => {
  it("reads the light the line and the description name (jobs 401 and 405)", async () => {
    const { namedLight } = await import("./overlayTextScan");
    // Job 401 scene 11: the line's hour and the description's lamp at night.
    expect(
      namedLight(
        "the kitchen table at two in the morning when the house is too quiet.",
        "round wooden kitchen table with two chairs and a dim lamp at night"
      )
    ).toEqual(["two in the morning", "dim", "lamp", "night"]);
    // Job 401 scene 22: only the description names it.
    expect(
      namedLight(
        "Two thousand years ago, a man named Lucius Annaeus Seneca wrote a short, furious, loving essay to a man named Paulinus,",
        "a Roman man in a toga writing on a scroll at a wooden desk by lamplight"
      )
    ).toEqual(["lamplight"]);
    // Job 405: the night bedroom, the lamp at evening, dawn and dusk.
    expect(namedLight("and decode it one layer at a time,", "a small tabby cat standing on the bed at night, ears forward, looking toward the pillows")).toEqual(["night"]);
    expect(
      namedLight(
        "And by the end, you’ll have the one evening change that quietly takes the appointment off the books.",
        "a quiet bedroom at evening with the lamp glowing softly on the nightstand"
      )
    ).toEqual(["evening", "lamp"]);
    expect(namedLight("creatures of the deep night,", "a small tabby cat sitting alert on a windowsill, dim dawn light glowing through the bedroom window")).toEqual(["night", "dim", "dawn"]);
    expect(namedLight("she inherited her whiskers.", "an open grassy wild landscape at dusk, low golden light over scattered brush")).toEqual(["dusk"]);
    expect(namedLight("Three in the morning. The house is dark, the street outside has gone quiet,")).toEqual(["Three in the morning", "house is dark"]);
    expect(namedLight("at 3 a.m. or 11pm", "her face lit by the glow of a phone, a candle, a night light")).toEqual(["3 a.m.", "11pm", "glow of a phone", "candle", "night light"]);
    expect(namedLight("the one kind of fire that likes to start while the house is asleep")).toEqual(["fire"]);
  });

  it("names no light for words that only name a thing, a colour or the host talking", async () => {
    const { namedLight } = await import("./overlayTextScan");
    // Job 401 scenes 24 and 30, job 402 scene 11: nothing in the words lights the picture, so a
    // golden glow or a glossy finish there is staged exactly as before.
    expect(namedLight("Seneca was no monk on a hillside.", "a well dressed man standing near a grand desk in a study")).toEqual([]);
    expect(namedLight("the senator complains,", "a senator in robes standing in a stone hall")).toEqual([]);
    expect(namedLight("the flight,", "an airplane climbing through clouds in flight")).toEqual([]);
    // Job 401 scene 12's panel: warm light nobody named is still judged.
    expect(namedLight("Fewer years ahead than behind,", "quiet study room with desk and window in warm late-spring light")).toEqual([]);
    // "tonight" is the host talking (job 405 scene 13's line), not a time of day.
    expect(namedLight("So tonight we’re treating that scene like footage.")).toEqual([]);
    // A word used as a name.
    expect(namedLight("a smoke alarm and a fire extinguisher on the kitchen wall", "fire-resistant gloves beside a stack of firewood")).toEqual([]);
    expect(namedLight("let the glue dry overnight, evening out the stain", "a nightstand, a dark walnut board, a clamp, a lampshade")).toEqual([]);
    expect(namedLight("it's dark walnut", "a bowl in dark green paint, 12 amps, 5 amazing tips")).toEqual([]);
    expect(namedLight("fire up the planer", "a misfire, rapid-fire cuts")).toEqual([]);
    expect(namedLight(undefined, undefined)).toEqual([]);
  });

  it("'in the dark' names the light only where the phrase ends; the trade around a fire names none", async () => {
    const { namedLight } = await import("./overlayTextScan");
    // The practice scripts: a kit for a power cut, where "in the dark" is the light…
    expect(namedLight("The first thing you need in the dark should never be at the bottom of the bag.")).toEqual(["in the dark"]);
    expect(namedLight("clicks on, and runs itself dead in the dark of your closet for a week.")).toEqual(["in the dark"]);
    expect(namedLight("Hands that glow a little in the dark, if you can find one like that.")).toEqual(["in the dark"]);
    expect(namedLight("a person sitting in the dark scrolling a phone")).toEqual(["in the dark"]);
    // …job 405 scene 7, where the dark room is named by itself…
    expect(
      namedLight(undefined, "a small tabby cat standing on a sleeping person's chest in the dark bedroom, head lowered close to their face")
    ).toEqual(["dark bedroom"]);
    // …and a style line, where "dark" describes the necklace, not the room.
    expect(
      namedLight("Take a photograph of yourself in the dark necklace, then take the same photograph with nothing on your neck at all, same light, same top, one minute apart.")
    ).toEqual([]);
    expect(namedLight("dressed in dark colors", "the app in dark mode, a man in dark clothing")).toEqual([]);
    expect(namedLight("customers kept in the dark about the fees")).toEqual([]);
    // A smoke-alarm script's "fire service" and "fire protection" are the trade, not a flame.
    expect(namedLight("What there is, is a position the fire service has stated out loud for years.")).toEqual([]);
    expect(namedLight("A closed hollow interior door is a serious piece of fire protection.")).toEqual([]);
    expect(namedLight("a fire sale on old stock, a fire hose, fire off an email")).toEqual([]);
    // A colour, a contract's end and an idiom.
    expect(namedLight("a mug in midnight blue", "a wall in sunset orange paint, a sunset clause, a dim view of it")).toEqual([]);
    // The light itself still counts (a charring script's fire, job 400 scene 18's sunset).
    expect(
      namedLight("the fire is doing most of the selling", "an older couple walking slowly along a quiet path at sunset")
    ).toEqual(["fire", "sunset"]);
  });

  it("tells the check the named light is asked for, and keeps judging the finish and an unnamed glow", async () => {
    const { namedLightQuestion, STAGED_RULE } = await import("./overlayTextScan");
    const q = namedLightQuestion(["two in the morning", "lamp"]);
    expect(q.startsWith("\n\nQUESTION 7 NOTE — staged:")).toBe(true);
    expect(q).toContain('("two in the morning", "lamp")');
    expect(q).toMatch(/Light that comes from that is what was asked for/);
    expect(q).toMatch(/NEVER staged on its own/);
    expect(q).toMatch(/answer true\s+for a glossy, polished advertising finish/);
    expect(q).toMatch(/a golden glow or dramatic light that does not\s+come from what those words name/);
    // Nothing named, nothing asked; the rule itself is unchanged.
    expect(namedLightQuestion([])).toBe("");
    expect(STAGED_RULE).toMatch(/Say true for: a glowing\s+lamp, candle or golden glow/);
    // The audit asks it under its own heading.
    expect(namedLightQuestion(["night"], "staged, for this frame")).toMatch(/^\n\nstaged, for this frame: /);
  });

  it("asks it after the cached rulebook, only when the line or description names light, and the verdict parses as before", async () => {
    const { STAGED_QUESTION } = await import("./overlayTextScan");
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"staged":false}' } as any);
    await scanStillDefects(
      await imageOf(1280, 720),
      "round wooden kitchen table with two chairs and a dim lamp at night",
      "the kitchen table at two in the morning when the house is too quiet."
    );
    const call = mockInvoke.mock.calls[0][0];
    expect(call.systemSuffix).toMatch(/QUESTION 7 NOTE — staged: .*\("two in the morning", "dim", "lamp", "night"\)/);
    expect(call.systemPrompt).toContain(STAGED_QUESTION);
    expect(call.systemPrompt).not.toMatch(/QUESTION 7 NOTE/);
    // The note sits before the JSON shape, which still lists staged.
    expect(call.systemSuffix!.indexOf("QUESTION 7 NOTE")).toBeLessThan(call.systemSuffix!.indexOf("Return ONLY this JSON"));
    expect(call.systemSuffix).toContain('"staged":true|false');
    // No named light (job 401 scene 24): no note, the rule alone judges it.
    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue({ text: '{"overlay":false,"broken":false,"writing":false,"staged":true,"what":"glossy period-drama finish"}' } as any);
    const v = await scanStillDefects(
      await imageOf(1280, 720),
      "a well dressed man standing near a grand desk in a study",
      "Seneca was no monk on a hillside."
    );
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toMatch(/QUESTION 7 NOTE/);
    expect(v.staged).toBe(true);
    expect(v.what).toBe("glossy period-drama finish");
    // A picture with neither line nor description is asked nothing extra.
    mockInvoke.mockClear();
    await scanStillDefects(await imageOf(1280, 720));
    expect(mockInvoke.mock.calls[0][0].systemSuffix).not.toMatch(/QUESTION 7 NOTE/);
  });
});
