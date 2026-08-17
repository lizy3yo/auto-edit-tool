import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import sharp from "sharp";
import {
  clipDurationParam,
  narrationWordBudget,
  parseStoryboard,
  buildUnifiedStoryboardPrompt,
  buildClipRequest,
  buildClipChain,
  isBrollChain,
  clipTrimFor,
  clipsNeededFor,
  splitOverlongScenes,
  segmentScriptByDuration,
  splitUnitIntoClauses,
  LONG_WORDS,
  LONG_SCENE_MAX_SEC,
  longWordsFor,
  floorWordsFor,
  brollClipDuration,
  syncSceneClipFields,
  generateValidatedStill,
  recognizeVoiceWps,
  wpsForVoice,
  WORDS_PER_SEC,
  describeIncompleteScenes,
  describeOverlongScenes,
  BROLL_CLIP_MAX_SEC,
  withTransientRetry,
  stillRetryDelayMs,
  PendingRenderError,
  splitScriptForNarration,
  splitIntoUnits,
  groupUnitsForFallback,
  repairPartition,
  rebalanceHostScreenTime,
  enforceStillMotionRatio,
  enforceHostSplitMix,
  enforceVisualAdjacency,
  runtimeQuarters,
  HOST_RAMP,
  MOTION_RAMP,
  RAMP_MIN_SCENES,
  STILL_IMAGE_FRACTION,
  HOST_SPLITVISUAL_FRACTION,
  markCtaScenes,
  markQrBeforeCover,
  markCornerQrBeforeCover,
  CORNER_QR_SCENES_BEFORE_COVER,
  qrOverlayUrlFor,
  nameCardSceneIndices,
  ensureHostInCta,
  markCoverReveal,
  markCtaQrBlock,
  parseCtaMarkers,
  validateCtaMarkers,
  markCtaFromSpans,
  anchorRegex,
  mentionsTitle,
  titleMatcher,
  coalesceShortScenes,
  WORD_SIZE,
  FLOOR_WORDS,
  applySceneHoldFloor,
  SCENE_MIN_HOLD_SEC,
  HOST_MIN_HOLD_SEC,
  ctaSignalInText,
  ctaVisualIsLiteral,
  genericCtaBrollFor,
  sanitizeCtaCutaway,
  brollDepictsBook,
  enhanceBrollPrompts,
  demoteAllHostsToBroll,
  forceAllBrollMotion,
  HOST_SCREEN_FRACTION,
  talkingHeadClipCount,
  talkingHeadVisualPrompt,
  FIXED_CLIP_LEN,
  TALKING_HEAD_BACKGROUND,
  AMATEUR_IPHONE_LOOK,
  AMATEUR_IPHONE_LOOK_PERSON,
  AMATEUR_IPHONE_LOOK_OBJECT,
  AMATEUR_IPHONE_LOOK_OBJECT_STILL,
  CAMERA_LOCK_CLAUSE,
  PERSON_MOTION_CAMERA_CLAUSE,
  OBJECT_MOTION_CAMERA_CLAUSE,
  STILL_OBJECT_MOTION_CLAUSE,
  amateurIphoneLook,
  EDIT_VIDEO_BROLL_ENHANCER_SYSTEM,
  STILL_BROLL_ENHANCER_SYSTEM,
  buildStillPrompt,
  assembleScenePromptPreview,
  normalizeKeyframeToLandscape,
  softenVisualPrompt,
  stripAtmosphericWisps,
  stripPromptArtifacts,
  normalizeVideoSubject,
  aggressiveSoftenVisualPrompt,
  rewritePolicySafeVisual,
  GENERIC_SAFE_VISUAL,
  genericSafeVisualFor,
  heroPhrase,
  deriveVideoSubject,
  ensureVideoSubject,
  ANON_PERSON_SUFFIX,
  NO_FIGURES_SUFFIX,
  CUTAWAY_PERSON_FREE_DIRECTIVE,
  CTA_EMPTY_HANDS_SUFFIX,
  NO_BOOK_SUFFIX,
  NO_PEOPLE_SUFFIX,
  SPLIT_PANEL_PERSON_FREE_DIRECTIVE,
  NO_OVERLAY_TEXT_SUFFIX,
  extractSpokenScript,
  DEFAULT_LONGFORM_INSTRUCTION,
  generateSceneClips,
  resumePendingRenders,
  withJobLock,
  isJobRendering,
  buildUnifiedScenes,
  salvageStoryboard,
  STORYBOARD_BATCH_SIZE,
  isHostLipsyncScene,
  dispatchScenesByProvider,
  USE_IMAGE_LANE,
  masterOverlayEligible,
  resolveLipsyncAdapter,
} from "./longformVideo";
import { ENV } from "./_core/env";
import { getBookNameTokens } from "./ctaDetector";
import {
  FACE_LOCK_PROMPT_PREFIX_SEATED,
  FACE_LOCK_PROMPT_PREFIX,
  FACE_LOCK_PROMPT_PREFIX_INGREDIENT,
  SIXTYNINE_VIDEO_SLOTS,
  SIXTYNINE_IMAGE_SLOTS,
} from "./providers/sixtynine-labs";
import { HOST_INTRO_TRIM_SEC } from "./videoAssembly";
import * as videoAssembly from "./videoAssembly";
import {
  HeygenLipsyncAdapter,
  heygenSlotsFor,
} from "./providers/heygen-lipsync";
import { encrypt } from "./encryption";
import { ApimartAdapter } from "./providers/apimart";
import * as storage from "./storage";
import * as db from "./db";
import type { LongformInputParams, StoryboardScene } from "../shared/types";
import { stripHostNames } from "../shared/constants";

// Storyboard + b-roll enhance now run on Gemini (invokeGemini); the tier-3 policy-safe rewrite
// still runs on Claude (invokeClaude). Back BOTH with ONE shared spy so the storyboard/enhance
// and content-policy tests keep driving responses and asserting call counts exactly as before.
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("./claude", async importOriginal => {
  const actual = await importOriginal<typeof import("./claude")>();
  return { ...actual, invokeClaude: mockInvoke };
});
vi.mock("./gemini", () => ({ invokeGemini: mockInvoke }));

// enhanceBrollPrompts (and visualDirection) read the channel persona via getChannelLayer, which
// would otherwise hit getDb() (null in tests). Default null = no persona → the raw-key fallback,
// keeping every pre-persona test byte-identical; persona tests override per-call.
const { mockGetChannelLayer } = vi.hoisted(() => ({
  mockGetChannelLayer: vi.fn(async () => null as any),
}));
vi.mock("./composer", () => ({ getChannelLayer: mockGetChannelLayer }));

// Longform stills/keyframes render via OpenAI's official gpt-image-2 (generateOpenAIStill).
// Mock that module so the b-roll/still tests drive the image result without a network call.
// generateOpenAIStill returns a single GenerationResult (not a batch array).
const { mockGenImage } = vi.hoisted(() => ({ mockGenImage: vi.fn() }));
vi.mock("./providers/openai-image", () => ({
  generateOpenAIStill: mockGenImage,
}));
// The overlay-text gate lives in its own module so this file can neutralize it: the real one
// rides the same mocked invokeClaude above, and its extra call would break the mockInvoke
// call-count assertions in the content-policy tests. Default false = "no overlay text", so every
// existing still/keyframe test is unaffected.
const { mockHasOverlayText } = vi.hoisted(() => ({
  mockHasOverlayText: vi.fn(async () => false),
}));
vi.mock("./overlayTextScan", () => ({ hasOverlayText: mockHasOverlayText }));
// A valid 1×1 PNG the still lane's sharp() validation and landscape-normalize can parse.
const okStill = () => ({
  success: true as const,
  fileData: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
  ),
  mimeType: "image/png",
});

const baseParams: LongformInputParams = {
  script: "x",
  lockMode: "ingredients",
  channelKey: "demo",
  voiceId: "v1",
};

describe("longform pure helpers", () => {
  it("clipDurationParam returns the real Grok duration (only 6 and 10 are valid)", () => {
    expect(clipDurationParam(6)).toBe(6);
    expect(clipDurationParam(10)).toBe(10);
  });

  it("narrationWordBudget scales with clip length", () => {
    expect(narrationWordBudget(6)).toBeLessThan(narrationWordBudget(10));
    expect(narrationWordBudget(10)).toBeGreaterThan(0);
  });

  it("FIXED_CLIP_LEN maps to Grok's 6s floor", () => {
    expect(clipDurationParam(FIXED_CLIP_LEN)).toBe(6);
  });
});

describe("generateValidatedStill decode guard", () => {
  // A PNG whose IHDR header parses (sharp.metadata succeeds) but whose IDAT stream is
  // clobbered (sharp.stats throws) — the "plaid" failure the guard must reject. This is
  // what .metadata()-only validation let through into the Ken Burns render.
  const corruptPng = async (): Promise<Buffer> => {
    const valid = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .png()
      .toBuffer();
    const buf = Buffer.from(valid);
    const dataStart = buf.indexOf(Buffer.from("IDAT")) + 4; // past the 4-byte chunk type
    buf.fill(0xff, dataStart, dataStart + 16); // break the zlib stream
    return buf;
  };
  const scene = {
    index: 0,
    narration: "n",
    visualPrompt: "vp",
    hostPresent: false,
  } as StoryboardScene;

  it("rejects a valid-header/corrupt-pixel buffer and regenerates", async () => {
    const bad = await corruptPng();
    const genImage = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        fileData: bad,
        mimeType: "image/png",
      })
      .mockResolvedValueOnce(okStill());
    const { buffer } = await generateValidatedStill(
      scene,
      2,
      undefined,
      genImage
    );
    expect(genImage).toHaveBeenCalledTimes(2); // corrupt one was re-rolled, not shipped
    expect(buffer.equals(okStill().fileData)).toBe(true);
  });
});

describe("withTransientRetry", () => {
  it("retries a transient PendingRenderError, then succeeds", async () => {
    let n = 0;
    const r = await withTransientRetry(
      async () => {
        if (++n < 3)
          throw new PendingRenderError("transient render failure — will retry");
        return "ok";
      },
      { attempts: 3, delayMs: () => 0 }
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
  it("does not retry a non-transient error", async () => {
    let n = 0;
    await expect(
      withTransientRetry(
        async () => {
          n++;
          throw new Error("blocked prompt");
        },
        { attempts: 3, delayMs: () => 0 }
      )
    ).rejects.toThrow("blocked prompt");
    expect(n).toBe(1);
  });
  it("gives up after exhausting attempts", async () => {
    let n = 0;
    await expect(
      withTransientRetry(
        async () => {
          n++;
          throw new PendingRenderError("still rendering");
        },
        { attempts: 2, delayMs: () => 0 }
      )
    ).rejects.toBeInstanceOf(PendingRenderError);
    expect(n).toBe(2);
  });
});

describe("stillRetryDelayMs", () => {
  it("does not delay non-rate-limit errors (instant retry preserved)", () => {
    expect(stillRetryDelayMs("OpenAI returned an undecodable image", 1)).toBe(
      0
    );
    expect(stillRetryDelayMs("OpenAI image 500: server error", 3)).toBe(0);
  });
  it("backs off on a 429, increasing then capping at ~30s", () => {
    const d = (a: number) =>
      stillRetryDelayMs("OpenAI image 429: Rate limit reached", a);
    // 2^attempt seconds + up to 1s jitter, capped at 30s + jitter.
    expect(d(1)).toBeGreaterThanOrEqual(2_000);
    expect(d(1)).toBeLessThan(3_000);
    expect(d(2)).toBeGreaterThanOrEqual(4_000);
    expect(d(3)).toBeGreaterThan(d(1)); // grows
    expect(d(10)).toBeLessThanOrEqual(31_000); // capped
    expect(d(10)).toBeGreaterThanOrEqual(30_000);
  });
});

describe("splitScriptForNarration (verbatim)", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();

  it("preserves the script word-for-word across segments", () => {
    const script =
      "First paragraph, a hook.\n\nSecond paragraph with detail.\n\nThird and final.";
    const segments = splitScriptForNarration(script);
    expect(segments.join(" ")).toBe(norm(script));
    expect(segments.every(s => s.length > 0)).toBe(true);
  });

  it("splits on blank-line paragraph boundaries", () => {
    const script = "Para one.\n\nPara two.\n\nPara three.";
    expect(splitScriptForNarration(script)).toEqual([
      "Para one.",
      "Para two.",
      "Para three.",
    ]);
  });

  it("sub-splits an over-cap paragraph on sentence boundaries without losing words", () => {
    const long =
      "Sentence one is here. Sentence two follows. Sentence three closes it.";
    const segments = splitScriptForNarration(long, 30);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(s => s.length <= 30 || !s.includes(". "))).toBe(true);
    expect(segments.join(" ")).toBe(norm(long));
  });

  it("falls back to the whole script when there are no paragraph breaks", () => {
    const script = "Just one line, no breaks.";
    expect(splitScriptForNarration(script)).toEqual([
      "Just one line, no breaks.",
    ]);
  });
});

describe("talkingHeadClipCount", () => {
  it("covers the narration using usable (post-trim) clip length plus a safety clip", () => {
    // clipLen 10 → 10s clip − 1s intro trim = 9s usable.
    expect(talkingHeadClipCount(60, 10)).toBe(Math.ceil(60 / 9) + 1);
    expect(talkingHeadClipCount(540, 10)).toBe(Math.ceil(540 / 9) + 1);
    // clipLen 6 → 6s clip − 1s = 5s usable.
    expect(talkingHeadClipCount(30, 6)).toBe(Math.ceil(30 / 5) + 1);
  });

  it("never returns fewer than 1", () => {
    expect(talkingHeadClipCount(0, 10)).toBeGreaterThanOrEqual(1);
  });

  it("always produces enough clips to cover the narration duration", () => {
    const usable = clipDurationParam(FIXED_CLIP_LEN) - HOST_INTRO_TRIM_SEC;
    for (const d of [12, 60, 137, 540, 901]) {
      expect(
        talkingHeadClipCount(d, FIXED_CLIP_LEN) * usable
      ).toBeGreaterThanOrEqual(d);
    }
  });
});

describe("parseStoryboard", () => {
  const SCRIPT = "One. Two. Three. Four.";
  const UNITS = splitIntoUnits(SCRIPT); // 4 units
  // Boundaries are now FIXED in code (`segmentScriptByDuration`); Claude only assigns a visual
  // to each chunk by 1-based `index`. Build chunks by unit-range for deterministic slices.
  const sp = (startUnit: number, endUnit: number) => ({
    start: UNITS[startUnit - 1].start,
    end: UNITS[endUnit - 1].end,
  });

  it("maps each entry to its chunk by index and slices the chunk's verbatim text", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        { index: 1, visualPrompt: "a lawn", hostPresent: true },
        { index: 2, visualPrompt: "a tool", hostPresent: false },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].index).toBe(1);
    expect(scenes[1].index).toBe(2);
    expect(scenes[0].scriptText).toBe("One. Two.");
    expect(scenes[1].scriptText).toBe("Three. Four.");
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[1].hostPresent).toBe(false);
    expect(scenes[0].sceneStatus).toBe("pending");
  });

  it("forces showsBook off even when Claude sets it (b-roll never depicts the book)", () => {
    const CHUNKS = [sp(1, 4)];
    const raw = JSON.stringify({
      scenes: [
        {
          index: 1,
          visualPrompt: "hands hold a book",
          hostPresent: false,
          showsBook: true,
        },
      ],
    });
    // openerHostScenes=0 so the non-host b-roll scene survives (the cold-open lock would
    // otherwise replace scene 1 with a plain host shape).
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT, undefined, 0);
    expect(scenes[0].showsBook).toBe(false);
  });

  it("returns scenes in chunk order regardless of the entries' order", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        { index: 2, visualPrompt: "second", hostPresent: false },
        { index: 1, visualPrompt: "first", hostPresent: true },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes.map(s => s.scriptText)).toEqual([
      "One. Two.",
      "Three. Four.",
    ]);
    expect(scenes[0].visualPrompt).toBe("first");
    expect(scenes[1].visualPrompt).toBe("second");
  });

  it("default-fills an omitted chunk with a host shot (covers every chunk)", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    // Only chunk 1 is assigned; chunk 2 is missing → default host shot.
    const raw = JSON.stringify({
      scenes: [{ index: 1, visualPrompt: "host opens", hostPresent: true }],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes).toHaveLength(2);
    expect(scenes[1].hostPresent).toBe(true); // default-filled
    expect(scenes[1].visualPrompt.length).toBeGreaterThan(0);
    expect(scenes[1].scriptText).toBe("Three. Four.");
  });

  it("default-fills an entry that is missing its visualPrompt", () => {
    const CHUNKS = [sp(1, 4)];
    const raw = JSON.stringify({ scenes: [{ index: 1 }] });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].visualPrompt.length).toBeGreaterThan(0);
  });

  it("drops an out-of-range index (its chunk default-fills)", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        { index: 1, visualPrompt: "host opens", hostPresent: true },
        { index: 2, visualPrompt: "kept", hostPresent: false },
        { index: 9, visualPrompt: "ignored", hostPresent: false },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes).toHaveLength(2);
    expect(scenes[1].visualPrompt).toBe("kept");
  });

  it("passes objectMotion through (incl. on a still) and ignores it on host scenes", () => {
    const CHUNKS = [sp(1, 1), sp(2, 3), sp(4, 4)];
    const raw = JSON.stringify({
      scenes: [
        // talking host: objectMotion stripped (the host lane has no motion clause)
        {
          index: 1,
          visualPrompt: "host opens",
          hostPresent: true,
          objectMotion: true,
        },
        // cutaway whose subject moves by itself → kept
        {
          index: 2,
          visualPrompt: "water running from a hose onto a bed",
          hostPresent: false,
          objectMotion: true,
        },
        // still of the same → kept; buildStillPrompt also builds the b-roll keyframe
        {
          index: 3,
          visualPrompt: "flames working along the kindling",
          hostPresent: false,
          stillImage: true,
          objectMotion: true,
        },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes[0].objectMotion).toBe(false);
    expect(scenes[1].objectMotion).toBe(true);
    expect(scenes[2].objectMotion).toBe(true);
    expect(scenes[2].stillImage).toBe(true);
  });

  it("passes humanPresent through (incl. on a still) and ignores it on host scenes", () => {
    const CHUNKS = [sp(1, 1), sp(2, 3), sp(4, 4)];
    const raw = JSON.stringify({
      scenes: [
        // talking host: humanPresent stripped (host already on camera)
        {
          index: 1,
          visualPrompt: "host opens",
          hostPresent: true,
          humanPresent: true,
        },
        // plain motion b-roll with a scripted human → kept
        {
          index: 2,
          visualPrompt: "a gardener tends a bed",
          hostPresent: false,
          humanPresent: true,
        },
        // still WITH a human → both flags kept (face-model still)
        {
          index: 3,
          visualPrompt: "a homeowner inspects the finished bed",
          hostPresent: false,
          stillImage: true,
          humanPresent: true,
        },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes[0].humanPresent).toBe(false);
    expect(scenes[1].humanPresent).toBe(true);
    expect(scenes[2].humanPresent).toBe(true);
    expect(scenes[2].stillImage).toBe(true);
  });

  it("reads cameraCue when present and leaves it undefined when absent/blank", () => {
    const CHUNKS = [sp(1, 2), sp(3, 3), sp(4, 4)];
    const raw = JSON.stringify({
      scenes: [
        {
          index: 1,
          visualPrompt: "host opens",
          hostPresent: true,
        },
        {
          index: 2,
          visualPrompt: "vinegar streaming onto a weed",
          hostPresent: false,
          cameraCue: "brisk push-in, harsh midday light",
        },
        {
          index: 3,
          visualPrompt: "a finished lawn",
          hostPresent: false,
          cameraCue: "   ",
        },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes[0].cameraCue).toBeUndefined(); // host scene → ignored
    expect(scenes[1].cameraCue).toBe("brisk push-in, harsh midday light");
    expect(scenes[2].cameraCue).toBeUndefined(); // blank → undefined
  });

  it("tolerates markdown fences", () => {
    const CHUNKS = [sp(1, 4)];
    const raw =
      '```json\n{"scenes":[{"index":1,"visualPrompt":"v","hostPresent":false}]}\n```';
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].scriptText).toBe("One. Two. Three. Four.");
  });

  it("parses brollVisual on host scenes and tolerates its absence", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        {
          index: 1,
          visualPrompt: "host talks",
          hostPresent: true,
          brollVisual: "close-up of vinegar on weeds",
        },
        {
          index: 2,
          visualPrompt: "host talks",
          hostPresent: true,
        },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes[0].brollVisual).toBe("close-up of vinegar on weeds");
    expect(scenes[1].brollVisual).toBeUndefined();
  });

  it("parses stillImage with the host guard", () => {
    const CHUNKS = [sp(1, 1), sp(2, 3), sp(4, 4)];
    const raw = JSON.stringify({
      scenes: [
        // host scene: stillImage must be stripped
        {
          index: 1,
          visualPrompt: "host opens",
          hostPresent: true,
          stillImage: true,
        },
        // image-lane cutaway keeps stillImage
        {
          index: 2,
          visualPrompt: "vinegar jug",
          hostPresent: false,
          stillImage: true,
        },
        {
          index: 3,
          visualPrompt: "weeds",
          hostPresent: false,
        },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    // host: stillImage stripped
    expect(scenes[0].stillImage).toBe(false);
    // image cutaway: kept
    expect(scenes[1].stillImage).toBe(true);
  });

  it("forces the first scene to host when chunk 1 came back as b-roll", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        // Claude opened on a b-roll cutaway with image-lane flags — must be overridden.
        {
          index: 1,
          visualPrompt: "vinegar jug on a shelf",
          hostPresent: false,
          stillImage: true,
          shotAngle: "mid",
        },
        { index: 2, visualPrompt: "weeds wilting", hostPresent: false },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    // Expected opener = the same default host shot an omitted chunk 1 produces.
    const defaultFilled = parseStoryboard(
      JSON.stringify({ scenes: [{ index: 2, visualPrompt: "x" }] }),
      CHUNKS,
      SCRIPT
    );
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].visualPrompt).toBe(defaultFilled[0].visualPrompt);
    // b-roll-only fields are gone on the rewritten opener
    expect(scenes[0].stillImage).toBeUndefined();
    expect(scenes[0].shotAngle).toBeUndefined();
    // verbatim slice + later scenes untouched
    expect(scenes[0].scriptText).toBe("One. Two.");
    expect(scenes[1].hostPresent).toBe(false);
    expect(scenes[1].visualPrompt).toBe("weeds wilting");
  });

  it("leaves an already-host first scene unchanged", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        { index: 1, visualPrompt: "host introduces", hostPresent: true },
        { index: 2, visualPrompt: "weeds", hostPresent: false },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].visualPrompt).toBe("host introduces");
  });

  it("openerHostScenes=0 leaves a b-roll first scene as b-roll (non-first batch)", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        { index: 1, visualPrompt: "weeds wilting", hostPresent: false },
        { index: 2, visualPrompt: "a finished lawn", hostPresent: false },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT, undefined, 0);
    // Interior batch: the cold-open lock must NOT fire.
    expect(scenes[0].hostPresent).toBe(false);
    expect(scenes[0].visualPrompt).toBe("weeds wilting");
    expect(scenes.every(s => s.hostOpener === undefined)).toBe(true);
  });

  it("openerHostScenes=2 locks a two-scene cold open over Claude's cutaway", () => {
    const CHUNKS = [sp(1, 1), sp(2, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        { index: 1, visualPrompt: "host introduces", hostPresent: true },
        { index: 2, visualPrompt: "weeds wilting", hostPresent: false },
        { index: 3, visualPrompt: "a finished lawn", hostPresent: false },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT, undefined, 2);
    expect(scenes.map(s => s.hostPresent)).toEqual([true, true, false]);
    expect(scenes.map(s => s.hostOpener)).toEqual([true, true, undefined]);
    // An already-host opener keeps Claude's visual; a cutaway is rebuilt as a talking head.
    expect(scenes[0].visualPrompt).toBe("host introduces");
    expect(scenes[1].visualPrompt).not.toBe("weeds wilting");
  });

  it("the cold open is always clean full-frame host — any splitVisual is dropped", () => {
    const CHUNKS = [sp(1, 2), sp(3, 4)];
    const raw = JSON.stringify({
      scenes: [
        {
          index: 1,
          visualPrompt: "host introduces",
          hostPresent: true,
          splitVisual: "a wheelbarrow beside him",
        },
        { index: 2, visualPrompt: "host continues", hostPresent: true },
      ],
    });
    const scenes = parseStoryboard(raw, CHUNKS, SCRIPT, undefined, 2);
    expect(scenes[0].splitVisual).toBeUndefined();
    expect(scenes[0].visualPrompt).toBe("host introduces");
  });

  it("throws when the JSON has no scenes array", () => {
    expect(() => parseStoryboard("{}", [sp(1, 4)], SCRIPT)).toThrow();
  });

  it("throws on max_tokens truncation", () => {
    expect(() =>
      parseStoryboard("{", [sp(1, 4)], SCRIPT, "max_tokens")
    ).toThrow();
  });
});

describe("salvageStoryboard", () => {
  it("recovers complete objects from a mid-object truncation and drops the partial tail", () => {
    const truncated =
      '{"scenes":[{"index":1,"visualPrompt":"a"},{"index":2,"visualPrompt":"b"},{"index":3,"visualPro';
    const salvaged = salvageStoryboard(truncated);
    expect(salvaged).not.toBeNull();
    const parsed = JSON.parse(salvaged as string);
    expect(parsed.scenes.map((s: any) => s.index)).toEqual([1, 2]);
  });

  it("is not fooled by braces/brackets inside string values", () => {
    const truncated =
      '{"scenes":[{"index":1,"visualPrompt":"a }{ ] [ jug"},{"index":2,"visualPrompt":"b';
    const salvaged = salvageStoryboard(truncated);
    const parsed = JSON.parse(salvaged as string);
    expect(parsed.scenes.map((s: any) => s.index)).toEqual([1]);
    expect(parsed.scenes[0].visualPrompt).toBe("a }{ ] [ jug");
  });

  it("returns null when no object completes", () => {
    expect(salvageStoryboard('{"scenes":[{"index":1,"visualP')).toBeNull();
  });

  it("salvaged output feeds parseStoryboard, host-filling the cut-off chunk", () => {
    const SCRIPT = "One. Two. Three.";
    const UNITS = splitIntoUnits(SCRIPT);
    const CHUNKS = UNITS.map(u => ({ start: u.start, end: u.end }));
    const truncated =
      '{"scenes":[{"index":1,"visualPrompt":"a","hostPresent":false},{"index":2,"visualPrompt":"b","hostPresent":false},{"index":3,"visualP';
    const scenes = parseStoryboard(
      salvageStoryboard(truncated) as string,
      CHUNKS,
      SCRIPT,
      undefined,
      false
    );
    expect(scenes).toHaveLength(3);
    expect(scenes[0].visualPrompt).toBe("a");
    expect(scenes[1].visualPrompt).toBe("b");
    // chunk 3 was cut off → default host fill
    expect(scenes[2].hostPresent).toBe(true);
  });
});

describe("buildUnifiedScenes batching", () => {
  afterEach(() => mockInvoke.mockReset());

  // Each sentence is ~18 words → one chunk; the leading MarkerN tags the global position so
  // the mock can tell which batch a prompt covers (batches run concurrently).
  const makeScript = (n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `Marker${i + 1} this is a fairly long sentence written specifically to fill the four to seven second narration band.`
    ).join(" ");

  const chunkCountFor = (script: string) =>
    segmentScriptByDuration(splitIntoUnits(script), script).length;

  // Local index range → returns scenes for indices 1..K parsed from the prompt; tag visuals
  // by the batch's starting global marker so we can assert per-batch provenance.
  const respondWithBroll = async ({ userMessage }: { userMessage: string }) => {
    const K = Number(userMessage.match(/each of the (\d+) numbered/)?.[1]);
    const startMarker = Number(userMessage.match(/Marker(\d+)/)?.[1]);
    const scenes = Array.from({ length: K }, (_, i) => ({
      index: i + 1,
      visualPrompt: `g${startMarker + i}`,
      hostPresent: false,
    }));
    return {
      text: JSON.stringify({ scenes }),
      stopReason: "end_turn",
    } as any;
  };

  it("merges batches, renumbers to global indices, and keeps verbatim slices", async () => {
    const SCRIPT = makeScript(30); // > STORYBOARD_BATCH_SIZE → multiple batches
    const N = chunkCountFor(SCRIPT);
    expect(N).toBeGreaterThan(STORYBOARD_BATCH_SIZE);
    mockInvoke.mockImplementation(respondWithBroll as any);

    const scenes = await buildUnifiedScenes(baseParams, SCRIPT, "DIRECTION");

    expect(scenes).toHaveLength(N);
    expect(scenes.map(s => s.index)).toEqual(
      Array.from({ length: N }, (_, i) => i + 1)
    );
    // One invokeClaude call per batch.
    expect(mockInvoke).toHaveBeenCalledTimes(
      Math.ceil(N / STORYBOARD_BATCH_SIZE)
    );
    // scriptText is the global chunk slice (concatenating reproduces the script's spans).
    const chunks = segmentScriptByDuration(splitIntoUnits(SCRIPT), SCRIPT);
    scenes.forEach((s, i) => {
      expect(s.scriptText).toBe(
        SCRIPT.slice(chunks[i].start, chunks[i].end).trim()
      );
    });
  });

  it("forces only the true opener to host; a later batch's first scene stays b-roll", async () => {
    const SCRIPT = makeScript(30);
    const N = chunkCountFor(SCRIPT);
    mockInvoke.mockImplementation(respondWithBroll as any);

    const scenes = await buildUnifiedScenes(baseParams, SCRIPT, "DIRECTION");

    // Batch 0 opener forced to host (Claude returned b-roll for it).
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[0].visualPrompt).not.toBe("g1");
    // First scene of batch 1 (global index STORYBOARD_BATCH_SIZE+1) is interior → stays b-roll.
    const seam = STORYBOARD_BATCH_SIZE; // 0-based index of global scene 26
    expect(scenes[seam].hostPresent).toBe(false);
    expect(scenes[seam].visualPrompt).toBe(`g${STORYBOARD_BATCH_SIZE + 1}`);
  });

  it("isolates a failed batch: only its chunks go host, the rest survive", async () => {
    const SCRIPT = makeScript(30);
    const N = chunkCountFor(SCRIPT);
    mockInvoke.mockImplementation(async ({ userMessage }: any) => {
      const startMarker = Number(userMessage.match(/Marker(\d+)/)?.[1]);
      // Second batch (starts past the batch-size boundary) truncates unsalvageably.
      if (startMarker > STORYBOARD_BATCH_SIZE) {
        return {
          text: '{"scenes":[{"index":1',
          stopReason: "max_tokens",
        } as any;
      }
      return respondWithBroll({ userMessage });
    });

    const scenes = await buildUnifiedScenes(baseParams, SCRIPT, "DIRECTION");

    // Did NOT collapse to all-host — batch 0's b-roll visuals survive.
    expect(scenes.some(s => !s.hostPresent)).toBe(true);
    // Interior scenes of batch 0 kept their b-roll.
    expect(scenes[1].hostPresent).toBe(false);
    expect(scenes[1].visualPrompt).toBe("g2");
    // Every scene from the failed batch (global index > STORYBOARD_BATCH_SIZE) is host-filled.
    for (let i = STORYBOARD_BATCH_SIZE; i < N; i++) {
      expect(scenes[i].hostPresent).toBe(true);
    }
  });

  it("salvages a truncated-but-recoverable batch, host-filling only the cut tail", async () => {
    const SCRIPT = makeScript(30);
    const N = chunkCountFor(SCRIPT);
    const tailBatchLen = N - STORYBOARD_BATCH_SIZE;
    mockInvoke.mockImplementation(async ({ userMessage }: any) => {
      const startMarker = Number(userMessage.match(/Marker(\d+)/)?.[1]);
      if (startMarker > STORYBOARD_BATCH_SIZE) {
        // Return the first (tailBatchLen-1) scenes complete, last one cut off mid-object.
        const objs = Array.from(
          { length: tailBatchLen - 1 },
          (_, i) =>
            `{"index":${i + 1},"visualPrompt":"t${i + 1}","hostPresent":false}`
        );
        return {
          text: `{"scenes":[${objs.join(",")},{"index":${tailBatchLen},"visualP`,
          stopReason: "max_tokens",
        } as any;
      }
      return respondWithBroll({ userMessage });
    });

    const scenes = await buildUnifiedScenes(baseParams, SCRIPT, "DIRECTION");

    // Recovered tail scenes kept their visuals…
    expect(scenes[STORYBOARD_BATCH_SIZE].visualPrompt).toBe("t1");
    expect(scenes[STORYBOARD_BATCH_SIZE].hostPresent).toBe(false);
    // …and only the single cut-off chunk (last scene) is host-filled.
    expect(scenes[N - 1].hostPresent).toBe(true);
  });

  // Sequential batching: each batch's prompt carries a digest of the shots earlier batches
  // actually chose, so the whole-video VARIETY rule can bind across batches.
  it("feeds batch 1's chosen shots into batch 2's prompt; batch 1 gets no digest", async () => {
    const SCRIPT = makeScript(30);
    mockInvoke.mockImplementation(respondWithBroll as any);

    await buildUnifiedScenes(baseParams, SCRIPT, "DIRECTION");

    const first = mockInvoke.mock.calls[0][0].userMessage as string;
    const second = mockInvoke.mock.calls[1][0].userMessage as string;
    expect(first).not.toContain("SHOTS ALREADY USED");
    expect(second).toContain("SHOTS ALREADY USED EARLIER IN THIS VIDEO");
    // Batch 1's cutaway heroes (g2… — g1 was forced to the host opener) appear in the digest.
    expect(second).toContain("- g2 (unspecified)");
    expect(second).toContain(`- g${STORYBOARD_BATCH_SIZE} (unspecified)`);
  });

  it("a host-filled failed batch contributes nothing to the next batch's digest", async () => {
    const SCRIPT = makeScript(30);
    mockInvoke.mockImplementation(async ({ userMessage }: any) => {
      const startMarker = Number(userMessage.match(/Marker(\d+)/)?.[1]);
      // FIRST batch truncates unsalvageably → host-filled.
      if (startMarker === 1) {
        return { text: '{"scenes":[{"index":1', stopReason: "max_tokens" };
      }
      return respondWithBroll({ userMessage });
    });

    await buildUnifiedScenes(baseParams, SCRIPT, "DIRECTION");

    // Batch 1 burned 2 attempts (calls 0 & 1); call 2 is batch 2 — no digest to show.
    const second = mockInvoke.mock.calls[2][0].userMessage as string;
    expect(second).toMatch(new RegExp(`Marker${STORYBOARD_BATCH_SIZE + 1}`));
    expect(second).not.toContain("SHOTS ALREADY USED");
  });
});

describe("heroPhrase (cross-batch shot digest)", () => {
  it("takes the first clause, capped at 8 words", () => {
    expect(
      heroPhrase(
        "clear liquid streaming from a plain unbranded jug onto a worn surface, the wet patch spreading"
      )
    ).toBe("clear liquid streaming from a plain unbranded jug");
    expect(heroPhrase("a seed tray. On a windowsill.")).toBe("a seed tray");
  });
});

