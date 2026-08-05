import { describe, it, expect, vi } from "vitest";
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

import { hasOverlayText, parseOverlayVerdict } from "./overlayTextScan";

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
