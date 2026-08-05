import { describe, it, expect } from "vitest";
import { PAUSE_CAP_FILTER, PAUSE_CAP_SEC, PAUSE_FLOOR_DB } from "./ttsUnified";

describe("PAUSE_CAP_FILTER", () => {
  it("caps interior pauses at the configured length and floor", () => {
    expect(PAUSE_CAP_FILTER).toBe(
      `silenceremove=stop_periods=-1:stop_duration=${PAUSE_CAP_SEC}` +
        `:stop_threshold=${PAUSE_FLOOR_DB}dB`
    );
  });

  it("stays below every channel's room tone so it only fires on dead air", () => {
    // Measured pause floors: wes −85 dBFS (noise-gated clone, the defect) vs donna −52,
    // roy −54, garry −58. A threshold above −60 would start eating real room tone.
    expect(PAUSE_FLOOR_DB).toBeLessThanOrEqual(-60);
  });

  it("omits stop_silence (a near no-op on ffmpeg 6.1) and never trims the head", () => {
    expect(PAUSE_CAP_FILTER).not.toContain("stop_silence");
    expect(PAUSE_CAP_FILTER).not.toContain("start_periods");
  });
});
