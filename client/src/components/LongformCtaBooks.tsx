import { useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, AlertTriangle } from "lucide-react";

/** No book for this block — falls back to the channel's cover/QR. */
const NONE = "__none__";

export type CtaBookAssignment = { ctaIndex: number; bookId: number };

/**
 * Assign a book to each CTA block in the script, before the video is generated.
 *
 * A video can pitch a DIFFERENT book in its mid-roll and its close, so the choice is per block
 * rather than per video. Blocks are discovered from the `===START CTA===` markers already in the
 * script, and each is pre-filled by matching the book's title against the block's text — the same
 * signal the pipeline uses to place the cover reveal — so the common case needs no clicks.
 *
 * A block left unassigned falls back to the channel's single cover and QR, which is exactly how
 * the app behaved before books existed.
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
  value: CtaBookAssignment[];
  onChange: (next: CtaBookAssignment[]) => void;
  disabled?: boolean;
}) {
  const trimmed = script.trim();
  const { data: detected } = trpc.book.detectCtaBlocks.useQuery(
    { script: trimmed },
    { enabled: trimmed.length > 0 }
  );
  const { data: books } = trpc.book.list.useQuery(
    { channelKey, activeOnly: true },
    { enabled: !!channelKey }
  );

  const blocks = detected?.blocks ?? [];
  const available = books ?? [];

  /**
   * Pre-fill by title match: the block that says "a book called The Backyard Soil Handbook" is
   * almost certainly pitching that book, and making the operator pick it every time is friction
   * for no decision. Only fills blocks the operator hasn't touched.
   */
  const guessed = useMemo(() => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
    return blocks.map(b => {
      const hay = norm(b.excerpt);
      const hit = available.find(book => {
        const tokens = norm(book.title)
          .split(/\s+/)
          .filter(t => t.length > 3);
        if (tokens.length === 0) return false;
        const found = tokens.filter(t => hay.includes(t)).length;
        return found >= Math.ceil(tokens.length / 2);
      });
      return hit?.id;
    });
  }, [blocks, available]);

  // Seed the assignments once the blocks and books are both known. Never overwrites a choice
  // already made — `value` is the operator's, and a re-render must not undo it.
  useEffect(() => {
    if (blocks.length === 0 || available.length === 0) return;
    const missing = blocks
      .map((b, i) => ({ ctaIndex: b.ctaIndex, bookId: guessed[i] }))
      .filter(
        (g): g is CtaBookAssignment =>
          g.bookId != null && !value.some(v => v.ctaIndex === g.ctaIndex)
      );
    if (missing.length) onChange([...value, ...missing]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.length, available.length, guessed.join(",")]);

  if (!trimmed || blocks.length === 0) return null;

  const set = (ctaIndex: number, bookId: string) => {
    const rest = value.filter(v => v.ctaIndex !== ctaIndex);
    onChange(
      bookId === NONE ? rest : [...rest, { ctaIndex, bookId: Number(bookId) }]
    );
  };

  const label = (i: number) =>
    blocks.length === 1
      ? "Call to action"
      : i === 0
        ? "Mid-roll pitch"
        : i === blocks.length - 1
          ? "Closing pitch"
          : `Pitch ${i + 1}`;

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">
        Books in this video{" "}
        <span className="font-normal text-muted-foreground">
          ({blocks.length} call{blocks.length === 1 ? "" : "s"} to action found)
        </span>
      </Label>

      {available.length === 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No books set up for this channel yet — add them in Admin → Books. This
          video will use the channel's single cover and QR instead, with no
          per-video sales tracking.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {blocks.map((b, i) => {
              const selected = value.find(v => v.ctaIndex === b.ctaIndex);
              const book = available.find(x => x.id === selected?.bookId);
              return (
                <div
                  key={b.ctaIndex}
                  className="rounded-md border border-border bg-secondary/30 p-2.5"
                >
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">{label(i)}</span>
                    <span className="truncate text-[11px] italic text-muted-foreground">
                      “{b.excerpt}…”
                    </span>
                  </div>
                  <Select
                    value={selected ? String(selected.bookId) : NONE}
                    disabled={disabled}
                    onValueChange={v => set(b.ctaIndex, v)}
                  >
                    <SelectTrigger className="h-8 bg-secondary/50 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>
                        No book — use the channel's cover &amp; QR
                      </SelectItem>
                      {available.map(x => (
                        <SelectItem key={x.id} value={String(x.id)}>
                          {x.title}
                          {x.shopUrl ? "" : "  (no shop link)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {book && !book.shopUrl && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-400">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      This book has no shop link, so this pitch gets no QR and
                      no sales tracking. Add one in Admin → Books.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Each pitch reveals its own book's cover and shows its own QR. After
            the render you'll get a tracking link per book to paste into the
            YouTube description.
          </p>
        </>
      )}
    </div>
  );
}
