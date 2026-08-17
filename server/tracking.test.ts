import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  TRACKING_PARAM,
  buildTrackingUrl,
  parseTrackingRef,
  refToJobId,
  renderTrackingQrPng,
  decodeQrPng,
  renderVerifiedQrPng,
  stripTrackingParam,
} from "./tracking";

describe("buildTrackingUrl", () => {
  it("appends the tracking param to a plain shop URL", () => {
    expect(buildTrackingUrl("https://shop.example/soil", 183)).toBe(
      "https://shop.example/soil?ref=183"
    );
  });

  it("keeps a query string the shop URL already carries", () => {
    const url = buildTrackingUrl(
      "https://shop.example/soil?utm_campaign=autumn",
      183
    );
    expect(url).toContain("utm_campaign=autumn");
    expect(url).toContain("ref=183");
  });

  it("REPLACES an existing ref rather than appending a second one", () => {
    const url = buildTrackingUrl("https://shop.example/soil?ref=1", 183);
    expect(url).toBe("https://shop.example/soil?ref=183");
    expect(url?.match(/ref=/g)).toHaveLength(1);
  });

  it("is idempotent — re-deriving a link cannot accumulate params", () => {
    const once = buildTrackingUrl("https://shop.example/soil", 183) as string;
    expect(buildTrackingUrl(once, 183)).toBe(once);
  });

  it("tolerates a URL pasted without a scheme, which operators do constantly", () => {
    expect(buildTrackingUrl("shop.example/soil", 183)).toBe(
      "https://shop.example/soil?ref=183"
    );
  });

  it("returns null for a missing or blank shop URL — no shop, no tracking", () => {
    expect(buildTrackingUrl(undefined, 183)).toBeNull();
    expect(buildTrackingUrl(null, 183)).toBeNull();
    expect(buildTrackingUrl("   ", 183)).toBeNull();
  });

  it("returns null for junk rather than shipping a QR that leads nowhere", () => {
    expect(buildTrackingUrl("not a url at all !!", 183)).toBeNull();
    expect(buildTrackingUrl("   /just/a/path", 183)).toBeNull();
  });

  it("rejects a non-web scheme instead of mangling it into one (regression)", () => {
    // The original defect: prefixing "https://" whenever the string didn't START with http(s)://
    // turned these into valid https URLs, so the protocol guard below never fired.
    for (const bad of [
      "ftp://shop.example/soil",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>",
    ]) {
      expect(buildTrackingUrl(bad, 183)).toBeNull();
    }
  });

  it("rejects a hostname that is neither dotted nor loopback", () => {
    expect(buildTrackingUrl("http://nodots/buy", 183)).toBeNull();
    expect(buildTrackingUrl("justhostname", 183)).toBeNull();
  });

  it("ACCEPTS a loopback shop URL, so the loop can be rehearsed locally (regression)", () => {
    // The original guard required a dot in the hostname, which rejected every local test
    // storefront — blocking the only way to exercise link → cookie → order → sale before going
    // live. A loopback host is unambiguously a test rig, not a typo.
    expect(
      buildTrackingUrl("http://localhost:4000/buy/soil-handbook", 12)
    ).toBe("http://localhost:4000/buy/soil-handbook?ref=12");
    expect(buildTrackingUrl("http://127.0.0.1:4000/buy/x", 12)).toBe(
      "http://127.0.0.1:4000/buy/x?ref=12"
    );
  });

  it("uses the documented parameter name — changing it breaks published links", () => {
    expect(TRACKING_PARAM).toBe("ref");
  });
});

describe("parseTrackingRef", () => {
  it("round-trips with buildTrackingUrl", () => {
    const url = buildTrackingUrl("https://shop.example/soil", 4211) as string;
    expect(parseTrackingRef(url)).toBe(4211);
  });

  it("returns null when there is no ref, or it isn't a positive integer", () => {
    expect(parseTrackingRef("https://shop.example/soil")).toBeNull();
    expect(parseTrackingRef("https://shop.example/soil?ref=abc")).toBeNull();
    expect(parseTrackingRef("https://shop.example/soil?ref=0")).toBeNull();
    expect(parseTrackingRef("https://shop.example/soil?ref=-5")).toBeNull();
    expect(parseTrackingRef("nonsense")).toBeNull();
  });
});

