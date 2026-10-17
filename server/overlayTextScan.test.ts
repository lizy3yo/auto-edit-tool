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
