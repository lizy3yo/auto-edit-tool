import { describe, it, expect } from "vitest";
import {
  dimensionsFor,
  buildSilentSceneArgs,
  buildOverlayMuxArgs,
  buildSceneMuxArgs,
  buildConcatCopyArgs,
  buildAudioConcatFilterArgs,
  buildFilmAudioConcatArgs,
  planMasterOverlayScenes,
  sanitizeInsertBoundaries,
  buildMasterOverlayAudioArgs,
  buildFilmRemuxArgs,
  buildAudioSegmentArgs,
  buildSplitScreenArgs,
  buildHostPanelArgs,
  buildBrollPanelArgs,
  splitPanelWidths,
  resolveSplitLayout,
  buildKenBurnsArgs,
  parseSilenceLog,
  isTransientFfmpegError,
  planMusicSchedule,
  buildMusicBedMixArgs,
  MUSIC_BED_DUCK_DB,
} from "./videoAssembly";
import {
  pickMusicBeds,
  musicBedUrl,
  CHANNEL_MUSIC_BEDS,
  DEFAULT_MUSIC_CHANNEL,
} from "./musicBeds";

// pickMusicBeds resolves URLs lazily off R2_PUBLIC_URL and returns [] without it.
process.env.R2_PUBLIC_URL ??= "https://r2.test";

describe("isTransientFfmpegError", () => {
  it("matches host-saturation blips, including spawn EAGAIN", () => {
    expect(
      isTransientFfmpegError(
        "FFmpeg process error: spawn /usr/bin/ffmpeg EAGAIN"
      )
    ).toBe(true);
    expect(isTransientFfmpegError("Resource temporarily unavailable")).toBe(
      true
    );
    expect(isTransientFfmpegError("Error opening encoder for output")).toBe(
      true
    );
    expect(isTransientFfmpegError("Failed to configure output pad")).toBe(true);
  });

  it("does not match data errors", () => {
    expect(isTransientFfmpegError("Download failed: 404")).toBe(false);
    expect(isTransientFfmpegError("no clips")).toBe(false);
  });
});

describe("dimensionsFor", () => {
  it("returns 1920x1080 for landscape and 1080x1920 for portrait", () => {
    expect(dimensionsFor("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsFor("9:16")).toEqual({ width: 1080, height: 1920 });
  });
});

describe("parseSilenceLog", () => {
  it("pairs silence_start/silence_end lines into intervals", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 3.53385",
      "[silencedetect @ 0x1] silence_end: 4.54706 | silence_duration: 1.01321",
      "frame= 100 fps=0.0",
      "[silencedetect @ 0x1] silence_start: 6.85087",
      "[silencedetect @ 0x1] silence_end: 7.25331 | silence_duration: 0.402438",
    ].join("\n");
    expect(parseSilenceLog(stderr)).toEqual([
      { start: 3.53385, end: 4.54706 },
      { start: 6.85087, end: 7.25331 },
    ]);
  });

  it("drops a trailing unpaired silence_start and returns [] for no matches", () => {
    expect(parseSilenceLog("silence_start: 1.5\n(no end)")).toEqual([]);
    expect(parseSilenceLog("nothing here")).toEqual([]);
  });
});

describe("buildSilentSceneArgs (continuous-narration assembly)", () => {
  const args = buildSilentSceneArgs({
    videoPath: "/tmp/clip.mp4",
    outputPath: "/tmp/scene.mp4",
    width: 1280,
    height: 720,
  });

  it("drops all audio (-an) and maps only the filtered video", () => {
    expect(args).toContain("-an");
    expect(args).toContain("[v]");
    expect(args).not.toContain("1:a");
    expect(args).not.toContain("0:a");
  });

  it("normalizes size/fps but keeps the clip's natural length (no -t, no tpad)", () => {
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain(
      "scale=1280:720:force_original_aspect_ratio=increase"
    );
    expect(filter).toContain("crop=1280:720");
    expect(filter).not.toContain("tpad=");
    expect(args).not.toContain("-t");
    expect(args).toContain("libx264");
    expect(args[args.length - 1]).toBe("/tmp/scene.mp4");
  });

  it("trims the clip head when trimLeadSec is set", () => {
    const trimmed = buildSilentSceneArgs({
      videoPath: "/tmp/clip.mp4",
      outputPath: "/tmp/scene.mp4",
      width: 1280,
      height: 720,
      trimLeadSec: 1,
    });
    const filter = trimmed[trimmed.indexOf("-filter_complex") + 1];
    expect(filter).toContain("trim=start=1.000");
    expect(filter.indexOf("trim=start=")).toBeLessThan(
      filter.indexOf("scale=")
    );
  });

  it("caps encoder threads so concurrent scenes don't oversubscribe the host", () => {
    expect(args[args.indexOf("-threads") + 1]).toBe("2");
  });
});

describe("buildSplitScreenArgs (host left half + b-roll right half)", () => {
  const args = buildSplitScreenArgs({
    hostPath: "/tmp/host.mp4",
    rightPath: "/tmp/right.mp4",
    outputPath: "/tmp/split.mp4",
    width: 1280,
    height: 720,
    durationSec: 7.5,
  });

  it("loops the right input and locks output to the host clip's length", () => {
    // -stream_loop -1 must precede the right input so it covers the host length
    expect(args).toContain("-stream_loop");
    const loopIdx = args.indexOf("-stream_loop");
    expect(args[loopIdx + 1]).toBe("-1");
    expect(args[loopIdx + 2]).toBe("-i");
    expect(args[loopIdx + 3]).toBe("/tmp/right.mp4");
    expect(args[args.indexOf("-t") + 1]).toBe("7.500");
  });

  it("gives the b-roll a full-height SQUARE panel and the host the remainder", () => {
    const filter = args[args.indexOf("-filter_complex") + 1];
    // 1280x720 → host 560, b-roll 720x720 (1:1). Not 50/50 — a square slot is what lets the
    // 1:1 still show whole; a 640-wide half would crop its sides off again.
    expect(filter).toContain("crop=560:720");
    expect(filter).toContain("crop=720:720");
    expect(filter).not.toContain("crop=640:720");
    expect(filter).toContain("hstack=inputs=2");
    expect(filter).toContain("drawbox=x=558");
  });

  it("leaves the crop centred when no face position is supplied", () => {
    const filter = args[args.indexOf("-filter_complex") + 1];
    // No x argument at all — ffmpeg's own default centres it, and the arg string stays
    // byte-identical to what shipped before face alignment existed.
    expect(filter).toContain("crop=560:720,setpts");
    expect(filter).not.toContain("in_w*");
  });

  it("pans ONLY the host panel when a face position is supplied", () => {
    const aligned = buildSplitScreenArgs({
      hostPath: "/tmp/host.mp4",
      rightPath: "/tmp/right.mp4",
      outputPath: "/tmp/split.mp4",
      width: 1280,
      height: 720,
      durationSec: 7.5,
      hostFocusX: 0.72,
    });
    const filter = aligned[aligned.indexOf("-filter_complex") + 1];
    expect(filter).toContain(
      "crop=560:720:max(0\\,min(in_w-out_w\\,in_w*0.7200-out_w/2)):0"
    );
    // The right panel is a square slot showing a 1:1 still whole — nothing to pan it to.
    expect(filter).toContain("crop=720:720,setpts");
    expect((filter.match(/in_w\*/g) ?? []).length).toBe(1);
  });

  it("falls back to 50/50 on a portrait canvas (a square panel wouldn't fit)", () => {
    const portrait = buildSplitScreenArgs({
      hostPath: "/tmp/host.mp4",
      rightPath: "/tmp/right.mp4",
      outputPath: "/tmp/split.mp4",
      width: 1080,
      height: 1920,
      durationSec: 3,
    });
    const filter = portrait[portrait.indexOf("-filter_complex") + 1];
    expect(filter).toContain("crop=540:1920");
    expect(filter).toContain("drawbox=x=538");
  });

  it("drops audio and emits the output path last", () => {
    expect(args).toContain("-an");
    expect(args).toContain("libx264");
    expect(args[args.length - 1]).toBe("/tmp/split.mp4");
  });
});

