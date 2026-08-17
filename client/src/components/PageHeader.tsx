import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The title block every page opens with.
 *
 * The four pages each rolled their own: two at `text-2xl`, two at `text-xl`, only
 * two with a description, and each aligning its actions differently. Landing on a
 * new page therefore looked like landing in a different app. One component means
 * the heading level, spacing and action alignment are decided once.
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  /** One line on what the page is for. Worth writing for every page. */
  description?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  /** Primary action(s), right-aligned on wide viewports and wrapped below on narrow. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted"
          >
            <Icon className="h-[18px] w-[18px] text-primary" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}
