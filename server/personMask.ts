/**
 * Where the PERSON is in every frame of a clip — Google's MediaPipe selfie segmenter (landscape,
 * 256×144, Apache-2.0, `server/assets/selfie-landscape.onnx` from onnx-community on Hugging Face),
 * run offline on the CPU through onnxruntime-web's WebAssembly backend (~0.1 ms a frame, no paid
 * service, no native binary to break on the deploy). Used by the room freeze (`hostSteady.ts`) to
 * keep the room still right up to the host's edge in each frame. Any failure returns null and the
 * caller keeps its old behaviour.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFfmpeg } from "./ffmpegSpawn";

export const PW = 256;
export const PH = 144;
/** A pixel is the person at or above this probability. */
const PERSON_LEVEL = 0.5;

type Model = { ort: typeof import("onnxruntime-web"); session: import("onnxruntime-web").InferenceSession };
let loading: Promise<Model> | null = null;

function loadModel(): Promise<Model> {
  if (!loading) {
    loading = (async () => {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.numThreads = 1;
      // server/assets in dev, dist/assets in prod (the build copies it).
      const file = fileURLToPath(new URL("./assets/selfie-landscape.onnx", import.meta.url));
      const session = await ort.InferenceSession.create(readFileSync(file));
      return { ort, session };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Per frame, the person (1) at PW×PH, in decode order; null when the model or decode fails. */
export async function personMasks(file: string): Promise<Uint8Array[] | null> {
  try {
    const { ort, session } = await loadModel();
    const { stdout } = await execFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${PW}:${PH}`,
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-"],
      { encoding: "buffer", maxBuffer: 1 << 30 }
    );
    const raw = stdout as unknown as Buffer;
    const size = PW * PH;
    const n = Math.floor(raw.length / (size * 3));
    const input = new Float32Array(size * 3);
    const masks: Uint8Array[] = [];
    for (let k = 0; k < n; k++) {
      const rgb = raw.subarray(k * size * 3, (k + 1) * size * 3);
      for (let i = 0; i < size; i++) {
        input[i] = rgb[i * 3] / 255;
        input[size + i] = rgb[i * 3 + 1] / 255;
        input[2 * size + i] = rgb[i * 3 + 2] / 255;
      }
      const out = await session.run({
        [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, PH, PW]),
      });
      const alpha = out[session.outputNames[0]].data as Float32Array;
      const mask = new Uint8Array(size);
      for (let i = 0; i < size; i++) mask[i] = alpha[i] >= PERSON_LEVEL ? 1 : 0;
      masks.push(mask);
    }
    return masks.length ? masks : null;
  } catch (err: any) {
    console.warn(`[PersonMask] no person cutout — ${err?.message ?? err}`);
    return null;
  }
}
