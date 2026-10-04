import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import { UpsellVsl } from "@/components/UpsellVsl";
import { fillVslScript, planVslPick, VSL_DEFAULT_TEMPLATE } from "@shared/vsl";

/**
 * Harness for the Upsell VSL page, against stubbed `channelConfig.list`, `book.list`,
 * `channelHostPhoto.list`, the `vsl` router and the `heygenTest` routes it shares (status,
 * retry, rename, deleteBatch), backed by in-page state. Generate adds a clip that walks
 * voicing → rendering → done on successive polls. Two channels: Hank has books and saved clips
 * (one in use, one failed), Granny Mae has neither — so the per-channel list, the book picker's
 * typed title, the "in use" toggle and a photo upload (just this VSL, or kept on the channel
 * unticked — `window.__kept` shows what was saved) can all be exercised without a HeyGen credit.
 *
 *   pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
 *   http://localhost:5199/__harness/vsl.html
 */
const swatch = (hue: number, label: string) =>
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">` +
      `<rect width="320" height="180" fill="hsl(${hue} 40% 45%)"/>` +
      `<circle cx="160" cy="70" r="34" fill="hsl(${hue} 30% 80%)"/>` +
      `<rect x="110" y="112" width="100" height="68" rx="22" fill="hsl(${hue} 30% 80%)"/>` +
      `<text x="160" y="170" font-size="16" text-anchor="middle" fill="#111" font-family="sans-serif">${label}</text>` +
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
  kind: "vsl";
  bookTitle: string | null;
  isPicked: boolean;
  createdAt: string;
  updatedAt: string;
  phaseStartedAt: string | null;
  costUsd: number;
};

const RATE = 0.06;
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
const BOOK = "Japanese Joinery for the Garage Shop";
const said = (book: string) => fillVslScript(VSL_DEFAULT_TEMPLATE, book);
const base = (over: Partial<Row>): Row => ({
  id: 0,
  batchId: "b0",
  userId: 1,
  userName: "Admin",
  userRole: "admin",
  channelKey: "hank",
  ttsVendor: "sixtynine_labs",
  heygenSlot: -1,
  imageUrl: swatch(30, "Hank"),
  script: said(BOOK),
  runName: null,
  audioUrl: "/__harness/media/voice.mp3",
  audioMs: 19_000,
  videoId: "v",
  videoUrl: "/__harness/media/clip.mp4",
  status: "done",
  error: null,
  kind: "vsl",
  bookTitle: BOOK,
  isPicked: false,
  createdAt: ago(3_600),
  updatedAt: new Date().toISOString(),
  phaseStartedAt: null,
  costUsd: 19 * RATE,
  ...over,
});
let nextId = 100;
const state = {
  /** Photos kept on a channel from this page ("Keep on channel"). */
  kept: [] as {
    id: number;
    channelKey: string;
    imageUrl: string;
    phoneImageUrl: string | null;
    useOriginal: boolean;
    phoneLookError: string | null;
    isSelected: boolean;
  }[],
  rows: [
    base({ id: 3, batchId: "h3", runName: "Shorter tip", createdAt: ago(600) }),
    base({ id: 2, batchId: "h2", isPicked: true, createdAt: ago(7_200) }),
    base({
      id: 1,
      batchId: "h1",
      bookTitle: "Workshop Projects That Sell",
      script: said("Workshop Projects That Sell"),
      status: "failed",
      videoId: null,
      videoUrl: null,
      costUsd: 0,
      error: "HeyGen API error (402): insufficient credits",
      createdAt: ago(90_000),
    }),
    ...Array.from({ length: 5 }, (_, i) =>
      base({ id: -10 - i, batchId: `old${i}`, createdAt: ago(200_000 + i * 3_600) })
    ),
  ] as Row[],
};

/** Each poll moves a clip in flight one stage on, as the real one would over minutes. */
function advance() {
  for (const r of state.rows) {
    if (r.status === "voicing") {
      r.status = "rendering";
      r.audioUrl = "/__harness/media/voice.mp3";
      r.audioMs = 27_000;
      r.videoId = `v${r.id}`;
      r.costUsd = 27 * RATE;
      r.phaseStartedAt = new Date().toISOString();
    } else if (r.status === "rendering") {
      r.status = "done";
      r.videoUrl = "/__harness/media/clip.mp4";
    }
  }
}