describe("rebalanceHostScreenTime", () => {
  it("demoteAllHostsToBroll converts every host scene and re-gates flagless clips", () => {
    const scenes = [
      mk(1, true, 10),
      mk(2, false, 10, {
        stillImage: false,
        objectMotion: false,
        humanPresent: false,
      }),
      mk(3, true, 10, { brollVisual: "vinegar on counter" }),
    ];
    expect(demoteAllHostsToBroll(scenes)).toBe(2);
    expect(scenes.every(s => !s.hostPresent)).toBe(true);
    expect(scenes[1].stillImage).toBe(true);
    expect(scenes[0].visualPrompt).toContain("cutaway");
    expect(scenes[2].visualPrompt).toBe("vinegar on counter");
  });

  it("forceAllBrollMotion puts every cutaway on the video lane", () => {
    const scenes = [
      mk(1, true, 10),
      mk(2, false, 10, { stillImage: true }),
      mk(3, false, 10, { stillImage: false, objectMotion: true }),
      mk(4, false, 10, { stillImage: true, humanPresent: true }),
    ];
    expect(forceAllBrollMotion(scenes)).toBe(2);
    expect(scenes[0].stillImage).toBeUndefined();
    expect(scenes[1].stillImage).toBe(false);
    expect(scenes[1].objectMotion).toBe(true);
    expect(scenes[2].stillImage).toBe(false);
    expect(scenes[3].stillImage).toBe(false);
    expect(scenes[3].humanPresent).toBe(true);
    expect(scenes[3].objectMotion).toBeUndefined();
  });

  // Compact scene factory: host scenes carry a brollVisual fallback by default.
  const mk = (
    i: number,
    hostPresent: boolean,
    audioDuration: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    narration: `s${i}`,
    visualPrompt: hostPresent ? "host talks" : "b-roll",
    hostPresent,
    audioDuration,
    ...(hostPresent ? { brollVisual: `cutaway ${i}` } : {}),
    ...extra,
  });

  const hostShare = (scenes: StoryboardScene[]) => {
    const total = scenes.reduce((s, x) => s + (x.audioDuration ?? 0), 0);
    const host = scenes.reduce(
      (s, x) => s + (x.hostPresent ? (x.audioDuration ?? 0) : 0),
      0
    );
    return host / total;
  };

  it("reduces a host-heavy storyboard to <=40% runtime (the host budget), swapping in brollVisual", () => {
    // 10 scenes × 10s = 100s total; 5 host = 50% before.
    const scenes: StoryboardScene[] = Array.from({ length: 10 }, (_, i) =>
      mk(i, i % 2 === 0, 10)
    );
    const before = hostShare(scenes);
    const r = rebalanceHostScreenTime(scenes);
    expect(before).toBeCloseTo(0.5);
    expect(hostShare(scenes)).toBeLessThanOrEqual(HOST_SCREEN_FRACTION + 1e-9);
    expect(r.demoted).toBeGreaterThan(0);
    // Every demoted scene became b-roll and adopted its brollVisual prompt.
    for (const s of scenes) {
      if (!s.hostPresent && s.visualPrompt.startsWith("cutaway")) {
        expect(s.splitVisual).toBeUndefined();
      }
    }
  });

  it("never demotes the open/close bookends even if that keeps host >40%", () => {
    // 3 short scenes, all host; bookends alone are 2/3 of runtime.
    const scenes: StoryboardScene[] = [
      mk(0, true, 10),
      mk(1, true, 10),
      mk(2, true, 10),
    ];
    rebalanceHostScreenTime(scenes);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[2].hostPresent).toBe(true);
    // The single interior host scene is demoted; bookends remain the floor.
    expect(scenes[1].hostPresent).toBe(false);
    expect(hostShare(scenes)).toBeCloseTo(2 / 3);
  });

  it("leaves an already-compliant storyboard unchanged", () => {
    // 10 scenes × 10s; only the 2 bookends are host = 20%.
    const scenes: StoryboardScene[] = Array.from({ length: 10 }, (_, i) =>
      mk(i, i === 0 || i === 9, 10)
    );
    const r = rebalanceHostScreenTime(scenes);
    expect(r.demoted).toBe(0);
    expect(scenes.filter(s => s.hostPresent)).toHaveLength(2);
  });

  it("demotes by runtime, not scene count (one long host scene outweighs short ones)", () => {
    // bookends 1s each; interior: one 40s host + three 6s host. total=60s, host=54s.
    const scenes: StoryboardScene[] = [
      mk(0, true, 1),
      mk(1, true, 6),
      mk(2, true, 40),
      mk(3, true, 6),
      mk(4, true, 6),
      mk(5, true, 1),
    ];
    rebalanceHostScreenTime(scenes);
    // Budget is 12s; the 40s interior host must be demoted to get under it.
    expect(scenes[2].hostPresent).toBe(false);
    expect(hostShare(scenes)).toBeLessThanOrEqual(HOST_SCREEN_FRACTION + 1e-9);
  });

  it("demotes an interior host scene with no brollVisual, synthesizing a person-free cutaway", () => {
    const scenes: StoryboardScene[] = [
      mk(0, true, 10),
      mk(1, true, 10, { brollVisual: undefined }), // no fallback → synthesized on demotion
      mk(2, false, 10),
      mk(3, false, 10),
      mk(4, false, 10),
      mk(5, true, 10),
    ];
    // host is 30/60s (50% > 35% budget); interior scene 1 is now demotable even without a fallback.
    rebalanceHostScreenTime(scenes);
    expect(scenes[1].hostPresent).toBe(false);
    expect(scenes[1].visualPrompt).not.toBe("host talks");
    expect(scenes[1].visualPrompt).toContain("no people in the frame");
    expect(hostShare(scenes)).toBeLessThanOrEqual(HOST_SCREEN_FRACTION);
  });

  it("demotes an interior CTA host scene like any other — but keeps cta:true for the QR", () => {
    // Host-heavy (50s/60s); interior scene 1 is a CTA and is now demotable. The QR rides on
    // the cta flag, so demotion must preserve cta:true.
    const scenes: StoryboardScene[] = [
      mk(0, true, 10),
      mk(1, true, 10, { cta: true }),
      mk(2, true, 10),
      mk(3, true, 10),
      mk(4, false, 10),
      mk(5, true, 10),
    ];
    rebalanceHostScreenTime(scenes);
    expect(scenes[1].hostPresent).toBe(false);
    expect(scenes[1].cta).toBe(true);
  });

  it("never demotes the locked cold open, even on a host-heavy script", () => {
    // Same host-heavy shape as above, but scene 1 is the alt-angle half of the cold open —
    // it must survive where an ordinary interior host scene would be demoted.
    const scenes: StoryboardScene[] = [
      mk(0, true, 10, { hostOpener: true }),
      mk(1, true, 10, { hostOpener: true }),
      mk(2, true, 10),
      mk(3, true, 10),
      mk(4, false, 10),
      mk(5, true, 10),
    ];
    const r = rebalanceHostScreenTime(scenes);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[1].hostPresent).toBe(true);
    // The budget was still worked toward using the scenes that ARE demotable.
    expect(r.demoted).toBeGreaterThan(0);
  });
});

describe("enforceStillMotionRatio", () => {
  // Cutaway factory: still by default, 10s each unless overridden. `objectMotion` is on by
  // default because only flagged beats are demotable to the clip lane — a flagless fixture
  // would make the demote branch a silent no-op and stop testing convergence at all.
  const cut = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    narration: `s${i}`,
    visualPrompt: "b-roll",
    hostPresent: false,
    stillImage: true,
    objectMotion: true,
    audioDuration: 10,
    ...extra,
  });

  it("converges stills to ~50% of TOTAL runtime on a SHORT script (ramp skipped, flat target)", () => {
    // Under RAMP_MIN_SCENES ⇒ one bucket at the flat fraction.
    // 6 cutaways × 10s = 60s, all stills → trim to ~30s still / ~30s motion.
    const scenes = Array.from({ length: 6 }, (_, i) => cut(i));
    const r = enforceStillMotionRatio(scenes);
    expect(scenes.length).toBeLessThan(RAMP_MIN_SCENES);
    expect(r.total).toBe(60);
    expect(r.stillSeconds).toBeCloseTo(STILL_IMAGE_FRACTION * 60); // 30
    expect(r.motionSeconds).toBeCloseTo(30);
    expect(r.motionPerQuarter).toHaveLength(1);
  });

  it("promotes motion to stills when there are too few still seconds", () => {
    // 6 cutaways × 10s all motion (short script, flat) → promote half to hit ~30s still.
    const scenes = Array.from({ length: 6 }, (_, i) =>
      cut(i, { stillImage: false })
    );
    const r = enforceStillMotionRatio(scenes);
    expect(r.stillSeconds).toBeCloseTo(30);
    expect(r.motionSeconds).toBeCloseTo(30);
  });

  it("ramps motion DOWN and stills UP across the four quarters (realistic scale)", () => {
    // 200 × 4s cutaways = 800s ≈ a real 13-min job; every quarter is 200s.
    const scenes = Array.from({ length: 200 }, (_, i) =>
      cut(i, { audioDuration: 4 })
    );
    const r = enforceStillMotionRatio(scenes);
    expect(r.total).toBe(800);
    expect(r.motionPerQuarter).toHaveLength(4);

    // Each quarter lands within a couple of points of MOTION_RAMP.
    r.motionPerQuarter.forEach((secs, q) => {
      expect(secs / 200).toBeCloseTo(MOTION_RAMP[q], 1);
    });
    // Monotone: motion never rises, stills never fall, quarter over quarter.
    for (let q = 1; q < 4; q++) {
      expect(r.motionPerQuarter[q]).toBeLessThan(r.motionPerQuarter[q - 1]);
    }
    // …and the whole-video motion mean is still the global 15% budget. (Stills take the other
    // 85% here because this fixture is all cutaways — a real film spends ~35% on the host.)
    expect(r.motionSeconds / r.total).toBeCloseTo(0.15, 1);
    expect(r.stillSeconds).toBe(r.total - r.motionSeconds);
  });

  it("never leaves two motion cutaways adjacent (they'd be undone by the adjacency pass)", () => {
    const scenes = Array.from({ length: 200 }, (_, i) =>
      cut(i, { audioDuration: 4 })
    );
    enforceStillMotionRatio(scenes);
    for (let i = 1; i < scenes.length; i++) {
      expect(!scenes[i].stillImage && !scenes[i - 1].stillImage).toBe(false);
    }
  });

  it("converges by runtime, not scene count (small still demoted, not the big one)", () => {
    // stills: A=30s, B=10s (40s still); motion: C=10s, D=10s. total=60, target still=30s.
    // Count-even would flip one of the two stills; runtime must flip the 10s one (B).
    const scenes: StoryboardScene[] = [
      cut(0, { audioDuration: 30 }), // A — big still
      cut(1, { audioDuration: 10 }), // B — small still
      cut(2, { audioDuration: 10, stillImage: false }), // C — motion
      cut(3, { audioDuration: 10, stillImage: false }), // D — motion
    ];
    const r = enforceStillMotionRatio(scenes);
    expect(r.stillSeconds).toBeCloseTo(30);
    expect(scenes[0].stillImage).toBe(true); // big still kept
    expect(scenes[1].stillImage).toBe(false); // small still demoted to hit 30s exactly
  });

  it("never touches host scenes, and no-ops with no cutaways", () => {
    const scenes: StoryboardScene[] = [
      cut(0, { hostPresent: true, stillImage: undefined }),
      cut(1, { hostPresent: true, stillImage: undefined }),
    ];
    const r = enforceStillMotionRatio(scenes);
    expect(r.eligible).toBe(0);
    expect(r.stillSeconds).toBe(0);
    expect(r.motionSeconds).toBe(0);
    expect(scenes[0].hostPresent).toBe(true);
    expect(scenes[1].hostPresent).toBe(true);
  });
});

describe("runtimeQuarters", () => {
  const sc = (i: number, audioDuration: number): StoryboardScene => ({
    index: i,
    narration: `s${i}`,
    visualPrompt: "b-roll",
    hostPresent: false,
    audioDuration,
  });

  it("buckets by scene MIDPOINT, so quarters are unequal in scene count", () => {
    // 40s total ⇒ boundaries at 10/20/30s. Two 12s scenes, then eight 2s ones.
    const scenes = [
      sc(0, 12),
      sc(1, 12),
      ...Array.from({ length: 8 }, (_, i) => sc(i + 2, 2)),
    ];
    const q = runtimeQuarters(scenes);
    expect(q).toHaveLength(4);
    expect(q.flat()).toHaveLength(scenes.length); // every scene lands exactly once
    // Scene 1 plays 12→24s, straddling the 20s boundary — its MIDPOINT (18s) puts it in Q2,
    // whole, rather than splitting it or counting it twice.
    expect(q[0]).toEqual([scenes[0]]);
    expect(q[1]).toEqual([scenes[1]]);
    // Buckets are equal in SECONDS (10s each) and so wildly unequal in scene count.
    expect(q.map(b => b.length)).toEqual([1, 1, 3, 5]);
  });

  it("degrades to a single bucket below RAMP_MIN_SCENES or with no runtime", () => {
    const short = Array.from({ length: RAMP_MIN_SCENES - 1 }, (_, i) =>
      sc(i, 10)
    );
    expect(runtimeQuarters(short)).toHaveLength(1);
    expect(runtimeQuarters(short)[0]).toHaveLength(short.length);
    // Long enough, but nothing measured yet (pre-TTS) → still one bucket.
    const silent = Array.from({ length: 20 }, (_, i) => sc(i, 0));
    expect(runtimeQuarters(silent)).toHaveLength(1);
  });
});

describe("visual mix ramp (full balancer pipeline)", () => {
  // The real call order from the job runner: rebalance → split → still/motion → adjacency.
  const runPipeline = (scenes: StoryboardScene[]) => {
    rebalanceHostScreenTime(scenes);
    enforceHostSplitMix(scenes);
    enforceStillMotionRatio(scenes);
    enforceVisualAdjacency(scenes, { hasAltHost: false });
    return runtimeQuarters(scenes).map(quarter => {
      const secs = quarter.reduce((s, x) => s + (x.audioDuration ?? 0), 0);
      const share = (pick: (s: StoryboardScene) => boolean) =>
        quarter.reduce(
          (s, x) => s + (pick(x) ? (x.audioDuration ?? 0) : 0),
          0
        ) / secs;
      return {
        host: share(s => !!s.hostPresent),
        video: share(s => !s.hostPresent && !s.stillImage),
        still: share(s => !s.hostPresent && !!s.stillImage),
      };
    });
  };

  // 200 × 4s ≈ a real 13-min job. Claude wrote a FLAT storyboard (every 3rd beat is host,
  // stills elsewhere) — exactly the input the ramp has to reshape.
  const flatStoryboard = () =>
    Array.from({ length: 200 }, (_, i) => ({
      index: i,
      narration: `s${i}`,
      visualPrompt: i % 3 === 0 ? "host talks" : "b-roll",
      hostPresent: i % 3 === 0,
      ...(i % 3 === 0
        ? { brollVisual: `cutaway ${i}` }
        : // Half the cutaways depict something that actually moves — only those are
          // eligible for the clip lane, so a flagless fixture would pin video at 0%.
          { stillImage: true, objectMotion: i % 2 === 0 }),
      audioDuration: 4,
    })) as StoryboardScene[];

  it("front-loads host + motion and back-loads stills", () => {
    const q = runPipeline(flatStoryboard());
    // Host is demote-only, so Q1/Q2 keep whatever Claude wrote (~33%) and Q3/Q4 are trimmed.
    expect(q[0].host).toBeGreaterThan(q[3].host);
    expect(q[3].host).toBeLessThanOrEqual(HOST_RAMP[3] + 0.05);
    // Motion falls and stills rise, monotonically, quarter over quarter.
    for (let i = 1; i < 4; i++) {
      expect(q[i].video).toBeLessThanOrEqual(q[i - 1].video);
      expect(q[i].still).toBeGreaterThanOrEqual(q[i - 1].still);
    }
    expect(q[0].video).toBeGreaterThan(q[3].video);
    expect(q[3].still).toBeGreaterThan(q[0].still);
  });

  it("keeps the whole-video mix at the global means (pure redistribution, no cost delta)", () => {
    const scenes = flatStoryboard();
    runPipeline(scenes);
    const total = scenes.reduce((s, x) => s + (x.audioDuration ?? 0), 0);
    const share = (pick: (s: StoryboardScene) => boolean) =>
      scenes.reduce((s, x) => s + (pick(x) ? (x.audioDuration ?? 0) : 0), 0) /
      total;
    // Host is demote-only so it may land UNDER 35%, never over. Motion is the expensive lane —
    // it is the one that must not overshoot its 15% budget.
    expect(share(s => !!s.hostPresent)).toBeLessThanOrEqual(
      HOST_SCREEN_FRACTION + 0.02
    );
    expect(share(s => !s.hostPresent && !s.stillImage)).toBeLessThanOrEqual(
      0.15 + 0.03
    );
    expect(share(s => !s.hostPresent && !!s.stillImage)).toBeGreaterThan(0.4);
  });
});

describe("enforceHostSplitMix", () => {
  // Host scene factory: carries a brollVisual fallback by default, 10s each.
  const host = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    narration: `s${i}`,
    visualPrompt: `host talks ${i}`,
    hostPresent: true,
    audioDuration: 10,
    brollVisual: `cutaway ${i}`,
    ...extra,
  });

  it("splits host runtime toward HOST_SPLITVISUAL_FRACTION", () => {
    // 6 host × 10s = 60s; bookends excluded, 4 interior eligible. Target is ~12.9s, and a
    // 10s scene lands closer to it than 20s does — so exactly one interior scene splits.
    const scenes = Array.from({ length: 6 }, (_, i) => host(i));
    const r = enforceHostSplitMix(scenes);
    expect(r.hostSeconds).toBe(60);
    expect(r.splitSeconds).toBe(10);
    expect(r.aloneSeconds).toBe(50);
    expect(
      Math.abs(r.splitSeconds - HOST_SPLITVISUAL_FRACTION * 60)
    ).toBeLessThanOrEqual(10);
  });

  it("sources the beside-visual from brollVisual ?? visualPrompt", () => {
    const scenes = [
      host(0),
      host(1, { brollVisual: "the apples" }),
      host(2, { brollVisual: undefined }),
      host(3),
      host(4),
      host(5),
    ];
    enforceHostSplitMix(scenes);
    const split1 = scenes[1].splitVisual;
    const split2 = scenes[2].splitVisual;
    // Whichever interior scenes were forced, the source rule holds.
    if (split1 !== undefined) expect(split1).toBe("the apples");
    if (split2 !== undefined) expect(split2).toBe("host talks 2");
  });

  it("force-splits an interior CTA host scene like any other (QR rides on the cta flag)", () => {
    // Only one interior host scene, and it's a CTA — it must be eligible for a split now.
    const scenes = [host(0), host(1, { cta: true }), host(2)];
    enforceHostSplitMix(scenes);
    expect(scenes[1].splitVisual).toBe("cutaway 1");
  });

  it("never force-splits the open/close bookends", () => {
    const scenes = Array.from({ length: 6 }, (_, i) => host(i));
    enforceHostSplitMix(scenes);
    expect(scenes[0].splitVisual).toBeUndefined();
    expect(scenes[5].splitVisual).toBeUndefined();
  });

  it("clears splitVisual down to ~50% when the model over-picks", () => {
    // Every interior host scene starts split → trim back toward 50% of host runtime.
    const scenes = Array.from({ length: 6 }, (_, i) =>
      host(i, i !== 0 && i !== 5 ? { splitVisual: `beside ${i}` } : {})
    );
    const r = enforceHostSplitMix(scenes);
    expect(r.splitSeconds).toBeLessThanOrEqual(
      HOST_SPLITVISUAL_FRACTION * 60 + 1e-9
    );
    expect(r.splitSeconds).toBeGreaterThan(0);
  });

  it("no-ops with no host scenes", () => {
    const scenes: StoryboardScene[] = [
      {
        index: 0,
        narration: "s0",
        visualPrompt: "b-roll",
        hostPresent: false,
        audioDuration: 10,
      },
    ];
    const r = enforceHostSplitMix(scenes);
    expect(r.hostSeconds).toBe(0);
    expect(r.splitSeconds).toBe(0);
    expect(scenes[0].splitVisual).toBeUndefined();
  });
});

describe("ctaSignalInText", () => {
  it("matches a spoken URL, a QR mention, the description link, and a $price", () => {
    expect(ctaSignalInText("grab it at example.com today")).toBe(true);
    expect(ctaSignalInText("point your phone at the QR code on screen")).toBe(
      true
    );
    expect(ctaSignalInText("the link's in the description below")).toBe(true);
    expect(ctaSignalInText("it's only $17")).toBe(true);
  });

  it("does NOT match plain narration (incl. spelled-out 'dollars')", () => {
    expect(
      ctaSignalInText("He'd spent over three hundred dollars on fertilizer")
    ).toBe(false);
    expect(ctaSignalInText("Step one. Raise your mowing height.")).toBe(false);
    expect(
      ctaSignalInText("Mow in the early evening to cut heat stress.")
    ).toBe(false);
  });
});

describe("ctaVisualIsLiteral", () => {
  it("flags literal CTA / device / sales imagery", () => {
    expect(ctaVisualIsLiteral("someone scanning a QR code on a TV")).toBe(true);
    expect(
      ctaVisualIsLiteral("an older man holding the book up to camera")
    ).toBe(true);
    expect(ctaVisualIsLiteral("a hand tapping a phone screen")).toBe(true);
    expect(ctaVisualIsLiteral("visit example.com")).toBe(true);
    expect(ctaVisualIsLiteral("the link in the description")).toBe(true);
    expect(ctaVisualIsLiteral("a laptop showing a website")).toBe(true);
  });

  it("does NOT flag clean on-topic gardening b-roll", () => {
    expect(ctaVisualIsLiteral("a healthy green lawn at golden hour")).toBe(
      false
    );
    expect(ctaVisualIsLiteral("granules settling softly onto dark soil")).toBe(
      false
    );
    expect(
      ctaVisualIsLiteral("a gloved hand patting soil around a seedling")
    ).toBe(false);
  });
});

describe("genericCtaBrollFor / sanitizeCtaCutaway", () => {
  const sc = (extra: Partial<StoryboardScene>): StoryboardScene => ({
    index: 0,
    narration: "n",
    visualPrompt: "vp",
    hostPresent: false,
    ...extra,
  });

  it("borrows the nearest non-CTA cutaway subject (this video's topic)", () => {
    const scenes = [
      sc({ cta: true, visualPrompt: "scan the QR code" }),
      sc({ cta: true, visualPrompt: "grab the book" }),
      sc({ visualPrompt: "a wheelbarrow of mulch beside a flower bed" }),
    ];
    expect(genericCtaBrollFor(scenes, 0)).toBe(
      "a wheelbarrow of mulch beside a flower bed"
    );
  });

  it("falls back to the generic pool when no non-CTA cutaway exists", () => {
    const scenes = [
      sc({ cta: true, visualPrompt: "scan the QR code" }),
      sc({ hostPresent: true, stillImage: undefined, visualPrompt: "host" }),
    ];
    const out = genericCtaBrollFor(scenes, 0);
    expect(out.length).toBeGreaterThan(0);
    expect(ctaVisualIsLiteral(out)).toBe(false); // never literal CTA text
  });

  it("never borrows a neighbor that is itself literal CTA imagery", () => {
    const scenes = [
      sc({ cta: true, visualPrompt: "scan the QR code" }),
      sc({ visualPrompt: "a phone showing a website" }), // literal → skipped
    ];
    expect(ctaVisualIsLiteral(genericCtaBrollFor(scenes, 0))).toBe(false);
  });

  it("sanitize keeps a clean prompt and replaces a literal one", () => {
    const scenes = [
      sc({ cta: true }),
      sc({ visualPrompt: "rows of leafy greens in a raised bed" }),
    ];
    expect(
      sanitizeCtaCutaway("a calm green lawn in soft light", scenes, 0)
    ).toBe("a calm green lawn in soft light");
    expect(
      sanitizeCtaCutaway("someone scanning a QR code on a TV", scenes, 0)
    ).toBe("rows of leafy greens in a raised bed");
    expect(sanitizeCtaCutaway("   ", scenes, 0)).toBe(
      "rows of leafy greens in a raised bed"
    );
    expect(sanitizeCtaCutaway(undefined, scenes, 0)).toBe(
      "rows of leafy greens in a raised bed"
    );
  });
});

describe("brollDepictsBook / non-CTA book guard", () => {
  const sc = (extra: Partial<StoryboardScene>): StoryboardScene => ({
    index: 0,
    narration: "n",
    visualPrompt: "vp",
    hostPresent: false,
    ...extra,
  });

  afterEach(() => {
    mockInvoke.mockReset();
  });

  it("flags printed-matter nouns and leaves garden prose alone", () => {
    expect(
      brollDepictsBook("weathered hands leafing through a gardening book")
    ).toBe(true);
    expect(brollDepictsBook("a paperback resting on a garden bench")).toBe(
      true
    );
    expect(brollDepictsBook("a glossy magazine on the patio table")).toBe(true);
    expect(brollDepictsBook("an open guidebook beside seed trays")).toBe(true);
    // Broadened printed-matter nouns.
    expect(brollDepictsBook("a weathered garden almanac on the bench")).toBe(
      true
    );
    expect(brollDepictsBook("a hardback garden journal beside a mug")).toBe(
      true
    );
    expect(brollDepictsBook("a spiral notebook of sowing dates")).toBe(true);
    expect(brollDepictsBook("a nursery pamphlet on the potting table")).toBe(
      true
    );
    expect(brollDepictsBook("a seed-company brochure fanned open")).toBe(true);
    expect(brollDepictsBook("a thick seed catalogue on the sill")).toBe(true);
    expect(brollDepictsBook("hands leafing through a field guide")).toBe(true);
    // Horticulturally ambiguous words stay ALLOWED (see BOOK_VISUAL_PATTERNS comment).
    expect(brollDepictsBook("a planting guide sign beside seedlings")).toBe(
      false
    );
    expect(brollDepictsBook("manual watering with a metal can")).toBe(false);
    expect(brollDepictsBook("a compound leaf with three leaflets")).toBe(false);
    expect(brollDepictsBook("granules settling softly onto dark soil")).toBe(
      false
    );
    expect(brollDepictsBook("booking a garden tour")).toBe(false); // word-boundary
  });

  it("catches every -book compound, not just the four old prefixes", () => {
    for (const t of [
      "a worn textbook open on the workbench",
      "a dog-eared playbook on the potting bench",
      "a cookbook propped open by the sink",
      "a scrapbook of pressed leaves",
      "a logbook of watering dates",
    ])
      expect(brollDepictsBook(t)).toBe(true);
    // Still word-boundary safe.
    expect(brollDepictsBook("booking a garden tour")).toBe(false);
    expect(brollDepictsBook("the bookings for the garden tour")).toBe(false);
  });

  it("cue-gated nouns read as a book ONLY next to a print cue", () => {
    // A print cue sits adjacent → printed matter.
    for (const t of [
      "an open manual on the workbench",
      "hands flipping through the owners manual",
      "hands flipping through the owner’s manual", // curly apostrophe
      "a folded blueprint on the table",
      "a printed guide open on a bench",
      "an open page showing planting depths",
      "a stack of printed handouts",
      "a glossy recipe open on the counter",
      "the manual open to a diagram",
    ])
      expect(brollDepictsBook(t)).toBe(true);
    // No adjacent cue → the ordinary garden sense. A preposition starts a new noun phrase,
    // so the cue in "an OPEN bag of soil beside the MANUAL pump" must not reach "manual".
    for (const t of [
      "a manual pump beside an open bag of soil",
      "a folded cloth beside a manual sprayer",
      "an open gate at the end of a gravel path",
      "open shade over a raised bed",
      "manual pruning of a tomato plant",
    ])
      expect(brollDepictsBook(t)).toBe(false);
  });

  it("'... through' needs an inflected verb — bare nouns are garden prose", () => {
    for (const t of [
      "weathered hands leafing through a gardening book",
      "hands flipping through the owners manual",
      "thumbing through a catalogue",
      "paging through the almanac",
      "she flipped through it",
    ])
      expect(brollDepictsBook(t)).toBe(true);
    // "thumb"/"leaf"/"pagoda" as NOUNS are ordinary garden subjects.
    for (const t of [
      "presses his thumb through the compost",
      "pushes a thumb through the soil surface",
      "a leaf through the fence slats",
      "a pagoda through the trees",
    ])
      expect(brollDepictsBook(t)).toBe(false);
  });

  it("sanitizeCtaCutaway swaps a booky CTA candidate for on-topic b-roll", () => {
    const scenes = [
      sc({ index: 0, cta: true, visualPrompt: "an open handbook" }),
      sc({
        index: 1,
        visualPrompt: "a wheelbarrow of mulch beside a flower bed",
      }),
    ];
    // "an open handbook" is not literal CTA imagery, so only the book guard catches it.
    expect(ctaVisualIsLiteral("an open handbook")).toBe(false);
    expect(sanitizeCtaCutaway("an open handbook", scenes, 0)).toBe(
      "a wheelbarrow of mulch beside a flower bed"
    );
  });

  it("the enhancer prompts forbid depicting a book", () => {
    expect(EDIT_VIDEO_BROLL_ENHANCER_SYSTEM).toMatch(/NEVER depict a book/);
    expect(STILL_BROLL_ENHANCER_SYSTEM).toMatch(/NEVER depict a book/);
  });

  it("swaps a booky enhanced prompt on a non-CTA cutaway for on-topic b-roll", async () => {
    const scenes = [
      sc({
        index: 0,
        narration: "In my book I walk you through this trick",
        visualPrompt: "the trick from the book",
      }),
      sc({
        index: 1,
        narration: "spread the mulch evenly",
        visualPrompt: "a wheelbarrow of mulch beside a flower bed",
      }),
    ];
    mockInvoke.mockImplementation(
      async ({ userMessage }: any) =>
        ({
          text: userMessage.includes("my book")
            ? "weathered hands leafing through a gardening book on a bench"
            : "a wheelbarrow of dark mulch beside a flower bed in soft light",
        }) as any
    );
    await enhanceBrollPrompts(scenes, baseParams);
    expect(brollDepictsBook(scenes[0].visualPrompt!)).toBe(false);
    expect(scenes[0].visualPrompt).toMatch(/wheelbarrow/);
  });

  // Regression: the enhancer used to read `scene.visualPrompt` — its OWN previous ≤60-word
  // output — so every regen re-compressed a compression and script detail bled away. It must
  // rewrite from the seed captured on the first pass instead.
  it("re-enhances from the seed prompt, not its own previous rewrite", async () => {
    const scenes = [
      sc({
        index: 0,
        narration: "water it deeply",
        visualPrompt:
          "a garden bed soaked after a deep watering from a watering can",
      }),
    ];
    mockInvoke.mockResolvedValue({ text: "a damp garden bed" } as any);
    await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].visualPrompt).toBe("a damp garden bed");

    mockInvoke.mockClear();
    await enhanceBrollPrompts(scenes, baseParams);
    const sent = mockInvoke.mock.calls[0][0].userMessage as string;
    expect(sent).toContain("watering can");
    expect(sent).not.toContain("Original prompt: a damp garden bed");
  });

  it("swaps a booky original prompt even when the enhancer LLM fails", async () => {
    const scenes = [
      sc({
        index: 0,
        narration: "grab my book",
        visualPrompt: "an older man reading the book in his garden",
      }),
      sc({ index: 1, visualPrompt: "rows of leafy greens in a raised bed" }),
    ];
    mockInvoke.mockRejectedValue(new Error("boom"));
    await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].visualPrompt).toBe("rows of leafy greens in a raised bed");
  });

  // The splitVisual book guard is the ONLY guard on that field, and splitVisual is now enhanced
  // by an LLM first — so the guard has to survive what the LLM hands back, not just what the
  // storyboard wrote. Mock the enhancer into RETURNING a book: a version that only mocks a clean
  // reply passes whether or not the guard exists at all.
  it("swaps a booky splitVisual the ENHANCER introduced on a HOST scene", async () => {
    const scenes = [
      sc({
        index: 0,
        hostPresent: true,
        narration: "let me show you",
        visualPrompt: "the host talking",
        splitVisual: "hands beside a seed tray",
      }),
      sc({
        index: 1,
        narration: "spread the mulch evenly",
        visualPrompt: "a wheelbarrow of mulch beside a flower bed",
      }),
    ];
    mockInvoke.mockImplementation(async (p: any) =>
      (p.userMessage as string).includes("hands beside a seed tray")
        ? { text: "hands leafing through a well-thumbed almanac" }
        : { text: "a wheelbarrow of mulch beside a flower bed" }
    );
    await enhanceBrollPrompts(scenes, baseParams);
    expect(brollDepictsBook(scenes[0].splitVisual!)).toBe(false);
    expect(scenes[0].splitVisual).toMatch(/wheelbarrow/);
  });

  it("uses the enhancer reply as the visual prompt", async () => {
    const scenes = [sc({ index: 0, narration: "n", visualPrompt: "RAW" })];
    mockInvoke.mockResolvedValue({
      text: "a seed tray on a windowsill in flat shade",
    } as any);
    await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].visualPrompt).toBe(
      "a seed tray on a windowsill in flat shade"
    );
  });

  it("enhances splitVisual on a host scene (the cutaway pass skips host scenes)", async () => {
    const scenes = [
      sc({
        index: 0,
        hostPresent: true,
        narration: "let me show you",
        visualPrompt: "the host talking",
        splitVisual: "RAW split",
      }),
    ];
    mockInvoke.mockResolvedValue({
      text: "a seed tray on a windowsill in flat shade",
    } as any);
    await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].splitVisual).toBe(
      "a seed tray on a windowsill in flat shade"
    );
    // The host's own visualPrompt is NOT b-roll — only the right half is.
    expect(scenes[0].visualPrompt).toBe("the host talking");
  });

  // The cutaway lane's scrub is asserted above; the split lane adopts through the same
  // stripPromptArtifacts call but was never covered — every other split test mocks clean text.
  it("scrubs generator syntax the SPLIT enhancer returns", async () => {
    const scenes = [
      sc({
        index: 0,
        hostPresent: true,
        visualPrompt: "the host talking",
        splitVisual: "RAW split",
      }),
    ];
    mockInvoke.mockResolvedValue({
      text:
        "```\n/imagine prompt: a cedar bench on a porch <lora:FilmGrain:1.0> " +
        "--ar 16:9 --style raw\nStyle: cinematic\n```",
    } as any);
    await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].splitVisual).toBe("a cedar bench on a porch");
  });

  it("keeps the original splitVisual when its enhance call fails", async () => {
    const scenes = [
      sc({
        index: 0,
        hostPresent: true,
        visualPrompt: "the host talking",
        splitVisual: "RAW split",
      }),
    ];
    mockInvoke.mockRejectedValue(new Error("boom"));
    await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].splitVisual).toBe("RAW split");
  });

  it("tells the split enhancer to keep the right panel person-free", async () => {
    const scenes = [
      sc({
        index: 0,
        hostPresent: true,
        narration: "let me show you",
        visualPrompt: "the host talking",
        splitVisual: "a gardener kneeling beside the tomato plants",
      }),
    ];
    let splitUserMessage = "";
    mockInvoke.mockImplementation(async (p: any) => {
      if ((p.userMessage as string).includes("a gardener kneeling")) {
        splitUserMessage = p.userMessage;
      }
      return { text: "tomato plants in a raised bed under flat shade" };
    });
    await enhanceBrollPrompts(scenes, baseParams);
    expect(splitUserMessage).toContain(SPLIT_PANEL_PERSON_FREE_DIRECTIVE);
    // The ban alone left the lane with no legal subject on a person-action beat, so the model
    // restated the seed (often the host's own prompt) or drew a diagram. Both halves must ship.
    expect(SPLIT_PANEL_PERSON_FREE_DIRECTIVE).toMatch(/NO people, NO hands/);
    expect(SPLIT_PANEL_PERSON_FREE_DIRECTIVE).toMatch(
      /PERSON DOING SOMETHING[\s\S]*DISCARD it entirely/
    );
  });

  it("scopes the splitVisual pass to onlyIndices, and runs with zero cutaways in scope", async () => {
    const scenes = [
      sc({
        index: 0,
        hostPresent: true,
        visualPrompt: "host A",
        splitVisual: "RAW zero",
      }),
      sc({
        index: 1,
        hostPresent: true,
        visualPrompt: "host B",
        splitVisual: "RAW one",
      }),
    ];
    mockInvoke.mockResolvedValue({ text: "a mulched bed" } as any);
    // Every scene is a host scene, so `cutaways` is empty — the early return must not eat this.
    await enhanceBrollPrompts(scenes, baseParams, [1]);
    expect(scenes[0].splitVisual).toBe("RAW zero");
    expect(scenes[1].splitVisual).toBe("a mulched bed");
  });

  it("re-enhances only the scenes named in onlyIndices (regenerate scope)", async () => {
    const scenes = [
      sc({
        index: 0,
        narration: "water the seedlings",
        visualPrompt: "RAW zero",
      }),
      sc({ index: 1, narration: "spread the mulch", visualPrompt: "RAW one" }),
    ];
    mockInvoke.mockResolvedValue({
      text: "a calm mulch bed in soft overcast light",
    } as any);
    await enhanceBrollPrompts(scenes, baseParams, [1]);
    // Only scene index 1 is targeted → rewritten; scene 0 is left byte-for-byte.
    expect(scenes[0].visualPrompt).toBe("RAW zero");
    expect(scenes[1].visualPrompt).toBe(
      "a calm mulch bed in soft overcast light"
    );
  });

  it("forwards the video subject into the enhancer user message", async () => {
    const scenes = [
      sc({
        index: 0,
        narration: "trim the fat off the meat",
        visualPrompt: "hands trimming fat from a cut of meat",
      }),
    ];
    mockInvoke.mockResolvedValue({
      text: "hands trimming a venison cut",
    } as any);
    await enhanceBrollPrompts(scenes, {
      ...baseParams,
      videoSubject: "field dressing a deer",
    });
    const sent = mockInvoke.mock.calls[0][0].userMessage as string;
    expect(sent).toContain("Video subject");
    expect(sent).toContain("field dressing a deer");
    expect(sent).toContain("DISAMBIGUATION");
  });

  it("forwards the style bible and the scene's beat into the enhancer user message", async () => {
    const scenes = [
      sc({
        index: 0,
        narration: "spread the mulch evenly",
        visualPrompt: "a wheelbarrow of mulch",
        visualBeat: "the method being worked through, hands busy",
      }),
    ];
    mockInvoke.mockResolvedValue({ text: "a mulched bed" } as any);
    await enhanceBrollPrompts(scenes, {
      ...baseParams,
      visualStyleBible: "a cramped Zone 6b backyard, late autumn",
    });
    const sent = mockInvoke.mock.calls[0][0].userMessage as string;
    expect(sent).toContain("Channel visual direction");
    expect(sent).toContain("a cramped Zone 6b backyard, late autumn");
    expect(sent).toContain("the method being worked through, hands busy");
    // Both are hedged the same way subjectLine is — the enhancer's SCRIPT ALIGNMENT rule
    // forbids introducing anything the narration doesn't state, and this must not fight it.
    expect(sent).toContain("DISAMBIGUATION");
    expect(sent).toContain(
      "do NOT introduce any object the narration doesn't state"
    );
  });

  // A CTA cutaway's narration is a sales pitch that CTA_BROLL_ENHANCER_SYSTEM exists to IGNORE,
  // so a beat derived from it would reintroduce exactly what that lane suppresses.
  it("gives a CTA cutaway the bible but never its beat", async () => {
    const scenes = [
      sc({
        index: 0,
        cta: true,
        narration: "grab your copy at the link",
        visualPrompt: "the book",
        visualBeat: "the pitch, book in hand",
      }),
      sc({ index: 1, visualPrompt: "rows of leafy greens in a raised bed" }),
    ];
    mockInvoke.mockResolvedValue({ text: "rows of leafy greens" } as any);
    await enhanceBrollPrompts(scenes, {
      ...baseParams,
      visualStyleBible: "a cramped Zone 6b backyard, late autumn",
    });
    const ctaCall = mockInvoke.mock.calls.find(c =>
      (c[0].userMessage as string).includes("Topic context")
    );
    expect(ctaCall).toBeDefined();
    expect(ctaCall![0].userMessage).toContain("a cramped Zone 6b backyard");
    expect(ctaCall![0].userMessage).not.toContain("the pitch, book in hand");
  });

  // With no direction derived (a pre-feature job, or a derive that failed open) the prompt this
  // feature ships must be indistinguishable from the one before it. This is the kill switch —
  // the pass is always on and has no feature flag.
  it("is byte-identical to the pre-feature user message when no direction is set", async () => {
    const mk = () => [
      sc({
        index: 0,
        narration: "spread the mulch evenly",
        visualPrompt: "a wheelbarrow of mulch",
      }),
    ];
    mockInvoke.mockResolvedValue({ text: "a mulched bed" } as any);

    await enhanceBrollPrompts(mk(), baseParams);
    const without = mockInvoke.mock.calls[0][0].userMessage as string;

    expect(without).not.toContain("Channel visual direction");
    expect(without).toBe(
      `${CUTAWAY_PERSON_FREE_DIRECTIVE}\n` +
        `Channel: demo\n` +
        `Type: still\n` +
        `Scene narration: "spread the mulch evenly"\n` +
        `Original prompt: a wheelbarrow of mulch\n\n` +
        `Enhanced prompt:`
    );
  });

  it("treats a blank style bible as no bible (no stray line)", async () => {
    const scenes = [sc({ index: 0, visualPrompt: "a wheelbarrow of mulch" })];
    mockInvoke.mockResolvedValue({ text: "a mulched bed" } as any);
    await enhanceBrollPrompts(scenes, {
      ...baseParams,
      visualStyleBible: "   ",
    });
    expect(mockInvoke.mock.calls[0][0].userMessage).not.toContain(
      "Channel visual direction"
    );
  });

  it("sends the channel persona (not the raw key) when a layer exists — all three lanes", async () => {
    mockGetChannelLayer.mockResolvedValueOnce({
      layerContent: "Tom is a tired gardener who salvages everything.",
    } as any);
    const scenes = [
      sc({
        index: 0,
        narration: "spread the mulch",
        visualPrompt: "a wheelbarrow of mulch",
      }),
      sc({
        index: 1,
        cta: true,
        narration: "grab your copy",
        visualPrompt: "rows of leafy greens",
      }),
      sc({
        index: 2,
        hostPresent: true,
        visualPrompt: "the host talking",
        splitVisual: "a seed tray",
      }),
    ];
    mockInvoke.mockResolvedValue({ text: "a mulched bed" } as any);
    await enhanceBrollPrompts(scenes, baseParams);
    expect(mockInvoke.mock.calls.length).toBe(3);
    for (const call of mockInvoke.mock.calls) {
      const sent = call[0].userMessage as string;
      expect(sent).toContain("Channel persona");
      expect(sent).toContain("Tom is a tired gardener");
      expect(sent).toContain("NOT content to depict");
      expect(sent).not.toContain("Channel: demo");
    }
  });

  it("gives a CTA cutaway its narration, framed as a pitch never to depict", async () => {
    const scenes = [
      sc({
        index: 0,
        cta: true,
        narration: "scan the QR code and grab your copy",
        visualPrompt: "rows of leafy greens",
      }),
      sc({ index: 1, visualPrompt: "a wheelbarrow of mulch" }),
    ];
    mockInvoke.mockResolvedValue({ text: "rows of leafy greens" } as any);
    await enhanceBrollPrompts(scenes, baseParams);
    const ctaCall = mockInvoke.mock.calls.find(c =>
      (c[0].userMessage as string).includes("Topic context")
    );
    expect(ctaCall).toBeDefined();
    const sent = ctaCall![0].userMessage as string;
    expect(sent).toContain("Scene narration (a SALES PITCH");
    expect(sent).toContain("scan the QR code and grab your copy");
    expect(sent).toContain("never depict the pitch itself");
  });

  it("reports failed scene indices so the pipeline can surface a warning", async () => {
    const scenes = [
      sc({ index: 3, narration: "n3", visualPrompt: "RAW three" }),
      sc({ index: 7, narration: "n7", visualPrompt: "RAW seven" }),
    ];
    mockInvoke.mockRejectedValue(new Error("boom"));
    const { failedScenes } = await enhanceBrollPrompts(scenes, baseParams);
    expect(failedScenes).toEqual([3, 7]);
    // Originals kept.
    expect(scenes[0].visualPrompt).toBe("RAW three");
  });

  it("retries a failed scene once after the pool drains", async () => {
    const scenes = [
      sc({ index: 4, narration: "n4", visualPrompt: "RAW four" }),
    ];
    mockInvoke
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockResolvedValue({ text: "a mulched bed" } as any);
    const { failedScenes } = await enhanceBrollPrompts(scenes, baseParams);
    expect(failedScenes).toEqual([]);
    expect(scenes[0].visualPrompt).toBe("a mulched bed");
  });

  it("carries the failure reason so the job warning is diagnosable", async () => {
    const scenes = [
      sc({ index: 5, narration: "n5", visualPrompt: "RAW five" }),
    ];
    mockInvoke.mockRejectedValue(new Error("429 rate limit"));
    const { failReasons } = await enhanceBrollPrompts(scenes, baseParams);
    // Summarised, not raw: these strings are rendered verbatim in a job warning, and provider
    // SDKs put a whole JSON document in `error.message`. See `summarizeProviderError`.
    expect(failReasons).toEqual(["provider rate limit (429)"]);
  });

  it("de-duplicates identical provider failures across scenes", async () => {
    const scenes = [
      sc({ index: 1, narration: "n1", visualPrompt: "RAW one" }),
      sc({ index: 2, narration: "n2", visualPrompt: "RAW two" }),
      sc({ index: 3, narration: "n3", visualPrompt: "RAW three" }),
    ];
    // One outage fails every scene with the same body; the warning must say it once.
    mockInvoke.mockRejectedValue(new Error("429 rate limit"));
    const { failedScenes, failReasons } = await enhanceBrollPrompts(
      scenes,
      baseParams
    );
    expect(failedScenes).toEqual([1, 2, 3]);
    expect(failReasons).toEqual(["provider rate limit (429)"]);
  });

  it("returns no failures on a clean run", async () => {
    const scenes = [sc({ index: 0, narration: "n", visualPrompt: "RAW" })];
    mockInvoke.mockResolvedValue({ text: "a mulched bed" } as any);
    const { failedScenes } = await enhanceBrollPrompts(scenes, baseParams);
    expect(failedScenes).toEqual([]);
  });

  it("discards a max_tokens-truncated rewrite and keeps the original", async () => {
    const scenes = [sc({ index: 2, narration: "n", visualPrompt: "RAW" })];
    mockInvoke.mockResolvedValue({
      text: "a rewrite cut off mid-sent",
      stopReason: "max_tokens",
    } as any);
    const { failedScenes } = await enhanceBrollPrompts(scenes, baseParams);
    expect(scenes[0].visualPrompt).toBe("RAW");
    expect(failedScenes).toEqual([2]);
  });
});

