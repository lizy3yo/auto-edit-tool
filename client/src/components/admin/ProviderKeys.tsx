import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Loader2, KeyRound, FlaskConical, Mic, Plus } from "lucide-react";
import { toast } from "sonner";

/**
 * Mock mode toggle. Replaces every PAID lane (TTS, stills/keyframes, b-roll video, host
 * lip-sync) with a locally generated stand-in, so a full render completes end-to-end without
 * spending a credit or needing those keys at all. Assembly, R2 and the music bed stay real.
 */
function MockModeToggle() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.longformVideo.getMockMode.useQuery();
  const setMock = trpc.longformVideo.setMockMode.useMutation({
    onSuccess: ({ enabled }) => {
      toast.success(
        enabled
          ? "Mock mode ON — renders are free and produce placeholder footage."
          : "Mock mode OFF — renders now spend real credits."
      );
      utils.longformVideo.getMockMode.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to toggle."),
  });
  const enabled = !!data?.enabled;

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <FlaskConical className="h-4 w-4" />
        Mock mode — free test renders
      </Label>
      <div
        className={`flex items-center justify-between gap-4 rounded-md border p-3 ${
          enabled ? "border-warning/40 bg-warning/10" : "border-border"
        }`}
      >
        <div className="text-sm">
          <div className="font-medium">
            {isLoading
              ? "Checking…"
              : enabled
                ? "ON — no credits spent"
                : "OFF — live providers"}
          </div>
          <div className="text-xs text-muted-foreground">
            Replaces voiceover, stills, b-roll video and host lip-sync with
            local placeholders. Assembly, R2 and music beds stay real, so you
            still get a playable MP4.
          </div>
        </div>
        <Button
          variant={enabled ? "destructive" : "default"}
          disabled={isLoading || setMock.isPending}
          onClick={() => setMock.mutate({ enabled: !enabled })}
        >
          {setMock.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {enabled ? "Disable" : "Enable"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Host lip-sync vendor switch, plus the InfiniteTalk quality tier.
 *
 * Switching to InfiniteTalk does NOT clear the HeyGen keys — they stay encrypted in place and
 * come straight back on switching return, because turning a vendor off is a routing decision
 * and not a credential one. One switch covers all five tabs: the per-tab HeyGen keys exist
 * because HeyGen throttles per ACCOUNT, whereas RunPod is a single endpoint we own.
 *
 * The server refuses `runpod` when its endpoint or key is missing rather than accepting a
 * setting the pipeline would ignore, so the button is disabled here with the actual reason.
 */
export function HostLipsyncToggle() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.longformVideo.getLipsyncProvider.useQuery();
  const [confirmFull, setConfirmFull] = useState(false);

  const setProvider = trpc.longformVideo.setLipsyncProvider.useMutation({
    onSuccess: ({ provider }) => {
      toast.success(
        provider === "runpod"
          ? "Host lip-sync → InfiniteTalk (RunPod). HeyGen keys kept."
          : "Host lip-sync → HeyGen Avatar IV."
      );
      utils.longformVideo.getLipsyncProvider.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to switch provider."),
  });

  const setQuality = trpc.longformVideo.setLipsyncQuality.useMutation({
    onSuccess: ({ quality }) => {
      toast.success(
        quality === "full"
          ? "InfiniteTalk → full quality. Renders are slower and cost ~10× fast."
          : "InfiniteTalk → fast quality."
      );
      utils.longformVideo.getLipsyncProvider.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to change quality."),
  });

  const setCamera = trpc.longformVideo.setLipsyncCameraMode.useMutation({
    onSuccess: ({ camera }) => {
      toast.success(
        camera === "pinned"
          ? "InfiniteTalk → pinned camera. Renders condition on a static clip of the host photo."
          : "InfiniteTalk → photo conditioning."
      );
      utils.longformVideo.getLipsyncProvider.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to change camera mode."),
  });

  const provider = data?.provider ?? "heygen";
  const quality = data?.quality ?? "fast";
  const camera = data?.camera ?? "photo";
  const onRunpod = provider === "runpod";
  const ready = data?.runpod.ready ?? false;
  const busy =
    isLoading ||
    setProvider.isPending ||
    setQuality.isPending ||
    setCamera.isPending;
  // Name the missing half rather than greying the button out silently.
  const blockedReason = data?.runpod.endpointSet
    ? data?.runpod.keySet
      ? null
      : "RUN_POD_KEY is not set"
    : "RUNPOD_INFINITETALK_ENDPOINT is not set";

  return (
    <div className="space-y-3">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Mic className="h-4 w-4" />
        Host lip-sync provider
      </Label>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
        <div className="text-sm">
          <div className="font-medium">
            {isLoading
              ? "Checking…"
              : onRunpod
                ? "InfiniteTalk (RunPod) — self-hosted"
                : "HeyGen Avatar IV"}
          </div>
          <div className="text-xs text-muted-foreground">
            {onRunpod
              ? "Your own GPU: 720p, billed by GPU second. HeyGen keys below are kept but unused."
              : "1080p, pooled accounts, billed per second of finished video."}
            {!ready && blockedReason ? (
              <>
                {" "}
                InfiniteTalk unavailable —{" "}
                <code className="text-[11px]">{blockedReason}</code>.
              </>
            ) : null}
          </div>
        </div>
        <Button
          variant="outline"
          disabled={busy || (!onRunpod && !ready)}
          onClick={() =>
            setProvider.mutate({ provider: onRunpod ? "heygen" : "runpod" })
          }
        >
          {setProvider.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {onRunpod ? "Use HeyGen" : "Use InfiniteTalk"}
        </Button>
      </div>

      {/* Quality is an InfiniteTalk-only knob — Avatar IV renders one way at one price. */}
      {onRunpod ? (
        <div
          className={`flex items-center justify-between gap-4 rounded-md border p-3 ${
            quality === "full"
              ? "border-warning/40 bg-warning/10"
              : "border-border"
          }`}
        >
          <div className="text-sm">
            <div className="font-medium">
              {quality === "full"
                ? "Full quality — 40 steps"
                : "Fast quality — 8 steps"}
            </div>
            <div className="text-xs text-muted-foreground">
              {quality === "full"
                ? "Prompt direction (framing, minimal motion) is enforced. ~10× the GPU time and cost of fast."
                : "Cheapest tier. The don't-do-this direction (sway, drift) is enforced via NAG; positive framing is only weakly applied."}
            </div>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              quality === "full"
                ? setQuality.mutate({ quality: "fast" })
                : setConfirmFull(true)
            }
          >
            {setQuality.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {quality === "full" ? "Switch to fast" : "Switch to full"}
          </Button>
        </div>
      ) : null}

      {/* Camera conditioning — InfiniteTalk-only (Avatar IV animates the still, so its
          camera is pinned by construction). Pinned = V2V on a static clip of the host photo. */}
      {onRunpod ? (
        <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
          <div className="text-sm">
            <div className="font-medium">
              {camera === "pinned"
                ? "Pinned camera — static-plate video"
                : "Photo conditioning"}
            </div>
            <div className="text-xs text-muted-foreground">
              {camera === "pinned"
                ? "Each render is conditioned on a still video of the host photo, so the camera and background hold. Experimental — compare a scene against photo mode before adopting."
                : "Renders from the host photo directly. The camera can drift slightly toward the host over a clip."}
            </div>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              setCamera.mutate({
                camera: camera === "pinned" ? "photo" : "pinned",
              })
            }
          >
            {setCamera.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {camera === "pinned" ? "Use photo" : "Pin the camera"}
          </Button>
        </div>
      ) : null}

      {/* Only the upgrade is gated. Dropping back to fast is cheaper and needs no ceremony. */}
      <AlertDialog open={confirmFull} onOpenChange={setConfirmFull}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to full quality?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Full runs 40 sampling steps with real CFG against fast&apos;s
                  8 — roughly <strong>10× the GPU time and cost</strong>. Scenes
                  that take minutes on fast take tens of minutes on full, and a
                  film&apos;s host footage goes from about{" "}
                  <strong>$1–2 per minute to $10–15 per minute</strong> — more
                  than HeyGen, not less.
                </p>
                <p>
                  What you gain: the prompt direction (tight framing, minimal
                  motion, the alt-angle shots) is actually enforced, plus finer
                  detail. At fast&apos;s CFG it is only weakly applied.
                </p>
                <p className="text-xs text-muted-foreground">
                  Those are estimates. The Cost dialog on a finished render
                  shows what your endpoint actually charged.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                setQuality.mutate({ quality: "full" });
                setConfirmFull(false);
              }}
            >
              Use full quality
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Admin: the provider ACCOUNTS for long-form video (`shared/accountPool.ts`). APIMART renders
 * b-roll clips and HeyGen lip-syncs the host; each is a list of accounts, and every new video
 * takes the least busy one — keys no longer belong to a tab. APIMART also has a dedicated key
 * for the Edit Images/Videos pages. Keys are stored encrypted; only the masked tail is ever
 * returned. Leaving a field empty and saving removes that account.
 */

/** Live balance/quota readout for a stored key; doubles as a health check. */
function BalanceBadge({
  keySet,
  value,
  error,
  outOfCredits,
  loading,
  format,
  lowThreshold,
}: {
  keySet: boolean;
  /** `null` ⇒ the check failed (or the key is unset). */
  value: number | null;
  /** Why the check failed, when the server said. An empty account is a VALUE of 0, never this. */
  error?: string;
  /** The provider refused the read because the quota is spent — the key itself is fine. */
  outOfCredits?: boolean;
  loading: boolean;
  format: (value: number) => string;
  lowThreshold: number;
}) {
  if (!keySet) return null;
  if (loading)
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin opacity-50" />;
  if (value == null)
    return (
      <span
        className="max-w-[24rem] shrink-0 truncate text-xs text-destructive"
        title={error}
      >
        {outOfCredits
          ? "out of credits"
          : `balance check failed${error ? ` — ${error}` : ""}`}
      </span>
    );
  return (
    <span
      className={`shrink-0 text-xs ${
        value < lowThreshold ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {format(value)}
    </span>
  );
}

/** An APIMART balance result (a reading, a failure with its reason, or nothing) as badge props. */
const apimartBadge = (
  balance:
    | { remainBalance: number }
    | { error: string; outOfCredits?: boolean }
    | null
    | undefined
): { value: number | null; error?: string; outOfCredits?: boolean } =>
  !balance
    ? { value: null }
    : "error" in balance
      ? {
          value: null,
          error: balance.error,
          outOfCredits: balance.outOfCredits,
        }
      : { value: balance.remainBalance };

/** One label / masked key field / Save-Clear button / badge row. */
function KeyRow({
  label,
  masked,
  placeholder,
  draft,
  onDraftChange,
  onSave,
  saving,
  badge,
}: {
  label: string;
  masked: string | null;
  placeholder: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: (apiKey: string) => void;
  saving: boolean;
  badge: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-sm text-muted-foreground">
        {label}
      </span>
      <Input
        type="password"
        autoComplete="off"
        placeholder={masked ?? placeholder}
        value={draft}
        onChange={e => onDraftChange(e.target.value)}
      />
      <Button
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => onSave(draft.trim())}
      >
        {masked && !draft.trim() ? "Clear" : "Save"}
      </Button>
      {badge}
    </div>
  );
}

/** "2 videos rendering" beside an account that is in use right now. */
function RenderingBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
      {count} video{count === 1 ? "" : "s"} rendering
    </span>
  );
}

/**
 * Which account rows to draw: every account that has a key, plus `extra` blank ones the admin
 * asked for with "Add account" (the lowest free numbers) — one blank row when there are none at
 * all, so an empty list still has somewhere to type.
 */
export function visibleAccounts<
  T extends { slotIndex: number; masked: string | null },
>(accounts: T[], extra: number): T[] {
  const withKey = accounts.filter(a => a.masked);
  const blank = accounts
    .filter(a => !a.masked)
    .slice(0, Math.max(extra, withKey.length ? 0 : 1));
  return [...withKey, ...blank].sort((a, b) => a.slotIndex - b.slotIndex);
}

function AddAccountButton({
  shown,
  total,
  onAdd,
}: {
  shown: number;
  total: number;
  onAdd: () => void;
}) {
  if (shown >= total) return null;
  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={onAdd}>
      <Plus className="h-3.5 w-3.5" />
      Add account
    </Button>
  );
}

export function ProviderKeys() {
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.longformVideo.getApimartKeys.useQuery();
  const { data: balances, isLoading: balancesLoading } =
    trpc.longformVideo.getApimartBalances.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });
  const { data: heygen, isLoading: heygenLoading } =
    trpc.longformVideo.getHeygenKeys.useQuery();
  const { data: quotas, isLoading: quotasLoading } =
    trpc.longformVideo.getHeygenQuotas.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });

  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editDraft, setEditDraft] = useState("");
  const [heygenDrafts, setHeygenDrafts] = useState<Record<number, string>>({});
  const [heygenTestDraft, setHeygenTestDraft] = useState("");
  // Blank rows opened with "Add account". Saving a key into one makes it a real account.
  const [apimartExtra, setApimartExtra] = useState(0);
  const [heygenExtra, setHeygenExtra] = useState(0);
  const apimartRows = visibleAccounts(data?.slots ?? [], apimartExtra);
  const heygenRows = visibleAccounts(heygen?.slots ?? [], heygenExtra);

  const saveMutation = trpc.longformVideo.setApimartKey.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(
        `APIMART Account ${vars.slotIndex + 1} ${vars.apiKey ? "saved" : "removed"}.`
      );
      setApimartExtra(0);
      setDrafts(d => ({ ...d, [vars.slotIndex]: "" }));
      utils.longformVideo.getApimartKeys.invalidate();
      utils.longformVideo.getApimartBalances.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  const saveEditMutation = trpc.longformVideo.setApimartEditKey.useMutation({
    onSuccess: () => {
      toast.success("APIMART key for the edit pages saved.");
      setEditDraft("");
      utils.longformVideo.getApimartKeys.invalidate();
      utils.longformVideo.getApimartBalances.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  const saveHeygenMutation = trpc.longformVideo.setHeygenKey.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(
        `HeyGen Account ${vars.slotIndex + 1} ${vars.apiKey ? "saved" : "removed"}.`
      );
      setHeygenExtra(0);
      setHeygenDrafts(d => ({ ...d, [vars.slotIndex]: "" }));
      utils.longformVideo.getHeygenKeys.invalidate();
      utils.longformVideo.getHeygenQuotas.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  const saveHeygenTestMutation =
    trpc.longformVideo.setHeygenTestKey.useMutation({
      onSuccess: () => {
        toast.success("HeyGen test key saved.");
        setHeygenTestDraft("");
        utils.longformVideo.getHeygenKeys.invalidate();
        utils.longformVideo.getHeygenQuotas.invalidate();
      },
      onError: err => toast.error(err.message ?? "Failed to save."),
    });

  // Drives the muted state on the HeyGen key rows below — they stay editable, they are just
  // no longer the live configuration while InfiniteTalk is the host provider.
  const { data: lipsync } = trpc.longformVideo.getLipsyncProvider.useQuery();
  const lipsyncOnRunpod = lipsync?.provider === "runpod";

  return (
    <div className="space-y-6">
      <MockModeToggle />
      <HostLipsyncToggle />
      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          APIMART accounts — b-roll
        </Label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {apimartRows.map(({ slotIndex, masked, rendering }) => (
              <KeyRow
                key={slotIndex}
                label={`Account ${slotIndex + 1}`}
                masked={masked}
                placeholder="Paste an APIMART key"
                draft={drafts[slotIndex] ?? ""}
                onDraftChange={value =>
                  setDrafts(d => ({ ...d, [slotIndex]: value }))
                }
                onSave={apiKey => saveMutation.mutate({ slotIndex, apiKey })}
                saving={saveMutation.isPending}
                badge={
                  <>
                    <BalanceBadge
                      keySet={!!masked}
                      {...apimartBadge(
                        balances?.slots.find(s => s.slotIndex === slotIndex)
                          ?.balance
                      )}
                      loading={balancesLoading}
                      format={v => `$${v.toFixed(2)} left`}
                      lowThreshold={5}
                    />
                    <RenderingBadge count={rendering} />
                  </>
                }
              />
            ))}
            <AddAccountButton
              shown={apimartRows.length}
              total={data?.slots.length ?? 0}
              onAdd={() => setApimartExtra(n => n + 1)}
            />
            <KeyRow
              label="Edit pages"
              masked={data?.editMasked ?? null}
              placeholder="Not set — edit pages disabled"
              draft={editDraft}
              onDraftChange={setEditDraft}
              onSave={apiKey => saveEditMutation.mutate({ apiKey })}
              saving={saveEditMutation.isPending}
              badge={
                <BalanceBadge
                  keySet={!!data?.editMasked}
                  {...apimartBadge(balances?.edit)}
                  loading={balancesLoading}
                  format={v => `$${v.toFixed(2)} left`}
                  lowThreshold={5}
                />
              }
            />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Every new video renders its b-roll on whichever account is least
          busy, and stays on it until it is done — more accounts means less
          waiting when several people render at once. Save a row empty to remove
          that account. The Edit Images/Videos pages are APIMART-only on their
          own key; blank ⇒ those pages can&apos;t generate.
        </p>
      </div>

      {/*
        Dimmed, not disabled, while host lip-sync runs on InfiniteTalk: the keys are still
        editable and are never cleared by the switch, so coming back to HeyGen needs no
        re-entry. The muting only stops these five fields reading as the live configuration.
      */}
      <div
        className={`space-y-3 ${lipsyncOnRunpod ? "opacity-60" : ""}`}
        aria-label={
          lipsyncOnRunpod ? "HeyGen keys (not currently in use)" : undefined
        }
      >
        <Label className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          HeyGen accounts — host lip-sync
          {lipsyncOnRunpod ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
              not in use — host lip-sync is on InfiniteTalk
            </span>
          ) : null}
        </Label>
        {heygenLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          heygenRows.map(({ slotIndex, masked, rendering }) => (
            <KeyRow
              key={slotIndex}
              label={`Account ${slotIndex + 1}`}
              masked={masked}
              placeholder="Paste a HeyGen key"
              draft={heygenDrafts[slotIndex] ?? ""}
              onDraftChange={value =>
                setHeygenDrafts(d => ({ ...d, [slotIndex]: value }))
              }
              onSave={apiKey =>
                saveHeygenMutation.mutate({ slotIndex, apiKey })
              }
              saving={saveHeygenMutation.isPending}
              badge={
                <>
                  <BalanceBadge
                    keySet={!!masked}
                    value={
                      quotas?.slots.find(s => s.slotIndex === slotIndex)
                        ?.quota ?? null
                    }
                    loading={quotasLoading}
                    format={v => `${Math.round(v)} credits left`}
                    lowThreshold={20}
                  />
                  <RenderingBadge count={rendering} />
                </>
              }
            />
          ))
        )}
        {!heygenLoading && (
          <AddAccountButton
            shown={heygenRows.length}
            total={heygen?.slots.length ?? 0}
            onAdd={() => setHeygenExtra(n => n + 1)}
          />
        )}
        <p className="text-xs text-muted-foreground">
          Every new video lip-syncs its host on whichever account is least
          busy. HeyGen caps concurrent renders per account, so each account
          added renders that much wider. With no account here, videos use the
          shared <code className="text-[11px]">HEYGEN_API_KEY</code>; with that
          unset too, host scenes fail loudly.
        </p>
        {!heygenLoading && (
          <div className="space-y-2 border-t border-border pt-3">
            <KeyRow
              label="Test"
              masked={heygen?.test ?? null}
              placeholder="Not set — the HeyGen test page uses the accounts above"
              draft={heygenTestDraft}
              onDraftChange={setHeygenTestDraft}
              onSave={apiKey => saveHeygenTestMutation.mutate({ apiKey })}
              saving={saveHeygenTestMutation.isPending}
              badge={
                <BalanceBadge
                  keySet={!!heygen?.test}
                  value={quotas?.test ?? null}
                  loading={quotasLoading}
                  format={v => `${Math.round(v)} credits left`}
                  lowThreshold={20}
                />
              }
            />
            <p className="text-xs text-muted-foreground">
              Used only by the HeyGen test page — films never touch it, so
              trying photos never spends a film account&apos;s credits. The test
              page picks it first; the accounts above stay there as a backup.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
