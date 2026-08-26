import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  BookOpen,
  AlertTriangle,
  Check,
  ChevronDown,
  ClipboardCopy,
  ImageIcon,
  Library,
  Loader2,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { buildBookCtaTemplate } from "@shared/ctaMarkers";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
/** Placement is by title match against the CTA blocks, so at most one book per block is useful. */
const MAX_BOOKS = 8;

/**
 * One book this video pitches. There is no per-block assignment — the operator NAMES the book in
 * the script's CTA text, and the server places it on the block that matches its title. So a book
 * is just a title, a cover, and (optionally) a shop link.
 */
export type CtaBookUpload = {
  title: string;
  coverImageUrl?: string;
  shopUrl?: string;
  /** Also persist it as a reusable channel book (Admin → Channels), not just this video. */
  saveToChannel?: boolean;
  /**
   * Picked from the channel's saved books rather than typed here. Rendered read-only — the
   * book's identity is the channel's, edited under Admin → Channels, and a per-video tweak
   * would silently fork it (and break the title match the channel copy was saved with).
   * Client-only: the generate call maps explicit fields, so this never reaches the server.
   */
  fromChannel?: boolean;
};

/** Back-compat alias — the parent holds this state under the old name. */
export type CtaBookAssignment = CtaBookUpload;

/**
 * Books a video pitches, uploaded on the generate form.
 *
 * This used to be a per-block dropdown (mid-roll pitch / closing pitch), each assigned a book.
 * That is gone: you upload the book(s) here and CALL them in the script's CTA text, and the
 * pipeline reveals each cover on the line that names it. Upload once, name it in the prompt.
 *
 * Always rendered. A book can be uploaded before the script carries CTA markers — Copy CTA
 * hands back the marker lines to paste in — so the upload comes first and the script follows.
 * With no marked block the section says so instead of disappearing.
 */