describe("enforceVisualAdjacency", () => {
  const mk = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    narration: `s${i}`,
    scriptText: `s${i}`,
    visualPrompt: "vp",
    hostPresent: false,
    stillImage: false, // motion b-roll by default
    brollVisual: `broll ${i}`,
    audioDuration: 5,
    ...extra,
  });
  const host = (i: number, extra: Partial<StoryboardScene> = {}) =>
    mk(i, { hostPresent: true, stillImage: undefined, ...extra });
  const reg = (s: StoryboardScene) =>
    s.hostPresent ? "host" : s.stillImage ? "still" : "motion";
  const hasAdjacentPair = (scenes: StoryboardScene[], r: "host" | "motion") =>
    scenes.some((s, i) => i > 0 && reg(s) === r && reg(scenes[i - 1]) === r);

  it("breaks a run of host scenes into host/still/host…", () => {
    const scenes = Array.from({ length: 5 }, (_, i) => host(i));
    const r = enforceVisualAdjacency(scenes);
    expect(scenes.map(reg)).toEqual(["host", "still", "host", "still", "host"]);
    expect(r.hostBroken).toBe(2);
    expect(hasAdjacentPair(scenes, "host")).toBe(false);
    // converted scenes use their brollVisual and clear any split.
    expect(scenes[1].visualPrompt).toBe("broll 1");
    expect(scenes[1].shotAngle).toBe("wide");
  });

  it("breaks a run of motion b-roll by flipping the later one to a still", () => {
    const scenes = [host(0), mk(1), mk(2), mk(3), host(4)];
    const r = enforceVisualAdjacency(scenes);
    expect(scenes.map(reg)).toEqual([
      "host",
      "motion",
      "still",
      "motion",
      "host",
    ]);
    expect(r.motionBroken).toBe(1);
    expect(hasAdjacentPair(scenes, "motion")).toBe(false);
  });

  it("converts a CTA scene like any other but keeps cta:true so the QR rides along", () => {
    // A host pair whose later scene is a CTA beat. CTA is no longer protected, so it is
    // demoted to a still — and must keep cta:true (the QR overlay is flag-driven).
    const scenes = [
      host(0),
      host(1, { cta: true, scriptText: "grab it at example.com" }),
      mk(2, { stillImage: true }),
      host(3),
    ];
    enforceVisualAdjacency(scenes);
    expect(scenes[1].hostPresent).toBe(false); // CTA beat converted
    expect(scenes[1].stillImage).toBe(true);
    expect(scenes[1].cta).toBe(true); // QR still rides on the still
    expect(hasAdjacentPair(scenes, "host")).toBe(false);
  });

  it("keeps the closing scene on host (converts the earlier neighbor)", () => {
    const scenes = [host(0), mk(1), host(2), host(3)]; // last two are a host pair
    enforceVisualAdjacency(scenes);
    expect(scenes[3].hostPresent).toBe(true); // closing bookend preserved
    expect(scenes[2].hostPresent).toBe(false); // earlier neighbor converted
    expect(hasAdjacentPair(scenes, "host")).toBe(false);
  });

  it("leaves an unbreakable host pair (opener + closer, both bookends) in place", () => {
    // Only two scenes: both are protected bookends, so the pair can't be broken with a still.
    const scenes = [host(0), host(1)];
    const r = enforceVisualAdjacency(scenes);
    expect(r.hostBroken).toBe(0);
    expect(scenes.every(s => s.hostPresent)).toBe(true);
  });

  it("breaks an interior host run that has NO brollVisual by synthesizing a still", () => {
    // Five host scenes, none with a brollVisual fallback. The old guard left these adjacent; now
    // demotion synthesizes a person-free cutaway from the scene, so the run is broken every-other.
    const scenes = Array.from({ length: 5 }, (_, i) =>
      host(i, { brollVisual: undefined })
    );
    const r = enforceVisualAdjacency(scenes);
    expect(scenes.map(reg)).toEqual(["host", "still", "host", "still", "host"]);
    expect(r.hostBroken).toBe(2);
    expect(hasAdjacentPair(scenes, "host")).toBe(false);
    // synthesized, person-free — not the "vp" talking-head prompt.
    expect(scenes[1].visualPrompt).toContain("no people in the frame");
  });

  it("is idempotent and leaves adjacent stills alone", () => {
    const scenes = [
      host(0),
      mk(1, { stillImage: true }),
      mk(2, { stillImage: true }),
      host(3),
    ];
    const r1 = enforceVisualAdjacency(scenes);
    expect(r1).toEqual({ hostBroken: 0, motionBroken: 0, altSeconds: 0 });
    const snapshot = scenes.map(reg);
    enforceVisualAdjacency(scenes);
    expect(scenes.map(reg)).toEqual(snapshot);
  });

  it("breaks a mid-film host pair even with an alt host photo (pairs are cold-open only)", () => {
    const scenes = Array.from({ length: 4 }, (_, i) => host(i));
    const r = enforceVisualAdjacency(scenes, { hasAltHost: true });
    // No `hostOpener` flags → the two-angle pair is NOT sanctioned here; the run collapses to 1.
    expect(scenes.map(reg)).toEqual(["host", "still", "still", "host"]);
    expect(r.hostBroken).toBe(2);
    expect(hasAdjacentPair(scenes, "host")).toBe(false);
  });

  it("keeps the cold-open host PAIR intact with an alt host photo (the feature it enables)", () => {
    const scenes = [
      host(0, { hostOpener: true }),
      host(1, { hostOpener: true }),
    ];
    const r = enforceVisualAdjacency(scenes, { hasAltHost: true });
    expect(r.hostBroken).toBe(0);
    expect(scenes.every(s => s.hostPresent)).toBe(true);
    expect(scenes.map(s => s.hostShot)).toEqual([0, 1]);
  });

  it("holds solo host shots to the alt-camera runtime budget", () => {
    // 8 solo host shots × 5s = 40s host; the alt budget is 40 × 10/35 ≈ 11.4s, so only
    // two 5s scenes go alt — the rest stay on the main camera (no more alternating).
    const scenes = Array.from({ length: 16 }, (_, i) =>
      i % 2 === 0 ? host(i) : mk(i, { stillImage: true })
    );
    const r = enforceVisualAdjacency(scenes, { hasAltHost: true });
    const altScenes = scenes.filter(s => s.hostShot === 1);
    expect(altScenes).toHaveLength(2);
    expect(r.altSeconds).toBe(10);
    expect(Math.abs(r.altSeconds - (10 / 35) * 40)).toBeLessThanOrEqual(5);
    // Alt shots are spread across the film, not clustered at one end.
    expect(altScenes[1].index - altScenes[0].index).toBeGreaterThan(2);
  });

  it("keeps split-screen host scenes on the main photo", () => {
    const scenes = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0
        ? host(i, { splitVisual: `beside ${i}` })
        : mk(i, { stillImage: true })
    );
    enforceVisualAdjacency(scenes, { hasAltHost: true });
    expect(scenes.filter(s => s.splitVisual).every(s => s.hostShot === 0)).toBe(
      true
    );
  });

  it("still breaks motion pairs even with an alt host photo", () => {
    const scenes = [host(0), mk(1), mk(2), host(3)];
    const r = enforceVisualAdjacency(scenes, { hasAltHost: true });
    expect(r.motionBroken).toBe(1);
    expect(hasAdjacentPair(scenes, "motion")).toBe(false);
  });

  it("without an alt host photo, host pairs are still broken and no shot is assigned", () => {
    const scenes = Array.from({ length: 3 }, (_, i) => host(i));
    enforceVisualAdjacency(scenes);
    expect(hasAdjacentPair(scenes, "host")).toBe(false);
    expect(scenes.every(s => s.hostShot === undefined)).toBe(true);
  });

  it("breaks a host run AFTER the locked cold open, never inside it", () => {
    // Cold open (0,1) plus a third host scene: the run is over the cap, and the only legal
    // break is scene 2 — the opener is protected the way the bookends are.
    const scenes = [
      host(0, { hostOpener: true }),
      host(1, { hostOpener: true }),
      host(2),
      mk(3),
      host(4),
    ];
    enforceVisualAdjacency(scenes, { hasAltHost: true });
    expect(scenes.map(reg)).toEqual([
      "host",
      "host",
      "still",
      "motion",
      "host",
    ]);
    expect(scenes[0].hostShot).toBe(0);
    expect(scenes[1].hostShot).toBe(1);
  });

  it("pins the cold open main → alt even when a later host scene follows it", () => {
    // The generic pair rule reads scenes[i+1]; without the hostOpener pin, scene 1 would flip
    // back to the MAIN photo here and the two-angle opening would collapse into two identical
    // shots. (Scene 2 is demoted by the run cap, but the angles are assigned after that.)
    const scenes = [
      host(0, { hostOpener: true }),
      host(1, { hostOpener: true }),
      host(2),
      host(3),
    ];
    enforceVisualAdjacency(scenes, { hasAltHost: true });
    expect(scenes[0].hostShot).toBe(0);
    expect(scenes[1].hostShot).toBe(1);
  });
});

describe("markCtaScenes", () => {
  const mk = (
    i: number,
    scriptText: string,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText,
    narration: scriptText.slice(0, 20),
    visualPrompt: "b-roll of a lawn",
    hostPresent: false,
    ...extra,
  });

  it("flags both CTA blocks, bridges a short interior gap, leaves content between blocks alone", () => {
    const scenes: StoryboardScene[] = [
      mk(1, "Three summers ago a customer's Bermuda lawn was thinning.", {
        hostPresent: true,
      }),
      mk(2, "Step one. Raise your mowing height for deeper roots."),
      mk(
        3,
        "I wrote The Weekend Protocol — eighty-eight pages at example.com."
      ),
      mk(4, "Take your time finding it, unlock it, I'll be right here."), // no signal — bridged
      mk(
        5,
        "Point your phone at the QR code; the link's in the description below."
      ),
      mk(6, "Now here's where most homeowners trip themselves up."),
      mk(7, "Mistake one is mowing on a calendar instead of by height."),
      mk(8, "Mow in the early evening to cut heat stress in half."),
      mk(
        9,
        "That's Chapter 8. Find it at example.com — link in the description."
      ),
      mk(10, "Alright, here's the takeaway: mow by height.", {
        hostPresent: true,
      }),
    ];
    markCtaScenes(scenes);
    expect(scenes.filter(s => s.cta).map(s => s.index)).toEqual([3, 4, 5, 9]);
    // The 3-scene stretch between the two blocks is NOT bridged.
    expect(scenes[5].cta).toBeUndefined();
    expect(scenes[6].cta).toBeUndefined();
    expect(scenes[7].cta).toBeUndefined();
    // CTA scenes are flagged only — their register is left exactly as it came in (these all
    // arrived as cutaways, so they stay cutaways; the QR rides on the cta flag).
    for (const s of scenes.filter(x => x.cta))
      expect(s.hostPresent).toBe(false);
  });

  it("flags a cutaway CTA scene without touching its register or cutaway fields", () => {
    const scenes: StoryboardScene[] = [
      mk(1, "Grab the book at example.com.", {
        stillImage: true,
        splitVisual: "a book cover",
        visualPrompt: "tight shot of a book on a table",
      }),
    ];
    markCtaScenes(scenes);
    const s = scenes[0];
    expect(s.cta).toBe(true);
    // Register and cutaway fields are untouched — only cta is set.
    expect(s.hostPresent).toBe(false);
    expect(s.stillImage).toBe(true);
    expect(s.splitVisual).toBe("a book cover");
    expect(s.visualPrompt).toBe("tight shot of a book on a table");
  });

  it("honors a Claude-set cta flag without forcing the host on", () => {
    const scenes: StoryboardScene[] = [
      mk(1, "And stay with me for the best time of day to mow.", { cta: true }),
    ];
    markCtaScenes(scenes);
    expect(scenes[0].cta).toBe(true);
    expect(scenes[0].hostPresent).toBe(false); // register untouched
  });
});

describe("markQrBeforeCover", () => {
  const mk = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText: `scene ${i}`,
    narration: `scene ${i}`,
    visualPrompt: "b-roll of a lawn",
    hostPresent: true,
    ...extra,
  });
  const withQr: LongformInputParams = {
    ...baseParams,
    qrImageUrl: "https://r2/qr.png",
  };

  it("flags the scenes before the cover reveal as big-QR beats, keeping their scripts", () => {
    const scenes = [
      mk(1),
      mk(2, { cta: true }),
      mk(3, { cta: true, coverHero: true }),
    ];
    const out = markQrBeforeCover(scenes, withQr);
    // Both scenes before the cover become big-QR beats — the non-cta one too, with cta forced
    // on so the centered overlay actually draws (the qrOverlayUrl assembly gate needs cta).
    expect(out[0].qrHero).toBe(true);
    expect(out[0].cta).toBe(true);
    const beat = out[1];
    expect(beat.qrHero).toBe(true);
    expect(beat.stillImage).toBe(true);
    expect(beat.hostPresent).toBe(false);
    expect(beat.scriptText).toBe("scene 2"); // narration untouched
    // The cover scene stays clean (no QR on it).
    expect(out[2].qrHero).toBeUndefined();
    expect(out.filter(s => s.qrHero)).toHaveLength(2);
  });

  it("marks the 2 CTA scenes before the cover, each keeping its own script", () => {
    const scenes = [
      mk(1, { cta: true }),
      mk(2, { cta: true }),
      mk(3, { cta: true, coverHero: true }),
    ];
    const out = markQrBeforeCover(scenes, withQr);
    expect(out[0].qrHero).toBe(true);
    expect(out[1].qrHero).toBe(true);
    expect(out[0].scriptText).toBe("scene 1");
    expect(out[1].scriptText).toBe("scene 2");
    expect(out.filter(s => s.qrHero)).toHaveLength(2);
    // qrHero exempts them from the on-screen floor → no silent pad, plays real narration.
    out.forEach(s => applySceneHoldFloor(s));
    expect(out[0].audioDuration).toBeUndefined();
    expect(out[1].audioDuration).toBeUndefined();
  });

  it("marks the pre-cover scenes of EACH cover reveal (mid + close)", () => {
    const scenes = [
      mk(1, { cta: true }),
      mk(2, { cta: true, coverHero: true }), // run A cover (idx1) — only idx0 precedes it
      mk(3),
      mk(4, { cta: true }),
      mk(5, { cta: true, coverHero: true }), // run B cover (idx4)
    ];
    const out = markQrBeforeCover(scenes, withQr);
    expect(out[0].qrHero).toBe(true); // before cover A
    expect(out[2].qrHero).toBe(true); // before cover B — non-cta scene now converted
    expect(out[3].qrHero).toBe(true); // before cover B
    expect(out[1].qrHero).toBeUndefined(); // covers stay clean
    expect(out[4].qrHero).toBeUndefined();
    expect(out.filter(s => s.qrHero)).toHaveLength(3);
  });

  it("is idempotent — re-running does not change the result", () => {
    const scenes = [
      mk(1, { cta: true }),
      mk(2, { cta: true, coverHero: true }),
    ];
    const once = markQrBeforeCover(scenes, withQr);
    const twice = markQrBeforeCover(once, withQr);
    expect(twice.filter(s => s.qrHero)).toHaveLength(1);
  });

  it("is a no-op when the channel has no QR image", () => {
    const scenes = [
      mk(1, { cta: true }),
      mk(2, { cta: true, coverHero: true }),
    ];
    const out = markQrBeforeCover(scenes, baseParams);
    expect(out.some(s => s.qrHero)).toBe(false);
  });

  it("converts a non-cta scene before the cover into the big-QR beat", () => {
    // Predecessor is ordinary (non-cta) content → still becomes the big-QR beat, with cta
    // forced on so the centered overlay draws (the qrOverlayUrl assembly gate needs cta).
    const scenes = [mk(1), mk(2, { cta: true, coverHero: true })];
    const out = markQrBeforeCover(scenes, withQr);
    expect(out[0].qrHero).toBe(true);
    expect(out[0].cta).toBe(true);
    expect(out[1].qrHero).toBeUndefined(); // cover stays clean
  });

  it("is a no-op when the cover reveal is the very first scene", () => {
    const scenes = [mk(1, { cta: true, coverHero: true }), mk(2)];
    const out = markQrBeforeCover(scenes, withQr);
    expect(out.some(s => s.qrHero)).toBe(false);
  });

  it("splits an over-ceiling qrHero beat, keeping the QR up across the children", () => {
    const beat: StoryboardScene = {
      index: 1,
      scriptText:
        "Some verbatim cta line from the user's script, and it keeps going with a second clause here.",
      narration: "some verbatim cta line",
      visualPrompt: "b-roll of a lawn",
      hostPresent: false,
      cta: true,
      qrHero: true,
      audioDuration: LONG_SCENE_MAX_SEC + 4, // well over the ceiling
    };
    const out = splitOverlongScenes([beat]);
    expect(out.length).toBeGreaterThan(1);
    // No beat is exempt any more — but the flags ride the split, so the big QR holds
    // continuously over the children instead of one arbitrarily long scene.
    expect(out.every(s => s.qrHero === true && s.cta === true)).toBe(true);
  });
});

describe("markCornerQrBeforeCover", () => {
  const mk = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText: `scene ${i}`,
    narration: `scene ${i}`,
    visualPrompt: "b-roll of a lawn",
    hostPresent: true,
    ...extra,
  });
  const withQr: LongformInputParams = {
    ...baseParams,
    qrImageUrl: "https://r2/qr.png",
  };

  it("flags the CORNER_QR_SCENES_BEFORE_COVER scenes before the cover, keeping their register", () => {
    // N+2 scenes, cover last → the N immediately before it get the corner QR; the (N+1)th does not.
    const N = CORNER_QR_SCENES_BEFORE_COVER;
    const scenes = Array.from({ length: N + 2 }, (_, k) =>
      mk(k + 1, k === N + 1 ? { cta: true, coverHero: true } : {})
    );
    const out = markCornerQrBeforeCover(scenes, withQr);
    expect(out.filter(s => s.qrCorner)).toHaveLength(N);
    expect(out[0].qrCorner).toBeUndefined(); // outside the window (N+1 scenes before the cover)
    for (let i = 1; i <= N; i++) {
      expect(out[i].qrCorner).toBe(true);
      // register untouched — a corner card never covers a face
      expect(out[i].hostPresent).toBe(true);
      expect(out[i].stillImage).toBeUndefined();
    }
    expect(out[N + 1].qrCorner).toBeUndefined(); // the cover stays clean
  });

  it("stops the window at a qrHero beat — never crosses into the big-QR block", () => {
    const scenes = [
      mk(1, { qrHero: true }),
      mk(2),
      mk(3),
      mk(4, { cta: true, coverHero: true }),
    ];
    const out = markCornerQrBeforeCover(scenes, withQr);
    expect(out[0].qrCorner).toBeUndefined(); // qrHero beat is the wall
    expect(out[1].qrCorner).toBe(true);
    expect(out[2].qrCorner).toBe(true);
    expect(out[3].qrCorner).toBeUndefined(); // cover clean
  });

  it("stops at another cover beat so a mid-roll and close don't bleed together", () => {
    const scenes = [
      mk(1, { cta: true, coverHero: true }), // mid cover — nothing precedes it
      mk(2),
      mk(3),
      mk(4, { cta: true, coverHero: true }), // close cover
    ];
    const out = markCornerQrBeforeCover(scenes, withQr);
    expect(out[0].qrCorner).toBeUndefined(); // mid cover not pulled into the close window
    expect(out[1].qrCorner).toBe(true);
    expect(out[2].qrCorner).toBe(true);
    expect(out[3].qrCorner).toBeUndefined(); // close cover clean
  });

  it("is a no-op when the channel has no QR image", () => {
    const scenes = [mk(1), mk(2), mk(3, { cta: true, coverHero: true })];
    const out = markCornerQrBeforeCover(scenes, baseParams);
    expect(out.some(s => s.qrCorner)).toBe(false);
  });

  // ── ctaScoped (script had ===CTA=== markers): the window is the marked pitch, not a fixed 6.
  // Staging job 204: the QR arrived 4 scenes into the pitch (block 1) and leaked 3 scenes before
  // ===START CTA=== (block 2) because the fixed lookback ignored the markers.
  it("ctaScoped: covers the WHOLE marked pitch before the cover, even past 6 scenes", () => {
    // job-204 block-1 shape: 10 cta pitch scenes, then the cover.
    const N = CORNER_QR_SCENES_BEFORE_COVER + 4;
    const scenes = [
      mk(0), // pre-marker scene
      ...Array.from({ length: N }, (_, k) => mk(k + 1, { cta: true })),
      mk(N + 1, { cta: true, coverHero: true }),
    ];
    const out = markCornerQrBeforeCover(scenes, withQr, true);
    expect(out[0].qrCorner).toBeUndefined(); // before ===START CTA===
    for (let i = 1; i <= N; i++) expect(out[i].qrCorner).toBe(true);
    expect(out[N + 1].qrCorner).toBeUndefined(); // cover clean
  });

  it("ctaScoped: never leaks onto a scene before ===START CTA===", () => {
    // job-204 block-2 shape: 3 pre-marker scenes inside the old fixed window.
    const scenes = [
      mk(1),
      mk(2),
      mk(3),
      mk(4, { cta: true }),
      mk(5, { cta: true }),
      mk(6, { cta: true, coverHero: true }),
    ];
    const out = markCornerQrBeforeCover(scenes, withQr, true);
    expect(out.filter(s => s.qrCorner).map(s => s.index)).toEqual([4, 5]);
  });

  it("ctaScoped: a qrHero beat is still a wall", () => {
    const scenes = [
      mk(1, { cta: true, qrHero: true }),
      mk(2, { cta: true }),
      mk(3, { cta: true, coverHero: true }),
    ];
    const out = markCornerQrBeforeCover(scenes, withQr, true);
    expect(out[0].qrCorner).toBeUndefined();
    expect(out[1].qrCorner).toBe(true);
  });

  it("ctaScoped: keeps the QR on the pitch AFTER a mid-block cover reveal", () => {
    // The cover now lands on the title-mention beat, which can sit mid-pitch — the scan window
    // must not blink off for the rest of the block.
    const scenes = [
      mk(1),
      mk(2, { cta: true }),
      mk(3, { cta: true, coverHero: true }), // names the book
      mk(4, { cta: true }),
      mk(5, { cta: true, qrHero: true }),
    ];
    const out = markCornerQrBeforeCover(scenes, withQr, true);
    expect(out.filter(s => s.qrCorner).map(s => s.index)).toEqual([2, 4]);
  });
});

describe("qrOverlayUrlFor", () => {
  const QR = "https://r2/qr.png";
  it("draws the QR only on anchored beats — never on plain cta/price or cover scenes", () => {
    expect(qrOverlayUrlFor({ qrHero: true }, QR)).toBe(QR);
    expect(qrOverlayUrlFor({ qrCorner: true }, QR)).toBe(QR);
    // a plain scene (no qrHero/qrCorner — e.g. a dollar-mention cta scene) gets nothing
    expect(qrOverlayUrlFor({}, QR)).toBeUndefined();
    // the cover-reveal beat stays clean even if flagged qrHero
    expect(
      qrOverlayUrlFor({ qrHero: true, coverHero: true }, QR)
    ).toBeUndefined();
    // no channel QR configured → nothing
    expect(qrOverlayUrlFor({ qrHero: true }, undefined)).toBeUndefined();
  });
});

describe("nameCardSceneIndices", () => {
  // "O" = locked cold-open host scene, "H" = ordinary host shot, "b" = cutaway.
  const lanes = (pattern: string) =>
    [...pattern].map(c => ({
      hostPresent: c === "H" || c === "O",
      ...(c === "O" ? { hostOpener: true as const } : {}),
    }));

  it("spans the whole two-angle cold open", () => {
    //                    0123456
    expect(nameCardSceneIndices(lanes("OObbHbH"))).toEqual([0, 1]);
  });

  it("single-scene cold open (channel with no alt host photo)", () => {
    expect(nameCardSceneIndices(lanes("ObbHbbH"))).toEqual([0]);
  });

  it("falls back to the first host shot when no opener survived", () => {
    expect(nameCardSceneIndices(lanes("HbbHbbH"))).toEqual([0]);
    // A leading run of b-roll shifts the first host shot later — positions are in the
    // ASSEMBLED list, not scene.index.
    expect(nameCardSceneIndices(lanes("bbbbHbH"))).toEqual([4]);
  });

  it("only a LEADING opener run counts — no popping back on after a cutaway", () => {
    expect(nameCardSceneIndices(lanes("ObObbH"))).toEqual([0]);
  });

  it("no card when there are no host shots", () => {
    expect(nameCardSceneIndices(lanes("bbbbb"))).toEqual([]);
    expect(nameCardSceneIndices([])).toEqual([]);
  });
});

describe("ensureHostInCta", () => {
  const mk = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText: `scene ${i}`,
    narration: `scene ${i}`,
    visualPrompt: "b-roll of a lawn",
    hostPresent: false,
    ...extra,
  });

  it("flips the first non-hero cta scene to host and leaves the rest b-roll", () => {
    const scenes = [
      mk(1, { cta: true, qrHero: true, stillImage: true }),
      mk(2, { cta: true, stillImage: true, splitVisual: "a book" }),
      mk(3, { cta: true }),
    ];
    ensureHostInCta(scenes);
    // The qrHero stays b-roll; the first eligible cta scene flips, the rest stay b-roll.
    expect(scenes[0].hostPresent).toBe(false);
    expect(scenes[1].hostPresent).toBe(true);
    expect(scenes[1].stillImage).toBe(false);
    expect(scenes[1].splitVisual).toBeUndefined();
    expect(scenes[2].hostPresent).toBe(false);
  });

  it("flips exactly 1 in a long run and leaves the rest b-roll", () => {
    const scenes = [
      mk(1, { cta: true, qrHero: true }),
      mk(2, { cta: true }),
      mk(3, { cta: true }),
      mk(4, { cta: true }),
      mk(5, { cta: true }),
    ];
    ensureHostInCta(scenes);
    expect(scenes.filter(s => s.hostPresent)).toHaveLength(1);
    expect(scenes[1].hostPresent).toBe(true); // first eligible
    expect(scenes[2].hostPresent).toBe(false);
    expect(scenes[3].hostPresent).toBe(false);
    expect(scenes[4].hostPresent).toBe(false);
  });

  it("is a no-op when the run already has a host (quota already met)", () => {
    const scenes = [
      mk(1, { cta: true, qrHero: true }),
      mk(2, { cta: true, hostPresent: true }),
      mk(3, { cta: true }),
      mk(4, { cta: true }),
      mk(5, { cta: true }),
    ];
    ensureHostInCta(scenes);
    // 1 already host meets the quota → nothing else flips.
    expect(scenes.filter(s => s.hostPresent)).toHaveLength(1);
    expect(scenes[1].hostPresent).toBe(true);
    expect(scenes[2].hostPresent).toBe(false);
  });

  it("guarantees one host beat in EACH cta run", () => {
    const scenes = [
      mk(1, { cta: true, qrHero: true }), // run A
      mk(2, { cta: true }),
      mk(3, { cta: true }),
      mk(4, { cta: true }),
      mk(5), // gap
      mk(6, { cta: true, qrHero: true }), // run B
      mk(7, { cta: true }),
      mk(8, { cta: true }),
      mk(9, { cta: true }),
    ];
    ensureHostInCta(scenes);
    // 1 per run, qrHero excluded from both.
    expect(scenes.slice(0, 4).filter(s => s.hostPresent)).toHaveLength(1);
    expect(scenes.slice(5).filter(s => s.hostPresent)).toHaveLength(1);
    expect(scenes.some(s => s.qrHero && s.hostPresent)).toBe(false);
  });

  it("is a no-op when the only cta scene is the qrHero beat", () => {
    const scenes = [mk(1, { cta: true, qrHero: true }), mk(2)];
    ensureHostInCta(scenes);
    expect(scenes.every(s => !s.hostPresent || s.qrHero)).toBe(true);
    expect(scenes[0].hostPresent).toBe(false);
  });

  const hasHostPair = (scenes: StoryboardScene[]) =>
    scenes.some((s, i) => i > 0 && s.hostPresent && scenes[i - 1].hostPresent);

  it("demotes a boundary content host so the flipped CTA host has no host neighbor", () => {
    // enforceVisualAdjacency already ran (no host pairs); flipping the CTA scene to host would
    // otherwise re-create a host↔host pair with the content host beside it.
    const scenes = [
      mk(1, { hostPresent: true, brollVisual: "opener" }), // opening bookend
      mk(2, { stillImage: true }), // separator
      mk(3, { hostPresent: true, brollVisual: "close-up soil" }), // content host at the CTA edge
      mk(4, { cta: true, stillImage: true }), // hostless CTA run
      mk(5, { cta: true, stillImage: true }),
      mk(6, { hostPresent: true, brollVisual: "closer" }), // closing bookend
    ];
    ensureHostInCta(scenes);
    expect(scenes[3].hostPresent).toBe(true); // CTA run got its host (first eligible flips)
    expect(scenes[2].hostPresent).toBe(false); // boundary content host yields
    expect(scenes[2].stillImage).toBe(true);
    expect(scenes[2].visualPrompt).toBe("close-up soil"); // still sourced from its brollVisual
    expect(hasHostPair(scenes)).toBe(false);
  });

  it("leaves the pair when the only host neighbor is the closing bookend (ceiling)", () => {
    const scenes = [
      mk(1, { hostPresent: true, brollVisual: "opener" }),
      mk(2, { stillImage: true }),
      mk(3, { cta: true, stillImage: true }), // single-scene CTA run before the closer
      mk(4, { hostPresent: true, brollVisual: "closer" }), // closing bookend — never demoted
    ];
    ensureHostInCta(scenes);
    expect(scenes[2].hostPresent).toBe(true); // CTA still gets its host
    expect(scenes[3].hostPresent).toBe(true); // closing bookend preserved
    // Documented ceiling: this one host pair is left rather than demote the protected bookend.
    expect(hasHostPair(scenes)).toBe(true);
  });
});

describe("mentionsTitle", () => {
  it("fires on a majority of distinctive tokens (min 1)", () => {
    expect(
      mentionsTitle("buy the garden almanac now", ["garden", "almanac"])
    ).toBe(true);
    expect(
      mentionsTitle("a quiet morning outside", ["garden", "almanac"])
    ).toBe(false);
    // 3 tokens → majority is 2.
    expect(
      mentionsTitle("the garden today", ["garden", "almanac", "secrets"])
    ).toBe(false);
    expect(
      mentionsTitle("garden secrets revealed", ["garden", "almanac", "secrets"])
    ).toBe(true);
  });

  it("matches on word boundaries (no substring false hits)", () => {
    expect(mentionsTitle("she gardened all day", ["garden"])).toBe(false);
    expect(mentionsTitle("the garden is nice", ["garden"])).toBe(true);
  });

  it("is false with no tokens", () => {
    expect(mentionsTitle("the garden almanac", [])).toBe(false);
  });
});

describe("titleMatcher", () => {
  it("fires on the main title alone, which the majority rule misses", () => {
    const title =
      "The Texas BBQ Bible: 101 Pit-Tested Secrets for Perfect Brisket, Ribs & Smoke";
    const line = "in a book I put together called The Texas BBQ Bible.";
    // 3 of 11 tokens — under the majority bar, so the old rule never fired here.
    expect(mentionsTitle(line, getBookNameTokens(title))).toBe(false);
    expect(titleMatcher(title)(line)).toBe(true);
  });

  it("still fires via the majority arm when the spoken title is paraphrased", () => {
    // Host says the number in words, so the "6000" main token never matches.
    expect(
      titleMatcher("Save $6,000 a Year: The Amish Family Manual")(
        "It is called Save Six Thousand Dollars a Year, The Amish Family Manual."
      )
    ).toBe(true);
  });

  it("does not fire on a partial main title", () => {
    const namesBook = titleMatcher("The Old Ways: 50 Forgotten Lawn Secrets");
    expect(namesBook("the old fellas taught me this one")).toBe(false);
    expect(namesBook("a little book I call The Old Ways")).toBe(true);
  });

  it("never fires without a title", () => {
    expect(titleMatcher(undefined)("The Garden Almanac")).toBe(false);
    expect(titleMatcher("")("The Garden Almanac")).toBe(false);
  });

  it("matches a number spoken in words, in either arm", () => {
    expect(
      titleMatcher("Save $9,000 a Year: The Appalachian Homestead Manual")(
        "The rest of Save Nine Thousand Dollars a Year is in the book."
      )
    ).toBe(true);
    expect(
      titleMatcher(
        "The Texas BBQ Bible: 101 Pit-Tested Secrets for Perfect Brisket"
      )("a hundred and one pit-tested secret for perfect brisket")
    ).toBe(true);
  });

  it("tolerates one swapped or dropped word of the main title", () => {
    expect(
      titleMatcher("The Texas BBQ Bible")("the Texas Barbecue Bible")
    ).toBe(true);
    expect(
      titleMatcher(
        "Donna's Whitetail Bible: 101 Field-Tested Tricks to Stop Going Home Empty-Handed"
      )("it's all in the Whitetail Bible")
    ).toBe(true);
  });
});

