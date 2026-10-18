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
import {
  ArrowCaption,
  BarChart,
  BigNumberOverlay,
  Checklist,
  CrossedList,
  FactCard,
  IconCallout,
  ListWindow,
  MythStamp,
  NumberLabel,
  SmallLabel,
  TermWindow,
  TitleOverFootage,
  YesNoCard,
} from "./more";

export type Kind = "card" | "overlay";

export type TemplateDef = {
  id: string;
  kind: Kind;
  /** What the footage under an overlay should do for its length (assembly's job): blurred, or
   * scaled into the template's window (src/more.tsx WINDOW). */
  underlay?: "blur" | "window";
  /** Where it may go beyond the general rules: "broll" — it points at, or replaces, the picture;
   * "host" — it shows the host (a list beside the host's window). */
  on?: "broll" | "host";
  /** Its text can move to another part of the frame (`place`) to stay readable. */
  movable?: boolean;
  /** Takes the host's panel on a SPLIT (`props.panel`, src/plan/rules.ts `hostPanelFor`): the
   * finishing step sets it for every cue over a split, so the words stay beside the host and never
   * run across the seam onto the picture. */
  panel?: boolean;
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
    panel: true,
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

// Steve's remaining graphics (src/more.tsx). Samples are neutral: the planner fills every word
// from the script.
TEMPLATES.push(
  {
    id: "TitleOverFootage",
    kind: "overlay",
    dims: true,
    movable: true,
    component: TitleOverFootage,
    defaultProps: { durationSec: 4, phrase: { text: "The alarm on your ceiling is the wrong one.", at: 0.3 }, emphasis: ["wrong"] },
  },
  {
    id: "SmallLabel",
    kind: "overlay",
    on: "broll",
    movable: true,
    component: SmallLabel,
    defaultProps: { durationSec: 3, text: "the bedroom door", at: 0.3 },
  },
  {
    id: "BigNumberOverlay",
    kind: "overlay",
    dims: true,
    component: BigNumberOverlay,
    defaultProps: { durationSec: 5, kicker: "Smoke alarms expire", value: 10, unit: "years", at: 0.4, countSec: 0.6, line: { text: "the unit is finished", at: 1.6 } },
  },
  {
    id: "NumberLabel",
    kind: "overlay",
    on: "broll",
    component: NumberLabel,
    defaultProps: { durationSec: 5, kicker: "Time to escape", a: { label: "Then", value: "17 min", at: 0.3 }, b: { label: "Now", value: "3 min", at: 1.6 } },
  },
  {
    id: "BarChart",
    kind: "overlay",
    dims: true,
    component: BarChart,
    defaultProps: {
      durationSec: 5,
      title: "Time to escape",
      bars: [
        { label: "Older furniture", value: 17, display: "17 minutes", at: 0.3 },
        { label: "Today's foam furniture", value: 3, display: "3 minutes", at: 1.8 },
      ],
    },
  },
  {
    id: "Checklist",
    kind: "overlay",
    on: "broll",
    component: Checklist,
    defaultProps: {
      durationSec: 5,
      title: "On the label",
      items: [
        { text: "Photoelectric", at: 0.4 },
        { text: "Sealed 10-year battery", at: 1.6 },
        { text: "Interconnected", at: 2.8 },
      ],
    },
  },
  {
    id: "CrossedList",
    kind: "overlay",
    on: "broll",
    component: CrossedList,
    defaultProps: {
      durationSec: 5,
      items: [
        { text: "Not broken", icon: "1f527", at: 0.3 },
        { text: "Not dead", icon: "1f50b", at: 1.4 },
        { text: "The wrong type", icon: "1f6a8", at: 2.6, keep: true },
      ],
    },
  },
  {
    id: "MythStamp",
    kind: "overlay",
    on: "broll",
    movable: true,
    component: MythStamp,
    defaultProps: { durationSec: 4, at: 0.6, phrase: { text: "Any alarm will wake you up.", at: 0.2 } },
  },
  {
    id: "YesNoCard",
    kind: "card",
    component: YesNoCard,
    defaultProps: { durationSec: 5, kicker: "Will it wake you?", question: { text: "Will the cheap one catch a smoldering fire in time?", at: 0.2 }, answer: "no", at: 2.8 },
  },
  {
    id: "FactCard",
    kind: "card",
    component: FactCard,
    defaultProps: { durationSec: 5, fact: { text: "Most fire deaths happen at night, while people sleep.", at: 0.3 }, emphasis: ["night,"] },
  },
  {
    id: "TermWindow",
    kind: "overlay",
    underlay: "window",
    on: "broll",
    component: TermWindow,
    defaultProps: { durationSec: 5, term: "Photoelectric", at: 0.3, meaning: { text: "sees the slow, smoldering fire earlier", at: 1.4 } },
  },
  {
    id: "ListWindow",
    kind: "overlay",
    underlay: "window",
    on: "broll",
    component: ListWindow,
    defaultProps: {
      durationSec: 5,
      title: "Check yours tonight",
      items: [
        { text: "Get a stepladder", at: 0.3 },
        { text: "Take one alarm down", at: 1.4 },
        { text: "Read the label", at: 2.5 },
      ],
    },
  },
  {
    id: "HostListWindow",
    kind: "overlay",
    underlay: "window",
    on: "host",
    component: ListWindow,
    defaultProps: {
      durationSec: 6,
      title: "In this video",
      items: [
        { text: "The type", at: 0.3 },
        { text: "The power", at: 1.6 },
        { text: "Interconnection", at: 2.9 },
      ],
    },
  },
  {
    id: "ArrowCaption",
    kind: "overlay",
    dims: true,
    movable: true,
    component: ArrowCaption,
    defaultProps: { durationSec: 4, phrase: { text: "A plastic disc doing absolutely nothing.", at: 0.2 }, emphasis: ["nothing."] },
  },
  {
    id: "IconCallout",
    kind: "overlay",
    on: "broll",
    movable: true,
    component: IconCallout,
    defaultProps: { durationSec: 4, icon: "1f50b", phrase: { text: "The battery was pulled.", at: 0.3 }, emphasis: ["pulled."] },
  }
);
// DimCaption's text can move too (it takes `place`).
TEMPLATES.find(t => t.id === "DimCaption")!.movable = true;

export const templateById = (id: string): TemplateDef => {
  const t = TEMPLATES.find(x => x.id === id);
  if (!t) throw new Error(`Unknown template "${id}"`);
  return t;
};
