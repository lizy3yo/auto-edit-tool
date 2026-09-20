import {
  VOICE_READ_HINTS,
  VOICE_READ_LABELS,
  VOICE_READ_MODES,
  type VoiceReadMode,
} from "@shared/voiceRead";

/**
 * "Voice read" — how the script is sent to the TTS vendor (`shared/voiceRead.ts`).
 *
 * The same script, voice and settings sound different depending on how the text is cut up
 * before it is voiced: a TTS model sets its rhythm and energy from what is inside one request,
 * and every new request starts cold. Auto is the pre-feature behaviour, so a form nobody touches
 * renders exactly as it always did.
 */
export function LongformVoiceRead({
  value,
  onChange,
  disabled,
}: {
  value: VoiceReadMode;
  onChange: (mode: VoiceReadMode) => void;
  disabled?: boolean;
}) {
  const tab = (on: boolean) =>
    `rounded px-3 py-1 text-xs transition-colors disabled:opacity-60 ${
      on
        ? "bg-secondary font-medium text-secondary-foreground"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-2">
      <span className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Voice read
      </span>
      <div
        role="group"
        aria-label="Voice read"
        className="inline-flex rounded-md border border-border p-0.5"
      >
        {VOICE_READ_MODES.map(m => (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m)}
            aria-pressed={value === m}
            className={tab(value === m)}
          >
            {VOICE_READ_LABELS[m]}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{VOICE_READ_HINTS[value]}</p>
    </div>
  );
}
