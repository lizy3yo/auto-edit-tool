import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, KeyRound, FlaskConical } from "lucide-react";
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
          enabled ? "border-amber-500/60 bg-amber-500/10" : "border-border"
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

/**
 * Liveness readout for a stored fal key. fal exposes no credit-balance API (billing lives
 * behind the dashboard session), so unlike `BalanceBadge` there is no number to show — only
 * whether the key authenticates.
 */
function HealthBadge({
  keySet,
  ok,
  loading,
}: {
  keySet: boolean;
  /** `null` ⇒ the probe itself failed — unknown, not invalid. */
  ok: boolean | null;
  loading: boolean;
}) {
  if (!keySet) return null;
  if (loading)
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin opacity-50" />;
  if (ok == null)
    return (
      <span className="shrink-0 text-xs text-muted-foreground">unknown</span>
    );
  return (
    <span
      className={`shrink-0 text-xs ${ok ? "text-muted-foreground" : "text-destructive"}`}
    >
      {ok ? "key ok" : "key rejected"}
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
  const { data: fal, isLoading: falLoading } =
    trpc.longformVideo.getFalKeys.useQuery();
  const { data: falHealth, isLoading: falHealthLoading } =
    trpc.longformVideo.getFalKeyHealth.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });

  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [editDraft, setEditDraft] = useState("");
  const [heygenDrafts, setHeygenDrafts] = useState<Record<number, string>>({});
  const [falDrafts, setFalDrafts] = useState<Record<number, string>>({});
  const { data: ws, isLoading: wsLoading } =
    trpc.longformVideo.getWavespeedKeys.useQuery();
  const { data: wsHealth, isLoading: wsHealthLoading } =
    trpc.longformVideo.getWavespeedKeyHealth.useQuery(undefined, {
      refetchOnWindowFocus: false,
    });
  const [wsDrafts, setWsDrafts] = useState<Record<number, string>>({});
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

  const saveWsMutation = trpc.longformVideo.setWavespeedKey.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(`WaveSpeed key for Video ${vars.slotIndex + 1} saved.`);
      setWsDrafts(d => ({ ...d, [vars.slotIndex]: "" }));
      utils.longformVideo.getWavespeedKeys.invalidate();
      utils.longformVideo.getWavespeedKeyHealth.invalidate();
    },
    onError: err => toast.error(err.message ?? "Failed to save."),
  });

  const saveFalMutation = trpc.longformVideo.setFalKey.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(`fal.ai key for Video ${vars.slotIndex + 1} saved.`);
      setFalDrafts(d => ({ ...d, [vars.slotIndex]: "" }));
      utils.longformVideo.getFalKeys.invalidate();
      utils.longformVideo.getFalKeyHealth.invalidate();
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

  return (
    <div className="space-y-6">
      <MockModeToggle />
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
          <p className="text-xs text-amber-500">
            Overridden — b-roll is currently rendering on AIReiter (below), so
            these APIMART keys are not being billed.
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          WaveSpeed keys — InfiniteTalk lip-sync (per tab)
          {ws?.active && (
            <span className="text-xs font-normal text-muted-foreground">
              · active lane
            </span>
          )}
        </Label>
        {wsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          ws?.slots.map(({ slotIndex, masked }) => (
            <KeyRow
              key={slotIndex}
              label={`Video ${slotIndex + 1}`}
              masked={masked}
              placeholder="Not set — uses shared WAVESPEED_API_KEY"
              draft={wsDrafts[slotIndex] ?? ""}
              onDraftChange={value =>
                setWsDrafts(d => ({ ...d, [slotIndex]: value }))
              }
              onSave={apiKey => saveWsMutation.mutate({ slotIndex, apiKey })}
              saving={saveWsMutation.isPending}
              badge={
                <HealthBadge
                  keySet={!!masked}
                  ok={
                    wsHealth?.slots.find(s => s.slotIndex === slotIndex)?.ok ??
                    null
                  }
                  loading={wsHealthLoading}
                />
              }
            />
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Used only when{" "}
          <code className="text-[11px]">LIPSYNC_PROVIDER=wavespeed</code> —
          rendering host scenes on InfiniteTalk at{" "}
          <code className="text-[11px]">{ws?.resolution ?? "720p"}</code> (its
          ceiling; assembly upscales to 1080p). Takes up to 10 minutes of audio
          per render, so no scene-length cap is needed. Blank ⇒ that tab uses
          the shared <code className="text-[11px]">WAVESPEED_API_KEY</code>.
        </p>
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
            <span className="text-emerald-500">
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

      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          HeyGen keys — host lip-sync (per tab)
          {fal && !fal.active && (
            <span className="text-xs font-normal text-muted-foreground">
              · active lane
            </span>
          )}
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

      <div className="space-y-3">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4" />
          fal.ai keys — host lip-sync alternative (per tab)
          {fal?.active && (
            <span className="text-xs font-normal text-muted-foreground">
              · active lane
            </span>
          )}
        </Label>
        {falLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          fal?.slots.map(({ slotIndex, masked }) => (
            <KeyRow
              key={slotIndex}
              label={`Video ${slotIndex + 1}`}
              masked={masked}
              placeholder="Not set — uses shared FAL_API_KEY"
              draft={falDrafts[slotIndex] ?? ""}
              onDraftChange={value =>
                setFalDrafts(d => ({ ...d, [slotIndex]: value }))
              }
              onSave={apiKey => saveFalMutation.mutate({ slotIndex, apiKey })}
              saving={saveFalMutation.isPending}
              badge={
                <HealthBadge
                  keySet={!!masked}
                  ok={
                    falHealth?.slots.find(s => s.slotIndex === slotIndex)?.ok ??
                    null
                  }
                  loading={falHealthLoading}
                />
              }
            />
          ))
        )}
        <p className="text-xs text-muted-foreground">
          Used only when{" "}
          <code className="text-[11px]">LIPSYNC_PROVIDER=fal</code> — rendering
          host scenes on{" "}
          <code className="text-[11px]">{fal?.model ?? "fal.ai"}</code> instead
          of HeyGen Avatar IV. Blank ⇒ that tab uses the shared{" "}
          <code className="text-[11px]">FAL_API_KEY</code>. fal has no
          credit-balance API, so the badge is a liveness probe, not a balance.
        </p>
      </div>
    </div>
  );
}