describe("markCoverReveal", () => {
  const mk = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText: `scene ${i}`,
    narration: `scene ${i}`,
    visualPrompt: "b-roll of a lawn",
    hostPresent: false,
    ...extra,
  });
  const withCover: LongformInputParams = {
    ...baseParams,
    bookCoverImageUrl: "https://r2/cover.png",
    bookTitle: "The Garden Almanac",
  };

  it("marks the first in-CTA title mention as the cover beat, once per run", () => {
    const scenes = [
      mk(1, { cta: true, scriptText: "scan the QR code on screen right now" }),
      mk(2, { cta: true, scriptText: "Grab your Garden Almanac today" }),
      mk(3, { cta: true, scriptText: "the Garden Almanac again" }),
    ];
    markCoverReveal(scenes, withCover);
    expect(scenes[0].coverHero).toBeFalsy(); // this line names no book
    expect(scenes[1].coverHero).toBe(true);
    expect(scenes[1].stillImage).toBe(true);
    expect(scenes[1].hostPresent).toBe(false);
    expect(scenes[2].coverHero).toBeFalsy(); // only the first mention per run
  });

  it("marks a cover beat in EACH cta run", () => {
    const scenes = [
      mk(1, { cta: true, scriptText: "the Garden Almanac is here" }), // run A
      mk(2),
      mk(3),
      mk(4, { cta: true, scriptText: "order the Garden Almanac now" }), // run B
    ];
    markCoverReveal(scenes, withCover);
    expect(scenes.filter(s => s.coverHero)).toHaveLength(2);
    expect(scenes[0].coverHero).toBe(true);
    expect(scenes[3].coverHero).toBe(true);
  });

  it("is a no-op without a cover image or a title", () => {
    const scenes = [mk(1, { cta: true, scriptText: "the Garden Almanac" })];
    expect(markCoverReveal(scenes, baseParams).some(s => s.coverHero)).toBe(
      false
    );
    expect(
      markCoverReveal(scenes, {
        ...baseParams,
        bookCoverImageUrl: "https://r2/c.png",
      }).some(s => s.coverHero)
    ).toBe(false);
  });

  it("marks a beat that names only the main title of a subtitled book", () => {
    const scenes = [
      mk(1, { cta: true, scriptText: "scan the code below" }),
      mk(2, { cta: true, scriptText: "a book I call The Garden Almanac." }),
    ];
    markCoverReveal(scenes, {
      ...withCover,
      bookTitle: "The Garden Almanac: 101 Forgotten Backyard Secrets",
    });
    expect(scenes[1].coverHero).toBe(true);
  });

  it("is a no-op when no cta scene names the book", () => {
    const scenes = [
      mk(1, { cta: true, scriptText: "scan the code below" }),
      mk(2, { cta: true, scriptText: "link in the description" }),
    ];
    markCoverReveal(scenes, withCover);
    expect(scenes.some(s => s.coverHero)).toBe(false);
  });

  it("reveals an UPLOADED book on the first beat even when its title is never spoken", () => {
    // An operator-uploaded book (`ctaBooks`) must appear regardless of the script wording — they
    // named it "sawdust" but never say the word, so title-matching finds nothing.
    const scenes = [
      mk(1, { cta: true, ctaIndex: 0, scriptText: "scan the code below" }),
      mk(2, { cta: true, ctaIndex: 0, scriptText: "link in the description" }),
    ];
    markCoverReveal(scenes, {
      ...baseParams,
      ctaBooks: [
        {
          ctaIndex: 0,
          bookId: 0,
          title: "sawdust",
          coverImageUrl: "https://r2/sawdust.png",
        },
      ],
    });
    expect(scenes[0].coverHero).toBe(true);
    expect(scenes[0].stillImage).toBe(true);
    expect(scenes[0].hostPresent).toBe(false);
    // Only the first beat of the block, not every scene.
    expect(scenes[1].coverHero).toBeFalsy();
  });

  it("still prefers the named beat for an uploaded book when the title IS spoken", () => {
    const scenes = [
      mk(1, { cta: true, ctaIndex: 0, scriptText: "scan the code below" }),
      mk(2, {
        cta: true,
        ctaIndex: 0,
        scriptText: "grab The Old Way Home now",
      }),
    ];
    markCoverReveal(scenes, {
      ...baseParams,
      ctaBooks: [
        {
          ctaIndex: 0,
          bookId: 0,
          title: "The Old Way Home",
          coverImageUrl: "https://r2/home.png",
        },
      ],
    });
    expect(scenes[0].coverHero).toBeFalsy();
    expect(scenes[1].coverHero).toBe(true); // the beat that names it, not the first
  });
});

describe("anchorRegex", () => {
  it("matches the literal phrase and tolerates reflowed whitespace", () => {
    const re = anchorRegex("Now go ahead and grab your phone");
    expect(
      re.test("Now go ahead and grab your phone, and open your camera")
    ).toBe(true);
    expect(re.test("...for you.  Now go\nahead and grab   your phone!")).toBe(
      true
    );
    expect(re.test("go grab your wallet")).toBe(false);
  });

  it("matches any apostrophe variant (straight or curly)", () => {
    const re = anchorRegex("I'll wait right here.");
    expect(re.test("no rush at all. I'll wait right here.")).toBe(true); // straight '
    expect(re.test("no rush at all. I’ll wait right here.")).toBe(true); // curly ’
    expect(re.test("I will wait right here.")).toBe(false);
  });
});

describe("markCtaQrBlock", () => {
  const mk = (
    i: number,
    scriptText: string,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText,
    narration: scriptText.split(" ").slice(0, 8).join(" "),
    visualPrompt: "b-roll of a lawn",
    hostPresent: true,
    ...extra,
  });
  const withQr: LongformInputParams = {
    ...baseParams,
    qrImageUrl: "https://r2/qr.png",
  };
  const withBoth: LongformInputParams = {
    ...withQr,
    bookCoverImageUrl: "https://r2/cover.png",
    bookTitle: "The Old Ways",
  };

  // A pitch where the trigger already starts its own beat (the common segmentation outcome),
  // with the fixed block appearing twice (mid-roll + close).
  const twoBlockScenes = (): StoryboardScene[] => [
    mk(1, "Welcome to the show today."),
    mk(2, "That's the kind of math the catalogs stopped doing for you."),
    mk(3, "Now go ahead and grab your phone, and open up your camera."),
    mk(4, "Point it at that square code on your screen."),
    mk(5, "Take your time, there is no rush at all. I'll wait right here."),
    mk(6, "Alright, neighbor. Saturday morning."),
    mk(7, "And the book has forty-nine more just like it."),
    mk(8, "That is the catalog math once again, my friend."),
    mk(9, "Now go ahead and grab your phone, and open up your camera."),
    mk(10, "Point it at that square code on your screen."),
    mk(11, "Take your time, there is no rush at all. I'll wait right here."),
    mk(12, "So that is the whole weekend, neighbor."),
  ];

  it("fills each occurrence's [trigger..release] with big-QR beats + qrTail on the release", () => {
    const out = markCtaQrBlock(twoBlockScenes(), withBoth);
    // Block 1: 0-idx 2,3,4. Block 2: 0-idx 8,9,10.
    expect(out.filter(s => s.qrHero)).toHaveLength(6);
    [2, 3, 4, 8, 9, 10].forEach(i => {
      expect(out[i].qrHero).toBe(true);
      expect(out[i].cta).toBe(true);
      expect(out[i].stillImage).toBe(true);
      expect(out[i].hostPresent).toBe(false);
    });
    // Only the release beat of each block carries the +3s tail flag.
    expect(out.filter(s => s.qrTail)).toHaveLength(2);
    expect(out[4].qrTail).toBe(true);
    expect(out[10].qrTail).toBe(true);
    expect(out[2].qrTail).toBeFalsy(); // interior QR beat, no tail
  });

  it("falls back to the beat right before each trigger when the pitch never names the book", () => {
    const out = markCtaQrBlock(twoBlockScenes(), withBoth);
    expect(out.filter(s => s.coverHero)).toHaveLength(2);
    expect(out[1].coverHero).toBe(true); // before block 1
    expect(out[7].coverHero).toBe(true); // before block 2
    expect(out[1].qrHero).toBeFalsy(); // cover stays clean (no big QR)
    expect(out[1].stillImage).toBe(true);
    expect(out[1].hostPresent).toBe(false);
  });

  it("reveals the cover on the pitch beat that NAMES the book, not the one before the trigger", () => {
    const scenes = [
      mk(1, "Let me show you something, neighbor.", { cta: true }),
      mk(2, "This little book is called The Old Ways.", { cta: true }),
      mk(3, "It has forty-nine more tricks just like it.", { cta: true }),
      mk(4, "That's the kind of math the catalogs stopped doing.", {
        cta: true,
      }),
      mk(5, "Now go ahead and grab your phone, and open your camera.", {
        cta: true,
      }),
      mk(6, "Take your time. I'll wait right here.", { cta: true }),
      mk(7, "Alright, back to the lawn."),
    ];
    const out = markCtaQrBlock(scenes, withBoth, true);
    expect(out.filter(s => s.coverHero)).toHaveLength(1);
    expect(out[1].coverHero).toBe(true); // the title mention
    expect(out[1].stillImage).toBe(true);
    expect(out[1].hostPresent).toBe(false);
    expect(out[3].coverHero).toBeFalsy(); // no longer the beat before the trigger
    expect(out[4].qrHero).toBe(true); // block still anchors normally
    expect(out[5].qrTail).toBe(true);
  });

  it("gives each block its own cover at its own title mention", () => {
    const block = (n: number, extra = "") => [
      mk(n, `A quick word${extra}.`, { cta: true }),
      mk(n + 1, "The book is called The Old Ways, neighbor.", { cta: true }),
      mk(n + 2, "Forty-nine more tricks in there.", { cta: true }),
      mk(n + 3, "Now go ahead and grab your phone.", { cta: true }),
      mk(n + 4, "I'll wait right here.", { cta: true }),
    ];
    const scenes = [
      ...block(1),
      mk(6, "Back to the beds."),
      ...block(7, " again"),
    ];
    const out = markCtaQrBlock(scenes, withBoth, true);
    expect(out.filter(s => s.coverHero).map(s => s.index)).toEqual([2, 8]);
  });

  it("splits a beat so the QR starts EXACTLY on the trigger when it was mid-chunk", () => {
    const scenes = [
      mk(
        1,
        "That's the catalog math. Now go ahead and grab your phone, and scan."
      ),
      mk(2, "Take your time. I'll wait right here."),
    ];
    const out = markCtaQrBlock(scenes, withBoth);
    const before = out.find(s => s.scriptText === "That's the catalog math.");
    const qrStart = out.find(s =>
      (s.scriptText ?? "").startsWith("Now go ahead")
    );
    expect(qrStart?.qrHero).toBe(true);
    expect(before?.qrHero).toBeFalsy();
    expect(before?.coverHero).toBe(true); // the remainder becomes the cover beat
  });

  it("anchors a block whose trigger segmentation split across a scene boundary", () => {
    // The mid-roll bug: the chunk break fell mid-phrase, so "Now go ahead" trails scene 1 and
    // "and grab your phone" opens scene 2 — neither scene holds the whole trigger on its own.
    const scenes = [
      mk(
        1,
        "That's the kind of math the catalogs stopped doing for you. Now go ahead"
      ),
      mk(2, "and grab your phone, and open up your camera."),
      mk(3, "Point it at that square code on your screen."),
      mk(4, "Take your time, there is no rush at all. I'll wait right here."),
      mk(5, "Alright, neighbor, back to the lawn."),
    ];
    const out = markCtaQrBlock(scenes, withBoth);
    const qrStart = out.find(s =>
      (s.scriptText ?? "").startsWith("Now go ahead")
    );
    expect(qrStart?.qrHero).toBe(true); // re-joined phrase now anchors the block
    const cover = out.find(s =>
      (s.scriptText ?? "").endsWith("doing for you.")
    );
    expect(cover?.coverHero).toBe(true); // beat before the trigger reveals the cover
    expect(cover?.qrHero).toBeFalsy();
    const release = out.find(s =>
      (s.scriptText ?? "").endsWith("I'll wait right here.")
    );
    expect(release?.qrHero).toBe(true);
    expect(release?.qrTail).toBe(true);
    const after = out.find(s => (s.scriptText ?? "").startsWith("Alright"));
    expect(after?.qrHero).toBeFalsy(); // block ends on the release
  });

  it("splits off trailing text after the release so the block ends exactly on it", () => {
    const scenes = [
      mk(1, "Now go ahead and grab your phone."),
      mk(2, "I'll wait right here. Alright, neighbor, back to the lawn."),
    ];
    const out = markCtaQrBlock(scenes, withQr);
    const release = out.find(s =>
      (s.scriptText ?? "").endsWith("I'll wait right here.")
    );
    const trailing = out.find(s => (s.scriptText ?? "").startsWith("Alright"));
    expect(release?.qrHero).toBe(true);
    expect(release?.qrTail).toBe(true);
    expect(trailing?.qrHero).toBeFalsy(); // next section is not part of the block
  });

  it("marks the QR block but no cover when no cover image is configured", () => {
    const out = markCtaQrBlock(twoBlockScenes(), withQr);
    expect(out.some(s => s.qrHero)).toBe(true);
    expect(out.some(s => s.coverHero)).toBe(false);
  });

  it("is a no-op when the channel has no QR image", () => {
    const out = markCtaQrBlock(twoBlockScenes(), baseParams);
    expect(out.some(s => s.qrHero)).toBe(false);
    expect(out.some(s => s.coverHero)).toBe(false);
    expect(out.some(s => s.qrTail)).toBe(false);
  });

  it("falls back to the legacy title-mention placement when the block is absent", () => {
    const scenes = [
      mk(1, "Let me tell you about a book.", { cta: true }),
      mk(2, "This little book is called The Old Ways.", { cta: true }),
      mk(3, "Order it today, friend.", { cta: true }),
    ];
    const out = markCtaQrBlock(scenes, withBoth);
    // No trigger present → markCoverReveal (title mention) + markQrBeforeCover run.
    expect(out[1].coverHero).toBe(true);
    expect(out[0].qrHero).toBe(true);
  });

  it("renumbers to a contiguous 1..n and is idempotent", () => {
    const first = markCtaQrBlock(twoBlockScenes(), withBoth);
    first.forEach((s, i) => expect(s.index).toBe(i + 1));
    const heroes = first.filter(s => s.qrHero).length;
    const again = markCtaQrBlock(first, withBoth);
    expect(again.filter(s => s.qrHero)).toHaveLength(heroes);
    expect(again.filter(s => s.qrTail)).toHaveLength(2);
    expect(again.filter(s => s.coverHero)).toHaveLength(2);
  });

  it("ctaScoped: the trigger only anchors inside marker-flagged CTA scenes", () => {
    // Same two-block layout, but only the SECOND block sits inside a marked span
    // (cta:true). The first block's trigger is a stray sound-alike outside the markers.
    const scenes = twoBlockScenes();
    [7, 8, 9, 10].forEach(i => (scenes[i].cta = true));
    const out = markCtaQrBlock(scenes, withBoth, true);
    // Only block 2 (0-idx 8,9,10) becomes big-QR beats; block 1 is untouched.
    expect(out.filter(s => s.qrHero).map(s => s.index)).toEqual([9, 10, 11]);
    expect(out[2].qrHero).toBeFalsy();
    expect(out.filter(s => s.coverHero)).toHaveLength(1);
    expect(out[7].coverHero).toBe(true); // beat right before the in-span trigger
  });

  it("ctaScoped: no trigger inside the marked span → QR on the tail of the block", () => {
    const scenes = [
      mk(1, "Let me tell you about a book.", { cta: true }),
      mk(2, "This little book is called The Old Ways.", { cta: true }),
      mk(3, "Now go ahead and grab your phone, and open up your camera."),
    ];
    const out = markCtaQrBlock(scenes, withBoth, true);
    // The out-of-span trigger never anchors a QR block. The marked span is shorter than
    // one guidance block, so the whole of it becomes the QR window.
    expect(out[2].qrHero).toBeFalsy();
    expect(out.filter(s => s.qrHero).map(s => s.index)).toEqual([1, 2]);
    expect(out[1].qrTail).toBe(true);
  });

  it("ctaScoped fallback: rotating QR wording still gets a QR window + cover reveal", () => {
    const scenes = [
      mk(1, "Welcome to the show today."),
      mk(2, `${"word ".repeat(80)}selling the book here.`, { cta: true }),
      mk(3, "Point your camera at the square code on the screen.", {
        cta: true,
      }),
      mk(4, "Give the link a tap, and I will be right here waiting.", {
        cta: true,
      }),
      mk(5, "Alright, neighbor. Saturday morning."),
    ];
    const out = markCtaQrBlock(scenes, withBoth, true);
    // Tail of the marked run becomes the QR window; the long sell beat stays a normal beat.
    expect(out.filter(s => s.qrHero).map(s => s.index)).toEqual([3, 4]);
    expect(out[3].qrTail).toBe(true);
    expect(out[1].coverHero).toBe(true); // beat right before the window
    expect(out[4].qrHero).toBeFalsy(); // post-CTA narration untouched
  });

  it("ctaScoped fallback: handles both marked blocks independently", () => {
    const scenes = twoBlockScenes();
    [2, 3, 4, 8, 9, 10].forEach(i => (scenes[i].cta = true));
    // Strip the verbatim trigger so only the fallback path can fire.
    scenes.forEach(s => {
      s.scriptText = s.scriptText!.replace(
        "Now go ahead and grab your phone",
        "Go on and get your phone out"
      );
      s.narration = s.scriptText;
    });
    const out = markCtaQrBlock(scenes, withBoth, true);
    expect(out.filter(s => s.qrTail).map(s => s.index)).toEqual([5, 11]);
    expect(out.filter(s => s.coverHero).map(s => s.index)).toEqual([2, 8]);
    expect(out[0].qrHero).toBeFalsy();
  });
});

describe("parseCtaMarkers", () => {
  const script = [
    "Take a good look at that old fellow.",
    "===START CTA===",
    "That's the spine of a book I put together. Seventeen dollars right now.",
    "Now go ahead and grab your phone. I'll wait right here.",
    "===END CTA===",
    "Alright, come on down to the water with me.",
    "===START CTA===",
    "Nobody could sell it to me, so I wrote the book. Here's all you do.",
    "===END CTA===",
    "Keep your wind right and your coffee hot.",
  ].join("\n");

  it("strips the marker lines and returns word-offset spans for both blocks", () => {
    const { script: clean, spans, errors } = parseCtaMarkers(script);
    expect(errors).toEqual([]);
    expect(clean).not.toContain("===");
    // Block 1: after 8 intro words, 13 + 11 pitch words. Block 2 after 9 more content words.
    expect(spans).toEqual([
      { start: 8, end: 32 },
      { start: 41, end: 56 },
    ]);
    // Word accounting matches the cleaned script exactly.
    const words = clean.split(/\s+/).filter(Boolean);
    expect(words[8]).toBe("That's");
    expect(words[31]).toBe("here.");
    expect(words[41]).toBe("Nobody");
    expect(words.length).toBe(56 + 8); // 8 trailing outro words
  });

  it("returns a markerless script unchanged with no spans", () => {
    const input = "Just a plain script.\n\nWith two paragraphs.";
    const out = parseCtaMarkers(input);
    expect(out).toEqual({ script: input, spans: [], errors: [] });
  });

  it("flags END before START", () => {
    const out = parseCtaMarkers("Intro.\n===END CTA===\nMore.");
    expect(out.errors).toEqual([
      "===END CTA=== without a preceding ===START CTA===",
    ]);
  });

  it("flags an unclosed START", () => {
    const out = parseCtaMarkers("Intro.\n===START CTA===\nPitch.");
    expect(out.errors).toEqual([
      "===START CTA=== without a closing ===END CTA===",
    ]);
  });

  it("flags a nested START", () => {
    const out = parseCtaMarkers(
      "===START CTA===\nPitch.\n===START CTA===\nMore.\n===END CTA==="
    );
    expect(out.errors).toEqual([
      "===START CTA=== while the previous block is still open",
    ]);
  });

  it("drops an empty block and tolerates surrounding spaces on the marker line", () => {
    const out = parseCtaMarkers(
      "Intro.\n  ===START CTA===  \n===END CTA===\nOutro."
    );
    expect(out.errors).toEqual([]);
    expect(out.spans).toEqual([]);
    expect(out.script).toBe("Intro.\nOutro.");
  });

  it("does NOT match the tolerant/lowercase variants (exact markers only)", () => {
    const out = parseCtaMarkers("== start cta ==\nPitch.\n== end cta ==");
    expect(out.spans).toEqual([]);
    expect(out.errors).toEqual([]);
    expect(out.script).toContain("== start cta ==");
  });
});

describe("validateCtaMarkers", () => {
  it("parses markers from the spoken portion of a templated script", () => {
    const raw = [
      "Host (identity lock):",
      "* an old fisherman",
      "=== SCRIPT ===",
      "Intro words here.",
      "===START CTA===",
      "Buy the book, friend.",
      "===END CTA===",
      "Outro.",
    ].join("\n");
    const out = validateCtaMarkers(raw);
    expect(out.errors).toEqual([]);
    expect(out.spans).toEqual([{ start: 3, end: 7 }]);
  });

  it("surfaces pairing errors", () => {
    const out = validateCtaMarkers("Intro.\n===START CTA===\nPitch.");
    expect(out.errors).toHaveLength(1);
  });
});

describe("markCtaFromSpans", () => {
  const mk = (
    i: number,
    scriptText: string,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText,
    narration: scriptText.split(" ").slice(0, 8).join(" "),
    visualPrompt: "b-roll of a lake",
    hostPresent: false,
    ...extra,
  });

  it("flags exactly the in-span scenes; heuristics and stray flags are overridden", () => {
    const scenes = [
      mk(1, "Intro words here."), // words 0-2
      mk(2, "Buy the book at example.com today please."), // words 3-9
      mk(3, "Outro about the $2 pantry powder trick.", { cta: true }), // words 10-16, stray flag + price signal
    ];
    markCtaFromSpans(scenes, [{ start: 3, end: 10 }]);
    expect(scenes.map(s => s.cta)).toEqual([false, true, false]);
    scenes.forEach((s, i) => expect(s.index).toBe(i + 1));
  });

  it("splits a scene the span START lands inside, so the block starts exactly on the marker", () => {
    const scenes = [mk(1, "Regular content. Buy now friend.")];
    markCtaFromSpans(scenes, [{ start: 2, end: 5 }]);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].scriptText).toBe("Regular content.");
    expect(scenes[0].cta).toBe(false);
    expect(scenes[1].scriptText).toBe("Buy now friend.");
    expect(scenes[1].cta).toBe(true);
    expect(scenes.map(s => s.index)).toEqual([1, 2]);
  });

  it("splits a scene the span END lands inside", () => {
    const scenes = [mk(1, "Buy now friend. Regular content.")];
    markCtaFromSpans(scenes, [{ start: 0, end: 3 }]);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].scriptText).toBe("Buy now friend.");
    expect(scenes[0].cta).toBe(true);
    expect(scenes[1].scriptText).toBe("Regular content.");
    expect(scenes[1].cta).toBe(false);
  });

  it("handles a scene that fully contains a whole span (two splits)", () => {
    const scenes = [mk(1, "Before words. Buy the book. After words.")];
    markCtaFromSpans(scenes, [{ start: 2, end: 5 }]);
    expect(scenes.map(s => s.scriptText)).toEqual([
      "Before words.",
      "Buy the book.",
      "After words.",
    ]);
    expect(scenes.map(s => s.cta)).toEqual([false, true, false]);
    expect(scenes.map(s => s.index)).toEqual([1, 2, 3]);
  });

  it("is a no-op with no spans", () => {
    const scenes = [mk(1, "Buy at example.com.", { cta: true })];
    markCtaFromSpans(scenes, []);
    expect(scenes[0].cta).toBe(true); // untouched — heuristic path owns this case
  });
});

