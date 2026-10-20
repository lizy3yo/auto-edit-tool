/**
 * A cutaway's prompt is written for what the shot will be, and a rewrite that is not its picture is
 * refused (2026-10-20, job 413 scenes 9-10, Gary's garage businesses: both pictures shipped the
 * hands-at-work VIDEO directive they were given, reworded, as their description). Lines, subjects and
 * answers are the real ones from the local storyboards.
 */
import { describe, expect, it } from "vitest";
import type { StoryboardScene } from "@shared/types";
import {
  cutawayPromptLane,
  leavesOutSubject,
  leftMotionLane,
  repeatsDirective,
  rewriteFallback,
  rewriteFault,
} from "./brollRewrite";

// The directive scenes 9-10 were handed (retired by this fix — no hands video is ever made).
const OLD_HANDS_DIRECTIVE =
  "IMPORTANT: this is a VIDEO cutaway with hands at work — the narration implies a manual " +
  "action. For this one prompt, override the paused/at-rest rule for the hands ONLY: describe " +
  "bare weathered hands already in frame and mid-task from the start (fingers on the tool, " +
  "pressing or adjusting what they work on), never entering from off-screen and never paused " +
  "on a finished result. Keep everything else at rest — no face, head, or body, and no broad " +
  "arm movement. The hands hold realistic anatomy with no extra fingers.";
// What both scenes came back as.
const ANSWER_413 =
  "Bare weathered hands with fingers already on a tool or workbench task, pressing or adjusting what " +
  "they work on. Wooden workbench, pegboard wall, and tools visible in the background. No face, head, " +
  "shoulders, or body visible.";
// The person-free rule every cutaway is still given.
const PERSON_FREE =
  "IMPORTANT: this cutaway must show NO PERSON — no face, head, hair, shoulders, torso, legs, " +
  "silhouette, reflection, or anyone in the background. If the original names or implies a " +
  "person (a man, a gardener, a homeowner, someone watching or inspecting), rewrite them out: " +
  "keep the object, tool, task, or result they interact with, or reduce them to a pair of bare " +
  "hands at the work, framed so nothing above the forearms is in shot.";

const SCENE_9 = {
  showSubject: "the host working at his garage workbench with tools around him",
  scriptText:
    "and Gary’s Garage Secrets is for working people who want extra income with numbers a neighbor would believe — no apps, no coins, no course-sellers.",
};
const SCENE_10 = {
  showSubject: "the host pulling a stool up to the garage workbench and opening a notebook",
  scriptText: "Here’s tonight’s deal:",
};

const cut = (over: Partial<StoryboardScene>): StoryboardScene =>
  ({ index: 1, narration: "n", visualPrompt: "vp", hostPresent: false, ...over }) as StoryboardScene;

describe("cutawayPromptLane — written for what the video rule will make the shot", () => {
  it("job 413 scenes 9-10: a shot of the host at the bench is written as a photo, though the balancer had made it moving", () => {
    // As the prompt writer saw them: moving, a person in them.
    for (const s of [SCENE_9, SCENE_10])
      expect(cutawayPromptLane(cut({ ...s, visualPrompt: s.showSubject, stillImage: false, humanPresent: true }))).toBe("still");
    // …and as they shipped, after the gate.
    expect(
      cutawayPromptLane(cut({ ...SCENE_9, stillImage: true, humanPresent: true, selfMoving: false }))
    ).toBe("still");
  });

  it("a thing that moves by itself is still written as a video, and a photo of it caught mid-motion keeps that wording", () => {
    const steam = { showSubject: "steam rising from a kettle on the stove", objectMotion: true as const };
    expect(cutawayPromptLane(cut({ ...steam, stillImage: false }))).toBe("video");
    expect(cutawayPromptLane(cut({ ...steam, stillImage: false, selfMoving: true }))).toBe("video");
    expect(cutawayPromptLane(cut({ ...steam, stillImage: true }))).toBe("moving-thing");
  });

  it("a shot the rule will not let move is written as a photo: judged still, hands, a tool biting in", () => {
    expect(
      cutawayPromptLane(cut({ showSubject: "a sliding door in a quiet room", objectMotion: true, stillImage: false, selfMoving: false }))
    ).toBe("still");
    expect(
      cutawayPromptLane(cut({ showSubject: "hands pouring water into a pot", objectMotion: true, stillImage: false }))
    ).toBe("still");
    expect(
      cutawayPromptLane(cut({ showSubject: "a drill boring into an oak board", objectMotion: true, stillImage: false, toolContact: true }))
    ).toBe("still");
    expect(cutawayPromptLane(cut({ showSubject: "a quiet workbench", stillImage: true }))).toBe("still");
  });
});

