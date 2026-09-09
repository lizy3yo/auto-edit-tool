import type { ReactNode } from "react";

/**
 * The "review what changes" step shared by the Admin confirmation dialogs.
 *
 * A bare "are you sure?" protects nothing — it trains an operator to click through it. What
 * makes a confirmation worth showing is the SPECIFIC list it asks them to approve, so a stray
 * edit made while scrolling a long form is visible before it is written.
 *
 * Both the channel editor and its books list ask the same question, so they ask it with the
 * same component: two hand-rolled summaries would drift apart in wording and layout, and the
 * operator would have to re-learn the dialog for each. `diffFields` is the same reason in the
 * data direction — one definition of "did this field change and how does it read".
 */

export type SummaryRow = {
  label: string;
  value: ReactNode;
  /**
   * Text rows align on the baseline so a wrapped value still starts level with its label.
   * A row of thumbnails has no useful baseline — aligning to one drops the label to the
   * image's bottom edge (measured 19px low) — so those centre instead.
   */
  align?: "baseline" | "center";
};

export type FieldSpec<T> = {
  field: keyof T;
  label: string;
  /** How one value reads. Defaults to `describeText`. */
  describe?: (value: string) => string;
  /**
   * Render the value as a thumbnail rather than text. An uploaded image holds an R2 URL,
   * which is long and tells a reader nothing: naming it instead ("a photo") made a SWAP
   * read "a photo → a photo", which says nothing at all, and even a correct word makes an
   * operator take the upload on trust. The picture is the answer, so the row shows it.
   */
  image?: boolean;
};

/** Plain text: quoted, or the word "empty" so a cleared field is unmistakable. */
export function describeText(value: string) {
  return value.trim() ? `"${value.trim()}"` : "empty";
}

/**
 * One side of an image change. Square because the channel editor already shows host photos
 * square; a cover's 4:3 survives the centre crop well enough to be recognised at this size,
 * and the book dialog previews it whole directly above.
 */
function AssetThumb({ src }: { src: string }) {
  if (!src) return <span className="text-muted-foreground">none</span>;
  return (
    <img
      src={src}
      alt=""
      className="h-12 w-12 shrink-0 rounded border border-border object-cover"
    />
  );
}

/** Only the fields whose trimmed values differ, in the order the specs are given. */
export function diffFields<T>(
  original: T,
  next: T,
  specs: FieldSpec<T>[]
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  for (const spec of specs) {
    const describe = spec.describe ?? describeText;
    const from = String(original[spec.field] ?? "").trim();
    const to = String(next[spec.field] ?? "").trim();
    if (from === to) continue;
    rows.push({
      label: spec.label,
      align: spec.image ? "center" : "baseline",
      value: spec.image ? (
        <span className="flex items-center gap-2">
          <AssetThumb src={from} />
          <span className="text-muted-foreground">→</span>
          <AssetThumb src={to} />
        </span>
      ) : (
        <>
          <span className="text-muted-foreground line-through">
            {describe(from)}
          </span>
          <span className="text-muted-foreground"> → </span>
          <span className="font-medium">{describe(to)}</span>
        </>
      ),
    });
  }
  return rows;
}

export function fieldCountLabel(count: number) {
  return count === 1
    ? "1 field will be updated:"
    : `${count} fields will be updated:`;
}

export function SummaryList({ rows }: { rows: SummaryRow[] }) {
  return (
    <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded border border-border text-xs">
      {rows.map(row => (
        <li
          key={row.label}
          className={`flex gap-2 px-3 py-2 ${
            row.align === "center" ? "items-center" : "items-baseline"
          }`}
        >
          <span className="w-32 shrink-0 text-muted-foreground">
            {row.label}
          </span>
          <span className="min-w-0 flex-1 break-words">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}
