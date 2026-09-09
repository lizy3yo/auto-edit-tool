import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import {
  LongformNarrationUpload,
  type DeliveryPlan,
} from "@/components/LongformNarrationUpload";

/**
 * Harness for "I'll supply the narration" (the manual-VO hatch on the generate form).
 *
 * Both round trips are stubbed — the raw `POST /api/narration-upload` and the
 * `verifyNarration` tRPC mutation — so every branch the operator can land in is reachable
 * without a database, an R2 bucket or a whisperx call: accepted, rejected with a heard-vs-
 * expected diff, and accepted-but-unverified when transcription itself is down. The verdict
 * is picked from the radio buttons below, since the interesting states are exactly the ones
 * a real upload cannot be made to produce on demand.
 *
 *   pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
 *   http://localhost:5199/__harness/narration-upload.html
 */
type Mode = "ok" | "mismatch" | "unverified" | "tooShort";
const state = {
  mode: "ok" as Mode,
  // The three MiniMax availability states an operator can land in, each of which must name a
  // DIFFERENT Admin screen.
  mmStatus: { keySet: true, voiceSet: true, voiceName: "Roger (MiniMax)" },
};

const VERDICTS: Record<Mode, Record<string, unknown>> = {
  ok: {
    ok: true,
    coverage: 0.96,
    durationSec: 1180,
    expectedSec: 1163,
    words: 3021,
  },
  mismatch: {
    ok: false,
    coverage: 0.42,
    durationSec: 1180,
    expectedSec: 1163,
    words: 3021,
    reason:
      "Only 42% of the script was heard in that recording (needs 85%). It reads as a " +
      "different script, an older draft, or a partial file.",
    expected: "that's the entire material cost on the best selling thing i've",
    heard: "today we are going to talk about repotting tomatoes in the middle",
  },
  unverified: {
    ok: false,
    unverified: true,
    coverage: 0,
    durationSec: 1180,
    expectedSec: 1163,
    words: 3021,
    reason:
      "Could not transcribe the upload to check it (whisperx endpoint unreachable).",
  },
  tooShort: {
    ok: false,
    coverage: 0,
    durationSec: 41,
    expectedSec: 1163,
    words: 3021,
    reason:
      "That file is 0:41 long but this script should read about 19:23. It looks like the " +
      "wrong file, or a partial export.",
  },
};

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input.url);

  if (url.includes("/api/narration-upload")) {
    // The real route streams the file, normalizes it and returns its R2 URL. Nothing about the
    // upload itself is what this harness is for, so it always succeeds.
    await new Promise(r => setTimeout(r, 600));
    return new Response(
      JSON.stringify({
        url: "https://pub-example.r2.dev/longform/manual-narration/abc123.mp3",
        durationSec: VERDICTS[state.mode].durationSec,
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (!url.includes("/api/trpc/")) return realFetch(input, init);

  const path = url.split("/api/trpc/")[1].split("?")[0];
  if (path.includes("minimaxStatus")) {
    return new Response(
      JSON.stringify([
        {
          result: {
            data: {
              json: { ...state.mmStatus, connectionStatus: "connected" },
            },
          },
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (path.includes("planDelivery")) {
    await new Promise(r => setTimeout(r, 700));
    return new Response(
      JSON.stringify([
        {
          result: {
            data: {
              json: {
                plan: {
                  paragraphs: [
                    {
                      index: 0,
                      pace: "measured",
                      pauseAfterMs: 300,
                      mood: "warm, matter-of-fact",
                      gesture: "small nod on the number",
                    },
                    {
                      index: 1,
                      pace: "brisk",
                      pauseAfterMs: 0,
                      mood: "wry, a little conspiratorial",
                      gesture: "leans in slightly",
                    },
                    {
                      index: 2,
                      pace: "slow",
                      pauseAfterMs: 600,
                      mood: "level, letting it land",
                      gesture: "holds still",
                    },
                  ],
                },
                paragraphs: ["a", "b", "c"],
              },
            },
          },
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }
  if (!path.includes("verifyNarration")) {
    return new Response(JSON.stringify([{ result: { data: { json: {} } } }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  // Long enough to see the "Checking the read against the script…" state, which is the one
  // piece of this flow an operator waits on.
  await new Promise(r => setTimeout(r, 900));
  return new Response(
    JSON.stringify([{ result: { data: { json: VERDICTS[state.mode] } } }]),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}) as typeof window.fetch;

const SCRIPT =
  "$8 of cedar. That's the entire material cost on the best-selling thing I've ever set " +
  "on a table, and it's a bird feeder.\n\n" +
  "Most people building one of these start at the roof, which is exactly backwards. The " +
  "roof is the part everybody sees, so it's the part everybody fusses over, and it is the " +
  "single least important surface on the whole build.\n\n" +
  "===START CTA===\nGrab the plans in my book, The Backyard Feeder.\n===END CTA===";

function Harness() {
  const [mode, setMode] = useState<Mode>("ok");
  const [script, setScript] = useState(SCRIPT);
  const [value, setValue] = useState<string | undefined>(undefined);
  const [plan, setPlan] = useState<DeliveryPlan | undefined>(undefined);
  const [compact, setCompact] = useState(false);
  const [vendor, setVendor] = useState<
    "sixtynine_labs" | "minimax" | undefined
  >(undefined);
  const [mm, setMm] = useState<"both" | "noKey" | "noVoice">("both");
  state.mmStatus = {
    keySet: mm !== "noKey",
    voiceSet: mm === "both",
    voiceName: "Roger (MiniMax)",
  };
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    })
  );
  state.mode = mode;

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <div className="space-y-6">
          <div className="space-y-2 rounded-md border border-dashed p-3 text-xs">
            <p className="font-medium">
              Harness — verdict the stubbed server returns
            </p>
            <div className="flex flex-wrap gap-3">
              {(["ok", "mismatch", "unverified", "tooShort"] as Mode[]).map(
                m => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    {m}
                  </label>
                )
              )}
            </div>
            <p className="text-muted-foreground">
              Accepted URL: <code>{value ?? "(none)"}</code> · vendor:{" "}
              <code>{vendor ?? "(default)"}</code>
            </p>
            <div className="flex flex-wrap gap-3">
              {(["both", "noKey", "noVoice"] as const).map(m => (
                <label key={m} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="mm"
                    checked={mm === m}
                    onChange={() => setMm(m)}
                  />
                  minimax: {m}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                className="rounded border px-2 py-1"
                onClick={() => setScript(s => s + " One more sentence.")}
              >
                Edit the script (should drop an accepted upload)
              </button>
              <button
                className="rounded border px-2 py-1"
                onClick={() => setCompact(c => !c)}
              >
                {compact ? "Form mode" : "Rescue mode (compact)"}
              </button>
            </div>
          </div>

          <LongformNarrationUpload
            key={compact ? "compact" : "full"}
            compact={compact}
            script={script}
            // The MiniMax availability query is keyed on channelKey, so varying it per mode is
            // what forces a refetch when the stubbed status changes. A real app changes the
            // channel to change the answer; this mirrors that.
            channelKey={`roger_the_pipe_guy_${mm}`}
            value={value}
            onChange={setValue}
            deliveryPlan={plan}
            onDeliveryPlanChange={setPlan}
            vendor={vendor}
            onVendorChange={setVendor}
            voice={{
              voiceName: "Roger (clone)",
              voiceId: "abc123",
              ttsModel: "eleven_multilingual_v2",
              ttsSpeed: "0.95",
            }}
          />
        </div>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
