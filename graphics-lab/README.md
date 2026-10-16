# graphics-lab

Isolated prototype of **Steve Cooper–style motion graphics**: full-screen cards, labels on footage and word-timed captions, built with [Remotion](https://www.remotion.dev) and tested on a real film of ours. It's Phase 1 of the Remotion test. **Nothing in the app imports this folder**, so the app builds, checks and tests exactly as before.

## What's here

| Path | What it is |
|---|---|
| `src/theme.ts` | The one look: colours **sampled from Steve's frames** (navy `#0B192B`, glow `#1C283A`, accent `#44A3FF`), type scale, layout grid, motion timings |
| `src/components.tsx` | Building blocks every template is made of: card ground (glow + 120 px grid), kicker, word-by-word text, icon, VS badge, number dot, drawn arrow |
| `src/cards.tsx` | Full-screen cards (opaque MP4): Statement, Myth → Truth, Versus, Big number, Step cards, Before → After, Two points |
| `src/overlays.tsx` | Overlays on footage (ProRes 4444 alpha): Chapter label, Step labels, Warning, Icon labels, Host caption, Caption over darkened footage, Quote |
| `src/registry.ts` | Every template's id, kind (card/overlay), and sample props from Frederick's script |
| `src/timing.ts` | Pure timing maths: word appear frames, fades, count-up |
| `src/cueResolve.ts` | Turns a cue sheet written in the **script's own words** into exact times from the word transcript (unit-tested) |
| `cues/frederick-376.json` | The cue sheet for Frederick Barnes' smoke-alarm film (job 376): 14 graphics |
| `src/palette.ts` | Colours from the host photo (Material Color Utilities), WCAG contrast guaranteed |
| `scripts/plan.mts`, `scripts/rules.mts` | The automatic planner and the placement rules it and the composite share |
| `scripts/` | `transcribe` (local whisper.cpp word times), `resolve`, `stills`, `composite`, `bench`, `highlights` |

## Run it

```bash
cd graphics-lab
pnpm install --ignore-workspace
pnpm studio                                   # Remotion Studio: every template, live, editable props
pnpm check && pnpm test                       # tsc + the lab's own unit tests
npx tsx scripts/transcribe.mts --job 376      # word times for a job (local Whisper, free)
npx tsx scripts/composite.mts --cues cues/frederick-376.json --tag try1

# A new film, fully automatic (round 3):
npx tsx scripts/transcribe.mts --job 385     # word times
npx tsx scripts/cuts.mts 385                 # the film's picture cuts
npx tsx scripts/theme.mts --job 385          # colours from the host photo
npx tsx scripts/plan.mts --job 385 --out cues/frederick-385.json   # one Claude call writes the cue sheet
npx tsx scripts/composite.mts --cues cues/frederick-385.json --tag run2
npx tsx scripts/highlights.mts --job 385 --tag run2
npx tsx scripts/bench.mts --runs 3            # speed + identical-output check
```

`composite` reads the job read-only from the local docker MySQL (cached after the first read) and writes everything under `out/` (gitignored).

**Windows note:** the whisper.cpp release unpacks into `.whisper/Release/` but Remotion looks in `.whisper/build/bin/`. Copy the folder across once.

## Rules the cue sheet follows (and `composite` checks)

- Every word on a graphic is a word the narrator says. A cue names words, never times.
- Nothing inside a CTA block.
- Cards, and overlays that darken or blur the frame, only go over b-roll. Never over a paid host take.
- No two graphics overlap.
- A host caption sits below the chin, never while the name tag is up, and inside the host panel on a split screen.
- An overlay that ends on a picture cut leaves with the picture (`exit: "cut"`).

## Licences

- **Remotion:** free for individuals, companies with up to 3 employees, and evaluation. A for-profit company with more than 3 employees needs a company licence before production use (remotion.pro/license).
- **Inter:** SIL OFL 1.1 (`public/fonts`).
- **Noto Color Emoji:** Apache 2.0 (`public/icons`).