describe("leftMotionLane — a shot written for motion that is now a photo is written again", () => {
  it("the self-moving judge found nothing moving by itself, and the gate made the shot a photo", () => {
    expect(
      leftMotionLane(cut({ showSubject: "a sliding door in a quiet room", promptLane: "video", stillImage: true, selfMoving: false }))
    ).toBe(true);
  });

  it("a thing that still moves, made a photo only for the video share, keeps its in-motion wording (no call)", () => {
    // `removeMotion` / `capMovingLength` clear `objectMotion` as they make it a photo; the steam still
    // rises by itself, and the plain-photo rewrite's settled-instant rule would settle it away.
    const steam = { showSubject: "steam rising from a kettle on the stove", promptLane: "video" as const };
    expect(leftMotionLane(cut({ ...steam, stillImage: true, objectMotion: undefined, selfMoving: true }))).toBe(false);
    // Never judged (mock mode, or the judge's batch failed): the planner's call stands.
    expect(leftMotionLane(cut({ ...steam, stillImage: true, objectMotion: undefined }))).toBe(false);
  });

  it("left alone: still moving, still caught mid-motion, written as a photo, never written, a host take, a CTA", () => {
    const steam = { showSubject: "steam rising from a kettle on the stove", objectMotion: true as const };
    expect(leftMotionLane(cut({ ...steam, promptLane: "video", stillImage: false }))).toBe(false);
    expect(leftMotionLane(cut({ ...steam, promptLane: "video", stillImage: true }))).toBe(false);
    expect(leftMotionLane(cut({ ...SCENE_9, promptLane: "still", stillImage: true, humanPresent: true }))).toBe(false);
    expect(leftMotionLane(cut({ ...SCENE_9, stillImage: true, humanPresent: true }))).toBe(false);
    expect(leftMotionLane(cut({ promptLane: "video", stillImage: true, hostPresent: true }))).toBe(false);
    expect(leftMotionLane(cut({ promptLane: "video", stillImage: true, cta: true }))).toBe(false);
  });
});

