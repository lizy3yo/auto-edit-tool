"""
RunPod serverless handler for EchoMimicV3 (antgroup/echomimic_v3), Flash variant.

Contract — one host lip-sync render per job:

    input = {
      "plate_url":  str,          # FULL 1920x1080 contextual plate (public URL)
      "audio_url":  str,          # narration for this scene (public URL)
      "upload_url": str,          # presigned R2 PUT; the mp4 is written here
      "fallback_box": {"x": int, "y": int},   # used when no face is detected
      "prompt":     str  = "A person is speaking to the camera.",
      "steps":      int  = 8,     # Flash is tuned for 8; 5 works for talking head
      "guidance_scale":       float = 6.0,
      "audio_guidance_scale": float = 3.0,
      "size":       int  = 768,   # model ceiling; square
      "fps":        int  = 25,
      "seed":       int  = 43,
    }

    output = {
      "ok": true, "frames": int, "seconds": float, "gpu_seconds": float,
      "box": {"x": int, "y": int, "size": int},   # where the square was cut FROM
      "detected": bool,                            # false ⇒ fallback_box was used
    }

The worker receives the WHOLE plate and does its own cropping, rather than being handed a
pre-cut square. That is what lets it use RetinaFace (`src/face_detect.get_mask_coord`, already
a repo dependency) to find where the image model actually put the host, instead of the server
guessing a fixed rectangle and hoping the composition landed in it. The box it used comes back
in the response so the server can composite the animated square to the same place.

That matters most for per-scene backgrounds: every scene gets a differently-composed plate, so
a fixed rectangle is exactly the wrong assumption.

The finished video is PUT to `upload_url` rather than returned inline: an 8s 768p clip is
several MB, and RunPod's response payload is not the right place for it. Passing a presigned
URL also means no R2 credentials ever live in this worker.

Weights live on a RunPod Network Volume mounted at /runpod-volume (see README). Baking ~15GB
into the image would make every cold start pay for the download.
"""

import os
import sys
import subprocess
import time
import glob
import shutil
import tempfile

import requests
import runpod

# ── Paths (Network Volume) ────────────────────────────────────────────────────
VOLUME = os.environ.get("ECHOMIMIC_VOLUME", "/runpod-volume/echomimic")
REPO = os.environ.get("ECHOMIMIC_REPO", "/app/echomimic_v3")
BASE_MODEL = os.environ.get(
    "ECHOMIMIC_BASE_MODEL", f"{VOLUME}/Wan2.1-Fun-V1.1-1.3B-InP"
)
# `BadToBest/EchoMimicV3` ships TWO transformers: `transformer/` (what run_flash.sh's example
# points at) and `echomimicv3-flash-pro/`. Overridable so you can A/B them without a rebuild:
#   ECHOMIMIC_TRANSFORMER=/runpod-volume/echomimic/flash/echomimicv3-flash-pro/diffusion_pytorch_model.safetensors
TRANSFORMER = os.environ.get(
    "ECHOMIMIC_TRANSFORMER",
    f"{VOLUME}/flash/transformer/diffusion_pytorch_model.safetensors",
)
# NOT in the HuggingFace weights repo — fetched separately from
# `TencentGameMate/chinese-wav2vec2-base`. See README.
WAV2VEC = os.environ.get("ECHOMIMIC_WAV2VEC", f"{VOLUME}/flash/chinese-wav2vec2-base")
CONFIG = os.environ.get("ECHOMIMIC_CONFIG", f"{REPO}/config/config.yaml")


def _preflight() -> str | None:
    """Names any missing model path, or None when everything resolves.

    Run per job rather than at import: a missing weight otherwise surfaces as a torch or
    diffusers stack trace thrown minutes into inference, on a GPU you are paying for. This
    turns it into an immediate, readable error naming the exact path.
    """
    missing = [
        f"{label}={path}"
        for label, path in (
            ("base_model", BASE_MODEL),
            ("transformer", TRANSFORMER),
            ("wav2vec", WAV2VEC),
            ("config", CONFIG),
        )
        if not os.path.exists(path)
    ]
    return (
        "missing model path(s) on the network volume: " + ", ".join(missing)
        if missing
        else None
    )

