import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import { HeygenTest } from "@/components/HeygenTest";

/**
 * Harness for the HeyGen test page, against stubbed `channelConfig.list`, `channelHostPhoto.list`,
 * `styleReference.upload` and the `heygenTest` router, backed by in-page state. Generate adds a
 * batch that walks voicing → rendering → done on successive polls, so the live grid, the polling
 * stop and delete can all be exercised without a database or a HeyGen credit.
 *
 *   pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
 *   http://localhost:5199/__harness/heygen-test.html
 */
const swatch = (hue: number, label: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">` +
      `<rect width="160" height="160" fill="hsl(${hue} 40% 45%)"/>` +
      `<circle cx="80" cy="62" r="28" fill="hsl(${hue} 30% 80%)"/>` +
      `<rect x="40" y="98" width="80" height="62" rx="20" fill="hsl(${hue} 30% 80%)"/>` +
      `<text x="80" y="150" font-size="18" text-anchor="middle" fill="#111" font-family="sans-serif">${label}</text>` +
      `</svg>`
  );

type Row = {
  id: number;
  batchId: string;
  userId: number;
  userName: string | null;
  userRole: "admin" | "manager" | "editor" | null;
  channelKey: string;
  ttsVendor: string;
  heygenSlot: number | null;
  imageUrl: string;
  script: string;
  runName: string | null;
  audioUrl: string | null;
  audioMs: number | null;
  videoId: string | null;
  videoUrl: string | null;
  status: "voicing" | "rendering" | "done" | "failed";
  error: string | null;
  createdAt: string;
  updatedAt: string;
  phaseStartedAt: string | null;
  costUsd: number;
};

const RATE = 0.06;
let nextId = 3;
const base = (over: Partial<Row>): Row => ({
  id: 0,
  batchId: "b0",
  userId: 1,
  userName: "Admin",
  userRole: "admin",
  channelKey: "granny-mae",
  ttsVendor: "sixtynine_labs",
  heygenSlot: 0,
  imageUrl: swatch(30, "A"),
  script: "Before you buy another deadbolt, check the strike plate screws.",
  runName: null,
  audioUrl: "/__harness/media/voice.mp3",
  audioMs: 12_000,
  videoId: "v",
  videoUrl: "/__harness/media/clip.mp4",
  status: "done",
  error: null,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
  updatedAt: new Date().toISOString(),
  phaseStartedAt: null,
  costUsd: 12 * RATE,
  ...over,
});
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
const state = {
  rows: [
    // A run in flight: one clip in each stage, part-way through, plus one that failed.
    ...(
      [
        [11, 200, "voicing", null, 12],
        [12, 260, "rendering", null, 60],
        [13, 320, "rendering", "v13", 120],
        [14, 40, "failed", null, 0],
      ] as const
    ).map(([id, hue, status, videoId, sec]) =>
      base({
        id,
        batchId: "live",
        imageUrl: swatch(hue, String(id)),
        status,
        videoId,
        videoUrl: null,
        audioUrl: status === "voicing" ? null : "/__harness/media/voice.mp3",
        audioMs: status === "voicing" ? null : 30_000,
        costUsd: videoId ? 30 * RATE : 0,
        error:
          status === "failed"
            ? "HeyGen API error (409): This avatar is still processing. (resource_not_ready)"
            : null,
        phaseStartedAt: ago(sec),
        createdAt: ago(200),
      })
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      base({
        id: -100 - i,
        batchId: `old${i}`,
        imageUrl: swatch(i * 29, `H${i}`),
        runName: i % 2 ? `Porch test ${i}` : null,
        channelKey: i % 3 ? "granny-mae" : "norbert",
        userId: i % 2 ? 1 : 2,
        userName: i % 2 ? "Admin" : "Masree",
        userRole: i % 2 ? "admin" : "manager",
        script: `Older run ${i}: the strike plate is the weak spot.`,
        createdAt: ago(86_400 + i * 3_600),
      })
    ),
    base({ id: 1, imageUrl: swatch(30, "A") }),
    base({
      id: 2,
      imageUrl: swatch(120, "B"),
      status: "failed",
      videoUrl: null,
      videoId: null,
      costUsd: 0,
      error: "HeyGen avatar registration failed (400): no face detected",
    }),
    base({
      id: 3,
      imageUrl: swatch(170, "C"),
      status: "failed",
      videoUrl: null,
      videoId: null,
      costUsd: 0,
      error: "HeyGen API error (409): This avatar is still processing.",
    }),
  ] as Row[],
};

/**
 * Each poll moves a NEWLY GENERATED batch one stage on, as the real one would over minutes
 * (stamping `phaseStartedAt` like the server). The seeded "live" batch stays put so each stage
 * of the progress bar can be looked at.
 */
function advance() {
  for (const r of state.rows) {
    if (r.batchId === "live") continue;
    r.phaseStartedAt = new Date().toISOString();
    if (r.status === "voicing") {
      r.status = "rendering";
      r.audioUrl = "/__harness/media/voice.mp3";
      r.audioMs = 9_000;
      r.videoId = `v${r.id}`;
      r.costUsd = 9 * RATE;
    } else if (r.status === "rendering") {
      r.status = "done";
      r.videoUrl = "/__harness/media/clip.mp4";
    }
  }
}