describe("buildHostPanelArgs (crop the host back out of a composite)", () => {
  it("crops exactly the width buildSplitScreenArgs gave the host", () => {
    const { hostW } = splitPanelWidths(1920, 1080);
    expect(hostW).toBe(840);
    const args = buildHostPanelArgs({
      inputPath: "/tmp/split.mp4",
      outputPath: "/tmp/host.mp4",
      width: 1920,
      height: 1080,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain(`crop=${hostW}:1080:0:0`);
    expect(args).toContain("-an");
    expect(args[args.length - 1]).toBe("/tmp/host.mp4");
  });

  it("round-trips: re-compositing an extracted panel keeps the same geometry", () => {
    // The host branch of buildSplitScreenArgs cover-crops to hostW, which is a no-op on an
    // input already exactly hostW wide — so a crop-back panel re-splits pixel-identically.
    const split = buildSplitScreenArgs({
      hostPath: "/tmp/host.mp4",
      rightPath: "/tmp/right.mp4",
      outputPath: "/tmp/split.mp4",
      width: 1920,
      height: 1080,
      durationSec: 5,
    });
    const filter = split[split.indexOf("-filter_complex") + 1];
    expect(filter).toContain("crop=840:1080");
    expect(filter).toContain("crop=1080:1080");
  });

  it("falls back to 50/50 on a portrait canvas, like the composite does", () => {
    expect(splitPanelWidths(1080, 1920)).toEqual({ rightW: 540, hostW: 540 });
  });
});

describe("resolveSplitLayout (manual split geometry)", () => {
  it("reproduces the legacy layout with no layout at all", () => {
    expect(resolveSplitLayout(1920, 1080)).toEqual({
      hostW: 840,
      brollW: 1080,
      hostX: 0,
      brollX: 840,
      hostOnLeft: true,
      leftW: 840,
    });
  });

  it("places the seam at the given fraction, rounded to even pixels", () => {
    const g = resolveSplitLayout(1920, 1080, { seamX: 0.5 });
    expect(g).toMatchObject({ hostW: 960, brollW: 960, leftW: 960 });
    // 0.333 * 1920 = 639.36 → 639 → even 638
    expect(resolveSplitLayout(1920, 1080, { seamX: 0.333 }).hostW).toBe(638);
  });

  it("clamps the seam so neither panel collapses", () => {
    expect(resolveSplitLayout(1920, 1080, { seamX: 0.01 }).hostW).toBe(384);
    expect(resolveSplitLayout(1920, 1080, { seamX: 0.99 }).hostW).toBe(1536);
  });

  it("mirrors the panels on hostSide right — the seam is still measured from the left", () => {
    const g = resolveSplitLayout(1920, 1080, {
      hostSide: "right",
      seamX: 0.5625,
    });
    expect(g).toEqual({
      hostW: 840,
      brollW: 1080,
      hostX: 1080,
      brollX: 0,
      hostOnLeft: false,
      leftW: 1080,
    });
  });
});

describe("buildSplitScreenArgs with a manual layout", () => {
  const base = {
    hostPath: "/tmp/host.mp4",
    rightPath: "/tmp/right.mp4",
    outputPath: "/tmp/split.mp4",
    width: 1920,
    height: 1080,
    durationSec: 5,
  };

  it("stacks b-roll first and moves the divider when the host is on the right", () => {
    const args = buildSplitScreenArgs({
      ...base,
      layout: { hostSide: "right" },
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    // Default widths kept (host 840 / broll 1080), but the broll panel now leads the stack
    // and the divider sits at ITS right edge.
    expect(filter).toContain("[B][H]hstack");
    expect(filter).toContain("drawbox=x=1078");
  });

  it("pans the b-roll panel when it is narrower than its source and a focus is given", () => {
    const args = buildSplitScreenArgs({
      ...base,
      layout: { seamX: 0.7, brollFocusX: 0.8 },
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("crop=1344:1080"); // host: 0.7*1920 even
    expect(filter).toContain(
      "crop=576:1080:max(0\\,min(in_w-out_w\\,in_w*0.8000-out_w/2)):0"
    );
  });

  it("keeps the legacy args byte-compatible when the layout is empty", () => {
    const legacy = buildSplitScreenArgs(base);
    const withEmpty = buildSplitScreenArgs({ ...base, layout: {} });
    expect(withEmpty).toEqual(legacy);
  });
});

describe("buildBrollPanelArgs (crop the b-roll back out of a composite)", () => {
  it("crops exactly the panel buildSplitScreenArgs gave the b-roll", () => {
    const args = buildBrollPanelArgs({
      inputPath: "/tmp/split.mp4",
      outputPath: "/tmp/broll.mp4",
      width: 1920,
      height: 1080,
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("crop=1080:1080:840:0");
  });

  it("follows the rendered layout, mirroring buildHostPanelArgs", () => {
    const layout = { hostSide: "right" as const, seamX: 0.5 };
    const host = buildHostPanelArgs({
      inputPath: "/tmp/split.mp4",
      outputPath: "/tmp/host.mp4",
      width: 1920,
      height: 1080,
      layout,
    });
    const broll = buildBrollPanelArgs({
      inputPath: "/tmp/split.mp4",
      outputPath: "/tmp/broll.mp4",
      width: 1920,
      height: 1080,
      layout,
    });
    expect(host[host.indexOf("-filter_complex") + 1]).toContain(
      "crop=960:1080:960:0"
    );
    expect(broll[broll.indexOf("-filter_complex") + 1]).toContain(
      "crop=960:1080:0:0"
    );
  });
});

describe("buildOverlayMuxArgs (master narration over concatenated clips)", () => {
  const args = buildOverlayMuxArgs({
    listPath: "/tmp/list.txt",
    audioPath: "/tmp/master.mp3",
    outputPath: "/tmp/final.mp4",
    durationSec: 540.25,
  });

  it("concats the clips and maps video + the master narration audio", () => {
    expect(args).toContain("-f");
    expect(args).toContain("concat");
    expect(args).toContain("0:v");
    expect(args).toContain("1:a");
  });

  it("trims the output to the narration duration and re-encodes for accuracy", () => {
    const tIdx = args.indexOf("-t");
    expect(tIdx).toBeGreaterThan(-1);
    expect(args[tIdx + 1]).toBe("540.250");
    expect(args).toContain("libx264");
    expect(args).toContain("aac");
    expect(args[args.length - 1]).toBe("/tmp/final.mp4");
  });
});

describe("buildSceneMuxArgs (per-scene narration locked to audio length)", () => {
  const args = buildSceneMuxArgs({
    videoPath: "/tmp/v.mp4",
    audioPath: "/tmp/a.mp3",
    outputPath: "/tmp/scene.mp4",
    durationSec: 7.5,
  });

  it("clone-pads the video so it never falls short of the audio", () => {
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("tpad=stop_mode=clone");
  });

  it("maps the scene's own audio and trims output to exactly the audio length", () => {
    expect(args).toContain("[v]");
    expect(args).toContain("1:a");
    const tIdx = args.indexOf("-t");
    expect(args[tIdx + 1]).toBe("7.500");
    expect(args).toContain("aac");
    expect(args[args.length - 1]).toBe("/tmp/scene.mp4");
  });
});

describe("buildSceneMuxArgs base scene", () => {
  const base = {
    videoPath: "/tmp/v.mp4",
    audioPath: "/tmp/a.mp3",
    outputPath: "/tmp/scene.mp4",
    durationSec: 7.5,
  };

  it("emits only the tpad chain — never a drawtext caption (regression)", () => {
    const args = buildSceneMuxArgs(base);
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toBe("[0:v]tpad=stop_mode=clone:stop_duration=7.500[v]");
    expect(f).not.toContain("drawtext=");
  });

  it("caps encoder threads so concurrent scenes don't oversubscribe the host", () => {
    const args = buildSceneMuxArgs(base);
    expect(args[args.indexOf("-threads") + 1]).toBe("2");
  });
});

describe("buildSceneMuxArgs QR overlay (CTA scenes)", () => {
  const base = {
    videoPath: "/tmp/v.mp4",
    audioPath: "/tmp/a.mp3",
    outputPath: "/tmp/scene.mp4",
    durationSec: 5,
  };

  it("adds no third input or overlay when no QR is given (regression)", () => {
    const args = buildSceneMuxArgs(base);
    expect(args.filter(a => a === "-i")).toHaveLength(2); // video + audio only
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).not.toContain("overlay=");
  });

  it("adds the QR as a third looped input and overlays a white card bottom-right", () => {
    const args = buildSceneMuxArgs({
      ...base,
      qrOverlay: { imagePath: "/tmp/qr.png", height: 720 },
    });
    // QR is a third (-loop 1 -i) input; audio stays input 1 for the 1:a mapping.
    expect(args).toContain("/tmp/qr.png");
    expect(args.filter(a => a === "-i")).toHaveLength(3);
    const f = args[args.indexOf("-filter_complex") + 1];
    expect(f).toContain("[2:v]");
    expect(f).toContain("color=white"); // padded quiet-zone card
    expect(f).toMatch(/overlay=W-w-\d+:H-h-\d+\[v\]/);
    // Audio + video mapping unchanged.
    const maps = args.reduce<string[]>((acc, a, i) => {
      if (a === "-map") acc.push(args[i + 1]);
      return acc;
    }, []);
    expect(maps).toContain("1:a");
    expect(maps).toContain("[v]");
  });

  it("defaults to the small bottom-right card when placement is omitted", () => {
    const args = buildSceneMuxArgs({
      ...base,
      qrOverlay: { imagePath: "/tmp/qr.png", height: 720 },
    });
    const f = args[args.indexOf("-filter_complex") + 1];
    // height*0.28 = 201.6 → 202 card, centered bottom-right.
    expect(f).toContain("pad=202:202:");
    expect(f).toMatch(/overlay=W-w-\d+:H-h-\d+\[v\]/);
  });

  it("renders a large, dead-centered card when placement is 'center'", () => {
    const args = buildSceneMuxArgs({
      ...base,
      qrOverlay: { imagePath: "/tmp/qr.png", height: 720, placement: "center" },
    });
    const f = args[args.indexOf("-filter_complex") + 1];
    // height*0.66 = 475.2 → 475 card — much larger than the 202 corner card.
    expect(f).toContain("pad=475:475:");
    expect(f).toContain("color=white");
    expect(f).toContain("overlay=(W-w)/2:(H-h)/2[v]");
    expect(f).not.toMatch(/overlay=W-w-\d+/);
  });
});

describe("buildSceneMuxArgs name card (host lower third)", () => {
  const base = {
    videoPath: "/tmp/v.mp4",
    audioPath: "/tmp/a.mp3",
    outputPath: "/tmp/scene.mp4",
    durationSec: 6,
  };
  const card = { imagePath: "/tmp/card.png" };
  const filterOf = (args: string[]) =>
    args[args.indexOf("-filter_complex") + 1];

  it("draws the card static mid-run — no fade, no enable, never drawtext", () => {
    const args = buildSceneMuxArgs({ ...base, nameCard: card });
    expect(args).toContain("/tmp/card.png");
    expect(args.filter(a => a === "-i")).toHaveLength(3); // video + audio + card
    const f = filterOf(args);
    // Full-frame PNG, looped → a bare 0:0 overlay covers frame 0 through the cut.
    expect(f).toContain("[2:v]format=rgba[card]");
    expect(f).toContain("[base][card]overlay=0:0[v]");
    expect(f).not.toContain("fade=");
    expect(f).not.toContain("enable=");
    expect(f).not.toContain("drawtext=");
  });

  it("is identical on a short scene mid-run — timing never gates a static card", () => {
    const f = filterOf(
      buildSceneMuxArgs({ ...base, durationSec: 2.5, nameCard: card })
    );
    expect(f).toBe(
      "[0:v]tpad=stop_mode=clone:stop_duration=2.500[base];" +
        "[2:v]format=rgba[card];[base][card]overlay=0:0[v]"
    );
  });

  it("fades in 0.5s late on the first scene of the run, and only in", () => {
    const f = filterOf(
      buildSceneMuxArgs({ ...base, nameCard: { ...card, fadeIn: true } })
    );
    expect(f).toContain(
      "[2:v]format=rgba,fade=t=in:st=0.500:d=0.5:alpha=1[card]"
    );
    expect(f).not.toContain("t=out");
    expect(f).toContain("[base][card]overlay=0:0[v]");
  });

  it("fades out into the cut on the last scene of the run, and only out", () => {
    const f = filterOf(
      buildSceneMuxArgs({ ...base, nameCard: { ...card, fadeOut: true } })
    );
    // 6s scene → ramp starts at 5.5 and hits zero exactly on the cut.
    expect(f).toContain(
      "[2:v]format=rgba,fade=t=out:st=5.500:d=0.5:alpha=1[card]"
    );
    expect(f).not.toContain("t=in");
  });

  it("carries both fades on a one-scene run", () => {
    const f = filterOf(
      buildSceneMuxArgs({
        ...base,
        nameCard: { ...card, fadeIn: true, fadeOut: true },
      })
    );
    expect(f).toContain(
      "[2:v]format=rgba,fade=t=in:st=0.500:d=0.5:alpha=1," +
        "fade=t=out:st=5.500:d=0.5:alpha=1[card]"
    );
  });

  it("drops the card when the fades leave no readable hold", () => {
    const args = buildSceneMuxArgs({
      ...base,
      durationSec: 2,
      nameCard: { ...card, fadeIn: true, fadeOut: true },
    });
    // 2s − 1.0 lead-in − 0.5 fade-out = 0.5s on screen: a flash, so no card at all.
    expect(args).not.toContain("/tmp/card.png");
    expect(args.filter(a => a === "-i")).toHaveLength(2);
    expect(filterOf(args)).not.toContain("[card]");
  });

  it("chains behind the QR when a scene carries both", () => {
    const args = buildSceneMuxArgs({
      ...base,
      qrOverlay: { imagePath: "/tmp/qr.png", height: 720 },
      nameCard: card,
    });
    expect(args.filter(a => a === "-i")).toHaveLength(4);
    const f = filterOf(args);
    // Distinct inputs: QR is 2 (added first), card is 3.
    expect(f).toContain("[2:v]scale=");
    expect(f).toContain("[3:v]format=rgba");
    // QR composites onto an intermediate label, the card lands on [v].
    expect(f).toMatch(/\[base\]\[qr\]overlay=W-w-\d+:H-h-\d+\[ov0\]/);
    expect(f).toContain("[ov0][card]overlay=0:0[v]");
    const maps = args.reduce<string[]>((acc, a, i) => {
      if (a === "-map") acc.push(args[i + 1]);
      return acc;
    }, []);
    expect(maps).toContain("1:a");
    expect(maps).toContain("[v]");
  });
});

describe("buildKenBurnsArgs (still → pan/zoom clip)", () => {
  const args = buildKenBurnsArgs({
    imagePath: "/tmp/still.png",
    outputPath: "/tmp/kb.mp4",
    width: 1280,
    height: 720,
    durationSec: 6,
    index: 0,
  });

  /** Pull perspective's 8 corner coordinates out of a filter string. */
  const corners = (f: string) => {
    const o = Object.fromEntries(
      [...f.matchAll(/[xy][0-3]=[^:]+/g)].map(m => m[0].split("="))
    );
    return o as Record<string, string>;
  };

  it("loops one still at the target fps, is silent, and trims to the duration", () => {
    // -framerate is load-bearing: without it the image2 default (25) drives perspective's `on`
    // and -r duplicates every 5th frame.
    expect(args.slice(0, 6)).toEqual([
      "-y",
      "-framerate",
      "30",
      "-loop",
      "1",
      "-i",
    ]);
    expect(args).toContain("-an");
    const tIdx = args.indexOf("-t");
    expect(args[tIdx + 1]).toBe("6.000");
    expect(args[args.length - 1]).toBe("/tmp/kb.mp4");
  });

  it("zooms with sub-pixel `perspective`, never `zoompan` (which shakes)", () => {
    const f = args[args.indexOf("-filter_complex") + 1];
    // No pre-upscale: perspective is sub-pixel, so the canvas is the working size.
    expect(f).toContain("scale=1280:720:force_original_aspect_ratio=increase");
    expect(f).toContain("crop=1280:720");
    expect(f).toContain("perspective=");
    expect(f).toContain("interpolation=cubic");
    expect(f).toContain("sense=source");
    expect(f).toContain("eval=frame"); // else the zoom is frozen at frame 0
    expect(f).not.toContain("zoompan");
  });

  it("zooms IN on even scenes and OUT on odd scenes", () => {
    const evenF = args[args.indexOf("-filter_complex") + 1];
    expect(evenF).toContain("(1+0.0800*on/180)"); // starts at 1, grows over 180 frames
    const odd = buildKenBurnsArgs({
      imagePath: "/tmp/s.png",
      outputPath: "/tmp/o.mp4",
      width: 1280,
      height: 720,
      durationSec: 6,
      index: 1,
    });
    const oddF = odd[odd.indexOf("-filter_complex") + 1];
    expect(oddF).toContain("(1.0800-0.0800*on/180)"); // starts at maxZoom, shrinks
  });

  it("is a pure centered zoom — the source rect stays axis-aligned (no skew, no pan)", () => {
    // The failure mode this guards: transpose two corners and the zoom silently becomes a
    // shear. Left/right must share an x, top/bottom must share a y, and the rect must be
    // symmetric about the frame centre.
    const c = corners(args[args.indexOf("-filter_complex") + 1]);
    expect(c.x0).toBe(c.x2); // left edge
    expect(c.x1).toBe(c.x3); // right edge
    expect(c.y0).toBe(c.y1); // top edge
    expect(c.y2).toBe(c.y3); // bottom edge
    const half = "W/(2*(1+0.0800*on/180))";
    expect(c.x0).toBe(`W/2-${half}`);
    expect(c.x1).toBe(`W/2+${half}`);
    expect(c.y0).toBe("H/2-H/(2*(1+0.0800*on/180))");
  });
});

describe("buildKenBurnsArgs cover look (background-removed covers)", () => {
  const args = buildKenBurnsArgs({
    imagePath: "/tmp/cover.png",
    outputPath: "/tmp/cover.mp4",
    width: 1280,
    height: 720,
    durationSec: 6,
    index: 0,
    cover: true,
  });
  const coverF = args[args.indexOf("-filter_complex") + 1];

  it("forces RGBA so an opaque cover gets a synthetic alpha plane (one chain, no branching)", () => {
    expect(coverF).toContain("[0:v]format=rgba,split=2[bg][fg]");
  });

  it("lays the backdrop on a solid base so the frame is opaque whatever the cover's alpha", () => {
    // Without the base, a transparent cover's blurred backdrop stays transparent and the
    // final -pix_fmt yuv420p flattens it to black.
    expect(coverF).toContain("color=c=0x14141A:s=1280x720:r=30[base]");
    expect(coverF).toContain("[base][bge]overlay=(W-w)/2:(H-h)/2");
  });

  it("composites onto the base BEFORE blurring (else alpha smears black into the bloom)", () => {
    // The bug this guards: gblur is non-premultiplied and a background-removed PNG stores black
    // RGB where alpha=0, so blur-then-composite drags black across the bloom as hard dark seams.
    expect(coverF.indexOf("[base][bge]overlay")).toBeLessThan(
      coverF.indexOf(`gblur=sigma=${28}`)
    );
  });

  it("darkens the cover before the base overlay (brightness=-0.28 would crush the base to black)", () => {
    expect(coverF.indexOf("eq=brightness=-0.28")).toBeLessThan(
      coverF.indexOf("[base][bge]")
    );
  });

  it("has no halo — the white card that outlined the canvas rectangle is gone", () => {
    expect(coverF).not.toContain("color=white");
    expect(coverF).not.toContain("[hal]");
    expect(coverF).not.toContain("pad=");
  });

  it("centers the cover at 78% frame height and keeps the Ken Burns zoom", () => {
    expect(coverF).toContain("[fg]scale=-2:562[fgo]"); // round(720 * 0.78)
    expect(coverF).toContain("perspective=");
    expect(coverF).toContain("eval=frame");
    expect(coverF).not.toContain("zoompan");
  });

  it("leaves the non-cover path untouched", () => {
    const plain = buildKenBurnsArgs({
      imagePath: "/tmp/s.png",
      outputPath: "/tmp/o.mp4",
      width: 1280,
      height: 720,
      durationSec: 6,
      index: 0,
    });
    const f = plain[plain.indexOf("-filter_complex") + 1];
    expect(f).not.toContain("format=rgba");
    expect(f).not.toContain("[base]");
  });
});

describe("buildConcatCopyArgs", () => {
  it("concats uniform media via the concat demuxer with stream copy", () => {
    const args = buildConcatCopyArgs({
      listPath: "/tmp/list.txt",
      outputPath: "/tmp/out.mp4",
    });
    expect(args).toContain("concat");
    const cIdx = args.indexOf("-c");
    expect(args[cIdx + 1]).toBe("copy");
    expect(args[args.length - 1]).toBe("/tmp/out.mp4");
  });
});

describe("buildAudioConcatFilterArgs (PCM-domain narration concat)", () => {
  it("joins inputs via the concat filter with one MP3 encode and no stream copy", () => {
    const args = buildAudioConcatFilterArgs({
      inputPaths: ["/tmp/seg-0.mp3", "/tmp/seg-1.mp3"],
      outputPath: "/tmp/master.mp3",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2:v=0:a=1");
    expect(filter).toContain("[0:a]aformat=");
    expect(filter).toContain("[1:a]aformat=");
    expect(args).toContain("libmp3lame");
    // No stream copy — that's the seam-click bug this replaced.
    expect(args).not.toContain("copy");
    expect(args[args.length - 1]).toBe("/tmp/master.mp3");
  });

  it("handles a single input (concat=n=1)", () => {
    const args = buildAudioConcatFilterArgs({
      inputPaths: ["/tmp/only.mp3"],
      outputPath: "/tmp/master.mp3",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=1:v=0:a=1");
  });

  it("does NOT edge-trim silence (a dB trim can chop a quiet final word's tail)", () => {
    const args = buildAudioConcatFilterArgs({
      inputPaths: ["/tmp/seg-0.mp3"],
      outputPath: "/tmp/master.mp3",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    // Whisper word timings give the exact speech extent now — the old −40dB trim ate soft
    // trailing consonants (audible chop) and must never come back.
    expect(filter).not.toContain("silenceremove");
    expect(filter).not.toContain("areverse");
  });
});

describe("buildFilmAudioConcatArgs (seamless per-scene film audio)", () => {
  const args = buildFilmAudioConcatArgs({
    segments: [
      { path: "/tmp/scene-0.mp4", durationSec: 3.2 },
      { path: "/tmp/scene-1.mp4", durationSec: 5 },
    ],
    outputPath: "/tmp/film-audio.m4a",
  });
  const filter = args[args.indexOf("-filter_complex") + 1];

  it("reads each scene MP4 and joins them via the concat filter, one AAC encode, no stream copy", () => {
    expect(args).toContain("/tmp/scene-0.mp4");
    expect(args).toContain("/tmp/scene-1.mp4");
    expect(filter).toContain("concat=n=2:v=0:a=1");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    // No stream copy — rebuilding the audio as one continuous track is what kills the AAC seam click.
    expect(args).not.toContain("copy");
    expect(args[args.length - 1]).toBe("/tmp/film-audio.m4a");
  });

  it("locks each scene's audio to exactly its held length (apad then atrim) so it can't drift", () => {
    // apad pads infinite silence, atrim=end=dur cuts back to the scene's video length — together they
    // force every segment to exactly its hold, keeping the rebuilt track frame-aligned (lip-sync safe).
    expect(filter).toContain(
      "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=end=3.200"
    );
    expect(filter).toContain(
      "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=end=5.000"
    );
  });

  it("does NOT edge-trim silence (that would shift sync)", () => {
    expect(filter).not.toContain("silenceremove");
  });
});

describe("buildFilmRemuxArgs (stream-copy video + rebuilt audio)", () => {
  const args = buildFilmRemuxArgs({
    videoPath: "/tmp/film-video.mp4",
    audioPath: "/tmp/film-audio.m4a",
    outputPath: "/tmp/final.mp4",
  });

  it("maps video from input 0 and audio from input 1, copying both (no re-encode)", () => {
    expect(args.indexOf("/tmp/film-video.mp4")).toBeLessThan(
      args.indexOf("/tmp/film-audio.m4a")
    );
    const maps = args.filter((_, i) => args[i - 1] === "-map");
    expect(maps).toEqual(["0:v", "1:a"]);
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
    expect(args[args.length - 1]).toBe("/tmp/final.mp4");
  });
});

describe("buildAudioSegmentArgs", () => {
  it("extracts a re-encoded MP3 segment at the given offset and length", () => {
    const args = buildAudioSegmentArgs({
      inputPath: "/tmp/src.mp3",
      outputPath: "/tmp/chunk-0.mp3",
      startSec: 14,
      lenSec: 10,
    });
    const ss = args.indexOf("-ss");
    expect(args[ss + 1]).toBe("14.000");
    const t = args.indexOf("-t");
    expect(args[t + 1]).toBe("10.000");
    // -ss/-t precede -i so the seek applies to the input.
    expect(ss).toBeLessThan(args.indexOf("-i"));
    expect(t).toBeLessThan(args.indexOf("-i"));
    expect(args).toContain("libmp3lame");
    expect(args[args.length - 1]).toBe("/tmp/chunk-0.mp3");
    // 12ms edge fades so a slice cut against speech (fused words, no gap) never clicks.
    const af = args.indexOf("-af");
    expect(args[af + 1]).toBe(
      "afade=t=in:st=0:d=0.012,afade=t=out:st=9.988:d=0.012"
    );
  });

  it("halves the fade instead of exceeding a very short slice", () => {
    const args = buildAudioSegmentArgs({
      inputPath: "/tmp/src.mp3",
      outputPath: "/tmp/chunk-1.mp3",
      startSec: 0,
      lenSec: 0.02,
    });
    const af = args.indexOf("-af");
    expect(args[af + 1]).toBe(
      "afade=t=in:st=0:d=0.010,afade=t=out:st=0.010:d=0.010"
    );
  });
});

describe("planMasterOverlayScenes (master-timeline frame plan)", () => {
  it("keeps every scene start within half a frame of the master timeline (carry never accumulates)", () => {
    // Pseudo-random but deterministic slice lengths — the property that matters over a long
    // film is |framesCum/fps − idealCum| ≤ 0.5/fps at EVERY boundary.
    const fps = 30;
    const scenes: { sliceStartSec: number; sliceEndSec: number }[] = [];
    let t = 0;
    for (let i = 0; i < 200; i++) {
      const len = 3 + ((i * 2654435761) % 5000) / 1000; // 3.000–7.999s
      scenes.push({ sliceStartSec: t, sliceEndSec: t + len });
      t += len;
    }
    const plan = planMasterOverlayScenes({ scenes, fps });
    let idealCum = 0;
    let framesCum = 0;
    for (let i = 0; i < scenes.length; i++) {
      idealCum += scenes[i].sliceEndSec - scenes[i].sliceStartSec;
      framesCum += plan.scenes[i].frames;
      expect(Math.abs(framesCum / fps - idealCum)).toBeLessThanOrEqual(
        0.5 / fps + 1e-9
      );
    }
    expect(plan.totalSec).toBeCloseTo(framesCum / fps, 9);
    expect(plan.inserts).toEqual([]);
  });

  it("turns hold-floor pads and qrTail holds into silence inserts at the slice end", () => {
    const plan = planMasterOverlayScenes({
      scenes: [
        { sliceStartSec: 0, sliceEndSec: 1.2, holdSec: 3 }, // sub-floor scene held to 3s
        { sliceStartSec: 1.2, sliceEndSec: 6.2 }, // plain scene, no insert
        { sliceStartSec: 6.2, sliceEndSec: 10, tailHoldSec: 3 }, // QR release beat
      ],
    });
    expect(plan.inserts).toEqual([
      { atSec: 1.2, durSec: 1.8 },
      { atSec: 10, durSec: 3 },
    ]);
    // Scene lengths on the film timeline include the held extra.
    expect(plan.scenes[0].frames / 30).toBeCloseTo(3, 1);
    expect(plan.totalSec).toBeCloseTo(3 + 5 + 3.8 + 3, 1);
  });

  it("a coverHero-style scene (no holdSec) ends exactly with its slice — no insert", () => {
    const plan = planMasterOverlayScenes({
      scenes: [{ sliceStartSec: 0, sliceEndSec: 4.5 }],
    });
    expect(plan.inserts).toEqual([]);
    expect(plan.scenes[0].frames).toBe(135);
  });

  it("uses the half-frame midpoint for the mux -t so the encode emits exactly `frames` frames", () => {
    const plan = planMasterOverlayScenes({
      scenes: [{ sliceStartSec: 0, sliceEndSec: 4.5 }],
    });
    expect(plan.scenes[0].muxDurationSec).toBeCloseTo((135 - 0.5) / 30, 9);
  });

  it("clamps a degenerate zero-length slice to one frame", () => {
    const plan = planMasterOverlayScenes({
      scenes: [
        { sliceStartSec: 0, sliceEndSec: 5 },
        { sliceStartSec: 5, sliceEndSec: 5 },
      ],
    });
    expect(plan.scenes[1].frames).toBe(1);
  });
});

describe("buildMasterOverlayAudioArgs (untouched master over the whole film)", () => {
  it("with no inserts just pads/trims the master to the film length, one AAC encode", () => {
    const args = buildMasterOverlayAudioArgs({
      masterPath: "/tmp/master.mp3",
      inserts: [],
      totalSec: 991.2,
      outputPath: "/tmp/film-audio.m4a",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("apad,atrim=end=991.200[a]");
    expect(filter).not.toContain("asplit");
    expect(filter).not.toContain("anullsrc");
    expect(filter).not.toContain("afade"); // no seams → no fades
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args).not.toContain("copy");
    expect(args[args.length - 1]).toBe("/tmp/film-audio.m4a");
  });

  it("splits the master at each insert point and interleaves exactly-sized silences", () => {
    const args = buildMasterOverlayAudioArgs({
      masterPath: "/tmp/master.mp3",
      inserts: [
        { atSec: 10, durSec: 1.8 },
        { atSec: 25.5, durSec: 3 },
      ],
      totalSec: 40,
      outputPath: "/tmp/film-audio.m4a",
    });
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("asplit=3[c0][c1][c2]");
    // Every seam carries a sub-audible fade: out before each insert, in after it.
    expect(filter).toContain(
      "[c0]atrim=end=10.000,asetpts=PTS-STARTPTS," +
        "afade=t=out:st=9.985:d=0.015[p0]"
    );
    expect(filter).toContain(
      "[c1]atrim=start=10.000:end=25.500,asetpts=PTS-STARTPTS," +
        "afade=t=in:st=0:d=0.015,afade=t=out:st=15.485:d=0.015[p1]"
    );
    expect(filter).toContain(
      "[c2]atrim=start=25.500,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.015[p2]"
    );
    expect(filter).toContain("atrim=end=1.800[g1]");
    expect(filter).toContain("atrim=end=3.000[g2]");
    expect(filter).toContain(
      "[p0][g1][p1][g2][p2]concat=n=5:v=0:a=1,apad,atrim=end=40.000[a]"
    );
    // The whole point: the master's speech is never cut or re-concatenated per scene.
    expect(filter).not.toContain("silenceremove");
  });
});

describe("sanitizeInsertBoundaries (insert cuts must never land on speech)", () => {
  // A sub-floor scene (holdSec 3 > slice) whose end is the insert cut under test, followed
  // by a plain neighbor. `t` is the boundary between them.
  const held = (start: number, end: number) => ({
    sliceStartSec: start,
    sliceEndSec: end,
    holdSec: 3,
  });
  const plain = (start: number, end: number) => ({
    sliceStartSec: start,
    sliceEndSec: end,
  });

  it("leaves a boundary alone when a detected silence runs right up to the cut", () => {
    const scenes = [held(0, 2.3), plain(2.3, 8)];
    const moves = sanitizeInsertBoundaries(scenes, [{ start: 2.1, end: 2.3 }]);
    expect(moves).toEqual([]);
    expect(scenes[0].sliceEndSec).toBe(2.3);
  });

  it("a boundary snapped to the center of a minimal 0.12s silence stays clean", () => {
    // The alignment snap pass places cuts at silence centers (0.06s lead) — must pass.
    const scenes = [held(0, 2.3), plain(2.3, 8)];
    const moves = sanitizeInsertBoundaries(scenes, [
      { start: 2.24, end: 2.36 },
    ]);
    expect(moves).toEqual([]);
  });

  it("an onset cut right after a short gap counts as clean and is not relocated", () => {
    // Healthy next-word-onset cuts often follow gaps far below the alignment's 0.12s
    // pause threshold; the short-gap scan sees them and the boundary must stay put.
    const scenes = [held(0, 2.3), plain(2.3, 8)];
    const moves = sanitizeInsertBoundaries(scenes, [
      { start: 2.22, end: 2.3 }, // 80ms gap ends exactly at the cut
      { start: 4.0, end: 4.5 }, // a bigger pause exists elsewhere — irrelevant
    ]);
    expect(moves).toEqual([]);
    expect(scenes[0].sliceEndSec).toBe(2.3);
  });

  it("moves a dirty cut to the nearest gap's end minus the lead, updating both neighbors", () => {
    const scenes = [held(0, 2.3), plain(2.3, 8)];
    const moves = sanitizeInsertBoundaries(scenes, [
      { start: 1.6, end: 2.1 }, // nothing quiet at the cut itself — speech there
    ]);
    expect(moves).toHaveLength(1);
    expect(moves[0].boundary).toBe(0);
    expect(moves[0].fromSec).toBe(2.3);
    expect(moves[0].toSec).toBeCloseTo(2.06, 9);
    expect(scenes[0].sliceEndSec).toBe(moves[0].toSec);
    expect(scenes[1].sliceStartSec).toBe(moves[0].toSec);
  });

  it("ignores sub-gap quiet blips as move targets (plosive closures aren't pauses)", () => {
    const scenes = [held(0, 2.3), plain(2.3, 8)];
    const moves = sanitizeInsertBoundaries(scenes, [
      { start: 2.0, end: 2.05 }, // 50ms blip — below INSERT_MIN_GAP_SEC
    ]);
    expect(moves).toEqual([]);
    expect(scenes[0].sliceEndSec).toBe(2.3);
  });

  it("leaves a dirty cut alone when no gap lies within the snap tolerance", () => {
    const scenes = [held(0, 2.3), plain(2.3, 8)];
    const moves = sanitizeInsertBoundaries(scenes, [
      { start: 4.0, end: 4.5 }, // 2.16s away — too far
    ]);
    expect(moves).toEqual([]);
    expect(scenes[0].sliceEndSec).toBe(2.3);
  });

  it("never touches a boundary that gets no insert, even if dirty", () => {
    const scenes = [plain(0, 5), plain(5, 8)]; // no holdSec/tailHoldSec → no insert
    const moves = sanitizeInsertBoundaries(scenes, [{ start: 4.5, end: 4.9 }]);
    expect(moves).toEqual([]);
    expect(scenes[0].sliceEndSec).toBe(5);
  });

  it("never moves the final scene's end (the master-duration guard reads it)", () => {
    const scenes = [
      plain(0, 5),
      { sliceStartSec: 5, sliceEndSec: 8, tailHoldSec: 3 }, // qrTail as last scene
    ];
    const moves = sanitizeInsertBoundaries(scenes, [{ start: 7.4, end: 7.9 }]);
    expect(moves).toEqual([]);
    expect(scenes[1].sliceEndSec).toBe(8);
  });

  it("rejects a move that would shrink a neighbor below the slice floor", () => {
    const scenes = [held(0, 2.3), plain(2.3, 2.45)]; // tiny neighbor
    const moves = sanitizeInsertBoundaries(scenes, [
      { start: 2.3, end: 2.5 }, // toSec 2.46 would leave scene 1 near-zero-length
    ]);
    expect(moves).toEqual([]);
    expect(scenes[0].sliceEndSec).toBe(2.3);
  });

  it("keeps ranges contiguous across multiple moves and re-plans inserts at the new cuts", () => {
    const scenes = [held(0, 2.3), held(2.3, 4.6), plain(4.6, 10)];
    sanitizeInsertBoundaries(scenes, [
      { start: 1.7, end: 2.2 },
      { start: 4.0, end: 4.5 },
    ]);
    for (let i = 0; i < scenes.length - 1; i++) {
      expect(scenes[i].sliceEndSec).toBe(scenes[i + 1].sliceStartSec);
      expect(scenes[i].sliceEndSec - scenes[i].sliceStartSec).toBeGreaterThan(
        0.1 - 1e-9
      );
    }
    const plan = planMasterOverlayScenes({ scenes });
    expect(plan.inserts).toHaveLength(2);
    expect(plan.inserts[0].atSec).toBeCloseTo(2.16, 9);
    expect(plan.inserts[1].atSec).toBeCloseTo(4.46, 9);
    // Last slice end untouched — the film still tiles out to the master's end.
    expect(scenes[2].sliceEndSec).toBe(10);
  });
});

describe("buildConcatCopyArgs videoOnly (master-overlay video join)", () => {
  it("maps only the video stream so per-scene AAC never reaches the joined film", () => {
    const args = buildConcatCopyArgs({
      listPath: "/tmp/list.txt",
      outputPath: "/tmp/film-video.mp4",
      videoOnly: true,
    });
    const maps = args.filter((_, i) => args[i - 1] === "-map");
    expect(maps).toEqual(["0:v"]);
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
  });

  it("keeps the legacy behavior (no -map) when videoOnly is absent", () => {
    const args = buildConcatCopyArgs({
      listPath: "/tmp/list.txt",
      outputPath: "/tmp/out.mp4",
    });
    expect(args).not.toContain("-map");
  });
});

describe("planMusicSchedule (music/silence pattern under the narration)", () => {
  it("lays 30s intro, then 2min music / 30s silence, each block a new bed", () => {
    const blocks = planMusicSchedule(12 * 60);
    expect(blocks.slice(0, 4)).toEqual([
      { startSec: 0, durSec: 30, bedIndex: 0 },
      { startSec: 60, durSec: 120, bedIndex: 1 },
      { startSec: 210, durSec: 120, bedIndex: 2 },
      { startSec: 360, durSec: 120, bedIndex: 3 },
    ]);
    // Every block gets its own bed — music never returns on the same beat it left.
    expect(new Set(blocks.map(b => b.bedIndex)).size).toBe(blocks.length);
  });

  it("leaves a 30s silence between every pair of music blocks", () => {
    const blocks = planMusicSchedule(20 * 60);
    for (let i = 1; i < blocks.length; i++) {
      const prevEnd = blocks[i - 1].startSec + blocks[i - 1].durSec;
      expect(blocks[i].startSec - prevEnd).toBe(30);
    }
  });

  it("trims the trailing block to the film and drops a sliver", () => {
    // Ends mid-block: 210 + 40 → trimmed to 40s, not overrunning the film.
    expect(planMusicSchedule(250).at(-1)).toEqual({
      startSec: 210,
      durSec: 40,
      bedIndex: 2,
    });
    // A 3s remainder would read as a mistake — dropped, so the film ends on silence.
    const short = planMusicSchedule(213);
    expect(short.map(b => b.startSec)).toEqual([0, 60]);
  });

  it("handles films shorter than one block", () => {
    expect(planMusicSchedule(20)).toEqual([
      { startSec: 0, durSec: 20, bedIndex: 0 },
    ]);
    expect(planMusicSchedule(5)).toEqual([]); // below the sliver floor
  });

  it("supplies a bed for every block of a 30-minute film", () => {
    const blocks = planMusicSchedule(30 * 60);
    const beds = pickMusicBeds(blocks.length, "job-123", "garrys_lawn");
    expect(beds).toHaveLength(blocks.length);
    // With one bed per channel every block IS the same track — variety comes entirely from the
    // per-reuse offset, which the buildMusicBedMixArgs tests below cover.
    expect(new Set(beds)).toEqual(
      new Set(CHANNEL_MUSIC_BEDS.garrys_lawn.map(musicBedUrl))
    );
  });
});

describe("pickMusicBeds", () => {
  const CHANNELS = Object.keys(CHANNEL_MUSIC_BEDS);

  it("every channel has a usable set", () => {
    for (const c of CHANNELS)
      expect(CHANNEL_MUSIC_BEDS[c].length).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic per job — a retried assembly rebuilds the same soundtrack", () => {
    expect(pickMusicBeds(5, "job-a", "garrys_lawn")).toEqual(
      pickMusicBeds(5, "job-a", "garrys_lawn")
    );
    // No "job-a ≠ job-b" assertion: a one-bed pool has exactly one shuffle, so the seed can't
    // change the result. Restore it if a channel ever gets a second bed.
  });

  it("draws only from the requested channel's set", () => {
    for (const c of CHANNELS) {
      const beds = pickMusicBeds(5, "job-a", c);
      const urls = CHANNEL_MUSIC_BEDS[c].map(musicBedUrl);
      expect(beds.every(u => urls.includes(u))).toBe(true);
    }
    // Different personas, different music — that is the whole point of the split.
    expect(pickMusicBeds(5, "job-a", "garrys_lawn")).not.toEqual(
      pickMusicBeds(5, "job-a", "donna_larsen")
    );
  });

  it("falls back to the default channel for an unknown or missing key", () => {
    const fallback = pickMusicBeds(5, "job-a", DEFAULT_MUSIC_CHANNEL);
    // Any channel without a set of its own lands here.
    expect(pickMusicBeds(5, "job-a", "demo")).toEqual(fallback);
    expect(pickMusicBeds(5, "job-a", "nope")).toEqual(fallback);
    expect(pickMusicBeds(5, "job-a")).toEqual(fallback);
  });

  it("wraps when more blocks than beds are requested", () => {
    const pool = CHANNEL_MUSIC_BEDS.garrys_lawn.map(musicBedUrl);
    const beds = pickMusicBeds(pool.length + 3, "job-a", "garrys_lawn");
    expect(beds).toHaveLength(pool.length + 3);
    expect(beds.every(u => pool.includes(u))).toBe(true);
  });

  it("builds URLs from R2_PUBLIC_URL and degrades to [] without it", () => {
    const saved = process.env.R2_PUBLIC_URL;
    try {
      process.env.R2_PUBLIC_URL = "https://media.example.com/";
      expect(pickMusicBeds(1, "job-a", "garrys_lawn")[0]).toMatch(
        /^https:\/\/media\.example\.com\/music\/beds\/garrys_lawn\/bed-0[12]\.mp3$/
      );
      delete process.env.R2_PUBLIC_URL;
      expect(pickMusicBeds(5, "job-a", "garrys_lawn")).toEqual([]);
    } finally {
      process.env.R2_PUBLIC_URL = saved;
    }
  });
});

describe("buildMusicBedMixArgs (calm bed under the narration)", () => {
  const blocks = planMusicSchedule(250);
  const args = buildMusicBedMixArgs({
    narrationPath: "/tmp/film-audio.m4a",
    bedPaths: blocks.map((_, i) => `/tmp/bed-${i}.mp3`),
    blocks,
    narrationLufs: -16,
    outputPath: "/tmp/out.m4a",
  });
  const filter = args[args.indexOf("-filter_complex") + 1];

  it("takes the narration first, then one input per music block", () => {
    expect(args.slice(0, 3)).toEqual(["-y", "-i", "/tmp/film-audio.m4a"]);
    expect(args.filter(a => a === "-i")).toHaveLength(blocks.length + 1);
  });

  it("keeps amix from halving the narration (normalize=0)", () => {
    expect(filter).toContain(
      "[0:a][mus]amix=inputs=2:duration=first:normalize=0[a]"
    );
  });

  it("targets the bed at the measured narration loudness + the duck", () => {
    // Pin the WCAG 1.4.7 invariant, not the tuning: background must sit AT LEAST 20 dB under
    // the speech it plays behind. The exact value is an ear call (-20 → -22 so far); what must
    // never happen is someone raising the bed above the accessibility floor.
    expect(MUSIC_BED_DUCK_DB).toBeLessThanOrEqual(-20);
    expect(filter).toContain(`loudnorm=I=${-16 + MUSIC_BED_DUCK_DB}.0`);
  });

  it("carves the consonant band so music never masks speech", () => {
    expect(filter).toContain("equalizer=f=3000:width_type=o:width=1.5:g=-6");
  });

  it("fills the gaps with silence and fades every block edge", () => {
    // 3 music blocks + the 2 silences between them.
    expect(filter).toContain("concat=n=5:v=0:a=1");
    expect(filter).toContain("anullsrc=r=48000:cl=stereo");
    expect((filter.match(/afade=t=in/g) ?? []).length).toBe(blocks.length);
    expect((filter.match(/afade=t=out/g) ?? []).length).toBe(blocks.length);
  });

  it("starts every block at the head of its bed when no offsets are given", () => {
    expect((filter.match(/atrim=start=0\.000:/g) ?? []).length).toBe(
      blocks.length
    );
  });

  it("offsets a repeated bed so it plays a different passage", () => {
    const offsets = blocks.map((_, i) => i * 20);
    const withOffsets = buildMusicBedMixArgs({
      narrationPath: "/tmp/film-audio.m4a",
      bedPaths: blocks.map(() => "/tmp/bed-0.mp3"), // one bed, reused for every block
      bedOffsets: offsets,
      blocks,
      narrationLufs: -16,
      outputPath: "/tmp/out.m4a",
    });
    const f = withOffsets[withOffsets.indexOf("-filter_complex") + 1];
    const starts = [...f.matchAll(/atrim=start=([\d.]+):end=([\d.]+)/g)];
    expect(starts).toHaveLength(blocks.length);
    // Distinct start points, and each window is exactly the block's length.
    expect(new Set(starts.map(m => m[1])).size).toBe(blocks.length);
    starts.forEach((m, i) => {
      expect(Number(m[1])).toBeCloseTo(offsets[i], 3);
      expect(Number(m[2]) - Number(m[1])).toBeCloseTo(blocks[i].durSec, 3);
    });
  });
});

describe("buildSceneMuxArgs caption (asset beats)", () => {
  const base = {
    videoPath: "/tmp/v.mp4",
    audioPath: "/tmp/a.mp3",
    outputPath: "/tmp/scene.mp4",
    durationSec: 6,
  };
  const caption = { imagePath: "/tmp/cap.png" };
  const qr = { imagePath: "/tmp/qr.png", height: 1080 };
  const card = { imagePath: "/tmp/card.png" };
  const filterOf = (args: string[]) =>
    args[args.indexOf("-filter_complex") + 1];

  it("adds no input or overlay when no caption is given (regression)", () => {
    const args = buildSceneMuxArgs(base);
    expect(args.filter(a => a === "-i")).toHaveLength(2);
    expect(filterOf(args)).not.toContain("[cap]");
  });

  it("composites a full-frame caption at 0:0, static and never drawtext", () => {
    const args = buildSceneMuxArgs({ ...base, caption });
    expect(args).toContain("/tmp/cap.png");
    expect(args.filter(a => a === "-i")).toHaveLength(3);
    const f = filterOf(args);
    expect(f).toContain("[2:v]format=rgba[cap]");
    expect(f).toContain("[base][cap]overlay=0:0[v]");
    expect(f).not.toContain("fade=");
    expect(f).not.toContain("drawtext=");
  });

  it("indexes its input correctly alongside a QR — an asset beat carries both", () => {
    const args = buildSceneMuxArgs({ ...base, qrOverlay: qr, caption });
    expect(args.filter(a => a === "-i")).toHaveLength(4);
    const f = filterOf(args);
    expect(f).toContain("[2:v]scale="); // QR is input 2
    expect(f).toContain("[3:v]format=rgba[cap]"); // caption is input 3
    // Caption composites LAST, so it is never hidden under the QR card.
    expect(f.indexOf("[qr]overlay")).toBeLessThan(f.indexOf("[cap]overlay"));
    expect(f).toContain("[cap]overlay=0:0[v]");
  });

  it("indexes correctly with a QR AND a name card, and draws on top of both", () => {
    const args = buildSceneMuxArgs({
      ...base,
      qrOverlay: qr,
      nameCard: card,
      caption,
    });
    expect(args.filter(a => a === "-i")).toHaveLength(5);
    const f = filterOf(args);
    expect(f).toContain("[4:v]format=rgba[cap]");
    expect(f.indexOf("[card]overlay")).toBeLessThan(f.indexOf("[cap]overlay"));
    expect(f).toContain("[cap]overlay=0:0[v]");
  });

  it("indexes correctly with only a name card beside it", () => {
    const args = buildSceneMuxArgs({ ...base, nameCard: card, caption });
    expect(args.filter(a => a === "-i")).toHaveLength(4);
    const f = filterOf(args);
    expect(f).toContain("[2:v]format=rgba[card]");
    expect(f).toContain("[3:v]format=rgba[cap]");
  });
});
