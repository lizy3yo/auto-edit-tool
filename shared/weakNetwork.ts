/**
 * What the page does differently on a weak connection — pure, so the rules are tested and the
 * poll, the player and the banner all answer from one place.
 */

/** A round trip slower than this is a weak connection; slower than `VERY_SLOW_MS`, a very weak one. */
export const SLOW_MS = 1500;
export const VERY_SLOW_MS = 4000;
/** The longest any poll waits, however slow the link — status must still move. */
export const MAX_POLL_MS = 10_000;

export type LinkQuality = "good" | "slow" | "verySlow";

/** How the connection is doing, judged on how long the last answer took to arrive. */
export function linkQuality(
  lastRoundTripMs: number | null,
  saveData = false
): LinkQuality {
  if (lastRoundTripMs !== null && lastRoundTripMs >= VERY_SLOW_MS)
    return "verySlow";
  if (saveData || (lastRoundTripMs !== null && lastRoundTripMs >= SLOW_MS))
    return "slow";
  return "good";
}

/**
 * How long to wait before asking again. A good connection keeps the interval it was given; a
 * weak one asks less often, so a poll never queues behind the one before it and the little
 * bandwidth there is goes to what the person is looking at.
 */
export function pollIntervalMs(baseMs: number, quality: LinkQuality): number {
  if (quality === "good") return baseMs;
  const stretched = baseMs * (quality === "slow" ? 2 : 3.5);
  return Math.max(baseMs, Math.min(MAX_POLL_MS, Math.round(stretched)));
}

/** The player's quality switch: `auto` is light on the page and full in full screen. */
export type VideoQuality = "auto" | "light" | "full";

/**
 * Which file the player plays. The light copy only ever stands in on the page; full screen
 * shows the film itself unless the person has asked for Data saver, and with no light copy
 * (not made yet, turned off) it is always the film.
 */
export function pickVideoSource(o: {
  mode: VideoQuality;
  fullscreen: boolean;
  full: string;
  light: string | null;
}): string {
  if (o.mode === "full" || !o.light) return o.full;
  if (o.mode === "light") return o.light;
  return o.fullscreen ? o.full : o.light;
}
