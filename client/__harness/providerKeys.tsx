import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import { HostLipsyncToggle } from "@/components/admin/ProviderKeys";

/**
 * Harness for the host lip-sync provider/quality switch (Admin → Provider Keys), which needs
 * only two tRPC procedures and no database. `fetch` is stubbed with a superjson-shaped batch
 * response and backed by module-level state, so the mutations actually change what the next
 * query returns — the switch behaves as it does against a real server, including the
 * invalidate→refetch round trip.
 *
 *   pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
 *   http://localhost:5199/__harness/provider-keys.html
 */
const state = {
  provider: "heygen" as "heygen" | "runpod",
  quality: "fast" as "fast" | "full",
  endpointSet: true,
  keySet: true,
};

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input.url);
  if (!url.includes("/api/trpc/")) return realFetch(input, init);

  // httpBatchLink puts the procedure path in the URL; mutations carry their input in the body.
  const path = url.split("/api/trpc/")[1].split("?")[0];
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const input0 = body?.["0"]?.json ?? body?.json ?? body?.[0]?.json;

  if (path.includes("setLipsyncProvider")) state.provider = input0.provider;
  if (path.includes("setLipsyncQuality")) state.quality = input0.quality;

  const data = path.includes("getLipsyncProvider")
    ? {
        provider: state.provider,
        quality: state.quality,
        runpod: {
          endpointSet: state.endpointSet,
          keySet: state.keySet,
          ready: state.endpointSet && state.keySet,
        },
      }
    : path.includes("setLipsyncProvider")
      ? { provider: state.provider }
      : { quality: state.quality };

  return new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof window.fetch;

function Harness() {
  const [, force] = useState(0);
  const [queryClient] = useState(() => new QueryClient());
  const [client] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    })
  );

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <div className="space-y-6">
          <HostLipsyncToggle />
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <div className="mb-2 font-medium">
              Harness controls (not part of the UI)
            </div>
            <button
              className="rounded border px-2 py-1"
              onClick={() => {
                state.endpointSet = !state.endpointSet;
                queryClient.clear();
                force(n => n + 1);
              }}
            >
              endpoint configured: {String(state.endpointSet)}
            </button>
          </div>
        </div>
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
