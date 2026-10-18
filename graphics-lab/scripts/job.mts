// Reads one finished job from the LOCAL dev database (read only) through the docker MySQL
// container, and caches it under out/jobs/<id>/job.json so later runs need no database.
import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { outDir } from "./lib.mts";
import { pictureOf, type PictureSource, type ScenePicture } from "../../graphics/src/plan/pictures.ts";

export type JobScene = {
  index: number;
  scriptText: string;
  narrationStartSec: number;
  narrationEndSec: number;
  hostPresent?: boolean;
  cta?: boolean;
  /** A split host scene: host panel on the left, a picture on the right. */
  split?: boolean;
  /** The locked cold open: the host's name tag (lower third) is up over its leading run. */
  hostOpener?: boolean;
} & ScenePicture;

export type Job = {
  id: number;
  finalVideoUrl: string;
  masterAudioUrl: string;
  scenes: JobScene[];
};

export function loadJob(id: number): Job {
  const cache = path.join(outDir("jobs", String(id)), "job.json");
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const container = process.env.MYSQL_CONTAINER ?? "auto-edit-tool-mysql-1";
  const q = `select json_object('finalVideoUrl', finalVideoUrl, 'masterAudioUrl', masterAudioUrl, 'storyboard', storyboard) from longform_video_jobs where id=${Number(id)}`;
  const raw = execFileSync("docker", ["exec", container, "mysql", "-ulongform", "-plongform", "longform", "-N", "-B", "-r", "-e", q], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 << 20,
  }).trim();
  const row = JSON.parse(raw) as { finalVideoUrl: string; masterAudioUrl: string; storyboard: unknown };
  const sb = typeof row.storyboard === "string" ? JSON.parse(row.storyboard) : row.storyboard;
  const scenes = ((sb as { scenes?: JobScene[] }).scenes ?? (sb as JobScene[])).map(s => ({
    index: s.index,
    scriptText: s.scriptText,
    narrationStartSec: s.narrationStartSec,
    narrationEndSec: s.narrationEndSec,
    hostPresent: !!s.hostPresent,
    cta: !!s.cta,
    split: !!(s as { splitRightUrl?: string }).splitRightUrl,
    hostOpener: !!(s as { hostOpener?: boolean }).hostOpener,
    // What a b-roll picture is and shows, read as the app reads it (`pictureOf`), so a lab plan is
    // held to the same picture checks. A job cached before this has none, and the checks pass it.
    ...pictureOf(s as PictureSource),
  }));
  const job: Job = { id, finalVideoUrl: row.finalVideoUrl, masterAudioUrl: row.masterAudioUrl, scenes };
  writeFileSync(cache, JSON.stringify(job, null, 1));
  return job;
}

/** Where the host's name tag is up (graphics/src/plan/rules.ts). */
export { nameTagRange } from "../../graphics/src/plan/rules.ts";
