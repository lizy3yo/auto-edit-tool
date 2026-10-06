import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type StepIssueTone = "warning" | "error";
type Issue = { tone: StepIssueTone; text: string };
type Registry = { set: (id: string, issue: Issue | null) => void };

const StepIssuesContext = createContext<Registry | null>(null);

/**
 * A form step's warnings and errors, collected from wherever inside the step they are raised and
 * shown behind one counted button on its heading (`IssuesButton`) instead of as lines in the body.
 * The step owns the list; a `StepIssue` anywhere below it adds to it while mounted.
 */
export function useStepIssues() {
  const [byId, setById] = useState<Record<string, Issue>>({});
  const registry = useMemo<Registry>(
    () => ({
      set: (id, issue) =>
        setById(prev => {
          if (!issue) {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          const cur = prev[id];
          if (cur && cur.text === issue.text && cur.tone === issue.tone)
            return prev;
          return { ...prev, [id]: issue };
        }),
    }),
    []
  );
  return { issues: Object.values(byId), registry };
}

export const StepIssuesProvider = StepIssuesContext.Provider;

/**
 * One warning or error. Inside a step it renders nothing and is listed on the step's heading;
 * anywhere else (a harness, another page) it is the plain inline line it used to be.
 */
export function StepIssue({
  tone = "warning",
  children,
}: {
  tone?: StepIssueTone;
  children: string;
}) {
  const registry = useContext(StepIssuesContext);
  const id = useId();
  useEffect(() => {
    if (!registry) return;
    registry.set(id, { tone, text: children });
    return () => registry.set(id, null);
  }, [registry, id, tone, children]);
  if (registry) return null;
  return (
    <p
      className={`whitespace-pre-line text-xs ${tone === "error" ? "text-destructive" : "text-warning"}`}
    >
      {children}
    </p>
  );
}

/** The counted button on a step's heading; nothing when the step has no issues. */
export function IssuesButton({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const hasError = issues.some(i => i.tone === "error");
  const label = `${issues.length} issue${issues.length === 1 ? "" : "s"}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            hasError
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-warning/40 bg-warning/10 text-warning"
          }`}
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
          {issues.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        <p className="text-xs font-medium">{label}</p>
        <ul className="space-y-2">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={`whitespace-pre-line text-xs leading-relaxed ${
                issue.tone === "error" ? "text-destructive" : "text-foreground"
              }`}
            >
              {issue.text}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
