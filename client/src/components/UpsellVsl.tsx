import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRequestId } from "@/lib/requestId";
import { keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ImageIcon,
  Loader2,
  Megaphone,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  countScriptWords,
  estimateTestSeconds,
  HEYGEN_TEST_MAX_NAME,
  HEYGEN_TEST_MAX_WORDS,
  HEYGEN_TEST_RUNS_PER_PAGE,
  heygenTestInputError,
  pageList,
} from "@shared/heygenTest";
import {
  fillVslScript,
  VSL_BOOK_TOKEN,
  VSL_DEFAULT_TEMPLATE,
  VSL_MAX_BOOK_TITLE,
  vslInputError,
  vslTemplateFrom,
  vslWordsLeft,
} from "@shared/vsl";
import { ROLE_LABEL } from "@shared/roles";
import { downloadFile } from "@/lib/download";
import { HostPhotoTile } from "./HostPhotoTile";
import { HostPhotoPreview } from "./HostPhotoPreview";
import {
  formatRunDate,
  HeygenClipStatus,
  RunName,
  useHeygenTestStatus,
  useNow,
} from "./HeygenTest";

/**
 * Upsell VSL (`/vsl`) — a channel's host on the upsell page, right after a purchase: thanks for
 * buying the book, one tip to get started, then the bundle offer.
 *
 * It is the HeyGen test's engine pointed at a different job (`shared/vsl.ts`): the script is
 * voiced once in the channel's voice, cut to 30 s and lip-synced with the production call, so the
 * account picker, progress, retry and failure wording are the test page's own pieces. What this
 * page adds is that everything is KEPT PER CHANNEL — pick a channel and the page is that
 * channel's voice, photos, books and saved clips — and that one clip per book can be marked as
 * the one in use.
 *
 * A NEW PHOTO can be uploaded here, and the page asks where it belongs before using it: just this
 * VSL (never saved to the channel), or kept on the channel — saved UNTICKED, so it is there for
 * the next VSL without becoming a camera angle in the channel's videos.
 *
 * Each photo is the HeyGen test's tile (`HostPhotoTile`): its Phone / Original switch applies to
 * THIS VSL only — it starts from the channel's own setting and never writes it, so the channel's
 * videos keep the look they have — and the magnifier opens the two versions side by side.
 */

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const CHANNEL_MEMORY = "vsl-channel";
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

type Vendor = "sixtynine_labs" | "minimax";

const remembered = () => {
  try {
    return localStorage.getItem(CHANNEL_MEMORY) ?? "";
  } catch {
    return "";
  }
};