function handle(path: string, input: any): unknown {
  if (path === "channelConfig.list")
    return [
      { channelKey: "hank", displayName: "Hank's Workshop", voiceId: "v-69", minimaxVoiceId: null },
      { channelKey: "granny-mae", displayName: "Granny Mae", voiceId: "v-69b", minimaxVoiceId: "v-mm" },
      { channelKey: "no-voice", displayName: "No voice yet", voiceId: null, minimaxVoiceId: null },
    ];
  if (path === "book.list")
    return input.channelKey === "hank"
      ? [
          { id: 1, title: BOOK, coverImageUrl: swatch(15, "cover 1") },
          { id: 2, title: "Workshop Projects That Sell", coverImageUrl: swatch(190, "cover 2") },
          { id: 3, title: "100 Ways to Make Your First $1,000 with Woodworking", coverImageUrl: null },
        ]
      : [];
  if (path === "channelHostPhoto.list") {
    const hue = input.channelKey === "hank" ? 30 : 300;
    // A photo kept on the channel gets its phone look on the poll after it was saved.
    const kept = state.kept.filter(k => k.channelKey === input.channelKey);
    const out = JSON.parse(JSON.stringify(kept));
    for (const k of kept) k.phoneImageUrl ??= swatch(150, `phone ${k.id}`);
    return [
      { id: 11, imageUrl: swatch(hue, "orig 1"), phoneImageUrl: swatch(hue + 10, "phone 1"), useOriginal: false, phoneLookError: null, isSelected: true },
      { id: 12, imageUrl: swatch(hue + 60, "orig 2"), phoneImageUrl: swatch(hue + 70, "phone 2"), useOriginal: false, phoneLookError: null, isSelected: true },
      ...out,
    ];
  }
  if (path === "styleReference.upload") return { url: swatch(200, "upload orig") };
  if (path === "heygenTest.phoneLook") return { url: swatch(210, "upload phone") };
  if (path === "channelHostPhoto.save") {
    const id = nextId++;
    state.kept.push({
      id,
      channelKey: input.channelKey,
      imageUrl: input.imageUrl,
      phoneImageUrl: null,
      useOriginal: false,
      phoneLookError: null,
      isSelected: input.isSelected ?? true,
    });
    return { id };
  }
  if (path === "heygenTest.status") return { ready: true, ratePerSec: RATE };
  if (path === "vsl.list") {
    const all = state.rows
      .filter(r => !input?.channelKey || r.channelKey === input.channelKey)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const page = input?.page ?? 1;
    const out = JSON.parse(JSON.stringify(all.slice((page - 1) * 5, page * 5)));
    advance();
    return { rows: out, totalRuns: all.length, page, pageCount: Math.max(1, Math.ceil(all.length / 5)) };
  }
  if (path === "vsl.start") {
    const id = nextId++;
    state.rows.push(
      base({
        id,
        batchId: `n${id}`,
        channelKey: input.channelKey,
        imageUrl: input.imageUrl,
        script: input.script,
        bookTitle: input.bookTitle,
        runName: input.name ?? null,
        status: "voicing",
        audioUrl: null,
        audioMs: null,
        videoId: null,
        videoUrl: null,
        costUsd: 0,
        createdAt: new Date().toISOString(),
        phaseStartedAt: new Date().toISOString(),
      })
    );
    return { batchId: `n${id}` };
  }
  if (path === "vsl.pick") {
    const { pick, unpick } = planVslPick(state.rows, input.batchId);
    for (const r of state.rows) {
      if (unpick.includes(r.batchId)) r.isPicked = false;
      if (pick.includes(r.batchId)) r.isPicked = true;
    }
    return { ok: true };
  }
  if (path === "heygenTest.rename") {
    for (const r of state.rows)
      if (r.batchId === input.batchId) r.runName = input.name.trim() || null;
    return { ok: true };
  }
  if (path === "heygenTest.retry") {
    const targets = state.rows.filter(r => r.batchId === input.batchId && r.status === "failed");
    for (const r of targets) {
      r.status = "rendering";
      r.error = null;
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

const realFetch = window.fetch.bind(window);
window.fetch = (async (req: any, init?: RequestInit) => {
  const url = String(typeof req === "string" ? req : req.url);
  if (!url.includes("/api/trpc/")) return realFetch(req, init);
  const paths = url.split("/api/trpc/")[1].split("?")[0].split(",");
  // Mutations carry their input in the body; queries (GET) in the URL's `input` param.
  const urlInput = new URL(url, location.href).searchParams.get("input");
  const body = init?.body ? JSON.parse(String(init.body)) : urlInput ? JSON.parse(urlInput) : null;
  const results = paths.map((p, i) => ({
    result: { data: { json: handle(p, body?.[String(i)]?.json) } },
  }));
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof window.fetch;
(window as any).__kept = state.kept;

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
        <UpsellVsl />
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
