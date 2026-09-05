/**
 * server/lipsyncBatch.ts — several host beats in ONE InfiniteTalk call.
 *
 * Every host scene used to be its own RunPod job, and each job paid for frames nobody sees:
 * the 2 s run-up (`server/lipsyncLead.ts`) and the padding out to the end of the last 81-frame
 * render window — about 40% of the frames on a 5 s beat. A GROUP render pays for both once:
 * the host scenes of a film are taken in storyboard order and packed, up to
 * `RUNPOD_LIPSYNC_BATCH` beats and `RUNPOD_LIPSYNC_BATCH_MAX_SEC` of narration per call, into
 * one track — run-up, beat, a short room-tone gap so she settles between beats, beat, gap,
 * beat — rendered as one clip and cut back into per-scene clips at known offsets. Each piece
 * then gets exactly what a solo render gets: its own clean narration from the master, the
 * seam repair (run once on the whole group clip), and its split-screen composite.
 *
 * The LEADER is the group's first scene: it carries the provider task id and the cut list,
 * so a resume re-polls one job and cuts the same pieces. A member whose leader is gone
 * (completed or failed without cutting it) renders solo — paid again, never lost. Beats are
 * only grouped when they share the host photo and, with host plates on, the plate; a scene
 * voiced off the master (no range) renders solo, since its clean narration cannot be cut.
 *
 * Group size is a dial, default 2: the per-job GPU cap (`RUNPOD_LIPSYNC_EXECUTION_TIMEOUT_MS`,
 * 40 min) has to hold the whole group, and a beat costs ~6-14 min today. Raise it once the
 * compiler and the step cut have landed.
 */
import path from "path";
import os from "os";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import type { StoryboardScene } from "../shared/types";
import {
  runFfmpeg,
  downloadToTemp,
  sliceAudioSegments,
  probeBufferDurationSec,
} from "./videoAssembly";
import { storagePut } from "./storage";
import { prependSilence } from "./lipsyncLead";
import { ROOM_TONE_AMPLITUDE } from "./delivery";

/** Room-tone beat between two grouped scenes: enough for the mouth to close and settle. */
export const GROUP_GAP_MS = 500;

export interface GroupCut {
  index: number;
  /** Seconds into the DELIVERED group clip (run-up already trimmed) where this scene starts. */
  startSec: number;
  durationSec: number;
}

export interface GroupPlan {
  leader: StoryboardScene;
  members: StoryboardScene[]; // excludes the leader
}

/**
 * The plate a scene syncs from: photo choice plus, with host plates on, the plate itself.
 * NOT the plate CONTEXT: the storyboard writes a context string on every host scene whether
 * or not plates are generated, and keying on it left every real film ungrouped (two solo
 * calls, 1,859 GPU-s, where one call would have done).
 */
const plateKeyOf = (s: StoryboardScene) =>
  `${s.hostShot ?? 0}|${s.hostPlateUrl ?? ""}`;
const onMaster = (s: StoryboardScene) =>
  s.narrationStartSec != null &&
  s.narrationEndSec != null &&
  s.narrationEndSec > s.narrationStartSec;
const narrationSecOf = (s: StoryboardScene) =>
  onMaster(s)
    ? (s.narrationEndSec as number) - (s.narrationStartSec as number)
    : (s.audioDuration ?? 0);

/**
 * Pack host scenes (any order; sorted by index here) into groups. Pure.
 * A scene that already holds provider task ids (a resume) is never re-planned.
 */
export function planLipsyncGroups(
  hostScenes: StoryboardScene[],
  opts: { maxScenes: number; maxSec: number }
): GroupPlan[] {
  const sorted = [...hostScenes].sort((a, b) => a.index - b.index);
  const groups: GroupPlan[] = [];
  let cur: GroupPlan | null = null;
  let curSec = 0;
  const close = () => {
    if (cur) groups.push(cur);
    cur = null;
    curSec = 0;
  };
  for (const s of sorted) {
    const solo =
      opts.maxScenes <= 1 ||
      !onMaster(s) ||
      !!s.renderTaskIds?.length ||
      narrationSecOf(s) > opts.maxSec;
    if (solo) {
      close();
      groups.push({ leader: s, members: [] });
      continue;
    }
    const sec = narrationSecOf(s);
    const fits =
      cur &&
      plateKeyOf(cur.leader) === plateKeyOf(s) &&
      cur.members.length + 1 < opts.maxScenes &&
      curSec + GROUP_GAP_MS / 1000 + sec <= opts.maxSec;
    if (fits && cur) {
      cur.members.push(s);
      curSec += GROUP_GAP_MS / 1000 + sec;
    } else {
      close();
      cur = { leader: s, members: [] };
      curSec = sec;
    }
  }
  close();
  return groups;
}

