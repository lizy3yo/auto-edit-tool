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
}: {
  clipUrl: string;
  /** This scene's narration slice. Absent ⇒ silent preview, same as before. */
  audioUrl?: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const sync = useCallback((hard: boolean) => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !a) return;
    const target = syncTargetTime(
      v.currentTime,
      a.currentTime,
      a.duration,
      hard
    );
    if (target !== null) a.currentTime = target;
  }, []);

  const handlePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    sync(true);
    // Autoplay policy: this only ever runs from the user's own click on the video's play
    // control, so the gesture carries. Rejection is not worth surfacing — the picture plays.
    void a.play().catch(() => {});
  }, [sync]);

  const handlePause = useCallback(() => audioRef.current?.pause(), []);

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
        preload="none"
        onClick={e => e.stopPropagation()}
        onPlay={handlePlay}
        onPlaying={() => sync(false)}
        onPause={handlePause}
        onEnded={handlePause}
        onSeeked={() => sync(true)}
        onTimeUpdate={() => sync(false)}
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