# Wan-family latent packing needs a 4n+1 frame count. A non-conforming value either errors or
# is silently truncated, which would trip the pipeline's short-render guard.
FRAME_MULTIPLE = 4

# Standard (non-long) inference tops out here. The caller is expected to reject longer audio
# before submitting — see `maxAudioSec` in server/providers/echomimic-lipsync.ts — but the
# clamp stays as a backstop so a stray long job fails fast instead of OOMing the GPU.
MAX_FRAMES = int(os.environ.get("ECHOMIMIC_MAX_FRAMES", "138"))


def _download(url: str, dest: str) -> str:
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
    return dest


def _audio_seconds(path: str) -> float:
    """Duration via ffprobe.

    ffmpeg is already in the image for EchoMimicV3's own use, so probing through it keeps the
    worker's dependency list to `runpod` + `requests` and handles whatever container the
    caller sends (wav, mp3, m4a) rather than just the formats libsndfile knows.
    """
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(out.stdout.strip())


def _frames_for(seconds: float, fps: int) -> int:
    """Round UP to the next 4n+1 frame count, clamped to MAX_FRAMES.

    Rounding up matters: a render shorter than its narration trips `runChunkTasks`'
    truncation guard on the caller side and gets re-submitted, so we'd pay twice.
    """
    raw = int(seconds * fps) + 1
    n = (raw - 1 + FRAME_MULTIPLE - 1) // FRAME_MULTIPLE
    return min(MAX_FRAMES, n * FRAME_MULTIPLE + 1)


