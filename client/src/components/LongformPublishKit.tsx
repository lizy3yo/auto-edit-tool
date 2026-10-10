import { VIEW_EDIT } from "@/components/ViewOnlyGuard";
import { useEffect, useId, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Check,
  ChevronRight,
  Loader2,
  ListVideo,
  Link2,
  Youtube,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Everything needed to publish a finished render, in one panel:
 *
 *  - the tracking link and QR per book the video pitched
 *  - a paste-ready YouTube description
 *  - a timestamp map of where each kind of shot lands, so a spot check is one click
 *  - a box to paste the YouTube URL back, so sales reports read by title
 *  - reported sales, once the store starts sending them
 *
 * All of it is derived server-side from the stored storyboard, so it reflects the current state
 * of the video rather than a snapshot taken at render time.
 */

const mmss = (sec: number) => {
  const t = Math.max(0, Math.floor(sec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** Copy-to-clipboard with a settled confirmation, so a click never looks like a no-op. */
function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      variant="outline"
      size="sm"
      className={className ?? "h-7 shrink-0 text-xs"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
        } catch {
          toast.error("Couldn't copy — select the text and copy manually.");
        }
      }}
    >
      {done ? (
        <>
          <Check className="mr-1.5 h-3.5 w-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="mr-1.5 h-3.5 w-3.5" /> {label}
        </>
      )}
    </Button>
  );
}

/**
 * One fold-away row of the publish kit: a title, a one-line summary of what is inside, and the
 * row's main action (copy) reachable without opening it. Closed until asked for — open, the
 * three of them ran well past a screen.
 */
