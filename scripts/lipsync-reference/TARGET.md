# Host lip-sync acceptance target

The numbers a host-lip-sync lane has to hit to be considered a replacement, measured off an
**operator-accepted HeyGen Avatar IV clip** (`clip-1-0-jJCtWb`, Granny Mae, 5.7 s, 1920x1080).
It is the bar because the operator picked it, not because it wins every metric — where it fails
one of our own rules, that is recorded here too rather than quietly excluded.

Run all three judges plus the sharpness check against a candidate's clip of the SAME beat:

```bash
npx tsx scripts/measure-host-body.mts CANDIDATE.mp4 --beside "clip-1-0-jJCtWb.mp4"
node scripts/measure-host-motion.mjs CANDIDATE.mp4
npx tsx scripts/measure-lipsync.mts CANDIDATE.mp4
```

## Hard bars — read these off ONE clip

These held to within ~10% across renders of the same beat at identical settings, so a single
clip is enough to judge them.

| Measure | Target | Bar | Where |
| ------------------------- | ------ | ---------------- | ------------------- |
| Cheek flicker             | 3.51   | <= 5             | measure-host-motion |
| Background morph vs f0    | 0.93   | <= 1.0           | measure-host-motion |
| Motion roughness          | 0.50   | <= 0.7           | measure-host-motion |
| Body follows head         | 0.66   | >= 0.55          | measure-host-motion |
| Shoulders follow head (r) | 0.68   | >= 0.3           | measure-host-body   |
| Head energy above 4 Hz    | 4%     | <= 10%           | measure-host-body   |
| Window seams / subject cuts | 0    | 0                | measure-host-motion |
| Blink rate                | 21/min | 8-40/min         | measure-host-body   |
| Blink length              | 220 ms | 100-400 ms       | measure-host-body   |
| Eye flutter between blinks| 0.01   | <= 0.08          | measure-host-body   |

## Noisy — needs the MEDIAN of three renders of the same beat

Head travel swung 13% -> 21% and background morph 2.22 -> 2.95 across renders that differed in
nothing at all. Judging these from one clip produces whichever answer you were hoping for.

| Measure | Target | Band | Note |
| ------------------- | ------ | ---------- | -------------------------------------------------- |
| Head travel / face  | 5-9%   | 6-12%      | two accepted clips read 5% and 9% |
| Brow-burst frames   | 10-16% | 10-25%     | same two clips |
| Arms vs head        | 0.16   | <= 0.45    | it never gestures; neither should a candidate |
| Mouth articulation  | 4.90   | 4-8        | lower than ours has been; the work is in the lips |
| Head/mouth ratio    | 40%    | 35-50%     | the balance, not the amount |

## Image

| Measure | Target | Note |
| --------------------- | ---- | ----------------------------------------------------------- |
| Sharpness, whole frame| 474  | Laplacian variance at 640x360 |
| Sharpness, face band  | 1131 | |
| Face width in pixels  | 429  | at 1920 wide. A 720p lane gets ~301 at the same FRAMING and closes the rest with `HOST_UPSCALE_SHARPEN` — compare AFTER assembly's upscale, never the raw R2 file |
| Framing               | 22.3% of frame width | our host photos already match this; the gap is resolution, not shot |

## Cost

| | |
| ---------------------------- | ---------------------------------------------- |
| HeyGen, billed per output second | **$0.06 / finished second** |
| A self-hosted lane must beat this | or it is paying more for less |
| InfiniteTalk, for reference  | ~$0.137/s at 12/3 on a $3.49/hr GPU |

## Where the reference FAILS our own rules

Recorded so nobody "fixes" a candidate toward a metric the accepted clip does not satisfy:

- **Chain (head > shoulders > chest > lap)** reads FLAT: 0.89 / 0.20 / 0.29 / 0.59 — shoulders
  below chest. Our CHAIN rule fails this clip, so it is not a discriminator.
- **Head-motion-vs-speech** correlates at r -0.09. Our own renders reach r 0.47. Timing is not
  what separates them; amplitude is.
- **Blinks** were 0 in a second accepted clip over 7 s, which our own rule calls dead eyes.

## What the reference is actually better at

One line, so an evaluation does not get lost in the table: it moves its **head** and **brows**
far more than we do while moving its **mouth** less, and it holds the **background** still while
doing it. Everything else is close or ours.