describe("coalesceShortScenes", () => {
  const mk = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    scriptText: `text ${i}`,
    narration: `text ${i}`,
    visualPrompt: "b-roll of a lawn",
    hostPresent: false,
    audioUrl: `a${i}`,
    audioDuration: 4,
    ...extra,
  });

  it("merges a sub-floor scene into a neighbor and clears audio for re-voice", () => {
    const scenes = [mk(1), mk(2, { audioDuration: 1 }), mk(3)];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    expect(out.map(s => s.index)).toEqual([1, 2]);
    // Tie on neighbor length (4s each) → merge into prev; combined verbatim text, audio cleared.
    expect(out[0].scriptText).toBe("text 1 text 2");
    expect(out[0].audioUrl).toBeUndefined();
    expect(out[0].audioDuration).toBeUndefined();
  });

  it("prefers the shorter neighbor", () => {
    const scenes = [
      mk(1, { audioDuration: 5 }),
      mk(2, { audioDuration: 1 }),
      mk(3, { audioDuration: 3 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    // next (3s) is shorter than prev (5s) → merge forward, visuals/text from the merge.
    expect(out[1].scriptText).toBe("text 2 text 3");
  });

  it("holds the frame to the floor when the only neighbors are hero beats", () => {
    const scenes = [
      mk(1, { audioDuration: 6, qrHero: true }),
      mk(2, { audioDuration: 1, audioUrl: "a2" }),
      mk(3, { audioDuration: 6, coverHero: true }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(3); // both neighbors exempt → no merge
    expect(out[1].audioDuration).toBe(SCENE_MIN_HOLD_SEC);
    expect(out[1].audioUrl).toBe("a2"); // kept — held, not re-voiced
  });

  it("folds across a cta boundary via the relaxed tier and keeps the QR", () => {
    const scenes = [
      mk(1, { audioDuration: 4 }),
      mk(2, { audioDuration: 1, cta: true }),
      mk(3, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2); // no strict neighbor, but the relaxed tier merges
    // The QR overlay survives the cross-cta fold (merge ORs the cta flag).
    expect(out.some(s => s.cta === true)).toBe(true);
    expect(out.some(s => s.scriptText.includes("text 2"))).toBe(true);
  });

  it("floors a sub-floor scene in place rather than merging past the ceiling", () => {
    const scenes = [
      mk(1, { audioDuration: 9.5 }),
      mk(2, { audioDuration: 1, audioUrl: "a2" }),
      mk(3, { audioDuration: 9.5 }),
    ];
    const out = coalesceShortScenes(scenes);
    // Either fold would breach LONG_SCENE_MAX_SEC and undo the split that ran first,
    // so the short beat stays and holds its floor (freeze + silent pad in assembly).
    expect(out).toHaveLength(3);
    expect(out[1].audioDuration).toBe(SCENE_MIN_HOLD_SEC);
    expect(out[1].audioUrl).toBe("a2"); // kept — held, not re-voiced
  });

  it("still folds a sub-floor scene when the merge fits under the ceiling", () => {
    const scenes = [
      mk(1, { audioDuration: 6 }),
      mk(2, { audioDuration: 1, audioUrl: "a2" }),
      mk(3, { audioDuration: 6 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2); // 1 + 6 = 7 ≤ ceiling
    expect(out.some(s => s.scriptText.includes("text 2"))).toBe(true);
    expect(out[0].audioDuration).toBeUndefined(); // merged → cleared for re-voice
  });

  it("never merges into a qrHero/coverHero neighbor, and never merges an exempt beat", () => {
    // Short cta scene between a qrHero and an ordinary cta scene → folds into the ordinary one.
    const a = coalesceShortScenes([
      mk(1, { audioDuration: 4, cta: true, qrHero: true }),
      mk(2, { audioDuration: 1, cta: true }),
      mk(3, { audioDuration: 4, cta: true }),
    ]);
    expect(a).toHaveLength(2);
    expect(a[0].qrHero).toBe(true);
    expect(a[1].scriptText).toBe("text 2 text 3");
    // A short coverHero beat itself is exempt — left untouched.
    const b = coalesceShortScenes([
      mk(1, { audioDuration: 4, cta: true }),
      mk(2, { audioDuration: 1, cta: true, coverHero: true }),
      mk(3, { audioDuration: 4, cta: true }),
    ]);
    expect(b).toHaveLength(3);
    expect(b[1].coverHero).toBe(true);
    expect(b[1].audioDuration).toBe(1);
  });

  it("keeps the host register when a short host opener folds forward into b-roll", () => {
    const scenes = [
      mk(1, {
        audioDuration: 1,
        hostPresent: true,
        visualPrompt: "host talking head",
      }),
      mk(2, { audioDuration: 4 }),
      mk(3, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    expect(out[0].scriptText).toBe("text 1 text 2");
    // The opener must stay host — the b-roll neighbor's visuals don't win.
    expect(out[0].hostPresent).toBe(true);
    expect(out[0].visualPrompt).toBe("host talking head");
  });

  it("keeps the host register when a short host closer folds backward into b-roll", () => {
    const scenes = [
      mk(1, { audioDuration: 4 }),
      mk(2, { audioDuration: 4 }),
      mk(3, {
        audioDuration: 1,
        hostPresent: true,
        visualPrompt: "host talking head",
      }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    expect(out[1].scriptText).toBe("text 2 text 3");
    expect(out[1].hostPresent).toBe(true);
    expect(out[1].visualPrompt).toBe("host talking head");
  });

  it("lengthens a host scene under HOST_MIN_HOLD_SEC (in band for b-roll)", () => {
    const scenes = [
      mk(1, { audioDuration: 4 }),
      mk(2, {
        audioDuration: 3.5, // ≥ the 3s cutaway floor, under the 4s host floor
        hostPresent: true,
        visualPrompt: "host talking head",
      }),
      mk(3, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    // The host beat got LONGER (gained a neighbor's text) and kept its register.
    const host = out.find(s => s.hostPresent)!;
    expect(host.scriptText).toContain("text 2");
    expect(host.visualPrompt).toBe("host talking head");
    expect(host.audioDuration).toBeUndefined(); // merged → re-voiced as one take
  });

  it("leaves a 3.5s b-roll scene alone — the 4s floor is host-only", () => {
    const scenes = [mk(1), mk(2, { audioDuration: 3.5 }), mk(3)];
    expect(coalesceShortScenes(scenes)).toHaveLength(3);
  });

  it("holds a short host scene to HOST_MIN_HOLD_SEC when both neighbors are heroes", () => {
    const scenes = [
      mk(1, { audioDuration: 6, qrHero: true }),
      mk(2, { audioDuration: 3.5, hostPresent: true, audioUrl: "a2" }),
      mk(3, { audioDuration: 6, coverHero: true }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(3);
    expect(out[1].audioDuration).toBe(HOST_MIN_HOLD_SEC);
  });

  it("WORD_SIZE metric: a host chunk under the host word floor merges pre-TTS", () => {
    // Between FLOOR_WORDS (≈3s) and the host floor (≈4s worth of words) — in band for
    // b-roll, short for host, so only the host copy folds.
    const hostFloorWords = Math.round(HOST_MIN_HOLD_SEC * WORDS_PER_SEC);
    const shortText = Array(FLOOR_WORDS + 1)
      .fill("word")
      .join(" ");
    expect(FLOOR_WORDS + 1).toBeLessThan(hostFloorWords);
    const long = Array(FLOOR_WORDS + 2)
      .fill("word")
      .join(" ");
    const build = (mid: Partial<StoryboardScene>) =>
      [
        mk(1, { scriptText: long, audioDuration: undefined }),
        mk(2, { scriptText: shortText, audioDuration: undefined, ...mid }),
        mk(3, { scriptText: long, audioDuration: undefined }),
      ] as StoryboardScene[];
    expect(coalesceShortScenes(build({}), WORD_SIZE)).toHaveLength(3);
    expect(
      coalesceShortScenes(build({ hostPresent: true }), WORD_SIZE)
    ).toHaveLength(2);
  });

  it("WORD_SIZE metric: merges a scene under FLOOR_WORDS by text, pre-TTS", () => {
    const longText = Array(FLOOR_WORDS + 2)
      .fill("word")
      .join(" ");
    const short = "too few"; // 2 words < FLOOR_WORDS (8)
    // No audioDuration set (pre-TTS): the default MEASURED metric would skip these (size 0),
    // but WORD_SIZE keys on wordCount, so the short middle scene folds into a neighbor.
    const scenes = [
      mk(1, {
        scriptText: longText,
        audioUrl: undefined,
        audioDuration: undefined,
      }),
      mk(2, {
        scriptText: short,
        audioUrl: undefined,
        audioDuration: undefined,
      }),
      mk(3, {
        scriptText: longText,
        audioUrl: undefined,
        audioDuration: undefined,
      }),
    ];
    const out = coalesceShortScenes(scenes, WORD_SIZE);
    expect(out).toHaveLength(2);
    // Merged text keeps both slices verbatim; no audioDuration floor mutation on the word path.
    expect(out.some(s => s.scriptText.includes("too few"))).toBe(true);
    expect(out.every(s => s.audioDuration === undefined)).toBe(true);
  });

  it("a sub-floor scene never folds BACKWARDS into the locked cold open", () => {
    // Scene 3 is sub-floor and its only neighbors are the opener (exempt) and a long scene.
    // Folding into the opener would blow past the ~6s it was deliberately packed to.
    const scenes = [
      mk(1, { hostPresent: true, hostOpener: true, audioDuration: 6 }),
      mk(2, { hostPresent: true, hostOpener: true, audioDuration: 6 }),
      mk(3, { audioDuration: 1 }),
      mk(4, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out[0].audioDuration).toBe(6);
    expect(out[1].audioDuration).toBe(6);
    expect(out[1].scriptText).toBe("text 2"); // untouched — nothing merged in
    // The runt still went somewhere: it folded FORWARD into scene 4 instead.
    expect(out).toHaveLength(3);
    expect(out[2].scriptText).toBe("text 3 text 4");
  });

  it("a sub-floor cold open folds FORWARD, so it speaks its floor instead of padding", () => {
    // The opener is packed for 4s of words up front; when the real voice lands under it, the
    // shot must get LONGER (absorb the next scene) rather than freeze-hold over inserted silence.
    const scenes = [
      mk(1, {
        hostPresent: true,
        hostOpener: true,
        audioDuration: 2.5,
        visualPrompt: "host talking head",
      }),
      mk(2, { audioDuration: 4 }),
      mk(3, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    // The opener survived the merge and kept its lock + register; no floor pad was applied.
    expect(out[0].scriptText).toBe("text 1 text 2");
    expect(out[0].hostOpener).toBe(true);
    expect(out[0].hostPresent).toBe(true);
    expect(out[0].visualPrompt).toBe("host talking head");
    expect(out[0].audioDuration).toBeUndefined(); // re-sliced from the master timeline
  });

  it("a sub-floor scene 2 opener absorbs scene 3, never scene 1", () => {
    const opener = { hostPresent: true, hostOpener: true as const };
    const scenes = [
      mk(1, { ...opener, audioDuration: 6 }),
      mk(2, { ...opener, audioDuration: 2.5 }),
      mk(3, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(2);
    expect(out[0].scriptText).toBe("text 1"); // scene 1 untouched
    expect(out[0].audioDuration).toBe(6);
    expect(out[1].scriptText).toBe("text 2 text 3");
    expect(out[1].hostOpener).toBe(true);
  });

  it("a sub-floor scene 1 pads rather than swallow the second locked opener", () => {
    // Two host photos → a two-angle open. Merging scene 1 into scene 2 would collapse it to one
    // shot, so this lone case orphans and takes the floor pad instead.
    const opener = { hostPresent: true, hostOpener: true as const };
    const scenes = [
      mk(1, { ...opener, audioDuration: 2.5 }),
      mk(2, { ...opener, audioDuration: 5 }),
      mk(3, { audioDuration: 4 }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(3);
    expect(out[0].audioDuration).toBe(HOST_MIN_HOLD_SEC);
    expect(out[0].scriptText).toBe("text 1");
    expect(out[1].scriptText).toBe("text 2");
  });

  it("borrows a clause instead of freeze-padding when no merge fits (job 218 shape)", () => {
    // The real failure: a 2.81s host beat wedged between 6.93s and 6.23s b-roll. Both folds
    // breach the 8s ceiling, so it used to be floored to 4s while its lip-sync clip rendered at
    // the true 2.81s — assembly clone-padded the gap and the host's face froze for 0.76s.
    const scenes = [
      mk(1, {
        audioDuration: 6.93,
        scriptText:
          "The soil was cold that spring, and the seedlings barely moved.",
      }),
      mk(2, {
        hostPresent: true,
        audioDuration: 2.81,
        scriptText: "Nobody expected what happened next.",
      }),
      mk(3, {
        audioDuration: 6.23,
        scriptText:
          "By June the beds had filled in, and the whole yard smelled of basil.",
      }),
    ];
    const before = scenes.map(s => s.scriptText).join(" ");
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(3); // boundary moved — nothing merged away
    // Scene 1 had the most to spare, so its trailing clause crossed the seam.
    expect(out[0].scriptText).toBe("The soil was cold that spring,");
    expect(out[1].scriptText).toBe(
      "and the seedlings barely moved. Nobody expected what happened next."
    );
    // Verbatim cover: the master read is untouched, only the cut points moved.
    expect(out.map(s => s.scriptText).join(" ")).toBe(before);
    // NOT floored — both sides are re-sliced off the master by assignSceneRanges next.
    expect(out[0].audioDuration).toBeUndefined();
    expect(out[1].audioDuration).toBeUndefined();
    expect(out[1].audioUrl).toBeUndefined();
    expect(out[1].hostPresent).toBe(true); // still the host's beat
  });

  it("floors in place when the donor would itself drop sub-floor", () => {
    // Neighbors are long enough to block the merge (3.5 + 4.6 > 8) but too short to give a clause
    // away without breaching their own floor → unchanged orphan behaviour.
    const scenes = [
      mk(1, {
        audioDuration: 4.6,
        scriptText: "One half of this sentence, and then the other half of it.",
      }),
      mk(2, { hostPresent: true, audioDuration: 3.5, audioUrl: "a2" }),
      mk(3, {
        audioDuration: 4.7,
        scriptText:
          "Another split sentence here, followed by a matching second clause.",
      }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(3);
    expect(out[1].audioDuration).toBe(HOST_MIN_HOLD_SEC);
    expect(out[1].audioUrl).toBe("a2"); // held, not re-cut
    expect(out[0].scriptText).toBe(
      "One half of this sentence, and then the other half of it."
    );
  });

  it("never borrows from a hero beat, however much text it has to spare", () => {
    const scenes = [
      mk(1, {
        qrHero: true,
        audioDuration: 6.5,
        scriptText: "First clause here, second clause there.",
      }),
      mk(2, { hostPresent: true, audioDuration: 2.8, audioUrl: "a2" }),
      mk(3, {
        coverHero: true,
        audioDuration: 6.5,
        scriptText: "Third clause here, fourth clause there.",
      }),
    ];
    const out = coalesceShortScenes(scenes);
    expect(out).toHaveLength(3);
    expect(out[0].scriptText).toBe("First clause here, second clause there.");
    expect(out[2].scriptText).toBe("Third clause here, fourth clause there.");
    expect(out[1].audioDuration).toBe(HOST_MIN_HOLD_SEC); // last resort still stands
  });
});

describe("applySceneHoldFloor", () => {
  const mk = (extra: Partial<StoryboardScene> = {}): StoryboardScene => ({
    index: 1,
    scriptText: "text",
    narration: "text",
    visualPrompt: "b-roll of a lawn",
    hostPresent: false,
    audioUrl: "a1",
    audioDuration: 4,
    ...extra,
  });

  it("holds a sub-floor scene to SCENE_MIN_HOLD_SEC", () => {
    const s = mk({ audioDuration: 2 });
    applySceneHoldFloor(s);
    expect(s.audioDuration).toBe(SCENE_MIN_HOLD_SEC);
  });

  it("holds a host scene to the taller HOST_MIN_HOLD_SEC", () => {
    const s = mk({ audioDuration: 3.5, hostPresent: true });
    applySceneHoldFloor(s);
    expect(s.audioDuration).toBe(HOST_MIN_HOLD_SEC);
    // Same length on a cutaway is already in band.
    const broll = mk({ audioDuration: 3.5 });
    applySceneHoldFloor(broll);
    expect(broll.audioDuration).toBe(3.5);
  });

  it("leaves an in-band scene untouched", () => {
    const s = mk({ audioDuration: 4.2 });
    applySceneHoldFloor(s);
    expect(s.audioDuration).toBe(4.2);
  });

  it("never raises an unvoiced (0/undefined) scene", () => {
    const zero = mk({ audioDuration: 0 });
    applySceneHoldFloor(zero);
    expect(zero.audioDuration).toBe(0);
    const undef = mk({ audioDuration: undefined });
    applySceneHoldFloor(undef);
    expect(undef.audioDuration).toBeUndefined();
  });

  it("leaves the qrHero beat untouched (runs whole, exempt)", () => {
    const s = mk({ audioDuration: 1, qrHero: true });
    applySceneHoldFloor(s);
    expect(s.audioDuration).toBe(1);
  });

  it("does not pad a qrHero+qrTail beat (the +3s tail is added in assembly, not here)", () => {
    const s = mk({ audioDuration: 5, qrHero: true, qrTail: true });
    applySceneHoldFloor(s);
    expect(s.audioDuration).toBe(5);
  });

  it("leaves the cover reveal untouched — ends with narration, no silent hold", () => {
    const short = mk({ audioDuration: 2, coverHero: true });
    applySceneHoldFloor(short);
    expect(short.audioDuration).toBe(2);
    const long = mk({ audioDuration: 7, coverHero: true });
    applySceneHoldFloor(long);
    expect(long.audioDuration).toBe(7);
  });
});

describe("splitIntoUnits", () => {
  const reproduce = (s: string) =>
    splitIntoUnits(s)
      .map(u => s.slice(u.start, u.end))
      .join("");

  it("offset spans tile the whole script (verbatim reproduction)", () => {
    for (const s of [
      "One. Two. Three.",
      "No trailing punctuation",
      "Mr. Smith paid $3.50 today. Then he left.",
      "Single sentence only.",
      "Question? Exclaim! Done.",
    ]) {
      expect(reproduce(s)).toBe(s);
    }
  });

  it("numbers units from 1 and trims display text", () => {
    const u = splitIntoUnits("First. Second.");
    expect(u.map(x => x.index)).toEqual([1, 2]);
    expect(u[0].text).toBe("First.");
    expect(u[1].text).toBe("Second.");
  });

  it("returns the whole script as one unit when there is no sentence break", () => {
    const u = splitIntoUnits("just words no period");
    expect(u).toHaveLength(1);
    expect(u[0].text).toBe("just words no period");
  });

  it("returns nothing for empty input", () => {
    expect(splitIntoUnits("")).toEqual([]);
  });
});

describe("groupUnitsForFallback", () => {
  it("produces a contiguous, complete cover of the script offsets", () => {
    const script =
      "Alpha one. Beta two. Gamma three. Delta four. Epsilon five. Zeta six.";
    const units = splitIntoUnits(script);
    const groups = groupUnitsForFallback(units);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups[0].start).toBe(0);
    expect(groups[groups.length - 1].end).toBe(script.length);
    for (let i = 1; i < groups.length; i++) {
      expect(groups[i].start).toBe(groups[i - 1].end);
    }
    expect(groups.map(g => script.slice(g.start, g.end)).join("")).toBe(script);
  });
});

describe("repairPartition", () => {
  const r = (startUnit: number, endUnit: number) => ({ startUnit, endUnit });

  it("passes a clean contiguous partition through unchanged", () => {
    const out = repairPartition([r(1, 2), r(3, 4)], 4);
    expect(out.map(x => [x.startUnit, x.endUnit])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("snaps gaps/overlaps into a contiguous cover of 1..M", () => {
    const out = repairPartition([r(1, 2), r(4, 5)], 6);
    expect(out[0].startUnit).toBe(1);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startUnit).toBe(out[i - 1].endUnit + 1);
    }
    expect(out[out.length - 1].endUnit).toBe(6);
  });

  it("drops surplus scenes once M is covered", () => {
    const out = repairPartition([r(1, 9), r(2, 3), r(4, 5)], 4);
    expect(out).toHaveLength(1);
    expect(out[0].endUnit).toBe(4);
  });

  it("throws when there is nothing to partition", () => {
    expect(() => repairPartition([r(1, 2)], 0)).toThrow();
  });
});

describe("extractSpokenScript", () => {
  const TEMPLATE = `Reference Image 1 as identity lock.

This is the spoken script for a talking-head lawn-care video with b-roll cutaways.

Host (same person in every host shot, locked to Reference Image 1):
* Early 60s, weathered face, short gray hair
* No CGI / No AI look / No morphing

Look & pacing:
* Amateur, medium-quality iPhone footage
* Slow, trustworthy tone for homeowners aged 50+

=== SCRIPT ===
Hey, it's me again. Raise your mowing height.

Sharpen the blade. That's the whole protocol.`;

  it("returns only the text after a tolerant === SCRIPT === marker", () => {
    const out = extractSpokenScript(TEMPLATE);
    expect(out.startsWith("Hey, it's me again.")).toBe(true);
    expect(out).toContain("That's the whole protocol.");
    // Directing/preamble text must never survive into the spoken portion.
    expect(out).not.toMatch(/identity lock/i);
    expect(out).not.toMatch(/Look & pacing/i);
    expect(out).not.toMatch(/Host \(/);
  });

  it("honors an === END SCRIPT === marker", () => {
    const raw =
      "preamble line\n\n=== SCRIPT ===\nspoken bit\n=== END SCRIPT ===\ntrailing notes";
    const out = extractSpokenScript(raw);
    expect(out).toBe("spoken bit");
  });

  it("matches the marker case-insensitively with extra '=' and spaces", () => {
    const raw = "x\n\n==== script ====\nthe words";
    expect(extractSpokenScript(raw)).toBe("the words");
  });

  it("leaves a pure spoken script (no marker, no preamble) unchanged", () => {
    const pure =
      "Three summers ago a customer's lawn was thinning.\n\nWe changed one habit and it came back.";
    expect(extractSpokenScript(pure)).toBe(pure.trim());
  });

  it("strips a leading template preamble even without a marker", () => {
    const noMarker = `Reference Image 1 as identity lock.

Host (locked):
* Early 60s

Look & pacing:
* Amateur iPhone footage

Hey, it's me again. Raise your mowing height.`;
    const out = extractSpokenScript(noMarker);
    expect(out.startsWith("Hey, it's me again.")).toBe(true);
    expect(out).not.toMatch(/identity lock/i);
  });

  it("never empties a non-empty input", () => {
    expect(extractSpokenScript("   ").length).toBe(0);
    expect(extractSpokenScript("just words").length).toBeGreaterThan(0);
  });
});

describe("buildUnifiedStoryboardPrompt", () => {
  const SCRIPT = "Grow tomatoes. Water them daily.";
  const UNITS = splitIntoUnits(SCRIPT);
  // Two fixed chunks (boundaries are no longer Claude's to choose).
  const CHUNKS = [
    { start: UNITS[0].start, end: UNITS[0].end },
    { start: UNITS[1].start, end: UNITS[1].end },
  ];

  it("asks for one visual per fixed chunk by index (not a unit partition)", () => {
    const { systemPrompt, userMessage } = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
    });
    // Chunk-indexed assignment, not boundary selection.
    expect(systemPrompt).toContain("numbered CHUNKS");
    expect(systemPrompt).toContain("ASSIGN ONE VISUAL");
    expect(systemPrompt).toContain('"index":1');
    expect(systemPrompt).toContain("ONE entry per chunk");
    // The old boundary-selection vocabulary is gone.
    expect(systemPrompt).not.toContain("startUnit");
    expect(systemPrompt).not.toContain("endUnit");
    expect(systemPrompt).not.toContain("partition of units");
    expect(systemPrompt).toContain("b-roll cutaways");
    expect(systemPrompt).toContain("SEATED host");
    // Always open AND close on the host.
    expect(systemPrompt).toContain("open");
    expect(systemPrompt).toContain("close");
    expect(systemPrompt).toContain("reference photo");
    // The numbered chunks are listed for assignment.
    expect(userMessage).toContain("[1] Grow tomatoes.");
    expect(userMessage).toContain("[2] Water them daily.");
  });

  it("emits the prior-shots digest block only when priorShots + position are given", () => {
    const base = { chunks: CHUNKS, spokenScript: SCRIPT, faceAvailable: true };
    const without = buildUnifiedStoryboardPrompt(base).userMessage;
    const withPrior = buildUnifiedStoryboardPrompt({
      ...base,
      priorShots: ["a seed tray (overhead)", "a wheelbarrow of mulch (wide)"],
      batchStartIndex: 26,
      totalChunks: 40,
    }).userMessage;

    expect(without).not.toContain("SHOTS ALREADY USED");
    expect(withPrior).toContain("SHOTS ALREADY USED EARLIER IN THIS VIDEO");
    expect(withPrior).toContain("chunks 26–27 of 40");
    expect(withPrior).toContain("- a seed tray (overhead)");
    expect(withPrior).toContain("- a wheelbarrow of mulch (wide)");
    expect(withPrior).toContain("Never repeat the same subject AND shot angle");
    // Empty digest is byte-identical to no digest.
    expect(
      buildUnifiedStoryboardPrompt({
        ...base,
        priorShots: [],
        batchStartIndex: 26,
        totalChunks: 40,
      }).userMessage
    ).toBe(without);
  });

  it("tells the model host scenes never sit adjacent; a pair is the cold open only", () => {
    // The host-run rule is the same regardless of a second photo — a mid-film pair is never
    // sanctioned. The two-angle opener is expressed separately by the COLD OPEN rule.
    const base = {
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
    };
    const solo = buildUnifiedStoryboardPrompt(base).systemPrompt;
    const withOpenerPair = buildUnifiedStoryboardPrompt({
      ...base,
      openerHostScenes: 2,
    }).systemPrompt;

    for (const p of [solo, withOpenerPair]) {
      expect(p).toContain("never place two host scenes next to each other");
      expect(p).not.toContain("at most TWO host scenes in a row");
      // The motion-b-roll half of the rule is untouched.
      expect(p).toContain("never place two MOTION-video b-roll scenes");
    }
    // Only the two-scene opener sanctions an adjacent host pair.
    expect(withOpenerPair).toContain("chunks 1 AND 2 are BOTH host shots");
    expect(solo).not.toContain("chunks 1 AND 2 are BOTH host shots");
  });

  it("injects the video subject as a disambiguation hint, only when provided", () => {
    const withSubject = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
      subject: "field dressing a deer",
    }).userMessage;
    expect(withSubject).toContain("VIDEO SUBJECT");
    expect(withSubject).toContain("field dressing a deer");
    expect(withSubject).toContain("DISAMBIGUATES");

    // No subject → the block is omitted entirely (byte-identical to before).
    const withoutSubject = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
    }).userMessage;
    expect(withoutSubject).not.toContain("VIDEO SUBJECT");
  });

  it("seeds every scene in the shared WORLD, only when a style bible is provided", () => {
    const withWorld = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
      styleBible: "a cramped Zone 6b backyard, late autumn, chipped terracotta",
    }).userMessage;
    expect(withWorld).toContain("WORLD");
    expect(withWorld).toContain("a cramped Zone 6b backyard");
    expect(withWorld).toContain("does not drift between scenes");

    // No bible → the block is omitted entirely (byte-identical to before).
    const withoutWorld = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
    }).userMessage;
    expect(withoutWorld).not.toContain("WORLD (every b-roll");
  });

  it("notes when no host photo is available", () => {
    const { systemPrompt } = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: false,
    });
    expect(systemPrompt).toContain("No host photo");
  });

  it("keeps the host-budget + still/motion mix guidance and hands-only lane", () => {
    const { systemPrompt } = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
    });
    expect(systemPrompt).toContain("HOST BUDGET");
    expect(systemPrompt).toContain(
      "STILLS BY DEFAULT, VIDEO ONLY WHERE SOMETHING MOVES"
    );
    // The clip lane is an invariant, not a preference, and its share is a ceiling — the old
    // "aim for N% video / X stills per video beat" quota pushed the planner to inflate
    // `objectMotion` on beats that don't move, which is the failure this whole change removes.
    expect(systemPrompt).toContain(
      'a cutaway may be "stillImage":false ONLY if it also sets "objectMotion":true or "humanPresent":true'
    );
    expect(systemPrompt).toContain("that is a CEILING, not a quota to fill");
    expect(systemPrompt).not.toMatch(/stills? for every 1 video beat/);
    // The faceless POV-hands / hostAction lane has been removed.
    expect(systemPrompt).not.toContain("hostAction");
    expect(systemPrompt).not.toContain("POV-HANDS");
    // Hands-only lane for beats that need a manual action — never a person.
    expect(systemPrompt).toContain("NO PERSON EVER APPEARS IN A CUTAWAY");
    expect(systemPrompt).toContain('"humanPresent":true');
    expect(systemPrompt).toContain("hands and forearms ONLY");
    // Non-host lane is script-adaptive and must not lead with a shot-type label.
    expect(systemPrompt).toContain("NON-HOST B-ROLL");
    expect(systemPrompt).toContain("do NOT prepend a shot-type label");
  });

  it("embeds the default instruction and a custom instruction overrides it", () => {
    const def = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
    });
    expect(def.systemPrompt).toContain(DEFAULT_LONGFORM_INSTRUCTION);

    const custom = buildUnifiedStoryboardPrompt({
      chunks: CHUNKS,
      spokenScript: SCRIPT,
      faceAvailable: true,
      instruction: "HOST: a 30-year-old woman in a greenhouse. UNIQUEMARKER42.",
    });
    expect(custom.systemPrompt).toContain("UNIQUEMARKER42");
    expect(custom.systemPrompt).not.toContain(DEFAULT_LONGFORM_INSTRUCTION);
    // Structural tokens still present regardless of instruction.
    expect(custom.systemPrompt).toContain("numbered CHUNKS");
    expect(custom.systemPrompt).toContain("b-roll cutaways");
  });
});

describe("clipsNeededFor", () => {
  const host: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "v",
    hostPresent: true,
  };
  const broll: StoryboardScene = {
    index: 2,
    narration: "n",
    visualPrompt: "v",
    hostPresent: false,
  };

  it("host usable=5s, b-roll is always one clip", () => {
    // host: 6s clip − 1s intro trim = 5s usable. ceil(6/5) = 2, ceil(20/5) = 4
    expect(clipsNeededFor({ ...host, audioDuration: 6 }, "face.jpg")).toBe(2);
    expect(clipsNeededFor({ ...host, audioDuration: 20 }, "face.jpg")).toBe(4);
    // b-roll: one clip regardless of narration length
    expect(clipsNeededFor({ ...broll, audioDuration: 16 }, "face.jpg")).toBe(1);
    expect(clipsNeededFor({ ...broll, audioDuration: 7 })).toBe(1);
    expect(clipsNeededFor({ ...broll, audioDuration: 6 })).toBe(1);
    expect(clipsNeededFor({ ...broll, audioDuration: 45 })).toBe(1);
  });

  it("never fewer than 1, even with no measured duration", () => {
    expect(clipsNeededFor({ ...host }, "face.jpg")).toBe(1);
  });

  it("always produces enough clips to cover the duration", () => {
    // host usable = 6s clip − 1s intro trim = 5s.
    const usable = clipDurationParam(FIXED_CLIP_LEN) - HOST_INTRO_TRIM_SEC;
    for (const d of [3, 12, 31, 60]) {
      const n = clipsNeededFor({ ...host, audioDuration: d }, "face.jpg");
      expect(n * usable).toBeGreaterThanOrEqual(d);
    }
  });
});

describe("brollClipDuration (single b-roll clip length)", () => {
  it("clamps to 6–15 seconds, rounded UP so the clip never falls short", () => {
    expect(brollClipDuration(0)).toBe(6);
    expect(brollClipDuration(6)).toBe(6);
    expect(brollClipDuration(7)).toBe(7);
    expect(brollClipDuration(7.3)).toBe(8);
    // job 199 scene 21: round() gave 8 and froze the last 0.42s of moving fire.
    expect(brollClipDuration(8.461)).toBe(9);
    expect(brollClipDuration(11)).toBe(11);
    expect(brollClipDuration(15)).toBe(15);
    // 18s narration is the case that 400'd on APIMART ("must not exceed 15 seconds").
    expect(brollClipDuration(18)).toBe(15);
    expect(brollClipDuration(45)).toBe(15);
  });
});

describe("syncSceneClipFields", () => {
  it("mirrors clipUrl from clipUrls[0]", () => {
    const scene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "v",
      hostPresent: false,
      clipUrls: ["https://primary.mp4", "https://secondary.mp4"],
    };
    syncSceneClipFields(scene);
    expect(scene.clipUrl).toBe("https://primary.mp4");
    expect(scene.clipUrls).toEqual(["https://primary.mp4"]);
  });

  it("builds clipUrls from a lone clipUrl", () => {
    const scene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "v",
      hostPresent: false,
      clipUrl: "https://only.mp4",
    };
    syncSceneClipFields(scene);
    expect(scene.clipUrls).toEqual(["https://only.mp4"]);
    expect(scene.clipUrl).toBe("https://only.mp4");
  });

  it("preserves multi-clip host rows", () => {
    const scene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "v",
      hostPresent: true,
      clipUrls: ["https://a.mp4", "https://b.mp4"],
    };
    syncSceneClipFields(scene);
    expect(scene.clipUrl).toBe("https://a.mp4");
    expect(scene.clipUrls).toEqual(["https://a.mp4", "https://b.mp4"]);
  });
});

describe("isBrollChain (only b-roll falls through the model chain)", () => {
  const scene = (extra: Partial<StoryboardScene>): StoryboardScene => ({
    index: 1,
    narration: "n",
    visualPrompt: "v",
    hostPresent: false,
    ...extra,
  });

  it("non-host b-roll advances through fallback models", () => {
    expect(isBrollChain(scene({ hostPresent: false }))).toBe(true);
  });

  it("a host scene is single-model — fails loudly, no fallback", () => {
    expect(isBrollChain(scene({ hostPresent: true }))).toBe(false);
  });
});

describe("buildClipRequest host vs b-roll branching", () => {
  const hostScene: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "the seated host talks",
    hostPresent: true,
  };
  const brollScene: StoryboardScene = {
    index: 2,
    narration: "n",
    visualPrompt: "close-up of soil",
    hostPresent: false,
  };

  it("host scene WITH a face photo gets seated face-lock + fixed background", () => {
    const req = buildClipRequest(hostScene, {
      ...baseParams,
      faceImageUrl: "https://example.com/face.jpg",
    });
    expect(req.prompt.startsWith(FACE_LOCK_PROMPT_PREFIX_SEATED)).toBe(true);
    expect(req.prompt).toContain(TALKING_HEAD_BACKGROUND);
    // The talking host is the real presenter → no b-roll person clause.
    expect(req.prompt).not.toContain(ANON_PERSON_SUFFIX);
    expect(req.imageUrls).toEqual(["https://example.com/face.jpg"]);
    expect(req.videoInputMode).toBe("ingredients"); // grok ingredients mode (face ref)
    expect(req.duration).toBe(6);
    expect(req.aspectRatio).toBe("16:9");
    expect(req.model).toBe("grok-imagine-video");
    // A normal host scene may hold/show things — no empty-hands clause.
    expect(req.prompt).not.toContain(CTA_EMPTY_HANDS_SUFFIX);
  });

  it("CTA host scene appends the empty-hands clause (no product held for the QR overlay)", () => {
    const req = buildClipRequest(
      { ...hostScene, cta: true },
      { ...baseParams, faceImageUrl: "https://example.com/face.jpg" }
    );
    expect(req.prompt).toContain(TALKING_HEAD_BACKGROUND);
    expect(req.prompt).toContain(CTA_EMPTY_HANDS_SUFFIX);
  });

  it("b-roll scene is text-only with NO fixed background, even with a face photo", () => {
    const req = buildClipRequest(brollScene, {
      ...baseParams,
      faceImageUrl: "https://example.com/face.jpg",
    });
    expect(req.prompt).toContain("close-up of soil");
    // Script-only b-roll: visualPrompt + the fixed amateur-iPhone look tail + no-book guard.
    // Flagless object-only cutaway → the defensive "settle" fallback (base lock clause).
    expect(req.prompt).toBe(
      `close-up of soil ${AMATEUR_IPHONE_LOOK} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
    );
    expect(req.prompt).not.toContain(TALKING_HEAD_BACKGROUND);
    // Person-free b-roll has no person on screen → no person clause.
    expect(req.prompt).not.toContain(ANON_PERSON_SUFFIX);
    expect(req.imageUrls).toBeUndefined();
    expect(req.videoInputMode).toBeUndefined();
    expect(req.aspectRatio).toBe("16:9");
    expect(req.model).toBe("grok-imagine-video");
  });

  it("host scene WITHOUT a face photo: background pinned, no face-lock, text-only grok", () => {
    const req = buildClipRequest(hostScene, baseParams);
    expect(req.prompt).toContain(TALKING_HEAD_BACKGROUND);
    expect(req.prompt.startsWith(FACE_LOCK_PROMPT_PREFIX_SEATED)).toBe(false);
    expect(req.imageUrls).toBeUndefined();
    expect(req.aspectRatio).toBe("16:9");
    expect(req.model).toBe("grok-imagine-video");
  });

  it("split-screen right-half synthetic scene renders as plain b-roll (no host, no face)", () => {
    // Mirrors how generateSceneLipsyncClips builds the RIGHT half: a host split-screen
    // scene is turned into a face-less b-roll request from splitVisual so the host stays
    // lip-synced (left half) while the product is generated separately (right half).
    const splitHost: StoryboardScene = {
      index: 3,
      narration: "n",
      visualPrompt: "the seated host talks",
      hostPresent: true,
      splitVisual:
        "close-up of a white vinegar jug held over a weed-filled lawn",
    };
    const rightScene: StoryboardScene = {
      ...splitHost,
      hostPresent: false,
      splitVisual: undefined,
      visualPrompt: splitHost.splitVisual as string,
    };
    const req = buildClipRequest(rightScene, {
      ...baseParams,
      faceImageUrl: "https://example.com/face.jpg",
    });
    expect(req.prompt).toContain("white vinegar jug");
    expect(req.prompt).toContain(AMATEUR_IPHONE_LOOK);
    expect(req.prompt).not.toContain(TALKING_HEAD_BACKGROUND);
    expect(req.imageUrls).toBeUndefined();
    expect(req.model).toBe("grok-imagine-video");
  });

  // A splitVisual can reach render unscrubbed: the enhancer keeps the original on failure, a
  // non-verbatim operator override is stored raw, and enforceHostSplitMix seeds it from another
  // scene's prompt. softenVisualPrompt is the choke point both split lanes share.
  it("the split-screen composite scrubs generator syntax from the RIGHT half", () => {
    const req = buildClipRequest(
      {
        index: 4,
        narration: "n",
        visualPrompt: "the seated host talks",
        hostPresent: true,
        splitVisual:
          "a cedar bench on a porch <lora:FilmGrain:1.0> --ar 16:9 --style raw",
      },
      { ...baseParams, faceImageUrl: "https://example.com/face.jpg" }
    );
    expect(req.prompt).toContain("a cedar bench on a porch");
    expect(req.prompt).not.toMatch(/--ar|--style|<lora:/);
  });

  it("the split RIGHT-half b-roll scene scrubs generator syntax", () => {
    // Same synthetic right-half shape as the test above (buildSplitRightScene is private).
    const dirty =
      "a cedar bench on a porch <lora:FilmGrain:1.0> --ar 16:9 --style raw";
    const req = buildClipRequest(
      {
        index: 5,
        narration: "n",
        visualPrompt: dirty,
        hostPresent: false,
      },
      baseParams
    );
    expect(req.prompt).toContain("a cedar bench on a porch");
    expect(req.prompt).not.toMatch(/--ar|--style|<lora:/);
    expect(
      buildStillPrompt({ index: 5, narration: "n", visualPrompt: dirty })
    ).not.toMatch(/--ar|--style|<lora:/);
  });

  it("humanPresent b-roll WITH a channel face: hands clause anyway, no face ref, grok", () => {
    const humanScene: StoryboardScene = {
      index: 9,
      narration: "n",
      visualPrompt: "a gardener kneels and works compost into a raised bed",
      hostPresent: false,
      humanPresent: true,
    };
    // The channel host photo is NEVER referenced on b-roll: a humanPresent cutaway shows bare
    // hands at the task and nothing else of a human, with or without a face photo on the channel.
    const req = buildClipRequest(humanScene, {
      ...baseParams,
      faceImageUrl: "https://example.com/face.jpg",
    });
    expect(req.model).toBe("grok-imagine-video");
    expect(req.imageUrls).toBeUndefined(); // no ref on the chain; the keyframe lands at submit
    expect(req.videoInputMode).toBeUndefined();
    expect(req.prompt.startsWith(FACE_LOCK_PROMPT_PREFIX_INGREDIENT)).toBe(
      false
    );
    expect(req.prompt).toContain(ANON_PERSON_SUFFIX);
    expect(req.prompt).toContain(NO_FIGURES_SUFFIX);
    expect(req.prompt).toContain(AMATEUR_IPHONE_LOOK_PERSON);
    expect(req.prompt).not.toContain(TALKING_HEAD_BACKGROUND);
  });

  it("humanPresent b-roll WITHOUT any face in params: identical hands-only clip", () => {
    const humanScene: StoryboardScene = {
      index: 10,
      narration: "n",
      visualPrompt: "a gardener kneels and works compost into a raised bed",
      hostPresent: false,
      humanPresent: true,
    };
    const req = buildClipRequest(humanScene, baseParams);
    expect(req.model).toBe("grok-imagine-video");
    expect(req.imageUrls).toBeUndefined();
    expect(req.videoInputMode).toBeUndefined();
    expect(req.prompt).toContain(ANON_PERSON_SUFFIX);
  });

  it("talkingHeadVisualPrompt bakes in a 16:9 landscape framing cue", () => {
    const prompt = talkingHeadVisualPrompt("a man in his 60s", 0);
    expect(prompt).toContain("16:9 horizontal landscape framing");
  });

  it("b-roll ignores any cameraCue — prompt is just visualPrompt + the fixed look tail", () => {
    const cued: StoryboardScene = {
      index: 7,
      narration: "n",
      visualPrompt: "granules scattering over soil",
      hostPresent: false,
      cameraCue: "fast tracking push-in, harsh overcast light",
    };
    const req = buildClipRequest(cued, baseParams);
    expect(req.prompt).toBe(
      `granules scattering over soil ${AMATEUR_IPHONE_LOOK} ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
    );
    expect(req.prompt).not.toContain(
      "fast tracking push-in, harsh overcast light"
    );
  });

  it("split-screen scene WITH a cameraCue styles the right-half panel with it", () => {
    const splitHost: StoryboardScene = {
      index: 8,
      narration: "n",
      visualPrompt: "the seated host talks",
      hostPresent: true,
      splitVisual: "close-up of a white vinegar jug over a weedy lawn",
      cameraCue: "cool morning light, slow drift",
    };
    const req = buildClipRequest(splitHost, {
      ...baseParams,
      faceImageUrl: "https://example.com/face.jpg",
    });
    expect(req.prompt).toContain("cool morning light, slow drift");
    expect(req.prompt).not.toContain(
      "warm golden-hour light, shallow depth of field"
    );
  });

  it("split-screen right half is forced person-free (host on left preserved)", () => {
    const splitHost: StoryboardScene = {
      index: 8,
      narration: "n",
      visualPrompt: "the seated host talks",
      hostPresent: true,
      // A splitVisual that literally names a person on the right — must be neutralized.
      splitVisual: "a gardener kneeling beside the tomato plants",
    };
    const req = buildClipRequest(splitHost, {
      ...baseParams,
      faceImageUrl: "https://example.com/face.jpg",
    });
    // Right panel carries the no-people guard, scoped to the right half...
    expect(req.prompt).toContain(NO_PEOPLE_SUFFIX);
    expect(req.prompt).toContain(
      "the right half is object/product/setting only"
    );
    // ...while the LEFT half still renders the seated host (a person, by design).
    expect(req.prompt).toContain("LEFT HALF");
    expect(req.prompt).toContain("the seated host talks");
  });
});

describe("CAMERA_LOCK_CLAUSE (split out of the look tail)", () => {
  it("leaves AMATEUR_IPHONE_LOOK byte-identical — both seams intact", () => {
    // The clause was extracted from the middle of AMATEUR_LOOK_TAIL. If either seam loses
    // or doubles a space, the still lane's prompt changes and this is the only guard.
    expect(AMATEUR_IPHONE_LOOK).toContain(
      "no blank backgrounds. Natural available light only. The shot is a locked tripod " +
        "frame, the camera fixed and unmoving from the first frame to the last"
    );
    expect(AMATEUR_IPHONE_LOOK).toContain(
      "steady and unchanged. Low production quality, authentic " +
        "found-footage look."
    );
    expect(AMATEUR_IPHONE_LOOK).toContain(CAMERA_LOCK_CLAUSE);
  });

  it("carries movement direction only — no look, colour, or framing", () => {
    // What makes it safe to send alone to an image-first clip.
    expect(CAMERA_LOCK_CLAUSE).not.toMatch(
      /colou?r|light|desaturated|16:9|book/i
    );
  });

  it("is phrased positively — a locked tripod, not a list of forbidden moves", () => {
    // Grok (image-to-video) largely ignores negatives and can latch onto a named move, so the
    // clause states the fixed frame positively instead of "no pan/tilt/zoom" (see plan).
    expect(CAMERA_LOCK_CLAUSE).toContain("locked tripod frame");
    expect(CAMERA_LOCK_CLAUSE).not.toMatch(
      /\b(pan|tilt|zoom|push-in|shake)\b/i
    );
  });

  it("directs physics-driven ambient motion, not a subject moving on its own", () => {
    // The pivot: the clause no longer tells the subject to drift; the only motion is a small
    // physics-caused settling, and nothing acts of its own accord. Guards against a revert.
    expect(CAMERA_LOCK_CLAUSE).toMatch(/physics/i);
    expect(CAMERA_LOCK_CLAUSE).not.toMatch(/single main subject moves/i);
  });
});

describe("no inert lane: clips only where something actually moves", () => {
  const CLAUSES = [
    CAMERA_LOCK_CLAUSE,
    PERSON_MOTION_CAMERA_CLAUSE,
    OBJECT_MOTION_CAMERA_CLAUSE,
    STILL_OBJECT_MOTION_CLAUSE,
  ];
  const LOOKS = [
    AMATEUR_IPHONE_LOOK,
    AMATEUR_IPHONE_LOOK_PERSON,
    AMATEUR_IPHONE_LOOK_OBJECT,
    AMATEUR_IPHONE_LOOK_OBJECT_STILL,
  ];

  it("the ambient-motion ban is gone from every clause", () => {
    // The deleted inert clause banned steam, flame flicker, dripping, rippling and wind BY
    // NAME — on a fire or running-water beat that banned the subject the script was about.
    // Probe (jobs 183/184) showed it only half-held anyway, and bit hardest exactly there.
    for (const clause of CLAUSES) {
      expect(clause).not.toMatch(/no ambient motion of any kind/i);
      expect(clause).not.toMatch(/no steam, smoke, or vapour rising/i);
      expect(clause).not.toMatch(/no flame or ember flicker/i);
      expect(clause).not.toMatch(/no wind, breeze, or draft/i);
      expect(clause).not.toMatch(
        /nothing flutters, waves, ripples, or drifts/i
      );
    }
  });

  it("no clause reintroduces the handheld pan", () => {
    // Same probe: 0-2px net camera travel on every clip. Grok ignores a pan instruction on
    // this material, so the lane spent the expensive budget on nothing.
    for (const clause of CLAUSES) {
      expect(clause).not.toMatch(/PANS/);
      expect(clause).not.toMatch(/held in one bare hand/i);
      expect(clause).not.toMatch(/no tripod, no gimbal, no stabilizer/i);
    }
  });

  it("every look tail keeps the blanket no-camera-movement guard", () => {
    // The inert tail was `amateurLookTail`'s only `cameraMoves: true` caller, so it was the
    // only thing that ever swapped this fragment out. Unconditional now — which is what
    // proves the param (and the lane) are really gone.
    for (const look of LOOKS) {
      expect(look).toContain("never sweeps, glides, or cranes");
      expect(look).not.toContain(
        "the handheld POV move described above is the only camera movement"
      );
      expect(look).toContain(
        "never an aerial, overhead-drone, crane, or flyover viewpoint"
      );
    }
  });

  it("clip branch: objectMotion → object; humanPresent wins; host → none", () => {
    const objectScene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "a watering can on a step",
      hostPresent: false,
    };
    const humanScene: StoryboardScene = {
      ...objectScene,
      index: 2,
      humanPresent: true,
    };
    const hostScene: StoryboardScene = {
      ...objectScene,
      index: 3,
      hostPresent: true,
    };
    const motionScene: StoryboardScene = {
      ...objectScene,
      index: 4,
      visualPrompt: "water running from the can onto the bed",
      objectMotion: true,
    };
    const bothScene: StoryboardScene = {
      ...motionScene,
      index: 5,
      humanPresent: true,
    };
    // Flagless cutaway: `parseStoryboard` forces it to a still so this never happens in
    // production, but the defensive fallback must still be the safe locked base clause.
    const objectPrompt = buildClipRequest(objectScene, baseParams).prompt;
    expect(objectPrompt).toContain(CAMERA_LOCK_CLAUSE);
    expect(objectPrompt).not.toContain(PERSON_MOTION_CAMERA_CLAUSE);
    expect(objectPrompt).not.toContain(OBJECT_MOTION_CAMERA_CLAUSE);
    const humanPrompt = buildClipRequest(humanScene, baseParams).prompt;
    expect(humanPrompt).toContain(PERSON_MOTION_CAMERA_CLAUSE);
    expect(humanPrompt).not.toContain(CAMERA_LOCK_CLAUSE);
    const motionPrompt = buildClipRequest(motionScene, baseParams).prompt;
    expect(motionPrompt).toContain(OBJECT_MOTION_CAMERA_CLAUSE);
    expect(motionPrompt).not.toContain(PERSON_MOTION_CAMERA_CLAUSE);
    // Precedence: hands carry the higher morph risk and the person clause already grants
    // one task motion, so humanPresent wins outright.
    const bothPrompt = buildClipRequest(bothScene, baseParams).prompt;
    expect(bothPrompt).toContain(PERSON_MOTION_CAMERA_CLAUSE);
    expect(bothPrompt).not.toContain(OBJECT_MOTION_CAMERA_CLAUSE);
    const hostPrompt = buildClipRequest(hostScene, baseParams).prompt;
    expect(hostPrompt).not.toContain(CAMERA_LOCK_CLAUSE);
    expect(hostPrompt).not.toContain(PERSON_MOTION_CAMERA_CLAUSE);
    expect(hostPrompt).not.toContain(OBJECT_MOTION_CAMERA_CLAUSE);
  });

  it("stills are untouched: buildStillPrompt keeps the base look even on object-only scenes", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "a watering can on a step",
      hostPresent: false,
      stillImage: true,
    } as StoryboardScene;
    expect(buildStillPrompt(scene)).toContain(CAMERA_LOCK_CLAUSE);
  });

  it('amateurIphoneLook(subject, "settle") uses the base tail; no-subject === the constant', () => {
    expect(amateurIphoneLook(undefined, "settle")).toBe(AMATEUR_IPHONE_LOOK);
    const look = amateurIphoneLook("keeping tropical aquariums", "settle");
    expect(look).toContain("keeping tropical aquariums");
    expect(look).toContain(CAMERA_LOCK_CLAUSE);
  });

  it('amateurIphoneLook(subject, "person") uses the person-motion tail; no-subject === the constant', () => {
    expect(amateurIphoneLook(undefined, "person")).toBe(
      AMATEUR_IPHONE_LOOK_PERSON
    );
    const look = amateurIphoneLook("keeping tropical aquariums", "person");
    expect(look).toContain("keeping tropical aquariums");
    expect(look).toContain(PERSON_MOTION_CAMERA_CLAUSE);
    expect(look).not.toContain(CAMERA_LOCK_CLAUSE);
  });

  it("the subject look no longer stages products into the frame", () => {
    // Job 200: "real products in use" + the subject put a peroxide bottle into bare-lawn
    // cutaways. The no-subject constant is unchanged (nothing to stage without a subject).
    const look = amateurIphoneLook("pouring hydrogen peroxide on your lawn");
    expect(look).not.toContain("real products in use");
    expect(look).toContain("the frame contains only what this shot describes");
    expect(AMATEUR_IPHONE_LOOK).toContain("real products in use");
  });
});

describe("normalizeVideoSubject (title → topic phrase)", () => {
  it("strips the clickbait shell off a real production title", () => {
    expect(
      normalizeVideoSubject(
        "STOP! Pour Hydrogen Peroxide On Your Lawn Right Now or Regret It!"
      )
    ).toBe("Pour Hydrogen Peroxide On Your Lawn");
  });

  it("drops parentheticals and caps at 8 words", () => {
    expect(
      normalizeVideoSubject("How to Field Dress a Deer (Easiest Method)")
    ).toBe("How to Field Dress a Deer");
    expect(
      normalizeVideoSubject("one two three four five six seven eight nine ten")
    ).toBe("one two three four five six seven eight");
  });

  it("passes a clean title through unchanged", () => {
    expect(normalizeVideoSubject("Composting for beginners")).toBe(
      "Composting for beginners"
    );
    expect(normalizeVideoSubject("")).toBe("");
  });
});