describe("rewriteFault — a rewrite that is not its picture", () => {
  it("job 413: both answers repeat the directive they were given; scene 10's also leaves out its stool and notebook", () => {
    expect(repeatsDirective(ANSWER_413, [OLD_HANDS_DIRECTIVE], [SCENE_9.showSubject, SCENE_9.scriptText].join(" "))).toBe(true);
    expect(rewriteFault(ANSWER_413, SCENE_9, SCENE_9.showSubject, [OLD_HANDS_DIRECTIVE])).toBe("directive");
    expect(rewriteFault(ANSWER_413, SCENE_10, SCENE_10.showSubject, [OLD_HANDS_DIRECTIVE])).toBe("directive");
    // Without the directive to compare against (it is no longer sent), scene 10's is still refused…
    expect(rewriteFault(ANSWER_413, SCENE_10, SCENE_10.showSubject, [PERSON_FREE])).toBe("subject");
    expect(leavesOutSubject(ANSWER_413, SCENE_10.showSubject)).toBe(true);
    // …while scene 9's names three of its four words (work, workbench, tools): the photo lane is its fix.
    expect(leavesOutSubject(ANSWER_413, SCENE_9.showSubject)).toBe(false);
  });

  it("the neighbouring good rewrites of job 413 stand (scenes 11-12)", () => {
    const s11 = {
      showSubject:
        "the guided knife-sharpening unit on the workbench with a kitchen knife clamped in its guide and the host's hands drawing a stone along the edge",
      scriptText: "seventeen businesses,",
    };
    const s12 = {
      showSubject: "the host's hands tallying receipts with a pencil beside a calculator on the workbench",
      scriptText: "the true cost to start each one,",
    };
    expect(
      rewriteFault(
        "A guided knife-sharpening unit clamped to a garage workbench with a kitchen knife held in its metal guide, bare weathered hands pressing an abrasive stone along the blade edge, concrete floor and tool pegboard in the background.",
        s11,
        s11.showSubject,
        [PERSON_FREE, OLD_HANDS_DIRECTIVE]
      )
    ).toBeUndefined();
    expect(
      rewriteFault(
        "Bare weathered hands at a garage workbench holding a pencil over scattered receipts, a calculator resting nearby on the wood surface, workbench edge and tools visible at the frame edges.",
        s12,
        s12.showSubject,
        [PERSON_FREE, OLD_HANDS_DIRECTIVE]
      )
    ).toBeUndefined();
  });

  it("the person-free rule's own stand-in is no repeat (jobs 140, 141)", () => {
    expect(
      repeatsDirective(
        "A close-up from the doer's perspective showing a pair of bare hands at the treadle sewing machine, working a completed apron through the needle, the wooden treadle visible below the work surface as the seams are being finished, the rhythm of the hand-powered machine evident in the steadiness of the stitching.",
        [PERSON_FREE],
        "It takes about fifty minutes on the treadle."
      )
    ).toBe(false);
    expect(
      repeatsDirective(
        "A pair of bare weathered adult hands positioned from waist-height, holding an assembled cedar planter box steady on the workshop bench, the box's corner joints and exterior screws visible, hands and forearms only—no face, head, or body in shot.",
        [PERSON_FREE, OLD_HANDS_DIRECTIVE],
        "Cut your sides, screw the box together with exterior screws, drill a couple of drain holes in the bottom,"
      )
    ).toBe(false);
  });

  it("a rewrite of something else entirely is refused (job 409 scene 28, job 259 scene 12)", () => {
    const s28 = {
      showSubject: "the host reading a book at the desk in the study",
      scriptText:
        "The essay is called On the Shortness of Life, and it opens by picking a fight with its own title. Everyone complains that life is too short, Seneca says.",
    };
    expect(rewriteFault("a farmer standing in a field, seen from behind", s28, s28.showSubject, [PERSON_FREE])).toBe("subject");
    const alarm = {
      showSubject: "A close-up of the smoke alarm's domed face, showing its sensor grille and test button.",
      scriptText: "First thing on the label. The type. Ionization is quick on open flame,",
    };
    expect(
      rewriteFault(
        "Two alarm boxes on a retail shelf: one labeled ionization multipack, one photoelectric unit, boxes side by side showing their printed graphics and product names clearly.",
        alarm,
        alarm.showSubject,
        [PERSON_FREE]
      )
    ).toBe("subject");
  });

  it("a subject made of the line's own words is the rewrite's to make concrete (jobs 355, 338)", () => {
    // The group picture before a list…
    expect(
      rewriteFault(
        "A tan paper feed sack, a galvanized metal feed tin with snap-fit lid, and a plain ceramic bowl of kitchen scraps laid out side by side on a garage workbench.",
        {
          showSubject:
            "find every leak in that bag, plug them one at a time and fill the gaps with cheaper food together, laid out side by side",
          scriptText: "a fifty-pound feed bag into the truck, pull up a bucket and sit with me. We're going to",
          listSet: true,
        },
        "find every leak in that bag, plug them one at a time and fill the gaps with cheaper food together, laid out side by side",
        [PERSON_FREE]
      )
    ).toBeUndefined();
    // …and a step.
    expect(
      rewriteFault(
        "A pair of bare hands paused over the walnut and maple cutting board on the workbench, tools hung organized on the pegboard wall behind, garage workshop interior.",
        {
          showSubject: "the host's hands, mid-step: let every piece find its lane, while making the cutting board",
          scriptText: "and let every piece find its lane.",
          listCut: true,
        },
        "the host's hands, mid-step: let every piece find its lane, while making the cutting board",
        [PERSON_FREE]
      )
    ).toBeUndefined();
  });

  it("a paraphrase that keeps its subject stands; a subject too short to judge is not judged", () => {
    expect(
      leavesOutSubject(
        "A rat at ground level in dim light, mouth open around a tan feed pellet, with more scattered pellets visible in the dirt nearby.",
        "a rat carrying a pellet away from the scattered pellets beneath the feeder in the dark"
      )
    ).toBe(false);
    expect(leavesOutSubject("an oak board on the bench", "a saw")).toBe(false);
    expect(leavesOutSubject("an oak board on the bench", undefined)).toBe(false);
  });
});

describe("rewriteFallback — the scene's own words", () => {
  it("job 413 scene 10 goes back to its own description", () => {
    expect(rewriteFallback(SCENE_10, SCENE_10.showSubject)).toBe(SCENE_10.showSubject);
  });

  it("a seed that has itself left the subject behind gives way to the subject", () => {
    expect(rewriteFallback(SCENE_10, "a stack of feed sacks against the garage wall")).toBe(SCENE_10.showSubject);
    // No subject: the seed, whatever it says.
    expect(rewriteFallback({}, "a stack of feed sacks")).toBe("a stack of feed sacks");
  });
});
