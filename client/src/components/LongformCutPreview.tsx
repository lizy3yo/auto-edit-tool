import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Film, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FPS,
  planMasterOverlayScenes,
  planScenePieces,
  sceneHoldPlan,
} from "@shared/filmTimeline";
import type { StoryboardScene } from "@shared/types";

/**
 * The whole film, previewed in the browser with NO assembly.
 *
 * WHY. Every edit an operator makes to a rendered job — a trim, a slip, a moved cut, a hold, a
 * regenerated shot — is a metadata write. Seeing it meant clicking Reassemble and waiting for
 * the server to re-encode ~100 scenes and re-upload the finished MP4: the whole edit loop spent
 * waiting on ffmpeg for a change the operator wants to judge in two seconds.
 *
 * But the browser already holds everything the cut is made of — each scene's rendered clip on
 * R2, the continuous master narration, and the storyboard's own timings — so it can just play
 * them. Two `<video>` elements ping-pong (one on screen, one pre-seeking the next beat) so a cut
 * doesn't stall on a cold buffer, and the master narration plays underneath.
 *
 * THE TIMELINE IS THE RENDERER'S. `planMasterOverlayScenes` and `planScenePieces` are imported
 * from `shared/filmTimeline.ts` — literally the functions assembly runs — so what plays here is
 * what Reassemble produces:
 *  - the preview clock is FILM time, not master time, because assembly splices silence into the
 *    narration wherever a scene freezes past its words (a hold-floor pad, a `tailHoldSec` QR
 *    release, a `headHoldSec` lead-in). During a hold the picture freezes and the narration is
 *    paused, exactly as in the file; everywhere else the narration runs at its own speed.
 *  - inside a scene, the cut markers and per-piece slips are resolved by the same
 *    `planScenePieces` the renderer uses, so a split with one piece slipped shows each piece's
 *    own footage and freezes each on its OWN last frame when that footage runs out.
 *
 * WHAT IT STILL IS NOT: a preview of the FILE. It omits everything assembly burns in — the QR
 * card, the lower third, asset captions — and it has no music bed. Reassemble remains the thing
 * that produces a shippable MP4.
 *
 * Requires `masterAudioUrl` and per-scene narration ranges — i.e. a master-overlay job, which is
 * what production renders are. Anything else renders nothing and the caller hides the control.
 */

/** How far the picture may drift from the film clock before it is snapped back. */
export const MAX_DRIFT_SEC = 0.25;

/**
 * Shortest stretch that counts as a frozen hold. The frame plan quantizes every scene to whole
 * frames, so a beat's arithmetic tail can come out a fraction of a frame long — which is not a
 * hold, it is rounding. Treating one as real would pause the narration at every cut and flash the
 * badge across the whole film; worse, pausing and resuming an <audio> element costs more than the
 * remainder itself, so the clock could never get past it. Two frames.
 */
export const MIN_HOLD_SEC = 2 / FPS;

/** A moment of the film where the picture freezes and the narration does not advance. */
export interface HoldSpan {
  startSec: number;
  endSec: number;
}

export interface CutBeat {
  /** 1-based storyboard index, for the caption under the player. */
  index: number;
  clipUrl: string;
  /** Range on the FINISHED film's timeline this beat is on screen for. */
  startSec: number;
  endSec: number;
  /** Where this beat's narration sits on the master track (`startSec` maps to `masterStartSec`
   *  once any head hold has passed). */
  masterStartSec: number;
  /** Seconds of frozen lead-in at the head of this beat, before the narration starts. */
  headHoldSec: number;
  /** Seconds of frozen tail after the narration ends but before the next beat. */
  tailHoldSec: number;
  /** Operator trim: seconds into the footage where this beat's picture starts. */
  clipInSec: number;
  /** Cut markers inside this beat (seconds from the start of its picture) and per-piece slips. */
  cutPoints: number[];
  pieceClipIns: Record<string, number>;
}