function KitSection({
  icon: Icon,
  title,
  summary,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  summary: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className="border-t border-border first:border-t-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="group flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {summary}
            </span>
          </span>
        </button>
        {action}
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-label={open ? `Hide ${title}` : `Show ${title}`}
          className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
          />
        </button>
      </div>
      {open && (
        <div id={bodyId} className="space-y-2 px-3 pb-3 sm:pl-10">
          {children}
        </div>
      )}
    </section>
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Colour per shot kind, so the map is scannable without reading every row.
 *
 * Light-mode weights: a `50` fill under `700` text, rather than the `500/15` fill
 * under `300` text a dark surface wants. Those pale 300s measured under 2:1 on
 * white — legible on the old near-black card, invisible on this one.
 */
const KIND_STYLE: Record<string, string> = {
  host: "bg-sky-50 text-sky-700 border-sky-200",
  split: "bg-violet-50 text-violet-700 border-violet-200",
  splitMotion: "bg-violet-100 text-violet-800 border-violet-300",
  video: "bg-emerald-50 text-emerald-700 border-emerald-200",
  still: "bg-zinc-100 text-zinc-700 border-zinc-300",
  asset: "bg-amber-50 text-amber-800 border-amber-200",
  cover: "bg-orange-50 text-orange-700 border-orange-200",
  qrHero: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
};

export function LongformPublishKit({
  jobId,
  onSeek,
}: {
  jobId: number;
  /** Jump the player to a timestamp. Absent ⇒ rows are not clickable. */
  onSeek?: (sec: number) => void;
}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.longformVideo.getPublishKit.useQuery({
    jobId,
  });
  const { data: sales } = trpc.longformVideo.getSales.useQuery({ jobId });
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setYoutubeUrl(data?.youtubeUrl ?? "");
  }, [data?.youtubeUrl]);

  const saveUrl = trpc.longformVideo.setYoutubeUrl.useMutation({
    onSuccess: () => {
      toast.success("YouTube link saved.");
      utils.longformVideo.getPublishKit.invalidate({ jobId });
    },
    onError: err => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading publish info…
      </div>
    );
  }
  if (!data) return null;

  const rows = showAll ? data.timeline : data.summary;
  const labels = data.labels as Record<string, string>;

  // The kit lists a book once per call to action; a book pitched twice is one row here.
  const books: ((typeof data.books)[number] & { uses: number })[] = [];
  for (const b of data.books) {
    const same = books.find(
      x => x.title === b.title && x.trackingUrl === b.trackingUrl
    );
    if (same) same.uses += 1;
    else books.push({ ...b, uses: 1 });
  }
  const bookStatus = books.some(b => !b.trackingUrl)
    ? "a book has no shop link"
    : books.some(b => b.qrVerified === false)
      ? "check the QR before publishing"
      : books.every(b => b.qrVerified === true)
        ? "QR verified"
        : "";
  const onlyLink = books.length === 1 ? books[0].trackingUrl : undefined;
  const descriptionLines = (data.description ?? "").split("\n");
  const linkCount = descriptionLines.filter(l => /^https?:\/\//.test(l.trim()))
    .length;
  const chapterCount = descriptionLines.filter(l => /^\d+:\d{2}\s/.test(l))
    .length;
  const hasKit =
    books.length > 0 || !!data.description || data.timeline.length > 0;

  return (
    <div className="space-y-5">
      {hasKit && (
      <div className="rounded-md border border-border">
      {/* ── Tracking links + QR ───────────────────────────────── */}
      {books.length > 0 && (
        <KitSection
          icon={Link2}
          title="Tracking links"
          summary={[plural(books.length, "book"), bookStatus]
            .filter(Boolean)
            .join(" · ")}
          action={
            onlyLink ? <CopyButton text={onlyLink} label="Copy link" /> : null
          }
        >
          {books.map(b => (
            <div
              key={`${b.ctaIndex}-${b.bookId}`}
              className="flex items-start gap-3 rounded-md border border-border bg-secondary/30 p-3"
            >
              {b.qrImageUrl ? (
                <img
                  src={b.qrImageUrl}
                  alt={`QR for ${b.title}`}
                  className="h-20 w-20 shrink-0 rounded border border-border bg-white"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
                  no QR
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-sm font-medium">{b.title}</div>
                {b.trackingUrl ? (
                  <>
                    <div className="break-all font-mono text-[11px] text-muted-foreground">
                      {b.trackingUrl}
                    </div>
                    {b.qrVerified === false && (
                      <p className="flex items-center gap-1.5 text-[11px] text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        The QR couldn't be read back — check it scans before
                        publishing.
                      </p>
                    )}
                    {b.qrVerified === true && (
                      <p className="flex items-center gap-1.5 text-[11px] text-success">
                        <CheckCircle2 className="h-3 w-3" /> QR verified
                      </p>
                    )}
                    {b.uses > 1 && (
                      <p className="text-[11px] text-muted-foreground">
                        Used in {b.uses} calls to action
                      </p>
                    )}
                  </>
                ) : (
                  <p className="flex items-center gap-1.5 text-[11px] text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    No shop link on this book — this pitch has no tracking. Add
                    one in Admin → Books.
                  </p>
                )}
              </div>
              {b.trackingUrl && !onlyLink && (
                <CopyButton text={b.trackingUrl} label="Link" />
              )}
            </div>
          ))}
        </KitSection>
      )}

      {/* ── Description ───────────────────────────────────────── */}
      {data.description && (
        <KitSection
          icon={Youtube}
          title="Description"
          summary={
            [
              linkCount > 0 && plural(linkCount, "link"),
              chapterCount > 0 && plural(chapterCount, "chapter"),
            ]
              .filter(Boolean)
              .join(" · ") || "For the YouTube description"
          }
          action={
            <CopyButton text={data.description} label="Copy description" />
          }
        >
          <Textarea
            readOnly
            value={data.description}
            className="min-h-[120px] resize-y font-mono text-xs"
          />
        </KitSection>
      )}

      {/* ── Timestamp map ─────────────────────────────────────── */}
      {data.timeline.length > 0 && (
        <KitSection
          icon={ListVideo}
          title="Scene map"
          summary={
            onSeek
              ? `${plural(data.timeline.length, "scene")} · click a row to jump there`
              : plural(data.timeline.length, "scene")
          }
        >
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowAll(v => !v)}
            >
              {showAll
                ? `Group runs (${data.summary.length})`
                : `Every scene (${data.timeline.length})`}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {rows.map((r: any, i: number) => (
              <button
                key={`${r.startSec}-${i}`}
                type="button"
                disabled={!onSeek}
                onClick={() => onSeek?.(r.startSec)}
                className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-1.5 text-left last:border-0 ${
                  onSeek ? "hover:bg-secondary/50" : "cursor-default"
                }`}
              >
                <span className="w-20 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {mmss(r.startSec)} – {mmss(r.endSec)}
                </span>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${KIND_STYLE[r.kind] ?? ""}`}
                >
                  {labels[r.kind] ?? r.kind}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {r.assetCaption
                    ? `“${r.assetCaption}”`
                    : r.narration
                      ? r.narration
                      : r.scenes
                        ? `scene ${r.scenes[0]}${r.scenes.length > 1 ? `–${r.scenes[r.scenes.length - 1]}` : ""}`
                        : ""}
                </span>
                {r.qrCorner && (
                  <span className="shrink-0 text-[10px] text-fuchsia-400">
                    QR
                  </span>
                )}
              </button>
            ))}
          </div>
        </KitSection>
      )}
      </div>
      )}

      {/* ── YouTube link back ─────────────────────────────────── */}
      {/* The one part of the kit that CHANGES the video, so a view-only viewer gets it paused. */}
      <div className="space-y-2" {...VIEW_EDIT}>
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Youtube className="h-4 w-4" /> Published at
        </Label>
        <div className="flex gap-2">
          <Input
            value={youtubeUrl}
            onChange={e => setYoutubeUrl(e.target.value)}
            placeholder="https://youtu.be/…"
            className="text-sm"
          />
          <Button
            variant="outline"
            disabled={
              saveUrl.isPending || youtubeUrl === (data.youtubeUrl ?? "")
            }
            onClick={() => saveUrl.mutate({ jobId, youtubeUrl })}
          >
            {saveUrl.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Optional. Paste it after uploading so sales reports show this video by
          name instead of by id.
        </p>
      </div>

      {/* ── Sales ─────────────────────────────────────────────── */}
      {!!sales && sales.sales > 0 && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="h-4 w-4" /> Sales from this video
          </Label>
          <div className="rounded-md border border-border">
            {sales.byProduct.map(p => (
              <div
                key={p.productId ?? "unknown"}
                className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-0"
              >
                <span className="truncate text-muted-foreground">
                  {p.productId ?? "Unmatched product"}
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {p.sales} × ${(p.revenueCents / 100).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 bg-secondary/40 px-3 py-2 text-sm font-medium">
              <span>Total</span>
              <span className="font-mono tabular-nums">
                {sales.sales} sales · ${(sales.revenueCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Reported by your webstore. Refunds aren't reflected here — your shop
            remains the source of truth.
          </p>
        </div>
      )}
    </div>
  );
}
