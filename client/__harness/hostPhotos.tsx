import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import { LongformHostPhotoPicker } from "@/components/LongformHostPhotoPicker";

/**
 * Harness for the generate form's "Host photos" picker, which needs three tRPC procedures and
 * no database. `fetch` is stubbed with a superjson-shaped batch response backed by module-level
 * state, so a tick or a "make primary" actually changes what the next list returns — the picker
 * behaves as it does against a real server, including the last-ticked guard and the reorder.
 * A "Remount" button proves the ticks come back from the (stubbed) channel, not from the
 * component's own state.
 *
 *   pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
 *   http://localhost:5199/__harness/host-photos.html
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

const state = {
  rows: [
    { id: 11, sortOrder: 0, isSelected: true, imageUrl: swatch(30, "A") },
    { id: 12, sortOrder: 1, isSelected: true, imageUrl: swatch(120, "B") },
    { id: 13, sortOrder: 2, isSelected: true, imageUrl: swatch(210, "C") },
    { id: 14, sortOrder: 3, isSelected: true, imageUrl: swatch(300, "D") },
  ],
};
const list = () =>
  [...state.rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(r => ({
      ...r,
      channelKey: "harness",
      label: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.includes("/api/trpc/")) return realFetch(input, init);
  const path = url.split("/api/trpc/")[1].split("?")[0];
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const input0 = body?.["0"]?.json ?? body?.json ?? body?.[0]?.json;

  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fail = (message: string) =>
    new Response(
      JSON.stringify([
        {
          error: {
            json: {
              message,
              code: -32600,
              data: { code: "BAD_REQUEST", httpStatus: 400 },
            },
          },
        },
      ]),
      { status: 400, headers: { "content-type": "application/json" } }
    );

  if (path.includes("channelHostPhoto.setSelected")) {
    const row = state.rows.find(r => r.id === input0.id)!;
    const ticked = state.rows.filter(r => r.isSelected);
    if (!input0.selected && ticked.length === 1 && row.isSelected)
      return fail(
        "At least one host photo must stay ticked — a video needs one to render host scenes."
      );
    row.isSelected = input0.selected;
    return reply(list());
  }
  if (path.includes("channelHostPhoto.setPrimary")) {
    const ordered = [
      ...state.rows.filter(r => r.id === input0.id),
      ...state.rows
        .filter(r => r.id !== input0.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    ];
    ordered.forEach((r, i) => (r.sortOrder = i));
    ordered[0].isSelected = true;
    return reply({ success: true });
  }
  if (path.includes("channelHostPhoto.list")) return reply(list());
  return reply(null);
}) as typeof window.fetch;

function Harness() {
  const [mount, setMount] = useState(0);
  const [minutes, setMinutes] = useState(3);
  const [ids, setIds] = useState<number[]>([]);
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    })
  );

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <div className="space-y-6 text-foreground">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-1">
              Talking head
              <select
                value={minutes}
                onChange={e => setMinutes(Number(e.target.value))}
                className="rounded border border-border bg-background px-1 py-0.5"
              >
                {[3, 4, 5, 6, 7].map(m => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 hover:text-foreground"
              onClick={() => {
                queryClient.clear();
                setMount(m => m + 1);
              }}
            >
              Remount (simulates a reload)
            </button>
            <span data-testid="sent-ids">
              sent with generate: [{ids.join(", ")}]
            </span>
          </div>
          <div key={mount} className="rounded-lg border border-border p-4">
            <LongformHostPhotoPicker
              channelKey="harness"
              value={ids}
              onChange={setIds}
              hostMinutes={minutes}
            />
          </div>
        </div>
        <Toaster richColors />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