describe("stripPromptArtifacts (enhancer generator-syntax scrub)", () => {
  it("removes MJ flags, lora tags, weights, and label lines", () => {
    expect(
      stripPromptArtifacts(
        "```\n/imagine prompt: A patch of green lawn in morning light " +
          "<lora:FilmVelvia3:0.9> (grass:1.2) --ar 16:9 --style raw --v 5.2\n" +
          "Look: cinematic, desaturated.\n```"
      )
    ).toBe("A patch of green lawn in morning light grass");
  });

  it("removes markdown-emphasised label lines and separators", () => {
    // The shape actually persisted on job 200 scene 105.
    expect(
      stripPromptArtifacts(
        "A wide patch of dried, cracked dirt.\n---\n**Visual style:**\nphoto"
      )
    ).toBe("A wide patch of dried, cracked dirt.\nphoto");
  });

  it("collapses the punctuation and blank lines a stripped tail leaves behind", () => {
    // Job 200 scene 4 ended ". ." once its label line went; scene 84 left space-only lines.
    expect(stripPromptArtifacts("under soft overcast light. .")).toBe(
      "under soft overcast light."
    );
    expect(stripPromptArtifacts("A lawn.\n \n \ncinematic still")).toBe(
      "A lawn.\ncinematic still"
    );
  });

  it("leaves a clean prompt untouched", () => {
    const clean =
      "A brown plastic bottle of hydrogen peroxide on a wooden step.";
    expect(stripPromptArtifacts(clean)).toBe(clean);
  });
});

describe("PERSON_MOTION_CAMERA_CLAUSE (humanPresent b-roll clip variant)", () => {
  it("splices into the person look tail with both seams intact", () => {
    // Same opening/closing seams as the base clause so it drops into amateurLookTail cleanly.
    expect(AMATEUR_IPHONE_LOOK_PERSON).toContain(
      "no blank backgrounds. Natural available light only. The shot is a locked tripod " +
        "frame, the camera fixed and unmoving from the first frame to the last"
    );
    expect(AMATEUR_IPHONE_LOOK_PERSON).toContain(
      "barely there. Low production quality, authentic found-footage look."
    );
    expect(AMATEUR_IPHONE_LOOK_PERSON).toContain(PERSON_MOTION_CAMERA_CLAUSE);
    expect(AMATEUR_IPHONE_LOOK_PERSON).not.toContain(CAMERA_LOCK_CLAUSE);
  });

  it("unlocks a bounded person action — no frozen-person prohibition", () => {
    // The base clause froze the person ("performs an action of its own"); this must not repeat
    // it, and must grant exactly ONE small motion instead.
    expect(PERSON_MOTION_CAMERA_CLAUSE).not.toContain(
      "performs an action of its own"
    );
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(/single/i);
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(/small/i);
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(
      /continues the task the frame already shows/i
    );
  });

  it("still bounds the motion: no big gestures, no face/body, no morph, camera locked", () => {
    expect(PERSON_MOTION_CAMERA_CLAUSE).toContain("locked tripod frame");
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(
      /withdraw|broad gesture|large arm movement/i
    );
    // The hands lane never lets a person into the frame.
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(
      /no face, head, or body ever comes into the shot/i
    );
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(/morph|melting/i);
    // Keeps the same physics-driven ambient-settling anchor as the other clauses.
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(/physics/i);
    expect(PERSON_MOTION_CAMERA_CLAUSE).toMatch(/settling/i);
  });

  it("carries movement direction only — no look, colour, or framing", () => {
    expect(PERSON_MOTION_CAMERA_CLAUSE).not.toMatch(
      /colou?r|light|desaturated|16:9|book/i
    );
  });
});

describe("OBJECT_MOTION_CAMERA_CLAUSE (objectMotion b-roll clip variant)", () => {
  it("splices into the object look tail with both seams intact", () => {
    // Same opening/closing seams as the base clause so it drops into amateurLookTail cleanly.
    expect(AMATEUR_IPHONE_LOOK_OBJECT).toContain(
      `Natural available light only. ${OBJECT_MOTION_CAMERA_CLAUSE} ` +
        "Low production quality, authentic found-footage look."
    );
    expect(AMATEUR_IPHONE_LOOK_OBJECT).not.toContain(CAMERA_LOCK_CLAUSE);
    // Camera is locked, so it keeps the shared tail's no-camera-movement fragment.
    expect(AMATEUR_IPHONE_LOOK_OBJECT).toContain(
      "never sweeps, glides, or cranes"
    );
  });

  it("names the motion as the subject — the frame is not frozen", () => {
    // The whole point of the lane: the fire/water the deleted inert clause banned by name is
    // the subject. See the shared no-ban assertions in the "no inert lane" block above.
    expect(OBJECT_MOTION_CAMERA_CLAUSE).not.toMatch(/no ambient motion/i);
    expect(OBJECT_MOTION_CAMERA_CLAUSE).not.toMatch(
      /no flame or ember flicker/i
    );
    expect(OBJECT_MOTION_CAMERA_CLAUSE).not.toMatch(
      /no steam, smoke, or vapour rising/i
    );
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(
      /already in motion when the shot opens/i
    );
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(
      /keeps doing exactly that for the whole shot/i
    );
  });

  it("caps the motion instead of the camera arc", () => {
    // The camera cannot move at all in this lane, so the whole anti-morph budget goes on the
    // motion itself — same place, same path, same rate.
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toContain("locked tripod frame");
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(/The ONE thing in frame/);
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(
      /same place, along the same path, and at the same rate/i
    );
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(
      /does not speed up, surge, spread, grow, or travel beyond/i
    );
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(/never changes into anything/i);
    // Everything that is NOT the subject stays put.
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(
      /nothing else tips, rolls, slides, sways, or acts on its own/i
    );
    expect(OBJECT_MOTION_CAMERA_CLAUSE).toMatch(
      /nothing enters or leaves the frame/i
    );
  });

  it("never says motionless/frozen/still — grok emits a static frame on those", () => {
    expect(OBJECT_MOTION_CAMERA_CLAUSE).not.toMatch(
      /motionless|frozen|\bstill\b/i
    );
    expect(STILL_OBJECT_MOTION_CLAUSE).not.toMatch(
      /motionless|frozen|\bstill\b/i
    );
  });

  it("carries movement direction only — no look, colour, or framing", () => {
    expect(OBJECT_MOTION_CAMERA_CLAUSE).not.toMatch(
      /colou?r|light|desaturated|16:9|book/i
    );
  });

  it("the motion survives softenVisualPrompt's wisp stripper", () => {
    // `softenVisualPrompt` deletes invented "vapour rising off the soil" atmosphere from every
    // b-roll visual. The planner rule's own examples must not trip it — a stripped subject would
    // leave the clause pointing at a motion the frame no longer shows.
    for (const v of [
      "water running from the hose onto the bed",
      "flames working along the kindling in the fire pit",
      "smoke off the fire drifting past the log pile",
      "the solution pouring from the jug into the watering can",
      "the pot at a rolling boil on the ring",
      "foliage moving in the wind over the bed",
    ]) {
      expect(softenVisualPrompt(v)).toBe(v);
    }
  });

  it('amateurIphoneLook(subject, "object") uses the object tail; no-subject === the constant', () => {
    expect(amateurIphoneLook(undefined, "object")).toBe(
      AMATEUR_IPHONE_LOOK_OBJECT
    );
    const look = amateurIphoneLook("keeping tropical aquariums", "object");
    expect(look).toContain("keeping tropical aquariums");
    expect(look).toContain(OBJECT_MOTION_CAMERA_CLAUSE);
    expect(look).not.toContain(CAMERA_LOCK_CLAUSE);
  });
});

describe("STILL_OBJECT_MOTION_CLAUSE (objectMotion keyframe/still variant)", () => {
  it("composes the frame mid-motion, sharp and physically anchored", () => {
    // The keyframe IS grok's first frame — a settled puddle here forces grok to invent the
    // running water, which is exactly how morphs start.
    expect(STILL_OBJECT_MOTION_CLAUSE).toMatch(/natural motion in progress/i);
    expect(STILL_OBJECT_MOTION_CLAUSE).toMatch(
      /not blurred, streaked, or smeared/i
    );
    expect(STILL_OBJECT_MOTION_CLAUSE).toMatch(
      /stays connected to its source and follows a real path under gravity/i
    );
    expect(STILL_OBJECT_MOTION_CLAUSE).toContain("locked tripod frame");
    // The base clause's blanket freeze would suppress the stream.
    expect(STILL_OBJECT_MOTION_CLAUSE).not.toContain(
      "performs an action of its own"
    );
  });

  it('amateurIphoneLook(subject, "objectStill") uses the still tail; no-subject === the constant', () => {
    expect(amateurIphoneLook(undefined, "objectStill")).toBe(
      AMATEUR_IPHONE_LOOK_OBJECT_STILL
    );
    const look = amateurIphoneLook("keeping tropical aquariums", "objectStill");
    expect(look).toContain("keeping tropical aquariums");
    expect(look).not.toContain(CAMERA_LOCK_CLAUSE);
    // Both seams byte-exact, same as the clip lane.
    expect(look).toContain(
      `Natural available light only. ${STILL_OBJECT_MOTION_CLAUSE} ` +
        "Low production quality, authentic found-footage look."
    );
    // Camera is locked here too, so the shared no-camera-movement fragment stays.
    expect(AMATEUR_IPHONE_LOOK_OBJECT_STILL).toContain(
      "never sweeps, glides, or cranes"
    );
  });

  it("buildStillPrompt swaps in the mid-motion clause only on an objectMotion scene", () => {
    const base = {
      index: 1,
      narration: "n",
      visualPrompt: "a hose lying on a bed",
      hostPresent: false,
      stillImage: true,
    } as StoryboardScene;
    const motion = {
      ...base,
      visualPrompt: "water running from the hose onto the bed",
      objectMotion: true,
    } as StoryboardScene;

    // Untouched without the flag — byte-identical to today's still prompt.
    expect(buildStillPrompt(base)).toContain(CAMERA_LOCK_CLAUSE);
    expect(buildStillPrompt(base)).not.toContain(STILL_OBJECT_MOTION_CLAUSE);

    const prompt = buildStillPrompt(motion);
    expect(prompt).toContain(STILL_OBJECT_MOTION_CLAUSE);
    expect(prompt).not.toContain(CAMERA_LOCK_CLAUSE);
    expect(prompt).not.toContain(OBJECT_MOTION_CAMERA_CLAUSE);

    // The aggressive content-policy retry drops it: the moving element is the likely block.
    const aggressive = buildStillPrompt(motion, true);
    expect(aggressive).toContain(CAMERA_LOCK_CLAUSE);
    expect(aggressive).not.toContain(STILL_OBJECT_MOTION_CLAUSE);
  });
});

describe("assembleScenePromptPreview (read-only pollJob preview)", () => {
  const scene: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "an empty clear bottle on a worn wooden workbench",
    hostPresent: false,
    humanPresent: true,
    shotAngle: "overhead",
  };

  it("returns exactly what the real builders would ship", () => {
    const preview = assembleScenePromptPreview(scene, baseParams);
    // The preview IS the generation prompt — assembled by the same builders, not a copy.
    expect(preview.assembledClipPrompt).toBe(
      buildClipRequest(scene, baseParams).prompt
    );
    expect(preview.assembledStillPrompt).toBe(
      buildStillPrompt(scene, false, undefined, baseParams.videoSubject)
    );
    expect(preview.assembledClipPrompt.length).toBeGreaterThan(0);
    expect(preview.assembledStillPrompt.length).toBeGreaterThan(0);
  });
});

describe("buildClipChain (b-roll chain; grok-only, no cross-model fallback, no face ref)", () => {
  const FACE = "https://example.com/face.jpg";

  it("buildClipRequest returns the chain's first candidate", () => {
    const scene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "close-up of soil",
      hostPresent: false,
    };
    expect(buildClipRequest(scene, baseParams)).toEqual(
      buildClipChain(scene, baseParams)[0]
    );
  });

  describe("near-still b-roll clip (descriptive prompt, text-to-video)", () => {
    const brollScene: StoryboardScene = {
      index: 3,
      narration: "n",
      visualPrompt:
        "an empty clear two-liter bottle on a worn wooden workbench",
      hostPresent: false,
      humanPresent: true,
      shotAngle: "overhead",
    };

    it("ships the full descriptive prompt + the near-still camera lock", () => {
      const chain = buildClipChain(brollScene, baseParams);
      // A fixed camera-lock clause reaches every clip via the amateur-iPhone look — that is
      // what keeps the b-roll near-still. A humanPresent scene takes the person-motion variant
      // (one small task motion, not frozen); the person-free aggressive retry drops to the base one.
      expect(chain[0].prompt).toContain(PERSON_MOTION_CAMERA_CLAUSE);
      expect(chain[0].prompt).toContain(AMATEUR_IPHONE_LOOK_PERSON);
      expect(chain[0].prompt).not.toContain(CAMERA_LOCK_CLAUSE);
      expect(chain[0].prompt).toContain(NO_BOOK_SUFFIX);
      expect(chain[0].prompt).toContain("worn wooden workbench");
      expect(chain[0].prompt).toContain(ANON_PERSON_SUFFIX);
      // The aggressive content-policy retry drops people; still grok, still no ref image.
      expect(chain[1].prompt).toContain(CAMERA_LOCK_CLAUSE);
      expect(chain[1].prompt).not.toContain(ANON_PERSON_SUFFIX);
      expect(chain.map(c => c.model)).toEqual([
        "grok-imagine-video",
        "grok-imagine-video",
      ]);
      expect(chain.every(c => c.imageUrls === undefined)).toBe(true);
    });

    it("host scenes keep their full prompt with no camera lock", () => {
      // A face photo fixes identity, not setting/composition, so the description stays; the
      // host is a talking head, not a locked-off b-roll frame.
      const host: StoryboardScene = {
        index: 4,
        narration: "n",
        visualPrompt: "the host talks to camera",
        hostPresent: true,
      };
      const prompt = buildClipRequest(host, {
        ...baseParams,
        faceImageUrl: FACE,
      }).prompt;
      expect(prompt).toContain(TALKING_HEAD_BACKGROUND);
      expect(prompt).not.toContain(CAMERA_LOCK_CLAUSE);
    });
  });

  it("plain person-free b-roll → grok normal + softened-retry, one model, no ref image", () => {
    const scene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "close-up of soil",
      hostPresent: false,
    };
    const chain = buildClipChain(scene, baseParams);
    // Element 0 = normal grok; element 1 = shorter content-policy retry. No cross-model fallback.
    expect(chain.map(c => c.model)).toEqual([
      "grok-imagine-video",
      "grok-imagine-video",
    ]);
    expect(chain.every(c => c.imageUrls === undefined)).toBe(true);
    expect(chain.every(c => c.videoInputMode === undefined)).toBe(true);
  });

  it("humanPresent b-roll WITH a channel face → grok-only image-less chain, hands clause, never the face ref", () => {
    const scene: StoryboardScene = {
      index: 2,
      narration: "n",
      visualPrompt: "a gardener tends a bed",
      hostPresent: false,
      humanPresent: true,
    };
    const chain = buildClipChain(scene, {
      ...baseParams,
      faceImageUrl: FACE,
    });
    expect(chain).toHaveLength(2);
    expect(chain.map(c => c.model)).toEqual([
      "grok-imagine-video",
      "grok-imagine-video",
    ]);
    // The channel face is never referenced on b-roll — not on the chain and not on the keyframe
    // (see submitBrollClip). A humanPresent cutaway is bare hands at the task, nothing more.
    expect(chain.every(c => c.imageUrls === undefined)).toBe(true);
    expect(chain.every(c => !JSON.stringify(c).includes(FACE))).toBe(true);
    expect(chain[0].videoInputMode).toBeUndefined();
    expect(chain[0].prompt).toContain(ANON_PERSON_SUFFIX);
    expect(chain[0].prompt).toContain(NO_FIGURES_SUFFIX);
    expect(chain[0].prompt.startsWith(FACE_LOCK_PROMPT_PREFIX_INGREDIENT)).toBe(
      false
    );
  });

  it("human b-roll WITHOUT any face ref → grok-only image-less chain (hands only)", () => {
    const scene: StoryboardScene = {
      index: 4,
      narration: "n",
      visualPrompt: "a gardener tends a bed",
      hostPresent: false,
      humanPresent: true,
    };
    const chain = buildClipChain(scene, baseParams);
    expect(chain.map(c => c.model)).toEqual([
      "grok-imagine-video",
      "grok-imagine-video",
    ]);
  });

  it("host scenes (talking head + split-screen) are single-model — no chain", () => {
    const host: StoryboardScene = {
      index: 5,
      narration: "n",
      visualPrompt: "the seated host talks",
      hostPresent: true,
    };
    expect(buildClipChain(host, baseParams)).toHaveLength(1);
    expect(isBrollChain(host)).toBe(false);

    const split: StoryboardScene = {
      ...host,
      index: 6,
      splitVisual: "close-up of a vinegar jug over a weedy lawn",
    };
    const splitChain = buildClipChain(split, {
      ...baseParams,
      faceImageUrl: FACE,
    });
    expect(splitChain).toHaveLength(1);
    expect(splitChain[0].model).toBe("grok-imagine-video");
  });
});

describe("buildClipChain (b-roll model chain: grok + softened retry — no veo)", () => {
  const FACE = "https://example.com/face.jpg";
  const brollScene: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "close-up of soil",
    hostPresent: false,
  };

  it("b-roll → grok candidates (normal + softened retry), no cross-model fallback", () => {
    const chain = buildClipChain(brollScene, baseParams);
    expect(chain.map(c => c.model)).toEqual([
      "grok-imagine-video",
      "grok-imagine-video",
    ]);
  });

  it("host scenes are a single grok host clip with face ref + ingredients mode", () => {
    const host: StoryboardScene = {
      index: 2,
      narration: "n",
      visualPrompt: "the seated host talks",
      hostPresent: true,
    };
    const chain = buildClipChain(host, {
      ...baseParams,
      faceImageUrl: FACE,
    });
    expect(chain).toHaveLength(1);
    expect(chain[0].model).toBe("grok-imagine-video");
    expect(chain[0].imageUrls).toEqual([FACE]);
    expect(chain[0].videoInputMode).toBe("ingredients");
  });
});

describe("amateurIphoneLook (subject-aware setting clause)", () => {
  it("with no subject === the plain AMATEUR_IPHONE_LOOK constant", () => {
    expect(amateurIphoneLook()).toBe(AMATEUR_IPHONE_LOOK);
    expect(amateurIphoneLook("  ")).toBe(AMATEUR_IPHONE_LOOK);
  });

  it("with a subject fits the setting to the topic and drops the fixed kitchen/desk list", () => {
    const look = amateurIphoneLook("keeping tropical aquariums");
    expect(look).toContain("keeping tropical aquariums");
    expect(look).not.toContain("kitchen counters, tables, desks, garages");
    // fixed look/camera tail is unchanged
    expect(look).toContain("The shot is a locked tripod frame");
    expect(look).toContain("no blank backgrounds.");
  });
});