/**
 * What the dispatcher runs: the LEADERS (each carrying its members) plus every solo scene,
 * never a member on its own. A scene already marked as a member (a resume) is re-attached to
 * its leader when that leader is in the batch too; otherwise it is released to render solo.
 * Fresh scenes are planned with `planLipsyncGroups`. Markers are written onto the scenes.
 */
export function assignLipsyncGroups(
  hostScenes: StoryboardScene[],
  opts: { maxScenes: number; maxSec: number }
): {
  dispatch: StoryboardScene[];
  membersOf: Map<StoryboardScene, StoryboardScene[]>;
} {
  const byIndex = new Map(hostScenes.map(s => [s.index, s]));
  const membersOf = new Map<StoryboardScene, StoryboardScene[]>();
  const dispatch: StoryboardScene[] = [];
  const fresh: StoryboardScene[] = [];
  for (const s of hostScenes) {
    const g = s.lipsyncGroup;
    if (g && g.leader !== s.index) {
      // A member from an earlier attempt: back to its leader if the leader is here too.
      const leader = byIndex.get(g.leader);
      if (leader && leader.lipsyncGroup?.members?.includes(s.index)) {
        membersOf.set(leader, [...(membersOf.get(leader) ?? []), s]);
        continue;
      }
      s.lipsyncGroup = undefined;
      dispatch.push(s);
    } else if (g && g.leader === s.index) {
      dispatch.push(s); // leader: members attach above
    } else fresh.push(s);
  }
  for (const grp of planLipsyncGroups(fresh, opts)) {
    dispatch.push(grp.leader);
    if (grp.members.length) {
      grp.leader.lipsyncGroup = {
        leader: grp.leader.index,
        members: grp.members.map(m => m.index),
      };
      for (const m of grp.members)
        m.lipsyncGroup = { leader: grp.leader.index };
      membersOf.set(grp.leader, grp.members);
    }
  }
  // A leader that lost every member (they completed or were released) renders solo.
  for (const s of dispatch)
    if (s.lipsyncGroup?.leader === s.index && !membersOf.get(s)?.length)
      s.lipsyncGroup = undefined;
  dispatch.sort((a, b) => a.index - b.index);
  return { dispatch, membersOf };
}

/**
 * Build the group's audio: the leader's run-up track (lead + leader narration, from
 * `lipsyncLead`) followed by each member's narration cut from the master, joined with
 * room-tone gaps. Returns the padded track for the worker, the un-padded track (what the
 * delivered group clip should carry after the lead is trimmed), the cut list in delivered
 * seconds, and the padded track's length (for the camera plate).
 */
export async function buildGroupTrack(opts: {
  jobId: number;
  leader: StoryboardScene;
  members: StoryboardScene[];
  masterAudioUrl: string;
  leadSec: number;
}): Promise<{
  url: string;
  narrationUrl: string;
  cuts: GroupCut[];
  leadSec: number;
  totalSec: number;
}> {
  const { jobId, leader, members, masterAudioUrl, leadSec } = opts;
  const all = [leader, ...members];
  for (const s of all)
    if (!onMaster(s))
      throw new Error(`scene ${s.index} has no master range — cannot group`);
  // Every piece from the master in one pass: the lead's preceding narration, then each
  // scene's own words.
  const lStart = leader.narrationStartSec as number;
  const fromMaster = Math.min(leadSec, lStart);
  const [leadBuf, ...plain] = await sliceAudioSegments(masterAudioUrl, [
    { startSec: lStart - fromMaster, lenSec: Math.max(0.1, fromMaster) },
    ...all.map(s => ({
      startSec: s.narrationStartSec as number,
      lenSec: Math.max(
        0.1,
        (s.narrationEndSec as number) - (s.narrationStartSec as number)
      ),
    })),
  ]);
  const silenceSec = leadSec - fromMaster;
  // Measure the real length of every piece: mp3 slices carry encoder padding, and the cuts
  // must land on the frame.
  const durs = await Promise.all(
    plain.map(b => probeBufferDurationSec(b, "mp3"))
  );
  const cuts: GroupCut[] = [];
  let t = 0;
  all.forEach((s, i) => {
    cuts.push({ index: s.index, startSec: t, durationSec: durs[i] });
    t += durs[i] + (i < all.length - 1 ? GROUP_GAP_MS / 1000 : 0);
  });
  // The un-padded track (what the delivered clip carries after the lead is trimmed) and the
  // padded one the worker gets: real preceding narration where the master has it, silence
  // for the rest — the same shape `buildLipsyncLeadTrack` gives a solo render.
  const narration = await joinWithGaps(plain, GROUP_GAP_MS);
  let padded =
    fromMaster >= 0.1 ? await joinWithGaps([leadBuf, narration], 0) : narration;
  if (silenceSec > 0.01) padded = await prependSilence(padded, silenceSec);
  const tag = randomUUID().slice(0, 6);
  const [{ url }, { url: narrationUrl }] = await Promise.all([
    storagePut(
      `longform/${jobId}/group-${leader.index}-lipsync-vo-${tag}.mp3`,
      padded,
      "audio/mpeg"
    ),
    storagePut(
      `longform/${jobId}/group-${leader.index}-lipsync-narration-${tag}.mp3`,
      narration,
      "audio/mpeg"
    ),
  ]);
  const totalSec = leadSec + t;
  console.log(
    `[LipsyncBatch] group ${all.map(s => s.index).join("+")}: ${leadSec}s run-up + ` +
      cuts
        .map(
          c =>
            `#${c.index} ${c.durationSec.toFixed(2)}s @${c.startSec.toFixed(2)}`
        )
        .join(", ") +
      ` (${GROUP_GAP_MS} ms gaps)`
  );
  return { url, narrationUrl, cuts, leadSec, totalSec };
}

