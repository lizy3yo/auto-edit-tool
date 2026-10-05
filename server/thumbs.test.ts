import { describe, expect, it } from "vitest";
import { isVideoUrl, parseThumbRequest, thumbKey } from "./thumbs";
import { lightVideoArgs, lightVideoKey, wantsLightVideo } from "./lightVideo";

const ours = (url: string) => url.startsWith("https://pub-x.r2.dev/");
const clip = "https://pub-x.r2.dev/longform/12/clip-3-abc.mp4";

describe("parseThumbRequest", () => {
  it("serves a stored clip or picture at one of the fixed widths", () => {
    expect(parseThumbRequest({ url: clip, w: "320", t: "1.26" }, ours)).toEqual(
      {
        url: clip,
        w: 320,
        t: 1.3,
      }
    );
    // Rounded UP to a served width, so a tile is never upscaled.
    expect(parseThumbRequest({ url: clip, w: "200" }, ours)).toMatchObject({
      w: 320,
      t: 0,
    });
    expect(parseThumbRequest({ url: clip, w: "5000" }, ours)).toMatchObject({
      w: 640,
    });
    expect(parseThumbRequest({ url: clip }, ours)).toMatchObject({ w: 320 });
  });

  it("refuses anything that is not one of our stored files", () => {
    // The route fetches the URL server-side: an open one would be a proxy into the network.
    for (const url of [
      "https://evil.example/x.png",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
    ])
      expect(parseThumbRequest({ url, w: "320" }, ours)).toMatchObject({
        status: 403,
      });
    expect(parseThumbRequest({}, ours)).toMatchObject({ status: 400 });
  });

  it("refuses audio — there is no picture in it", () => {
    expect(
      parseThumbRequest({ url: "https://pub-x.r2.dev/a/master.mp3" }, ours)
    ).toMatchObject({ status: 400 });
  });
});

describe("thumbKey", () => {
  it("is the same for the same picture and different for any other", () => {
    const a = { url: clip, w: 320 as const, t: 0 };
    expect(thumbKey(a)).toBe(thumbKey({ ...a }));
    expect(thumbKey(a)).toMatch(/^thumbs\/[0-9a-f]{2}\/[0-9a-f]{40}\.webp$/);
    for (const other of [
      { ...a, w: 640 as const },
      { ...a, t: 1.5 },
      { ...a, url: `${clip}?v=2` },
    ])
      expect(thumbKey(other)).not.toBe(thumbKey(a));
  });

  it("knows a clip from a picture by its name", () => {
    expect(isVideoUrl(clip)).toBe(true);
    expect(isVideoUrl("https://pub-x.r2.dev/host/photo.png")).toBe(false);
  });
});

describe("the light copy of a film", () => {
  const film = "https://pub-x.r2.dev/longform/12/final-Ab3_x-9Z.mp4";

  it("is made for a finished film in our bucket and nothing else", () => {
    expect(wantsLightVideo(film, ours)).toBe(true);
    // A scene clip: 200 of those per film would bury the server in encodes.
    expect(wantsLightVideo(clip, ours)).toBe(false);
    expect(
      wantsLightVideo("https://evil.example/longform/1/final-aaaa.mp4", ours)
    ).toBe(false);
  });

  it("has a key of its own per final file, so a Reassemble gets a new one", () => {
    expect(lightVideoKey(film)).toMatch(
      /^previews\/[0-9a-f]{2}\/[0-9a-f]{40}-480p\.mp4$/
    );
    expect(lightVideoKey(film)).not.toBe(
      lightVideoKey(film.replace("Ab3_x-9Z", "Qq1_y-8Y"))
    );
  });

  it("is 480p, starts before it has finished downloading, and never names the film's own file as output", () => {
    const args = lightVideoArgs("in.mp4", "out.mp4");
    expect(args).toContain("scale=-2:480");
    expect(args[args.indexOf("-movflags") + 1]).toBe("+faststart");
    expect(args[args.length - 1]).toBe("out.mp4");
  });
});
