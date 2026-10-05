import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import {
  isPassThroughPath,
  shouldCompress,
  staticCacheControl,
} from "./httpDelivery";

const req = (originalUrl: string) =>
  ({ originalUrl, headers: {} }) as unknown as Request;
const res = (contentType: string) =>
  ({ getHeader: () => contentType }) as unknown as Response;

describe("shouldCompress", () => {
  it("compresses API answers and the page's own files", () => {
    expect(
      shouldCompress(req("/api/trpc/x?batch=1"), res("application/json"))
    ).toBe(true);
    expect(
      shouldCompress(req("/assets/index-abc12345.js"), res("text/javascript"))
    ).toBe(true);
  });

  it("never touches a download, an upload or a thumbnail, whatever their type", () => {
    // The download proxy forwards Content-Length so a broken transfer fails visibly;
    // compression would drop that header.
    for (const path of [
      "/api/download?url=x",
      "/api/download",
      "/api/narration-upload/abc/part/3",
      "/api/thumb?url=x",
    ])
      expect(shouldCompress(req(path), res("application/json"))).toBe(false);
  });

  it("leaves media alone on any route", () => {
    expect(shouldCompress(req("/clip.mp4"), res("video/mp4"))).toBe(false);
    expect(shouldCompress(req("/a.webp"), res("image/webp"))).toBe(false);
  });

  it("matches whole path segments only", () => {
    expect(isPassThroughPath("/api/downloads-report")).toBe(false);
    expect(isPassThroughPath("/api/download/x")).toBe(true);
  });
});

describe("staticCacheControl", () => {
  it("keeps content-hashed build files for a year", () => {
    for (const f of [
      "/app/dist/public/assets/index-Dmxouzhy.js",
      "C:\\app\\dist\\public\\assets\\vendor-eQ6T6G2l.css",
      "/app/dist/public/assets/AdminPage-B_x9-a1Q.js",
    ])
      expect(staticCacheControl(f)).toContain("immutable");
  });

  it("re-checks everything else, so a deploy shows at once", () => {
    for (const f of [
      "/app/dist/public/index.html",
      "/app/dist/public/favicon.ico",
      "/app/dist/public/assets/logo.png",
    ])
      expect(staticCacheControl(f)).toBe("no-cache");
  });
});