describe("buildStillPrompt (script-only + one fixed look tail)", () => {
  it("is just the visualPrompt + the fixed amateur-iPhone look tail", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "a finished raised bed",
      hostPresent: false,
      stillImage: true,
    } as StoryboardScene;
    expect(buildStillPrompt(scene)).toBe(
      `a finished raised bed ${AMATEUR_IPHONE_LOOK} Wide 16:9 horizontal landscape framing. ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
    );
  });

  it("square=true swaps the 16:9 framing clause for 1:1 (split-screen right panel only)", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "a finished raised bed",
      hostPresent: false,
      stillImage: true,
    } as StoryboardScene;
    const prompt = buildStillPrompt(scene, false, undefined, undefined, true);
    expect(prompt).toContain("Square 1:1 framing");
    expect(prompt).not.toContain("Wide 16:9 horizontal landscape framing");
  });

  it("a humanPresent still appends the anonymous-older-person clause (no face prefix)", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "a homeowner inspects the finished bed",
      hostPresent: false,
      stillImage: true,
      humanPresent: true,
    } as StoryboardScene;
    const prompt = buildStillPrompt(scene);
    expect(prompt).toBe(
      `a homeowner inspects the finished bed ${ANON_PERSON_SUFFIX} ${AMATEUR_IPHONE_LOOK} Wide 16:9 horizontal landscape framing. ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
    );
    expect(prompt).toContain(ANON_PERSON_SUFFIX);
    expect(prompt.endsWith(NO_BOOK_SUFFIX)).toBe(true);
  });

  it("a humanPresent still never carries a channel-host identity clause — hands only", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "weathered hands press mulch around the stems",
      hostPresent: false,
      stillImage: true,
      humanPresent: true,
    } as StoryboardScene;
    const prompt = buildStillPrompt(scene);
    expect(prompt).toContain(ANON_PERSON_SUFFIX);
    // The hands clause bans every other human part, and the unconditional guard repeats it.
    expect(ANON_PERSON_SUFFIX).toMatch(/NO face/);
    expect(prompt).toContain(NO_FIGURES_SUFFIX);
  });

  it("a visualOverride replaces the scene visual, is softened, keeps the tail, drops the person clause", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "a gardener sprays pesticide",
      hostPresent: false,
      stillImage: true,
      humanPresent: true,
    } as StoryboardScene;
    const prompt = buildStillPrompt(scene, true, "spraying pesticide on beds");
    expect(prompt).toBe(
      `spraying treatment on beds ${AMATEUR_IPHONE_LOOK} Wide 16:9 horizontal landscape framing. ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
    );
    expect(prompt).not.toContain(ANON_PERSON_SUFFIX); // aggressive drops it
    expect(prompt).not.toContain("gardener"); // scene visual fully replaced
  });

  it("ignores cameraCue and carries no framing/mood/guardrail boilerplate", () => {
    const scene = {
      index: 1,
      narration: "n",
      visualPrompt: "a finished raised bed",
      hostPresent: false,
      stillImage: true,
      cameraCue: "soft overcast light, muted greens",
    } as StoryboardScene;
    const prompt = buildStillPrompt(scene);
    expect(prompt).toBe(
      `a finished raised bed ${AMATEUR_IPHONE_LOOK} Wide 16:9 horizontal landscape framing. ${NO_FIGURES_SUFFIX} ${NO_BOOK_SUFFIX}`
    );
    expect(prompt).not.toContain("soft overcast light, muted greens");
    expect(prompt).not.toContain(
      "A single candid photo snapped on a smartphone."
    );
    expect(prompt).not.toContain("No text, captions, watermarks");
  });
});

describe("NO_FIGURES_SUFFIX (no person in any b-roll lane, hands allowed)", () => {
  const broll = (extra: Partial<StoryboardScene> = {}): StoryboardScene =>
    ({
      index: 1,
      narration: "n",
      visualPrompt: "a gardener tends a bed",
      hostPresent: false,
      ...extra,
    }) as any;

  it("is on every non-host clip and still prompt, with or without humanPresent", () => {
    for (const scene of [broll(), broll({ humanPresent: true })]) {
      expect(buildClipRequest(scene, baseParams).prompt).toContain(
        NO_FIGURES_SUFFIX
      );
      expect(buildStillPrompt(scene)).toContain(NO_FIGURES_SUFFIX);
    }
  });

  it("is on the aggressive content-policy retry element too", () => {
    const chain = buildClipChain(broll({ humanPresent: true }), baseParams);
    expect(chain).toHaveLength(2);
    for (const req of chain) expect(req.prompt).toContain(NO_FIGURES_SUFFIX);
  });

  it("bans the body but not the hands (the split panel's stricter guard bans both)", () => {
    expect(NO_FIGURES_SUFFIX).toMatch(/no face, head, hair, shoulders/i);
    expect(NO_FIGURES_SUFFIX).toMatch(/hands and forearms .* may appear/i);
    expect(NO_PEOPLE_SUFFIX).toMatch(/no hands/i);
  });

  it("is absent from host lanes (the host is a person on purpose)", () => {
    const host = broll({ hostPresent: true, visualPrompt: "the host talks" });
    expect(buildClipRequest(host, baseParams).prompt).not.toContain(
      NO_FIGURES_SUFFIX
    );
  });

  it("the channel face photo never reaches a non-host clip request", () => {
    const withFace = { ...baseParams, faceImageUrl: "https://ex.com/f.jpg" };
    for (const scene of [broll(), broll({ humanPresent: true })]) {
      const req = buildClipRequest(scene, withFace);
      expect(JSON.stringify(req)).not.toContain("https://ex.com/f.jpg");
    }
  });
});

describe("NO_OVERLAY_TEXT_SUFFIX (no overlay text in any generated lane)", () => {
  const mk = (extra: Partial<StoryboardScene>): StoryboardScene =>
    ({ index: 1, narration: "n", hostPresent: false, ...extra }) as any;

  it("is baked into the amateur-iPhone look, so every b-roll lane inherits it", () => {
    expect(AMATEUR_IPHONE_LOOK).toContain(NO_OVERLAY_TEXT_SUFFIX);
    expect(
      buildStillPrompt(mk({ visualPrompt: "a raised bed", stillImage: true }))
    ).toContain(NO_OVERLAY_TEXT_SUFFIX);
  });

  it("host talking-head and split-screen prompts carry the guard", () => {
    const host = buildClipRequest(
      mk({ visualPrompt: "the seated host talks", hostPresent: true }),
      baseParams
    );
    expect(host.prompt).toContain(NO_OVERLAY_TEXT_SUFFIX);
    const split = buildClipRequest(
      mk({
        visualPrompt: "the seated host talks",
        hostPresent: true,
        splitVisual: "a bag of fertilizer on a bench",
      }),
      baseParams
    );
    expect(split.prompt).toContain(NO_OVERLAY_TEXT_SUFFIX);
  });

  it("the aggressive content-policy retry element keeps the guard", () => {
    const chain = buildClipChain(
      mk({ visualPrompt: "close-up of soil. A second sentence." }),
      baseParams
    );
    expect(chain.length).toBeGreaterThan(1);
    expect(chain[1].prompt).toContain(NO_OVERLAY_TEXT_SUFFIX);
  });
});

describe("softenVisualPrompt (content-filter softening)", () => {
  it("rewrites harm-adjacent pest-control terms to neutral synonyms", () => {
    expect(softenVisualPrompt("kill the pests")).toBe("repels the insects");
    expect(softenVisualPrompt("an aphid infestation on a tomato leaf")).toBe(
      "an aphid cluster of insects on a tomato leaf"
    );
    expect(softenVisualPrompt("a poisonous bait trap")).toBe(
      "a harmful bait deterrent"
    );
    expect(softenVisualPrompt("spraying pesticide to exterminate bugs")).toBe(
      "spraying treatment to remove insects"
    );
  });

  it("is case-insensitive and preserves no flagged stems", () => {
    const out = softenVisualPrompt("KILLING beetles and POISON dripping");
    expect(out).toBe("repelling beetles and treatment dripping");
    expect(out).not.toMatch(/kill|poison/i);
  });

  it("leaves benign text untouched", () => {
    const benign = "a vinegar jug on a wooden shelf in soft morning light";
    expect(softenVisualPrompt(benign)).toBe(benign);
  });

  // The render-time choke point: covers every prompt that skipped the enhancer's adoption
  // scrub — a kept-original after an enhance failure, a non-verbatim operator override, and an
  // enforceHostSplitMix seed.
  it("scrubs generator syntax as well as harm wording", () => {
    expect(
      softenVisualPrompt(
        "a cedar bench on a porch <lora:FilmGrain:1.0> --ar 16:9 --style raw"
      )
    ).toBe("a cedar bench on a porch");
  });

  it("respects word boundaries (does not maul benign substrings)", () => {
    // "trapped" / "buggy" must not be partially rewritten by the trap/bug rules.
    expect(softenVisualPrompt("dappled light trapped under leaves")).toBe(
      "dappled light trapped under leaves"
    );
  });

  it("is applied to the submitted b-roll prompt (buildClipChain + buildStillPrompt)", () => {
    const scene: StoryboardScene = {
      index: 1,
      narration: "n",
      visualPrompt: "kill the pests with a trap",
      hostPresent: false,
    };
    const clipPrompt = buildClipChain(scene, baseParams)[0].prompt;
    expect(clipPrompt).not.toMatch(/\bkill\b|\bpests\b|\btrap\b/i);
    expect(clipPrompt).toContain("repels the insects");

    const stillPrompt = buildStillPrompt({ ...scene, stillImage: true });
    expect(stillPrompt).not.toMatch(/\bkill\b|\bpests\b|\btrap\b/i);
  });

  it("neutralizes decay/disease/chemical wording", () => {
    expect(softenVisualPrompt("dead weeds and dying grass")).toBe(
      "wilted weeds and wilting grass"
    );
    expect(softenVisualPrompt("rotting fungus and diseased leaves")).toBe(
      "spoiled mildew and damaged leaves"
    );
    expect(softenVisualPrompt("spraying chemicals on a swarm of maggots")).toBe(
      "spraying treatment on a cluster of small insects"
    );
  });

  it("neutralizes minor/underage PEOPLE words but leaves garden terms alone", () => {
    const out = softenVisualPrompt("children and a teenager and a kid");
    expect(out).not.toMatch(/\bchild(ren)?\b|\bteen(ager)?\b|\bkids?\b/i);
    expect(out).toContain("adult");
    // "young seedlings" / "minor damage" are garden terms — must NOT be touched.
    const garden = "young seedlings with minor damage in the soil";
    expect(softenVisualPrompt(garden)).toBe(garden);
  });

  it("strips the invented soil-vapour wisp (the reported artifact) and its siblings", () => {
    // Standalone wisp sentences: the whole sentence is dropped, the real hero shot survives.
    const reported =
      "Tiny grass seeds resting on dark, damp soil. A single thin wisp of moisture vapour gently rises from the soil surface throughout the shot, barely stirring, while everything else stays at rest.";
    const strippedReported = softenVisualPrompt(reported);
    expect(strippedReported).toBe(
      "Tiny grass seeds resting on dark, damp soil."
    );
    expect(strippedReported).not.toMatch(/wisp|vapou?r|moisture/i);

    expect(
      softenVisualPrompt(
        "Finished compost in an open bag. A thin wisp of cool moisture continues to drift upward from the compost surface throughout the shot."
      )
    ).toBe("Finished compost in an open bag.");

    expect(
      softenVisualPrompt(
        "Bare turned earth in a raised bed. A single wisp of heat vapour gently drifts upward from the soil surface."
      )
    ).toBe("Bare turned earth in a raised bed.");

    expect(
      softenVisualPrompt(
        "Dark crumbly earth in a wooden bin. Thin wisps of steam continue to drift softly upward from the surface throughout the shot."
      )
    ).toBe("Dark crumbly earth in a wooden bin.");
  });

  it("cuts a trailing 'as … wisp …' clause but keeps the real main clause", () => {
    expect(
      stripAtmosphericWisps(
        "One hand holds the bag steady while a single finger rests on the label, as thin wisps of dust gently settle onto the paper surface throughout the shot."
      )
    ).toBe(
      "One hand holds the bag steady while a single finger rests on the label."
    );
  });

  it("leaves real motion and realistic non-ground steam untouched", () => {
    // Real motion — no haze noun, or no ground-surface source: must pass through unchanged.
    const benign = [
      "White vinegar streaming from a plain jug onto a clump of dandelion leaves, the wet leaves darkening.",
      "A single leaf swaying gently in a light breeze over a garden bed.",
      "Water trickling from a watering can onto dark soil, soaking in.",
      "Fine dust kicked up by a rake drifting across the garden path.",
      "Steam rising from a mug of tea on the kitchen counter.",
    ];
    for (const b of benign) expect(stripAtmosphericWisps(b)).toBe(b);
  });
});

describe("edit-video enhancer prompt doesn't recommend a rising motion (smoke bait)", () => {
  it("does not list 'softly rising' as a calm verb", () => {
    expect(EDIT_VIDEO_BROLL_ENHANCER_SYSTEM).not.toMatch(/softly rising/i);
  });
  it("still carries the anti-haze ban", () => {
    expect(EDIT_VIDEO_BROLL_ENHANCER_SYSTEM).toMatch(
      /NO INVENTED ATMOSPHERIC HAZE/
    );
  });
});

describe("aggressiveSoftenVisualPrompt (content-policy retry variant)", () => {
  it("softens AND shortens to the first sentence", () => {
    const long =
      "kill the pests with a trap. Then a long second sentence with lots of " +
      "extra descriptive detail that should be dropped on the retry.";
    const out = aggressiveSoftenVisualPrompt(long);
    expect(out).toBe("repels the insects with a deterrent.");
    expect(out).not.toMatch(/\bkill\b|\bpests\b|\btrap\b/i);
  });

  it("caps overly long single-sentence prompts at 200 chars", () => {
    const out = aggressiveSoftenVisualPrompt("soil ".repeat(100));
    expect(out.length).toBeLessThanOrEqual(200);
  });
});

describe("clipTrimFor", () => {
  const host: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "v",
    hostPresent: true,
  };
  const broll: StoryboardScene = {
    index: 2,
    narration: "n",
    visualPrompt: "v",
    hostPresent: false,
  };

  it("trims host clips that carry a reference photo; plain b-roll (no face flag) is never trimmed", () => {
    expect(clipTrimFor(host, "https://example.com/face.jpg")).toBe(
      HOST_INTRO_TRIM_SEC
    );
    expect(clipTrimFor(broll, "https://example.com/face.jpg")).toBe(0);
    expect(clipTrimFor(host, undefined)).toBe(0);
  });

  it("never trims humanPresent b-roll — it attaches no face ref (text-only grok)", () => {
    const humanPresent: StoryboardScene = { ...broll, humanPresent: true };
    // The channel face photo is still present in params (for the talking-head lane) but is
    // NOT attached to b-roll clips, so there is no reference-photo intro to trim.
    expect(clipTrimFor(humanPresent, "https://example.com/face.jpg")).toBe(0);
    expect(clipTrimFor(humanPresent, undefined)).toBe(0);
  });

  it("never trims a lip-synced clip (no reference-photo intro)", () => {
    expect(
      clipTrimFor({ ...host, lipsynced: true }, "https://example.com/face.jpg")
    ).toBe(0);
  });
});

describe("describeIncompleteScenes (pre-assembly completeness gate)", () => {
  const scene = (
    i: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    narration: "n",
    visualPrompt: "v",
    hostPresent: true,
    ...extra,
  });

  it("returns null when every scene has at least one clip", () => {
    const scenes = [
      scene(1, { clipUrls: ["a.mp4"] }),
      scene(2, { clipUrl: "b.mp4" }),
    ];
    expect(describeIncompleteScenes(scenes)).toBeNull();
  });

  it("flags a scene with no clip so a partial video is never assembled", () => {
    const scenes = [
      scene(1, { clipUrls: ["a.mp4"] }),
      scene(2, { clipUrls: [], error: "Clip: 69Labs timeout" }),
      scene(3),
    ];
    const msg = describeIncompleteScenes(scenes);
    expect(msg).not.toBeNull();
    expect(msg).toContain("scene 2");
    expect(msg).toContain("69Labs timeout");
    expect(msg).toContain("scene 3");
    expect(msg).toContain("2 scene(s) have no clip");
  });

  it("treats a still-rendering scene (taskIds persisted, no clip yet) as incomplete, not assemblable", () => {
    // A scene that timed out mid-poll keeps its provider taskIds for resume but has no clip
    // yet — the gate must block assembly so Retry can resume it before stitching.
    const scenes = [
      scene(1, { clipUrls: ["a.mp4"] }),
      scene(2, {
        sceneStatus: "rendering",
        renderProvider: "heygen",
        renderTaskIds: ["task-abc"],
      }),
    ];
    const msg = describeIncompleteScenes(scenes);
    expect(msg).not.toBeNull();
    expect(msg).toContain("scene 2");
    expect(msg).toContain("1 scene(s) have no clip");
  });
});

describe("scene ceiling (split → coalesce end state)", () => {
  const sentences = (n: number, w: number) =>
    Array.from(
      { length: n },
      (_, i) => `beat ${i} ${Array(w).fill("garden").join(" ")}`
    ).join(". ") + ".";
  const scene = (
    i: number,
    dur: number,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: i,
    narration: "n",
    scriptText: sentences(4, 5),
    visualPrompt: "v",
    hostPresent: false,
    audioDuration: dur,
    ...extra,
  });

  it("a normal scene always fits ONE un-padded b-roll clip", () => {
    expect(LONG_SCENE_MAX_SEC).toBeLessThanOrEqual(BROLL_CLIP_MAX_SEC);
    expect(brollClipDuration(LONG_SCENE_MAX_SEC)).toBe(LONG_SCENE_MAX_SEC);
  });

  it("brings every splittable scene under the ceiling, naming only the residual", () => {
    // One unsplittable sentence: no comma, semicolon, colon or conjunction to cut on.
    const UNSPLITTABLE = `${Array(60).fill("garden").join(" ")}.`;
    const scenes = [
      // Pace drift: over the ceiling on fewer than LONG_WORDS words.
      scene(1, LONG_SCENE_MAX_SEC + 2, { scriptText: sentences(2, 5) }),
      scene(2, LONG_SCENE_MAX_SEC + 4, { qrHero: true, cta: true }),
      scene(3, 8, { qrTail: true, cta: true }),
      scene(4, LONG_SCENE_MAX_SEC + 12, { scriptText: UNSPLITTABLE }),
      scene(5, 1), // sub-floor runt — coalesce must not merge it past the ceiling
      scene(6, 9.5),
    ];
    const out = coalesceShortScenes(
      splitOverlongScenes(scenes).map(s => ({
        // Children come back with audioDuration cleared; stand in for the re-measure the
        // pipeline does via assignSceneRanges so the end state is checkable here.
        ...s,
        audioDuration: s.audioDuration ?? 5,
      }))
    );
    const msg = describeOverlongScenes(out);
    expect(msg).not.toBeNull();
    // The clause-less sentence is the ONLY survivor — everything else is in band.
    expect(msg!).toContain("1 scene(s) over");
    expect(out.filter(s => s.scriptText === UNSPLITTABLE)).toHaveLength(1);
  });

  it("returns null on an in-band list", () => {
    expect(
      describeOverlongScenes([scene(1, LONG_SCENE_MAX_SEC), scene(2, 4)])
    ).toBeNull();
  });
});

describe("generateSceneClips routing (HeyGen lip-sync vs grok-imagine-video)", () => {
  const originalLipsyncEnv = { key: ENV.heygenApiKey };
  // Drain pending macrotasks so a dangling keyframe promise (a runChunkTasks sibling still
  // resolving after its scene rejected) lands on the shared mockGenImage HERE and is then cleared,
  // instead of bleeding a stray call into the next test (the mock is module-level, not per-test).
  afterEach(async () => {
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    vi.restoreAllMocks();
    ENV.heygenApiKey = originalLipsyncEnv.key;
  });

  /**
   * The real HeyGen lane from `resolveLipsyncAdapter`, with the provider calls stubbed at the
   * PROTOTYPE — so these tests exercise the actual lane wiring (payload shape, poll ceiling,
   * semaphore) instead of a hand-built lane object that could drift from it.
   */
  async function heygenLane(pollResult?: any) {
    ENV.heygenApiKey = "test-key";
    const submitLipsync = vi
      .spyOn(HeygenLipsyncAdapter.prototype, "submitLipsync")
      .mockResolvedValue({ taskId: "task-1" });
    const pollVideo = vi
      .spyOn(HeygenLipsyncAdapter.prototype, "pollVideo")
      .mockResolvedValue(
        pollResult ?? {
          success: true,
          fileData: Buffer.from("fake-video"),
          mimeType: "video/mp4",
        }
      );
    const lane = (await resolveLipsyncAdapter(baseParams))!;
    return { lane, submitLipsync, pollVideo };
  }
  beforeEach(() => {
    mockGenImage.mockReset();
    mockGenImage.mockResolvedValue(okStill());
  });

  const hostScene: StoryboardScene = {
    index: 0,
    narration: "n",
    visualPrompt: "host on camera",
    hostPresent: true,
    audioUrl: "https://cdn.example.com/audio.mp3",
    // Host scene lip-syncs as a single HeyGen task covering the full narration.
    audioDuration: 2.5,
  };
  const params: LongformInputParams = {
    ...baseParams,
    faceImageUrl: "https://cdn.example.com/face.jpg",
  };

  it("routes host+face to lip-sync: lipsynced=true and submitLipsync called once", async () => {
    const { lane: lipsync, submitLipsync } = await heygenLane();
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/clip.mp4",
    });
    // The fake poll buffer isn't a real mp4; stub the duration probe so the guard sees a
    // clip covering the narration instead of probing it to 0s.
    vi.spyOn(videoAssembly, "probeBufferDurationSec").mockResolvedValue(2.5);
    // Guard expects the real narration length (probed from audioUrl), not audioDuration.
    vi.spyOn(videoAssembly, "probeUrlDurationSec").mockResolvedValue(2.5);
    const scene = { ...hostScene };
    const urls = await generateSceneClips(
      null as any,
      0,
      scene,
      params,
      lipsync,
      "instruction",
      async () => {}
    );
    expect(scene.lipsynced).toBe(true);
    expect(submitLipsync).toHaveBeenCalledOnce();
    expect(urls).toEqual(["https://cdn.example.com/clip.mp4"]);
  });

  it("sends the alt host photo on alt shots and the primary otherwise", async () => {
    // Avatar IV inherits gaze from the still it animates — there is no camera/gaze knob —
    // so the only lever for cut variation is WHICH photo we submit.
    const photoFor = async (
      hostShot: 0 | 1 | undefined,
      faceImageUrl2?: string
    ) => {
      const { lane: lipsync, submitLipsync: submit } = await heygenLane();
      vi.spyOn(storage, "storagePut").mockResolvedValue({
        key: "k",
        url: "https://cdn.example.com/clip.mp4",
      });
      vi.spyOn(videoAssembly, "probeBufferDurationSec").mockResolvedValue(2.5);
      vi.spyOn(videoAssembly, "probeUrlDurationSec").mockResolvedValue(2.5);
      await generateSceneClips(
        null as any,
        0,
        { ...hostScene, hostShot },
        { ...params, faceImageUrl2 },
        lipsync,
        "instruction",
        async () => {}
      );
      return submit.mock.calls[0][0].imageUrl;
    };

    const alt = "https://cdn.example.com/face-alt.jpg";
    expect(await photoFor(1, alt)).toBe(alt);
    expect(await photoFor(0, alt)).toBe(params.faceImageUrl);
    // No alt photo configured: fall back to the primary still.
    expect(await photoFor(1, undefined)).toBe(params.faceImageUrl);
  });

  it("rejects a truncated lip-sync clip: throws PendingRenderError and clears renderTaskIds so it re-renders fresh", async () => {
    const { lane: lipsync } = await heygenLane();
    const putSpy = vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/clip.mp4",
    });
    // Provider returned a clip far shorter than the 2.5s narration — the truncation that the
    // last-frame clone-pad would otherwise mask as a frozen host.
    vi.spyOn(videoAssembly, "probeBufferDurationSec").mockResolvedValue(1.5);
    // Real narration is the full 2.5s, so 1.5s is a genuine short render.
    vi.spyOn(videoAssembly, "probeUrlDurationSec").mockResolvedValue(2.5);
    const scene: StoryboardScene = { ...hostScene };
    await expect(
      generateSceneClips(
        null as any,
        0,
        scene,
        params,
        lipsync,
        "instruction",
        async () => {}
      )
    ).rejects.toThrow(/truncated/i);
    // renderTaskIds cleared so the resume path re-submits fresh (no stuck poll of a short clip),
    // and the truncated clip is never uploaded.
    expect(scene.renderTaskIds).toBeUndefined();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it("accepts a floored short host scene: clip matches the real (sub-floor) narration, not audioDuration", async () => {
    const { lane: lipsync } = await heygenLane();
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/clip.mp4",
    });
    // coalesceShortScenes floored audioDuration to 2.5 (hold floor), but the real narration
    // is 1.39s and HeyGen renders 1.39s. The guard must compare against the real audio
    // (1.39s), not the floored 2.5 — otherwise this scene retries forever (the original bug).
    vi.spyOn(videoAssembly, "probeUrlDurationSec").mockResolvedValue(1.39);
    vi.spyOn(videoAssembly, "probeBufferDurationSec").mockResolvedValue(1.39);
    const scene: StoryboardScene = { ...hostScene, audioDuration: 2.5 };
    const urls = await generateSceneClips(
      null as any,
      0,
      scene,
      params,
      lipsync,
      "instruction",
      async () => {}
    );
    expect(urls).toEqual(["https://cdn.example.com/clip.mp4"]);
  });

  const brollScene: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "ladybug on a leaf",
    hostPresent: false,
    audioDuration: 5,
  };

  const okVideoPoll = {
    success: true,
    fileData: Buffer.from("vid"),
    mimeType: "video/mp4",
  };

  it("b-roll without an APIMART key fails loud — no silent 69Labs swap", async () => {
    // Production b-roll is APIMART-only. A tab with no key must fail the scene (the
    // completeness gate then stops the job) rather than render on a different provider.
    const adapter = {
      submitVideo: vi.fn(),
      pollVideo: vi.fn(),
    };
    await expect(
      generateSceneClips(
        adapter as any,
        7,
        { ...brollScene },
        baseParams,
        null,
        "instruction",
        async () => {}
      )
    ).rejects.toThrow(/APIMART only/i);
    expect(adapter.submitVideo).not.toHaveBeenCalled();
    expect(mockGenImage).not.toHaveBeenCalled();
  });

  it("69labs-only test runner b-roll: generates a gpt-image-2 still and submits with imageUrls and NO videoInputMode", async () => {
    const adapter = {
      submitVideo: vi.fn().mockResolvedValue({ taskId: "vid-1" }),
      pollVideo: vi.fn().mockResolvedValue(okVideoPoll),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    await generateSceneClips(
      adapter as any,
      7,
      { ...brollScene },
      baseParams,
      null,
      "instruction",
      async () => {},
      undefined,
      true // allow69Labs (local test runner)
    );

    expect(mockGenImage).toHaveBeenCalledOnce();
    expect(adapter.submitVideo).toHaveBeenCalledOnce();
    const sub = adapter.submitVideo.mock.calls[0][0];
    expect(sub.model).toBe("grok-imagine-video");
    // The 69Labs opt-in also carries grok — a text-to-video weakling that still needs a
    // start frame.
    expect(sub.imageUrls).toHaveLength(1);
    // Grok exposes no mode here — the b-roll submit must NOT carry a videoInputMode.
    expect(sub.videoInputMode).toBeUndefined();
  });

  // Every b-roll clip is image-to-video on BOTH lanes: grok reads the lone gpt-image-2
  // keyframe as its start frame, so the composed still fixes the subject and the prompt is
  // left to drive the motion.
  it("APIMART b-roll: renders a gpt-image-2 keyframe and submits grok with imageUrls", async () => {
    const submit = vi
      .spyOn(ApimartAdapter.prototype, "submitVideo")
      .mockResolvedValue({ taskId: "vid-1" } as any);
    vi.spyOn(ApimartAdapter.prototype, "pollVideo").mockResolvedValue(
      okVideoPoll as any
    );
    vi.spyOn(db, "getAppSetting").mockImplementation(async k =>
      k === "apimart_key_slot_2"
        ? JSON.stringify({ last4: "-key", enc: encrypt("slot-key") })
        : null
    );
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    await generateSceneClips(
      { submitVideo: vi.fn(), pollVideo: vi.fn() } as any,
      7,
      { ...brollScene },
      { ...baseParams, apimartSlot: 2 },
      null,
      "instruction",
      async () => {}
    );

    expect(mockGenImage).toHaveBeenCalled();
    const sub = submit.mock.calls[0][0];
    expect(sub.model).toBe("grok-imagine-video");
    // Exactly one image — grok would read a second as another ingredient frame.
    expect(sub.imageUrls).toHaveLength(1);
    // Grok exposes no mode here — the b-roll submit must NOT carry a videoInputMode.
    expect(sub.videoInputMode).toBeUndefined();
  });

  it("b-roll keeps resuming the same model on transient stalls — no cross-model (veo) fallback", async () => {
    const submits: string[] = [];
    const adapter = {
      // Encode the submitted model in the taskId so pollVideo can react to it.
      submitVideo: vi.fn().mockImplementation(async (p: any) => {
        submits.push(p.model);
        return { taskId: p.model };
      }),
      // The provider stalls transiently on every poll — no veo element to fall over to.
      pollVideo: vi.fn().mockResolvedValue({
        success: false,
        error: "INTERNAL: provider took too long",
      }),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    // Each generateSceneClips call is one render/resume pass. Every pass stalls and stays
    // resumable (PendingRenderError); it never advances to a different model.
    const scene: StoryboardScene = { ...brollScene };
    for (let pass = 1; pass <= 4; pass++) {
      await expect(
        generateSceneClips(
          adapter as any,
          7,
          scene,
          baseParams,
          null,
          "instruction",
          async () => {},
          undefined,
          true // allow69Labs (mock adapter stands in for the APIMART one)
        )
      ).rejects.toBeInstanceOf(PendingRenderError);
      expect(scene.renderAttempts).toBe(pass);
    }

    // Only grok was ever submitted — no veo.
    expect(submits).toEqual(Array(4).fill("grok-imagine-video"));
  });

  const policyError = () =>
    new Error(
      "APIMART blocked this scene's prompt (content policy). Simplify the visual, remove real names, and avoid age-sensitive wording, then retry."
    );

  it("b-roll content-policy ladder: normal → aggressive → llm-rewrite → generic, then completes", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: "a sunlit garden path" } as any);
    const adapter = {
      submitVideo: vi
        .fn()
        .mockRejectedValueOnce(policyError())
        .mockRejectedValueOnce(policyError())
        .mockRejectedValueOnce(policyError())
        .mockResolvedValue({ taskId: "vid-1" }),
      pollVideo: vi.fn().mockResolvedValue(okVideoPoll),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    const urls = await generateSceneClips(
      adapter as any,
      7,
      { ...brollScene },
      baseParams,
      null,
      "instruction",
      async () => {},
      undefined,
      true // allow69Labs (mock adapter stands in for the APIMART one)
    );

    expect(urls).toEqual(["https://cdn.example.com/asset"]);
    expect(adapter.submitVideo).toHaveBeenCalledTimes(4);
    const prompts = adapter.submitVideo.mock.calls.map(
      (c: any[]) => c[0].prompt as string
    );
    expect(prompts[2]).toContain("a sunlit garden path"); // llm-rewrite tier
    expect(prompts[3]).toContain(GENERIC_SAFE_VISUAL); // generic last resort
    expect(mockInvoke).toHaveBeenCalledOnce();
  });

  it("b-roll ladder skips llm-rewrite straight to generic when Claude is down", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error("claude down"));
    const adapter = {
      submitVideo: vi
        .fn()
        .mockRejectedValueOnce(policyError())
        .mockRejectedValueOnce(policyError())
        .mockResolvedValue({ taskId: "vid-1" }),
      pollVideo: vi.fn().mockResolvedValue(okVideoPoll),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    await generateSceneClips(
      adapter as any,
      7,
      { ...brollScene },
      baseParams,
      null,
      "instruction",
      async () => {},
      undefined,
      true // allow69Labs (mock adapter stands in for the APIMART one)
    );

    expect(adapter.submitVideo).toHaveBeenCalledTimes(3);
    expect(adapter.submitVideo.mock.calls[2][0].prompt).toContain(
      GENERIC_SAFE_VISUAL
    );
  });

  it("b-roll ladder is terminal only when even the generic prompt is blocked", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: "a sunlit garden path" } as any);
    const adapter = {
      submitVideo: vi.fn().mockRejectedValue(policyError()),
      pollVideo: vi.fn().mockResolvedValue(okVideoPoll),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    await expect(
      generateSceneClips(
        adapter as any,
        7,
        { ...brollScene },
        baseParams,
        null,
        "instruction",
        async () => {},
        undefined,
        true // allow69Labs (mock adapter stands in for the APIMART one)
      )
    ).rejects.toThrow(/content policy/i);
    // normal, aggressive, llm-rewrite, generic — exactly four prompts, then terminal.
    expect(adapter.submitVideo).toHaveBeenCalledTimes(4);
  });

  it("b-roll hard-fails (no text-only fallback) when keyframe gen fails", async () => {
    mockGenImage.mockResolvedValue({ success: false, error: "boom" });
    const adapter = {
      submitVideo: vi.fn().mockResolvedValue({ taskId: "vid-1" }),
      pollVideo: vi.fn().mockResolvedValue(okVideoPoll),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    await expect(
      generateSceneClips(
        adapter as any,
        7,
        { ...brollScene },
        baseParams,
        null,
        "instruction",
        async () => {},
        undefined,
        true // allow69Labs (mock adapter stands in for the APIMART one)
      )
    ).rejects.toThrow(/boom/);

    // Keyframe gen retries 4× (generateValidatedStill) before giving up on the failure.
    expect(mockGenImage).toHaveBeenCalledTimes(4);
    // No degradation: the failed keyframe means the clip is never submitted text-only.
    expect(adapter.submitVideo).not.toHaveBeenCalled();
  });

  it("does NOT generate a keyframe for a host (face-ref) clip on 69Labs — submits the face req unchanged", async () => {
    const adapter = {
      submitVideo: vi.fn().mockResolvedValue({ taskId: "vid-1" }),
      pollVideo: vi.fn().mockResolvedValue(okVideoPoll),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });
    const hostOn69: StoryboardScene = {
      index: 2,
      narration: "n",
      visualPrompt: "host on camera",
      hostPresent: true,
      audioDuration: 5,
    };

    await generateSceneClips(
      adapter as any,
      7,
      hostOn69,
      { ...baseParams, faceImageUrl: "https://cdn.example.com/face.jpg" },
      null,
      "instruction",
      async () => {},
      undefined,
      true // allowHostOn69Labs
    );

    expect(mockGenImage).not.toHaveBeenCalled();
    const sub = adapter.submitVideo.mock.calls[0][0];
    expect(sub.imageUrls).toEqual(["https://cdn.example.com/face.jpg"]);
    expect(sub.videoInputMode).toBe("ingredients");
  });
});

describe("generateSceneClip (blocking legacy / split-screen right-half path)", () => {
  // Drain pending macrotasks so a dangling keyframe promise (a runChunkTasks sibling still
  // resolving after its scene rejected) lands on the shared mockGenImage HERE and is then cleared,
  // instead of bleeding a stray call into the next test (the mock is module-level, not per-test).
  afterEach(async () => {
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    mockGenImage.mockReset();
    mockGenImage.mockResolvedValue(okStill());
  });

  // An adapter WITHOUT submitVideo/pollVideo forces the legacy blocking branch, which calls
  // generateSceneClip — the same helper the split-screen right half uses. generateVideo
  // returns GenerationResult[]. These assert the right half gets image-first keyframes on a
  // single grok candidate (no fallback), matching the standalone resumable b-roll path.
  const brollScene: StoryboardScene = {
    index: 1,
    narration: "n",
    visualPrompt: "ladybug on a leaf",
    hostPresent: false,
    audioDuration: 5,
  };
  const okVideoGen = [
    { success: true, fileData: Buffer.from("vid"), mimeType: "video/mp4" },
  ];

  it("b-roll on the legacy path: generates a gpt-image-2 keyframe and submits with imageUrls and NO videoInputMode", async () => {
    const adapter = {
      generateVideo: vi.fn().mockResolvedValue(okVideoGen),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    await generateSceneClips(
      adapter as any,
      7,
      { ...brollScene },
      baseParams,
      null,
      "instruction",
      async () => {},
      undefined,
      true // allow69Labs (mock adapter stands in for the APIMART one)
    );

    expect(mockGenImage).toHaveBeenCalledOnce();
    expect(adapter.generateVideo).toHaveBeenCalledOnce();
    const req = adapter.generateVideo.mock.calls[0][0];
    expect(req.model).toBe("grok-imagine-video");
    // grok still needs a start frame on the blocking path too.
    expect(req.imageUrls).toHaveLength(1);
    expect(req.videoInputMode).toBeUndefined();
  });

  it("legacy-path b-roll: hard-fails (no text-only fallback) when keyframe gen fails", async () => {
    // The legacy path retries the clip twice with a 45s sleep between attempts — fake timers
    // flush that without a real wait.
    vi.useFakeTimers();
    mockGenImage.mockResolvedValue({ success: false, error: "boom" });
    const adapter = {
      generateVideo: vi.fn().mockResolvedValue(okVideoGen),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });

    const p = generateSceneClips(
      adapter as any,
      7,
      { ...brollScene },
      baseParams,
      null,
      "instruction",
      async () => {},
      undefined,
      true // allow69Labs (mock adapter stands in for the APIMART one)
    );
    const assertion = expect(p).rejects.toThrow(/boom/);
    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();

    // Both clip attempts try a keyframe (4 retries each via generateValidatedStill = 8) and
    // never fall through to a text-only generateVideo.
    expect(mockGenImage).toHaveBeenCalledTimes(8);
    expect(adapter.generateVideo).not.toHaveBeenCalled();
  });

  // (Dropped the former "veo-video → grok fallback" legacy-path test: b-roll is now grok-only,
  // and buildClipChain's grok-only chain is asserted in the buildClipChain unit tests above.)

  it("host (face-ref) scene on the legacy path: NO keyframe, face req submitted unchanged", async () => {
    const adapter = {
      generateVideo: vi.fn().mockResolvedValue(okVideoGen),
    };
    vi.spyOn(storage, "storagePut").mockResolvedValue({
      key: "k",
      url: "https://cdn.example.com/asset",
    });
    const hostScene: StoryboardScene = {
      index: 2,
      narration: "n",
      visualPrompt: "host on camera",
      hostPresent: true,
      audioDuration: 4,
    };

    await generateSceneClips(
      adapter as any,
      7,
      hostScene,
      { ...baseParams, faceImageUrl: "https://cdn.example.com/face.jpg" },
      null,
      "instruction",
      async () => {},
      undefined,
      true // allowHostOn69Labs
    );

    expect(mockGenImage).not.toHaveBeenCalled();
    const req = adapter.generateVideo.mock.calls[0][0];
    expect(req.imageUrls).toEqual(["https://cdn.example.com/face.jpg"]);
    expect(req.videoInputMode).toBe("ingredients");
  });
});

describe("dispatchScenesByProvider (two provider lanes)", () => {
  const params: LongformInputParams = {
    ...baseParams,
    faceImageUrl: "https://cdn.example.com/face.jpg",
  };
  const lipsync = {} as any; // truthy lip-sync adapter — only its presence matters to the predicate

  const hostScene = (i: number): StoryboardScene => ({
    index: i,
    narration: "n",
    visualPrompt: "host on camera",
    hostPresent: true,
    audioUrl: "https://cdn.example.com/audio.mp3",
    audioDuration: 5,
  });
  const brollScene = (i: number): StoryboardScene => ({
    index: i,
    narration: "n",
    visualPrompt: "b-roll cutaway",
    hostPresent: false,
  });

  it("classifies scenes into host (HeyGen) vs 69Labs lanes", () => {
    expect(isHostLipsyncScene(hostScene(1), lipsync, params)).toBe(true);
    expect(isHostLipsyncScene(brollScene(2), lipsync, params)).toBe(false);
    // No lip-sync adapter → host scene falls to the 69Labs lane.
    expect(isHostLipsyncScene(hostScene(3), null, params)).toBe(false);
  });

  it("never exceeds each provider's concurrency and runs both lanes at once", async () => {
    const scenes = [
      ...Array.from({ length: 8 }, (_, i) => hostScene(i + 1)),
      ...Array.from({ length: 50 }, (_, i) => brollScene(100 + i)),
    ];

    let hostInFlight = 0;
    let brollInFlight = 0;
    let hostPeak = 0;
    let brollPeak = 0;
    let sawOverlap = false; // a host and a b-roll scene in flight simultaneously

    await dispatchScenesByProvider(scenes, lipsync, params, async scene => {
      const host = isHostLipsyncScene(scene, lipsync, params);
      if (host) {
        hostInFlight++;
        hostPeak = Math.max(hostPeak, hostInFlight);
      } else {
        brollInFlight++;
        brollPeak = Math.max(brollPeak, brollInFlight);
      }
      if (hostInFlight > 0 && brollInFlight > 0) sawOverlap = true;
      await new Promise(r => setTimeout(r, 2));
      if (host) hostInFlight--;
      else brollInFlight--;
    });

    expect(hostPeak).toBeLessThanOrEqual(ENV.heygenConcurrency);
    expect(brollPeak).toBeLessThanOrEqual(ENV.sixtynineVideoConcurrency);
    // Both lanes progressed together — host backlog never gated b-roll start.
    expect(sawOverlap).toBe(true);
    // Lanes actually ran in parallel (peaks reached, not serialized to 1).
    expect(hostPeak).toBeGreaterThan(1);
    expect(brollPeak).toBeGreaterThan(1);
  });
});

describe("dispatchScenesByProvider 69labs image/video lane saturation", () => {
  // A 69labs storyboard interleaves still-image cutaways and motion b-roll throughout (≈50/50,
  // STILL_IMAGE_FRACTION). Stills hold an image slot (cap 60), motion holds a video slot (cap 30)
  // for the keyframe→submit→poll lifecycle. With a SINGLE broll worker pool sized to the *video*
  // cap, stills and motion share those workers, so neither 69labs cap is ever saturated — the
  // exact under-utilization this guards against. processOne mirrors the real semaphore usage
  // (`generateSceneClips` → image slot for stills, video slot + keyframe image slot for motion)
  // against the real global semaphores, so this measures the actual dispatch lane structure.
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const stillScene = (i: number): StoryboardScene => ({
    index: i,
    narration: "n",
    visualPrompt: "still cutaway",
    hostPresent: false,
    stillImage: true,
  });
  const motionScene = (i: number): StoryboardScene => ({
    index: i,
    narration: "n",
    visualPrompt: "motion b-roll",
    hostPresent: false,
  });

  it("saturates the 69labs video cap with interleaved stills + motion b-roll", async () => {
    // 2× the video cap of each kind, interleaved still/motion the way a real storyboard is.
    const per = ENV.sixtynineVideoConcurrency * 2;
    const scenes: StoryboardScene[] = [];
    for (let i = 0; i < per; i++) {
      scenes.push(stillScene(i * 2));
      scenes.push(motionScene(i * 2 + 1));
    }

    let videoPeak = 0;
    let imagePeak = 0;
    // No lip-sync adapter + no faceImageUrl → every scene is a 69labs broll scene.
    await dispatchScenesByProvider(scenes, null, baseParams, async scene => {
      if (USE_IMAGE_LANE && scene.stillImage) {
        await SIXTYNINE_IMAGE_SLOTS.acquire();
        imagePeak = Math.max(imagePeak, SIXTYNINE_IMAGE_SLOTS.inUse());
        await sleep(10);
        SIXTYNINE_IMAGE_SLOTS.release();
      } else {
        await SIXTYNINE_VIDEO_SLOTS.acquire();
        videoPeak = Math.max(videoPeak, SIXTYNINE_VIDEO_SLOTS.inUse());
        // Image-first keyframe holds an image slot briefly inside the video slot.
        await SIXTYNINE_IMAGE_SLOTS.acquire();
        imagePeak = Math.max(imagePeak, SIXTYNINE_IMAGE_SLOTS.inUse());
        SIXTYNINE_IMAGE_SLOTS.release();
        await sleep(10);
        SIXTYNINE_VIDEO_SLOTS.release();
      }
    });

    // Motion b-roll must be able to fill every video slot; stills must not starve it.
    expect(videoPeak).toBe(ENV.sixtynineVideoConcurrency);
    // Stills run on their OWN image lane with an independent cap: image work saturates that cap
    // regardless of how it compares to the video cap (it is NOT gated by the video lane).
    expect(imagePeak).toBe(ENV.sixtynineImageConcurrency);
  });
});

describe("stripHostNames", () => {
  // Aliases as `hostNameAliases` builds them: [full name, display name, first name].
  const RILEY = ["Riley Danvers", "Danvers Outdoors", "Riley"];

  it("replaces a bare first name with 'the host'", () => {
    expect(stripHostNames("Riley crouches beside a mower", RILEY)).toBe(
      "the host crouches beside a mower"
    );
  });

  it("handles possessive forms (straight and curly apostrophes)", () => {
    expect(stripHostNames("Riley holds up Riley's book", RILEY)).toBe(
      "the host holds up the host's book"
    );
    expect(stripHostNames("Riley’s protocol", RILEY)).toBe(
      "the host's protocol"
    );
  });

  it("strips a multi-word alias before its bare first name", () => {
    expect(stripHostNames("Riley Danvers waves", RILEY)).toBe("the host waves");
    expect(stripHostNames("Danvers Outdoors presents", RILEY)).toBe(
      "the host presents"
    );
  });

  it("is case-insensitive and word-boundaried", () => {
    // "Hank" matches; the substring in "thanks" must not.
    expect(stripHostNames("HANK says thanks", ["Hank"])).toBe(
      "the host says thanks"
    );
  });

  it("is a no-op when the channel has no aliases", () => {
    expect(stripHostNames("Riley waves", [])).toBe("Riley waves");
  });

  it("leaves unrelated proper nouns untouched", () => {
    expect(stripHostNames("Riley nods at Daniel", RILEY)).toBe(
      "the host nods at Daniel"
    );
  });
});

const wc = (s: string | undefined) =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** `n` filler words — lets fixtures size themselves off LONG_WORDS instead of a hardcoded ceiling. */
const filler = (n: number) => Array(n).fill("garden").join(" ");

describe("segmentScriptByDuration", () => {
  it("one sentence at/above the floor = one scene, boundaries on sentence ends", () => {
    // Six ~13-word sentences → six chunks, one per sentence.
    const S = (n: string) =>
      `${n} sentence here carries about thirteen spoken words to fill one scene cleanly`;
    const script = [
      S("first"),
      S("second"),
      S("third"),
      S("fourth"),
      S("fifth"),
      S("sixth"),
    ].join(". ");
    const units = splitIntoUnits(script);
    const chunks = segmentScriptByDuration(units, script);
    expect(chunks).toHaveLength(units.length);
    // Verbatim: the offset spans tile the script byte-for-byte.
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
    // Every cut lands where a sentence ends.
    const unitEnds = new Set(units.map(u => u.end));
    for (const c of chunks) expect(unitEnds.has(c.end)).toBe(true);
  });

  it("merges consecutive short sentences up to the floor, never splitting one", () => {
    const script =
      "Yes. It works. Every time. The closing sentence here carries exactly eleven spoken words total.";
    const units = splitIntoUnits(script);
    const chunks = segmentScriptByDuration(units, script);
    // The three runts (1+2+2 words) stay under the floor and keep absorbing forward until
    // the 11-word sentence pushes the chunk over it — one scene, no mid-sentence cut.
    expect(chunks).toHaveLength(1);
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
  });

  it("clause-splits a single over-long sentence so it can break", () => {
    const script =
      "we water the garden bed in the early morning, then we carefully trim all of the tall hedges around the yard, and we rake the dry leaves into one big pile, and finally we stack the cut firewood by the back door, " +
      "then we spread fresh mulch around every rose bush and every fruit tree in the side yard, and we check each drip line for clogs before the afternoon sun gets too hot on the beds, and we refill the bird bath with clean water for the cardinals and the finches, " +
      "and we sweep the porch steps clear of pollen and fallen petals before the evening breeze picks up again across the whole garden";
    const units = splitIntoUnits(script);
    expect(units).toHaveLength(1); // one sentence
    expect(wc(script)).toBeGreaterThan(LONG_WORDS); // over the long ceiling → must clause-split
    const chunks = segmentScriptByDuration(units, script);
    expect(chunks.length).toBeGreaterThan(1); // broke at a clause
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
    for (const c of chunks) {
      expect(wc(script.slice(c.start, c.end))).toBeLessThanOrEqual(LONG_WORDS);
    }
  });

  it("a sentence under the long ceiling is never clause-split", () => {
    const script =
      "we water the garden bed in the early morning, then we carefully trim the tall hedges, and we rake the dry leaves. the second sentence here carries exactly eleven spoken words total.";
    const units = splitIntoUnits(script);
    expect(units).toHaveLength(2);
    expect(wc(units[0].text)).toBeLessThanOrEqual(LONG_WORDS);
    const chunks = segmentScriptByDuration(units, script);
    expect(chunks).toHaveLength(2); // one scene per sentence, commas untouched
    expect(chunks[0].end).toBe(units[0].end);
  });

  it("absorbs a sub-floor trailing chunk into the previous one", () => {
    const A =
      "the first sentence here carries exactly eleven spoken words per chunk";
    const B =
      "the second sentence here carries exactly eleven spoken words per chunk";
    expect(wc(A)).toBe(11);
    expect(wc(B)).toBe(11);
    const script = `${A}. ${B}. and that is the final tail bit.`; // tail = 7 words (sub-floor)
    const units = splitIntoUnits(script);
    const chunks = segmentScriptByDuration(units, script);
    // The 7-word tail is sub-floor (< FLOOR_WORDS 8) and absorbed into the previous chunk
    // (merge 18 ≤ LONG_WORDS), not left a runt.
    expect(chunks).toHaveLength(2);
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
    expect(wc(script.slice(chunks[1].start, chunks[1].end))).toBe(18); // B + tail
  });

  it("leaves a too-large sub-floor tail as its own chunk (best-effort)", () => {
    const A =
      "the first sentence here carries exactly eleven spoken words per chunk";
    // B sits just under the ceiling: one chunk on its own, but absorbing the 7-word tail
    // would cross it — so the tail stays a runt chunk. Sized off LONG_WORDS so the fixture
    // survives ceiling changes.
    const B = filler(LONG_WORDS - 3);
    const tail = "and that is the final tail bit"; // 7 words (sub-floor) → merge > LONG_WORDS
    const script = `${A}. ${B}. ${tail}.`;
    expect(wc(B)).toBeLessThanOrEqual(LONG_WORDS);
    expect(wc(B) + 7).toBeGreaterThan(LONG_WORDS);
    const chunks = segmentScriptByDuration(splitIntoUnits(script), script);
    expect(chunks).toHaveLength(3);
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
  });

  // ── Locked host cold open: the leading chunks are packed against a FLOOR of
  // HOST_MIN_HOLD_SEC worth of words, so each opening host shot genuinely SPEAKS its 4s
  // instead of voicing short and freeze-holding a face over inserted silence. ──

  it("floors the opener chunks at the host hold — never closes under it", () => {
    const floorWords = Math.ceil(HOST_MIN_HOLD_SEC * WORDS_PER_SEC); // 12
    // Sentence 1 opens on a 3-word clause followed by a 15-word one: under the old
    // ceiling rule 3 + 15 crossed the ceiling, so the opener closed at THREE words (~1s).
    // Sentence 2 is 11 words — in band for a cutaway, still under the host floor.
    const script =
      "look at this, a rusted patch of metal sitting right under the paint of your old truck door. " +
      "the second sentence here carries exactly eleven spoken words per chunk. " +
      "a third sentence here also carries exactly eleven spoken words total. " +
      "a fourth sentence here also carries exactly eleven spoken words total.";
    const units = splitIntoUnits(script);
    const plain = segmentScriptByDuration(units, script);
    const opened = segmentScriptByDuration(units, script, WORDS_PER_SEC, 2);
    const words = (c: { start: number; end: number }) =>
      wc(script.slice(c.start, c.end));
    // Baseline really does close a sub-host-floor chunk — otherwise this proves nothing.
    expect(words(plain[1])).toBeLessThan(floorWords);
    // Both openers clear the floor; the first swallowed the long clause after the comma
    // rather than closing on it.
    expect(words(opened[0])).toBeGreaterThanOrEqual(floorWords);
    expect(words(opened[1])).toBeGreaterThanOrEqual(floorWords);
    expect(script.slice(opened[0].start, opened[0].end)).toContain(
      "truck door"
    );
    // Everything after the opener falls back to the normal target-sized cut rate.
    expect(words(opened[2])).toBe(11);
  });

  it("closes an opener at the sentence end that clears the floor — no top-up", () => {
    // 11-word sentences against a 12-word host floor: each opener takes exactly two whole
    // sentences (11 < 12, then 22 ≥ 12) and closes ON the sentence boundary.
    const S = (n: string) =>
      `${n} we water the beds, and then we trim the hedges`;
    const script =
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(S).join(". ") + ".";
    const units = splitIntoUnits(script);
    const opened = segmentScriptByDuration(units, script, WORDS_PER_SEC, 2);
    const words = (c: { start: number; end: number }) =>
      wc(script.slice(c.start, c.end));
    const floorWords = Math.ceil(HOST_MIN_HOLD_SEC * WORDS_PER_SEC);
    const unitEnds = new Set(units.map(u => u.end));
    for (const c of opened.slice(0, 2)) {
      expect(words(c)).toBeGreaterThanOrEqual(floorWords);
      // Overshoot is bounded by the single sentence that crossed the floor, and the cut
      // lands on a sentence end — never mid-sentence.
      expect(words(c)).toBeLessThanOrEqual(floorWords + 11);
      expect(unitEnds.has(c.end)).toBe(true);
    }
  });

  it("opener chunks still tile the script verbatim, including a mid-sentence handoff", () => {
    // A long comma-heavy opening sentence forces the first chunk to end mid-sentence; the
    // straddled unit's remainder must be re-emitted so the two halves leave no gap.
    const script =
      "we water the garden bed in the early morning, then we carefully trim the tall hedges, " +
      "and we rake the dry leaves into a pile, and finally we stack the firewood by the door. " +
      "the second sentence here carries exactly eleven spoken words per chunk. " +
      "a third sentence here also carries exactly eleven spoken words total.";
    for (const openers of [0, 1, 2, 3]) {
      const chunks = segmentScriptByDuration(
        splitIntoUnits(script),
        script,
        WORDS_PER_SEC,
        openers
      );
      expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(
        script
      );
      // Spans stay contiguous and forward-only.
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].start).toBe(chunks[i - 1].end);
      }
    }
  });

  it("asking for more opener chunks than the script holds degrades gracefully", () => {
    const script = "one short opening line here.";
    const chunks = segmentScriptByDuration(
      splitIntoUnits(script),
      script,
      WORDS_PER_SEC,
      2
    );
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
  });

  it("end-to-end invariants on a realistic mixed script", () => {
    // Mixed sentence lengths, including runts and a genuinely over-long sentence.
    const script =
      "Stop. Before you spend another dollar on fertilizer, listen closely. " +
      "Your lawn is not hungry, it is thirsty, and the difference costs you forty dollars a bag. " +
      "Here is the thing. " +
      "Most homeowners water for ten minutes every evening because that is what their neighbors do, " +
      "but shallow watering trains the roots to sit near the surface, and surface roots cook in July heat, " +
      "and cooked roots mean brown patches no fertilizer will ever fix, and deep roots need patience " +
      "from anyone willing to measure each sprinkler run with a simple tuna can test in three spots, " +
      "because shallow habits die hard when every lawn on the block looks green for exactly one day, " +
      "and the fix is boring but reliable if you write the minutes down and stick to them all summer. " +
      "Water deep and water rarely. " +
      "Twice a week, one inch each time, measured with a tuna can on the grass. " +
      "That is the whole trick. " +
      "The tuna can trick works because the can is exactly one inch tall. " +
      "Set three cans around the yard, run the sprinkler, and time how long the cans take to fill. " +
      "That number is your watering time from now on. " +
      "Write it down somewhere you will see it.";
    const units = splitIntoUnits(script);
    const chunks = segmentScriptByDuration(units, script);
    // 1. Byte-exact tiling.
    expect(chunks.map(c => script.slice(c.start, c.end)).join("")).toBe(script);
    // 2. Every chunk clears the floor except possibly the lone script tail.
    const counts = chunks.map(c => wc(script.slice(c.start, c.end)));
    for (const w of counts.slice(0, -1)) {
      expect(w).toBeGreaterThanOrEqual(FLOOR_WORDS);
    }
    // 3. No chunk exceeds the long ceiling (the over-long sentence was clause-split).
    for (const w of counts) expect(w).toBeLessThanOrEqual(LONG_WORDS);
    // 4. Every cut lands on a sentence end OR inside the one over-long sentence.
    const unitEnds = new Set(units.map(u => u.end));
    const longUnit = units.find(u => wc(u.text) > LONG_WORDS);
    expect(longUnit).toBeDefined();
    for (const c of chunks) {
      const onSentenceEnd = unitEnds.has(c.end);
      const insideLongSentence =
        !!longUnit && c.end > longUnit.start && c.end < longUnit.end;
      expect(onSentenceEnd || insideLongSentence).toBe(true);
    }
  });
});

describe("splitUnitIntoClauses", () => {
  it("splits at punctuation + conjunctions and tiles the unit verbatim", () => {
    const script = "we water the bed, then we trim the hedges and rake leaves.";
    const [unit] = splitIntoUnits(script);
    const spans = splitUnitIntoClauses(unit, script);
    expect(spans.length).toBeGreaterThan(1);
    expect(spans.map(s => script.slice(s.start, s.end)).join("")).toBe(
      script.slice(unit.start, unit.end)
    );
  });

  it("returns a single span for a clause-less sentence", () => {
    const script = "one solid clause with no internal breaks here.";
    const [unit] = splitIntoUnits(script);
    expect(splitUnitIntoClauses(unit, script)).toHaveLength(1);
  });

  it("cuts at commas only — a conjunction inside an under-ceiling clause is left alone", () => {
    // Commas are tier 1, conjunctions tier 2. Every comma clause here is under the ceiling, so
    // the bare "and"/"that" must NOT become cut points — those read mid-phrase.
    const script = `${filler(6)}, ${filler(6)} and ${filler(3)}, ${filler(6)} that ${filler(3)}.`;
    const [unit] = splitIntoUnits(script);
    const spans = splitUnitIntoClauses(unit, script, LONG_WORDS);
    expect(spans).toHaveLength(3); // two commas → three clauses, no conjunction cuts
    expect(spans.map(s => script.slice(s.start, s.end)).join("")).toBe(script);
    for (const s of spans.slice(1)) {
      expect(script.slice(s.start).startsWith("garden")).toBe(true);
    }
  });

  it("cuts at an em/en dash, spaced or not", () => {
    // Scripts lean on `—` as a clause break; a comma-less sentence joined only by dashes used to
    // come back unsplittable and render one over-ceiling clip.
    for (const script of [
      `${filler(6)} — ${filler(6)} – ${filler(6)}.`,
      `${filler(6)}—${filler(6)}—${filler(6)}.`,
    ]) {
      const [unit] = splitIntoUnits(script);
      const spans = splitUnitIntoClauses(unit, script, LONG_WORDS);
      expect(spans).toHaveLength(3);
      expect(spans.map(s => script.slice(s.start, s.end)).join("")).toBe(
        script
      );
    }
  });

  it("falls back to conjunctions inside a comma clause still over the ceiling", () => {
    // No comma anywhere and well over the ceiling — leaving it whole would render one clip plus
    // a visible freeze-pad, so the conjunction fallback must fire.
    const script = `${filler(LONG_WORDS)} and ${filler(LONG_WORDS)} but ${filler(LONG_WORDS)}.`;
    const [unit] = splitIntoUnits(script);
    const spans = splitUnitIntoClauses(unit, script, LONG_WORDS);
    expect(spans).toHaveLength(3);
    expect(spans.map(s => script.slice(s.start, s.end)).join("")).toBe(script);
  });
});

describe("recognizeVoiceWps / wpsForVoice (recognized speech pace)", () => {
  const scene = (words: number, sec: number, host = false) => ({
    index: 1,
    scriptText: Array(words).fill("word").join(" "),
    narration: "n",
    visualPrompt: "v",
    sceneStatus: "pending" as const,
    audioDuration: sec,
    hostPresent: host || undefined,
  });

  it("returns the median measured words/sec and caches it for the voice", () => {
    // 5 scenes at exactly 2.5 wps (10 words / 4s) → median 2.5, recognized and cached.
    const scenes = Array(5)
      .fill(0)
      .map(() => scene(10, 4));
    expect(recognizeVoiceWps("voice-med", scenes)).toBeCloseTo(2.5, 5);
    expect(wpsForVoice("voice-med")).toBeCloseTo(2.5, 5);
  });

  it("falls back to WORDS_PER_SEC for an unknown voice", () => {
    expect(wpsForVoice("never-seen")).toBe(WORDS_PER_SEC);
    expect(wpsForVoice(undefined)).toBe(WORDS_PER_SEC);
  });

  it("ignores host scenes when measuring the conversational pace", () => {
    // 5 b-roll at 2.5 wps + 5 hosts at an absurd 1.0 wps — the hosts must not drag the median.
    const scenes = [
      ...Array(5)
        .fill(0)
        .map(() => scene(10, 4)),
      ...Array(5)
        .fill(0)
        .map(() => scene(4, 4, true)),
    ];
    expect(recognizeVoiceWps("voice-host", scenes)).toBeCloseTo(2.5, 5);
  });

  it("returns null (caching nothing) on too few samples or an insane median", () => {
    expect(recognizeVoiceWps("voice-few", [scene(10, 4)])).toBeNull();
    const tooFast = Array(5)
      .fill(0)
      .map(() => scene(20, 2)); // 10 wps — outside the sanity clamp
    expect(recognizeVoiceWps("voice-fast", tooFast)).toBeNull();
    expect(wpsForVoice("voice-few")).toBe(WORDS_PER_SEC);
    expect(wpsForVoice("voice-fast")).toBe(WORDS_PER_SEC);
  });
});

describe("floorWordsFor / longWordsFor", () => {
  it("matches the exported default-pace constants", () => {
    expect(floorWordsFor(WORDS_PER_SEC)).toBe(FLOOR_WORDS);
    expect(longWordsFor(WORDS_PER_SEC)).toBe(LONG_WORDS);
  });

  it("scales with the pace: a slower voice packs fewer words per chunk", () => {
    expect(floorWordsFor(2.2)).toBeLessThan(floorWordsFor(3.4));
    expect(longWordsFor(2.2)).toBeLessThan(longWordsFor(3.4));
    // Slow-voice floor still covers the 3s hold at that pace (rounding aside).
    expect(floorWordsFor(2.2) / 2.2).toBeGreaterThanOrEqual(2.9);
  });
});

describe("splitOverlongScenes", () => {
  const scene = (
    scriptText: string,
    extra: Partial<StoryboardScene> = {}
  ): StoryboardScene => ({
    index: 1,
    narration: "n",
    scriptText,
    visualPrompt: "prompt",
    hostPresent: false,
    sceneStatus: "completed",
    audioUrl: "https://r2/audio.mp3",
    audioDuration: 35, // > LONG_SCENE_MAX_SEC → eligible to split
    clipUrls: ["https://r2/clip.mp4"],
    clipUrl: "https://r2/clip.mp4",
    ...extra,
  });

  // Many sentences, well over the word band when combined (> LONG_WORDS).
  const LONG =
    "The first long sentence carries plenty of spoken words to fill several seconds of narration time here. " +
    "The second long sentence likewise carries plenty of spoken words to fill several seconds of narration time here. " +
    "The third long sentence again carries plenty of spoken words to fill several seconds of narration time here. " +
    "The fourth long sentence continues carrying plenty of spoken words to fill several seconds of narration time here. " +
    "The fifth long sentence also carries plenty of spoken words to fill several seconds of narration time here. " +
    "The sixth long sentence still carries plenty of spoken words to fill several seconds of narration time here. " +
    "The seventh long sentence keeps carrying plenty of spoken words to fill several seconds of narration time here. " +
    "The eighth long sentence adds plenty of spoken words to fill several seconds of narration time here.";

  it("splits a long b-roll scene into verbatim slices, reset for re-render", () => {
    const out = splitOverlongScenes([scene(LONG)]);
    expect(out.length).toBeGreaterThan(1);
    const join = out
      .map(s => s.scriptText)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    expect(join).toBe(LONG.replace(/\s+/g, " ").trim());
    for (const s of out) {
      expect(s.audioUrl).toBeUndefined();
      expect(s.audioDuration).toBeUndefined();
      expect(s.clipUrls).toBeUndefined();
      expect(s.clipUrl).toBeUndefined();
      expect(s.renderTaskIds).toBeUndefined();
      expect(s.sceneStatus).toBe("pending");
    }
  });

  it("splits a long host scene, keeping every child host", () => {
    const out = splitOverlongScenes([
      scene(LONG, { hostPresent: true, audioDuration: 35 }),
    ]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every(s => s.hostPresent === true)).toBe(true);
  });

  it("leaves a scene at/under the long ceiling whole — sentence cuts survive TTS", () => {
    // 7s measured is within one max-length clip: no re-split, host or not.
    const out = splitOverlongScenes([
      scene(LONG, { hostPresent: true, audioDuration: 7 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scriptText).toBe(LONG);
    expect(
      splitOverlongScenes([scene(LONG, { audioDuration: 7 })])
    ).toHaveLength(1);
  });

  it("never splits a host scene into sub-HOST_MIN_HOLD_SEC children", () => {
    // 35s of host narration with many short sentences: the word count alone would allow
    // more children, but floor(35 / HOST_MIN_HOLD_SEC) = 8 caps it — no ~3s host beats.
    const MANY =
      Array(12)
        .fill(
          "this host beat carries roughly nine short spoken words here in every single sentence"
        )
        .join(". ") + ".";
    const out = splitOverlongScenes([
      scene(MANY, { hostPresent: true, audioDuration: 35 }),
    ]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it("preserves the still lane and rotates angles on b-roll children", () => {
    const out = splitOverlongScenes([scene(LONG, { stillImage: true })]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every(s => s.stillImage === true)).toBe(true);
    expect(out.every(s => !!s.shotAngle)).toBe(true);
  });

  it("splits an over-long two-sentence scene BETWEEN the sentences", () => {
    // Each sentence sits just under the ceiling (so neither clause-splits) but the pair is
    // over it → exactly two children, cut at the sentence boundary.
    const A = `first ${filler(LONG_WORDS - 2)}`;
    const B = `second ${filler(LONG_WORDS - 2)}`;
    const out = splitOverlongScenes([
      scene(`${A}. ${B}.`, { audioDuration: 35 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].scriptText).toBe(`${A}.`);
    expect(out[1].scriptText).toBe(`${B}.`);
  });

  it("clause-splits a single over-long sentence", () => {
    const sentence =
      "we water the garden bed in the early morning, then we carefully trim all of the tall hedges around the yard, and we rake the dry leaves into one big pile, and finally we stack the cut firewood by the back door, " +
      "then we spread fresh mulch around every rose bush and every fruit tree in the side yard, and we check each drip line for clogs before the afternoon sun gets too hot on the beds, and we refill the bird bath with clean water for the cardinals and the finches, " +
      "and we sweep the porch steps clear of pollen and fallen petals before the evening breeze picks up again across the whole garden";
    const out = splitOverlongScenes([scene(sentence, { audioDuration: 35 })]);
    expect(out.length).toBeGreaterThan(1);
    const join = out
      .map(s => s.scriptText)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    expect(join).toBe(sentence.replace(/\s+/g, " ").trim());
  });

  it("inherits cta / splitVisual onto every child", () => {
    const out = splitOverlongScenes([
      scene(LONG, {
        hostPresent: true,
        audioDuration: 35,
        cta: true,
        splitVisual: "a weed close-up",
      }),
    ]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every(s => s.cta === true)).toBe(true);
    expect(out.every(s => s.splitVisual === "a weed close-up")).toBe(true);
  });

  it("each child re-voiced to the cap is one b-roll clip", () => {
    const out = splitOverlongScenes([scene(LONG)]);
    for (const s of out) {
      s.audioDuration = LONG_SCENE_MAX_SEC;
      expect(clipsNeededFor(s)).toBe(1);
    }
  });

  it("splits on MEASURED length even when the word count is under the ceiling", () => {
    // The pace-drift case the split exists for: delivered slower than the job median, so it
    // measures over the ceiling while carrying fewer than LONG_WORDS words. A word-only child
    // count computes n = 1 here and silently no-ops.
    const text = `${filler(LONG_WORDS - 18)} words here. ${filler(LONG_WORDS - 18)} words here.`;
    expect(text.split(/\s+/).length).toBeLessThan(LONG_WORDS);
    const out = splitOverlongScenes([
      scene(text, { audioDuration: LONG_SCENE_MAX_SEC + 2 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("leaves room for the frozen QR tail on a qrTail beat", () => {
    // On-screen time is narration + QR_TAIL_HOLD_SEC (added in assembly), so the spoken part
    // must clear the ceiling by that much. 8s is in band for any other scene.
    const text = `${filler(6)} beat one. ${filler(6)} beat two.`;
    expect(
      splitOverlongScenes([scene(text, { audioDuration: 8 })])
    ).toHaveLength(1);
    expect(
      splitOverlongScenes([scene(text, { audioDuration: 8, qrTail: true })])
        .length
    ).toBeGreaterThan(1);
  });

  it("never mints children under the scene floor", () => {
    // 11s of many short sentences: the word count would allow more, floor(11 / 3) = 3 caps it.
    const MANY =
      Array(10)
        .fill("this beat carries eight short spoken words here")
        .join(". ") + ".";
    const out = splitOverlongScenes([scene(MANY, { audioDuration: 11 })]);
    expect(out.length).toBeGreaterThan(1);
    expect(out.length).toBeLessThanOrEqual(Math.floor(11 / SCENE_MIN_HOLD_SEC));
  });

  it("leaves an in-band scene unchanged (keeps its audio/clip)", () => {
    const short = scene("One short beat.", { audioDuration: 5 });
    const out = splitOverlongScenes([short]);
    expect(out).toHaveLength(1);
    expect(out[0].scriptText).toBe("One short beat.");
    expect(out[0].audioUrl).toBe("https://r2/audio.mp3");
    expect(out[0].audioDuration).toBe(5);
  });

  it("renumbers the whole list with contiguous 1-based indices", () => {
    const out = splitOverlongScenes([
      scene("Lead beat.", { index: 1, audioDuration: 5 }),
      scene(LONG, { index: 2 }),
      scene("Tail beat.", { index: 3, audioDuration: 5 }),
    ]);
    expect(out.map(s => s.index)).toEqual(
      Array.from({ length: out.length }, (_, i) => i + 1)
    );
    expect(out.length).toBeGreaterThan(3); // middle scene expanded
  });

  it("balances children (no tiny sub-floor tail) instead of greedily filling", () => {
    const A =
      "the first host beat carries roughly twenty spoken words here in one long balanced sentence for the splitter";
    const B =
      "the second host beat carries roughly twenty spoken words here in one long balanced sentence for the splitter";
    const C =
      "the third host beat carries roughly twenty spoken words here in one long balanced sentence for the splitter";
    const D =
      "the fourth host beat carries roughly twenty spoken words here in one long balanced sentence for the splitter";
    const text = `${A}. ${B}. ${C}. ${D}. Got it.`;
    // 20s, not 35: at 35s `ceil(35 / LONG_SCENE_MAX_SEC)` demands 5 children off 5 atoms, so the
    // ceiling (which correctly wins over balance) leaves the coda no one to merge with. Balancing
    // is only meaningful when the ceiling leaves slack.
    const out = splitOverlongScenes([
      scene(text, { hostPresent: true, audioDuration: 20 }),
    ]);
    const join = out
      .map(s => s.scriptText)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    expect(join).toBe(text.replace(/\s+/g, " ").trim());
    // The 2-word coda is never a standalone child.
    expect(out.some(s => (s.scriptText ?? "").trim() === "Got it.")).toBe(
      false
    );
    const counts = out.map(s => wc(s.scriptText));
    const longestUnit = [A, B, C, D].reduce((m, s) => Math.max(m, wc(s)), 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(
      longestUnit
    );
  });
});

describe("per-job render lock (no duplicate submissions)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resumePendingRenders defers a concurrent second call for the same job (never re-enters the render path)", async () => {
    // First call blocks inside the locked core (at the job load); a second concurrent call for the
    // same job must hit the lock and return false WITHOUT loading the job / submitting anything.
    // Without the per-job lock, both calls would reach the DB (calledTimes === 2).
    let releaseFirst!: () => void;
    const gate = new Promise<void>(r => (releaseFirst = r));
    const getJob = vi
      .spyOn(db, "getLongformVideoJobById")
      .mockImplementationOnce(async () => {
        await gate; // hold the lock
        return undefined as any; // no job → locked core returns false
      })
      .mockImplementation(async () => undefined as any);

    const first = resumePendingRenders(1);
    const second = await resumePendingRenders(1); // runs while `first` holds the lock

    expect(second).toBe(false); // deferred to the in-flight pass
    expect(getJob).toHaveBeenCalledTimes(1); // only the first call touched the DB

    releaseFirst();
    await expect(first).resolves.toBe(false);

    // Lock released → a later call proceeds normally (loads the job again).
    await resumePendingRenders(1);
    expect(getJob).toHaveBeenCalledTimes(2);
  });

  it("withJobLock serializes same-job passes and runs different jobs in parallel", async () => {
    const events: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>(r => (releaseA = r));

    // First pass on job 101 holds the lock (gated open).
    const a = withJobLock(101, async () => {
      events.push("A:start");
      await gateA;
      events.push("A:end");
    });
    // Second pass on the SAME job must wait for the first — this is the anti-clobber guarantee:
    // it can't snapshot/mutate the storyboard until the first pass has finished and persisted.
    const b = withJobLock(101, async () => {
      events.push("B:run");
    });
    // A DIFFERENT job is not blocked by job 101's held lock (the lock is keyed by jobId).
    const c = withJobLock(202, async () => {
      events.push("C:run");
    });

    await c; // job 202 finishes while job 101 is still gated
    expect(events).toEqual(["A:start", "C:run"]); // B has NOT run yet
    expect(isJobRendering(101)).toBe(true); // still held

    releaseA();
    await Promise.all([a, b]);
    expect(events).toEqual(["A:start", "C:run", "A:end", "B:run"]); // B ran only after A ended

    await new Promise(r => setTimeout(r, 0)); // let the chain-drain cleanup run
    expect(isJobRendering(101)).toBe(false); // map entry cleaned up (no leak)
    expect(isJobRendering(202)).toBe(false);
  });

  it("withJobLock: a throwing pass doesn't wedge the job's queue", async () => {
    await expect(
      withJobLock(307, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // The next pass on the same job still runs (a failed pass must not wedge the chain).
    await expect(withJobLock(307, async () => "ok")).resolves.toBe("ok");
    await new Promise(r => setTimeout(r, 0));
    expect(isJobRendering(307)).toBe(false);
  });
});

describe("normalizeKeyframeToLandscape", () => {
  const solid = (w: number, h: number) =>
    sharp({
      create: { width: w, height: h, channels: 3, background: "#3a5" },
    })
      .png()
      .toBuffer();

  it("crops a portrait keyframe to 16:9 landscape", async () => {
    const out = await normalizeKeyframeToLandscape(await solid(941, 1672));
    const { width, height } = await sharp(out).metadata();
    expect(width).toBe(1920);
    expect(height).toBe(1080);
  });

  it("leaves an already-landscape keyframe untouched", async () => {
    const src = await solid(1280, 720);
    const out = await normalizeKeyframeToLandscape(src);
    expect(out).toBe(src); // same reference — no re-encode
  });
});

describe("generateValidatedStill", () => {
  const validPng = () =>
    sharp({
      create: { width: 8, height: 8, channels: 3, background: "#3a5" },
    })
      .png()
      .toBuffer();
  const scene = { index: 1, visualPrompt: "a raised garden bed" } as any;

  it("retries a fresh request when the returned buffer is undecodable, then succeeds", async () => {
    const good = await validPng();
    const genImage = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        fileData: Buffer.from("not-an-image"),
      })
      .mockResolvedValueOnce({ success: true, fileData: good });
    const out = await generateValidatedStill(scene, 3, undefined, genImage);
    expect(genImage).toHaveBeenCalledTimes(2);
    expect(out.buffer.equals(good)).toBe(true);
  });

  // Distinct fills: the shared validPng() is deterministic, so a same-colour pair would satisfy
  // these assertions even if the wrong buffer came back.
  const pngOf = (bg: string) =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: bg } })
      .png()
      .toBuffer();

  it("re-rolls a still with stamped overlay text, then returns the clean one", async () => {
    const texty = await pngOf("#111");
    const clean = await pngOf("#3a5");
    mockHasOverlayText.mockResolvedValueOnce(true); // then falls back to the false default
    const genImage = vi
      .fn()
      .mockResolvedValueOnce({ success: true, fileData: texty })
      .mockResolvedValueOnce({ success: true, fileData: clean });
    const out = await generateValidatedStill(scene, 3, undefined, genImage);
    expect(out.buffer.equals(clean)).toBe(true);
    expect(genImage).toHaveBeenCalledTimes(2);
    // Fresh seed, NOT a prompt escalation — stacking a second anti-text clause on top of
    // NO_OVERLAY_TEXT_SUFFIX is the negation-piling NO_BOOK_SUFFIX warns against.
    expect(genImage.mock.calls[1][0].prompt).toBe(
      genImage.mock.calls[0][0].prompt
    );
  });

  it("ships the still when text survives the whole attempt budget (fails open)", async () => {
    const texty = await pngOf("#111");
    mockHasOverlayText.mockResolvedValue(true);
    const genImage = vi.fn().mockResolvedValue({
      success: true,
      fileData: texty,
    });
    // Resolves rather than throwing: one caption must not fail a scene the completeness gate
    // would then stop the whole job on.
    const out = await generateValidatedStill(scene, 3, undefined, genImage);
    expect(out.buffer.equals(texty)).toBe(true);
    expect(genImage).toHaveBeenCalledTimes(3);
    mockHasOverlayText.mockResolvedValue(false); // restore the default for later tests
  });

  it("skips the gate when a reference image is attached (the cover asked for text)", async () => {
    mockHasOverlayText.mockClear(); // call history only — keeps the false default impl
    const good = await validPng();
    const genImage = vi
      .fn()
      .mockResolvedValue({ success: true, fileData: good });
    const out = await generateValidatedStill(
      scene,
      3,
      "https://example.com/cover.png",
      genImage
    );
    expect(out.buffer.equals(good)).toBe(true);
    expect(mockHasOverlayText).not.toHaveBeenCalled();
  });

  it("retries on a transient failure and succeeds on a later attempt", async () => {
    const good = await validPng();
    const genImage = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: "OpenAI image 500: oops",
      })
      .mockResolvedValueOnce({ success: true, fileData: good });
    const out = await generateValidatedStill(scene, 3, undefined, genImage);
    expect(genImage).toHaveBeenCalledTimes(2);
    expect(out.buffer.equals(good)).toBe(true);
  });

  it("escalates aggressive → llm-rewrite → generic on repeated policy blocks, throwing only after generic is blocked", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: "a sunlit garden path" } as any);
    const genImage = vi.fn().mockResolvedValue({
      success: false,
      error: "OpenAI image 400: rejected by our safety system",
    });
    await expect(
      generateValidatedStill(scene, 3, undefined, genImage)
    ).rejects.toThrow(/safety/i);
    // Escalations are free of the attempt budget: 4 prompts even with attempts=3.
    expect(genImage).toHaveBeenCalledTimes(4);
    expect(genImage.mock.calls[2][0].prompt).toContain("a sunlit garden path");
    expect(genImage.mock.calls[3][0].prompt).toContain(GENERIC_SAFE_VISUAL);
  });

  it("recovers at the llm-rewrite tier when the rewrite clears", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: "a sunlit garden path" } as any);
    const good = await validPng();
    const blocked = {
      success: false,
      error: "OpenAI image 400: rejected by our safety system",
    };
    const genImage = vi
      .fn()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce({ success: true, fileData: good });
    const out = await generateValidatedStill(scene, 3, undefined, genImage);
    expect(out.buffer.equals(good)).toBe(true);
    expect(mockInvoke).toHaveBeenCalledOnce();
    const third = genImage.mock.calls[2][0].prompt as string;
    expect(third).toContain("a sunlit garden path");
    expect(third).toContain(AMATEUR_IPHONE_LOOK);
  });

  it("skips the llm-rewrite tier straight to generic when Claude is down", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error("claude down"));
    const good = await validPng();
    const blocked = {
      success: false,
      error: "OpenAI image 400: rejected by our safety system",
    };
    const genImage = vi
      .fn()
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce(blocked)
      .mockResolvedValueOnce({ success: true, fileData: good });
    const out = await generateValidatedStill(scene, 3, undefined, genImage);
    expect(out.buffer.equals(good)).toBe(true);
    expect(genImage).toHaveBeenCalledTimes(3);
    expect(genImage.mock.calls[2][0].prompt).toContain(GENERIC_SAFE_VISUAL);
  });

  it("tries a subject-anchored generic before the topic-free generic when a subject exists", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue({ text: "a sunlit garden path" } as any);
    const genImage = vi.fn().mockResolvedValue({
      success: false,
      error: "OpenAI image 400: rejected by our safety system",
    });
    await expect(
      generateValidatedStill(
        scene,
        3,
        undefined,
        genImage,
        "sharpening kitchen knives"
      )
    ).rejects.toThrow(/safety/i);
    // 0 normal → 1 aggressive → 2 llm-rewrite → 3 subject-generic → 4 generic.
    expect(genImage).toHaveBeenCalledTimes(5);
    const fourth = genImage.mock.calls[3][0].prompt as string;
    expect(fourth).toContain("associated with sharpening kitchen knives");
    expect(fourth).not.toContain(GENERIC_SAFE_VISUAL);
    expect(genImage.mock.calls[4][0].prompt).toContain(GENERIC_SAFE_VISUAL);
  });

  it("recovers at the subject-anchored generic tier", async () => {
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error("claude down")); // rewrite tier unavailable
    const good = await validPng();
    const blocked = {
      success: false,
      error: "OpenAI image 400: rejected by our safety system",
    };
    const genImage = vi
      .fn()
      .mockResolvedValueOnce(blocked) // normal
      .mockResolvedValueOnce(blocked) // aggressive
      .mockResolvedValueOnce({ success: true, fileData: good }); // subject-generic clears
    const out = await generateValidatedStill(
      scene,
      3,
      undefined,
      genImage,
      "sharpening kitchen knives"
    );
    expect(out.buffer.equals(good)).toBe(true);
    expect(genImage.mock.calls[2][0].prompt).toContain(
      "associated with sharpening kitchen knives"
    );
  });

  it("recovers from a content-policy block when the aggressive prompt clears", async () => {
    const good = await validPng();
    const personScene = {
      index: 1,
      humanPresent: true,
      visualPrompt:
        "A gardener sprays pesticide on a raised bed. The whole yard is visible behind.",
    } as any;
    const genImage = vi
      .fn()
      .mockResolvedValueOnce({
        success: false,
        error: "OpenAI image 400: rejected by our safety system",
      })
      .mockResolvedValueOnce({ success: true, fileData: good });
    const out = await generateValidatedStill(
      personScene,
      3,
      undefined,
      genImage
    );
    expect(genImage).toHaveBeenCalledTimes(2);
    expect(out.buffer.equals(good)).toBe(true);
    const first = genImage.mock.calls[0][0].prompt as string;
    const second = genImage.mock.calls[1][0].prompt as string;
    expect(second).not.toBe(first);
    expect(second).not.toMatch(/pesticide/i); // softened
    expect(second).not.toMatch(/anonymous/i); // person clause dropped
    expect(second).not.toMatch(/whole yard/i); // truncated to first sentence
  });

  it("throws the last error after exhausting all attempts", async () => {
    const genImage = vi
      .fn()
      .mockResolvedValue({ success: false, error: "OpenAI image 500: oops" });
    await expect(
      generateValidatedStill(scene, 3, undefined, genImage)
    ).rejects.toThrow(/oops/i);
    expect(genImage).toHaveBeenCalledTimes(3);
  });
});

describe("rewritePolicySafeVisual (tier-3 content-policy rewrite)", () => {
  // Braced body on purpose: a braceless `() => mockInvoke.mockReset()` returns the mock,
  // which vitest would invoke as a teardown.
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("returns Claude's trimmed rewrite", async () => {
    mockInvoke.mockResolvedValue({ text: "  a sunlit garden path  " } as any);
    await expect(rewritePolicySafeVisual("blocked visual")).resolves.toBe(
      "a sunlit garden path"
    );
  });

  it("returns null when the LLM call fails (never throws)", async () => {
    mockInvoke.mockRejectedValue(new Error("claude down"));
    await expect(rewritePolicySafeVisual("blocked visual")).resolves.toBeNull();
  });

  it("returns null on an empty reply", async () => {
    mockInvoke.mockResolvedValue({ text: "   " } as any);
    await expect(rewritePolicySafeVisual("blocked visual")).resolves.toBeNull();
  });

  it("adds a re-ground line naming the subject when one is given", async () => {
    mockInvoke.mockResolvedValue({ text: "a calm outdoor scene" } as any);
    await rewritePolicySafeVisual("blocked visual", "field dressing a deer");
    const sent = mockInvoke.mock.calls[0][0].userMessage as string;
    expect(sent).toContain("Keep it recognizably about: field dressing a deer");
  });

  it("omits the re-ground line when no subject is given", async () => {
    mockInvoke.mockResolvedValue({ text: "a calm outdoor scene" } as any);
    await rewritePolicySafeVisual("blocked visual");
    const sent = mockInvoke.mock.calls[0][0].userMessage as string;
    expect(sent).not.toContain("Keep it recognizably about");
  });
});

describe("deriveVideoSubject", () => {
  // Braced body: a braceless `() => mockInvoke.mockReset()` would return the mock, which
  // vitest invokes as a teardown.
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("uses the title verbatim and makes no LLM call when a title is set", async () => {
    const subject = await deriveVideoSubject(
      { ...baseParams, title: "  How to field dress a deer  " },
      "some script body"
    );
    expect(subject).toBe("How to field dress a deer");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("derives from the script via one LLM call when there is no title", async () => {
    mockInvoke.mockResolvedValue({
      text: '  "field dressing a deer"  ',
    } as any);
    const subject = await deriveVideoSubject(
      baseParams,
      "a long script all about deer"
    );
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    // Trimmed + surrounding quotes stripped.
    expect(subject).toBe("field dressing a deer");
  });

  it("returns empty string on LLM failure (never throws)", async () => {
    mockInvoke.mockRejectedValue(new Error("claude down"));
    await expect(deriveVideoSubject(baseParams, "script")).resolves.toBe("");
  });
});

describe("ensureVideoSubject (regenerate subject anchoring)", () => {
  // Braced body — see deriveVideoSubject note above.
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("lets the title win over a stale persisted videoSubject, no LLM call", async () => {
    const params = {
      ...baseParams,
      title: "How to Field Dress a Deer (Easiest Method)",
      videoSubject: "backyard vegetable garden", // stale LLM guess from an earlier run
    };
    const subject = await ensureVideoSubject(params);
    // Normalized — the parenthetical is stripped, see normalizeVideoSubject.
    expect(subject).toBe("How to Field Dress a Deer");
    expect(params.videoSubject).toBe("How to Field Dress a Deer");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("keeps an existing videoSubject when there is no title, without an LLM call", async () => {
    const params = { ...baseParams, videoSubject: "field dressing a deer" };
    const subject = await ensureVideoSubject(params);
    expect(subject).toBe("field dressing a deer");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("masterOverlayEligible (seamless master-overlay gate)", () => {
  const scene = (start: number, end: number) =>
    ({
      index: 1,
      narration: "",
      visualPrompt: "",
      hostPresent: false,
      narrationStartSec: start,
      narrationEndSec: end,
    }) as any;

  it("accepts contiguous ranges tiling from 0 with a master URL", () => {
    const scenes = [scene(0, 4.2), scene(4.2, 9.7), scene(9.7, 15)];
    expect(masterOverlayEligible(scenes, "https://r2/master.mp3")).toBe(true);
  });

  it("rejects when the master URL is missing or scenes are empty", () => {
    expect(masterOverlayEligible([scene(0, 4)], null)).toBe(false);
    expect(masterOverlayEligible([scene(0, 4)], undefined)).toBe(false);
    expect(masterOverlayEligible([], "https://r2/master.mp3")).toBe(false);
  });

  it("rejects a re-voiced scene (cleared range fields) — job falls back to per-scene concat", () => {
    const scenes = [scene(0, 4.2), scene(4.2, 9.7)];
    scenes[1].narrationStartSec = undefined;
    scenes[1].narrationEndSec = undefined;
    expect(masterOverlayEligible(scenes, "https://r2/master.mp3")).toBe(false);
  });

  it("rejects broken tiling (gap or overlap beyond 1ms) and a non-zero first start", () => {
    expect(
      masterOverlayEligible(
        [scene(0, 4.2), scene(4.5, 9)],
        "https://r2/master.mp3"
      )
    ).toBe(false);
    expect(
      masterOverlayEligible([scene(0.5, 4)], "https://r2/master.mp3")
    ).toBe(false);
  });

  it("tolerates float noise at shared boundaries", () => {
    const scenes = [scene(0, 4.2), scene(4.2000004, 9.7)];
    expect(masterOverlayEligible(scenes, "https://r2/master.mp3")).toBe(true);
  });
});

describe("lip-sync lane resolution", () => {
  const original = {
    heygen: ENV.heygenApiKey,
    runpod: ENV.runPodApiKey,
  };
  afterEach(() => {
    ENV.heygenApiKey = original.heygen;
    ENV.runPodApiKey = original.runpod;
  });

  // longform-studio carries only the HeyGen lane; the RunPod staging lane was
  // dropped in the extraction.
  it("resolves the HeyGen lane", async () => {
    ENV.heygenApiKey = "hg-key";
    const heygen = await resolveLipsyncAdapter(baseParams);
    expect(heygen?.provider).toBe("heygen");
  });

  it("returns null when the HeyGen key is unset", async () => {
    ENV.heygenApiKey = "";
    expect(await resolveLipsyncAdapter(baseParams)).toBeNull();
  });

  // The tab's own HeyGen account is what makes 5 tabs render 5× wider — HeyGen caps
  // concurrency per account, so the lane must also carry that account's OWN semaphore.
  it("prefers the tab's HeyGen key over the env key, and falls back when the slot is blank", async () => {
    ENV.heygenApiKey = "env-key";
    const stored = JSON.stringify({ last4: "-key", enc: encrypt("slot-key") });
    const spy = vi
      .spyOn(db, "getAppSetting")
      .mockImplementation(async k =>
        k === "heygen_key_slot_2" ? stored : null
      );

    const tab = await resolveLipsyncAdapter({ ...baseParams, apimartSlot: 2 });
    expect(tab!.slots).toBe(heygenSlotsFor("slot-key"));
    expect(tab!.slots).not.toBe(heygenSlotsFor("env-key"));

    // Blank slot ⇒ shared env key, and two blank tabs share that account's slots.
    const blank = await resolveLipsyncAdapter({
      ...baseParams,
      apimartSlot: 4,
    });
    expect(blank!.slots).toBe(heygenSlotsFor("env-key"));
    spy.mockRestore();
  });
});

describe("clip lane invariant: no motion flag ⇒ no video clip", () => {
  const SCRIPT = "One. Two. Three. Four.";
  const UNITS = splitIntoUnits(SCRIPT);
  const CHUNKS = UNITS.map(u => ({ start: u.start, end: u.end }));

  // openerHostScenes=0 so the cold-open lock doesn't force scene 1 to host.
  const parse = (scenes: any[]) =>
    parseStoryboard(JSON.stringify({ scenes }), CHUNKS, SCRIPT, undefined, 0);

  it("parseStoryboard forces a flagless cutaway to a still, whatever the planner asked", () => {
    const [flagless, motion, hands, both] = parse([
      { index: 1, visualPrompt: "a can on a step", hostPresent: false },
      {
        index: 2,
        visualPrompt: "water running from the can",
        hostPresent: false,
        objectMotion: true,
      },
      {
        index: 3,
        visualPrompt: "bare hands tipping the can",
        hostPresent: false,
        humanPresent: true,
      },
      {
        index: 4,
        visualPrompt: "flames working along the kindling",
        hostPresent: false,
        stillImage: true,
        objectMotion: true,
      },
    ]);
    // Nothing moves ⇒ still, even though the planner left stillImage false. A grok clip of a
    // settled frame is the expensive lane rendering what the cheap one renders better.
    expect(flagless.stillImage).toBe(true);
    // A motion flag earns the clip lane — object movement alone is enough, no person needed.
    expect(motion.stillImage).toBe(false);
    expect(hands.stillImage).toBe(false);
    // The gate only ever forces stills ON; an explicit still stays a still.
    expect(both.stillImage).toBe(true);
  });

  it("host scenes are never forced still by the gate", () => {
    const [host] = parse([
      { index: 1, visualPrompt: "host talks", hostPresent: true },
    ]);
    expect(host.hostPresent).toBe(true);
    expect(host.stillImage).toBe(false);
  });

  it("rebalanceHostScreenTime demotes host scenes to the STILL lane", () => {
    // Host slack lands mostly in Q3/Q4 (HOST_RAMP), so dumping it on the clip lane would ramp
    // the expensive side UP across the film — the inverse of MOTION_RAMP.
    const scenes: StoryboardScene[] = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      narration: `s${i}`,
      visualPrompt: i % 2 === 0 ? "host talks" : "b-roll",
      hostPresent: i % 2 === 0,
      audioDuration: 10,
      ...(i % 2 === 0 ? { brollVisual: `cutaway ${i}` } : { stillImage: true }),
    }));
    const r = rebalanceHostScreenTime(scenes);
    expect(r.demoted).toBeGreaterThan(0);
    const demoted = scenes.filter(s => s.visualPrompt.startsWith("cutaway"));
    expect(demoted.length).toBe(r.demoted);
    for (const s of demoted) {
      expect(s.hostPresent).toBe(false);
      expect(s.stillImage).toBe(true);
      expect(s.shotAngle).toBeTruthy();
    }
  });

  it("enforceStillMotionRatio only demotes stills that can actually move", () => {
    const cut = (i: number, extra: Partial<StoryboardScene> = {}) =>
      ({
        index: i,
        narration: `s${i}`,
        visualPrompt: "b-roll",
        hostPresent: false,
        stillImage: true,
        audioDuration: 10,
        ...extra,
      }) as StoryboardScene;

    // All flagless: nothing is eligible for the clip lane, so the quarter undershoots
    // MOTION_RAMP rather than manufacturing frozen clips. That undershoot is the point.
    const flagless = Array.from({ length: 6 }, (_, i) => cut(i));
    const a = enforceStillMotionRatio(flagless);
    expect(a.motionSeconds).toBe(0);
    expect(a.motionPerQuarter.every(s => s === 0)).toBe(true);
    expect(flagless.every(s => s.stillImage)).toBe(true);

    // Same fixture with half the beats flagged: only the flagged ones may be demoted.
    const mixed = Array.from({ length: 6 }, (_, i) =>
      cut(i, i % 2 === 0 ? { objectMotion: true } : {})
    );
    const b = enforceStillMotionRatio(mixed);
    expect(b.motionSeconds).toBeGreaterThan(0);
    for (const s of mixed) {
      if (!s.stillImage) expect(s.objectMotion).toBe(true);
    }

    // The promote branch (motion → still) stays unrestricted: tightening toward the cheap,
    // safe lane is always allowed, flags or not.
    const motionHeavy = Array.from({ length: 6 }, (_, i) =>
      cut(i, { stillImage: false })
    );
    const c = enforceStillMotionRatio(motionHeavy);
    expect(c.stillSeconds).toBeCloseTo(30);
  });

  it("survives the full balancer pipeline — every clip has a motion flag", () => {
    // Real call order from the job runner. 200 × 4s ≈ a 13-min job, flat storyboard with a
    // realistic sprinkling of moving beats.
    const scenes = Array.from({ length: 200 }, (_, i) => ({
      index: i,
      narration: `s${i}`,
      visualPrompt: i % 3 === 0 ? "host talks" : "b-roll",
      hostPresent: i % 3 === 0,
      ...(i % 3 === 0
        ? { brollVisual: `cutaway ${i}` }
        : { stillImage: true, objectMotion: i % 5 === 0 }),
      audioDuration: 4,
    })) as StoryboardScene[];

    rebalanceHostScreenTime(scenes);
    enforceHostSplitMix(scenes);
    enforceStillMotionRatio(scenes);
    enforceVisualAdjacency(scenes, { hasAltHost: false });

    for (const s of scenes) {
      expect(
        !!s.hostPresent ||
          !!s.stillImage ||
          !!s.humanPresent ||
          !!s.objectMotion
      ).toBe(true);
    }
    // …and the pipeline still actually used the clip lane on the flagged beats.
    expect(scenes.some(s => !s.hostPresent && !s.stillImage)).toBe(true);
  });
});
