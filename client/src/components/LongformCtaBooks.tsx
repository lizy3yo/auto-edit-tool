import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  BookOpen,
  AlertTriangle,
  Check,
  ImageIcon,
  Loader2,
  Plus,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
 * Only renders once the script actually has CTA blocks — there is nowhere to place a book
 * otherwise, and offering the upload then would be a control that does nothing.
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

  // Which rows have been written to the channel this session, keyed by title+shop so that
  // editing a saved book after saving flips the button back to "Save now" (it IS a new state).
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [savingIndex, setSavingIndex] = useState<number | null>(null);

  if (!trimmed || blocks.length === 0) return null;

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

  const removeBook = (i: number) => onChange(value.filter((_, j) => j !== i));

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
        <span className="font-normal text-muted-foreground">
          ({blocks.length} call{blocks.length === 1 ? "" : "s"} to action found)
        </span>
      </Label>
      <p className="text-xs text-muted-foreground">
        Upload each book you pitch and give it the title you use in the script.
        The cover is revealed on the CTA line that names it — so name it in the
        script and it lands there. A book with a shop link also gets a QR and a
        tracking link.
      </p>

      {value.length > 0 && (
        <div className="space-y-2">
          {value.map((b, i) => (
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
          ))}
        </div>
      )}

      {value.length < MAX_BOOKS && (
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
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Each book&apos;s cover is revealed on the CTA line that names it, with
        its own QR. A block that names no uploaded book uses the channel&apos;s
        cover and QR. After the render you&apos;ll get a tracking link per book
        for the YouTube description.
      </p>
    </div>
  );
}