describe("refToJobId — what the webstore might send us", () => {
  it("accepts the bare number we issue", () => {
    expect(refToJobId("183")).toBe(183);
  });

  it("tolerates a store that forwards the whole landing URL", () => {
    expect(refToJobId("https://shop.example/soil?ref=183&x=1")).toBe(183);
  });

  it("tolerates a ref=-prefixed string", () => {
    expect(refToJobId("ref=183")).toBe(183);
  });

  it("returns null for anything else, so the sale is kept as unattributed", () => {
    expect(refToJobId(null)).toBeNull();
    expect(refToJobId(undefined)).toBeNull();
    expect(refToJobId("")).toBeNull();
    expect(refToJobId("   ")).toBeNull();
    expect(refToJobId("abc")).toBeNull();
    expect(refToJobId("0")).toBeNull();
    expect(refToJobId("99999999999999999999")).toBeNull();
  });
});

describe("QR generation", () => {
  const URL_A = "https://shop.example/soil-handbook?ref=183";
  const URL_B = "https://shop.example/greenhouse-guide?ref=183";

  it("renders a square PNG at the requested size", async () => {
    const png = await renderTrackingQrPng(URL_A, 512);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it("DECODES BACK to exactly the URL encoded — the check that makes it trustworthy", async () => {
    const png = await renderTrackingQrPng(URL_A);
    expect(await decodeQrPng(png)).toBe(URL_A);
  });

  it("two videos selling the same book produce different, correct codes", async () => {
    const a = buildTrackingUrl("https://shop.example/soil", 183) as string;
    const b = buildTrackingUrl("https://shop.example/soil", 184) as string;
    expect(await decodeQrPng(await renderTrackingQrPng(a))).toBe(a);
    expect(await decodeQrPng(await renderTrackingQrPng(b))).toBe(b);
    expect(a).not.toBe(b);
  });

  it("two books in one video produce different, correct codes", async () => {
    expect(await decodeQrPng(await renderTrackingQrPng(URL_A))).toBe(URL_A);
    expect(await decodeQrPng(await renderTrackingQrPng(URL_B))).toBe(URL_B);
  });

  it("still decodes at the small on-screen size the corner card uses", async () => {
    // The corner QR is ~28% of a 1080px frame ≈ 300px, and its inner image ~260px.
    const png = await renderTrackingQrPng(URL_A, 260);
    expect(await decodeQrPng(png)).toBe(URL_A);
  });

  it("survives a long URL with several query params", async () => {
    const long =
      "https://shop.example/store/collections/gardening/products/the-backyard-soil-handbook" +
      "?utm_source=youtube&utm_medium=video&utm_campaign=autumn-2026&ref=183";
    expect(await decodeQrPng(await renderTrackingQrPng(long))).toBe(long);
  });

  it("renderVerifiedQrPng reports success and hands back the code", async () => {
    const r = await renderVerifiedQrPng(URL_A, 512);
    expect(r.verified).toBe(true);
    expect(r.decoded).toBe(URL_A);
    expect((await sharp(r.png).metadata()).width).toBe(512);
  });

  it("decodeQrPng returns null on a non-QR image instead of throwing", async () => {
    const blank = await sharp({
      create: {
        width: 256,
        height: 256,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();
    expect(await decodeQrPng(blank)).toBeNull();
  });

  it("decodeQrPng returns null on a corrupt buffer instead of throwing", async () => {
    expect(await decodeQrPng(Buffer.from("not an image"))).toBeNull();
  });
});

describe("stripTrackingParam", () => {
  it("removes a tag pasted in from a previous video", () => {
    // Without this, the BOOK would carry ?ref=99 and every later video's link would be wrong.
    expect(stripTrackingParam("https://shop.example/soil?ref=99")).toBe(
      "https://shop.example/soil"
    );
  });

  it("keeps every other query param", () => {
    expect(
      stripTrackingParam("https://shop.example/soil?utm_source=yt&ref=99&a=1")
    ).toContain("utm_source=yt");
    expect(
      stripTrackingParam("https://shop.example/soil?utm_source=yt&ref=99&a=1")
    ).not.toContain("ref=");
  });

  it("adds a missing scheme so what is stored is what was validated", () => {
    expect(stripTrackingParam("shop.example/soil")).toBe(
      "https://shop.example/soil"
    );
  });

  it("leaves an unparseable value alone for the caller to reject", () => {
    expect(stripTrackingParam("!! not a url")).toBe("!! not a url");
  });

  it("round-trips: strip → build → strip is stable", () => {
    const base = stripTrackingParam("https://shop.example/soil?ref=99");
    const tagged = buildTrackingUrl(base, 183) as string;
    expect(stripTrackingParam(tagged)).toBe(base);
  });
});