export function UpsellVsl() {
  const utils = trpc.useUtils();
  const { data: channels } = trpc.channelConfig.list.useQuery();
  const heygen = useHeygenTestStatus();
  const [channelKey, setChannelKeyState] = useState(remembered);
  const [vendor, setVendor] = useState<Vendor>("sixtynine_labs");
  const [bookInput, setBookInput] = useState("");
  // The photo picked: a library photo's id, "upload" for the one uploaded for this VSL only, or
  // null for the channel's primary.
  const [photoId, setPhotoId] = useState<number | "upload" | null>(null);
  // A photo uploaded for THIS VSL only (its URL) — never saved to the channel.
  const [oneOff, setOneOff] = useState<string | null>(null);
  // The photo open in the big preview.
  const [previewOf, setPreviewOf] = useState<number | "upload" | null>(null);
  // An upload waiting for its answer: keep on the channel, or just this VSL.
  const [pendingUpload, setPendingUpload] = useState<string | null>(null);
  const [template, setTemplate] = useState(VSL_DEFAULT_TEMPLATE);
  // The channel the template was last loaded for — it is re-seeded once per channel, never over
  // what the operator is typing.
  const [templateFor, setTemplateFor] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);

  const voiced = (channels ?? []).filter(c => c.voiceId || c.minimaxVoiceId);
  const channel = voiced.find(c => c.channelKey === channelKey);
  const setChannelKey = (key: string) => {
    setChannelKeyState(key);
    setBookInput("");
    setPhotoId(null);
    setOneOff(null);
    setPreviewOf(null);
    setPendingUpload(null);
    setPage(1);
    try {
      localStorage.setItem(CHANNEL_MEMORY, key);
    } catch {
      // Private mode: the channel is simply not remembered.
    }
  };
  // A channel with only one vendor's voice gets that vendor; the chooser shows only with both.
  const effectiveVendor: Vendor =
    channel && !channel.voiceId && channel.minimaxVoiceId
      ? "minimax"
      : channel && !channel.minimaxVoiceId
        ? "sixtynine_labs"
        : vendor;

  const { data: books } = trpc.book.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channel }
  );
  const { data: photos } = trpc.channelHostPhoto.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channel }
  );
  // The channel's newest clip — its wording is where the next one starts.
  const { data: latest } = trpc.vsl.list.useQuery(
    { channelKey, page: 1 },
    { enabled: !!channel }
  );
  useEffect(() => {
    if (!channel || !latest || templateFor === channelKey) return;
    const last = latest.rows[0];
    setTemplate(
      last ? vslTemplateFrom(last.script, last.bookTitle) : VSL_DEFAULT_TEMPLATE
    );
    setTemplateFor(channelKey);
  }, [channel, channelKey, latest, templateFor]);

  const bookTitle = bookInput.trim();
  const previewLibrary =
    typeof previewOf === "number" ? photos?.find(p => p.id === previewOf) : undefined;
  // The primary photo unless another is picked.
  const usingOneOff = photoId === "upload" && !!oneOff;
  const photo = usingOneOff
    ? undefined
    : (photos?.find(p => p.id === photoId) ?? photos?.[0]);
  const imageUrl = usingOneOff ? oneOff : (photo?.imageUrl ?? "");
  const script = fillVslScript(template, bookTitle);

  const upload = trpc.styleReference.upload.useMutation({
    onSuccess: ({ url }) => setPendingUpload(url),
    onError: err => toast.error(err.message),
  });
  const keep = trpc.channelHostPhoto.save.useMutation({
    onSuccess: async ({ id }) => {
      await utils.channelHostPhoto.list.invalidate({ channelKey });
      if (id != null) setPhotoId(id);
      setPendingUpload(null);
      toast.success("Photo kept on the channel — not used in its videos unless you tick it.");
    },
    onError: err => toast.error(err.message),
  });
  /** Use the upload for this VSL only. */
  const applyJustHere = (url: string) => {
    setOneOff(url);
    setPhotoId("upload");
    setPendingUpload(null);
  };

  const words = countScriptWords(script);
  const left = vslWordsLeft(script);
  const estSec = estimateTestSeconds(script);
  const blocker = !channel
    ? "Pick a channel."
    : (heygen.blocker ??
      (photos && !imageUrl
        ? "This channel has no host photo — upload one."
        : (vslInputError({ script, bookTitle }) ??
          heygenTestInputError({ script, imageUrls: imageUrl ? [imageUrl] : [] }))));

  const startRequest = useRequestId();
  const start = trpc.vsl.start.useMutation({
    onSuccess: () => {
      startRequest.settled();
      toast.success("VSL started — voicing, then rendering on HeyGen.");
      setName("");
      setPage(1);
      utils.vsl.list.invalidate();
    },
    onError: err => {
      startRequest.settled(err);
      toast.error(err.message);
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4" />
            New upsell VSL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="vsl-channel">
                Channel
              </Label>
              <select
                id="vsl-channel"
                className={selectClass}
                value={channel ? channelKey : ""}
                onChange={e => setChannelKey(e.target.value)}
              >
                <option value="">Pick a channel…</option>
                {voiced.map(c => (
                  <option key={c.channelKey} value={c.channelKey}>
                    {c.displayName ?? c.channelKey}
                  </option>
                ))}
              </select>
            </div>
            {channel?.voiceId && channel?.minimaxVoiceId && (
              <div className="space-y-1.5">
                <Label className="text-xs">Voice provider</Label>
                <select
                  className={selectClass}
                  value={vendor}
                  onChange={e => setVendor(e.target.value as Vendor)}
                >
                  <option value="sixtynine_labs">69Labs</option>
                  <option value="minimax">MiniMax</option>
                </select>
              </div>
            )}
          </div>

          {channel && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="vsl-book">
                    Book the customer just bought
                  </Label>
                  <BookPicker
                    id="vsl-book"
                    books={books ?? []}
                    value={bookInput}
                    onChange={setBookInput}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" htmlFor="vsl-name">
                    Name <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="vsl-name"
                    value={name}
                    maxLength={HEYGEN_TEST_MAX_NAME}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Version 1"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Host photo</Label>
                <div className="flex flex-wrap gap-2">
                  {(photos ?? []).map((p, i) => {
                    const on = !usingOneOff && p.id === photo?.id;
                    const name = `Host photo ${i + 1}${i === 0 ? " (primary)" : ""}`;
                    return (
                      // The same tile as the HeyGen test: the picture picks it for this VSL, the
                      // magnifier opens it big.
                      <HostPhotoTile
                        key={p.id}
                        imageUrl={p.imageUrl}
                        active={on}
                        pressed={on}
                        pictureLabel={name}
                        onPictureClick={() => setPhotoId(p.id)}
                        onPreview={() => setPreviewOf(p.id)}
                        corner={on ? <PickedMark /> : undefined}
                        label={
                          <span className="font-medium text-foreground">
                            {i === 0 ? "★ Primary" : `Photo ${i + 1}`}
                          </span>
                        }
                      />
                    );
                  })}
                  {oneOff && (
                    <HostPhotoTile
                      imageUrl={oneOff}
                      active={usingOneOff}
                      pressed={usingOneOff}
                      pictureLabel="The photo uploaded for this VSL only"
                      onPictureClick={() => setPhotoId("upload")}
                      onPreview={() => setPreviewOf("upload")}
                      corner={usingOneOff ? <PickedMark /> : undefined}
                      label={<span className="font-medium text-foreground">This VSL only</span>}
                    />
                  )}
                  <label className="flex min-h-20 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-[11px] text-muted-foreground hover:bg-muted">
                    {upload.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    {upload.isPending ? "Uploading…" : "Upload"}
                    <input
                      type="file"
                      accept={ACCEPTED.join(",")}
                      className="hidden"
                      aria-label="Upload a new host photo"
                      disabled={upload.isPending}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        if (!ACCEPTED.includes(file.type))
                          return toast.error("Use a JPG, PNG, or WEBP image.");
                        if (file.size > 10 * 1024 * 1024)
                          return toast.error("Image must be under 10 MB");
                        const reader = new FileReader();
                        reader.onload = () => upload.mutate({ dataUrl: reader.result as string });
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                </div>
                <HostPhotoPreview
                  imageUrl={
                    previewOf === "upload" ? oneOff : (previewLibrary?.imageUrl ?? null)
                  }
                  title="Host photo for this VSL"
                  onOpenChange={open => !open && setPreviewOf(null)}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="vsl-script">
                  Script
                </Label>
                <Textarea
                  id="vsl-script"
                  rows={6}
                  value={template}
                  onChange={e => setTemplate(e.target.value)}
                />
                <p
                  className={`text-[11px] ${left < 0 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {words}/{HEYGEN_TEST_MAX_WORDS} words · about {Math.round(estSec)} s ·{" "}
                  <code>{VSL_BOOK_TOKEN}</code> becomes the book&apos;s title
                </p>
                {template !== VSL_DEFAULT_TEMPLATE && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-ml-2 h-7 px-2 text-xs text-muted-foreground"
                    onClick={() => setTemplate(VSL_DEFAULT_TEMPLATE)}
                  >
                    Start again from the standard script
                  </Button>
                )}
              </div>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!!blocker || start.isPending}
              onClick={() =>
                {
                  const request = {
                    channelKey,
                    ttsVendor: effectiveVendor,
                    script,
                    imageUrl,
                    bookTitle,
                    name: name.trim() || undefined,
                  };
                  start.mutate({
                    ...request,
                    requestId: startRequest.idFor(request),
                  });
                }
              }
            >
              {start.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Generate VSL
            </Button>
            <span className="text-xs text-muted-foreground">
              {blocker ??
                `About $${(Math.max(estSec, 1) * heygen.rate).toFixed(2)} on HeyGen (~${Math.round(estSec)} s)`}
            </span>
          </div>
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingUpload !== null}
        onOpenChange={open => {
          if (!open && !keep.isPending) setPendingUpload(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this photo on the channel?</AlertDialogTitle>
            <AlertDialogDescription>
              Keep it on {channel?.displayName ?? channelKey} and it is here next time. The
              channel&apos;s videos won&apos;t use it unless you tick it on the video page. Or use
              it for this VSL only, and it is not saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingUpload && (
            <img
              src={pendingUpload}
              alt="The photo you uploaded"
              className="max-h-56 w-full rounded border border-border object-contain"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={keep.isPending}>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              disabled={keep.isPending}
              onClick={() => pendingUpload && applyJustHere(pendingUpload)}
            >
              Just for this VSL
            </Button>
            <AlertDialogAction
              disabled={keep.isPending}
              onClick={e => {
                // Stay open until it is saved, so a failure is seen in context.
                e.preventDefault();
                if (pendingUpload)
                  keep.mutate({ channelKey, imageUrl: pendingUpload, isSelected: false });
              }}
            >
              {keep.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Keep on channel
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {channel && (
        <VslResults
          channelKey={channelKey}
          channelName={channel.displayName ?? channelKey}
          page={page}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

/** A book's cover as a small thumbnail; a book icon when it has none. */
function BookCover({ url }: { url?: string | null }) {
  return url ? (
    <img src={url} alt="" className="h-9 w-7 shrink-0 rounded-sm border border-border object-cover" />
  ) : (
    <span className="flex h-9 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-muted">
      <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

/**
 * The book the buyer bought: a dropdown of the channel's books (cover + title) with a search box,
 * and a "Use …" row for a title that is not one of them — CTA books are often uploaded per video
 * and are not in the channel's list. A typed title is used for this VSL only; it is not added to
 * the channel. `value` is the title as the host says it.
 */
function BookPicker({
  id,
  books,
  value,
  onChange,
}: {
  id: string;
  books: { id: number; title: string; coverImageUrl?: string | null }[];
  value: string;
  onChange: (title: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The highlighted row, for the arrow keys: the matching books, then the "Use …" row.
  const [active, setActive] = useState(0);

  const title = value.trim();
  const picked = books.find(b => b.title === title);
  const q = query.trim();
  const matches = q
    ? books.filter(b => b.title.toLowerCase().includes(q.toLowerCase()))
    : books;
  // Offered when what is typed is not already a book's exact title.
  const custom =
    q && !books.some(b => b.title.toLowerCase() === q.toLowerCase()) ? q : null;
  const rowCount = matches.length + (custom ? 1 : 0);

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  const chooseRow = (row: number) => {
    if (row < matches.length) choose(matches[row].title);
    else if (custom) choose(custom);
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (next) {
          setQuery("");
          setActive(0);
        }
      }}
    >
      <div className="relative">
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            className="flex h-12 w-full items-center gap-2 rounded-md border border-input bg-background px-2 pr-14 text-left text-sm"
          >
            {title ? (
              <>
                <BookCover url={picked?.coverImageUrl} />
                <span className="truncate">{title}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Pick or type a book…</span>
            )}
            <ChevronDown className="absolute right-2 h-4 w-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        {title && (
          <button
            type="button"
            aria-label="Clear the book"
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-0"
      >
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            maxLength={VSL_MAX_BOOK_TITLE}
            onChange={e => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={e => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive(a => Math.min(a + 1, rowCount - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive(a => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                chooseRow(active);
              }
            }}
            placeholder="Search, or type a title"
            aria-label="Search this channel's books, or type a title"
            className="h-8 pl-8"
          />
        </div>
        <div role="listbox" aria-label="Books" className="max-h-64 overflow-y-auto p-1">
          {matches.map((b, row) => (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={b.title === title}
              title={b.title}
              onMouseEnter={() => setActive(row)}
              onClick={() => choose(b.title)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                row === active ? "bg-muted" : ""
              }`}
            >
              <BookCover url={b.coverImageUrl} />
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              {b.title === title && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
          {custom && (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => choose(custom)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${
                active === matches.length ? "bg-muted" : ""
              }`}
            >
              <span className="flex h-9 w-7 shrink-0 items-center justify-center">
                <Plus className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                Use &ldquo;{custom}&rdquo;
              </span>
            </button>
          )}
          {rowCount === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              This channel has no books yet — type the title to use it.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The corner tick on the photo picked for this VSL. */
function PickedMark() {
  return (
    <span className="block rounded-full bg-primary p-0.5 text-primary-foreground">
      <Check className="h-3 w-3" />
    </span>
  );
}

function VslResults({
  channelKey,
  channelName,
  page,
  onPageChange,
}: {
  channelKey: string;
  channelName: string;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const utils = trpc.useUtils();
  const { canRemove } = useAuth();
  const { data, isLoading, isFetching } = trpc.vsl.list.useQuery(
    { channelKey, page },
    {
      placeholderData: keepPreviousData,
      // Poll only while something on this page is still working.
      refetchInterval: query =>
        query.state.data?.rows.some(
          r => r.status === "voicing" || r.status === "rendering"
        )
          ? 5_000
          : false,
    }
  );
  const rows = data?.rows;
  const totalRuns = data?.totalRuns ?? 0;
  const pageCount = data?.pageCount ?? 1;
  useEffect(() => {
    if (data && page > data.pageCount) onPageChange(data.pageCount);
  }, [data, page, onPageChange]);

  const refresh = () => utils.vsl.list.invalidate();
  const onError = (err: { message: string }) => toast.error(err.message);
  const rename = trpc.heygenTest.rename.useMutation({ onSuccess: refresh, onError });
  const retry = trpc.heygenTest.retry.useMutation({
    onSuccess: () => {
      toast.success("Retrying the clip.");
      refresh();
    },
    onError,
  });
  const usePick = trpc.vsl.pick.useMutation({ onSuccess: refresh, onError });
  const [pendingDelete, setPendingDelete] = useState<{
    batchId: string;
    running: boolean;
    picked: boolean;
  } | null>(null);
  const remove = trpc.heygenTest.deleteBatch.useMutation({
    onSuccess: () => {
      toast.success("VSL deleted.");
      setPendingDelete(null);
      refresh();
    },
    onError,
  });

  const running = !!rows?.some(r => r.status === "voicing" || r.status === "rendering");
  const now = useNow(running);
  // A VSL is one clip; newest first.
  const clips = useMemo(() => [...(rows ?? [])].sort((a, b) => b.id - a.id), [rows]);

  if (isLoading)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading {channelName}&apos;s VSLs…
      </div>
    );
  if (totalRuns === 0)
    return (
      <p className="text-sm italic text-muted-foreground">
        {channelName} has no upsell VSLs yet. The ones you make are kept here.
      </p>
    );

  const firstShown = (page - 1) * HEYGEN_TEST_RUNS_PER_PAGE + 1;
  const lastShown = Math.min(page * HEYGEN_TEST_RUNS_PER_PAGE, totalRuns);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">{channelName}&apos;s upsell VSLs</h2>
      {clips.map(r => {
        const busy = r.status === "voicing" || r.status === "rendering";
        const ready = r.status === "done" && !!r.videoUrl;
        return (
          <Card key={r.batchId}>
            <CardContent className="grid gap-4 pt-4 md:grid-cols-[minmax(0,320px)_1fr]">
              <div className="space-y-2">
                {ready ? (
                  <video
                    controls
                    preload="metadata"
                    src={r.videoUrl!}
                    poster={r.imageUrl}
                    className="aspect-video w-full rounded bg-black object-contain"
                  />
                ) : (
                  <img
                    src={r.imageUrl}
                    alt=""
                    className="aspect-video w-full rounded bg-muted object-contain"
                  />
                )}
                <HeygenClipStatus
                  row={r}
                  now={now}
                  retrying={retry.isPending}
                  onRetry={() => retry.mutate({ batchId: r.batchId, ids: [r.id] })}
                />
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {r.bookTitle ?? "No book"}
                      </p>
                      {r.isPicked && (
                        <Badge className="border-success/30 bg-success/10 text-success">
                          <Check className="mr-1 h-3 w-3" />
                          In use
                        </Badge>
                      )}
                    </div>
                    <RunName
                      name={r.runName}
                      saving={rename.isPending}
                      onSave={name => rename.mutate({ batchId: r.batchId, name })}
                    />
                  </div>
                  {canRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      aria-label="Delete this VSL"
                      disabled={remove.isPending}
                      onClick={() =>
                        setPendingDelete({
                          batchId: r.batchId,
                          running: busy,
                          picked: r.isPicked,
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Made by{" "}
                  <span className="font-medium text-foreground">
                    {r.userName ?? "a removed account"}
                  </span>
                  {r.userRole ? ` (${ROLE_LABEL[r.userRole]})` : ""}
                  {" · "}
                  <time dateTime={new Date(r.createdAt).toISOString()}>
                    {formatRunDate(r.createdAt)}
                  </time>
                  {r.audioMs ? ` · ${Math.round(r.audioMs / 1000)} s` : ""}
                </p>
                <p className="text-sm">“{r.script}”</p>
                {ready && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      size="sm"
                      variant={r.isPicked ? "outline" : "default"}
                      disabled={usePick.isPending}
                      onClick={() => usePick.mutate({ batchId: r.batchId })}
                    >
                      {r.isPicked ? "Stop using" : "Use this one"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        downloadFile(
                          r.videoUrl!,
                          "video",
                          `${channelName} upsell VSL - ${r.bookTitle ?? r.batchId}`
                        )
                      }
                    >
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download MP4
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigator.clipboard
                          .writeText(r.videoUrl!)
                          .then(() => toast.success("Link copied."))
                          .catch(() => toast.error("Couldn't copy the link."))
                      }
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy link
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <nav
        aria-label="VSL pages"
        className="flex flex-wrap items-center justify-between gap-3 pt-1"
      >
        <p className="text-xs text-muted-foreground">
          Showing {firstShown}–{lastShown} of {totalRuns}
          {isFetching && <Loader2 className="ml-1.5 inline h-3 w-3 animate-spin" />}
        </p>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            {pageList(page, pageCount).map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="px-1.5 text-sm text-muted-foreground">
                  …
                </span>
              ) : (
                <Button
                  key={p}
                  variant={p === page ? "default" : "ghost"}
                  size="sm"
                  className="h-8 min-w-8 px-2 tabular-nums"
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </Button>
              )
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </nav>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={open => {
          if (!open && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this VSL?</AlertDialogTitle>
            <AlertDialogDescription>
              It is removed from this page. This can&apos;t be undone.
              {pendingDelete?.picked &&
                " It is marked as the one in use — a page already showing its link keeps playing it."}
              {pendingDelete?.running &&
                " It is still rendering: it will finish on HeyGen and is still charged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={e => {
                // Keep the dialog open until the delete lands, so a failure is seen in context.
                e.preventDefault();
                if (pendingDelete) remove.mutate({ batchId: pendingDelete.batchId });
              }}
            >
              {remove.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