export function LongformCtaBooks({
  script,
  channelKey,
  value,
  onChange,
  disabled,
}: {
  script: string;
  channelKey: string;
  value: CtaBookUpload[];
  onChange: (next: CtaBookUpload[]) => void;
  disabled?: boolean;
}) {
  const trimmed = script.trim();
  const { data: detected } = trpc.book.detectCtaBlocks.useQuery(
    { script: trimmed },
    { enabled: trimmed.length > 0 }
  );

  const blocks = detected?.blocks ?? [];

  const upload = trpc.styleReference.upload.useMutation();
  const saveBook = trpc.book.save.useMutation();

  // The channel's saved books (Admin → Channels), offered as one-click rows so a returning
  // book doesn't have to be re-typed and re-uploaded per video. Active only — a deactivated
  // book is deliberately out of rotation.
  const { data: channelBooks } = trpc.book.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  // Which rows have been written to the channel this session, keyed by title+shop so that
  // editing a saved book after saving flips the button back to "Save now" (it IS a new state).
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingIndex, setSavingIndex] = useState<number | null>(null);

  const keyFor = (b: CtaBookUpload) =>
    `${b.title.trim().toLowerCase()}|${b.shopUrl?.trim() ?? ""}`;

  /**
   * Write this book to the channel's Books immediately, the way the Channels editor does — the
   * counterpart to the "Also save to this channel" checkbox, which defers the same write to
   * generate time. Either way the book is still placed on this video by title match.
   */
  const saveNow = (i: number) => {
    const b = value[i];
    const title = b.title.trim();
    if (!title) return toast.error("Give the book a title first.");
    setSavingIndex(i);
    saveBook.mutate(
      {
        channelKey,
        title,
        coverImageUrl: b.coverImageUrl ?? null,
        shopUrl: b.shopUrl?.trim() || null,
      },
      {
        onSuccess: () => {
          setSavedKeys(prev => new Set(prev).add(keyFor(b)));
          toast.success("Saved to this channel.");
          setSavingIndex(null);
        },
        onError: err => {
          toast.error(err.message);
          setSavingIndex(null);
        },
      }
    );
  };

  const setBook = (i: number, patch: Partial<CtaBookUpload>) =>
    onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const addBook = () => onChange([...value, { title: "" }]);

  /** Case-insensitive: is this channel book already a row on this video? */
  const alreadyAdded = (title: string) =>
    value.some(
      b => b.title.trim().toLowerCase() === title.trim().toLowerCase()
    );

  /**
   * Add a channel book as a pre-filled row. It already lives on the channel, so it lands in
   * `savedKeys` immediately — the row shows "Saved" rather than offering to save it again.
   */
  const addFromChannel = (book: {
    title: string;
    coverImageUrl: string | null;
    shopUrl: string | null;
  }) => {
    onChange([
      ...value,
      {
        title: book.title,
        coverImageUrl: book.coverImageUrl ?? undefined,
        shopUrl: book.shopUrl ?? undefined,
        fromChannel: true,
      },
    ]);
    setPickerOpen(false);
  };

  const removeBook = (i: number) => onChange(value.filter((_, j) => j !== i));

  /**
   * Copy this book's CTA markers — `===START CTA (title)===` … `===END CTA===` — ready to
   * paste. The name in the marker assigns the book to that block (no need to speak the title
   * for placement); the operator writes or prompts the pitch between the markers. Clipboard
   * rather than an auto-insert on purpose: WHERE the block goes is the one thing only the
   * operator knows (mid-roll belongs mid-script), so the paste point stays theirs.
   */
  const copyCta = async (b: CtaBookUpload) => {
    const title = b.title.trim();
    if (!title) return toast.error("Give the book a title first.");
    try {
      await navigator.clipboard.writeText(buildBookCtaTemplate(title));
      toast.success(
        `CTA markers for “${title}” copied — paste them where the pitch belongs (mid-roll or close) and write the spoken pitch between them. The marker lines are never voiced.`
      );
    } catch {
      toast.error("Couldn't reach the clipboard — copy it manually.");
    }
  };

  const uploadCover = (i: number, file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type))
      return toast.error("Use a JPG, PNG, or WEBP image.");
    if (file.size > MAX_BYTES) return toast.error("Image must be under 10 MB");
    const reader = new FileReader();
    reader.onload = () =>
      upload.mutate(
        { dataUrl: reader.result as string },
        {
          onSuccess: ({ url }) => setBook(i, { coverImageUrl: url }),
          onError: err => toast.error(err.message),
        }
      );
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">
        Books in this video{" "}
        {blocks.length > 0 && (
          <span className="font-normal text-muted-foreground">
            ({blocks.length} call{blocks.length === 1 ? "" : "s"} to action
            found)
          </span>
        )}
      </Label>
      <p className="text-xs text-muted-foreground">
        Upload each book you pitch and give it the title you use in the script.
        The cover is revealed on the CTA line that names it — so name it in the
        script and it lands there. A book with a shop link also gets a QR and a
        tracking link.
      </p>

      {/* No marked block: the books still upload, but nothing places them yet. Say it here —
          the server refuses a generate that attaches a book to an unmarked script. */}
      {blocks.length === 0 &&
        (value.length > 0 ? (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The script has no CTA block yet — wrap the pitch in ===START CTA===
            / ===END CTA=== lines (Copy CTA gives you the exact text). Until it
            does, this book has nowhere to land and generating is refused.
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No CTA block marked in the script yet — add the book here, then use
            Copy CTA to paste its lines into the script.
          </p>
        ))}

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((b, i) =>
            b.fromChannel ? (
              /* A channel book rides along as-is: view it, or take it off this video.
                 Its title/cover/link are edited under Admin → Channels — changing them
                 here would fork the book per video, which is exactly what saving it to
                 the channel was for avoiding. */
              <div
                key={i}
                className="flex items-center gap-3 rounded-md border border-border bg-secondary/30 p-2.5"
              >
                {b.coverImageUrl ? (
                  <img
                    src={b.coverImageUrl}
                    alt=""
                    className="h-14 w-10 shrink-0 rounded border border-border object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded border border-dashed border-border">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{b.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {b.shopUrl
                      ? `${b.shopUrl} — QR + tracking`
                      : "No shop link — cover only, no QR or tracking"}
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Library className="h-3 w-3" />
                    Channel book — edit it under Channels.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className="h-7 px-2 text-xs"
                    onClick={() => copyCta(b)}
                  >
                    <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
                    Copy CTA
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={disabled}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => removeBook(i)}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={i}
                className="flex gap-3 rounded-md border border-border bg-secondary/30 p-2.5"
              >
                {/* Cover */}
                {b.coverImageUrl ? (
                  <div className="relative shrink-0">
                    <img
                      src={b.coverImageUrl}
                      alt=""
                      className="h-20 rounded border border-border object-cover"
                      style={{ width: "3.75rem" }}
                    />
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => setBook(i, { coverImageUrl: undefined })}
                      aria-label="Remove cover"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label
                    className={`flex h-20 shrink-0 flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-background text-[10px] text-muted-foreground ${
                      disabled || upload.isPending
                        ? "opacity-50"
                        : "cursor-pointer hover:text-foreground"
                    }`}
                    style={{ width: "3.75rem" }}
                  >
                    {upload.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="h-4 w-4" />
                    )}
                    Cover
                    <input
                      type="file"
                      accept={ACCEPTED.join(",")}
                      className="hidden"
                      disabled={disabled || upload.isPending}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        uploadCover(i, f);
                      }}
                    />
                  </label>
                )}

                {/* Fields */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Input
                    value={b.title}
                    maxLength={255}
                    disabled={disabled}
                    placeholder="Book title — as you name it in the script"
                    onChange={e => setBook(i, { title: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <Input
                    value={b.shopUrl ?? ""}
                    disabled={disabled}
                    placeholder="Shop link (optional) — adds a QR + tracking"
                    onChange={e =>
                      setBook(i, { shopUrl: e.target.value || undefined })
                    }
                    className="h-8 text-sm"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Checkbox
                        checked={b.saveToChannel ?? false}
                        disabled={disabled}
                        onCheckedChange={v =>
                          setBook(i, { saveToChannel: v === true })
                        }
                      />
                      Also save to this channel
                    </label>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled || !b.title.trim()}
                        className="h-7 px-2 text-xs"
                        onClick={() => copyCta(b)}
                      >
                        <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
                        Copy CTA
                      </Button>
                      {savedKeys.has(keyFor(b)) ? (
                        <span className="flex items-center gap-1 px-2 text-xs text-success">
                          <Check className="h-3.5 w-3.5" />
                          Saved
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={
                            disabled || !b.title.trim() || savingIndex === i
                          }
                          className="h-7 px-2 text-xs"
                          onClick={() => saveNow(i)}
                        >
                          {savingIndex === i ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="mr-1 h-3.5 w-3.5" />
                          )}
                          Save now
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => removeBook(i)}
                      >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                  {b.title.trim() && !b.shopUrl?.trim() && (
                    <p className="flex items-start gap-1.5 text-[11px] text-warning">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      No shop link — this book shows its cover but carries no QR
                      or tracking.
                    </p>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {value.length < MAX_BOOKS && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={addBook}
            className="h-8 gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Add a book
          </Button>
          {(channelBooks?.length ?? 0) > 0 && (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Library className="h-3.5 w-3.5" />
                  Add from channel ({channelBooks!.length})
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-1.5">
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Books saved on this channel place themselves automatically
                  when a CTA block calls them — ===START CTA (Title)=== or
                  speaking the title. Add one here only to attach it without
                  naming it, or to override.
                </p>
                <div className="max-h-64 space-y-0.5 overflow-y-auto">
                  {channelBooks!.map(b => {
                    const added = alreadyAdded(b.title);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={added}
                        onClick={() => addFromChannel(b)}
                        className={`flex w-full items-center gap-2.5 rounded-md p-1.5 text-left ${
                          added
                            ? "cursor-default opacity-50"
                            : "hover:bg-secondary"
                        }`}
                      >
                        {b.coverImageUrl ? (
                          <img
                            src={b.coverImageUrl}
                            alt=""
                            className="h-12 w-9 shrink-0 rounded border border-border object-cover"
                          />
                        ) : (
                          <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded border border-dashed border-border">
                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {b.title}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {b.shopUrl
                              ? "Shop link — gets a QR + tracking"
                              : "Cover only — no shop link"}
                          </span>
                        </span>
                        {added && (
                          <span className="flex shrink-0 items-center gap-1 text-[11px] text-success">
                            <Check className="h-3.5 w-3.5" />
                            Added
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Each book&apos;s cover is revealed on the CTA line that names it, with
        its own QR. Channel books join in automatically whenever a block calls
        them by name — no adding needed. A block that calls no book at all uses
        the channel&apos;s cover and QR. After the render you&apos;ll get a
        tracking link per book for the YouTube description.
      </p>
    </div>
  );
}