/**
 * Lay the storyboard out on the FINISHED film's timeline — the same layout assembly builds.
 *
 * Scenes without a clip or without a narration range are dropped rather than shown as a gap:
 * they are mid-render, and a beat with nothing to play is worse than a slightly short preview.
 * Scene lengths come from `planMasterOverlayScenes`, so a scene held past its narration (the
 * sub-floor pad, a CTA tail, an operator's hold) occupies exactly as much of the preview as it
 * will of the file.
 *
 * A MULTI-CLIP scene (a long host beat lip-synced in chunks) becomes one sub-beat per chunk,
 * splitting the scene's on-screen span evenly. Assembly concatenates those chunks and measures
 * the real seam; the browser cannot know a chunk's length before loading it, and the chunks come
 * from splitting one narration so they are close to equal. Only the FIRST sub-beat carries the
 * scene's trim and cut markers, for the same reason — the renderer applies those to the
 * concatenated whole, which this cannot reconstruct.
 *
 * Pure — unit-tested.
 */
export function planCutBeats(scenes: StoryboardScene[]): CutBeat[] {
  const usable = scenes
    .filter(
      s =>
        (s.clipUrls?.length || s.clipUrl) &&
        Number.isFinite(s.narrationStartSec as number) &&
        Number.isFinite(s.narrationEndSec as number) &&
        (s.narrationEndSec as number) > (s.narrationStartSec as number)
    )
    .sort((a, b) => a.index - b.index);
  if (!usable.length) return [];

  // The renderer's own plan. `holdSec` mirrors assembleAndFinalize: a cover-reveal beat ends with
  // its narration, everything else is floored to its stored duration.
  const plan = planMasterOverlayScenes({
    scenes: usable.map(s => ({
      sliceStartSec: s.narrationStartSec as number,
      sliceEndSec: s.narrationEndSec as number,
      // The renderer's own mapping — holds, the CTA tail and the on-screen floor all come from
      // `sceneHoldPlan`, so the preview cannot claim a length the file won't have.
      ...sceneHoldPlan(s),
    })),
  });

  const out: CutBeat[] = [];
  let filmAt = 0;
  usable.forEach((s, i) => {
    // The film timeline is the FRAME plan, not the mux cutoff: assembly pins each scene's slot
    // in the concat list to `frames / FPS`, and `muxDurationSec` is only the half-frame-early
    // `-t` that makes the encoder emit exactly that many frames.
    const span = plan.scenes[i].frames / FPS;
    const head = Math.min(s.headHoldSec ?? 0, span);
    const sliceLen = Math.max(
      0,
      (s.narrationEndSec as number) - (s.narrationStartSec as number)
    );
    // Whatever the scene holds beyond its lead-in and its spoken words is frozen tail: the hold
    // floor and the CTA release both land here, exactly as `planMasterOverlayScenes` split them
    // into audio inserts.
    const tail = Math.max(0, span - head - sliceLen);
    const urls = s.clipUrls?.length ? s.clipUrls : [s.clipUrl as string];

    // The holds bracket the scene, so only the SPOKEN middle is divided between the chunks —
    // the lead-in belongs to the first chunk and the frozen tail to the last, and neither can
    // end up longer than the sub-beat holding it.
    const body = Math.max(0, span - head - tail);
    const each = body / urls.length;
    let at = filmAt;
    urls.forEach((clipUrl, c) => {
      const first = c === 0;
      const last = c === urls.length - 1;
      const len = each + (first ? head : 0) + (last ? tail : 0);
      out.push({
        index: s.index,
        clipUrl,
        startSec: at,
        // The last sub-beat takes the scene's real end, so float division can't leave a gap.
        endSec: last ? filmAt + span : at + len,
        masterStartSec: (s.narrationStartSec as number) + c * each,
        headHoldSec: first && head >= MIN_HOLD_SEC ? head : 0,
        tailHoldSec: last && tail >= MIN_HOLD_SEC ? tail : 0,
        clipInSec: first ? (s.clipInSec ?? 0) : 0,
        cutPoints: first ? [...(s.cutPoints ?? [])].sort((a, b) => a - b) : [],
        pieceClipIns: first ? (s.pieceClipIns ?? {}) : {},
      });
      at += len;
    });
    filmAt += span;
  });
  return out;
}

