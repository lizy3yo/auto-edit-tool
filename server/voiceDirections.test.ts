import { describe, it, expect, vi } from "vitest";
import {
  attachLoneDirections,
  directionsBlockedBy,
  modelTakesDirections,
  stripVoiceDirections,
  voiceDirectionsIn,
  voiceSpaceByShape,
} from "../shared/voiceDirections";
import {
  directedSpokenScript,
  extractSpokenScript,
  stripCtaMarkerLines,
  scanCtaBlocks,
} from "../shared/ctaMarkers";
import { countScriptWords } from "../shared/heygenTest";
import { parseCtaMarkers, voiceTextFor } from "./longformVideo";
import { scriptParagraphs, deliveryRuns } from "./delivery";

// Dale's 3-minute practice script, cut down, with the directions from the 2026-10-02 v4 test.
const DIRECTED = `You finished a walnut and maple cutting board a few weeks back. [sighs] It's still leaning against the wall in your garage. [warmly] Today I'm ranking Etsy, craft fairs, and Facebook Marketplace. [chuckles]

I'm Dale Oakfield, and this is my workshop.

===START CTA(The Ultimate DIY Woodworking Guide)===
Let me set the list down for a minute. A fair pile of my own spoiled boards, [chuckles] and I gathered it into a digital book.
===END CTA===

[short pause]

Number three, the one I promised you. Now somewhere around $25 is gone on one board [excited].`;

const PLAIN = `You finished a walnut and maple cutting board a few weeks back. It's still leaning against the wall in your garage. Today I'm ranking Etsy, craft fairs, and Facebook Marketplace.

I'm Dale Oakfield, and this is my workshop.

===START CTA(The Ultimate DIY Woodworking Guide)===
Let me set the list down for a minute. A fair pile of my own spoiled boards, and I gathered it into a digital book.
===END CTA===

Number three, the one I promised you. Now somewhere around $25 is gone on one board.`;

describe("voice directions never reach anything but the voice", () => {
  it("removes directions and tidies the spacing they leave", () => {
    expect(stripVoiceDirections("back. [sighs] It's")).toBe("back. It's");
    expect(stripVoiceDirections("boards, [chuckles] and")).toBe("boards, and");
    expect(stripVoiceDirections("[knowingly] Here's")).toBe("Here's");
    expect(stripVoiceDirections("a single sale. [chuckles]")).toBe("a single sale.");
    expect(stripVoiceDirections("one board [excited].")).toBe("one board.");
  });

  it("a line or paragraph of only directions never splits or adds a paragraph", () => {
    expect(stripVoiceDirections("A\n[laughs]\nB")).toBe("A\nB");
    expect(stripVoiceDirections("A\n\n[laughs]\n\nB")).toBe("A\n\nB");
  });

  it("the script the whole app reads is the script without directions", () => {
    const withDirections = parseCtaMarkers(extractSpokenScript(DIRECTED));
    const without = parseCtaMarkers(extractSpokenScript(PLAIN));
    expect(withDirections.script).toBe(without.script);
    // CTA word offsets count the same words, so the block lands on the same lines.
    expect(withDirections.spans).toEqual(without.spans);
    expect(withDirections.script).not.toContain("[");
  });

  it("the browser's copy agrees with the server's (manual narration, word estimate)", () => {
    const spoken = extractSpokenScript(DIRECTED);
    expect(stripCtaMarkerLines(spoken)).toBe(parseCtaMarkers(spoken).script);
    expect(scanCtaBlocks(DIRECTED).blocks[0].text).not.toContain("[");
  });

  it("a script without directions is untouched everywhere", () => {
    expect(stripVoiceDirections(PLAIN)).toBe(PLAIN);
    expect(parseCtaMarkers(extractSpokenScript(PLAIN)).script).toBe(
      stripCtaMarkerLines(extractSpokenScript(PLAIN))
    );
    expect(directedSpokenScript(PLAIN)).toBe(
      parseCtaMarkers(extractSpokenScript(PLAIN)).script
    );
  });

  it("the voice's copy splits into the same paragraphs, so the delivery plan lines up", () => {
    const clean = parseCtaMarkers(extractSpokenScript(DIRECTED)).script;
    const directed = directedSpokenScript(DIRECTED);
    expect(directed).not.toContain("===");
    expect(voiceDirectionsIn(directed)).toHaveLength(6);
    expect(scriptParagraphs(stripVoiceDirections(directed))).toEqual(
      scriptParagraphs(clean)
    );
    // The lone "[short pause]" rides on the paragraph after it.
    expect(scriptParagraphs(directed)[3]).toMatch(/^\[short pause\] Number three/);
    const plan = {
      paragraphs: scriptParagraphs(clean).map((_, i) => ({
        index: i + 1,
        pace: (i % 2 ? "slow" : "natural") as "slow" | "natural",
        pauseAfterMs: 0,
        mood: "",
        gesture: "",
      })),
    };
    expect(
      deliveryRuns(directed, plan).map(r => stripVoiceDirections(r.text))
    ).toEqual(deliveryRuns(clean, plan).map(r => r.text));
  });

  it("a direction alone at the very end joins the last paragraph", () => {
    expect(attachLoneDirections("A\n\nB\n\n[laughs]")).toBe("A\n\nB [laughs]");
  });

  it("the HeyGen test's 30 s word budget does not count directions", () => {
    expect(countScriptWords("Eight dollars. [laughs] Eight.")).toBe(3);
  });
});