/** Concatenate mp3 buffers with `gapMs` of room tone between each pair. */
async function joinWithGaps(parts: Buffer[], gapMs: number): Promise<Buffer> {
  if (parts.length === 1 && gapMs === 0) return parts[0];
  const dir = path.join(os.tmpdir(), `lipsync-batch-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const ins: string[] = [];
    const legs: string[] = [];
    const order: string[] = [];
    parts.forEach((b, i) => {
      const p = path.join(dir, `part-${i}.mp3`);
      writeFileSync(p, b);
      ins.push("-i", p);
      legs.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[r${i}]`
      );
      order.push(`[r${i}]`);
      if (gapMs > 0 && i < parts.length - 1) {
        legs.push(
          `anoisesrc=r=48000:a=${ROOM_TONE_AMPLITUDE}:c=pink:s=${i + 1},` +
            `atrim=end=${(gapMs / 1000).toFixed(3)},` +
            `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[g${i}]`
        );
        order.push(`[g${i}]`);
      }
    });
    const out = path.join(dir, "joined.mp3");
    await runFfmpeg([
      "-y",
      ...ins,
      "-filter_complex",
      `${legs.join(";")};${order.join("")}concat=n=${order.length}:v=0:a=1[a]`,
      "-map",
      "[a]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      out,
    ]);
    return readFileSync(out);
  } finally {
    cleanup(dir);
  }
}

/**
 * Cut one scene's piece out of the delivered group clip: `-ss`/`-t` with a re-encode (frame
 * accurate), the scene's own clean narration muxed from time 0 — the same treatment
 * `trimClipHead` gives a solo render.
 */
export async function cutGroupPiece(
  groupVideo: Buffer,
  cut: GroupCut,
  narrationUrl: string
): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), `lipsync-batch-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    const inPath = path.join(dir, "group.mp4");
    const outPath = path.join(dir, `piece-${cut.index}.mp4`);
    writeFileSync(inPath, groupVideo);
    const narrationPath = await downloadToTemp(
      narrationUrl,
      dir,
      "narration.mp3"
    );
    await runFfmpeg([
      "-y",
      "-ss",
      cut.startSec.toFixed(3),
      "-t",
      cut.durationSec.toFixed(3),
      "-i",
      inPath,
      "-i",
      narrationPath,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outPath,
    ]);
    return readFileSync(outPath);
  } finally {
    cleanup(dir);
  }
}

/** A delivered clip as a buffer, fetched the way every server-side read is (presigned). */
export async function downloadClip(url: string): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), `lipsync-batch-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  try {
    return readFileSync(await downloadToTemp(url, dir, "clip.mp4"));
  } finally {
    cleanup(dir);
  }
}

/** The scene's clean narration for a piece: cut from the master by range. */
export async function sceneNarrationFromMaster(
  jobId: number,
  scene: StoryboardScene,
  masterAudioUrl: string
): Promise<string> {
  const [buf] = await sliceAudioSegments(masterAudioUrl, [
    {
      startSec: scene.narrationStartSec as number,
      lenSec: Math.max(
        0.1,
        (scene.narrationEndSec as number) - (scene.narrationStartSec as number)
      ),
    },
  ]);
  const { url } = await storagePut(
    `longform/${jobId}/scene-${scene.index}-lipsync-narration-${randomUUID().slice(0, 6)}.mp3`,
    buf,
    "audio/mpeg"
  );
  return url;
}

function cleanup(dir: string) {
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort temp cleanup */
    }
  }
}
