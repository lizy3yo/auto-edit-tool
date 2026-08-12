# EchoMimicV3 RunPod serverless worker

Host lip-sync lane for longform-studio: **768×768 host still + narration audio → talking-head
mp4**, PUT to a presigned R2 URL. Driven by `server/providers/echomimic-lipsync.ts`.

There is no public prebuilt EchoMimicV3 worker (unlike `kodxana/whisperx-worker_v2` for
whisperx), which is why this exists.

## Why a Network Volume is not optional

EchoMimicV3 Flash needs roughly 15 GB of weights. Baked into the image, every cold start pays
to pull them. On a volume, workers mount them in seconds.

**One-time seed** — start a cheap on-demand Pod with the volume attached at `/workspace`:

```bash
pip install "huggingface_hub[cli]"
mkdir -p /workspace/echomimic && cd /workspace/echomimic
hf download alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP --local-dir Wan2.1-Fun-V1.1-1.3B-InP
hf download BadToBest/EchoMimicV3 --local-dir flash
```

Expected layout (the handler's paths depend on it):

```
/runpod-volume/echomimic/
  Wan2.1-Fun-V1.1-1.3B-InP/          # base diffusion model
  flash/
    transformer/diffusion_pytorch_model.safetensors
    chinese-wav2vec2-base/            # audio encoder
```

Verify the sub-paths against the HF repo after download — upstream has moved them before, and
a wrong path surfaces as a slow, confusing inference failure rather than a clean error.

## Build and deploy

**Preferred — let RunPod build it.** The image is 15 GB+; building locally means pushing all
of that up from your connection. RunPod builds it in their datacenter instead.

Commit this directory, push, then RunPod → Serverless → **New Endpoint** → **Import Git
Repository** → pick the repo → Branch `main`, **Dockerfile Path**
`runpod/echomimic-worker/Dockerfile`.

The build context is the repo root, which is why the `COPY` lines in the Dockerfile are
repo-relative. RunPod caps `docker build` at **30 minutes** (160 min total) — the pip install
of torch/tensorflow/diffusers is the slow part, so if it times out, move the heavy
`pip install` into a base image you build once and `FROM` here.

**Alternative — build locally.** Same context, so use `-f`:

```bash
docker build -f runpod/echomimic-worker/Dockerfile -t <you>/echomimic-worker:1 .
docker push <you>/echomimic-worker:1
```

Then RunPod → Serverless → New Endpoint → Import from Docker Registry.

Either way, the endpoint settings are:

| Setting | Value |
| --- | --- |
| GPU | **RTX 4090 24 GB** (12 GB is the floor; 4090D is upstream's tested card) |
| Network Volume | mount the seeded volume at `/runpod-volume` |
| Max workers | start at 2–3; this is your concurrency **and** your spend ceiling |
| Idle timeout | 5–10s — every idle second is billed |
| Execution timeout | 600s |

Put the endpoint id in `RUNPOD_ECHOMIMIC_ENDPOINT`. Auth reuses the existing `RUN_POD_KEY`.

**Pin `ECHOMIMIC_REF` to a commit** once a build works. `main` moving is the likeliest cause
of a worker that rendered fine last week and errors today.

## Interface

```jsonc
// POST https://api.runpod.ai/v2/<endpoint>/run
{ "input": {
    "plate_url":  "https://…/plate-1920x1080.png",  // the FULL contextual plate
    "audio_url":  "https://…/scene-12.wav",
    "upload_url": "https://…presigned-PUT",         // worker writes the mp4 here
    "fallback_box": { "x": 115, "y": 312 },         // used only if no face is found
    "prompt": "A person is speaking to the camera.",
    "steps": 8, "guidance_scale": 6.0, "audio_guidance_scale": 3.0,
    "size": 768, "fps": 25, "seed": 43
}}
// → { "ok": true, "frames": 137, "seconds": 5.48, "gpu_seconds": 96.4,
//      "box": { "x": 420, "y": 300, "size": 768 }, "detected": true }
```

### Why the worker gets the whole plate

It runs RetinaFace (`src/face_detect.get_mask_coord` — already a repo dependency via
`retina-face==0.0.17` + `tensorflow==2.15.0`) to find where the image model actually placed the
host, and crops there. The server then composites the animated square back to the **same** box,
which comes back in `box`.

Handing the worker a pre-cut square instead would bake in a guess. With per-scene backgrounds
every plate is composed differently, so a fixed rectangle is exactly the wrong assumption — it
clips shoulders when the model drifts right, or wastes the 768 budget on wall when the host
lands small.

Detection failure is **not** an error: it falls back to `fallback_box` and sets
`detected: false`, which the server logs as `box FALLBACK`. Watch for that in the logs — a lot
of fallbacks means `hostPlatePrompt` and the plate model are disagreeing.

## The 138-frame ceiling

Standard inference caps at **138 frames ≈ 5.5s at 25fps**. Host scenes in this pipeline run
4–8s (`HOST_MIN_HOLD_SEC`…`LONG_SCENE_MAX_SEC`), so **a meaningful share of scenes will not
fit**. The adapter rejects over-long audio locally rather than paying for a failure.

Three ways to live with it, best first:

1. Lower `LONG_SCENE_MAX_SEC` to 5 in `server/longformVideo.ts`. Changes pacing for b-roll too.
2. Enable the repo's long-video path and raise `ECHOMIMIC_MAX_FRAMES`.
3. Chunk and stitch — **not recommended**: each chunk restarts from the same still, so the
   host visibly resets mid-sentence.

## Cost sanity check

Break-even vs HeyGen Avatar IV ($0.067/s of video) on a 4090 at ~$1.10/hr is **219 GPU-seconds
per second of video**. The `gpu_seconds` field in every response is there so you can watch the
real ratio:

```
ratio = gpu_seconds / seconds     # under ~219 ⇒ cheaper than HeyGen
```

A 5-step 1.3B model should land far under that. Measure before trusting it.
