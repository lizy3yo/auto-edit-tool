import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { extractSpokenScript, stripCtaMarkerLines } from "@shared/ctaMarkers";
import type { LongformInputParams } from "@shared/types";
import {
  Check,
  Copy,
  Loader2,
  Upload,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";

export type DeliveryPlan = NonNullable<LongformInputParams["deliveryPlan"]>;

/**
 * "I'll supply the narration" — the operator-facing half of the manual-VO hatch.
 *
 * 69Labs is the only TTS lane in the app (`resolveTTSProvider` throws without it), while every
 * other lane — APIMART b-roll, gpt-image-2 stills, HeyGen/RunPod host, assembly — is independent
 * of it. So when that vendor is unreachable, one supplied mp3 is the difference between no film
 * and a complete render.
 *
 * Four things have to be on screen, and the order is the order the work happens in:
 *
 *  1. The EXACT text to read, with a copy button. Not a convenience: scene boundaries are
 *     recovered by locating each scene's text inside a transcript of this audio, so the operator
 *     must voice the marker-stripped script — not the raw field, whose `===START CTA===` lines
 *     would be read aloud as words.
 *  2. The DELIVERY DIRECTION, fetched before recording and pinned onto the job. On an automatic
 *     render the voice and the host's body come from one plan and agree by construction; a
 *     supplied read breaks that, because the pipeline would otherwise plan afterwards and direct
 *     the host's face over a read that ignored it. See `planDelivery` in the router.
 *  3. The VOICE SETTINGS the pipeline would have used, so the read can be matched. Deliberately
 *     copied SEPARATELY from the script — a single blob pasted into a TTS text box would speak
 *     "Stability: 0.5" into the master, which is the `===START CTA===` failure with nothing
 *     downstream to catch it.
 *  4. The verdict, which is a real check and not a formality — see `verifyNarration`.
 */
export function LongformNarrationUpload({
  script,
  channelKey,
  value,
  onChange,
  deliveryPlan,
  onDeliveryPlanChange,
  voice,
  vendor,
  onVendorChange,
  disabled,
  /** Rescue mode (a failed job): the caller owns the "start it" action, so no runbook step 5. */
  compact,
}: {
  script: string;
  channelKey: string;
  /** The verified narration URL, or undefined while none is accepted. */
  value: string | undefined;
  onChange: (url: string | undefined) => void;
  deliveryPlan?: DeliveryPlan;
  onDeliveryPlanChange?: (plan: DeliveryPlan | undefined) => void;
  /** The channel's voice dials, shown so the operator can match them in their own TTS tool. */
  voice?: {
    voiceName?: string | null;
    voiceId?: string | null;
    ttsModel?: string | null;
    ttsSpeed?: string | null;
  };
  /** Which vendor voices this film. Undefined ⇒ the channel's default (69Labs). */
  vendor?: "sixtynine_labs" | "minimax";
  onVendorChange?: (v: "sixtynine_labs" | "minimax" | undefined) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [on, setOn] = useState(!!compact);
  const [busy, setBusy] = useState<null | "uploading" | "checking">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<null | "script" | "settings">(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const verify = trpc.longformVideo.verifyNarration.useMutation();
  const plan = trpc.longformVideo.planDelivery.useMutation();
  // Two independent halves — an account-wide key and a per-channel voice — configured on two
  // different Admin screens. The option names whichever is missing rather than just greying out,
  // so an operator is sent to the right screen instead of guessing.
  const mm = trpc.provider.minimaxStatus.useQuery(
    { channelKey },
    { enabled: !compact && !!channelKey }
  );

  // The CTA marker LINES are instructions to the pipeline, not speech — the narration is voiced
  // from the script with them removed. Showing them here would have an operator read
  // "equals equals equals CTA" into the master, which is the exact failure the copy box exists
  // to prevent.
  const spoken = stripCtaMarkerLines(extractSpokenScript(script));
  const words = spoken.split(/\s+/).filter(Boolean).length;
  const paragraphs = spoken.split(/\n\s*\n/).filter(p => p.trim());

  // Tuned as a SET (`scripts/voice-settings-test.ts`) — see the constants in longformVideo.ts.
  // Mirrored here rather than fetched: they are compile-time constants on the server too, and a
  // round trip to read three numbers would be its own failure mode on the one screen an
  // operator reaches BECAUSE something else is already down.
  const settingsText = [
    `Voice: ${voice?.voiceName || voice?.voiceId || "(the channel's voice)"}`,
    `Model: ${voice?.ttsModel || "eleven_multilingual_v2"}`,
    `Speed: ${voice?.ttsSpeed || "1.0"}`,
    `Stability: 0.5`,
    `Style: 0.3`,
    `Similarity: 0.8`,
  ].join("\n");

  const copy = async (text: string, which: "script" | "settings") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy — select the text and copy it manually.");
    }
  };

  const clear = useCallback(() => {
    onChange(undefined);
    setError(null);
    setNote(null);
    if (fileRef.current) fileRef.current.value = "";
  }, [onChange]);

  // A verdict — and a delivery plan — are about ONE script. Editing the script after either was
  // settled would leave them standing over text nobody read, and the mismatch surfaces as
  // silently approximate scene timings rather than as an error. Drop both and say so.
  const settledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!value && !deliveryPlan) return;
    if (settledFor.current === null || settledFor.current === spoken) return;
    clear();
    onDeliveryPlanChange?.(undefined);
    setPlanNote(null);
    setError(
      "The script changed after this recording was checked — upload it again (and re-fetch the " +
        "direction) so the timings are cut from the words that will actually be rendered."
    );
  }, [spoken, value, deliveryPlan, clear, onDeliveryPlanChange]);

  const fetchPlan = async () => {
    setPlanNote(null);
    try {
      const r = await plan.mutateAsync({ script, channelKey });
      if (!r.plan) {
        // Not an error: the pipeline treats a missing plan as "one speed, no cues", which is
        // exactly the pre-feature behaviour. Say so instead of blocking the upload.
        setPlanNote(
          "No direction came back — read it naturally. The render will direct the host the same way."
        );
        onDeliveryPlanChange?.(undefined);
        return;
      }
      settledFor.current = spoken;
      onDeliveryPlanChange?.(r.plan as DeliveryPlan);
    } catch (e: any) {
      setPlanNote(`Could not fetch the direction (${e?.message ?? e}).`);
    }
  };

  const handleFile = async (file: File) => {
    setError(null);
    setNote(null);
    onChange(undefined);
    try {
      // Raw bytes, not base64 through tRPC: a 20-minute narration is ~29 MB, and encoding it
      // would push a JSON body past the server's 50 MB cap for no benefit.
      setBusy("uploading");
      const resp = await fetch("/api/narration-upload", {
        method: "POST",
        headers: { "Content-Type": file.type || "audio/mpeg" },
        body: file,
        credentials: "include",
      });
      const body = await resp.json().catch(() => ({}) as any);
      if (!resp.ok)
        throw new Error(body?.error || `Upload failed (${resp.status})`);

      setBusy("checking");
      const verdict = await verify.mutateAsync({
        url: body.url,
        script,
        channelKey,
      });

      if (verdict.ok) {
        settledFor.current = spoken;
        onChange(body.url);
        setNote(
          `Matched ${Math.round(verdict.coverage * 100)}% of the script — ready to generate.`
        );
        return;
      }
      // An unverified upload is not a rejected one: transcription is a separate paid service and
      // its outage says nothing about the read. Accept it, and say plainly what was not checked.
      if (verdict.unverified) {
        settledFor.current = spoken;
        onChange(body.url);
        setNote(
          `${verdict.reason} The recording was accepted unchecked — if it is not a faithful read ` +
            `of this script, scene timings will be approximate.`
        );
        return;
      }
      setError(
        [
          verdict.reason,
          verdict.expected && `Script says: “…${verdict.expected}…”`,
          verdict.heard && `Recording says: “…${verdict.heard}…”`,
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const panel = (
    <div className="space-y-3 rounded-md border border-border bg-muted/50 p-3">
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>Copy the script below — not the box in Step 1.</li>
        <li>Fetch the delivery direction and read to it.</li>
        <li>
          Make ONE mp3 of the whole script in any TTS tool, matching the voice
          settings.
        </li>
        <li>Upload it here and wait for the check.</li>
        {!compact && <li>Generate as normal.</li>}
      </ol>

      {/* ── 1. the words ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            Read exactly this ({words.toLocaleString()} words)
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => copy(spoken, "script")}
            disabled={!spoken.trim()}
          >
            {copied === "script" ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied === "script" ? "Copied" : "Copy script"}
          </Button>
        </div>
        {/* Read-only rather than a plain <p>: the operator needs to be able to select it,
            and it must be impossible to edit here — the text is checked against the script
            that will actually be rendered. */}
        <Textarea
          readOnly
          value={spoken}
          rows={4}
          className="resize-none bg-background font-mono text-xs"
        />
      </div>

      {/* ── 2. how to say it ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">Delivery direction</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={fetchPlan}
            disabled={
              disabled || plan.isPending || !spoken.trim() || !channelKey
            }
          >
            {plan.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {plan.isPending
              ? "Reading the script…"
              : deliveryPlan
                ? "Re-fetch"
                : "Get direction"}
          </Button>
        </div>
        {deliveryPlan ? (
          <>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-background p-2">
              {deliveryPlan.paragraphs.map(p => (
                <div key={p.index} className="flex gap-2 text-xs">
                  <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                    ¶{p.index + 1}
                  </span>
                  <span className="w-16 shrink-0 font-medium">{p.pace}</span>
                  <span className="flex-1 text-muted-foreground">
                    {p.mood || "—"}
                    {p.pauseAfterMs > 0 && (
                      <span className="ml-1 tabular-nums">
                        · pause {p.pauseAfterMs} ms after
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Pinned to this render — the host&rsquo;s face and body will be
              directed by this same plan, so your read and her expression agree.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {planNote ??
              `How each of the ${paragraphs.length} paragraph${
                paragraphs.length === 1 ? "" : "s"
              } should be read — and the cues the host's face and body will follow. ` +
                `Fetch it before recording so the two match.`}
          </p>
        )}
      </div>

      {/* ── 3. the dials ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            Voice settings this render would have used
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => copy(settingsText, "settings")}
          >
            {copied === "settings" ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied === "settings" ? "Copied" : "Copy settings"}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-md bg-background p-2 font-mono text-xs text-muted-foreground">
          {settingsText}
        </pre>
      </div>

      {/* ── 4. the file ── */}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {value ? (
        <div className="flex items-center gap-2 text-xs text-success">
          <Check className="h-4 w-4 shrink-0" />
          <span className="flex-1">{note ?? "Narration ready."}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={disabled}
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy !== null || !spoken.trim() || !channelKey}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {busy === "uploading"
            ? "Uploading…"
            : busy === "checking"
              ? "Checking the read against the script…"
              : "Choose audio file"}
        </Button>
      )}

      {note && !value && (
        <p className="text-xs text-muted-foreground">{note}</p>
      )}

      {error && (
        <div className="flex gap-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p className="whitespace-pre-line">{error}</p>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        One file for the whole script, read start to finish — every
        scene&rsquo;s audio is cut from it automatically. Prefer a TTS export
        over a microphone: cleaner word timings cut cleaner scene boundaries.
        MP3, WAV, M4A, FLAC, OGG or Opus.
      </p>
    </div>
  );

  // Rescue mode is reached BECAUSE the render already failed to voice itself — there is nothing
  // to opt into, so a chooser would only be a click between the operator and the fix.
  if (compact) return panel;

  const mmUnavailable = !mm.data?.keySet
    ? "no MiniMax API key — add one in Admin → Provider Keys"
    : !mm.data?.voiceSet
      ? "this channel has no MiniMax voice — set one in Admin → Channels"
      : null;

  const Choice = ({
    id,
    label,
    hint,
    checked,
    onSelect,
    disabled: off,
  }: {
    id: string;
    label: string;
    hint: string;
    checked: boolean;
    onSelect: () => void;
    disabled?: boolean;
  }) => (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-2 ${
        off ? "cursor-not-allowed opacity-60" : ""
      }`}
    >
      <input
        id={id}
        type="radio"
        name="narration-source"
        className="mt-0.5"
        checked={checked}
        disabled={disabled || off}
        onChange={onSelect}
      />
      <span className="text-sm leading-tight">
        {label}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Narration
        </span>
        <Choice
          id="vo-default"
          label="Use the channel voice"
          hint={
            voice?.voiceName || voice?.voiceId || "the channel's 69Labs voice"
          }
          checked={!on && vendor !== "minimax"}
          onSelect={() => {
            setOn(false);
            clear();
            onDeliveryPlanChange?.(undefined);
            onVendorChange?.(undefined);
          }}
        />
        <Choice
          id="vo-minimax"
          label="Voice it on MiniMax"
          hint={
            mmUnavailable ??
            `fallback voice${mm.data?.voiceName ? ` — ${mm.data.voiceName}` : ""}`
          }
          checked={!on && vendor === "minimax"}
          disabled={!!mmUnavailable}
          onSelect={() => {
            setOn(false);
            clear();
            onDeliveryPlanChange?.(undefined);
            onVendorChange?.("minimax");
          }}
        />
        <Choice
          id="vo-manual"
          label="I'll supply the narration"
          hint="upload your own audio, made anywhere"
          checked={on}
          onSelect={() => {
            setOn(true);
            // A supplied master is not voiced by any vendor — leaving a pin set would make
            // `resolveTTSVendor` demand credentials for a lane this render never touches.
            onVendorChange?.(undefined);
          }}
        />
      </div>
      {on && panel}
    </div>
  );
}
