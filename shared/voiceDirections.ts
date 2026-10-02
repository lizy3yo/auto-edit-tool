/**
 * shared/voiceDirections.ts
 *
 * Voice DIRECTIONS — `[laughs]`, `[sighs]`, `[whispers]`, `[warmly]` — typed into a script where
 * the host should do them. ElevenLabs v3/v4 act a bracketed direction out instead of reading it;
 * every older model, and the MiniMax engine behind 69Labs account clones, reads it ALOUD.
 *
 * So a script carries two copies from the moment it is read:
 *   - the CLEAN copy (`stripVoiceDirections`) — what every step but the voice sees: storyboard,
 *     alignment, the "voice says every word" check, scene text, captions, the shot list. A
 *     direction there is a word nobody says, and the skip check would stop the film over it.
 *     `parseCtaMarkers` and `stripCtaMarkerLines` return this copy, so every existing reader of
 *     a script gets it without knowing directions exist.
 *   - the DIRECTED copy (`directedSpokenScript` in ctaMarkers.ts) — handed to the voice, and only
 *     when `modelTakesDirections` and the voice is an ElevenLabs one (`directionsBlockedBy`).
 *
 * The two must split into the SAME paragraphs: the delivery plan voices the master paragraph by
 * paragraph, indexing one copy's plan into the other. `attachLoneDirections` keeps that true for
 * a direction typed on a line of its own.
 *
 * Pure string work, no imports — bundles into the client for free.
 */

/** One direction: square brackets around a short run of text on one line. */
const DIRECTION = /\[[^[\]\n]{1,80}\]/g;

/** The directions in a text, in order, brackets included. */
export function voiceDirectionsIn(text: string): string[] {
  return text.match(DIRECTION) ?? [];
}

/**
 * The text with every direction removed and the spacing it leaves tidied ("back. [sighs] It's"
 * → "back. It's", "boards, [chuckles] and" → "boards, and"). A line that held only directions is
 * removed outright, so it never splits its paragraph in two; the blank-line runs that leaves are
 * squeezed back to one paragraph break. Lines without a direction are returned byte for byte.
 */
export function stripVoiceDirections(text: string): string {
  if (!text.includes("[")) return text;
  let removed = false;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    DIRECTION.lastIndex = 0;
    if (!DIRECTION.test(line)) {
      lines.push(line);
      continue;
    }
    const cleaned = line
      .replace(DIRECTION, " ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +([.,!?;:])/g, "$1")
      .trim();
    if (cleaned) lines.push(cleaned);
    else removed = true;
  }
  const out = lines.join("\n");
  return removed ? out.replace(/\n{3,}/g, "\n\n") : out;
}

/**
 * A paragraph made only of directions is joined onto the start of the next paragraph (or the
 * end of the previous one, when it is last), so the directed copy splits into exactly the
 * paragraphs the clean copy does. "A\n\n[laughs]\n\nB" → "A\n\n[laughs] B".
 */
export function attachLoneDirections(text: string): string {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let carry = "";
  for (const p of paras) {
    if (!p.trim()) continue;
    if (!stripVoiceDirections(p).trim()) {
      carry = carry ? `${carry} ${p.trim()}` : p.trim();
      continue;
    }
    out.push(carry ? `${carry} ${p.trimStart()}` : p);
    carry = "";
  }
  if (carry) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${carry}`;
    else out.push(carry);
  }
  return out.join("\n\n");
}

const UUID_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which 69Labs voice space an id lives in, by its shape alone: an account clone has a UUID id,
 * an ElevenLabs library voice a 20-character one. The server confirms against the account's
 * clone list (`voiceSpace69Labs`); the shape is the fallback, and all the browser has.
 */
export function voiceSpaceByShape(voiceId: string): "clone" | "library" {
  return UUID_ID.test(voiceId.trim()) ? "clone" : "library";
}

/** ElevenLabs models that act directions out (v3 and v4, every variant). */
export function modelTakesDirections(model: string | null | undefined): boolean {
  return /^eleven_v[34](_|$)/.test((model ?? "").trim());
}

/**
 * Why a voice cannot act directions out, in words for a job warning — or null when it can.
 * `voiceSpace` is the 69Labs voice space: an account clone runs on MiniMax whatever model is
 * asked for, so it would read every direction aloud.
 */
export function directionsBlockedBy(opts: {
  vendor: "69labs" | "minimax";
  model: string | null | undefined;
  voiceSpace: "clone" | "library";
}): string | null {
  if (opts.vendor === "minimax")
    return "this film is voiced on MiniMax, which reads directions aloud";
  if (opts.voiceSpace === "clone")
    return "this channel's voice is a 69Labs clone, which runs on MiniMax and reads directions aloud";
  if (!modelTakesDirections(opts.model))
    return `this channel's voice model is ${opts.model || "eleven_multilingual_v2"}; directions need eleven_v4`;
  return null;
}
