import { describe, it, expect, vi } from "vitest";

// Raise the TTS submit bucket before the module (which reads env at load) is imported,
// so pacing never slows these tests down.
process.env.SIXTYNINE_TTS_SUBMIT_RATE = "60000";
process.env.SIXTYNINE_TTS_SUBMIT_BURST = "1000";

const VOICE_400_BODY = JSON.stringify({
  error:
    "This voice ID was not found. Please select a voice from the voice library or use a valid public voice ID.",
  code: "BAD_REQUEST",
});

describe("69Labs TTS voice-not-found handling", () => {
  it("throws VoiceNotFoundError (not a generic error) on the 400", async () => {
    const { createTTSTask69Labs, VoiceNotFoundError } =
      await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response(VOICE_400_BODY, { status: 400 })
    ) as any;

    try {
      const err = await createTTSTask69Labs("vk_test_key", {
        text: "Hello",
        voiceId: "bad_clone_voice_1",
      }).catch(e => e);
      expect(err).toBeInstanceOf(VoiceNotFoundError);
      expect(err.message).toContain("bad_clone_voice_1");
      expect(err.message).toContain("Admin → Channels");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails instantly from cache on repeat submits — no second API call", async () => {
    const { createTTSTask69Labs, VoiceNotFoundError } =
      await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(
      async () => new Response(VOICE_400_BODY, { status: 400 })
    );
    globalThis.fetch = fetchMock as any;

    try {
      await expect(
        createTTSTask69Labs("vk_test_key", {
          text: "scene 1",
          voiceId: "bad_clone_voice_2",
        })
      ).rejects.toBeInstanceOf(VoiceNotFoundError);
      // The 160 sibling scenes of a batch must not each burn an API call on the same voice.
      await expect(
        createTTSTask69Labs("vk_test_key", {
          text: "scene 2",
          voiceId: "bad_clone_voice_2",
        })
      ).rejects.toBeInstanceOf(VoiceNotFoundError);
      // First submit costs exactly two calls (POST /tts/generate + the GET /voice-clones
      // probe that checks for an account voice clone); the second is served from cache.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("a different voice on the same key is unaffected by the cache", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url: any, opts: any) => {
      const body = JSON.parse(opts?.body || "{}");
      if (body.voiceId === "bad_clone_voice_3")
        return new Response(VOICE_400_BODY, { status: 400 });
      return new Response(JSON.stringify({ id: "ok-1" }), { status: 200 });
    }) as any;

    try {
      await expect(
        createTTSTask69Labs("vk_test_key", {
          text: "x",
          voiceId: "bad_clone_voice_3",
        })
      ).rejects.toThrow("not found");
      await expect(
        createTTSTask69Labs("vk_test_key", {
          text: "x",
          voiceId: "good_voice_1",
        })
      ).resolves.toBe("ok-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reroutes an account voice clone to /voice-clones/generate", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");

    const CLONE_ID = "726112ec-3f4a-450b-8a05-53d4f116d873";
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = vi.fn(async (url: any, opts: any) => {
      const u = String(url);
      calls.push({ url: u, body: opts?.body ? JSON.parse(opts.body) : null });
      if (u.endsWith("/tts/generate"))
        return new Response(VOICE_400_BODY, { status: 400 });
      if (u.endsWith("/voice-clones"))
        return new Response(
          JSON.stringify({
            voiceClones: [{ id: CLONE_ID, name: "Hank", status: "ready" }],
          }),
          { status: 200 }
        );
      if (u.endsWith("/voice-clones/generate"))
        return new Response(JSON.stringify({ id: "clone-task-1" }), {
          status: 200,
        });
      return new Response("unexpected", { status: 500 });
    }) as any;

    try {
      const taskId = await createTTSTask69Labs("vk_clone_key", {
        text: "Hello from Hank.",
        voiceId: CLONE_ID,
        speed: 1.1,
      });
      expect(taskId).toBe("clone-task-1");

      const cloneCall = calls.find(c =>
        c.url.endsWith("/voice-clones/generate")
      );
      expect(cloneCall?.body).toMatchObject({
        voiceCloneId: CLONE_ID,
        text: "Hello from Hank.",
        model: "speech-02-hd",
        speed: 1.1,
      });
      expect(cloneCall?.body.voiceId).toBeUndefined();

      // Route is remembered: the next call for this voice skips /tts/generate entirely.
      calls.length = 0;
      const again = await createTTSTask69Labs("vk_clone_key", {
        text: "Second line.",
        voiceId: CLONE_ID,
      });
      expect(again).toBe("clone-task-1");
      expect(calls.map(c => c.url.split("/api/v1/")[1])).toEqual([
        "voice-clones/generate",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries a 429 after the cooldown instead of failing the scene", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");

    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            error: "Too many requests",
            code: "TOO_MANY_REQUESTS",
          }),
          { status: 429, headers: { "Retry-After": "0" } }
        );
      }
      return new Response(JSON.stringify({ id: "after-429" }), { status: 200 });
    }) as any;

    try {
      // Retry-After 0 is clamped to a 1s cooldown; the create resolves on attempt 2.
      const taskId = await createTTSTask69Labs("vk_429_key", {
        text: "x",
        voiceId: "good_voice_2",
      });
      expect(taskId).toBe("after-429");
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 10_000);
});

