// Sound + OS notification for long-running job completion.
// ponytail: chime is synthesized via Web Audio so there's no asset to bundle.
// Upgrade path: swap chime() for `new Audio("/sounds/chime.mp3").play()` if a
// richer sound is wanted.

let ctx: AudioContext | null = null;

/**
 * Call from a user gesture (e.g. the Generate click). Resumes a shared
 * AudioContext so the chime can play later even from a backgrounded tab, and
 * requests OS notification permission once. No-op if either is unavailable.
 */
export function armNotifications(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    void ctx.resume();
  } catch {
    ctx = null;
  }
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // notifications unsupported — ignore
  }
}

function chime(ok: boolean): void {
  if (!ctx) return;
  const now = ctx.currentTime;
  // success: rising two-note; failure: single low tone
  const notes = ok ? [660, 880] : [220];
  for (let i = 0; i < notes.length; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = notes[i];
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }
}

/** Play the completion chime and, if permitted, show an OS notification. */
export function notifyJobDone(label: string, ok: boolean): void {
  chime(ok);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(ok ? `${label} is ready` : `${label} failed`, {
        body: ok
          ? "Your long-form video finished rendering."
          : "The job ended with an error.",
        tag: label, // dedupe repeats for the same slot
      });
    }
  } catch {
    // notification construction failed — ignore
  }
}