export { QR_TAIL_HOLD_SEC } from "@shared/filmTimeline";

/** Total runtime of the planned cut — the film's length, holds included. Pure. */
export function totalFilmSec(beats: CutBeat[]): number {
  return beats.length ? beats[beats.length - 1].endSec : 0;
}

/** Index of the beat covering film-time `t`, or -1 past the end. Pure. */
export function beatAt(beats: CutBeat[], t: number): number {
  for (let i = 0; i < beats.length; i++) {
    if (t < beats[i].endSec) return i;
  }
  return -1;
}

/**
 * Where the master narration should be when the film clock reads `t`, or `null` while the
 * picture is inside a frozen hold — during which assembly has spliced silence into the track, so
 * the preview pauses the narration instead of running ahead of the file. Pure — unit-tested.
 */
export function masterTimeFor(beat: CutBeat, t: number): number | null {
  const into = Math.max(0, t - beat.startSec);
  const span = beat.endSec - beat.startSec;
  if (into < beat.headHoldSec) return null; // frozen lead-in, before the first word
  if (into > span - beat.tailHoldSec) return null; // frozen tail, after the last word
  return beat.masterStartSec + (into - beat.headHoldSec);
}

/**
 * Where the clip's playhead belongs when the film clock reads `t`.
 *
 * Delegates to `planScenePieces` — the renderer's own per-piece arithmetic — so a split whose
 * second piece was slipped shows the same footage here as in the file, and a piece whose footage
 * runs out reports a time past `videoDurationSec` for the caller to freeze on, exactly where
 * assembly's per-piece `tpad` freezes it.
 *
 * `videoDurationSec` is the loaded clip's real length; pass `Infinity` before metadata lands and
 * the clamp simply doesn't bind. Pure — unit-tested.
 */
export function clipTimeFor(
  beat: CutBeat,
  t: number,
  videoDurationSec = Infinity
): number {
  const span = beat.endSec - beat.startSec;
  // The picture starts at the head hold (its first frame, frozen) and runs to the end of the
  // beat; the piece plan is laid out over that whole span, holds included, the same way the
  // renderer lays it over the scene's full on-screen length.
  const into = Math.max(0, Math.min(t - beat.startSec, span));
  const pieces = planScenePieces({
    cuts: beat.cutPoints,
    totalDurationSec: span,
    videoDurationSec,
    clipInSec: beat.clipInSec,
    pieceClipIns: beat.pieceClipIns,
  });
  let at = 0;
  for (const piece of pieces) {
    if (into < at + piece.durationSec || piece === pieces[pieces.length - 1])
      return piece.startSec + (into - at);
    at += piece.durationSec;
  }
  return beat.clipInSec + into;
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Picks which cut fills the player slot on a finished job: the rendered MP4, or the live preview
 * above. A segmented control rather than a "show preview" button, because these are two views of
 * ONE thing — they occupy the same frame, so clicking between them compares the cuts in place.
 * A second player stacked below the film would read as a second film.
 */
export function CutPreviewSwitch({
  live,
  onChange,
  className,
}: {
  /** True while the live preview is the one on screen. */
  live: boolean;
  onChange: (live: boolean) => void;
  className?: string;
}) {
  const tab = (on: boolean) =>
    `rounded px-2.5 py-1 text-xs transition-colors ${
      on
        ? "bg-secondary font-medium text-secondary-foreground"
        : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ""}`}
    >
      <div className="inline-flex rounded-md border border-border p-0.5">
        <button
          type="button"
          onClick={() => onChange(false)}
          aria-pressed={!live}
          className={tab(!live)}
        >
          <Film className="mr-1.5 inline h-3.5 w-3.5" />
          Rendered film
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          aria-pressed={live}
          title="Play the cut in the browser from the clips already rendered — instant, and it reflects edits the rendered film hasn't been reassembled with yet."
          className={tab(live)}
        >
          <Eye className="mr-1.5 inline h-3.5 w-3.5" />
          Live preview
        </button>
      </div>
      {live && (
        <span className="text-xs text-muted-foreground">
          Not rendered — reflects every edit instantly.
        </span>
      )}
    </div>
  );
}

