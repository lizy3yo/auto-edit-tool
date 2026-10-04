import "@/index.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { Toaster } from "sonner";
import { trpc } from "@/lib/trpc";
import ActivityPage from "@/pages/ActivityPage";
import { ProviderKeys } from "@/components/admin/ProviderKeys";
import { activityAttention, sortActivity } from "@shared/activity";
import { PROVIDER_ACCOUNT_MAX } from "@shared/accountPool";

/**
 * Harness for the Activity page and the provider ACCOUNT list (Admin → Provider Keys), against
 * stubbed `activity.*` and key routes backed by in-page state — no database, no sign-in.
 *
 * Activity: you are admin "Kay" (id 1). The list holds one of everything — a failed video, one
 * waiting on HeyGen, one someone else is already fixing, your own, two running, one finished and
 * one its maker cancelled (which must NOT read as needing attention). "Take over" marks the row
 * yours and navigates to `/?open=<id>` (shown in the bar under the page, since the real tabs are
 * not mounted here); "Hand back" releases it.
 *
 * Accounts: 7 APIMART keys and 2 HeyGen keys are saved. "Add account" opens the next blank row,
 * Save turns it into an account, saving a row empty removes it.
 *
 *   pnpm exec vite --config client/__harness/vite.harness.config.ts --port 5199
 *   http://localhost:5199/__harness/activity.html
 */
const ago = (sec: number) => new Date(Date.now() - sec * 1000).toISOString();
const ME = { id: 1, name: "Kay", role: "admin" as const };

type Vid = {
  id: number;
  userId: number;
  userName: string;
  status: "processing" | "completed" | "failed";
  stage: string;
  title: string | null;
  channelKey: string;
  scenesTotal: number | null;
  scenesDone: number | null;
  phase: { label: string; pct: number } | null;
  warnings: number;
  errorMessage: string | null;
  updatedAt: string;
  apimartAccount: number | null;
  heygenAccount: number | null;
  heldBy: { id: number; name: string } | null;
  waitingForVoice?: boolean;
  hostNeeded?: boolean;
  hostWaiting?: boolean;
};

const vid = (v: Partial<Vid> & Pick<Vid, "id" | "userId" | "userName">): Vid => ({
  status: "processing",
  stage: "clips",
  title: null,
  channelKey: "hank",
  scenesTotal: 180,
  scenesDone: 40,
  phase: null,
  warnings: 0,
  errorMessage: null,
  updatedAt: ago(30),
  apimartAccount: 0,
  heygenAccount: 0,
  heldBy: null,
  ...v,
});

const state = {
  videos: [
    vid({ id: 341, userId: 4, userName: "Ruth", title: "7 Quilts That Sell", scenesDone: 96, apimartAccount: 2, heygenAccount: 1 }),
    vid({ id: 342, userId: 5, userName: "Dale", title: "Cutting boards ranked", stage: "assembly", phase: { label: "Encoding scenes", pct: 62 }, apimartAccount: 5, heygenAccount: 0, warnings: 2 }),
    vid({ id: 338, userId: 4, userName: "Ruth", title: "Feed sack quilts", status: "failed", errorMessage: "Assembly refused: scene 14 has no clip (HeyGen 402 — out of credits on this account)", updatedAt: ago(900), apimartAccount: 1 }),
    vid({ id: 339, userId: 6, userName: "Norbert", title: "Deadbolts under $30", hostWaiting: true, updatedAt: ago(200), apimartAccount: 3, heygenAccount: 1 }),
    vid({ id: 336, userId: 5, userName: "Dale", title: "Coasters at the market", status: "failed", errorMessage: "Narration failed twice on paragraph 6", updatedAt: ago(4000), heldBy: { id: 2, name: "Mara" }, apimartAccount: 4 }),
    vid({ id: 340, userId: 1, userName: "Kay", title: "My own test", scenesDone: 12, apimartAccount: 6, heygenAccount: 1 }),
    vid({ id: 335, userId: 6, userName: "Norbert", title: "Garage door locks", status: "completed", stage: "done", updatedAt: ago(7200) }),
    vid({ id: 334, userId: 4, userName: "Ruth", title: "Abandoned draft", status: "failed", errorMessage: "Cancelled by user", updatedAt: ago(9000) }),
  ] as Vid[],
  apimart: new Map<number, string>([0, 1, 2, 3, 4, 5, 6].map(i => [i, `ak-${1000 + i}`])),
  heygen: new Map<number, string>([[0, "hg-2200"], [1, "hg-2201"]]),
};

