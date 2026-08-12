# EchoMimicV3 RunPod serverless worker.
#
# Code only — the ~15GB of weights live on a Network Volume mounted at /runpod-volume, so a
# cold start mounts them instead of downloading them. See README.md for the one-time seed.
#
# The repo needs CUDA >= 12.1 and Python 3.10/3.11 (per antgroup/echomimic_v3).
#
# BUILD CONTEXT IS THE REPO ROOT, not this directory — RunPod's GitHub integration takes a
# Dockerfile path and builds from the repo root, so the COPY paths below are repo-relative.
# Build locally the same way so the two can't drift:
#   docker build -f runpod/echomimic-worker/Dockerfile -t <user>/echomimic-worker:1 .
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/runpod-volume/hf \
    ECHOMIMIC_VOLUME=/runpod-volume/echomimic \
    ECHOMIMIC_REPO=/app/echomimic_v3

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin the commit once you have a working build — `main` moving under you is the most likely
# cause of a worker that rendered fine last week and errors today.
ARG ECHOMIMIC_REF=main
RUN git clone https://github.com/antgroup/echomimic_v3.git && \
    cd echomimic_v3 && git checkout ${ECHOMIMIC_REF}

RUN pip install --no-cache-dir -r /app/echomimic_v3/requirements.txt
COPY runpod/echomimic-worker/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY runpod/echomimic-worker/handler.py /app/handler.py

CMD ["python", "-u", "/app/handler.py"]