export function LongformCutPreview({
  scenes,
  masterAudioUrl,
  className,
}: {
  scenes: StoryboardScene[];
  masterAudioUrl: string;
  className?: string;
}) {
  const beats = useMemo(() => planCutBeats(scenes), [scenes]);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Two players, swapped at every cut: `slot` says which one is on screen. The other is already
  // holding the NEXT beat's clip, seeked and paused, so a cut is a visibility flip rather than a
  // load + seek the viewer watches happen.
  const vidA = useRef<HTMLVideoElement>(null);
  const vidB = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<0 | 1>(0);
  const [beatIdx, setBeatIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [holding, setHolding] = useState(false);
  const [muted, setMuted] = useState(false);
  const [t, setT] = useState(0);

  const totalSec = totalFilmSec(beats);

  // Everything the animation loop reads lives behind a ref. The loop must survive a re-render
  // untouched: an effect that re-subscribed on `beats` (or on anything derived from it) would
  // cancel its own pending frame on every state update it caused, and the picture would advance
  // in stutters instead of playing. Refs are the whole reason the loop's deps are `[playing]`.
  const beatsRef = useRef(beats);
  beatsRef.current = beats;
  const beatIdxRef = useRef(0);
  beatIdxRef.current = beatIdx;
  const slotRef = useRef<0 | 1>(0);
  slotRef.current = slot;
  /** The transport's position in FILM time — the clock everything else is slaved to. */
  const filmT = useRef(0);
  /** Last `t` pushed to state — the slider needs ~10Hz, not one render per frame. */
  const lastPublishedT = useRef(0);

  /** Point a player at a beat and park it on the right frame. Stable — reads beats via the ref. */
  const stage = useCallback(
    (el: HTMLVideoElement | null, i: number, atSec: number) => {
      const beat = beatsRef.current[i];
      if (!el || !beat) return;
      const want = beat.clipUrl;
      // Only reassign `src` when the clip actually changes: consecutive beats often share
      // footage (a multi-chunk host scene, a scene split in the cut room), and reassigning
      // throws away a warm buffer AND pauses a playing element.
      if (el.getAttribute("data-clip") !== want) {
        el.setAttribute("data-clip", want);
        el.src = want;
      }
      // A freshly-assigned src has no metadata yet, so this seek is a no-op (or throws). Park the
      // wanted time on the element and re-apply it from `onLoadedMetadata`, which is the first
      // moment the element is guaranteed to accept it.
      const target = clipTimeFor(beat, atSec, el.duration || Infinity);
      el.setAttribute("data-seek", String(target));
      if (el.readyState >= 1) {
        try {
          el.currentTime = Math.min(target, Math.max(0, el.duration - 0.05));
        } catch {
          /* left to the loadedmetadata handler */
        }
      }
    },
    []
  );

  /** Apply whatever seek was parked on an element while it had no metadata. */
  const applyParkedSeek = useCallback((el: HTMLVideoElement) => {
    const want = Number(el.getAttribute("data-seek"));
    if (!Number.isFinite(want)) return;
    try {
      el.currentTime = Math.min(want, Math.max(0, el.duration - 0.05));
    } catch {
      /* a clip that refuses the seek just starts from its head */
    }
  }, []);

  /** Put beat `i` on the active player and pre-roll `i + 1` onto the standby one. */
  const stagePair = useCallback(
    (i: number, atSec: number) => {
      const bs = beatsRef.current;
      const onScreen = slotRef.current === 0 ? vidA.current : vidB.current;
      const offScreen = slotRef.current === 0 ? vidB.current : vidA.current;
      stage(onScreen, i, atSec);
      if (bs[i + 1]) stage(offScreen, i + 1, bs[i + 1].startSec);
    },
    [stage]
  );

  /** Move the whole transport to film time `sec`: pick the beat, stage both players, place the
   *  narration at whatever master time that film moment corresponds to. */
  const seekTo = useCallback(
    (sec: number) => {
      const bs = beatsRef.current;
      const clamped = Math.max(0, Math.min(sec, totalSec));
      const i = Math.max(0, beatAt(bs, clamped));
      stagePair(i, clamped);
      setBeatIdx(i);
      beatIdxRef.current = i;
      filmT.current = clamped;
      const a = audioRef.current;
      if (a && bs[i]) {
        // Inside a frozen hold there is no corresponding word, so park the narration at the head
        // of the beat's own slice — the next unfrozen frame resumes from exactly there.
        a.currentTime = masterTimeFor(bs[i], clamped) ?? bs[i].masterStartSec;
      }
      lastPublishedT.current = clamped;
      setT(clamped);
    },
    [stagePair, totalSec]
  );

  // Stage the opening frame once the beat LIST changes in substance, so the player shows the
  // first shot instead of a black rectangle before anyone presses play. Keyed on a signature
  // rather than the array identity: the storyboard arrives from a poll and is a new array on
  // every tick, and re-running this mid-playback would yank the picture back to the top.
  const beatsSig = beats
    .map(b => `${b.clipUrl}@${b.startSec.toFixed(3)}+${b.clipInSec}`)
    .join("|");
  useEffect(() => {
    const bs = beatsRef.current;
    if (!bs.length) return;
    stage(vidA.current, 0, bs[0].startSec);
    if (bs[1]) stage(vidB.current, 1, bs[1].startSec);
  }, [beatsSig, stage]);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    vidA.current?.pause();
    vidB.current?.pause();
    setPlaying(false);
    setHolding(false);
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const totalSecRef = useRef(totalSec);
  totalSecRef.current = totalSec;
  const holdingRef = useRef(false);
  const setHoldingState = (v: boolean) => {
    holdingRef.current = v;
    setHolding(v);
  };

  /**
   * The transport.
   *
   * FILM time advances on the wall clock, and the narration is slaved to it — not the other way
   * round, because the film has stretches (frozen holds) where the narration does not advance at
   * all. Each frame: work out where the picture and the voice belong at `filmT.current`, then
   * correct whichever has drifted.
   *
   * Two escape hatches keep that honest. A big divergence (a backgrounded tab, where rAF stops
   * but the audio keeps playing) re-derives the film clock FROM the narration rather than
   * dragging the narration back. And a stalled buffer stops the film clock instead of running
   * the picture past words nobody has heard yet.
   */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let lastMs = performance.now();
    const tick = (nowMs: number) => {
      raf = requestAnimationFrame(tick);
      const a = audioRef.current;
      const bs = beatsRef.current;
      if (!a || !bs.length) return;
      const dt = Math.max(0, (nowMs - lastMs) / 1000);
      lastMs = nowMs;

      let now = filmT.current;
      let idx = beatAt(bs, now);
      if (idx === -1) return; // past the end; the stop below has already fired
      let beat = bs[idx];

      // The stretch of this beat that has words under it. Outside it the picture is frozen and
      // assembly has spliced silence into the track, so the narration must not advance either.
      const bodyStart = beat.startSec + beat.headHoldSec;
      const bodyEnd = beat.endSec - beat.tailHoldSec;
      const frozen =
        (beat.headHoldSec > 0 && now < bodyStart) ||
        (beat.tailHoldSec > 0 && now >= bodyEnd);

      if (frozen) {
        if (!a.paused) a.pause();
        if (!holdingRef.current) setHoldingState(true);
        now += dt; // only a hold runs on the wall clock
      } else {
        if (holdingRef.current) setHoldingState(false);
        if (a.paused) a.play().catch(() => undefined);
        // Everywhere else the NARRATION is the clock and nothing seeks it. Slaving the voice to
        // a wall clock instead means correcting it whenever the two drift, and each correction
        // is a seek that knocks the element's readyState down — which stalls the wall clock,
        // which grows the drift, which forces another seek. Reading the time the viewer is
        // actually hearing has none of that, and it absorbs a stall or a backgrounded tab for
        // free: the picture simply waits wherever the voice is.
        // A ripple trim leaves a hole in the master, so the narration has to JUMP at that seam
        // rather than play on through words the film no longer contains. Anything further off
        // than a drift correction is a real gap: seek, don't nudge.
        const want = bodyStart + (a.currentTime - beat.masterStartSec);
        if (want < beat.startSec - MAX_DRIFT_SEC) {
          a.currentTime = beat.masterStartSec + (now - bodyStart);
          return;
        }
        const fromAudio = want;
        // A beat that ends in a hold stops at its last word, so the branch above can take over
        // on the next frame; one that doesn't may run to its own end, which is the cut.
        const ceil = beat.tailHoldSec > 0 ? bodyEnd : beat.endSec;
        now = Number.isFinite(fromAudio)
          ? Math.min(Math.max(fromAudio, beat.startSec), ceil)
          : now + dt;
      }

      if (now >= totalSecRef.current) {
        stopRef.current();
        return;
      }
      filmT.current = now;
      // ~10Hz, not one render per frame: the slider and the scene caption are all that read it,
      // and re-rendering two <video> elements sixty times a second buys nothing.
      if (Math.abs(now - lastPublishedT.current) > 0.1) {
        lastPublishedT.current = now;
        setT(now);
      }

      const want = beatAt(bs, now);
      if (want !== -1 && want !== beatIdxRef.current) {
        const cur = beatIdxRef.current;
        if (want === cur + 1) {
          // The expected cut: the standby player is already holding this beat — flip to it and
          // start pre-rolling the one after.
          const next: 0 | 1 = slotRef.current === 0 ? 1 : 0;
          slotRef.current = next;
          setSlot(next);
          const nowStandby = next === 0 ? vidB.current : vidA.current;
          if (bs[want + 1]) stage(nowStandby, want + 1, bs[want + 1].startSec);
        } else {
          // A jump (the viewer scrubbed): restage rather than trust the pre-roll.
          stagePair(want, now);
        }
        beatIdxRef.current = want;
        setBeatIdx(want);
        idx = want;
        beat = bs[want];
      }

      const el = slotRef.current === 0 ? vidA.current : vidB.current;
      if (!el || el.readyState < 1) return;
      // Recomputed against the beat that is actually on screen NOW: the switch above may have
      // moved on, and reusing the pre-switch value would freeze a new beat's first frame.
      const stillFrame = masterTimeFor(beat, now) === null;
      const target = clipTimeFor(beat, now, el.duration || Infinity);
      // Past the end of this PIECE's footage the picture freezes on its own last frame —
      // assembly's per-piece tpad does exactly this, and seeking past the end would pause the
      // element and desync everything after it.
      if (target >= el.duration - 1 / 60) {
        if (!el.paused) el.pause();
        return;
      }
      if (stillFrame) {
        // Frozen lead-in or tail: the picture is a still, not a paused film.
        if (!el.paused) el.pause();
        return;
      }
      if (el.paused) el.play().catch(() => undefined);
      if (Math.abs(el.currentTime - target) > MAX_DRIFT_SEC)
        el.currentTime = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stage, stagePair]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      stop();
      return;
    }
    // Restart from the top once the transport has run out, so the play button never looks dead.
    if (filmT.current >= totalSecRef.current - 0.05) seekTo(0);
    // Started from the viewer's own click, so autoplay policy is satisfied for both elements.
    a.play()
      .then(() => {
        setPlaying(true);
        (slotRef.current === 0 ? vidA.current : vidB.current)
          ?.play()
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, [playing, seekTo, stop]);

  /** Seek from a click or drag anywhere on the scrub bar. */
  const seekFromPointer = useCallback(
    (clientX: number) => {
      const bar = barRef.current;
      if (!bar || !totalSec) return;
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
      seekTo((x / rect.width) * totalSec);
    },
    [seekTo, totalSec]
  );

  if (!beats.length || !masterAudioUrl) return null;

  const beat = beats[beatIdx];
  const pct = totalSec ? (t / totalSec) * 100 : 0;

  return (
    <div className={className}>
      {/* Same frame as the finished-film player, so switching between the two doesn't move the
          picture on screen. */}
      <div className="relative aspect-video max-h-[480px] w-full overflow-hidden rounded-lg bg-black">
        {/* Both players are always mounted; only the active one is visible. Muted because every
            rendered clip is silent — the voice comes from the master track. */}
        {[vidA, vidB].map((ref, i) => (
          <video
            key={i}
            ref={ref}
            muted
            playsInline
            preload="auto"
            className="absolute inset-0 h-full w-full object-contain"
            style={{ opacity: slot === i ? 1 : 0 }}
            onLoadedMetadata={e => applyParkedSeek(e.currentTarget)}
          />
        ))}
        <audio
          ref={audioRef}
          src={masterAudioUrl}
          preload="auto"
          muted={muted}
          onEnded={stop}
        />
        {holding && (
          <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white/90">
            Hold
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          aria-label={playing ? "Pause preview" : "Play preview"}
        >
          {playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>

        {/* Same scrub bar as the finished-film player, plus a tick at every scene boundary and
            every cut marker — the one thing this preview can show that the rendered file cannot,
            since the cuts ARE the edit. */}
        <div
          ref={barRef}
          className="relative h-2 flex-1 cursor-pointer rounded-full bg-secondary/60"
          onMouseDown={e => {
            seekFromPointer(e.clientX);
            const move = (ev: MouseEvent) => seekFromPointer(ev.clientX);
            const up = () => {
              window.removeEventListener("mousemove", move);
              window.removeEventListener("mouseup", up);
            };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
          role="slider"
          aria-label="Preview position"
          aria-valuemin={0}
          aria-valuemax={Math.round(totalSec)}
          aria-valuenow={Math.round(t)}
          tabIndex={0}
          onKeyDown={e => {
            if (e.key === "ArrowLeft") seekTo(t - 5);
            else if (e.key === "ArrowRight") seekTo(t + 5);
            else return;
            e.preventDefault();
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${pct}%` }}
          />
          {beats.slice(1).map((b, i) => (
            <span
              key={`s${i}`}
              className="pointer-events-none absolute inset-y-0 w-px bg-background/70"
              style={{ left: `${(b.startSec / totalSec) * 100}%` }}
            />
          ))}
          {beats.flatMap(b =>
            b.cutPoints.map(c => (
              <span
                key={`c${b.index}-${c}`}
                className="pointer-events-none absolute -inset-y-0.5 w-0.5 rounded bg-warning"
                style={{ left: `${((b.startSec + c) / totalSec) * 100}%` }}
                title={`Scene ${b.index} — cut at ${c.toFixed(2)}s`}
              />
            ))
          )}
        </div>

        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {formatTime(t)} / {formatTime(totalSec)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setMuted(m => !m)}
          aria-label={muted ? "Unmute narration" : "Mute narration"}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
        </Button>
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        Scene {beat?.index ?? "—"} of {beats.length} · live preview — trims,
        splits, slips and holds are exact; no QR code, lower third, captions or
        music. Reassemble for the shippable file.
      </p>
    </div>
  );
}