const mask = (key: string | undefined) => (key ? "••••••••" + key.slice(-4) : null);
const accountsOf = (keys: Map<number, string>, which: "apimartAccount" | "heygenAccount") =>
  Array.from({ length: PROVIDER_ACCOUNT_MAX }, (_, slotIndex) => ({
    slotIndex,
    masked: mask(keys.get(slotIndex)),
    rendering: state.videos.filter(v => v.status === "processing" && v[which] === slotIndex).length,
  }));

function handle(path: string, input: any): unknown {
  if (path === "auth.me") return { ...ME, email: "kay@example.test", status: "active" };
  if (path === "channelConfig.listAllChannels")
    return [{ key: "hank", name: "Hank's Workshop", niche: "" }];

  if (path === "activity.list") {
    const items = state.videos.map(v => ({
      ...v,
      mine: v.userId === ME.id,
      createdAt: v.updatedAt,
      takeover: v.heldBy
        ? { byName: v.heldBy.name, mine: v.heldBy.id === ME.id, at: Date.now() }
        : null,
      attention: activityAttention({
        status: v.status,
        errorMessage: v.errorMessage,
        waitingForVoice: !!v.waitingForVoice,
        hostNeeded: !!v.hostNeeded,
        hostWaiting: !!v.hostWaiting,
      }),
    }));
    return {
      items: sortActivity(items.map(i => ({ ...i, updatedAt: new Date(i.updatedAt) }))),
      attention: items.filter(i => i.attention).length,
    };
  }
  if (path === "activity.takeOver") {
    const v = state.videos.find(x => x.id === input.jobId)!;
    v.heldBy = { id: ME.id, name: ME.name };
    return { ok: true };
  }
  if (path === "activity.handBack") {
    const v = state.videos.find(x => x.id === input.jobId)!;
    v.heldBy = null;
    return { ok: true };
  }

  // ── Admin → Provider Keys ──
  if (path === "longformVideo.getMockMode") return { enabled: false };
  if (path === "longformVideo.getLipsyncProvider")
    return { provider: "heygen", quality: "fast", camera: "photo", runpod: { endpointSet: false, keySet: false, ready: false } };
  if (path === "longformVideo.getApimartKeys")
    return { slots: accountsOf(state.apimart, "apimartAccount"), editMasked: mask("ak-edit-0099") };
  if (path === "longformVideo.getApimartBalances")
    return {
      slots: accountsOf(state.apimart, "apimartAccount").map(a => ({
        slotIndex: a.slotIndex,
        balance: a.masked ? { remainBalance: a.slotIndex === 4 ? 2.1 : 40 + a.slotIndex } : null,
      })),
      edit: { remainBalance: 12 },
    };
  if (path === "longformVideo.getHeygenKeys")
    return { slots: accountsOf(state.heygen, "heygenAccount"), test: mask("hg-test-7777") };
  if (path === "longformVideo.getHeygenQuotas")
    return {
      slots: accountsOf(state.heygen, "heygenAccount").map(a => ({
        slotIndex: a.slotIndex,
        quota: a.masked ? 300 - a.slotIndex * 120 : null,
      })),
      test: 55,
    };
  if (path === "longformVideo.setApimartKey" || path === "longformVideo.setHeygenKey") {
    const keys = path.endsWith("setApimartKey") ? state.apimart : state.heygen;
    if (input.apiKey) keys.set(input.slotIndex, input.apiKey);
    else keys.delete(input.slotIndex);
    return { success: true };
  }
  throw new Error(`unstubbed ${path}`);
}

const realFetch = window.fetch.bind(window);
window.fetch = (async (req: any, init?: RequestInit) => {
  const url = String(typeof req === "string" ? req : req.url);
  if (!url.includes("/api/trpc/")) return realFetch(req, init);
  const paths = url.split("/api/trpc/")[1].split("?")[0].split(",");
  const urlInput = new URL(url, location.href).searchParams.get("input");
  const body = init?.body ? JSON.parse(String(init.body)) : urlInput ? JSON.parse(urlInput) : null;
  const results = paths.map((p, i) => {
    try {
      return { result: { data: { json: handle(p, body?.[String(i)]?.json) } } };
    } catch (e: any) {
      return { error: { json: { message: e.message, code: -32603, data: { code: "INTERNAL_SERVER_ERROR" } } } };
    }
  });
  return new Response(JSON.stringify(results), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof window.fetch;

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
        <div className="space-y-10">
          <ActivityPage />
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Harness: the address bar is now <code>{location.pathname + location.search}</code> —
            "Take over", "Open" and "View" go to <code>/?open=&lt;id&gt;</code>, which the real
            Long-form page turns into a tab.
          </p>
          <div>
            <h2 className="mb-4 text-lg font-semibold">Admin → Provider Keys</h2>
            <ProviderKeys />
          </div>
        </div>
        <Toaster />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