function handle(path: string, input: any): unknown {
  if (path === "channelConfig.list")
    return [
      {
        channelKey: "granny-mae",
        displayName: "Granny Mae",
        voiceId: "v-69",
        minimaxVoiceId: "v-mm",
      },
      {
        channelKey: "norbert",
        displayName: "Norbert Daniels",
        voiceId: "v-69b",
        minimaxVoiceId: null,
      },
    ];
  if (path === "channelHostPhoto.list")
    return [
      { id: 11, imageUrl: swatch(30, "A") },
      { id: 12, imageUrl: swatch(210, "C") },
      { id: 13, imageUrl: swatch(300, "D") },
    ];
  if (path === "styleReference.upload")
    return { url: swatch(Math.floor(Math.random() * 360), "Up") };
  if (path === "heygenTest.accounts") return availability();
  if (path === "heygenTest.list") {
    // Same contract as the server: filter by run, page by run (5), newest run first.
    const q = (input?.search ?? "").toLowerCase();
    const byBatch = new Map<string, Row[]>();
    for (const r of state.rows) {
      if (q && !`${r.runName ?? ""} ${r.script}`.toLowerCase().includes(q))
        continue;
      if (input?.channelKey && r.channelKey !== input.channelKey) continue;
      if (input?.userId != null && r.userId !== input.userId) continue;
      byBatch.set(r.batchId, [...(byBatch.get(r.batchId) ?? []), r]);
    }
    const runs = Array.from(byBatch.values());
    const newest = (list: Row[]) => Date.parse(list[0].createdAt);
    runs.sort((a, b) => newest(b) - newest(a));
    const page = input?.page ?? 1;
    const out = JSON.parse(
      JSON.stringify(runs.slice((page - 1) * 5, page * 5).flat())
    );
    advance();
    return {
      rows: out,
      totalRuns: runs.length,
      page,
      pageCount: Math.max(1, Math.ceil(runs.length / 5)),
    };
  }
  if (path === "heygenTest.channels")
    return Array.from(new Set(state.rows.map(r => r.channelKey)));
  if (path === "heygenTest.runners")
    return [
      { id: 1, name: "Admin" },
      { id: 2, name: "Masree" },
    ];
  if (path === "heygenTest.rename") {
    for (const r of state.rows)
      if (r.batchId === input.batchId) r.runName = input.name.trim() || null;
    return { ok: true };
  }
  if (path === "heygenTest.start") {
    const batchId = `b${nextId}`;
    const created = new Date().toISOString();
    for (const imageUrl of input.imageUrls)
      state.rows.unshift(
        base({
          id: nextId++,
          batchId,
          imageUrl,
          script: input.script,
          runName: input.name ?? null,
          channelKey: input.channelKey,
          ttsVendor: input.ttsVendor,
          status: "voicing",
          audioUrl: null,
          audioMs: null,
          videoId: null,
          videoUrl: null,
          costUsd: 0,
          createdAt: created,
        })
      );
    return { batchId };
  }
  if (path === "heygenTest.retry") {
    const targets = state.rows.filter(
      r =>
        r.batchId === input.batchId &&
        r.status === "failed" &&
        (!input.ids || input.ids.includes(r.id))
    );
    for (const r of targets) {
      r.status = "rendering";
      r.error = null;
      r.videoId = null;
      r.phaseStartedAt = new Date().toISOString();
    }
    return { retried: targets.length };
  }
  if (path === "heygenTest.deleteBatch") {
    state.rows = state.rows.filter(r => r.batchId !== input.batchId);
    return { ok: true };
  }
  throw new Error(`unstubbed ${path}`);
}

/** Accounts with a key, and which of them a film is "rendering" on (toggled below). */
const ACCOUNTS = [
  { account: 0, label: "Tab 1 account" },
  { account: 1, label: "Tab 2 account" },
  { account: 4, label: "Tab 5 account" },
] as const;
const busy = new Set<number | string>([1]);
const availability = () => ({
  available: ACCOUNTS.filter(a => !busy.has(a.account)),
  configured: ACCOUNTS.length,
  ratePerSec: RATE,
});

/**
 * Stand-in for the server's live stream: the toggles below push into it exactly as a film
 * starting or finishing would, so the picker's real-time update can be watched.
 */
const streams = new Set<FakeEventSource>();
class FakeEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: ((e: MessageEvent) => void)[] = [];
  constructor(_url: string) {
    streams.add(this);
    setTimeout(() => {
      this.onopen?.();
      this.push();
    }, 50);
  }
  addEventListener(_type: string, fn: (e: MessageEvent) => void) {
    this.listeners.push(fn);
  }
  push() {
    const e = new MessageEvent("accounts", {
      data: JSON.stringify(availability()),
    });
    this.listeners.forEach(fn => fn(e));
  }
  close() {
    streams.delete(this);
  }
}
(window as any).EventSource = FakeEventSource;
const pushAll = () => streams.forEach(s => s.push());

const realFetch = window.fetch.bind(window);
window.fetch = (async (req: any, init?: RequestInit) => {
  const url = String(typeof req === "string" ? req : req.url);
  if (!url.includes("/api/trpc/")) return realFetch(req, init);
  const paths = url.split("/api/trpc/")[1].split("?")[0].split(",");
  // Mutations carry their input in the body; queries (GET) in the URL's `input` param.
  const urlInput = new URL(url, location.href).searchParams.get("input");
  const body = init?.body
    ? JSON.parse(String(init.body))
    : urlInput
      ? JSON.parse(urlInput)
      : null;
  const results = paths.map((p, i) => {
    const input = body?.[String(i)]?.json;
    return { result: { data: { json: handle(p, input) } } };
  });
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof window.fetch;

function FilmToggles() {
  const [, force] = useState(0);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      Harness — a film is rendering on:
      {ACCOUNTS.map(a => (
        <label key={String(a.account)} className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={busy.has(a.account)}
            onChange={e => {
              if (e.target.checked) busy.add(a.account);
              else busy.delete(a.account);
              force(n => n + 1);
              pushAll();
            }}
          />
          {a.label}
        </label>
      ))}
    </div>
  );
}

function Harness() {
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    })
  );
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <FilmToggles />
        <HeygenTest />
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
