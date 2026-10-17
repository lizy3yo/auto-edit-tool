import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Languages, Megaphone, PackagePlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/PageHeader";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpsellVsl } from "@/components/UpsellVsl";
import { DubCta } from "@/components/DubCta";

/**
 * Add-ons (`/add-ons`, 2026-10-15) — the short clips that sell a channel's book outside its
 * videos: the host's Upsell VSL (`shared/vsl.ts`) and the faceless Dub CTAs (`shared/dubCta.ts`).
 * They were two pages, each opening with its own channel picker; now one picker leads both tabs.
 * Only the page is shared — each tab keeps its own engine, table and router. `/vsl` and
 * `/dub-ctas` redirect here (App.tsx). Admins and operations managers (`canManageChannels`),
 * matching `managerProcedure` on both routers.
 */

type Tab = "vsl" | "dub";

const CHANNEL_MEMORY = "add-ons-channel";
// What the two pages remembered before they were joined, so the first visit opens on it.
const OLD_MEMORY = ["vsl-channel", "dub-cta-channel"];

const remembered = () => {
  try {
    for (const key of [CHANNEL_MEMORY, ...OLD_MEMORY]) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
  } catch {
    // Private mode: the channel is simply not remembered.
  }
  return "";
};

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export default function AddOnsPage() {
  const { data: channels } = trpc.channelConfig.list.useQuery();
  const [channelKey, setChannelKeyState] = useState(remembered);
  const channel = channels?.find(c => c.channelKey === channelKey);
  const setChannelKey = (key: string) => {
    setChannelKeyState(key);
    try {
      localStorage.setItem(CHANNEL_MEMORY, key);
    } catch {
      // Private mode: see `remembered`.
    }
  };

  // The tab lives in the URL, so a link (and the old /dub-ctas) opens on the right one.
  const search = useSearch();
  const [, navigate] = useLocation();
  const tab: Tab = new URLSearchParams(search).get("tab") === "dub" ? "dub" : "vsl";
  const setTab = (next: string) => navigate(`/add-ons?tab=${next}`, { replace: true });

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PackagePlus}
        title="Add-ons"
      />
      <div className="max-w-sm space-y-1.5">
        <Label className="text-xs" htmlFor="add-ons-channel">
          Channel
        </Label>
        <select
          id="add-ons-channel"
          className={selectClass}
          value={channel ? channelKey : ""}
          onChange={e => setChannelKey(e.target.value)}
        >
          <option value="">Pick a channel…</option>
          {(channels ?? []).map(c => (
            <option key={c.channelKey} value={c.channelKey}>
              {c.displayName ?? c.channelKey}
            </option>
          ))}
        </select>
      </div>
      {channel ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="vsl">
              <Megaphone />
              Upsell VSL
            </TabsTrigger>
            <TabsTrigger value="dub">
              <Languages />
              Dub CTAs
            </TabsTrigger>
          </TabsList>
          {/* Both stay mounted, so a script half typed in one tab is there after a look at the
              other. Keyed by channel: a new channel starts each tab afresh, as each page's own
              picker used to. */}
          <TabsContent value="vsl" forceMount className="data-[state=inactive]:hidden">
            <UpsellVsl key={channelKey} channelKey={channelKey} />
          </TabsContent>
          <TabsContent value="dub" forceMount className="data-[state=inactive]:hidden">
            <DubCta key={channelKey} channelKey={channelKey} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">
          Pick a channel to see its upsell VSLs and dub CTAs.
        </p>
      )}
    </div>
  );
}
