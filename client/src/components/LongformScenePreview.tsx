import { useCallback, useEffect, useRef } from "react";

/**
 * A storyboard scene clip, played with its narration.
 *
 * Every scene clip on R2 is SILENT, and that is correct rather than a bug: the pipeline renders
 * each clip with `-an` and assembly lays the one continuous master narration over the finished
 * film (`narrationStartSec/EndSec` map each scene onto it). Muxing audio into the per-scene
 * clips would mean re-encoding every one of them for a preview that plays a few seconds.
 *
 * But the review UI showed those silent clips in a `<video controls>`, so scrubbing a scene gave
 * picture with no voice and a volume slider that did nothing — there was no way to check that a
 * shot actually matches the line it sits under without rendering the whole film.
 *
 * The voice already exists separately: stage 2 writes each scene's slice of the narration to
 * `scene.audioUrl` (`longform/<job>/scene-N-vo-*.mp3`). This plays that alongside the picture and
 * keeps the two in step, so a scene previews the way it will ship.
 *
 * Degrades to a plain `<video>` when a scene has no audio slice — a scene re-voiced off-master,
 * or one being previewed before stage 2 filled the field in.
 */
/** Largest gap tolerated before the narration is snapped back onto the picture. */
export const MAX_DRIFT_SEC = 0.2;

/**
 * The time to move the narration to, or null to leave it alone.
 *
 * `hard` forces a correction (play, seek); otherwise it only fires once the two have drifted
 * past `MAX_DRIFT_SEC`, so the ~4Hz `timeupdate` stream isn't reassigning `currentTime` on
 * every tick — which stutters playback in Safari.
 *
 * `audioDuration` is NaN until the element has metadata, and with `preload="none"` that is the
 * state on the very first play. It must therefore mean "don't clamp" rather than "clamp to
 * zero": treating NaN as 0 sends every pre-load seek back to the start of the line.
 *
 * Pure — unit-tested.
 */
export function syncTargetTime(
  videoTime: number,
  audioTime: number,
  audioDuration: number,
  hard: boolean
): number | null {
  if (!Number.isFinite(videoTime) || videoTime < 0) return null;
  if (!hard && Math.abs(audioTime - videoTime) <= MAX_DRIFT_SEC) return null;
  // The narration slice and the clip can differ in length — a scene held to its on-screen floor
  // has picture past the last word. Clamping keeps that a silent tail rather than a seek past
  // the end, which pauses the element and desyncs everything after it.
  return Number.isFinite(audioDuration)
    ? Math.min(videoTime, audioDuration)
    : videoTime;
}

export function LongformScenePreview({
  clipUrl,
  audioUrl,
  className,
  startSec = 0,
  durationSec,
}: {
  clipUrl: string;
  /** This scene's narration slice. Absent ⇒ silent preview, same as before. */
  audioUrl?: string;
  className?: string;
  /**
   * The operator's trim (`scene.clipInSec`): seconds into the footage where THIS scene's picture
   * starts. The preview plays from here — a split's second half shows its own part of the
   * clip, not the whole clip from the top. Default 0.
   */
  startSec?: number;
  /**
   * How long this scene is on screen (its narration slice). With it, playback stops at the end
   * of the scene's part of the footage instead of running on into what the next scene shows.
   */
  durationSec?: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const endSec =
    durationSec !== undefined && Number.isFinite(durationSec)
      ? startSec + durationSec
      : undefined;

  // The picture and the narration share a clock only once the trim is taken off the picture's
  // time: the narration slice starts at the first word of THIS scene, i.e. at `startSec` of
  // the footage.
  const sync = useCallback(
    (hard: boolean) => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (!v || !a) return;
      const target = syncTargetTime(
        v.currentTime - startSec,
        a.currentTime,
        a.duration,
        hard
      );
      if (target !== null) a.currentTime = target;
    },
    [startSec]
  );

  // Keep the picture inside this scene's part of the footage: a play from outside it (the
  // element's own start, or past the scene's end) jumps to the trim point first.
  const clampIntoScene = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    if (t < startSec - 0.05 || (endSec !== undefined && t >= endSec - 0.05)) {
      try {
        v.currentTime = startSec;
      } catch {
        /* metadata not loaded yet */
      }
    }
  }, [startSec, endSec]);

  const handlePlay = useCallback(() => {
    clampIntoScene();
    const a = audioRef.current;
    if (!a) return;
    sync(true);
    // Autoplay policy: this only ever runs from the user's own click on the video's play
    // control, so the gesture carries. Rejection is not worth surfacing — the picture plays.
    void a.play().catch(() => {});
  }, [sync, clampIntoScene]);

  const handlePause = useCallback(() => audioRef.current?.pause(), []);

  // Stop at the end of the scene's part of the footage (the next scene shows what follows).
  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (endSec !== undefined && v.currentTime >= endSec) {
      v.pause();
      return;
    }
    sync(false);
  }, [endSec, sync]);

  // Mirror the native controls onto the element that actually carries sound. Without this the
  // video's own volume slider and mute button are dead, because the video has no audio track.
  const handleVolume = useCallback(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    a.volume = v.volume;
    a.muted = v.muted;
  }, []);

  const handleRate = useCallback(() => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (v && a) a.playbackRate = v.playbackRate;
  }, []);

  // Pause the narration if the component goes away mid-play — an unmounted <audio> that was
  // playing keeps playing in some browsers, which is how you get a disembodied voice after
  // collapsing a scene or switching tabs.
  useEffect(() => {
    const a = audioRef.current;
    return () => {
      a?.pause();
    };
  }, []);

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={clipUrl}
        controls
        preload="metadata"
        onClick={e => e.stopPropagation()}
        onLoadedMetadata={clampIntoScene}
        onPlay={handlePlay}
        onPlaying={() => sync(false)}
        onPause={handlePause}
        onEnded={handlePause}
        onSeeked={() => sync(true)}
        onTimeUpdate={handleTimeUpdate}
        onRateChange={handleRate}
        onVolumeChange={handleVolume}
        className={className}
      />
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="none"
          onClick={e => e.stopPropagation()}
          className="hidden"
        />
      )}
    </div>
  );
}
