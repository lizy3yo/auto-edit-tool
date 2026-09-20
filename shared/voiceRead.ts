/**
 * How the master narration is sent to the TTS vendor — the "Voice read" pick on the generate
 * form, pinned to `inputParams.ttsReadMode` and read back by `voiceMasterNarration`.
 *
 * A TTS model decides rhythm, pitch and energy from what is inside ONE request, and every new
 * request starts cold. So the same script, voice and settings sound different depending on how
 * the text is cut up before it is sent:
 *
 *  - `auto`       — the pipeline decides (the pre-feature behaviour): one request, unless the
 *                   delivery plan changes the read, then one request per same-pace RUN.
 *  - `oneTake`    — always one request. The most consistent voice; the delivery plan's paces
 *                   and pauses are NOT applied to the voice (its mood/gesture cues still reach
 *                   the host), because one request has one speed.
 *  - `paragraphs` — one request per paragraph, each at its own pace from the delivery plan.
 *                   Closest pace control, but the voice restarts at every paragraph.
 *
 * In `shared/` so the form, the router's zod enum and the pipeline name the modes from one list.
 */
export const VOICE_READ_MODES = ["auto", "oneTake", "paragraphs"] as const;
export type VoiceReadMode = (typeof VOICE_READ_MODES)[number];

export const DEFAULT_VOICE_READ_MODE: VoiceReadMode = "auto";

export const VOICE_READ_LABELS: Record<VoiceReadMode, string> = {
  auto: "Auto",
  oneTake: "One take",
  paragraphs: "By paragraph",
};

export const VOICE_READ_HINTS: Record<VoiceReadMode, string> = {
  auto: "The tool decides: one continuous read, split into a few blocks only where the pace changes.",
  oneTake:
    "The whole script in one go — the most consistent voice, at one speed from start to finish.",
  paragraphs:
    "Each paragraph is voiced on its own, at its own pace. The voice can shift a little between paragraphs.",
};
