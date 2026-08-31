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
import { Loader2, KeyRound, FlaskConical, Mic } from "lucide-react";
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

  const provider = data?.provider ?? "heygen";
  const quality = data?.quality ?? "fast";
  const onRunpod = provider === "runpod";
  const ready = data?.runpod.ready ?? false;
  const busy = isLoading || setProvider.isPending || setQuality.isPending;
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
              : "1080p, per-tab accounts, billed per second of finished video."}
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
                : "Cheapest tier. Prompt direction is only weakly applied at this step count."}
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
 * Admin: per-tab provider keys for long-form video. Each of the 5 video tabs (slots 0–4)
 * renders its b-roll on its own APIMART account and lip-syncs its host on its own HeyGen
 * account; APIMART also has a dedicated key for the Edit Images/Videos pages. Keys are stored
 * encrypted; only the masked tail is ever returned. Leaving a field empty and saving clears
 * that slot.
 */

/** Live balance/quota readout for a stored key; doubles as a health check. */
function BalanceBadge({
  keySet,
  value,
  loading,
  format,
  lowThreshold,
}: {
  keySet: boolean;
  /** `null` ⇒ the check failed (or the key is unset). */
  value: number | null;
  loading: boolean;
  format: (value: number) => string;
  lowThreshold: number;
}) {
  if (!keySet) return null;
  if (loading)
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin opacity-50" />;
  if (value == null)
    return (
      <span className="shrink-0 text-xs text-destructive">
        balance check failed
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
      <span className="w-20 shrink-0 text-sm text-muted-foreground">
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
  // AIREITER BOLT-ON (temporary) — delete with the section below.
  const { data: aireiter, isLoading: aireiterLoading } =
    trpc.longformVideo.getAireiter.useQuery();
  const { data: aireiterBal, isLoading: aireiterBalLoading } =
    trpc.longformVideo.getAireiterBalance.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });
  const [aireiterDraft, setAireiterDraft] = useState("");

  const saveMutation = trpc.longformVideo.setApimartKey.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(`APIMART key for Video ${vars.slotIndex + 1} saved.`);
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
      toast.success(`HeyGen key for Video ${vars.slotIndex + 1} saved.`);
      setHeygenDrafts(d => ({ ...d, [vars.slotIndex]: "" }));
      utils.longformVideo.getHeygenKeys.invalidate();
      utils.longformVideo.getHeygenQuotas.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  // AIREITER BOLT-ON (temporary) — delete with the section below.
  const saveAireiterMutation = trpc.longformVideo.setAireiterKey.useMutation({
    onSuccess: () => {
      toast.success("AIReiter key saved.");
      setAireiterDraft("");
      utils.longformVideo.getAireiter.invalidate();
      utils.longformVideo.getAireiterBalance.invalidate();
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
          APIMART keys — b-roll (per tab)
        </Label>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {data?.slots.map(({ slotIndex, masked }) => (
              <KeyRow
                key={slotIndex}
                label={`Video ${slotIndex + 1}`}
                masked={masked}
                placeholder="Not set — uses 69Labs"
                draft={drafts[slotIndex] ?? ""}
                onDraftChange={value =>
                  setDrafts(d => ({ ...d, [slotIndex]: value }))
                }
                onSave={apiKey => saveMutation.mutate({ slotIndex, apiKey })}
                saving={saveMutation.isPending}
                badge={
                  <BalanceBadge
                    keySet={!!masked}
                    value={
                      balances?.slots.find(s => s.slotIndex === slotIndex)
                        ?.balance?.remainBalance ?? null
                    }
                    loading={balancesLoading}
                    format={v => `$${v.toFixed(2)} left`}
                    lowThreshold={5}
                  />
                }
              />
            ))}
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
                  value={balances?.edit?.remainBalance ?? null}
                  loading={balancesLoading}
                  format={v => `$${v.toFixed(2)} left`}
                  lowThreshold={5}
                />
              }
            />
          </>
        )}
        <p className="text-xs text-muted-foreground">
          Each long-form tab renders b-roll on its own APIMART account. Blank ⇒
          that tab uses 69Labs. The Edit Images/Videos pages are APIMART-only on
          their own key; blank ⇒ those pages can&apos;t generate.
        </p>
        {aireiter?.lanes.broll && (
          <p className="text-xs text-warning">
            Overridden — b-roll is currently rendering on AIReiter (below), so
            these APIMART keys are not being billed.
          </p>
        )}
      </div>

      {/* ─── AIREITER BOLT-ON (temporary) — delete this whole section ─── */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          AIReiter key — b-roll + stills (all tabs)
        </Label>
        {aireiterLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <KeyRow
            label="AIReiter"
            masked={aireiter?.masked ?? null}
            placeholder={
              aireiter?.usingEnvKey
                ? "Using AIREITER_API_KEY from .env"
                : "Not set — b-roll/stills stay on APIMART/OpenAI"
            }
            draft={aireiterDraft}
            onDraftChange={setAireiterDraft}
            onSave={apiKey => saveAireiterMutation.mutate({ apiKey })}
            saving={saveAireiterMutation.isPending}
            badge={
              <BalanceBadge
                keySet={!!aireiter?.masked || !!aireiter?.usingEnvKey}
                value={aireiterBal?.credits ?? null}
                loading={aireiterBalLoading}
                format={v => `${Math.round(v)} credits left`}
                lowThreshold={200}
              />
            }
          />
        )}
        <p className="text-xs text-muted-foreground">
          One key for all 5 tabs — AIReiter is a single account with one shared
          credit pool. Which lanes it takes over is set by{" "}
          <code className="text-[11px]">AIREITER_LANES</code> in{" "}
          <code className="text-[11px]">.env</code> (
          <code className="text-[11px]">broll</code>,{" "}
          <code className="text-[11px]">stills</code>, or{" "}
          <code className="text-[11px]">all</code>); a key entered here wins
          over <code className="text-[11px]">AIREITER_API_KEY</code>. AIReiter
          has no lip-sync and no TTS, so host scenes and narration are never
          affected.
        </p>
        <p className="text-xs">
          {aireiter?.lanes.broll || aireiter?.lanes.stills ? (
            <span className="text-success">
              Active on: {aireiter.lanes.broll ? "b-roll" : ""}
              {aireiter.lanes.broll && aireiter.lanes.stills ? " + " : ""}
              {aireiter.lanes.stills ? "stills/keyframes" : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Inactive — set AIREITER_LANES to route work here.
            </span>
          )}
        </p>
      </div>
      {/* ─── END AIREITER BOLT-ON ─── */}

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
          HeyGen keys — host lip-sync (per tab)
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
          heygen?.slots.map(({ slotIndex, masked }) => (
            <KeyRow
              key={slotIndex}
              label={`Video ${slotIndex + 1}`}
              masked={masked}
              placeholder="Not set — uses shared HEYGEN_API_KEY"
              draft={heygenDrafts[slotIndex] ?? ""}
              onDraftChange={value =>
                setHeygenDrafts(d => ({ ...d, [slotIndex]: value }))
              }
              onSave={apiKey =>
                saveHeygenMutation.mutate({ slotIndex, apiKey })
              }
              saving={saveHeygenMutation.isPending}
              badge={
                <BalanceBadge
                  keySet={!!masked}
                  value={
                    quotas?.slots.find(s => s.slotIndex === slotIndex)?.quota ??
                    null
                  }
                  loading={quotasLoading}
                  format={v => `${Math.round(v)} credits left`}
                  lowThreshold={20}
                />
              }
            />
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Each long-form tab lip-syncs its host on its own HeyGen account —
          HeyGen caps concurrent renders per account, so 5 accounts render 5×
          wider. Blank ⇒ that tab uses the shared{" "}
          <code className="text-[11px]">HEYGEN_API_KEY</code>; with that unset
          too, host scenes fail loudly.
        </p>
      </div>
    </div>
  );
}
