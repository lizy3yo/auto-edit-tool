// One list of every template: its composition id, whether it is a full-screen CARD (opaque MP4)
// or an OVERLAY (transparent ProRes 4444), and sample props from Frederick Barnes' smoke-alarm
// script (job 376) so the Studio opens on real words. Render scripts read `kind` from here, so a
// template cannot be rendered with the wrong codec.
import type React from "react";
import {
  BeforeAfterCard,
  BigNumberCard,
  MythTruthCard,
  StatementCard,
  StepCardsCard,
  TwoPointCard,
  VersusCard,
} from "./cards";
import {
  ChapterLabel,
  DimCaption,
  HostCaption,
  IconLabels,
  QuoteCard,
  StepLabels,
  WarningLabel,
} from "./overlays";

export type Kind = "card" | "overlay";

export type TemplateDef = {
  id: string;
  kind: Kind;
  /** What the footage under an overlay should do for its length (assembly's job). */
  underlay?: "blur";
  /** Darkens or blurs the whole frame: held to b-roll like a card, never over a host take. */
  dims?: boolean;
  /** A TITLE, not a caption (a chapter label): keeps its planned length instead of leaving when
   * its words are done. */
  structural?: boolean;
  component: React.FC<any>;
  defaultProps: Record<string, unknown> & { durationSec: number };
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "Statement",
    kind: "card",
    component: StatementCard,
    defaultProps: {
      durationSec: 5,
      kicker: "The slow one",
      headline: { text: "Thick, greasy smoke before a single flame.", at: 0.3 },
      emphasis: ["smoke"],
    },
  },
  {
    id: "MythTruth",
    kind: "card",
    component: MythTruthCard,
    defaultProps: {
      durationSec: 6,
      myth: { text: "The alarm's job is the flame.", at: 0.2 },
      truth: { text: "Its job is catching the slow part.", at: 2.6 },
      emphasis: ["slow"],
    },
  },
  {
    id: "Versus",
    kind: "card",
    component: VersusCard,
    defaultProps: {
      durationSec: 7,
      kicker: "First thing on the label",
      left: { icon: "1f525", title: "Ionization", sub: "Quick on open flame", at: 0.3 },
      right: { icon: "1f441", title: "Photoelectric", sub: "Sees the slow, smoldering fire", at: 2.8 },
      winner: "right",
    },
  },
  {
    id: "BigNumber",
    kind: "card",
    component: BigNumberCard,
    defaultProps: {
      durationSec: 5,
      kicker: "Today's foam furniture",
      value: 3,
      unit: "minutes",
      at: 0.4,
      line: { text: "from smoking to fully involved", at: 1.6 },
    },
  },
  {
    id: "StepCards",
    kind: "card",
    component: StepCardsCard,
    defaultProps: {
      durationSec: 6,
      kicker: "Check yours tonight",
      steps: [
        { text: "Get a stepladder", icon: "1fa9c", at: 0.3 },
        { text: "Take one alarm down", icon: "1f514", at: 1.5 },
        { text: "Read the label", icon: "1f3f7", at: 2.7 },
      ],
    },
  },
  {
    id: "BeforeAfter",
    kind: "card",
    component: BeforeAfterCard,
    defaultProps: {
      durationSec: 6,
      kicker: "Second thing: power",
      before: { icon: "1f50b", label: "Old 9-volt battery", at: 0.3 },
      after: { icon: "1f4e6", label: "Sealed 10-year unit", at: 2.4 },
    },
  },
  {
    id: "TwoPoint",
    kind: "card",
    component: TwoPointCard,
    defaultProps: {
      durationSec: 6,
      title: { text: "When one alarm goes off, every alarm goes off", at: 0.2 },
      a: { label: "Basement", sub: "the alarm that hears it", at: 1.6 },
      b: { label: "Your pillow", sub: "six feet away", at: 3.0 },
    },
  },
  {
    id: "ChapterLabel",
    kind: "overlay",
    structural: true,
    component: ChapterLabel,
    defaultProps: { durationSec: 5, kicker: "On the label · 1 of 3", number: 1, title: "The type" },
  },
  {
    id: "StepLabels",
    kind: "overlay",
    component: StepLabels,
    defaultProps: {
      durationSec: 5,
      steps: [
        { text: "Get a stepladder", at: 0.2 },
        { text: "Take one alarm down", at: 1.2 },
        { text: "Read the label", at: 2.4 },
      ],
    },
  },
  {
    id: "WarningLabel",
    kind: "overlay",
    component: WarningLabel,
    defaultProps: {
      durationSec: 4,
      text: { text: "No date at all? It's old enough.", at: 0.2 },
      emphasis: ["old"],
    },
  },
  {
    id: "IconLabels",
    kind: "overlay",
    component: IconLabels,
    defaultProps: {
      durationSec: 4,
      items: [
        { icon: "2705", text: "Photoelectric", at: 0.2 },
        { icon: "2705", text: "Dual sensor", at: 1.4 },
      ],
    },
  },
  {
    id: "HostCaption",
    kind: "overlay",
    component: HostCaption,
    defaultProps: {
      durationSec: 4,
      phrase: { text: "It isn't broken. It isn't dead.", at: 0.2 },
      emphasis: ["dead."],
    },
  },
  {
    id: "DimCaption",
    kind: "overlay",
    dims: true,
    component: DimCaption,
    defaultProps: {
      durationSec: 4,
      phrase: { text: "A plastic disc doing absolutely nothing.", at: 0.2 },
      emphasis: ["nothing."],
    },
  },
  {
    id: "Quote",
    kind: "overlay",
    dims: true,
    underlay: "blur",
    component: QuoteCard,
    defaultProps: {
      durationSec: 5,
      quote: { text: "Close the bedroom doors at night.", at: 0.3 },
      author: "Frederick Barnes",
      emphasis: ["doors"],
    },
  },
];

export const templateById = (id: string): TemplateDef => {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) throw new Error(`Unknown template "${id}"`);
  return t;
};
