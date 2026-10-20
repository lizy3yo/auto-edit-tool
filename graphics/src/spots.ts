// WHERE A GRAPHIC THAT SITS ON THE PICTURE GOES: the places a template may be drawn in, the box a
// drawing covers in each, and the one of them clear of the picture's subject. Pure — the finishing
// step (server/graphics/readable.ts `clearOfSubject`) hands in the subject maps of the frames under the
// graphic (legibility.ts `subjectMap`) and the size of its drawing, and the templates draw themselves
// from the same numbers (`placeStyle`, `numberLabelAnchor`, overlays.tsx `chapterBox`).
import type React from "react";
import type { Place } from "./components";
import { onSubject } from "./legibility";
import { HEIGHT, LAYOUT, WIDTH } from "./theme";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Size = { w: number; h: number };

/** A movable block of text (`placeStyle`): 160 px in from its side; its top 150 px down, centred on
 * its band's height, or that height above the bottom's 170 px. */
export const PLACE_INSET = { x: 160, top: 150, bottom: 170 } as const;

/** Where a block of `size` sits at `place`, drawn by `placeStyle` with band height `band`: its top on
 * the band's top, its side on the side's inset. */
export function placeBox(place: Place, size: Size, band: number): Box {
  const y0 = place.v === "top" ? PLACE_INSET.top : place.v === "bottom" ? HEIGHT - PLACE_INSET.bottom - band : (HEIGHT - band) / 2;
  const x0 = place.h === "left" ? PLACE_INSET.x : WIDTH - PLACE_INSET.x - size.w;
  return { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x0 + size.w), y1: Math.round(y0 + size.h) };
}

/** A NumberLabel's corner: 120 px in from its side (`LAYOUT.actionSafeX` + 24), 120 px up from the
 * bottom as designed, or 150 px down from the top like the other graphics' top band. */
export const NUMBER_LABEL_INSET = { x: LAYOUT.actionSafeX + 24, bottom: 120, top: PLACE_INSET.top } as const;

/** The NumberLabel's position on the frame at `place` (bottom-left as designed): its column's side
 * and edge, its kicker on the same side. */
export function numberLabelAnchor(place?: Place): React.CSSProperties {
  const right = place?.h === "right";
  return {
    position: "absolute",
    ...(right ? { right: NUMBER_LABEL_INSET.x } : { left: NUMBER_LABEL_INSET.x }),
    ...(place?.v === "top" ? { top: NUMBER_LABEL_INSET.top } : { bottom: NUMBER_LABEL_INSET.bottom }),
    alignItems: right ? "flex-end" : "flex-start",
  };
}

/** Where a NumberLabel of `size` sits at `place` (`numberLabelAnchor`). */
export function numberLabelBox(place: Place, size: Size): Box {
  const x0 = place.h === "right" ? WIDTH - NUMBER_LABEL_INSET.x - size.w : NUMBER_LABEL_INSET.x;
  const y0 = place.v === "top" ? NUMBER_LABEL_INSET.top : HEIGHT - NUMBER_LABEL_INSET.bottom - size.h;
  return { x0, y0, x1: x0 + size.w, y1: y0 + size.h };
}

/** The four corners, bottom-left first: the bottom band before the top, the side it was designed on
 * before the other. */
export const CORNERS: Place[] = [
  { h: "left", v: "bottom" },
  { h: "right", v: "bottom" },
  { h: "left", v: "top" },
  { h: "right", v: "top" },
];

/** The places a template may be drawn in (the designed one first), and the box a drawing of a size
 * covers in each — registry `TemplateDef.spots`. */
export type Spots = { places: Place[]; box: (place: Place, size: Size) => Box };

/**
 * A graphic moves off its designed place only for a place covering at most this share of the subject
 * the designed one covers, and at least SUBJECT_MIN_GAIN less of it (`onSubject`, 0-1): the subject
 * map is a measure of what stands out, not a judgement of what matters, so a small difference is not
 * worth a graphic standing somewhere new. Set on the round-13 verification films and the practice films
 * before them: the three placements the review found on a subject moved to places covering 0.35-0.47 of
 * what the designed one did (job 412's MYTH stamp on the sleeper's head and across the cat's face,
 * job 413's price pair on the phone). Of fourteen placements the reviews passed, ten stayed (0.66 and
 * over) and four moved to places no worse — two better: a stamp off a raised hand (job 401), a chapter
 * plate off the stack of boards its chapter is about (job 397). Job 414's froe, dark steel against a
 * dark shirt, does not stand out from what is around it, and its chapter plate stays.
 */
export const SUBJECT_MOVE_RATIO = 0.6;
export const SUBJECT_MIN_GAIN = 0.05;

/** The place chosen, the place it was designed in (`from`), and how much of the subject each place
 * covers (`on`, 0-1, in the template's order). */
export type SpotChoice = { place: Place; from: Place; moved: boolean; scores: { place: Place; on: number }[] };

/**
 * The place, of a template's own (`spots`), clear of the picture's subject on every shot the graphic
 * spans: each place is scored by the most of the subject it covers on any of the frames under it
 * (`maps`, one `subjectMap` a shot), and the designed place (`designed`, else the first) is kept unless
 * another clears the subject by SUBJECT_MOVE_RATIO and SUBJECT_MIN_GAIN — the earliest of the best on
 * a tie. A graphic crosses a cut as one drawing, so one place serves both pictures: job 412's
 * nocturnal-myth sat over the duvet on the first and across the cat's eye on the second. Pure.
 */
export function clearSpot(spots: Spots, size: Size, maps: number[][], frame: { w: number; h: number }, designed?: Place): SpotChoice {
  const same = (a: Place, b: Place) => a.h === b.h && a.v === b.v;
  const home = designed && spots.places.some(p => same(p, designed)) ? designed : spots.places[0];
  const scores = spots.places.map(place => ({
    place,
    on: maps.length ? Math.max(...maps.map(m => onSubject(m, spots.box(place, size), frame.w, frame.h))) : 0,
  }));
  const mine = scores.find(s => same(s.place, home))!;
  const best = scores.reduce((a, b) => (b.on < a.on - 1e-9 ? b : a));
  const moved = !same(best.place, home) && best.on <= SUBJECT_MOVE_RATIO * mine.on && mine.on - best.on >= SUBJECT_MIN_GAIN;
  return { place: moved ? best.place : home, from: home, moved, scores };
}