def _detect_host_box(plate_path: str, size: int, fallback: dict) -> tuple:
    """Locate the host in the plate and return the square to animate: (box, detected).

    RetinaFace comes from `src/face_detect.py`, already a dependency of the repo
    (`retina-face==0.0.17` + `tensorflow==2.15.0` are in its requirements.txt), so this adds
    nothing to the image.

    Framing: centre the square horizontally on the face and sit the face's top edge ~18% down
    from the box top. That leaves natural headroom above and fills the rest with torso, which
    is the waist-up composition `hostPlatePrompt` asks for. Everything is clamped so the box
    can never leave the plate.

    Detection failure is NOT an error — it falls back to the server's fixed box, which is the
    behaviour we had before detection existed.
    """
    from PIL import Image

    with Image.open(plate_path) as im:
        width, height = im.size

    def clamp(box_x: int, box_y: int) -> dict:
        return {
            "x": max(0, min(box_x, max(0, width - size))),
            "y": max(0, min(box_y, max(0, height - size))),
            "size": size,
        }

    try:
        # Resolved at RUNTIME from the echomimic_v3 clone inside the image
        # (/app/echomimic_v3/src/face_detect.py), which is why sys.path is patched first and
        # why a local editor cannot see it. Unlike the old soundfile import there is nothing
        # to remove here — RetinaFace is the point — so the checker is simply told to skip it.
        sys.path.insert(0, REPO)
        from src.face_detect import get_mask_coord  # pyrefly: ignore[missing-import]  # type: ignore[import-not-found]

        coord = get_mask_coord(plate_path)
    except Exception as e:  # detector missing, TF failure, unreadable image
        print(f"[echomimic] face detection unavailable ({e}); using fallback box")
        coord = None

    if not coord:
        return clamp(int(fallback.get("x", 0)), int(fallback.get("y", 0))), False

    y1, y2, x1, x2, _h, _w = coord
    face_cx = (int(x1) + int(x2)) // 2
    return (
        clamp(face_cx - size // 2, int(y1) - int(size * 0.18)),
        True,
    )


def handler(job):
    started = time.time()
    i = job.get("input") or {}

    for required in ("plate_url", "audio_url", "upload_url"):
        if not i.get(required):
            return {"error": f"missing required input: {required}"}

    problem = _preflight()
    if problem:
        return {"error": problem}

    fps = int(i.get("fps", 25))
    size = int(i.get("size", 768))
    work = tempfile.mkdtemp(prefix="echo-")
    try:
        plate_path = _download(i["plate_url"], os.path.join(work, "plate.png"))
        audio_path = _download(i["audio_url"], os.path.join(work, "narration.wav"))

        box, detected = _detect_host_box(
            plate_path, size, i.get("fallback_box") or {}
        )
        image_path = os.path.join(work, "host.png")
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", plate_path,
                "-vf", f"crop={size}:{size}:{box['x']}:{box['y']}",
                "-frames:v", "1", image_path,
            ],
            capture_output=True,
            check=True,
        )
        print(
            f"[echomimic] host box {box} (detected={detected})"
        )

        seconds = _audio_seconds(audio_path)
        frames = _frames_for(seconds, fps)
        if seconds * fps > MAX_FRAMES:
            return {
                "error": (
                    f"audio is {seconds:.1f}s ({int(seconds * fps)} frames) but this worker "
                    f"caps at {MAX_FRAMES} frames (~{MAX_FRAMES / fps:.1f}s). Shorten the host "
                    f"scene or enable long-video mode."
                )
            }

        out_dir = os.path.join(work, "outputs")
        os.makedirs(out_dir, exist_ok=True)

        cmd = [
            "python", "infer_flash.py",
            "--image_path", image_path,
            "--audio_path", audio_path,
            "--prompt", i.get("prompt", "A person is speaking to the camera."),
            "--num_inference_steps", str(int(i.get("steps", 8))),
            "--config_path", CONFIG,
            "--model_name", BASE_MODEL,
            "--transformer_path", TRANSFORMER,
            "--wav2vec_model_dir", WAV2VEC,
            "--save_path", out_dir,
            "--sampler_name", "Flow_Unipc",
            "--video_length", str(frames),
            "--guidance_scale", str(float(i.get("guidance_scale", 6.0))),
            "--audio_guidance_scale", str(float(i.get("audio_guidance_scale", 3.0))),
            "--audio_scale", "1.0",
            "--neg_scale", "1.0",
            "--neg_steps", "0",
            "--seed", str(int(i.get("seed", 43))),
            "--enable_teacache",
            "--teacache_threshold", "0.1",
            "--num_skip_start_steps", "5",
            "--riflex_k", "6",
            "--ulysses_degree", "1",
            "--ring_degree", "1",
            "--weight_dtype", "bfloat16",
            "--sample_size", str(size), str(size),
            "--fps", str(fps),
            "--shift", "5.0",
        ]

        proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
        if proc.returncode != 0:
            # Tail only — the full diffusers/torch log is enormous and the useful part is last.
            return {
                "error": "echomimic inference failed",
                "stderr": proc.stderr[-4000:],
                "stdout": proc.stdout[-2000:],
            }

        produced = sorted(
            glob.glob(os.path.join(out_dir, "**", "*.mp4"), recursive=True),
            key=os.path.getmtime,
        )
        if not produced:
            return {"error": "inference reported success but produced no mp4"}
        video_path = produced[-1]

        with open(video_path, "rb") as f:
            put = requests.put(
                i["upload_url"],
                data=f,
                headers={"Content-Type": "video/mp4"},
                timeout=300,
            )
        if put.status_code not in (200, 201, 204):
            return {
                "error": f"upload failed ({put.status_code}): {put.text[:300]}"
            }

        return {
            "ok": True,
            "frames": frames,
            "seconds": round(frames / fps, 3),
            "gpu_seconds": round(time.time() - started, 1),
            # Where the square was cut from — the server composites the animated result back
            # to exactly this rectangle.
            "box": box,
            "detected": detected,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


runpod.serverless.start({"handler": handler})