describe("only a voice that acts directions out is handed them", () => {
  it("knows which models act them out", () => {
    expect(modelTakesDirections("eleven_v4")).toBe(true);
    expect(modelTakesDirections("eleven_v4_turbo")).toBe(true);
    expect(modelTakesDirections("eleven_v3")).toBe(true);
    expect(modelTakesDirections("eleven_multilingual_v2")).toBe(false);
    expect(modelTakesDirections("eleven_turbo_v2_5")).toBe(false);
    expect(modelTakesDirections(undefined)).toBe(false);
  });

  it("names why a voice would read them aloud", () => {
    const ok = { vendor: "69labs" as const, model: "eleven_v4", voiceSpace: "library" as const };
    expect(directionsBlockedBy(ok)).toBeNull();
    expect(directionsBlockedBy({ ...ok, model: "eleven_multilingual_v2" })).toMatch(/eleven_v4/);
    expect(directionsBlockedBy({ ...ok, voiceSpace: "clone" })).toMatch(/clone/);
    expect(directionsBlockedBy({ ...ok, vendor: "minimax" })).toMatch(/MiniMax/);
    expect(voiceSpaceByShape("2cb5d8a7-6e8d-4213-b613-8e1f395905df")).toBe("clone");
    expect(voiceSpaceByShape("v3p1kjzUvro6S76qmYmH")).toBe("library");
  });

  it("hands the directed copy to an ElevenLabs voice on v4, the clean copy to anything else", async () => {
    const clean = parseCtaMarkers(extractSpokenScript(DIRECTED)).script;
    const directed = directedSpokenScript(DIRECTED);
    const originalFetch = globalThis.fetch;
    // The account's clone list holds Hank's id only.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ voiceClones: [{ id: "13fd1586-60d9-42de-b649-066f9bb114f3" }] }),
          { status: 200 }
        )
    ) as any;
    try {
      const base = { clean, directed, providerType: "sixtynine_labs", apiKey: "k-directions" };
      const dale = await voiceTextFor({ ...base, voiceId: "v3p1kjzUvro6S76qmYmH", model: "eleven_v4" });
      expect(dale).toEqual({ text: directed, directions: 6, blockedBy: null });

      const oldModel = await voiceTextFor({ ...base, voiceId: "v3p1kjzUvro6S76qmYmH", model: "eleven_multilingual_v2" });
      expect(oldModel.text).toBe(clean);
      expect(oldModel.blockedBy).toMatch(/eleven_v4/);

      const hank = await voiceTextFor({ ...base, voiceId: "13fd1586-60d9-42de-b649-066f9bb114f3", model: "eleven_v4" });
      expect(hank.text).toBe(clean);
      expect(hank.blockedBy).toMatch(/clone/);

      const minimax = await voiceTextFor({ ...base, providerType: "minimax", voiceId: "x", model: "eleven_v4" });
      expect(minimax.text).toBe(clean);

      const none = await voiceTextFor({ ...base, directed: clean, voiceId: "v3p1kjzUvro6S76qmYmH", model: "eleven_v4" });
      expect(none).toEqual({ text: clean, directions: 0, blockedBy: null });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