describe("69Labs voice spaces", () => {
  it("tells an account clone from a library voice by its id", async () => {
    const { voiceSpaceByShape } = await import("./tts69labs");
    expect(voiceSpaceByShape("2cb5d8a7-6e8d-4213-b613-8e1f395905df")).toBe("clone");
    expect(voiceSpaceByShape("pqHfZKP75CvOlQylNhV4")).toBe("library");
  });

  it("asks the account's clone list first, and falls back to the id when it is down", async () => {
    const { voiceSpace69Labs } = await import("./tts69labs");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as any;
    try {
      expect(await voiceSpace69Labs("k-space-1", "pqHfZKP75CvOlQylNhV4")).toBe("library");
      expect(await voiceSpace69Labs("k-space-1", "13fd1586-60d9-42de-b649-066f9bb114f3")).toBe("clone");
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ voiceClones: [{ id: "abcClone" }] }), { status: 200 })
      ) as any;
      expect(await voiceSpace69Labs("k-space-2", "abcClone")).toBe("clone");
      expect(await voiceSpace69Labs("k-space-2", "13fd1586-60d9-42de-b649-066f9bb114f3")).toBe("library");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("a cloned voice goes straight to the clone lane (2026-10-02)", () => {
  const CLONE = "726112ec-3f4a-450b-8a05-53d4f116d873";
  const lookupDown = () =>
    new Response(JSON.stringify({ error: "Service temporarily unavailable. Try again shortly.", code: "VOICE_LOOKUP_FAILED" }), { status: 503 });
  const cloneList = () => new Response(JSON.stringify({ voiceClones: [{ id: CLONE, name: "Hank" }] }), { status: 200 });
  const accepted = () => new Response(JSON.stringify({ id: "task-1", status: "PENDING" }), { status: 201 });

  it("never asks /tts/generate for a voice the clone list holds", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      if (String(url).endsWith("/voice-clones")) return cloneList();
      if (String(url).endsWith("/voice-clones/generate")) return accepted();
      return lookupDown();
    }) as any;
    try {
      expect(await createTTSTask69Labs("k-clone-1", { text: "hi", voiceId: CLONE })).toBe("task-1");
      expect(urls.some(u => u.endsWith("/tts/generate"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("switches lanes on VOICE_LOOKUP_FAILED when the clone list was unavailable up front", async () => {
    const { createTTSTask69Labs } = await import("./tts69labs");
    const originalFetch = globalThis.fetch;
    let listCalls = 0;
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.endsWith("/voice-clones")) return ++listCalls === 1 ? new Response("down", { status: 503 }) : cloneList();
      if (u.endsWith("/voice-clones/generate")) return accepted();
      return lookupDown();
    }) as any;
    try {
      expect(await createTTSTask69Labs("k-clone-2", { text: "hi", voiceId: CLONE })).toBe("task-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
