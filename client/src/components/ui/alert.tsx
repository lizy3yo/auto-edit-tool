import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Inline banner for a condition the page needs to explain — mock mode is on, the
 * workspace failed to sync, a render died.
 *
 * These used to be hand-rolled `div`s with `border-amber-500/60 bg-amber-500/10`
 * repeated at each site, which is how the app ended up with three different
 * ambers and a warning that was invisible on a white background. Tone lives here,
 * resolved from the `--warning` / `--info` / `--success` tokens, so a banner is
 * one prop rather than three colour classes.
 */
const alertVariants = cva(
  "flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-sm",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted/60 text-foreground",
        info: "border-info/25 bg-info/5 text-foreground",
        success: "border-success/25 bg-success/5 text-foreground",
        warning: "border-warning/30 bg-warning/10 text-foreground",
        destructive: "border-destructive/30 bg-destructive/5 text-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

const toneIcon: Record<string, LucideIcon> = {
  neutral: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
};

const toneIconColor: Record<string, string> = {
  neutral: "text-muted-foreground",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

function Alert({
  className,
  tone = "neutral",
  title,
  icon = true,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /** Bolded first line. Omit for a single-sentence banner. */
    title?: React.ReactNode;
    /** Set false where the surrounding layout already carries a status icon. */
    icon?: boolean;
  }) {
  const key = tone ?? "neutral";
  const Icon = toneIcon[key];

  return (
    <div
      role="status"
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {icon && (
        <Icon
          aria-hidden
          className={cn("mt-0.5 h-4 w-4 shrink-0", toneIconColor[key])}
        />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-medium leading-snug">{title}</p>}
        {children && (
          <div className="leading-relaxed text-muted-foreground">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

export { Alert, alertVariants };
