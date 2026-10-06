import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { RouterOutputs } from "@/lib/trpc";
import { PageHeader } from "@/components/PageHeader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";

type Item = RouterOutputs["activity"]["list"]["items"][number];

const STAGE_LABELS: Record<string, string> = {
  storyboard: "Storyboarding",
  voiceover: "Recording the voice",
  clips: "Making the clips",
  assembly: "Stitching the video",
  done: "Done",
};

/** "3 min ago" — coarse on purpose, the list refreshes every few seconds. */
function ago(date: Date): string {
  const sec = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  return `${Math.floor(sec / 86400)} d ago`;
}

/** Where a running video is, in the card's own words. */
function progressText(item: Item): string {
  if (item.status === "completed") return "Finished";
  if (item.status === "failed") return "Stopped";
  const stage = STAGE_LABELS[item.stage] ?? item.stage;
  if (item.phase?.label)
    return `${stage} · ${item.phase.label}${item.phase.pct != null ? ` · ${item.phase.pct}%` : ""}`;
  if (
    item.scenesTotal &&
    item.scenesDone != null &&
    (item.stage === "voiceover" || item.stage === "clips")
  )
    return `${stage} · ${item.scenesDone}/${item.scenesTotal} scenes`;
  return stage;
}

function accountsText(item: Item): string | null {
  const parts = [
    item.heygenAccount != null ? `HeyGen ${item.heygenAccount + 1}` : null,
    item.apimartAccount != null ? `APIMART ${item.apimartAccount + 1}` : null,
  ].filter(Boolean);
  return parts.length ? `Accounts: ${parts.join(", ")}` : null;
}

function Row({
  item,
  channelName,
  isAdmin,
}: {
  item: Item;
  channelName: string | null;
  isAdmin: boolean;
}) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const open = () => navigate(`/?open=${item.id}`);
  const refresh = () => void utils.activity.list.invalidate();

  const takeOver = trpc.activity.takeOver.useMutation({
    onSuccess: () => {
      refresh();
      open();
    },
    onError: err => {
      toast.error(err.message ?? "Could not take over");
      refresh();
    },
  });
  const handBack = trpc.activity.handBack.useMutation({
    onSuccess: () => {
      toast.success("Handed back");
      refresh();
    },
    onError: err => toast.error(err.message ?? "Could not hand back"),
  });

  const heldByOther = !!item.takeover && !item.takeover.mine;
  const accounts = accountsText(item);

  return (
    <div
      className={`flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border px-4 py-3 ${
        item.attention
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-card"
      }`}
    >
      <div className="mt-0.5 shrink-0">
        {item.attention ? (
          <AlertTriangle className="h-4 w-4 text-destructive" />
        ) : item.status === "processing" ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : item.status === "completed" ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
      </div>

      <div className="min-w-0 flex-1 basis-64 space-y-0.5">
        <p className="truncate text-sm font-medium">
          {item.title || `Video ${item.id}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            item.mine ? "You" : item.userName,
            channelName,
            progressText(item),
            ago(item.updatedAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {item.attention && (
          <p className="text-xs font-medium text-destructive">
            {item.attention}
          </p>
        )}
        {item.status === "failed" && item.errorMessage && (
          <p
            className="line-clamp-2 text-xs text-muted-foreground"
            title={item.errorMessage}
          >
            {item.errorMessage}
          </p>
        )}
        {(accounts || item.warnings > 0) && (
          <p className="text-[11px] text-muted-foreground">
            {[
              accounts,
              item.warnings > 0
                ? `${item.warnings} warning${item.warnings === 1 ? "" : "s"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {item.takeover && (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
            {item.takeover.mine
              ? "You are fixing this"
              : `Being fixed by ${item.takeover.byName}`}
          </span>
        )}
        {item.mine || item.takeover?.mine ? (
          <Button size="sm" variant="outline" onClick={open}>
            Open
          </Button>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={open}>
              View
            </Button>
            {!heldByOther && (
              <Button
                size="sm"
                disabled={takeOver.isPending}
                onClick={() => takeOver.mutate({ jobId: item.id })}
              >
                Take over
              </Button>
            )}
          </>
        )}
        {(item.takeover?.mine || (heldByOther && isAdmin)) && (
          <Button
            size="sm"
            variant="outline"
            disabled={handBack.isPending}
            onClick={() => handBack.mutate({ jobId: item.id })}
          >
            Hand back
          </Button>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  items,
  channelNames,
  isAdmin,
}: {
  title: string;
  empty?: string;
  items: Item[];
  channelNames: Map<string, string>;
  isAdmin: boolean;
}) {
  if (!items.length && !empty) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        {title}
        {items.length > 0 && ` (${items.length})`}
      </h2>
      {items.length ? (
        items.map(item => (
          <Row
            key={item.id}
            item={item}
            channelName={
              item.channelKey
                ? (channelNames.get(item.channelKey) ?? item.channelKey)
                : null
            }
            isAdmin={isAdmin}
          />
        ))
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      )}
    </section>
  );
}

/**
 * Activity — everyone's videos, live, for admins and operations managers (`canSeeAllJobs`, the
 * same gate as `managerProcedure` on the `activity` router). The ones that need a person come
 * first, and "Take over" opens one in your own tab with its owner's buttons paused
 * (`shared/jobTakeover.ts`).
 */
export default function ActivityPage() {
  const { isAdmin } = useAuth();
  const { data, isLoading, error } = trpc.activity.list.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: channels } = trpc.channelConfig.listAllChannels.useQuery();
  const [person, setPerson] = useState("all");

  const channelNames = useMemo(
    () => new Map((channels ?? []).map(c => [c.key, c.name])),
    [channels]
  );
  const people = useMemo(() => {
    const byId = new Map<number, string>();
    for (const i of data?.items ?? []) byId.set(i.userId, i.userName);
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [data]);

  const items = (data?.items ?? []).filter(
    i => person === "all" || String(i.userId) === person
  );
  const attention = items.filter(i => i.attention);
  const running = items.filter(i => !i.attention && i.status === "processing");
  const recent = items.filter(i => !i.attention && i.status !== "processing");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Activity}
        title="Activity"
        actions={
          people.length > 1 && (
            <Select value={person} onValueChange={setPerson}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {people.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      />

      {error && (
        <Alert tone="destructive" title="Could not load the list">
          {error.message}
        </Alert>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <Section
            title="Needs attention"
            items={attention}
            channelNames={channelNames}
            isAdmin={isAdmin}
          />
          <Section
            title="Running now"
            empty="Nothing is rendering right now."
            items={running}
            channelNames={channelNames}
            isAdmin={isAdmin}
          />
          <Section
            title="Last 24 hours"
            items={recent}
            channelNames={channelNames}
            isAdmin={isAdmin}
          />
        </>
      )}
    </div>
  );
}
