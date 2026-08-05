/**
 * Live integration A/B: does `grok-imagine-video` or `veo-video` handle a face /
 * reference image better? Uploads a local face image to R2, submits the same
 * image-to-video job (`videoInputMode: "keyframes"`) to both models, polls both to
 * a terminal state, and asserts each reached one. Logs a side-by-side comparison so
 * you can pick the model for host-face cutaways (see longformVideo `buildClipChain`).
 *
 * Gated — it hits the real 69Labs API (costs credits) and needs:
 *   SIXTYNINE_LABS_API_KEY, R2_* creds, and FACE_IMAGE_PATH pointing at a face
 *   image on disk. Skips cleanly when any of those is missing.
 *
 * Run just this: pnpm vitest run server/sixtynine-labs.test.ts
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { storagePut } from "./storage";

const BASE_URL = "https://69labs.vip";
const FACE_IMAGE_PATH = process.env.FACE_IMAGE_PATH || "";
const PROMPT =
  "A man stands in a sunny backyard vegetable garden, gesturing toward raised " +
  "garden beds as he speaks to the camera, natural daylight, cinematic, handheld.";
const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED", "ERROR"];

const apiKey = process.env.SIXTYNINE_LABS_API_KEY;
const hasR2 =
  !!process.env.R2_ACCOUNT_ID &&
  !!process.env.R2_ACCESS_KEY_ID &&
  !!process.env.R2_SECRET_ACCESS_KEY &&
  !!process.env.R2_BUCKET;
const canRun = !!apiKey && hasR2 && existsSync(FACE_IMAGE_PATH);

type JobResult = {
  model: string;
  status: string;
  ms: number;
  width?: number;
  height?: number;
  message?: string;
  submitError?: string;
};

const contentTypeFor = (file: string): string => {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
};

async function runModel(model: string, imageUrl: string): Promise<JobResult> {
  const body: Record<string, any> = {
    prompt: PROMPT,
    model,
    aspectRatio: "16:9",
    imageUrls: [imageUrl],
    videoInputMode: "keyframes",
  };
  if (model === "grok-imagine-video") body.duration = "6";

  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/v1/videos/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.id) {
    return {
      model,
      status: "SUBMIT_FAILED",
      ms: Date.now() - start,
      submitError: `${res.status} ${JSON.stringify(data)?.slice(0, 300)}`,
    };
  }
  const jobId = data.id as string;

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const pr = await fetch(`${BASE_URL}/api/v1/videos/status/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const pj: any = await pr.json().catch(() => null);
    const status = pj?.status ?? "UNKNOWN";
    if (TERMINAL.includes(status)) {
      return {
        model,
        status,
        ms: Date.now() - start,
        width: pj?.outputMetadata?.width,
        height: pj?.outputMetadata?.height,
        message: pj?.userMessage,
      };
    }
  }
  return { model, status: "TIMEOUT", ms: Date.now() - start };
}

describe.skipIf(!canRun)("69Labs image handling: grok vs veo (live)", () => {
  it(
    "submits the face image to both models and compares which completes",
    async () => {
      const bytes = readFileSync(FACE_IMAGE_PATH);
      const { url } = await storagePut(
        `diagnostics/face-ab-test.png`,
        bytes,
        contentTypeFor(FACE_IMAGE_PATH)
      );

      const results = await Promise.all([
        runModel("grok-imagine-video", url),
        runModel("veo-video", url),
      ]);

      // eslint-disable-next-line no-console
      console.log(
        "\n[69Labs A/B]\n" +
          results
            .map(
              r =>
                `  ${r.model}: status=${r.status} time=${(r.ms / 1000).toFixed(
                  1
                )}s${r.width ? ` dims=${r.width}x${r.height}` : ""}${
                  r.submitError ? ` submitErr=${r.submitError}` : ""
                }${r.message ? ` msg=${r.message}` : ""}`
            )
            .join("\n")
      );

      // Both must reach a terminal state (not hang).
      for (const r of results) {
        expect(TERMINAL).toContain(r.status);
      }
      // At least one model must successfully handle the image end-to-end.
      expect(results.some(r => r.status === "COMPLETED")).toBe(true);
    },
    { timeout: 8 * 60 * 1000 }
  );
});

if (!canRun) {
  describe("69Labs image handling A/B (skipped)", () => {
    it("requires SIXTYNINE_LABS_API_KEY, R2_* creds, and the face image on disk", () => {
      expect(true).toBe(true);
    });
  });
}
